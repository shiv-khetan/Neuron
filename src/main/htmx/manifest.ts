// Manifest, config, and variables validation for HTMX views. Strict: unknown
// keys are rejected (never silently ignored), permissions must come from the
// known capability list, and network access is not grantable at all.

export const READ_CAPS = [
  'workspace.files.read',
  'workspace.directories.list',
  'workspace.search',
  'notes.read',
  'tags.read',
  'variables.read',
] as const;

export const WRITE_CAPS = [
  'workspace.files.write',
  'workspace.files.create',
  'workspace.files.delete',
  'variables.write',
] as const;

export const ALL_CAPS: readonly string[] = [...READ_CAPS, ...WRITE_CAPS];

export interface ViewManifest {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  icon?: string;
  permissions: string[];
  allowedReadPaths: string[];
  allowedWritePaths: string[];
  networkPolicy: 'none';
  themeMode?: 'light' | 'dark' | 'system';
}

const MANIFEST_KEYS = new Set([
  'id', 'name', 'version', 'description', 'icon', 'permissions',
  'allowedReadPaths', 'allowedWritePaths', 'networkPolicy', 'themeMode',
]);

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function stringArray(v: unknown, field: string, errors: string[]): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    errors.push(`"${field}" must be an array of strings.`);
    return [];
  }
  return v as string[];
}

export function validateManifest(raw: unknown): ValidationResult<ViewManifest> {
  const errors: string[] = [];
  if (!isPlainObject(raw)) return { ok: false, errors: ['Manifest must be a JSON object.'] };

  for (const key of Object.keys(raw)) {
    if (!MANIFEST_KEYS.has(key)) errors.push(`Unknown manifest field "${key}" — remove it (unknown fields are rejected, not ignored).`);
  }

  const permissions = stringArray(raw.permissions, 'permissions', errors);
  for (const p of permissions) {
    if (!ALL_CAPS.includes(p)) errors.push(`Unknown permission "${p}". Known: ${ALL_CAPS.join(', ')}.`);
  }

  const allowedReadPaths = stringArray(raw.allowedReadPaths, 'allowedReadPaths', errors);
  const allowedWritePaths = stringArray(raw.allowedWritePaths, 'allowedWritePaths', errors);
  for (const p of [...allowedReadPaths, ...allowedWritePaths]) {
    if (p.includes('..') || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.includes('\\')) {
      errors.push(`Path pattern "${p}" must be workspace-relative with forward slashes and no "..".`);
    }
  }

  if (raw.networkPolicy !== undefined && raw.networkPolicy !== 'none') {
    errors.push('"networkPolicy" only supports "none" — HTMX views cannot access the network.');
  }
  if (raw.themeMode !== undefined && !['light', 'dark', 'system'].includes(raw.themeMode as string)) {
    errors.push('"themeMode" must be "light", "dark", or "system".');
  }
  for (const field of ['id', 'name', 'version', 'description', 'icon'] as const) {
    if (raw[field] !== undefined && typeof raw[field] !== 'string') errors.push(`"${field}" must be a string.`);
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors,
    value: {
      id: raw.id as string | undefined,
      name: raw.name as string | undefined,
      version: raw.version as string | undefined,
      description: raw.description as string | undefined,
      icon: raw.icon as string | undefined,
      permissions,
      allowedReadPaths,
      allowedWritePaths,
      networkPolicy: 'none',
      themeMode: raw.themeMode as ViewManifest['themeMode'],
    },
  };
}

/** Effective grants for a view: manifest is optional; defaults are read-only. */
export function effectiveGrants(manifest: ViewManifest | null): {
  caps: Set<string>;
  readPatterns: string[];
  writePatterns: string[];
  needsApproval: boolean;
} {
  if (!manifest) {
    return { caps: new Set(READ_CAPS), readPatterns: ['**'], writePatterns: [], needsApproval: false };
  }
  const caps = new Set(manifest.permissions);
  const wantsWrite = manifest.permissions.some((p) => (WRITE_CAPS as readonly string[]).includes(p));
  return {
    caps,
    readPatterns: manifest.allowedReadPaths.length ? manifest.allowedReadPaths : ['**'],
    writePatterns: manifest.allowedWritePaths,
    needsApproval: wantsWrite,
  };
}

// --- .neuron/variables.json --------------------------------------------------

export type VariableType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface VariableDef {
  type: VariableType;
  value: unknown;
  writable: boolean;
  description?: string;
}

const VARIABLE_KEYS = new Set(['type', 'value', 'writable', 'description']);
const VAR_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function typeOk(type: VariableType, value: unknown): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return isPlainObject(value);
  }
}

export function validateVariablesFile(raw: unknown): ValidationResult<Record<string, VariableDef>> {
  const errors: string[] = [];
  if (!isPlainObject(raw)) return { ok: false, errors: ['variables.json must be a JSON object.'] };
  if (raw.version !== 1) errors.push('variables.json "version" must be 1.');
  const vars = raw.variables;
  const out: Record<string, VariableDef> = {};
  if (vars !== undefined) {
    if (!isPlainObject(vars)) {
      errors.push('"variables" must be an object.');
    } else {
      for (const [name, def] of Object.entries(vars)) {
        if (!VAR_NAME.test(name)) { errors.push(`Variable name "${name}" is invalid (letters, digits, _ and -, max 64).`); continue; }
        if (!isPlainObject(def)) { errors.push(`Variable "${name}" must be an object.`); continue; }
        for (const k of Object.keys(def)) if (!VARIABLE_KEYS.has(k)) errors.push(`Variable "${name}" has unknown field "${k}".`);
        const type = def.type as VariableType;
        if (!['string', 'number', 'boolean', 'array', 'object'].includes(type)) { errors.push(`Variable "${name}" has invalid type.`); continue; }
        if (!typeOk(type, def.value)) { errors.push(`Variable "${name}" value does not match type "${type}".`); continue; }
        out[name] = { type, value: def.value, writable: def.writable === true, description: typeof def.description === 'string' ? def.description : undefined };
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors, value: out };
}
