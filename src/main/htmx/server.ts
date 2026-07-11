// The Neuron local view server. Serves HTMX view documents, the bundled htmx
// runtime, the neuron-view stylesheet, approved workspace styles, fragments,
// and the /api/v1 routes. Loopback only, ephemeral port, cookie-token auth.
//
// Electron-free by design (http/fs/path/crypto only) so integration tests can
// start it in plain Node.

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { SessionManager, ViewSession, sha256 } from './sessions';
import { policyAllows, resolveInWorkspace } from './pathPolicy';
import { validateVariablesFile, VariableDef } from './manifest';
import {
  esc, interpolate, wrapDocument, errorFragment,
  fileListFragment, searchResultsFragment, noteRowsFragment,
  FileRow, SearchRow, NoteRow,
} from './html';
import { NEURON_VIEW_CSS } from './theme';

export const API_VERSION = 1;

// Resource ceilings: a broken or hostile view degrades, it never freezes Neuron.
const MAX_BODY_BYTES = 1024 * 1024;        // request body
const MAX_READ_BYTES = 2 * 1024 * 1024;    // single file read
const MAX_DOC_BYTES = 2 * 1024 * 1024;     // view document
const MAX_STYLE_BYTES = 256 * 1024;        // one custom stylesheet
const MAX_FRAGMENT_BYTES = 128 * 1024;     // one fragment template
const MAX_LIST_ENTRIES = 500;              // directory listing
const MAX_WALK_ENTRIES = 20000;            // filesystem walk budget
const MAX_SEARCH_RESULTS = 50;
const MAX_SEARCH_FILE_BYTES = 512 * 1024;

const DOC_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
].join('; ');

export interface ViewServer {
  server: http.Server;
  origin: string;
  port: number;
  close: () => void;
}

interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  session: ViewSession;
  requestId: string;
}

let requestCounter = 0;

function baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...extra,
  };
}

function send(res: http.ServerResponse, status: number, headers: Record<string, string>, body: string | Buffer): void {
  res.writeHead(status, baseHeaders(headers));
  res.end(body);
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(payload));
}

function isHx(req: http.IncomingMessage): boolean {
  return req.headers['hx-request'] === 'true';
}

/** Structured error: HTML fragment for htmx swaps, JSON otherwise. Safe messages only. */
function fail(ctx: Pick<Ctx, 'req' | 'res' | 'requestId'>, status: number, code: string, message: string): void {
  if (isHx(ctx.req)) {
    send(ctx.res, status, { 'Content-Type': 'text/html; charset=utf-8' }, errorFragment(message));
  } else {
    sendJson(ctx.res, status, { error: { code, message, requestId: ctx.requestId } });
  }
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function readBody(req: http.IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { resolve(null); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

/** Parse a JSON or form-urlencoded body into a plain record. */
function parseBody(req: http.IncomingMessage, body: Buffer): Record<string, unknown> | null {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  try {
    if (type === 'application/json') {
      const parsed = JSON.parse(body.toString('utf-8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    }
    if (type === 'application/x-www-form-urlencoded' || type === '') {
      return Object.fromEntries(new URLSearchParams(body.toString('utf-8')));
    }
  } catch { /* malformed */ }
  return null;
}

// --- workspace helpers -------------------------------------------------------

function atomicWrite(fullPath: string, content: string): void {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const tmp = `${fullPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, fullPath);
}

/** Recursive workspace walk (posix rel paths), skipping dot-entries except .neuron. */
function walkFiles(root: string, subdir: string): string[] {
  const out: string[] = [];
  let visited = 0;
  const scan = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (++visited > MAX_WALK_ENTRIES) return;
      if (entry.name.startsWith('.') && entry.name !== '.neuron') continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childFull = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue; // symlinks are never followed
      if (entry.isDirectory()) scan(childFull, childRel);
      else if (entry.isFile()) out.push(childRel);
    }
  };
  const start = subdir ? path.join(root, subdir.split('/').join(path.sep)) : root;
  scan(start, subdir);
  return out;
}

function loadVariables(root: string): { vars: Record<string, VariableDef>; errors: string[] } {
  const file = path.join(root, '.neuron', 'variables.json');
  if (!fs.existsSync(file)) return { vars: {}, errors: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const result = validateVariablesFile(parsed);
    return result.ok ? { vars: result.value!, errors: [] } : { vars: {}, errors: result.errors };
  } catch {
    return { vars: {}, errors: ['variables.json is not valid JSON.'] };
  }
}

function noteTitle(relPath: string, content: string): string {
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  return relPath.split('/').pop()!.replace(/\.(md|mdx)$/i, '');
}

function noteTags(content: string): string[] {
  const tags = new Set<string>();
  const re = /(?:^|\s)#([A-Za-z][A-Za-z0-9_-]*)(?=\s|$|\.|,)/g;
  let match;
  while ((match = re.exec(content)) !== null) tags.add(match[1]);
  return [...tags].sort();
}

// --- server ------------------------------------------------------------------

export function createViewServer(sessions: SessionManager, htmxJsPath: string): Promise<ViewServer> {
  let origin = '';

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      // Never leak stack traces; the error is already an internal one.
      try { sendJson(res, 500, { error: { code: 'internal', message: 'Internal error.' } }); } catch { /* socket gone */ }
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const requestId = `r${++requestCounter}`;
    const url = new URL(req.url ?? '/', origin || 'http://127.0.0.1');

    // DNS-rebinding guard: the Host header must be exactly our loopback origin.
    if (origin && `http://${req.headers.host}` !== origin) {
      sendJson(res, 403, { error: { code: 'bad_host', message: 'Rejected.' } });
      return;
    }

    // Document bootstrap: /views/{sid}/document?boot={one-time-token}
    const docMatch = url.pathname.match(/^\/views\/([\w-]+)\/document$/);
    if (docMatch && req.method === 'GET') {
      const session = sessions.consumeBoot(docMatch[1], url.searchParams.get('boot'));
      if (!session) { send(res, 403, { 'Content-Type': 'text/html; charset=utf-8' }, '<!doctype html><p>This view session is no longer valid. Reload the tab.</p>'); return; }
      serveDocument({ req, res, url, session, requestId });
      return;
    }

    // Everything else authenticates through the session cookie.
    const session = sessions.byCookie(parseCookies(req)['nv']);
    if (!session) { fail({ req, res, requestId }, 401, 'unauthorized', 'Missing or invalid view session.'); return; }
    if (!sessions.allowRequest(session)) { fail({ req, res, requestId }, 429, 'rate_limited', 'Too many requests from this view.'); return; }

    // Cross-origin hardening: browsers set Origin on non-GET; when present it must be us.
    const reqOrigin = req.headers.origin;
    if (reqOrigin && reqOrigin !== origin && reqOrigin !== 'null') {
      fail({ req, res, requestId }, 403, 'bad_origin', 'Rejected.');
      return;
    }

    const ctx: Ctx = { req, res, url, session, requestId };

    // Per-view static assets: /views/{sid}/...
    const viewMatch = url.pathname.match(/^\/views\/([\w-]+)\/(.+)$/);
    if (viewMatch) {
      // A view may only fetch its own session's assets.
      if (viewMatch[1] !== session.id) { fail(ctx, 403, 'forbidden', 'Rejected.'); return; }
      serveViewAsset(ctx, viewMatch[2]);
      return;
    }

    if (url.pathname.startsWith('/api/v1/')) {
      await serveApi(ctx);
      return;
    }

    fail(ctx, 404, 'not_found', 'Unknown route.');
  }

  function serveDocument(ctx: Ctx): void {
    const { session } = ctx;
    const resolved = resolveInWorkspace(session.root, session.viewPath);
    if (!resolved || !fs.existsSync(resolved.full)) {
      send(ctx.res, 404, { 'Content-Type': 'text/html; charset=utf-8' }, '<!doctype html><p>View file not found.</p>');
      return;
    }
    if (fs.statSync(resolved.full).size > MAX_DOC_BYTES) {
      send(ctx.res, 413, { 'Content-Type': 'text/html; charset=utf-8' }, '<!doctype html><p>View document exceeds the 2 MB limit.</p>');
      return;
    }
    let body = fs.readFileSync(resolved.full, 'utf-8');
    // Safe template substitution: {{ variables.x }} in the document, escaped,
    // key lookup only. Requires the variables.read capability.
    if (session.caps.has('variables.read')) {
      const { vars } = loadVariables(session.root);
      body = interpolate(body, { variables: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.value])) });
    }
    // Workspace styles the document opts into: <link href="styles/x.css"> works
    // via relative resolution, but we also honor .neuron/styles/<view-name>.css.
    const autoStyle = `${session.viewPath.split('/').pop()!.replace(/\.nhtml$/i, '')}.css`;
    const styles = fs.existsSync(path.join(session.root, '.neuron', 'styles', autoStyle)) ? [autoStyle] : [];
    const html = wrapDocument({ body, title: session.name, sessionId: session.id, theme: session.theme, styles });
    send(ctx.res, 200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': DOC_CSP,
      // HttpOnly + SameSite=Strict: the token is invisible to view scripts and
      // never sent by an outside browser page, killing CSRF against loopback.
      'Set-Cookie': `nv=${session.id}:${session.cookieToken}; Path=/; HttpOnly; SameSite=Strict`,
    }, html);
  }

  function serveViewAsset(ctx: Ctx, asset: string): void {
    if (asset === 'htmx.js') {
      send(ctx.res, 200, { 'Content-Type': 'application/javascript; charset=utf-8' }, fs.readFileSync(htmxJsPath));
      return;
    }
    if (asset === 'neuron.css') {
      send(ctx.res, 200, { 'Content-Type': 'text/css; charset=utf-8' }, NEURON_VIEW_CSS);
      return;
    }
    const styleMatch = asset.match(/^styles\/([A-Za-z0-9 _.-]+\.css)$/);
    if (styleMatch) {
      const file = path.join(ctx.session.root, '.neuron', 'styles', styleMatch[1]);
      if (!fs.existsSync(file) || fs.statSync(file).size > MAX_STYLE_BYTES) { fail(ctx, 404, 'not_found', 'Stylesheet not found or too large.'); return; }
      const css = fs.readFileSync(file, 'utf-8');
      // Custom CSS must stay local: no remote imports or remote url() fetches.
      if (/@import\b/i.test(css) || /url\(\s*['"]?\s*(https?:|\/\/)/i.test(css)) {
        fail(ctx, 422, 'unsafe_css', `Stylesheet "${styleMatch[1]}" uses @import or remote URLs, which are blocked.`);
        return;
      }
      send(ctx.res, 200, { 'Content-Type': 'text/css; charset=utf-8' }, css);
      return;
    }
    fail(ctx, 404, 'not_found', 'Unknown view asset.');
  }

  // --- /api/v1 -----------------------------------------------------------------

  async function serveApi(ctx: Ctx): Promise<void> {
    const { url, req } = ctx;
    const route = url.pathname.slice('/api/v1/'.length).replace(/\/+$/, '');
    const method = req.method ?? 'GET';

    if (route === 'context' && method === 'GET') return apiContext(ctx);
    if (route === 'variables' && method === 'GET') return apiVariables(ctx);
    const varMatch = route.match(/^variables\/([A-Za-z][\w-]*)$/);
    if (varMatch && method === 'GET') return apiVariableGet(ctx, varMatch[1]);
    if (varMatch && method === 'PUT') return apiVariablePut(ctx, varMatch[1]);
    if (route === 'files' && method === 'GET') return apiFilesList(ctx);
    if (route === 'files' && method === 'POST') return apiFileCreate(ctx);
    if (route === 'files' && method === 'DELETE') return apiFileDelete(ctx);
    if (route === 'files/content' && method === 'GET') return apiFileRead(ctx);
    if (route === 'files/content' && method === 'PUT') return apiFileWrite(ctx);
    if (route === 'search' && method === 'GET') return apiSearch(ctx);
    if (route === 'notes' && method === 'GET') return apiNotes(ctx);
    if (route === 'tags' && method === 'GET') return apiTags(ctx);
    const fragMatch = route.match(/^fragments\/([A-Za-z0-9_-]{1,64})$/);
    if (fragMatch && method === 'GET') return apiFragment(ctx, fragMatch[1]);

    fail(ctx, 404, 'not_found', 'Unknown API route.');
  }

  function requireCap(ctx: Ctx, cap: string): boolean {
    if (ctx.session.caps.has(cap)) return true;
    fail(ctx, 403, 'missing_capability', `This view does not have the "${cap}" capability. Declare it in the view manifest.`);
    return false;
  }

  /** Resolve + policy-check a path from the query/body. Fails the request itself on error. */
  function checkedPath(ctx: Ctx, rawPath: unknown, mode: 'read' | 'write'): { full: string; rel: string } | null {
    const resolved = resolveInWorkspace(ctx.session.root, rawPath);
    if (!resolved) { fail(ctx, 400, 'invalid_path', 'Path must be a plain workspace-relative path.'); return null; }
    const policy = mode === 'read' ? ctx.session.readPolicy : ctx.session.writePolicy;
    if (!policyAllows(policy, resolved.rel)) {
      fail(ctx, 403, 'path_not_allowed', `Path is outside this view's allowed ${mode} paths.`);
      return null;
    }
    return resolved;
  }

  function apiContext(ctx: Ctx): void {
    const { session } = ctx;
    sendJson(ctx.res, 200, {
      apiVersion: API_VERSION,
      view: { path: session.viewPath, name: session.name },
      workspace: { name: path.basename(session.root) },
      theme: session.theme,
      capabilities: [...session.caps].sort(),
    });
  }

  function apiVariables(ctx: Ctx): void {
    if (!requireCap(ctx, 'variables.read')) return;
    const { vars, errors } = loadVariables(ctx.session.root);
    if (errors.length) { fail(ctx, 500, 'config_invalid', `Invalid .neuron/variables.json: ${errors[0]}`); return; }
    sendJson(ctx.res, 200, { variables: vars });
  }

  function apiVariableGet(ctx: Ctx, key: string): void {
    if (!requireCap(ctx, 'variables.read')) return;
    const { vars, errors } = loadVariables(ctx.session.root);
    if (errors.length) { fail(ctx, 500, 'config_invalid', `Invalid .neuron/variables.json: ${errors[0]}`); return; }
    const def = Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : undefined;
    if (!def) { fail(ctx, 404, 'not_found', `No variable named "${key}".`); return; }
    sendJson(ctx.res, 200, { key, ...def });
  }

  async function apiVariablePut(ctx: Ctx, key: string): Promise<void> {
    if (!requireCap(ctx, 'variables.write')) return;
    const raw = await readBody(ctx.req);
    if (!raw) { fail(ctx, 413, 'body_too_large', 'Request body missing or too large.'); return; }
    const body = parseBody(ctx.req, raw);
    if (!body || !('value' in body)) { fail(ctx, 400, 'invalid_body', 'Body must include a "value" field.'); return; }

    const file = path.join(ctx.session.root, '.neuron', 'variables.json');
    let doc: { version: number; variables: Record<string, unknown> };
    try {
      doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : { version: 1, variables: {} };
    } catch { fail(ctx, 500, 'config_invalid', 'variables.json is not valid JSON.'); return; }
    const { vars, errors } = loadVariables(ctx.session.root);
    if (errors.length) { fail(ctx, 500, 'config_invalid', `Invalid .neuron/variables.json: ${errors[0]}`); return; }
    const def = Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : undefined;
    if (!def) { fail(ctx, 404, 'not_found', `No variable named "${key}".`); return; }
    if (!def.writable) { fail(ctx, 403, 'not_writable', `Variable "${key}" is not declared writable.`); return; }

    let value: unknown = body.value;
    // Form posts arrive as strings; coerce to the declared primitive type.
    if (typeof value === 'string' && def.type === 'number') value = Number(value);
    if (typeof value === 'string' && def.type === 'boolean') value = value === 'true' || value === 'on';
    const checked = validateVariablesFile({ version: 1, variables: { [key]: { ...def, value } } });
    if (!checked.ok) { fail(ctx, 400, 'type_mismatch', `Value does not match declared type "${def.type}".`); return; }

    doc.variables[key] = { ...(doc.variables[key] as Record<string, unknown>), value };
    atomicWrite(file, JSON.stringify(doc, null, 2));
    sendJson(ctx.res, 200, { key, value });
  }

  function apiFilesList(ctx: Ctx): void {
    if (!requireCap(ctx, 'workspace.directories.list')) return;
    const dirResolved = resolveInWorkspace(ctx.session.root, ctx.url.searchParams.get('dir') ?? '', { allowRootDir: true });
    if (!dirResolved) { fail(ctx, 400, 'invalid_path', 'Invalid "dir" parameter.'); return; }
    const glob = ctx.url.searchParams.get('glob');
    const limit = Math.min(MAX_LIST_ENTRIES, Math.max(1, Number(ctx.url.searchParams.get('limit')) || MAX_LIST_ENTRIES));
    const globRe = glob ? (() => { try { return new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/(?<!\.)\*/g, '[^/]*')}$`, 'i'); } catch { return null; } })() : null;

    const rows: FileRow[] = [];
    for (const rel of walkFiles(ctx.session.root, dirResolved.rel)) {
      if (!policyAllows(ctx.session.readPolicy, rel)) continue;
      if (globRe && !globRe.test(rel)) continue;
      let stat: fs.Stats;
      try { stat = fs.statSync(path.join(ctx.session.root, rel.split('/').join(path.sep))); } catch { continue; }
      rows.push({ path: rel, name: rel.split('/').pop()!, size: stat.size, modified: stat.mtime.toISOString(), directory: false });
      if (rows.length >= limit) break;
    }
    if (isHx(ctx.req)) send(ctx.res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, fileListFragment(rows));
    else sendJson(ctx.res, 200, { files: rows });
  }

  function apiFileRead(ctx: Ctx): void {
    if (!requireCap(ctx, 'workspace.files.read')) return;
    const resolved = checkedPath(ctx, ctx.url.searchParams.get('path'), 'read');
    if (!resolved) return;
    if (!fs.existsSync(resolved.full) || !fs.statSync(resolved.full).isFile()) { fail(ctx, 404, 'not_found', 'File not found.'); return; }
    if (fs.statSync(resolved.full).size > MAX_READ_BYTES) { fail(ctx, 413, 'too_large', 'File exceeds the 2 MB read limit.'); return; }
    const content = fs.readFileSync(resolved.full, 'utf-8');
    sendJson(ctx.res, 200, { path: resolved.rel, content, hash: sha256(content) });
  }

  async function apiFileWrite(ctx: Ctx): Promise<void> {
    if (!requireCap(ctx, 'workspace.files.write')) return;
    const raw = await readBody(ctx.req);
    if (!raw) { fail(ctx, 413, 'body_too_large', 'Request body missing or too large.'); return; }
    const body = parseBody(ctx.req, raw);
    if (!body || typeof body.path !== 'string' || typeof body.content !== 'string') { fail(ctx, 400, 'invalid_body', 'Body must include "path" and "content".'); return; }
    const resolved = checkedPath(ctx, body.path, 'write');
    if (!resolved) return;
    if (!fs.existsSync(resolved.full)) { fail(ctx, 404, 'not_found', 'File does not exist — use POST /api/v1/files to create it.'); return; }
    // Optimistic concurrency: refuse to clobber an edit made elsewhere.
    if (typeof body.baseHash === 'string') {
      const current = sha256(fs.readFileSync(resolved.full, 'utf-8'));
      if (current !== body.baseHash) { fail(ctx, 409, 'conflict', 'The file changed since it was read. Re-fetch and retry.'); return; }
    }
    atomicWrite(resolved.full, body.content);
    sendJson(ctx.res, 200, { path: resolved.rel, hash: sha256(body.content) });
  }

  async function apiFileCreate(ctx: Ctx): Promise<void> {
    if (!requireCap(ctx, 'workspace.files.create')) return;
    const raw = await readBody(ctx.req);
    if (!raw) { fail(ctx, 413, 'body_too_large', 'Request body missing or too large.'); return; }
    const body = parseBody(ctx.req, raw);
    if (!body || typeof body.path !== 'string') { fail(ctx, 400, 'invalid_body', 'Body must include "path".'); return; }
    const resolved = checkedPath(ctx, body.path, 'write');
    if (!resolved) return;
    if (fs.existsSync(resolved.full)) { fail(ctx, 409, 'exists', 'A file already exists at that path.'); return; }
    const content = typeof body.content === 'string' ? body.content : '';
    atomicWrite(resolved.full, content);
    sendJson(ctx.res, 201, { path: resolved.rel, hash: sha256(content) });
  }

  function apiFileDelete(ctx: Ctx): void {
    if (!requireCap(ctx, 'workspace.files.delete')) return;
    const resolved = checkedPath(ctx, ctx.url.searchParams.get('path'), 'write');
    if (!resolved) return;
    if (!fs.existsSync(resolved.full) || !fs.statSync(resolved.full).isFile()) { fail(ctx, 404, 'not_found', 'File not found.'); return; }
    fs.unlinkSync(resolved.full);
    sendJson(ctx.res, 200, { path: resolved.rel, deleted: true });
  }

  function apiSearch(ctx: Ctx): void {
    if (!requireCap(ctx, 'workspace.search')) return;
    const query = (ctx.url.searchParams.get('query') ?? '').trim().slice(0, 256);
    if (!query) {
      if (isHx(ctx.req)) send(ctx.res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, '');
      else sendJson(ctx.res, 200, { results: [] });
      return;
    }
    const needle = query.toLowerCase();
    const rows: SearchRow[] = [];
    for (const rel of walkFiles(ctx.session.root, '')) {
      if (rows.length >= MAX_SEARCH_RESULTS) break;
      if (!/\.(md|mdx)$/i.test(rel) || !policyAllows(ctx.session.readPolicy, rel)) continue;
      const full = path.join(ctx.session.root, rel.split('/').join(path.sep));
      try {
        if (fs.statSync(full).size > MAX_SEARCH_FILE_BYTES) continue;
        const content = fs.readFileSync(full, 'utf-8');
        const idx = content.toLowerCase().indexOf(needle);
        if (idx < 0) continue;
        const snippet = content.slice(Math.max(0, idx - 40), idx + query.length + 60).replace(/\s+/g, ' ').trim();
        rows.push({ path: rel, title: noteTitle(rel, content), snippet });
      } catch { /* unreadable file — skip */ }
    }
    if (isHx(ctx.req)) send(ctx.res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, searchResultsFragment(rows, query));
    else sendJson(ctx.res, 200, { results: rows });
  }

  function apiNotes(ctx: Ctx): void {
    if (!requireCap(ctx, 'notes.read')) return;
    const tag = ctx.url.searchParams.get('tag');
    const folder = ctx.url.searchParams.get('folder');
    const limit = Math.min(200, Math.max(1, Number(ctx.url.searchParams.get('limit')) || 100));
    const rows: NoteRow[] = [];
    for (const rel of walkFiles(ctx.session.root, '')) {
      if (rows.length >= limit) break;
      if (!/\.(md|mdx)$/i.test(rel) || !policyAllows(ctx.session.readPolicy, rel)) continue;
      if (folder && !rel.startsWith(folder.replace(/\\/g, '/').replace(/\/+$/, '') + '/')) continue;
      const full = path.join(ctx.session.root, rel.split('/').join(path.sep));
      try {
        if (fs.statSync(full).size > MAX_SEARCH_FILE_BYTES) continue;
        const content = fs.readFileSync(full, 'utf-8');
        const tags = noteTags(content);
        if (tag && !tags.includes(tag)) continue;
        rows.push({ path: rel, title: noteTitle(rel, content), tags, modified: fs.statSync(full).mtime.toISOString() });
      } catch { /* skip */ }
    }
    if (isHx(ctx.req)) send(ctx.res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, noteRowsFragment(rows));
    else sendJson(ctx.res, 200, { notes: rows });
  }

  function apiTags(ctx: Ctx): void {
    if (!requireCap(ctx, 'tags.read')) return;
    const tags = new Set<string>();
    for (const rel of walkFiles(ctx.session.root, '')) {
      if (!/\.(md|mdx)$/i.test(rel) || !policyAllows(ctx.session.readPolicy, rel)) continue;
      const full = path.join(ctx.session.root, rel.split('/').join(path.sep));
      try {
        if (fs.statSync(full).size > MAX_SEARCH_FILE_BYTES) continue;
        for (const t of noteTags(fs.readFileSync(full, 'utf-8'))) tags.add(t);
      } catch { /* skip */ }
    }
    const sorted = [...tags].sort();
    if (isHx(ctx.req)) {
      const body = sorted.length
        ? sorted.map((t) => `<span class="neuron-badge">${esc(t)}</span>`).join(' ')
        : '<p class="neuron-empty">No tags yet.</p>';
      send(ctx.res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, body);
    } else {
      sendJson(ctx.res, 200, { tags: sorted });
    }
  }

  function apiFragment(ctx: Ctx, name: string): void {
    // Fragments resolve by sanitized id inside .neuron/fragments only — the
    // name can never become a filesystem path.
    const file = path.join(ctx.session.root, '.neuron', 'fragments', `${name}.html`);
    let template: string | null = null;
    if (fs.existsSync(file) && fs.statSync(file).size <= MAX_FRAGMENT_BYTES) {
      template = fs.readFileSync(file, 'utf-8');
    } else if (name === 'workspace-summary') {
      template = builtinWorkspaceSummary(ctx.session);
    }
    if (template === null) { fail(ctx, 404, 'not_found', `No fragment named "${name}".`); return; }
    const { vars } = loadVariables(ctx.session.root);
    const variables = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.value]));
    const params: Record<string, string> = {};
    for (const [k, v] of ctx.url.searchParams.entries()) if (/^[A-Za-z][\w-]*$/.test(k)) params[k] = v.slice(0, 512);
    send(ctx.res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, interpolate(template, { variables, params }));
  }

  /** Built-in live fragment: note/tag counts for the starter template. */
  function builtinWorkspaceSummary(session: ViewSession): string {
    let notes = 0;
    const tags = new Set<string>();
    for (const rel of walkFiles(session.root, '')) {
      if (!/\.(md|mdx)$/i.test(rel)) continue;
      notes++;
      try {
        const full = path.join(session.root, rel.split('/').join(path.sep));
        if (fs.statSync(full).size <= MAX_SEARCH_FILE_BYTES) for (const t of noteTags(fs.readFileSync(full, 'utf-8'))) tags.add(t);
      } catch { /* skip */ }
    }
    return `<div class="neuron-metric-label">${esc(path.basename(session.root))}</div>` +
      `<div class="neuron-metric">${notes}</div>` +
      `<p>notes · ${tags.size} tags</p>`;
  }

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { reject(new Error('View server failed to bind.')); return; }
      origin = `http://127.0.0.1:${address.port}`;
      resolve({ server, origin, port: address.port, close: () => server.close() });
    });
  });
}
