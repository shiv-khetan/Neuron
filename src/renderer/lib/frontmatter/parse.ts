// Frontmatter detection + safe YAML parsing. Framework-free.
//
// A block counts as frontmatter ONLY when it is at the very start of the file
// (an optional UTF-8 BOM is allowed) and both delimiters are a bare `---` line.
// Horizontal rules elsewhere in the document are never treated as frontmatter.

import { parse as parseYaml } from 'yaml';
import type { ParsedFrontmatter, FrontmatterDiagnostic } from './types';
import { DANGEROUS_KEYS, LIMITS } from './types';
import { toProperties } from './inference';

const BOM = '﻿';

function detectEol(text: string): '\n' | '\r\n' {
  const i = text.indexOf('\n');
  if (i > 0 && text[i - 1] === '\r') return '\r\n';
  return '\n';
}

// Reject prototype-pollution keys and enforce structural limits. Returns a
// sanitized clone (plain objects only) or throws on limit violation.
function sanitize(value: unknown, depth: number, counter: { keys: number }): unknown {
  if (depth > LIMITS.maxDepth) throw new Error('Frontmatter nesting is too deep.');
  if (typeof value === 'string' && value.length > LIMITS.maxStringLength) {
    throw new Error('A frontmatter string is too large.');
  }
  if (Array.isArray(value)) {
    if (value.length > LIMITS.maxArrayLength) throw new Error('A frontmatter list is too large.');
    return value.map((v) => sanitize(v, depth + 1, counter));
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(k)) continue; // drop dangerous keys entirely
      if (++counter.keys > LIMITS.maxKeys) throw new Error('Too many frontmatter keys.');
      out[k] = sanitize(v, depth + 1, counter);
    }
    return out;
  }
  return value;
}

const EMPTY = (text: string): ParsedFrontmatter => {
  const hadBOM = text.startsWith(BOM);
  return {
    hasFrontmatter: false,
    valid: true,
    raw: '',
    data: {},
    properties: [],
    body: text,
    bodyStart: 0,
    eol: detectEol(text),
    hadBOM,
    endsWithNewline: /\r?\n$/.test(text),
    diagnostics: [],
  };
};

export function parseFrontmatter(input: string): ParsedFrontmatter {
  if (typeof input !== 'string' || input.length === 0) return EMPTY(input ?? '');

  const hadBOM = input.startsWith(BOM);
  const text = hadBOM ? input.slice(BOM.length) : input;
  const eol = detectEol(text);
  const endsWithNewline = /\r?\n$/.test(input);

  // Opening delimiter must be the first line and a bare `---`.
  const firstBreak = text.indexOf('\n');
  const firstLine = (firstBreak === -1 ? text : text.slice(0, firstBreak)).replace(/\r$/, '');
  if (firstLine.trim() !== '---') return EMPTY(input);
  if (firstBreak === -1) return EMPTY(input); // `---` with no newline is not a block

  // Scan for the closing `---` line.
  const lines = text.split('\n');
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, '').trim() === '---') { closeIdx = i; break; }
  }
  if (closeIdx === -1) return EMPTY(input); // unterminated → not frontmatter

  const rawLines = lines.slice(1, closeIdx).map((l) => l.replace(/\r$/, ''));
  const raw = rawLines.join('\n');

  // Char offset in the ORIGINAL input where the body begins. Splitting on '\n'
  // keeps any '\r' inside each line, so joining the remainder back reproduces
  // it exactly for both LF and CRLF files.
  const remainder = lines.slice(closeIdx + 1).join('\n');
  const bodyStart = (hadBOM ? BOM.length : 0) + (text.length - remainder.length);
  const body = input.slice(bodyStart);

  const diagnostics: FrontmatterDiagnostic[] = [];

  if (raw.length > LIMITS.maxBytes) {
    diagnostics.push({ level: 'error', message: 'Frontmatter is too large to edit visually.' });
    return { hasFrontmatter: true, valid: false, raw, data: {}, properties: [], body, bodyStart, eol, hadBOM, endsWithNewline, diagnostics };
  }

  let data: Record<string, unknown> = {};
  try {
    // `core` schema: JSON-ish types only, no custom tags / arbitrary objects.
    const parsed = parseYaml(raw === '' ? '' : raw, { schema: 'core', prettyErrors: false });
    if (parsed == null) {
      data = {};
    } else if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      diagnostics.push({ level: 'error', message: 'Frontmatter must be a set of key/value properties.' });
      return { hasFrontmatter: true, valid: false, raw, data: {}, properties: [], body, bodyStart, eol, hadBOM, endsWithNewline, diagnostics };
    } else {
      data = sanitize(parsed, 0, { keys: 0 }) as Record<string, unknown>;
    }
  } catch (err) {
    diagnostics.push({ level: 'error', message: err instanceof Error ? err.message : 'Invalid YAML frontmatter.' });
    return { hasFrontmatter: true, valid: false, raw, data: {}, properties: [], body, bodyStart, eol, hadBOM, endsWithNewline, diagnostics };
  }

  return {
    hasFrontmatter: true,
    valid: true,
    raw,
    data,
    properties: toProperties(data),
    body,
    bodyStart,
    eol,
    hadBOM,
    endsWithNewline,
    diagnostics,
  };
}
