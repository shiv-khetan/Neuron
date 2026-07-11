# File surfaces: architecture and security model

Neuron renders three kinds of user-authored surface documents, all stored as
plain files in the workspace and all editable by hand (every surface has a
Preview/Source toggle):

| File | Format | Renders as |
| --- | --- | --- |
| `.nhtml` | HTML + htmx attributes | An isolated HTMX view tab (see [htmx-views.md](htmx-views.md)) |
| `.db` | JSON (schema + view state + rows) | Notion-style database (table / kanban board / card gallery) |
| `.canvas` | [JSON Canvas](https://jsoncanvas.org) (Obsidian-compatible) | Infinite spatial board |
| `.neuron/layout.json` | JSON layout tree | The workspace shell layout |

HTMX views have their own architecture and threat model, documented in
[htmx-views.md](htmx-views.md). This document covers the in-renderer surfaces
(`.db`, `.canvas`, the shell layout).

> **Removed:** the earlier `.vw` block-view dashboards were replaced by HTMX
> views. Existing `.vw` files are left untouched on disk but are no longer
> listed or rendered; see the migration notes in
> `examples/demo-repo/building-htmx-views.mdx`.

## JSON Canvas (`.canvas`)

Neuron's canvas is spec-compatible with [jsoncanvas.org](https://jsoncanvas.org)
(Obsidian's format). Architecture, feature matrix, and compatibility contract:
[plans/json-canvas-enhancements.md](plans/json-canvas-enhancements.md). Code:
`src/renderer/canvas/` (model, history, markdown) + `surfaces/CanvasSurface.tsx`.

Capabilities: pan/zoom (wheel, zoom controls, fit all/selection), text cards
with safe Markdown rendering, file cards (with missing-file badges), link and
group nodes, edge creation by dragging connector dots, edge labels, arrow
direction controls (default/both/none — spec `fromEnd`/`toEnd`), multi-select
(Shift-click, Shift-drag marquee), batch move/color/delete, align and
distribute, bring-to-front/send-to-back (spec array order = z), copy/cut/
paste/duplicate as standard JSON Canvas fragments (pasteable across canvases
and tools), snap-to-grid, undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`), context menus
on background/nodes/edges, and keyboard editing (arrows nudge, `Shift` for
bigger steps, `Ctrl+A/C/X/V/D`, `Delete`, `Escape`).

Compatibility guarantees: unknown top-level keys, unknown node/edge
properties, and unknown node *types* survive load→edit→save (nodes of foreign
types render as read-only "preserved as-is" cards). Standard fields are never
renamed or defaulted-into-existence; serialization is tab-indented like
Obsidian's. Recoverable parse problems (duplicate ids, bad geometry, dangling
edges) load with a warnings badge; unreadable files show the error and are
never rewritten. Deferred work is tracked in `.claude/json-canvas-backlog.md`.

**Node styling** (palette button or right-click → Style…) uses the versioned,
namespaced `neuron` extension — shape, border style/width, text alignment,
font size, opacity, and presets (idea/question/warning/decision):

```json
{ "id": "n1", "type": "text", "x": 0, "y": 0, "width": 260, "height": 140,
  "text": "# Idea", "color": "3",
  "neuron": { "version": 1, "style": { "shape": "rounded", "borderStyle": "dashed", "preset": "idea" } } }
```

A node only gains a `neuron` object when a nonstandard property is changed,
and loses it again when the last one is cleared. Other JSON Canvas apps
simply ignore the extension and still show the standard card — presets write
the standard `color` field too, so the look degrades gracefully. Extensions
written by a newer Neuron (`version` > 1) are preserved untouched and never
edited by this version.

## Rendering pipeline

1. The renderer reads the file over the preload bridge (`notes:read`); the file
   watcher (`notes:changed`) streams external edits in live.
2. Each surface parses its document defensively: size budget first, then
   format-specific validation. Invalid documents render an error state with a
   pointer to Source mode — they never crash and are never "fixed" silently.
3. Every write goes back through the bridge (`notes:write`), which performs an
   **atomic write** (temp file + rename) in the main process.

## Error isolation

`SurfaceBoundary` wraps every open surface: a crashing view shows an inline
error and leaves the app shell, tabs, and Source mode fully usable.

## Security model

The renderer runs with context isolation on and Node integration off; surfaces
can only reach the world through the named preload methods. Within that,
surface documents are treated as **untrusted input** — synced and shared
workspaces mean the current user may not have written them.

Enforced by `src/renderer/lib/view-security.ts` (checked by
`node tools/view-security.test.mjs`):

- **URL allowlist** — `href`/`src` in `.db` link cells and `.canvas` link
  cards render only `http:`, `https:`, or `mailto:` URLs (≤ 2048 chars).
  `javascript:`, `file:`, `data:`, scheme-less, and protocol-relative URLs are
  dropped. Links open externally (`target="_blank"` + `rel="noreferrer"`).
- **Document budget** — `.db` and `.canvas` refuse to parse documents over
  2 MB instead of freezing the renderer.

Privileged operations are capability-shaped IPC handlers in the main process:
`views:file` reads workspace images for `.canvas` file nodes (path resolved
inside the active workspace only); `notes:write` performs workspace-confined
atomic writes. Surfaces cannot name arbitrary IPC channels, shell commands, or
filesystem paths outside the workspace.

## Known limitations

- Table views are not virtualized; documents are capped at 2 MB, which keeps
  row counts in the low thousands. Add virtualization when a real workspace
  hits the ceiling.
- Board/gallery cards are read-only summaries; editing happens in table mode
  or by dragging cards between columns.
