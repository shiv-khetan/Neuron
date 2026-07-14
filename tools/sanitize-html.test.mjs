// Security checks for src/renderer/lib/sanitize-html.ts — proves untrusted
// note HTML can never reach the renderer as executable markup. Runs in Node
// with linkedom providing DOMParser (a browser global the sanitizer relies on)
// and react-dom/server to inspect the produced element tree.
// Run: node tools/sanitize-html.test.mjs
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

// The sanitizer calls `new DOMParser().parseFromString(html, 'text/html')` and
// reads `.body`. A real browser parses the string in *body context*, wrapping
// bare fragments in <body>. linkedom's own DOMParser doesn't, so shim one that
// wraps the input exactly as a browser would — a faithful harness for the DOM
// the sanitizer actually runs in (the renderer).
globalThis.DOMParser = class {
  parseFromString(html) {
    const { document } = parseHTML(`<!doctype html><html><head></head><body>${html}</body></html>`);
    return document;
  }
};
globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, 'tools', '.sanitize-html.tmp.mjs');

await build({
  stdin: {
    contents: `export { sanitizeHtmlToReact } from './src/renderer/lib/sanitize-html';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  alias: { '@': join(root, 'src', 'renderer') },
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  outfile,
});

const { sanitizeHtmlToReact } = await import(pathToFileURL(outfile));
rmSync(outfile);
const { renderToStaticMarkup } = await import('react-dom/server');
const render = (html) => renderToStaticMarkup(sanitizeHtmlToReact(html));

// --- the core guarantee: no executable markup escapes -------------------------

// Event-handler attributes are stripped from allowed tags.
{
  const out = render('<div onclick="steal()" onmouseover="x()">hi</div>');
  assert.ok(out.includes('hi'), 'content kept');
  assert.ok(!/onclick/i.test(out), 'onclick dropped');
  assert.ok(!/onmouseover/i.test(out), 'onmouseover dropped');
}

// Nested <img onerror> inside an allowed <div> — the classic bypass — is neutered.
{
  const out = render('<div><img src=x onerror="alert(1)"></div>');
  assert.ok(!/onerror/i.test(out), 'onerror dropped');
  // src="x" is not a safe URL (no scheme) → attribute omitted entirely.
  assert.ok(!/src=/i.test(out), 'unsafe src omitted');
}

// <script> and <style> vanish completely (element AND text content).
{
  assert.ok(!render('<div><script>alert(1)</script></div>').includes('alert'), 'script text gone');
  assert.ok(!render('<style>body{display:none}</style>').includes('display'), 'style text gone');
  assert.ok(!/<script/i.test(render('<script>x</script>')), 'no script element');
}

// Disallowed structural tags (iframe/object/form) drop the element; safe text survives.
{
  const out = render('<iframe src="evil"></iframe><object data="x"></object>ok');
  assert.ok(!/<iframe/i.test(out) && !/<object/i.test(out), 'dangerous elements dropped');
  assert.ok(out.includes('ok'), 'sibling text preserved');
}

// --- URL policy ----------------------------------------------------------------
{
  assert.ok(!render('<a href="javascript:alert(1)">x</a>').includes('javascript:'), 'javascript: link dropped');
  assert.ok(!render('<a href="data:text/html,<script>1</script>">x</a>').includes('data:'), 'data: link dropped');
  const good = render('<a href="https://example.com">docs</a>');
  assert.ok(good.includes('href="https://example.com"'), 'safe href kept');
  assert.ok(good.includes('rel="noreferrer"') && good.includes('target="_blank"'), 'external-link hardening');
  const img = render('<img src="https://example.com/a.png" alt="pic">');
  assert.ok(img.includes('src="https://example.com/a.png"') && img.includes('alt="pic"'), 'safe image kept');
}

// --- structural fidelity: legitimate content still renders ---------------------
{
  const table = render('<table><thead><tr><th colspan="2">H</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>');
  assert.ok(table.includes('<table') && /colspan="2"/i.test(table), 'tables + colspan preserved');
  assert.ok(render('<p class="note">hi <strong>there</strong></p>').includes('class="note"'), 'class kept, nesting kept');
  assert.ok(render('<div>a<br>b</div>').includes('<br'), 'void element ok');
  assert.ok(render('style attr <p style="position:fixed;inset:0">x</p>').indexOf('style=') === -1, 'inline style dropped');
}

// --- robustness ----------------------------------------------------------------
{
  assert.equal(render(''), '', 'empty string safe');
  // Deeply nested input must not throw (depth budget).
  const deep = '<div>'.repeat(200) + 'x' + '</div>'.repeat(200);
  assert.doesNotThrow(() => render(deep), 'deep nesting bounded, no throw');
}

console.log('sanitize-html: all checks passed');
