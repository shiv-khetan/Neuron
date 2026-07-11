// Typed model for document frontmatter (properties). Framework-free so the
// parser/serializer can be reused by the preview renderer, the live editor,
// and any future search index.

export type PropertyType =
  | 'text'
  | 'multiline'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'tags'
  | 'aliases'
  | 'list'
  | 'link'
  | 'unknown';

// A single frontmatter key/value, normalized for display and editing. The raw
// value is retained so we never lose data we can't visually edit.
export interface DocumentProperty {
  key: string;            // stable + original key (YAML keys are case-sensitive)
  label: string;          // human label derived from key
  type: PropertyType;
  value: unknown;         // normalized JS value (string, number, boolean, string[]…)
  editable: boolean;      // false for nested objects / unsupported shapes
}

export interface FrontmatterDiagnostic {
  level: 'error' | 'warning';
  message: string;
}

// Result of parsing a document's leading frontmatter block. When the block
// exists but is invalid, `valid` is false and `data`/`properties` are empty —
// callers must fall back to raw editing and never serialize over the source.
export interface ParsedFrontmatter {
  hasFrontmatter: boolean;
  valid: boolean;
  raw: string;                 // frontmatter text between the --- delimiters
  data: Record<string, unknown>;
  properties: DocumentProperty[];
  body: string;                // document content after the frontmatter block
  bodyStart: number;           // char offset in the ORIGINAL text where body begins
  eol: '\n' | '\r\n';
  hadBOM: boolean;
  endsWithNewline: boolean;
  diagnostics: FrontmatterDiagnostic[];
}

// Guardrails against pathological / malicious frontmatter (fall back to raw).
export const LIMITS = {
  maxBytes: 64 * 1024,
  maxKeys: 200,
  maxDepth: 8,
  maxStringLength: 100_000,
  maxArrayLength: 5000,
};

// Keys that must never be written onto a plain object (prototype pollution).
export const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
