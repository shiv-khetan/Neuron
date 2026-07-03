---
name: neuron-mini-apps
description: Build mini apps (dashboards, trackers, tables, galleries) inside a Neuron workspace using .vw view files, CSV-backed editable databases, and trusted action buttons. Use when asked to create a dashboard, tracker, database, or interactive view in Neuron.
---

# Building mini apps in Neuron

A Neuron **workspace** is a plain folder of files. A mini app is just files in
that folder — no build step, no server, no localStorage:

- **`.vw` files** — the UI. HTML with Tailwind classes, rendered live.
- **`.csv` files** — simple tabular data. Views read AND write them (two-way sync).
- **`.db` files** — Notion-style databases: typed properties, colored select tags, filters (schema below).
- **`.canvas` files** — infinite whiteboards in the open JSON Canvas format (Obsidian-compatible): text/file/link cards, labelled groups, colored + labelled arrows.
- **`.md`/`.mdx` files** — notes/docs, linkable with `[[wikilinks]]`.
- **Automations** — named command sequences a button can run.

Create a mini app by writing a `.vw` file (any path, e.g. `Habit tracker.vw`)
and, if it needs data, a CSV (convention: `data/name.csv`, first row = headers)
or a `.db` database for typed/structured records.

## The .vw format

Plain HTML. Standard tags render as themselves with `class` passed through —
use Tailwind for all layout (`grid grid-cols-3 gap-4`, `flex`, etc.).

Allowed native tags: div, section, header, footer, main, article, aside, nav,
span, p, a, strong, em, b, i, u, s, small, code, pre, blockquote, ul, ol, li,
hr, br, img, h1–h6, table, thead, tbody, tr, td, th, label, button.
`<script>`, `<style>`, and `<iframe>` are stripped — interactivity comes from
the custom tags below. Links (`<a href>`) open in the external browser.

## Custom tags

| Tag | Purpose |
| --- | --- |
| `<metric title="…" value="…" hint="…" />` | Hand-curated stat tile |
| `<filecount title glob="*.mdx" />` | Live count of workspace files |
| `<filegraph title glob />` | Bar chart of files by type |
| `<filetable title glob limit="10" />` | Table of file metadata |
| `<csvtable title src="data/tasks.csv" />` (alias `<database>`) | **Editable** Notion-style table backed by a CSV — edit cells, add/delete rows, add columns, sort; every edit saves back to the file |
| `<progress label value="3" max="5" />` | Labeled progress bar |
| `<stat label value delta="+34" sub="…" />` | Metric with colored up/down delta |
| `<barchart>` / `<linechart>` / `<areachart>` | Chart from a CSV (`src`, `x`, `y` column names) or inline `data='[{"name":"Mon","value":3}]'` |
| `<heatmap src="data/habits.csv" date="date" value="count" />` | GitHub-style contribution grid |
| `<gallery title glob="*.png" limit="60" />` | Grid of workspace images |
| `<listview title glob="*.mdx" limit="100" />` | Clickable file list; notes open in the editor |
| `<folderview title path="daily" />` | Files grouped by folder, clickable |
| `<bookmark url title description />` (alias `<linkpreview>`) | Link card with favicon |
| `<card title>…children…</card>` | Titled block wrapper |
| `<task checked>Label</task>` | Checklist row |
| `<button label action="…" />` | Trusted action button (below) |

Every view tag accepts `class` for grid placement (`col-span-*`, `row-span-*`).
**Lay dashboards out as a 12-column bento grid, not a vertical stack**: one
`grid grid-cols-2 lg:grid-cols-12 gap-4` wrapper, stat tiles at `lg:col-span-3`,
one wide anchor block per row (e.g. `lg:col-span-8` chart + `lg:col-span-4`
rail). Safelisted utilities (always available in any workspace): grid/flex
layout, spans, gaps, spacing, sizing, text/font, rounded/border — with
`sm: md: lg: xl:` variants on the grid utilities.

## Button actions (what makes it an app)

```html
<button label="Open in VS Code" action="openInVSCode" />
<button label="Reveal folder" action="reveal" path="data" />
<button label="Open the log" action="open" path="daily/log.mdx" />
<button label="New scratch note" action="createFile" path="scratch.md" content="# Scratch" />
<button label="Sync" automation="Pull latest" />
```

- `open` — opens a workspace note in the editor.
- `createFile` — creates the file (with optional `content`) if missing, then opens it. Paths are confined to the workspace.
- `automation="Name"` — runs a saved automation (a named list of shell commands the user created in the Automations panel). Use for anything else: git sync, scripts, exports.

## Recipe: a tracker mini app

`data/reading.csv`:
```csv
date,book,pages
2026-07-01,Dune,40
```

`Reading tracker.vw`:
```html
<h1>Reading tracker</h1>
<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
  <stat label="This week" value="180" delta="+40" sub="pages" />
  <progress label="Monthly goal" value="180" max="600" />
  <linechart title="Pages per day" src="data/reading.csv" x="date" y="pages" />
</div>
<csvtable title="Log" src="data/reading.csv" />
<div class="flex gap-3">
  <button label="New book note" action="createFile" path="books/new-book.mdx" content="# Book notes" />
</div>
```

The `<csvtable>` is the edit surface — the user logs entries there and the
charts/stats read the same file. That loop (CSV as state, view as UI, buttons
as verbs) is the whole pattern.

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
- The app watches the file: external edits (scripts, git, agents editing the JSON) appear live in the open table. An empty `.db` file shows an "Initialize database" button.

Prefer `.db` over CSV when records need types, colored tags, or filtering; prefer CSV when other blocks (charts, heatmaps) must read the same data.

## .canvas boards (JSON Canvas)

A `.canvas` file is `{ "nodes": [...], "edges": [...] }` per [jsoncanvas.org](https://jsoncanvas.org):

- Node types: `text` (markdown in `text`), `file` (workspace path in `file`), `link` (`url`), `group` (`label`). All have `id`, `x`, `y`, `width`, `height`, optional `color`.
- Edges: `{ id, fromNode, fromSide, toNode, toSide, label?, color? }` with sides `top|right|bottom|left`.
- `color` is `"1"`–`"6"` (red, orange, yellow, green, cyan, purple) or any CSS color.
- When generating a canvas, lay cards out on a rough grid (~300×150 cards, 60+px gaps), put groups behind the cards they contain (a group contains a card when the card's rect is fully inside), and label edges with the relationship ("causes", "supports", "example of").

## Rules

- All persistent state goes in workspace files (CSV/MD). Never suggest localStorage, external databases, or embedded JS.
- Use standard formats: CSV with a header row; Markdown/MDX for prose.
- Keep views flat: tiles on a grid, not nested card-in-card.
- Column names referenced by `x`, `y`, `date`, `value` must match CSV headers exactly.
- Relative paths (`src`, `path`) resolve from the workspace root.
