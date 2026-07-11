// Safe HTML helpers for server-rendered fragments. All untrusted text goes
// through esc(); fragments are built from these helpers, never from raw
// string concatenation of user data.

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * Deliberately limited `{{ scope.key }}` interpolation for fragments: safe own-
 * property lookup only (no expressions, no prototypes), result HTML-escaped.
 */
export function interpolate(template: string, scopes: Record<string, Record<string, unknown>>): string {
  return template.replace(/\{\{\s*([A-Za-z][\w-]*(?:\.[\w-]+)*)\s*\}\}/g, (_m, expr: string) => {
    const parts = expr.split('.');
    let cur: unknown = scopes;
    for (const part of parts) {
      if (part === '__proto__' || part === 'constructor' || part === 'prototype') return '';
      if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, part)) return '';
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur === null || cur === undefined) return '';
    if (typeof cur === 'object') return esc(JSON.stringify(cur));
    return esc(cur);
  });
}

/** Wrap a user-authored .nhtml body in the full served document. */
export function wrapDocument(opts: { body: string; title: string; sessionId: string; theme: 'light' | 'dark'; styles: string[] }): string {
  const base = `/views/${opts.sessionId}`;
  const styleLinks = opts.styles
    .map((name) => `  <link rel="stylesheet" href="${base}/styles/${esc(name)}">`)
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)}</title>
  <link rel="stylesheet" href="${base}/neuron.css">
${styleLinks}
  <script src="${base}/htmx.js" defer></script>
</head>
<body class="neuron-view theme-${opts.theme}">
${opts.body}
</body>
</html>`;
}

export function errorFragment(message: string): string {
  return `<div class="neuron-alert" role="alert">${esc(message)}</div>`;
}

export interface FileRow { path: string; name: string; size: number; modified: string; directory: boolean }

export function fileListFragment(rows: FileRow[]): string {
  if (rows.length === 0) return '<p class="neuron-empty">No matching files.</p>';
  const items = rows
    .map((r) => `<li class="neuron-list-row"><span class="neuron-file-name">${esc(r.name)}</span><span class="neuron-file-path">${esc(r.path)}</span></li>`)
    .join('\n');
  return `<ul class="neuron-list">\n${items}\n</ul>`;
}

export interface SearchRow { path: string; title: string; snippet: string }

export function searchResultsFragment(rows: SearchRow[], query: string): string {
  if (!query) return '';
  if (rows.length === 0) return `<p class="neuron-empty">No notes match “${esc(query)}”.</p>`;
  const items = rows
    .map((r) => `<li class="neuron-list-row"><span class="neuron-file-name">${esc(r.title)}</span><span class="neuron-snippet">${esc(r.snippet)}</span><span class="neuron-file-path">${esc(r.path)}</span></li>`)
    .join('\n');
  return `<ul class="neuron-list">\n${items}\n</ul>`;
}

export interface NoteRow { path: string; title: string; tags: string[]; modified: string }

export function noteRowsFragment(rows: NoteRow[]): string {
  if (rows.length === 0) return '<p class="neuron-empty">No notes found.</p>';
  const body = rows
    .map((r) => `<tr><td>${esc(r.title)}</td><td>${r.tags.map((t) => `<span class="neuron-badge">${esc(t)}</span>`).join(' ')}</td><td class="neuron-file-path">${esc(r.path)}</td></tr>`)
    .join('\n');
  return `<table class="neuron-table"><thead><tr><th>Note</th><th>Tags</th><th>Path</th></tr></thead><tbody>\n${body}\n</tbody></table>`;
}
