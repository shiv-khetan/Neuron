# Custom views: architecture and security model

Neuron renders four kinds of user-authored view documents, all stored as plain
files in the workspace and all editable by hand (every surface has a
Preview/Source toggle):

| File | Format | Renders as |
| --- | --- | --- |
| `.vw` | HTML-like markup with a controlled tag registry | Dashboard of live blocks |
| `.db` | JSON (schema + view state + rows) | Notion-style database (table / kanban board / card gallery) |
| `.canvas` | [JSON Canvas](https://jsoncanvas.org) (Obsidian-compatible) | Infinite spatial board |
| `.neuron/layout.json` | JSON layout tree | The workspace shell layout |

## Rendering pipeline

1. The renderer reads the file over the preload bridge (`notes:read`); the file
   watcher (`notes:changed`) streams external edits in live.
2. Each surface parses its document defensively: size budget first, then
   format-specific validation. Invalid documents render an error state with a
   pointer to Source mode — they never crash and are never "fixed" silently.
3. `.vw` markup is parsed with `DOMParser` (inert — nothing executes) and
   converted to React elements through two allowlists:
   - **native tags** (div, p, table, …) with only `class`, `href`, `src`, `alt`
     forwarded; anything else (`script`, `style`, `iframe`, event handlers,
     unknown tags) is dropped;
   - **view tags** (`<metric>`, `<csvtable>`, `<gallery>`, `<listview>`,
     `<button action=…>`, …) that map to trusted React components — this is the
     component registry. Attributes are the entire binding surface; there is no
     expression language and no code evaluation of any kind.
4. Every write goes back through the bridge (`notes:write`), which performs an
   **atomic write** (temp file + rename) in the main process.

## Error isolation

- `SurfaceBoundary` wraps every open surface: a crashing view shows an inline
  error and leaves the app shell, tabs, and Source mode fully usable.
- Inside `.vw`, each registry component is additionally wrapped in a per-block
  boundary, so one bad block degrades to an inline message while the rest of
  the dashboard keeps rendering.

## Security model

The renderer runs with context isolation on and Node integration off; views
can only reach the world through the named preload methods. Within that,
view documents are treated as **untrusted input** — synced and shared
workspaces mean the current user may not have written them.

Enforced by `src/renderer/lib/view-security.ts` (checked by
`node tools/view-security.test.mjs`):

- **URL allowlist** — `href`/`src` in `.vw`, bookmark cards, and `.canvas`
  link cards render only `http:`, `https:`, or `mailto:` URLs (≤ 2048 chars).
  `javascript:`, `file:`, `data:`, scheme-less, and protocol-relative URLs are
  dropped. Links open externally (`target="_blank"` + `rel="noreferrer"`).
- **Document budget** — `.db` and `.canvas` refuse to parse documents over
  2 MB instead of freezing the renderer.
- **Tree budget** — `.vw` stops rendering past 2 000 nodes or depth 40 and
  says so, instead of hanging on a hostile or runaway document.

Privileged operations are capability-shaped IPC handlers in the main process,
each validating its input:

| Capability | Handler | Guard |
| --- | --- | --- |
| Read workspace data | `views:source`, `views:csv`, `views:file` | Paths resolved inside the active workspace only |
| Write a file | `notes:write` | Workspace-confined, atomic |
| Create a file | `views:action createFile` | Workspace-confined, never overwrites |
| Reveal / open in editor tools | `views:action reveal/openInVSCode` | Workspace-confined |
| Run commands | automations only | User-defined command lists, run explicitly by name |

Views cannot name arbitrary IPC channels, shell commands, or filesystem paths
outside the workspace.

### Threat model summary

- **XSS / script injection**: no path from view content to executed code —
  DOMParser is inert, no `eval`/`Function`/`dangerouslySetInnerHTML`, URL
  schemes allowlisted.
- **Malicious schema payloads**: size/node/depth budgets; JSON parsed with
  shape checks; unknown tags and fields ignored for rendering but preserved
  on disk.
- **Data exfiltration**: remote fetches happen only for URLs the view renders
  visibly (bookmark favicons, `<img>`); no background network access.
- **Permission abuse**: file actions are workspace-confined in the main
  process (`target.startsWith(repo)` after normalization).
- **DoS**: budgets above; expensive blocks fail into per-block boundaries.
- **Style impersonation**: `.vw` styling is Tailwind classes compiled at build
  time — arbitrary CSS strings, fixed overlays, and z-index escalation are not
  expressible from a view document.

## Adding a trusted component

1. Implement the React component in `src/renderer/surfaces/ViewSurface.tsx`
   (or import one from `components/ui`). Use theme tokens (`var(--ink)`,
   `var(--surface)`, …) — never hard-coded colors.
2. Register it in the `COMPONENTS` map: tag name → render function receiving
   parsed attributes. Sanitize any URL attribute with `safeUrl`.
3. If it needs data, add or reuse a `views:*` IPC handler; keep path
   resolution inside the workspace and validate every argument.
4. Document the tag in `examples/demo-repo/building-uis-and-dashboards.mdx`
   and `skills/neuron-mini-apps/SKILL.md`.

## Authoring

See the in-app guide (`building-uis-and-dashboards.mdx` in the demo
workspace) and `skills/neuron-mini-apps/SKILL.md` for the complete tag
reference, the `.db` schema, and the `.canvas` node/edge format. The demo
workspace ships one working example of every view type (`Workspace view.vw`,
`Projects.db`, `Idea board.canvas`).

## Known limitations

- `.vw` Tailwind classes must exist in the compiled CSS; arbitrary values
  authored only in a workspace file may not resolve. This doubles as the
  styling security boundary.
- No sandboxed arbitrary-HTML view mode. This is deliberate: the tag registry
  covers dashboard needs without a second security perimeter. If mini web
  apps become a real requirement, the path is an Electron `WebContentsView`
  with `sandbox: true`, context isolation, no Node, a strict CSP, and a
  dedicated minimal preload — mirroring the existing `BrowserView` web tabs.
- Table views are not virtualized; documents are capped at 2 MB, which keeps
  row counts in the low thousands. Add virtualization when a real workspace
  hits the ceiling.
- Board/gallery cards are read-only summaries; editing happens in table mode
  or by dragging cards between columns.
