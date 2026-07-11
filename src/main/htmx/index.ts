// Electron wiring for HTMX views: IPC surface, approval store, .neuron
// scaffolding, and view-server lifecycle. The server itself (server.ts) and
// the policy/session/manifest modules are electron-free and tested directly.

import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { SessionManager, sha256 } from './sessions';
import { createViewServer, ViewServer } from './server';
import { compilePolicy, resolveInWorkspace } from './pathPolicy';
import { validateManifest, effectiveGrants, ViewManifest } from './manifest';

interface Deps {
  getRepoRoot: () => string | null;
  getSetting: (key: string) => unknown;
  setSetting: (key: string, value: unknown) => void;
}

interface ApprovalRecord { manifestHash: string; grantedAt: string }
type Approvals = Record<string, ApprovalRecord>;

const APPROVALS_KEY = 'htmxViewApprovals';

const sessions = new SessionManager();
let serverPromise: Promise<ViewServer> | null = null;
let serverOrigin: string | null = null;
// Session-lifetime ("once") approvals: viewKey → manifest hash. Never persisted.
const onceApprovals = new Map<string, string>();

/** Origin of the running view server, for navigation guards in main.ts. */
export function getViewServerOrigin(): string | null {
  return serverOrigin;
}

/** Called when the active workspace changes: every open view session dies. */
export function revokeAllViewSessions(): void {
  sessions.revokeAll();
}

function htmxJsPath(): string {
  // Dev: resolve from node_modules. Packaged: copied next to the compiled main
  // bundle by tools/copy-htmx.mjs during build.
  const bundled = path.join(__dirname, 'htmx.min.js');
  if (fs.existsSync(bundled)) return bundled;
  return require.resolve('htmx.org/dist/htmx.min.js');
}

async function ensureServer(): Promise<ViewServer> {
  if (!serverPromise) {
    serverPromise = createViewServer(sessions, htmxJsPath()).then((s) => {
      serverOrigin = s.origin;
      return s;
    });
    serverPromise.catch(() => { serverPromise = null; });
  }
  return serverPromise;
}

// --- .neuron scaffold ---------------------------------------------------------

const SCAFFOLD: Record<string, string> = {
  'config.json': JSON.stringify({ version: 1 }, null, 2) + '\n',
  'variables.json': JSON.stringify({
    version: 1,
    variables: {
      dashboardTitle: { type: 'string', value: 'My dashboard', writable: false, description: 'Shown by the starter templates.' },
      projectStatus: { type: 'string', value: 'active', writable: true, description: 'A view-editable example variable.' },
    },
  }, null, 2) + '\n',
  'fragments/hello.html': `<div class="neuron-card">
  <div class="neuron-metric-label">{{ variables.dashboardTitle }}</div>
  <p>This fragment lives in <code>.neuron/fragments/hello.html</code>.
  Fragments interpolate <code>{{ variables.name }}</code> and <code>{{ params.name }}</code> — values are always HTML-escaped.</p>
</div>
`,
  'templates/dashboard.nhtml': `<h1>{{ variables.dashboardTitle }}</h1>
<section class="neuron-grid cols-3">
  <div class="neuron-card" hx-get="/api/v1/fragments/workspace-summary" hx-trigger="load" hx-swap="innerHTML">Loading…</div>
  <div class="neuron-card" hx-get="/api/v1/fragments/hello" hx-trigger="load" hx-swap="innerHTML">Loading…</div>
  <div class="neuron-card">
    <div class="neuron-metric-label">Tags</div>
    <div hx-get="/api/v1/tags" hx-trigger="load" hx-swap="innerHTML">Loading…</div>
  </div>
</section>
`,
  'templates/note-browser.nhtml': `<h1>Note browser</h1>
<section class="neuron-card">
  <form hx-get="/api/v1/search" hx-target="#results" hx-trigger="submit, input changed delay:300ms from:#q">
    <label for="q">Search notes</label>
    <input id="q" class="neuron-input" name="query" type="search" autocomplete="off" />
  </form>
  <div id="results"></div>
</section>
<section class="neuron-card" hx-get="/api/v1/notes?limit=25" hx-trigger="load" hx-swap="innerHTML">Loading notes…</section>
`,
  'templates/file-list.nhtml': `<h1>Workspace files</h1>
<section class="neuron-card" hx-get="/api/v1/files?limit=50" hx-trigger="load" hx-swap="innerHTML">Loading files…</section>
`,
};

/** Create missing .neuron folders/files. Never overwrites anything. */
function ensureScaffold(root: string): void {
  for (const dir of ['fragments', 'styles', 'templates']) {
    fs.mkdirSync(path.join(root, '.neuron', dir), { recursive: true });
  }
  for (const [rel, content] of Object.entries(SCAFFOLD)) {
    const full = path.join(root, '.neuron', rel.split('/').join(path.sep));
    if (!fs.existsSync(full)) fs.writeFileSync(full, content, 'utf-8');
  }
}

// --- manifest + approvals -------------------------------------------------------

function manifestPathFor(viewRel: string): string {
  return viewRel.replace(/\.nhtml$/i, '.neuron.json');
}

function loadManifest(root: string, viewRel: string): { manifest: ViewManifest | null; hash: string; errors: string[] } {
  const resolved = resolveInWorkspace(root, manifestPathFor(viewRel));
  if (!resolved || !fs.existsSync(resolved.full)) return { manifest: null, hash: 'none', errors: [] };
  let raw: string;
  try { raw = fs.readFileSync(resolved.full, 'utf-8'); } catch { return { manifest: null, hash: 'none', errors: ['Manifest could not be read.'] }; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { manifest: null, hash: 'none', errors: ['Manifest is not valid JSON.'] }; }
  const result = validateManifest(parsed);
  if (!result.ok) return { manifest: null, hash: 'none', errors: result.errors };
  // Approvals bind to the exact manifest content: any edit re-requests consent.
  return { manifest: result.value!, hash: sha256(raw), errors: [] };
}

function viewKey(root: string, viewRel: string): string {
  return `${root}::${viewRel}`;
}

export function initHtmxViews(deps: Deps): void {
  const readApprovals = (): Approvals => (deps.getSetting(APPROVALS_KEY) as Approvals) ?? {};

  const isApproved = (key: string, hash: string): boolean => {
    if (onceApprovals.get(key) === hash) return true;
    const record = readApprovals()[key];
    return !!record && record.manifestHash === hash;
  };

  ipcMain.handle('htmx-views:open', async (_event, relativePath: string, theme?: 'light' | 'dark') => {
    const root = deps.getRepoRoot();
    if (!root) return { status: 'error', message: 'No workspace is open.' };
    const resolved = resolveInWorkspace(root, relativePath);
    if (!resolved || !/\.nhtml$/i.test(resolved.rel)) return { status: 'error', message: 'Not a valid HTMX view path.' };
    if (!fs.existsSync(resolved.full)) return { status: 'error', message: 'View file not found.' };

    try { ensureScaffold(root); } catch { /* read-only workspace: views still work */ }

    const { manifest, hash, errors } = loadManifest(root, resolved.rel);
    if (errors.length) return { status: 'error', message: `Invalid manifest (${manifestPathFor(resolved.rel)}): ${errors.join(' ')}` };

    const grants = effectiveGrants(manifest);
    const name = manifest?.name ?? resolved.rel.split('/').pop()!.replace(/\.nhtml$/i, '');
    if (grants.needsApproval && !isApproved(viewKey(root, resolved.rel), hash)) {
      return { status: 'needs-approval', name, description: manifest?.description, permissions: manifest!.permissions };
    }

    const server = await ensureServer();
    // One session per open tab; reopening the same view replaces its session.
    const existing = sessions.findByPath(root, resolved.rel);
    if (existing) sessions.revoke(existing.id);
    const session = sessions.create({
      viewPath: resolved.rel,
      root,
      name,
      theme: manifest?.themeMode === 'light' ? 'light' : manifest?.themeMode === 'dark' ? 'dark' : (theme ?? 'dark'),
      caps: grants.caps,
      readPolicy: compilePolicy(grants.readPatterns),
      writePolicy: compilePolicy(grants.writePatterns),
    });
    return {
      status: 'ready',
      sessionId: session.id,
      url: `${server.origin}/views/${session.id}/document?boot=${session.bootToken}`,
      partition: `view-${session.id}`, // in-memory partition: per-view cookie/storage isolation
      name,
    };
  });

  ipcMain.handle('htmx-views:approve', (_event, relativePath: string, scope: 'always' | 'once') => {
    const root = deps.getRepoRoot();
    if (!root) return { success: false, error: 'No workspace is open.' };
    const resolved = resolveInWorkspace(root, relativePath);
    if (!resolved) return { success: false, error: 'Invalid path.' };
    const { manifest, hash, errors } = loadManifest(root, resolved.rel);
    if (errors.length || !manifest) return { success: false, error: 'Manifest missing or invalid.' };
    const key = viewKey(root, resolved.rel);
    if (scope === 'always') {
      const approvals = readApprovals();
      approvals[key] = { manifestHash: hash, grantedAt: new Date().toISOString() };
      deps.setSetting(APPROVALS_KEY, approvals);
    } else {
      onceApprovals.set(key, hash);
    }
    return { success: true };
  });

  ipcMain.handle('htmx-views:close', (_event, sessionId: string) => {
    if (typeof sessionId === 'string') sessions.revoke(sessionId);
    return { success: true };
  });

  ipcMain.handle('htmx-views:reset-approval', (_event, relativePath: string) => {
    const root = deps.getRepoRoot();
    if (!root) return { success: false };
    const resolved = resolveInWorkspace(root, relativePath);
    if (!resolved) return { success: false };
    const key = viewKey(root, resolved.rel);
    onceApprovals.delete(key);
    const approvals = readApprovals();
    if (approvals[key]) { delete approvals[key]; deps.setSetting(APPROVALS_KEY, approvals); }
    const session = sessions.findByPath(root, resolved.rel);
    if (session) sessions.revoke(session.id);
    return { success: true };
  });
}
