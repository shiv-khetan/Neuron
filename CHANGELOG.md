# Changelog

All notable changes to Neuron are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[semantic versioning](https://semver.org/).

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
