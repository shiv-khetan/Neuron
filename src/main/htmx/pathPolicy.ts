// Path policy for HTMX views: every filesystem operation a view requests is
// resolved and checked here. Workspace-relative paths only; traversal,
// absolute paths, drive letters, null bytes, and symlink escapes are rejected.
// Electron-free so tests can run it in plain Node.

import * as path from 'path';
import * as fs from 'fs';

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

/** Compile a manifest glob (`Projects/**`, `*.md`, `data/?.csv`) to an anchored RegExp. */
export function compileGlob(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
        if (pattern[i + 1] === '/') i++; // `**/` also matches zero directories
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`, CASE_INSENSITIVE ? 'i' : '');
}

export function compilePolicy(patterns: string[]): RegExp[] {
  return patterns.map(compileGlob);
}

export function policyAllows(policy: RegExp[], relPath: string): boolean {
  return policy.some((re) => re.test(relPath));
}

/**
 * Normalize an untrusted workspace-relative path to posix form, or null if it
 * is not a plain relative path (absolute, drive-lettered, UNC, traversal,
 * home shortcut, null byte, or empty after normalization).
 */
export function normalizeRel(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 1024) return null;
  if (input.includes('\0') || input.includes('%00')) return null;
  const p = input.replace(/\\/g, '/');
  if (p.startsWith('~') || path.isAbsolute(p) || /^[a-zA-Z]:/.test(p) || p.startsWith('//')) return null;
  const segments: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null; // no traversal, even if it would stay inside
    segments.push(seg);
  }
  if (segments.length === 0) return null;
  return segments.join('/');
}

/** Like normalizeRel but '' (the workspace root) is allowed — for directory listings. */
export function normalizeRelDir(input: unknown): string | null {
  if (input === '' || input === '.' || input === undefined || input === null) return '';
  return normalizeRel(input);
}

/** Real path of the deepest existing ancestor (for symlink-escape detection). */
function realExistingAncestor(fullPath: string): string {
  let cur = fullPath;
  for (;;) {
    if (fs.existsSync(cur)) return fs.realpathSync(cur);
    const parent = path.dirname(cur);
    if (parent === cur) return cur;
    cur = parent;
  }
}

export interface ResolvedPath {
  /** Absolute filesystem path. */
  full: string;
  /** Normalized posix workspace-relative path (what policies match against). */
  rel: string;
}

/**
 * Resolve an untrusted relative path against the workspace root. Returns null
 * unless the canonical target (following symlinks on every existing ancestor)
 * stays inside the canonical root.
 */
export function resolveInWorkspace(root: string, input: unknown, opts: { allowRootDir?: boolean } = {}): ResolvedPath | null {
  const rel = opts.allowRootDir ? normalizeRelDir(input) : normalizeRel(input);
  if (rel === null) return null;
  const realRoot = fs.realpathSync(root);
  const full = path.resolve(realRoot, rel.split('/').join(path.sep));
  const back = path.relative(realRoot, full);
  if (back.startsWith('..') || path.isAbsolute(back)) return null;
  // Symlink / junction escape: canonicalize the deepest existing ancestor and
  // require it to still be under the canonical root.
  const real = realExistingAncestor(full);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
  return { full, rel };
}
