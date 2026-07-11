---
name: neuron-mini-apps
description: Build mini apps (dashboards, trackers, tables, galleries) inside a Neuron workspace using .nhtml HTMX views, .db Notion-style databases, and .canvas boards. Use when asked to create a dashboard, tracker, database, or interactive view in Neuron.
---

# Building mini apps in Neuron

A Neuron **workspace** is a plain folder of files. A mini app is just files in
that folder — no build step, no bundler, no localStorage:

- **`.nhtml` files** — the UI. Plain HTML with [htmx](https://htmx.org)
  attributes, rendered in an isolated view tab against Neuron's local API.
- **`.db` files** — Notion-style databases: typed properties, colored select tags, filters (schema below).
- **`.canvas` files** — infinite whiteboards in the open JSON Canvas format (Obsidian-compatible).
- **`.md`/`.mdx` files** — notes/docs, linkable with `[[wikilinks]]`.
- **`.neuron/` folder** — variables, reusable fragments, styles, templates, and per-view manifests.

## The .nhtml format

A view file is HTML **body content** (no `<html>`/`<head>`). Neuron wraps it,
injects the bundled htmx runtime and the `neuron.css` design system, and
serves it from a loopback server. Auth is automatic (an HttpOnly session
cookie) — never put tokens in the file.

Interactivity comes from htmx attributes (`hx-get`, `hx-post`, `hx-put`,
`hx-delete`, `hx-trigger`, `hx-target`, `hx-swap`, `hx-include`, `hx-vals`)
pointed at `/api/v1/...`. `<script>` never executes (strict CSP), and views
have **no network access** — everything is local.

Design-system classes: `neuron-card`, `neuron-button` (+ `.secondary`),
`neuron-input`, `neuron-table`, `neuron-badge`, `neuron-stack`,
`neuron-grid` (+ `cols-2/3/4`), `neuron-toolbar`, `neuron-alert`,
`neuron-empty`, `neuron-metric`, `neuron-metric-label`, `neuron-list`.
They track the app's light/dark theme. Inline `style` attributes are allowed
for fine-tuning.

`{{ variables.name }}` interpolates a variable from `.neuron/variables.json`,
HTML-escaped. Key lookup only — no expressions.

## API routes

| Route | Purpose |
| --- | --- |
| `GET /api/v1/context` | View, workspace, theme, granted capabilities |
| `GET /api/v1/search?query=…` | Note search (HTML fragment for htmx targets) |
| `GET /api/v1/notes?tag=…&folder=…&limit=…` | Note metadata table |
| `GET /api/v1/tags` | Tag badges |
| `GET /api/v1/files?dir=…&glob=…&limit=…` | File listing |
| `GET /api/v1/files/content?path=…` | Read a file → `{path, content, hash}` |
| `PUT /api/v1/files/content` | Update (`{path, content, baseHash}`; 409 on conflict) |
| `POST /api/v1/files` | Create (`{path, content}`) |
| `DELETE /api/v1/files?path=…` | Delete |
| `GET/PUT /api/v1/variables/:key` | Read / update a writable variable |
| `GET /api/v1/fragments/:name?param=…` | Render `.neuron/fragments/<name>.html` |

GET routes return HTML fragments when called from htmx, JSON otherwise.

## Permissions

Views are **read-only by default**. Writing needs a manifest next to the view
(`Tracker.nhtml` → `Tracker.neuron.json`):

```json
{
  "name": "Tracker",
  "permissions": ["workspace.files.read", "workspace.files.write", "workspace.files.create", "variables.read"],
  "allowedReadPaths": ["data/**"],
  "allowedWritePaths": ["data/**"],
  "networkPolicy": "none"
}
```

Capabilities: `workspace.files.read/write/create/delete`,
`workspace.directories.list`, `workspace.search`, `notes.read`, `tags.read`,
`variables.read/write`. Request the minimum; write permissions show the user
an approval dialog. Unknown fields/permissions are rejected. Scope
`allowedWritePaths` as tightly as possible (ideally one file or folder).

## Recipe: a tracker mini app

`Reading tracker.nhtml`:
```html
<h1>Reading tracker</h1>
<section class="neuron-grid cols-3">
  <div class="neuron-card" hx-get="/api/v1/fragments/workspace-summary" hx-trigger="load" hx-swap="innerHTML">Loading…</div>
  <div class="neuron-card">
    <div class="neuron-metric-label">Status</div>
    <div class="neuron-metric">{{ variables.projectStatus }}</div>
  </div>
  <div class="neuron-card" hx-get="/api/v1/files?dir=books&limit=20" hx-trigger="load" hx-swap="innerHTML">Loading…</div>
</section>

<section class="neuron-card">
  <form hx-get="/api/v1/search" hx-target="#results"
        hx-trigger="submit, input changed delay:300ms from:#q">
    <label for="q">Find a book note</label>
    <input id="q" class="neuron-input" name="query" type="search" autocomplete="off" />
  </form>
  <div id="results"></div>
</section>
```

Pattern: workspace files as state, the view as UI, htmx requests as verbs.
For typed/records data, pair the view with a `.db` file the user edits in its
own tab; the view reads it via `/api/v1/files/content`.

## .db databases (Notion-style)

A `.db` file opens as a fully editable database table. It is one JSON document:

```json
{
  "schema": {
    "order": ["name", "status"],
    "properties": {
      "name": { "name": "Task", "type": "text" },
      "status": {
        "name": "Status", "type": "select",
        "options": [{ "id": "todo", "name": "Todo", "color": "#8b8b8b" }]
      }
    }
  },
  "view": { "sortBy": "name", "sortDir": "asc", "filterProp": null, "filterValue": "" },
  "rows": [{ "id": "r1", "values": { "name": "Ship it", "status": "todo" } }]
}
```

- Property types: `text`, `number`, `checkbox`, `date`, `url`, `select`, `multiselect`.
- `select` values store the option **id**; `multiselect` values store an array of option ids.
- Option `color` is any CSS color (the app palette: `#8b8b8b #a27763 #e28f44 #d9b23c #5aa06c #528fd1 #9a6dd7 #d15796 #dd5c5c`).
- `view` persists sort and filter; the UI writes it back as the user changes them.
- Users can add/rename/retype/reorder/delete properties and options entirely from the GUI — when generating a `.db`, just provide a sensible starting schema and rows.
- The app watches the file: external edits appear live in the open table.

Prefer `.db` when records need types, colored tags, or filtering; prefer plain
files read through the API when an `.nhtml` view must present the data.

## .canvas boards (JSON Canvas)

A `.canvas` file is `{ "nodes": [...], "edges": [...] }` per [jsoncanvas.org](https://jsoncanvas.org):

- Node types: `text` (markdown in `text`), `file` (workspace path in `file`), `link` (`url`), `group` (`label`). All have `id`, `x`, `y`, `width`, `height`, optional `color`.
- Edges: `{ id, fromNode, fromSide, toNode, toSide, label?, color? }` with sides `top|right|bottom|left`.
- `color` is `"1"`–`"6"` (red, orange, yellow, green, cyan, purple) or any CSS color.
- When generating a canvas, lay cards out on a rough grid (~300×150 cards, 60+px gaps), put groups behind the cards they contain, and label edges with the relationship ("causes", "supports", "example of").

## Rules

- All persistent state goes in workspace files. Never suggest localStorage, external databases, or embedded JS.
- No `<script>` in views — it will not run. Interactivity is htmx + server fragments.
- Request the minimum capabilities and the tightest path scopes in manifests.
- Relative data paths in API calls resolve from the workspace root.
- Reusable partials go in `.neuron/fragments/`; per-view CSS in `.neuron/styles/<view name>.css`.
