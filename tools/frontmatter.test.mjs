// Runnable checks for the frontmatter core — no test framework: transpile the
// TS modules with esbuild, import, and assert. Run: node tools/frontmatter.test.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, 'src/renderer/lib/frontmatter/index.ts');
const tmp = join(root, 'tools/.frontmatter.tmp.cjs');
// Bundle so the `yaml` dependency + local imports resolve in one file. CJS
// output because `yaml` ships CommonJS and uses require() internally.
await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', outfile: tmp, logLevel: 'silent' });
const { parseFrontmatter, serializeFrontmatter } = await import(pathToFileURL(tmp));
rmSync(tmp);

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };

// --- detection --------------------------------------------------------------
{
  const r = parseFrontmatter('---\ntitle: Hello\ntags: [a, b]\n---\n# Body\n');
  ok(r.hasFrontmatter && r.valid, 'basic block detected');
  eq(r.data.title, 'Hello', 'title parsed');
  eq(r.body, '# Body\n', 'body isolated');
  eq(r.properties.find((p) => p.key === 'tags').value, ['a', 'b'], 'tags normalized to list');
}

// no frontmatter
{
  const r = parseFrontmatter('# Just a doc\n\nSome text.\n');
  ok(!r.hasFrontmatter && r.valid, 'no frontmatter');
  eq(r.body, '# Just a doc\n\nSome text.\n', 'body is whole doc');
}

// a horizontal rule mid-document is not frontmatter
{
  const r = parseFrontmatter('# Title\n\ntext\n\n---\n\nmore\n');
  ok(!r.hasFrontmatter, 'mid-doc --- is not frontmatter');
}

// `---` with no closing delimiter is not frontmatter
ok(!parseFrontmatter('---\ntitle: x\n\nbody without close\n').hasFrontmatter, 'unterminated is not frontmatter');

// --- BOM --------------------------------------------------------------------
{
  const r = parseFrontmatter('﻿---\ntitle: X\n---\nbody\n');
  ok(r.hasFrontmatter && r.hadBOM, 'BOM tolerated');
  eq(r.data.title, 'X', 'value after BOM parsed');
}

// --- CRLF -------------------------------------------------------------------
{
  const src = '---\r\ntitle: Win\r\ndone: true\r\n---\r\n# Body\r\nline2\r\n';
  const r = parseFrontmatter(src);
  ok(r.hasFrontmatter && r.eol === '\r\n', 'CRLF detected');
  eq(r.data.title, 'Win', 'CRLF value parsed');
  eq(r.body, '# Body\r\nline2\r\n', 'CRLF body preserved');
}

// --- scalar tags ------------------------------------------------------------
eq(parseFrontmatter('---\ntags: project\n---\n').properties[0].value, ['project'], 'scalar tag → list');

// --- invalid YAML is non-destructive ---------------------------------------
{
  const src = '---\ntitle: "unterminated\ntags: [a, b\n---\nbody\n';
  const r = parseFrontmatter(src);
  ok(r.hasFrontmatter && !r.valid, 'invalid YAML flagged');
  ok(r.diagnostics.length > 0, 'diagnostic reported');
  eq(r.body, 'body\n', 'body still accessible on invalid YAML');
  // Serializing with no edits must NOT corrupt: caller should keep raw. Assert
  // that we never silently produce a valid block over invalid source here by
  // checking the parser refused to populate data.
  eq(r.data, {}, 'no data extracted from invalid YAML');
}

// --- dangerous keys dropped -------------------------------------------------
{
  const r = parseFrontmatter('---\n__proto__: polluted\nsafe: ok\n---\n');
  eq({}.polluted, undefined, 'prototype not polluted');
  eq(r.data.safe, 'ok', 'safe key kept');
  ok(!('__proto__' in r.data) || r.data.__proto__ === Object.prototype, 'dangerous key not set as own prop');
}

// --- unicode ----------------------------------------------------------------
{
  const r = parseFrontmatter('---\n名前: 日本語\ntags:\n  - café\n  - naïve\n---\n');
  eq(r.data['名前'], '日本語', 'unicode key + value');
  eq(r.properties.find((p) => p.key === 'tags').value, ['café', 'naïve'], 'unicode tags');
}

// --- types ------------------------------------------------------------------
{
  const r = parseFrontmatter('---\ncount: 4\ndone: false\ndue: 2026-07-30\nnote: hi\n---\n');
  const byKey = Object.fromEntries(r.properties.map((p) => [p.key, p.type]));
  eq(byKey.count, 'number', 'number type');
  eq(byKey.done, 'boolean', 'boolean type');
  eq(byKey.due, 'date', 'date type');
  eq(byKey.note, 'text', 'text type');
}

// --- nested object preserved but read-only ---------------------------------
{
  const r = parseFrontmatter('---\nmeta:\n  nested: 1\n  deep:\n    x: 2\n---\n');
  const p = r.properties.find((pr) => pr.key === 'meta');
  eq(p.type, 'unknown', 'nested object → unknown');
  ok(!p.editable, 'nested object not editable');
  eq(r.data.meta, { nested: 1, deep: { x: 2 } }, 'nested data retained');
}

// --- serialize round-trips + preserves body byte-for-byte ------------------
{
  const src = '---\ntitle: Old\ntags:\n  - a\n---\n# Body **kept**\n\nparagraph with | pipe and *stars*.\n';
  const parsed = parseFrontmatter(src);
  const entries = parsed.properties.map((p) => ({ key: p.key, value: p.key === 'title' ? 'New' : p.value }));
  const out = serializeFrontmatter(src, entries);
  const re = parseFrontmatter(out);
  eq(re.data.title, 'New', 'edit applied');
  eq(re.body, parsed.body, 'body preserved byte-for-byte');
}

// unchanged edit preserves comments
{
  const src = '---\ntitle: Keep # inline comment\nstatus: draft\n---\nbody\n';
  const parsed = parseFrontmatter(src);
  const out = serializeFrontmatter(src, parsed.properties.map((p) => ({ key: p.key, value: p.value })));
  ok(out.includes('# inline comment'), 'comment on untouched key preserved');
  eq(parseFrontmatter(out).body, 'body\n', 'body intact');
}

// CRLF round-trip keeps CRLF
{
  const src = '---\r\ntitle: A\r\n---\r\nbody\r\nx\r\n';
  const out = serializeFrontmatter(src, [{ key: 'title', value: 'B' }]);
  ok(out.includes('\r\n') && !/[^\r]\n/.test(out), 'CRLF preserved on serialize');
  eq(parseFrontmatter(out).body, 'body\r\nx\r\n', 'CRLF body preserved');
}

// removing all properties strips the block (default)
{
  const out = serializeFrontmatter('---\ntitle: X\n---\n# Body\n', []);
  eq(out, '# Body\n', 'empty properties strips block');
}

// adding first property to a doc with none creates a block
{
  const out = serializeFrontmatter('# Body only\n', [{ key: 'title', value: 'New' }]);
  const r = parseFrontmatter(out);
  ok(r.hasFrontmatter && r.data.title === 'New', 'block created');
  eq(r.body, '# Body only\n', 'original body preserved when adding block');
}

// BOM preserved on serialize
ok(serializeFrontmatter('﻿---\ntitle: X\n---\nb\n', [{ key: 'title', value: 'Y' }]).startsWith('﻿'), 'BOM preserved');

// key order preserved as given
{
  const out = serializeFrontmatter('---\na: 1\nb: 2\n---\n', [{ key: 'b', value: 2 }, { key: 'a', value: 1 }]);
  const idxB = out.indexOf('b:');
  const idxA = out.indexOf('a:');
  ok(idxB < idxA, 'reordered keys serialize in given order');
}

// large frontmatter falls back to raw
{
  const big = '---\n' + 'x: ' + 'a'.repeat(70 * 1024) + '\n---\nbody\n';
  const r = parseFrontmatter(big);
  ok(r.hasFrontmatter && !r.valid, 'oversized frontmatter → invalid/raw fallback');
}

console.log(`✓ frontmatter: ${passed} assertions passed`);
