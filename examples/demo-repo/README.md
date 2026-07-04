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
| Workspace view | A block-based `.vw` surface with metrics, file counts, graphs, tables, checklists, and action buttons |
| getting-started | The hub — links, tags, a callout, a badge |
| markdown-basics | Headings, lists, quotes, code blocks, inline styles |
| mdx-components | The live `Badge` and `Callout` components |
| building-uis-and-dashboards | How to assemble notes and `.vw` block views |
| wikilinks-and-tags | `[[wikilinks]]`, the graph, and `#tags` |
| sections-and-workspaces | Folders, nesting, and workspaces |
| plugins-and-ai | Enabling Claude, a local model, and Daily Notes |
| projects/autonote-roadmap | A note inside a section |
| daily/2026-06-19 | A daily monitoring note with checks, signals, and release blockers |
| daily/monitoring-runbook | A small runbook previewed by the daily monitoring dashboard |

| Surface file | Shows |
| --- | --- |
| .neuron/layout.json | The internal workspace shell layout |
| Workspace view.vw | A block-based surface powered by local workspace sources |
| Dashboard (default).vw | A dashboard composed from the standard blocks |
| Dashboard (custom).vw | The same data (`data/*.csv`) in a fully custom HTML + Tailwind layout |
| Projects.db | A Notion-style database with table, board, and card layouts |
| Idea board.canvas | A JSON Canvas spatial board with groups and labelled connections |

## Try these

- Press **Ctrl/Cmd + K** and run **New block view in current folder** to create a `.vw` surface.
- Use `.vw` files when you want live metrics, source tables, charts, checklists, and trusted action buttons.
- Open **Dashboard (default).vw** and **Dashboard (custom).vw** side by side — same CSVs, standard blocks vs. custom layout; edits in one appear in the other.
- Open **Workspace view.vw** for a block-based view powered by local sources and safe actions.
- Click a `#tag` at the bottom of the sidebar to filter.
- Open **Integrations & Plugins** at the bottom of the sidebar and enable a plugin — its panel appears on the right.
