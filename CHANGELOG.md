# Changelog

All notable changes to Neuron are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[semantic versioning](https://semver.org/).

## [1.4.1] - 2026-07-14

### Security
- **Markdown/MDX preview now sanitizes note-authored HTML.** Raw HTML in a note
  was previously injected directly into the reading view, so event-handler
  attributes and nested `<img onerror>` could execute in the app renderer.
  That path now runs through an allowlist parser that drops scripts, inline
  handlers, and unsafe URLs — closing a stored cross-site-scripting hole.

## [1.4.0] - 2026-07-11

### Added
- **HTMX views (`.nhtml`)** — the new way to build custom interfaces in a
  workspace. Author plain HTML with [htmx](https://htmx.org) attributes; each
  view renders in an isolated, sandboxed webview and talks to a capability-
  scoped local API for reading notes, searching, and permitted file writes.
  Configuration, variables, reusable fragments, permissions, and manifests
  live in a `.neuron` folder you can inspect and edit. htmx is bundled, so
  views work fully offline. See [docs/htmx-views.md](docs/htmx-views.md).
- **JSON Canvas overhaul** — undo/redo, multi-selection with marquee, clipboard
  (copy/cut/paste/duplicate as standard JSON Canvas fragments, pasteable across
  canvases and other tools), alignment and distribution, bring-to-front/
  send-to-back, snap-to-grid, context menus, safe Markdown rendering in cards,
  edge arrow-direction controls, broken-reference indicators, and preservation
  of unknown fields and unknown node types across load→edit→save.
- **`neuron.style` canvas extension (v1)** — versioned, namespaced per-node
  styling (shape, border, text alignment, font size, opacity) and presets,
  while the standard `color` field stays authoritative for interoperability.
- **Editable properties** — YAML frontmatter shown as a typed properties panel
  (text, tags, aliases, numbers, dates, lists, booleans) with round-trip-safe
  serialization that preserves comments and untouched keys.
- **Workbench customization** — activity rail, configurable layout, and a
  distraction-free zen mode.

### Changed
- **The `.vw` block-view dashboards were replaced by HTMX views.** Existing
  `.vw` files are left untouched on disk but are no longer rendered; see
  [docs/htmx-views.md](docs/htmx-views.md) for migrating them to `.nhtml`.
- The bundled demo workspace was rebuilt around an HTMX dashboard alongside the
  database and canvas examples, with a `.neuron` config folder.
- The `neuron-mini-apps` agent skill now teaches `.nhtml`, `.db`, and `.canvas`.

### Security
- **HTMX views are treated as untrusted content.** The local view server binds
  only to loopback on an ephemeral port; every request carries an unguessable
  per-view session token (HttpOnly cookie, constant-time comparison, short
  TTL); a strict Content-Security-Policy blocks remote scripts and inline
  execution; Host and Origin are validated; capabilities are declared in a
  manifest and denied by default for writes; and all filesystem access is
  confined to canonical, glob-scoped workspace paths (traversal, symlink, and
  drive-letter escapes rejected).
- Canvas documents are treated as untrusted input: safe Markdown rendering with
  no HTML injection, a URL scheme allowlist, and size/node budgets.

### Fixed
- YAML frontmatter serialization type error.

## [1.1.0] - 2026-07-05

### Added
- **Custom-view system** — file-backed surfaces that render live, interactive
  UI from workspace files, with a controlled component registry, per-block and
  per-surface error boundaries, and a documented security model.
- **`.vw` block views** — dashboards authored in HTML + Tailwind: metrics,
  stats, progress bars, file counts and tables, bar/line/area charts, habit
  heatmaps, editable CSV databases, galleries, list/folder views, bookmarks,
  checklists, and trusted action buttons. Any tag accepts a `class` for
  12-column bento grid placement.
- **`.db` databases** — Notion-style databases stored as JSON: typed
  properties, colored select/multi-select tags, per-property filters, sorting,
  and Table, Board (kanban with drag-and-drop), and Cards layouts, all
  runtime-editable from the UI.
- **`.canvas` boards** — an infinite spatial whiteboard in the open
  [JSON Canvas](https://jsoncanvas.org) format (Obsidian-compatible): text,
  file, link, and group cards with labelled, colored connections, pan/zoom,
  and one-click conversion of a card into a permanent note.
- **Agent skill** — `skills/neuron-mini-apps` teaches AI agents to build
  Neuron mini-apps from `.vw`, `.db`, and `.canvas` files.
- **Design-system component gallery** for reviewing primitives and variants.

### Changed
- **Repositories are now Workspaces** across the entire UI, docs, and demo
  content. A workspace is any folder — local or in a synced folder such as
  OneDrive or Google Drive.
- Workspace shell layout moved from a root `neuron.config` file to
  `.neuron/layout.json`; existing `neuron.config` files migrate automatically.
- Note and view writes are now **atomic** (temp file + rename) to prevent
  half-written files.
- The demo workspace was rebuilt to production quality with paired default and
  custom dashboards, a database, and a canvas board over shared sample data.

### Security
- View documents are treated as untrusted input: URL scheme allowlist for
  links and images, document size budgets, and node/depth limits on `.vw`
  trees. Privileged operations stay behind capability-shaped, workspace-confined
  IPC handlers. See [docs/custom-views.md](docs/custom-views.md) for the threat
  model.

## [1.0.0] - 2026-06-20

- Initial release: local-first Markdown/MDX workspace with live editing,
  split preview, tabs, wiki-links, tags, a wiki-link graph, resizable docks,
  a plugin host, optional AI integrations, an interactive terminal, and
  themeable UI.
