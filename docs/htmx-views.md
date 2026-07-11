# HTMX views

HTMX views let users build custom local interfaces — dashboards, trackers,
browsers, forms — as plain `.nhtml` files: ordinary HTML with
[htmx](https://htmx.org) attributes, rendered in an isolated tab and talking to
a token-authenticated loopback API. Every view is treated as **untrusted
content**; every filesystem operation is **privileged and policy-checked**.

## User guide

### Creating a view

- Command palette → **New HTMX view in current folder** (default `Ctrl+G`),
  or create any file ending in `.nhtml`.
- Opening the file renders the view tab. The **Source** toggle in the tab
  header edits the same file as text; saving reloads only that tab.
- Starter templates are scaffolded into `.neuron/templates/` the first time a
  view opens (dashboard, note browser, file list) — copy one to get going.

### Writing a view

A view file is HTML **body content** (no `<html>`/`<head>` needed). Neuron
wraps it, injects the bundled htmx runtime and the `neuron.css` design-system
stylesheet, and serves it. Use htmx attributes for interactivity:

```html
<section id="summary" class="neuron-grid cols-3"
         hx-get="/api/v1/fragments/workspace-summary"
         hx-trigger="load" hx-swap="innerHTML">
  <div class="neuron-card">Loading…</div>
</section>

<section class="neuron-card">
  <form hx-get="/api/v1/search" hx-target="#search-results"
        hx-trigger="submit, input changed delay:300ms from:#query">
    <label for="query">Search notes</label>
    <input id="query" class="neuron-input" name="query" type="search" autocomplete="off" />
  </form>
  <div id="search-results"></div>
</section>
```

No token handling is required — authentication is injected by Neuron at
runtime (an HttpOnly session cookie scoped to the view's isolated partition).
Never paste tokens into view source; there is nothing to paste.

Design-system classes: `neuron-card`, `neuron-button` (+ `.secondary`),
`neuron-input`, `neuron-table`, `neuron-badge`, `neuron-stack`,
`neuron-grid` (+ `cols-2/3/4`), `neuron-toolbar`, `neuron-alert`,
`neuron-empty`, `neuron-metric`, `neuron-metric-label`, `neuron-list`.
They follow the app's light/dark theme automatically.

`{{ variables.name }}` in a view or fragment is replaced server-side with the
variable's value, always HTML-escaped. It is a key lookup, not an expression
language — no code, no prototypes, unknown keys render as nothing.

### The `.neuron` folder

```
.neuron/
  config.json        # feature config (schema version)
  variables.json     # typed variables exposed to views
  fragments/         # reusable HTML partials → GET /api/v1/fragments/<name>
  styles/            # optional CSS; "My view.nhtml" auto-loads "My view.css"
  templates/         # starter views to copy
  layout.json        # (pre-existing) workspace shell layout
```

Everything is plain text and safe to edit in Neuron. Files are created lazily
and never overwritten. `variables.json`:

```json
{
  "version": 1,
  "variables": {
    "dashboardTitle": { "type": "string", "value": "My Dashboard", "writable": false },
    "projectStatus":  { "type": "string", "value": "active", "writable": true }
  }
}
```

Custom CSS is local-only: `@import` and remote `url()` references are blocked.

### Manifests and permissions

Views are **read-only by default** (read files/notes/tags/variables, search,
list). To write, add a manifest next to the view — `projects.nhtml` →
`projects.neuron.json`:

```json
{
  "name": "Projects",
  "version": "1.0.0",
  "description": "Tracks project status.",
  "permissions": ["workspace.files.read", "workspace.files.write", "variables.read"],
  "allowedReadPaths": ["Projects/**"],
  "allowedWritePaths": [".neuron/data/projects.json"],
  "networkPolicy": "none"
}
```

- Capabilities: `workspace.files.read`, `workspace.files.write`,
  `workspace.files.create`, `workspace.files.delete`,
  `workspace.directories.list`, `workspace.search`, `notes.read`, `tags.read`,
  `variables.read`, `variables.write`.
- Unknown manifest fields and unknown permissions are **rejected**, not
  ignored. `networkPolicy` accepts only `"none"` — views cannot reach the
  network at all.
- Write capabilities trigger an approval dialog (**Allow for this view** /
  **Allow once**). Approvals are stored in Neuron's protected application
  settings — never in the workspace — and are bound to the manifest's content
  hash: any manifest edit re-requests approval.
- Reset a view's approval with `htmxViews.resetApproval` (exposed for the
  permission card) or by editing the manifest.

### API routes (`/api/v1`)

| Route | Cap | Returns |
| --- | --- | --- |
| `GET /context` | — | view, workspace, theme, granted capabilities, API version |
| `GET /variables`, `GET /variables/:key` | `variables.read` | variable definitions/values |
| `PUT /variables/:key` | `variables.write` | updates a `writable: true` variable (type-checked) |
| `GET /files?dir&glob&limit` | `workspace.directories.list` | file listing (JSON, or HTML for htmx) |
| `GET /files/content?path` | `workspace.files.read` | `{path, content, hash}` (≤ 2 MB, read-path-checked) |
| `PUT /files/content` | `workspace.files.write` | atomic write; `baseHash` mismatch → 409 conflict |
| `POST /files` | `workspace.files.create` | creates; 409 if the file exists |
| `DELETE /files?path` | `workspace.files.delete` | deletes within write paths |
| `GET /search?query` | `workspace.search` | note matches (HTML fragment for htmx requests) |
| `GET /notes?tag&folder&limit` | `notes.read` | note metadata (HTML table for htmx) |
| `GET /tags` | `tags.read` | tag list (HTML badges for htmx) |
| `GET /fragments/:name?params…` | — | rendered fragment from `.neuron/fragments` |

Responses are HTML fragments when the request carries htmx's `HX-Request`
header, JSON otherwise. Errors are structured
(`{error: {code, message, requestId}}` or a `.neuron-alert` fragment) and never
include stack traces, absolute paths, tokens, or internals.

There is deliberately **no** `/execute`, `/ipc`, `/command`, or generic
filesystem proxy. Every route is explicitly implemented, validated,
capability-checked, and rate-limited.

## Maintainer guide

### Modules (`src/main/htmx/`)

| Module | Responsibility |
| --- | --- |
| `server.ts` | Loopback HTTP server, routing, API handlers, resource limits. Electron-free. |
| `sessions.ts` | Session + token lifecycle (one-time boot token, cookie token, constant-time compare, TTL, rate bucket). |
| `pathPolicy.ts` | Glob compilation, relative-path normalization, canonical resolution, symlink-escape rejection. |
| `manifest.ts` | Manifest / variables / capability validation (strict, unknown-key-rejecting). |
| `html.ts` | Escaping, limited `{{ }}` interpolation, document wrapper, fragment renderers. |
| `theme.ts` | The `neuron.css` string served to views. |
| `index.ts` | Electron wiring: IPC (`htmx-views:open/approve/close/reset-approval`), approval store, `.neuron` scaffolding, server lifecycle. |

Renderer: `src/renderer/surfaces/HtmxViewSurface.tsx` (the tab — loading /
permission / error / crashed states, `<webview>` host). Registered for
`nhtml` in the generic surface registry.

### Server and session lifecycle

- The server starts lazily on the first view open, binds **only** to
  `127.0.0.1` on an **ephemeral port**, and dies with the app. Workspace
  switches revoke all sessions (`revokeAllViewSessions`).
- Opening a view creates a session bound to (workspace root, view path,
  capability set, compiled path policies, theme). The renderer gets a URL
  `…/views/{sessionId}/document?boot={oneTimeToken}`.
- The first document request consumes the boot token and sets an
  `HttpOnly; SameSite=Strict` cookie `nv={sessionId}:{cookieToken}`. All later
  requests (htmx XHR, stylesheets, htmx.js) authenticate with that cookie.
- Each tab's `<webview>` uses a **per-session in-memory partition**
  (`view-{sessionId}`): cookies and storage are isolated per view, so one view
  can never present another view's token, and nothing persists after close.
- Closing the tab revokes the session; tokens also expire after 12 h.
  Localhost is **not** treated as an authentication boundary — every request
  must present a valid session token, and the Host header must match the
  server origin (DNS-rebinding guard).

A custom `neuron-view://` protocol was considered; a loopback HTTP server was
chosen because htmx needs real HTTP verbs (GET/POST/PUT/DELETE), standard
form encoding, and cookie semantics. The tradeoff — other local processes can
connect to the port — is mitigated by the unguessable per-view tokens.

### Rendering isolation

- Views render in Electron `<webview>`s. Main enforces on every web-contents
  (`will-attach-webview`): no preload, no Node, context isolation + sandbox
  on. Permission requests (camera, mic, …) are denied.
- View documents get a strict CSP:
  `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none';
  object-src 'none'; frame-src 'none'` — no remote scripts, no inline or
  user-authored script execution (the only `'self'` script is the bundled
  htmx runtime; `X-Content-Type-Options: nosniff` stops mime confusion).
- Main-process guards pin view webviews to the server origin: navigation off
  the origin is blocked, `window.open` is denied outright (not even handed to
  the OS browser — popups are an exfiltration channel).
- htmx 2 defaults to `selfRequestsOnly`; CSP `connect-src 'self'` enforces the
  same at the platform level.

### Adding an API endpoint safely

1. Add the route in `server.ts:serveApi` with an explicit method match.
2. Gate it with `requireCap(ctx, '…')` — add a new capability to
   `manifest.ts` if none fits (never widen an existing one).
3. Resolve any path through `checkedPath(ctx, raw, 'read'|'write')` — never
   `path.join` user input directly.
4. Build HTML through the `html.ts` helpers (`esc` everything); JSON via
   `sendJson`. Errors via `fail(ctx, status, code, safeMessage)`.
5. Respect the resource ceilings at the top of `server.ts`; add one if the
   route can amplify work.
6. Add unit/integration assertions in `tools/htmx-views.test.mjs`.

## Threat model

| Threat | Mitigation |
| --- | --- |
| Arbitrary file read/write | Default-deny capabilities; per-view glob path policies; canonical resolution against the workspace root only |
| Path traversal (`..`, encoded, absolute, drive letters, UNC, `~`, null bytes) | `normalizeRel` rejects them all before resolution; post-resolution containment check |
| Symlink/junction escape | Deepest existing ancestor is `realpath`ed and must remain inside the canonical root; the workspace walker never follows symlinks |
| Overwriting concurrent edits | `baseHash` optimistic concurrency → 409; atomic temp-file+rename writes |
| Deleting files | Separate `workspace.files.delete` capability + write-path policy + approval dialog |
| Localhost service probing / SSRF from a view | CSP `connect-src 'self'`; htmx self-requests only; navigation + popups blocked in main |
| CSRF from a browser page against the loopback port | Token cookie lives only inside the view's isolated partition; `SameSite=Strict`; Origin header rejected when foreign |
| Token theft | HttpOnly cookie (invisible to page content); boot token is one-time; tokens never logged, never in view files, never persisted |
| Cross-view access | Unguessable session ids; per-view cookie comparison; `/views/{sid}/*` requires the cookie's session to match `sid`; per-view partitions |
| XSS / HTML injection in fragments | All server-rendered values pass through `esc()`; interpolation is escaped key-lookup only; no string-concatenated HTML |
| Prototype pollution via `{{ }}` or JSON | `__proto__`/`constructor`/`prototype` lookups blocked; own-property checks; strict schema validation with unknown-key rejection |
| Malicious CSS | Local files only, size-capped, `@import`/remote `url()` blocked; view renders in its own webview so it cannot restyle or impersonate Neuron UI |
| Unsafe URLs / unrestricted navigation | CSP + main-process `will-navigate` guard pinned to the view origin; `window.open` denied |
| Remote exfiltration | No network capability exists; `networkPolicy` accepts only `"none"`; CSP blocks all remote loads |
| Request floods / accidental htmx loops | Per-session token bucket (burst 30, ~15 rps) → 429; body ≤ 1 MB; file reads ≤ 2 MB; listings ≤ 500; walk budget 20 000; search capped |
| Hostile configuration files | `variables.json`/manifests validated with versioned schemas; invalid config fails closed with diagnostics |
| DNS rebinding | Exact Host-header check against the loopback origin |
| Manifest self-escalation | Manifests only *request*; write grants require user approval bound to the manifest hash; approvals live in app settings, not the workspace |
| View impersonation after edit | Manifest hash change invalidates prior approval; source/manifest changes reload the tab with a fresh session |

Known limitations (deliberate, documented): no user-scripting capability (no
trusted-script mode yet), no remote-content capability, no
`commands.execute`/actions bridge, search is a bounded workspace scan rather
than an index, and the request inspector devtool is not built — the standard
webview devtools plus server error codes cover debugging today.
