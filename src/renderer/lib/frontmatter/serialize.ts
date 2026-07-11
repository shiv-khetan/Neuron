// Serialize edited properties back into a document, changing ONLY the
// frontmatter block. The body is spliced back byte-for-byte; EOL, BOM and the
// trailing-newline style are preserved. Comments on untouched keys survive
// because we mutate the original YAML Document rather than rebuilding it.

import { parseDocument, isMap, YAMLMap } from 'yaml';
import { parseFrontmatter } from './parse';

const BOM = '﻿';

export interface FrontmatterEntry {
  key: string;
  value: unknown; // normalized JS value (string | number | boolean | array | null)
}

export interface SerializeOptions {
  removeEmpty?: boolean; // when no properties remain, drop the block (default true)
}

function equalValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => equalValue(v, b[i]));
  }
  return false;
}

// Reorder a YAMLMap's pairs to match the desired key order (keys not listed
// keep their relative order at the end).
function reorder(map: YAMLMap, order: string[]): void {
  const index = new Map(order.map((k, i) => [k, i]));
  map.items.sort((a, b) => {
    const ai = index.get(String((a.key as { value?: unknown })?.value)) ?? Number.MAX_SAFE_INTEGER;
    const bi = index.get(String((b.key as { value?: unknown })?.value)) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
}

export function serializeFrontmatter(
  original: string,
  entries: FrontmatterEntry[],
  options: SerializeOptions = {},
): string {
  const { removeEmpty = true } = options;
  const parsed = parseFrontmatter(original);
  const { body, eol, hadBOM, data } = parsed;
  const bom = hadBOM ? BOM : '';

  // No properties left → optionally strip the whole block.
  if (entries.length === 0) {
    if (removeEmpty) return bom + body;
    return `${bom}---${eol}---${eol}${body}`;
  }

  // Start from the existing YAML so comments/anchors on untouched keys survive.
  const doc = parsed.hasFrontmatter && parsed.valid
    ? parseDocument(parsed.raw || '', { schema: 'core' })
    : parseDocument('', { schema: 'core' });
  // A freshly-built YAMLMap isn't a "Parsed" node, so assign through a loose view.
  if (!isMap(doc.contents)) (doc as { contents: unknown }).contents = new YAMLMap();
  const map = doc.contents as YAMLMap;

  const wanted = new Set(entries.map((e) => e.key));
  for (const item of [...map.items]) {
    const k = String((item.key as { value?: unknown })?.value);
    if (!wanted.has(k)) map.delete(k);
  }

  for (const { key, value } of entries) {
    // Leave the original node untouched when the value is unchanged — this is
    // what preserves per-key comments and the user's scalar-vs-list style.
    if (map.has(key) && equalValue(value, data[key])) continue;
    doc.set(key, value as never);
  }

  reorder(map, entries.map((e) => e.key));

  // lineWidth:0 disables line wrapping so long values are never reflowed.
  let yamlText = doc.toString({ lineWidth: 0 }).replace(/\n$/, '');
  if (eol === '\r\n') yamlText = yamlText.replace(/\r?\n/g, '\r\n');

  return `${bom}---${eol}${yamlText}${eol}---${eol}${body}`;
}
