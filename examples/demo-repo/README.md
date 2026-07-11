# Demo workspace

A ready-made Neuron workspace that demonstrates every feature. It opens automatically the first time you launch the app.

## How to open it

1. Launch Neuron (`npm run dev`) — on first run this workspace opens for you.
2. To reopen it later, use the **Workspaces** page or the workspace switcher in the title bar.
3. The folder lives at `examples/demo-repo`.

Then start at **getting-started** in the sidebar and follow the links.

## What's inside

| Note | Shows |
| --- | --- |
| getting-started | The hub — links, tags, a callout, a badge |
| markdown-basics | Headings, lists, quotes, code blocks, inline styles |
| mdx-components | The live `Badge` and `Callout` components |
| building-htmx-views | How to build custom HTMX view interfaces |
| wikilinks-and-tags | `[[wikilinks]]`, the graph, and `#tags` |
| sections-and-workspaces | Folders, nesting, and workspaces |
| plugins-and-ai | Enabling Claude, a local model, and Daily Notes |
| projects/autonote-roadmap | A note inside a section |
| daily/2026-06-19 | A daily monitoring note with checks, signals, and release blockers |
| daily/monitoring-runbook | A small runbook previewed by the daily monitoring dashboard |

| Surface file | Shows |
| --- | --- |
| .neuron/layout.json | The internal workspace shell layout |
| .neuron/variables.json | Typed variables available to HTMX views |
| Team dashboard.nhtml | An HTMX view: live summary, search, and an editable status variable |
| Team dashboard.neuron.json | The view's manifest — declared permissions and path scopes |
| Projects.db | A Notion-style database with table, board, and card layouts |
| Idea board.canvas | A JSON Canvas spatial board with groups and labelled connections |

## Try these

- Open **Team dashboard.nhtml** — it renders in an isolated view tab; use the Source toggle to edit its HTML.
- Open **Idea board.canvas** — Shift-drag to multi-select, right-click for align/z-order/arrows, Ctrl+Z to undo; cards render Markdown.
- Press **Ctrl/Cmd + K** and run **New HTMX view in current folder** to create an `.nhtml` view.
- Read **building-htmx-views** for the API routes, `.neuron` folder layout, and permission model.
- Click a `#tag` at the bottom of the sidebar to filter.
- Open **Integrations & Plugins** at the bottom of the sidebar and enable a plugin — its panel appears on the right.
