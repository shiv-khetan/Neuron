// Runnable check for src/renderer/lib/view-security.ts — no test framework
// needed: transpile with vite's bundled esbuild, then assert.
// Run: node tools/view-security.test.mjs
import { transform } from 'esbuild';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'src/renderer/lib/view-security.ts'), 'utf-8');
const { code } = await transform(src, { loader: 'ts', format: 'esm' });
const tmp = join(root, 'tools/.view-security.tmp.mjs');
writeFileSync(tmp, code);
const { safeUrl, withinDocBudget, MAX_DOC_BYTES } = await import(pathToFileURL(tmp));
rmSync(tmp);

// URLs that must pass
assert.equal(safeUrl('https://example.com/a?b=c'), 'https://example.com/a?b=c');
assert.equal(safeUrl('http://localhost:3000'), 'http://localhost:3000');
assert.equal(safeUrl('mailto:me@example.com'), 'mailto:me@example.com');

// URLs that must be rejected
for (const bad of [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'file:///etc/passwd',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:x',
  'chrome://settings',
  'example.com/no-scheme',
  '//protocol-relative.example',
  '',
  null,
  undefined,
  42,
  'https://' + 'a'.repeat(2050),
]) {
  assert.equal(safeUrl(bad), null, `should reject: ${String(bad).slice(0, 60)}`);
}

// Document budget
assert.equal(withinDocBudget('x'.repeat(1000)), true);
assert.equal(withinDocBudget('x'.repeat(MAX_DOC_BYTES + 1)), false);

console.log('view-security: all checks passed');
