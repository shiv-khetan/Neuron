// Value → property-type inference and special-key handling. Kept independent
// of the YAML library so it can run on plain parsed data.

import type { DocumentProperty, PropertyType } from './types';
import { DANGEROUS_KEYS, LIMITS } from './types';

// Keys given first-class treatment. Everything else is still fully supported —
// this only nudges the inferred editor control.
const TAG_KEYS = new Set(['tags', 'tag']);
const ALIAS_KEYS = new Set(['aliases', 'alias']);
const LIST_KEYS = new Set(['cssclasses', 'cssclass']);
const DATE_KEYS = new Set(['created', 'updated', 'date', 'due']);
const BOOL_KEYS = new Set(['completed']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
// Obsidian-style internal reference: [[Note name]]
const WIKILINK_RE = /^\[\[[^\]]+\]\]$/;

export function labelFor(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Normalize a tags/aliases value: YAML permits either a scalar ("a b") or a
// list. We store a string[] internally and never force a `#` prefix.
export function normalizeStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((v) => v.length > 0);
  if (typeof value === 'string') return value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return [String(value)];
}

function inferType(key: string, value: unknown): PropertyType {
  const lower = key.toLowerCase();
  if (TAG_KEYS.has(lower)) return 'tags';
  if (ALIAS_KEYS.has(lower)) return 'aliases';
  if (BOOL_KEYS.has(lower) && typeof value === 'boolean') return 'boolean';

  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (value instanceof Date) return 'datetime';
  if (Array.isArray(value)) {
    return LIST_KEYS.has(lower) || ALIAS_KEYS.has(lower) ? 'aliases' : 'list';
  }
  if (typeof value === 'string') {
    if (DATE_KEYS.has(lower) && DATE_RE.test(value)) return 'date';
    if (DATETIME_RE.test(value)) return 'datetime';
    if (DATE_RE.test(value)) return 'date';
    if (WIKILINK_RE.test(value)) return 'link';
    if (value.includes('\n')) return 'multiline';
    if (value.length > 120) return 'multiline';
    return 'text';
  }
  // null, nested objects, or anything structured: keep, but read-only.
  return 'unknown';
}

// A value is directly editable in the visual panel unless it's a nested object
// or an oversized structure we'd rather not corrupt.
function isEditable(type: PropertyType, value: unknown): boolean {
  if (type === 'unknown') return false;
  if (Array.isArray(value)) {
    if (value.length > LIMITS.maxArrayLength) return false;
    return value.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
  }
  return true;
}

export function toProperty(key: string, value: unknown): DocumentProperty {
  const type = inferType(key, value);
  let normalized: unknown = value;
  if (type === 'tags' || type === 'aliases') normalized = normalizeStringList(value);
  return {
    key,
    label: labelFor(key),
    type,
    value: normalized,
    editable: isEditable(type, normalized),
  };
}

// Build the ordered property list from parsed data, preserving key order.
export function toProperties(data: Record<string, unknown>): DocumentProperty[] {
  return Object.keys(data)
    .filter((k) => !DANGEROUS_KEYS.has(k))
    .map((k) => toProperty(k, data[k]));
}
