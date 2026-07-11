// Runnable checks for the HTMX view platform (src/main/htmx/*): path policy,
// manifest validation, token/session lifecycle, HTML escaping, and a live
// integration pass against the loopback view server. No test framework —
// bundle with vite's esbuild, then assert. Run: node tools/htmx-views.test.mjs
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, 'tools', '.htmx-views.tmp.mjs');

await build({
  stdin: {
    contents: `
      export * from './src/main/htmx/pathPolicy';
      export * from './src/main/htmx/manifest';
      export * from './src/main/htmx/sessions';
      export * from './src/main/htmx/html';
      export * from './src/main/htmx/server';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
});

const m = await import(pathToFileURL(outfile));
rmSync(outfile);

// --- glob compilation --------------------------------------------------------
assert.ok(m.compileGlob('Projects/**').test('Projects/a/b.md'));
assert.ok(!m.compileGlob('Projects/**').test('Other/a.md'));
assert.ok(m.compileGlob('*.md').test('a.md'));
assert.ok(!m.compileGlob('*.md').test('sub/a.md'));
assert.ok(m.compileGlob('**/*.md').test('sub/deep/a.md'));
assert.ok(m.compileGlob('**/*.md').test('a.md'));
assert.ok(m.compileGlob('data/?.csv').test('data/a.csv'));
assert.ok(!m.compileGlob('data/?.csv').test('data/ab.csv'));
assert.ok(!m.compileGlob('a+b/*').test('axb/x')); // regex specials escaped

// --- relative path normalization ----------------------------------------------
assert.equal(m.normalizeRel('notes/a.md'), 'notes/a.md');
assert.equal(m.normalizeRel('.\\notes\\a.md'), 'notes/a.md');
for (const bad of ['..', '../x', 'a/../../x', '/etc/passwd', 'C:/Windows', 'C:\\x', '\\\\server\\share', '~/secrets', 'a\0b', 'a%00b', '', 42, null]) {
  assert.equal(m.normalizeRel(bad), null, `normalizeRel should reject: ${String(bad)}`);
}
assert.equal(m.normalizeRelDir(''), '');
assert.equal(m.normalizeRelDir('..'), null);

// --- workspace resolution + symlink escapes ------------------------------------
const ws = mkdtempSync(join(tmpdir(), 'neuron-htmx-ws-'));
const outside = mkdtempSync(join(tmpdir(), 'neuron-htmx-out-'));
mkdirSync(join(ws, 'notes'), { recursive: true });
writeFileSync(join(ws, 'notes', 'hello.md'), '# Hello world\n\nA note with #alpha and #beta tags. Searchable needle here.\n');
writeFileSync(join(ws, 'notes', 'other.md'), '# Other\n\n#alpha only.\n');
writeFileSync(join(outside, 'secret.txt'), 'top secret');

assert.ok(m.resolveInWorkspace(ws, 'notes/hello.md'));
assert.equal(m.resolveInWorkspace(ws, '../secret.txt'), null);
assert.equal(m.resolveInWorkspace(ws, 'C:/Windows/system32'), null);
let symlinksWork = true;
try {
  symlinkSync(outside, join(ws, 'escape'), 'junction');
} catch {
  symlinksWork = false; // no symlink privilege on this machine — skip
}
if (symlinksWork) {
  assert.equal(m.resolveInWorkspace(ws, 'escape/secret.txt'), null, 'symlink escape must be rejected');
}

// --- manifest validation --------------------------------------------------------
const good = m.validateManifest({ name: 'Test', permissions: ['workspace.files.read', 'workspace.files.write'], allowedReadPaths: ['notes/**'], allowedWritePaths: ['data/out.json'] });
assert.ok(good.ok, good.errors.join('; '));
assert.ok(!m.validateManifest({ exfiltrate: true }).ok, 'unknown fields rejected');
assert.ok(!m.validateManifest({ permissions: ['commands.execute.anything'] }).ok, 'unknown permission rejected');
assert.ok(!m.validateManifest({ networkPolicy: 'open' }).ok, 'network access not grantable');
assert.ok(!m.validateManifest({ allowedReadPaths: ['../outside/**'] }).ok, 'traversal in patterns rejected');
const grants = m.effectiveGrants(good.value);
assert.ok(grants.needsApproval, 'write permissions require approval');
assert.ok(!m.effectiveGrants(null).needsApproval, 'manifest-less views are read-only, no approval');

// --- variables validation ---------------------------------------------------------
const vars = m.validateVariablesFile({ version: 1, variables: { status: { type: 'string', value: 'active', writable: true } } });
assert.ok(vars.ok);
assert.ok(!m.validateVariablesFile({ version: 1, variables: { s: { type: 'string', value: 42 } } }).ok, 'type mismatch rejected');
assert.ok(!m.validateVariablesFile({ version: 1, variables: { 'bad name!': { type: 'string', value: '' } } }).ok);

// --- HTML escaping + interpolation ---------------------------------------------
assert.equal(m.esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
assert.equal(m.interpolate('Hi {{ params.name }}', { params: { name: '<b>x</b>' } }), 'Hi &lt;b&gt;x&lt;/b&gt;');
assert.equal(m.interpolate('{{ params.__proto__ }}', { params: {} }), '');
assert.equal(m.interpolate('{{ variables.constructor.name }}', { variables: {} }), '');
assert.equal(m.interpolate('{{ nope.x }}', { params: {} }), '');

// --- sessions -----------------------------------------------------------------
const sessions = new m.SessionManager();
const mkSession = (caps, readPatterns, writePatterns = []) => sessions.create({
  viewPath: 'dash.nhtml', root: ws, name: 'Dash', theme: 'dark',
  caps: new Set(caps),
  readPolicy: readPatterns.map(m.compileGlob),
  writePolicy: writePatterns.map(m.compileGlob),
});
{
  const s = mkSession(['notes.read'], ['**']);
  assert.equal(sessions.byCookie(`${s.id}:${s.cookieToken}`), s);
  assert.equal(sessions.byCookie(`${s.id}:wrongtoken`), null);
  assert.equal(sessions.byCookie('garbage'), null);
  const boot = s.bootToken;
  assert.ok(sessions.consumeBoot(s.id, boot));
  assert.equal(sessions.consumeBoot(s.id, boot), null, 'boot token is one-time');
  sessions.revoke(s.id);
  assert.equal(sessions.byCookie(`${s.id}:${s.cookieToken}`), null, 'revoked session rejected');
}

// --- integration: live loopback server ------------------------------------------
writeFileSync(join(ws, 'dash.nhtml'), '<h1>{{ variables.dashboardTitle }}</h1>\n<div hx-get="/api/v1/search">x</div>\n');
mkdirSync(join(ws, '.neuron', 'fragments'), { recursive: true });
writeFileSync(join(ws, '.neuron', 'variables.json'), JSON.stringify({
  version: 1,
  variables: {
    dashboardTitle: { type: 'string', value: 'Ops <Dash>', writable: false },
    projectStatus: { type: 'string', value: 'active', writable: true },
  },
}));
writeFileSync(join(ws, '.neuron', 'fragments', 'greet.html'), '<p>{{ variables.dashboardTitle }} / {{ params.who }}</p>');
mkdirSync(join(ws, 'data'), { recursive: true });
writeFileSync(join(ws, 'data', 'out.txt'), 'v1');

const htmxJs = createRequire(import.meta.url).resolve('htmx.org/dist/htmx.min.js');
const srv = await m.createViewServer(sessions, htmxJs);
const READ_CAPS = ['workspace.files.read', 'workspace.directories.list', 'workspace.search', 'notes.read', 'tags.read', 'variables.read'];

const reader = mkSession(READ_CAPS, ['notes/**', 'dash.nhtml']);
const writer = mkSession([...READ_CAPS, 'workspace.files.write', 'workspace.files.create', 'workspace.files.delete', 'variables.write'], ['**'], ['data/**']);
const cookie = (s) => ({ cookie: `nv=${s.id}:${s.cookieToken}` });
const api = (s, route, init = {}) => fetch(`${srv.origin}${route}`, { ...init, headers: { ...cookie(s), ...(init.headers ?? {}) } });

// Unauthenticated and spoofed requests
assert.equal((await fetch(`${srv.origin}/api/v1/context`)).status, 401, 'no cookie -> 401');
assert.equal((await fetch(`${srv.origin}/api/v1/context`, { headers: { cookie: `nv=${reader.id}:forged` } })).status, 401, 'forged token -> 401');
// fetch() forbids overriding Host, so spoof it with a raw http request (DNS rebinding shape).
{
  const { request } = await import('node:http');
  const status = await new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: srv.port, path: '/api/v1/context', headers: { ...cookie(reader), host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.end();
  });
  assert.equal(status, 403, 'host spoof -> 403');
}

// Document bootstrap: one-time boot token, CSP, cookie issuance
const docRes = await fetch(`${srv.origin}/views/${reader.id}/document?boot=${reader.bootToken}`);
assert.equal(docRes.status, 200);
assert.match(docRes.headers.get('content-security-policy') ?? '', /default-src 'none'/);
assert.match(docRes.headers.get('set-cookie') ?? '', /HttpOnly/);
assert.equal(docRes.headers.get('x-content-type-options'), 'nosniff');
const docHtml = await docRes.text();
assert.ok(docHtml.includes('Ops &lt;Dash&gt;'), 'document interpolates + escapes variables');
assert.ok(docHtml.includes(`/views/${reader.id}/htmx.js`), 'htmx served locally');
assert.equal((await fetch(`${srv.origin}/views/${reader.id}/document?boot=x`)).status, 403, 'boot token replay/forgery -> 403');

// Cross-view isolation: writer's cookie cannot pull reader's assets
assert.equal((await api(writer, `/views/${reader.id}/htmx.js`)).status, 403, 'cross-view asset access -> 403');
assert.equal((await api(reader, `/views/${reader.id}/htmx.js`)).status, 200);

// Context + capability enforcement
const context = await (await api(reader, '/api/v1/context')).json();
assert.equal(context.apiVersion, 1);
assert.ok(context.capabilities.includes('notes.read'));
assert.equal((await api(reader, '/api/v1/files/content', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'data/out.txt', content: 'x' }) })).status, 403, 'write without capability -> 403');

// Read paths: allowed, denied by policy, traversal, absolute
assert.equal((await api(reader, '/api/v1/files/content?path=notes/hello.md')).status, 200);
assert.equal((await api(reader, '/api/v1/files/content?path=data/out.txt')).status, 403, 'outside read policy -> 403');
assert.equal((await api(reader, '/api/v1/files/content?path=../secret.txt')).status, 400, 'traversal -> 400');
assert.equal((await api(reader, '/api/v1/files/content?path=C:/Windows/win.ini')).status, 400, 'absolute path -> 400');

// Search: JSON + HTML fragment shapes, results are escaped
const searchJson = await (await api(reader, '/api/v1/search?query=needle')).json();
assert.equal(searchJson.results.length, 1);
assert.equal(searchJson.results[0].path, 'notes/hello.md');
const searchHtml = await (await api(reader, '/api/v1/search?query=needle', { headers: { 'HX-Request': 'true' } })).text();
assert.match(searchHtml, /neuron-list/);

// Notes + tags
const notes = await (await api(reader, '/api/v1/notes?tag=beta')).json();
assert.equal(notes.notes.length, 1);
const tags = await (await api(reader, '/api/v1/tags')).json();
assert.deepEqual(tags.tags, ['alpha', 'beta']);

// Fragments: registry by id, interpolation escaped, hostile names rejected
const frag = await (await api(reader, '/api/v1/fragments/greet?who=<script>')).text();
assert.equal(frag, '<p>Ops &lt;Dash&gt; / &lt;script&gt;</p>');
assert.equal((await api(reader, '/api/v1/fragments/..%2F..%2Fetc')).status, 404, 'fragment ids cannot be paths');

// Variables: read, write-protected, writable roundtrip, type checks
const dashTitle = await (await api(reader, '/api/v1/variables/dashboardTitle')).json();
assert.equal(dashTitle.value, 'Ops <Dash>');
assert.equal((await api(reader, '/api/v1/variables/projectStatus', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x' }) })).status, 403, 'variables.write required');
assert.equal((await api(writer, '/api/v1/variables/dashboardTitle', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x' }) })).status, 403, 'non-writable variable protected');
assert.equal((await api(writer, '/api/v1/variables/projectStatus', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'paused' }) })).status, 200);
assert.equal((await (await api(writer, '/api/v1/variables/projectStatus')).json()).value, 'paused');

// File writes: create, conflict detection, delete; write policy enforced
assert.equal((await api(writer, '/api/v1/files', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'notes/new.md', content: 'x' }) })).status, 403, 'outside write policy -> 403');
const created = await api(writer, '/api/v1/files', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'data/made.txt', content: 'hello' }) });
assert.equal(created.status, 201);
const { hash } = await created.json();
assert.equal((await api(writer, '/api/v1/files/content', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'data/made.txt', content: 'v2', baseHash: 'stale' }) })).status, 409, 'stale baseHash -> 409');
assert.equal((await api(writer, '/api/v1/files/content', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'data/made.txt', content: 'v2', baseHash: hash }) })).status, 200);
assert.equal((await api(writer, '/api/v1/files?path=data/made.txt', { method: 'DELETE' })).status, 200);
assert.equal((await api(writer, '/api/v1/files/content?path=data/made.txt')).status, 404);

// Rate limiting: hammering one session eventually 429s
{
  const s = mkSession(READ_CAPS, ['**']);
  let limited = false;
  for (let i = 0; i < 60; i++) {
    if ((await api(s, '/api/v1/context')).status === 429) { limited = true; break; }
  }
  assert.ok(limited, 'burst of requests should hit the rate limit');
}

// Revocation: closing the tab kills the token immediately
sessions.revoke(reader.id);
assert.equal((await api(reader, '/api/v1/context')).status, 401, 'revoked session -> 401');

srv.close();
rmSync(ws, { recursive: true, force: true });
rmSync(outside, { recursive: true, force: true });
console.log(`htmx-views: all checks passed${symlinksWork ? '' : ' (symlink test skipped: no privilege)'}`);
