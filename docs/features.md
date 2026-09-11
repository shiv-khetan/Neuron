# Neuron feature guide

Neuron is a local-first desktop workspace for notes, canvases, databases, and
small custom interfaces. Your workspace is an ordinary folder, your content is
stored in plain files you can keep in Git or a sync folder, and Neuron itself
does not require an account.

The unusual part is the view platform. Shareable `.html` and folder mini-app
views run away from Neuron's privileged interface and receive
only named capabilities and workspace paths. That is a stronger boundary than
all-or-nothing plugin trust: built-in plugins are reviewed application code,
while a view starts with constrained access, cannot use Node, and cannot reach
the network.

This guide is organised around what you want to accomplish. For implementation
details, start with the [architecture](architecture.md); for common failures,
see [troubleshooting](troubleshooting.md). The intended audience and product
principles live in the [product brief](product.md).

## Know which files Neuron opens

The workspace watcher recognises these user-facing document types:

| File | Purpose | What Neuron reads or writes |
| --- | --- | --- |
| `.md` | Markdown note | Markdown text, optionally with YAML frontmatter |
| `.mdx` | Markdown note with supported components | Markdown/MDX text, optionally with YAML frontmatter |
| `.canvas` | Spatial board | JSON Canvas document |
| `.db` | Typed database | JSON schema, view state, and rows |
| `.html` | Sandboxed view | HTML with optional htmx attributes, inline CSS, and JavaScript |
| `index.html` | Folder mini-app entry point | HTML view inside a marked app folder |
| `neuron.app.json` | Folder mini-app marker and manifest | Capabilities and allowed paths for `index.html` |
| `.neuron/manifests/*.json` | View manifests | Capabilities and allowed paths for standalone `.html` views |
| `.neuron/layout.json` | Workspace shell | JSON layout tree |

Neuron also watches the view platform's `.neuron` JSON, HTML, and CSS assets,
plus legacy `neuron.config` and `*.neuron.json` sidecar manifests.
Images referenced by canvas file cards can be PNG, JPEG, GIF, WebP, SVG, BMP,
or ICO files, but image files are not standalone editor surfaces.

## Keep a folder of work as a workspace

Choose **Workspaces** in the activity rail to create or open a folder, switch
among recent folders, give one a display name, reveal it in the operating
system, or remove it from Neuron's recent list. Removing a workspace from the
list does not delete its folder. On a genuine first launch, the bundled demo
workspace opens when available.

A workspace may live anywhere the desktop user can access, including a
cloud-synced folder. Neuron watches recognised files for external additions,
changes, and deletions, so edits made by Git, sync software, or another editor
flow back into the app. The active/recent workspace list and other application
settings live in Neuron's local application-data directory, not in the
workspace.

Use the **Explorer** in the activity rail to browse folders (called sections),
create a note or section, refresh the tree, collapse folders, open files in
tabs, or delete a note. The create dialog makes `.mdx` by default; an explicit
`.md` name creates Markdown instead. New HTMX views are created separately
from the command palette or their shortcut.

## Write and read Markdown or MDX

Open a `.md` or `.mdx` file from the Explorer, search results, command palette,
graph, or an existing tab. Notes open in **Reading view**. Double-click the
rendered note to enter the **Live editor**, where Markdown markers are visually
reduced around the caret. The view-mode menu also offers **Edit as raw file
(split)**, with source and preview side by side on wide windows and as tabs on
narrow windows. Non-note text assets open as raw source.

Both note extensions use the same editor and renderer. The Reading view
implements level-one through level-three headings, paragraphs, unordered and
task lists, block quotes, fenced code blocks, GitHub-style tables, inline
bold/italic/code, wiki-links, and `<br>` tags. Task checkboxes are display-only;
edit their Markdown source to change them. The renderer is intentionally
smaller than full CommonMark today: ordered lists, standard Markdown links and
images, deeper headings, and horizontal rules are not rendered as dedicated
elements.

Neuron supports these MDX components:

- `<Badge text="..." type="info|success|warning|error" />`
- `<Callout type="info|success|warning|error" title="...">...</Callout>`
- `<DbView path="@Planner.db" view="table|board|card" />`

`DbView` is a read-only embed of a workspace-root-relative `.db` file. Edit the
database in its own tab. Unknown MDX components produce a visible compilation
error rather than executing arbitrary JSX. A small allowlist of standard HTML
elements is sanitized before rendering.

Changes autosave back to the open `.md` or `.mdx` file, and the status bar
reports saving, saved-locally, or failed state. Multiple notes and surfaces can
stay open as tabs; use the close button or middle-click to close one. Neuron has
no block editor JSON note format: the Markdown on disk remains the source of
truth. Neuron keeps an earlier copy of a file before each save and before any delete;
see [Recover an earlier version](#recover-an-earlier-version) below.

## Recover an earlier version

Before Neuron overwrites or deletes a file, it copies the previous contents to a
local journal. Open the side peek (`Mod+J`) and choose **Version history** to see
the earlier versions of the note you have open, newest first, each labelled with
how long ago it was recorded and whether it preceded an overwrite or a delete.

**Restore** asks for confirmation before it replaces the file, and the contents
it replaces are themselves journaled, so a restore is reversible too.

Two things worth knowing:

- Because Neuron saves as you type, entries are grouped per editing session
  rather than per keystroke. The version you get back is the state from before
  that session, which is usually the one you want.
- Copies are kept in Neuron's own application-data directory, **not** in your
  workspace, so they never sync to a cloud folder, never land in a Git commit,
  and never travel with the notes. They are a local safety net, not a backup.
  A file larger than the size limit is listed but marked as not recoverable
  rather than being silently skipped.

Version history is a built-in plugin and is enabled by default. It can be turned
off under **Integrations & Plugins**; the journal keeps recording either way.

## Add structured properties

Put YAML frontmatter between `---` lines at the start of a `.md` or `.mdx`
note. In the Live editor, the properties panel can add, rename, reorder, edit,
or remove text, long text, number, checkbox, date, tags, and list values.
Aliases and links already present in YAML also receive appropriate editors;
unsupported YAML shapes remain visible and can be edited as raw YAML.

Open **Settings** to choose whether properties appear in Reading view, start
collapsed, or remove the frontmatter block when its final property is deleted.
Invalid YAML is never silently rewritten: Neuron shows a diagnostic and offers
**Edit as YAML**.

## Give one note the full width of the window

Reading view and the Live editor cap their measure so prose stays readable.
That is the wrong shape for a table with nine columns, a wide diagram, or a
dashboard built from layout components. Add `fullWidth` to the note's
frontmatter and that one note uses the whole pane instead:

```yaml
---
title: Quarterly review
fullWidth: true
---
```

It applies to Reading view, the Live editor, and the preview half of Split, so
switching views never changes the width the document is written at. Every other
note is unaffected — this is a property of the file, not an app setting, so it
travels with the note into any other editor.

Once the property exists, the properties panel shows it as a **Full Width**
checkbox, which is the easiest way to turn it back off. Adding it from the panel
works too: create a property called `fullWidth` and give it the value `true`.
The panel stores that as text rather than a YAML boolean, and Neuron accepts
either — a page that refused to widen because of a pair of quotes would be
worse than no setting at all.

## Quiz yourself with flashcards

`<Flashcard>` is a question you answer before you are shown the answer. The
prompt is the `front` attribute; everything inside is the answer:

```mdx
<Flashcard front="Where do Neuron notes live?">
As plain files in a folder you already own.
</Flashcard>
```

The answer is not in the document until you press **Show answer**, so it cannot
be read by scrolling past or by searching the page. Cards behave the same way in
Reading view and in the Live editor, and each card reveals on its own.

The prompt is plain text — attributes are never parsed as Markdown — while the
answer goes through the usual parser, so it can hold a list, `code`, or
emphasis.

## Connect notes with wiki-links and tags

Write `[[Note name]]` in a `.md` or `.mdx` note. Wiki-links are styled in the
Live editor and Reading view, and resolved links form edges in the graph. In
the current Reading view they are labels, not clickable navigation links; use
the Explorer, command palette, or graph node to open the target.

Tags can be inline (`#project`) or stored in a frontmatter `tags` value. Choose
**Tags** in the activity rail to see the collected tag list and filter the
Explorer to notes containing a selected tag. The inline matcher expects a tag
to be separated by whitespace and followed by whitespace, end of line, a
period, or a comma.

## Find a note or command

Choose **Search notes** in the activity rail to filter the workspace tree by
case-insensitive file path. It does not search note contents. Matching folders
open automatically so results are visible.

Open the command palette to search note paths and run application or enabled
plugin commands. The built-in actions create notes or HTMX views, open
Settings, Plugins, the component gallery, or a website tab, toggle the
workspace layout, and import Chrome cookies for the in-app browser. There is no
separate on-disk search index.

## See relationships in the graph

The graph is a panel in the optional workspace shell. Open the command palette
and choose **Use workspace layout (`.neuron/layout.json`)**; the generated
layout includes **Linked notes** beside the editor. There is currently no
standalone graph screen outside that layout. The graph creates one node per
`.md` or `.mdx` note in its configured scope and one edge for every wiki-link
whose target matches a note's workspace-relative name or basename,
case-insensitively. Select a node to open that note.

Nodes grow with link count. When a note is active, it and its direct neighbours
stay prominent while unrelated nodes dim. Layout is a deterministic hex
lattice, not a draggable or force-directed graph, and labels are reduced on
graphs larger than 120 notes.

## Arrange ideas on a canvas

Open a `.canvas` file to use the JSON Canvas surface. It reads and writes the
open JSON Canvas format, including text, file, link, and group nodes and edges.
You can pan and zoom, create and resize cards, add workspace notes or web links,
connect nodes, label edges, multi-select, align and distribute, change stacking
order and color/style, snap to a grid, copy/paste/duplicate, and undo or redo.
Text cards render safe Markdown; file cards can open notes or show workspace
images. A text card can also be converted into a neighbouring `.md` note.

External edits are adopted live. Unknown JSON Canvas fields and node types are
preserved, recoverable problems appear as warnings, and unreadable documents
stay untouched behind an error state. Documents over 2 MB are refused. For the
complete interaction and compatibility contract, see
[File surfaces: JSON Canvas](custom-views.md#json-canvas-canvas).

## Track structured work in a database

Open a `.db` file to use a database stored as one JSON document. **Table** mode
edits rows and the schema. Property types are text, number, checkbox, date,
URL, select, and multi-select; select options carry colors. The surface also
supports row search, one persisted filter, and ascending/descending sorting.

**Board** groups rows by a select property and lets you drag a card between
columns. **Cards** is a gallery. Board and Cards show summaries; cell editing
happens in Table mode. View mode, grouping, sort, and filter state are stored in
the `.db` file along with the rows. External file changes refresh the surface.
Invalid JSON is not repaired automatically, and documents over 2 MB are
refused. See [File surfaces](custom-views.md) for the format and safe-link
rules.

## Build a dashboard or folder mini-app

Use the command palette or `Ctrl/Cmd+G` to create an `.html` file in the
current folder. Opening it starts an isolated view tab; use the tab's
**Preview/Source** switch to run or edit it. The first view open creates missing
starter templates and supporting files under `.neuron/` without overwriting
existing files.

Choose the surface according to the job:

- `.html` accepts htmx attributes, inline CSS, and JavaScript. Neuron always
  supplies htmx and its themed component stylesheet.
- A non-root folder containing `index.html` and `neuron.app.json` becomes a
  folder mini-app. The Explorer shows the folder as one app entry instead of
  exposing its internal files.

Both forms use a sandboxed webview with no Node or preload bridge. Each open tab
gets an isolated session. The API exposes specific operations for files,
directories, note metadata, tags, search, typed variables, and reusable HTML
fragments. There is no command-execution endpoint or generic filesystem proxy.

Without a manifest, an `.html` file renders but receives no capabilities and
cannot read workspace data. A manifest requests named capabilities and allowed
paths; every requested capability prompts for one-time or persistent approval
tied to the exact manifest content. Folder mini-apps always use their adjacent
manifest, and a manifest with no permissions grants nothing. Network policy is
always `none`: views cannot fetch remote content, navigate away, or open popups.

Follow the full [HTMX view user guide](htmx-views.md#user-guide) for templates,
manifests, routes, variables, limits, and examples. The demo workspace contains
`Custom dashboard.html`, and `Snake/` as a folder
mini-app.

### Dashboard path: list your notes

1. Create an `.html` view from the command palette.
2. Read [Creating a view](htmx-views.md#creating-a-view), then copy
   `.neuron/templates/note-browser.html` or
   `.neuron/templates/file-list.html`.
3. Use `GET /api/v1/notes` for note metadata or `GET /api/v1/files` for file
   paths, as documented under **API routes (`/api/v1`)** in the
   [HTMX view guide](htmx-views.md).
4. Add a manifest for any workspace access; the
   [manifest guide](htmx-views.md#manifests-and-permissions) explains
   capabilities and path policies.

## Run workspace commands and automations

Enable **Workspace Terminal** under **Integrations & Plugins**, then open its
bottom panel. It is a full interactive PTY using the operating system's shell,
with the active workspace as its working directory and the app process's
environment. It can run any command your desktop user can run; it is not a
sandbox and can change files outside Neuron.

Enable **Automations** to save named, ordered lists of one-shot shell commands
in local app settings. They run sequentially with the active workspace as the
working directory and display stdout and stderr in the bottom panel. A failed
command does not stop later commands. Automations produce no workspace file of
their own, but the commands they launch may do so.

## Enable built-in plugins and AI assistants

Open **Integrations & Plugins** from the activity rail or command palette.
Search or filter the catalog, enable a built-in plugin, fill any configuration,
and open its side or bottom panel. Enabled state, configuration, and
plugin-namespaced storage are kept in local application settings.

The built-in catalog contains Daily Notes, Workspace Terminal, Automations,
and assistants for Anthropic Claude, OpenAI, Google Gemini, OpenRouter, and a
local OpenAI-compatible endpoint such as Ollama. Assistants receive the active
note as context and send requests through the desktop main process. Hosted
providers require your own API key; keys are stored locally. The local provider
requires an endpoint and model name.

Daily Notes opens or creates `daily/YYYY-MM-DD.mdx` with **Today** and **Notes**
headings, lists recent files under `daily/`, and contributes **Open today's
daily note** to the command palette.

Built-in plugins are trusted application code and can receive the host runtime,
including note operations, terminal, AI, and network clients. Folder-loaded
third-party plugins are not enabled in version 0.4.3. Developers can read the
[Plugin API](plugin-api.md), but adding a plugin currently means including and
reviewing it with the application.

## Change the appearance and workspace layout

Open **Settings** to switch among Graphite, Void, Nord, and Light presets. You
can override individual Markdown colors for headings, body text, bold text,
links/wiki-links, inline code, code backgrounds, and quote text/borders. These
choices are local settings and apply to the Live editor and Reading view; HTMX
views receive the current light/dark scheme.

The title-bar layout controls toggle the Explorer, side panel, bottom panel,
status bar, and zen mode. Panels are resizable. A workspace may also store a
JSON shell layout in `.neuron/layout.json`; open the command palette and choose
**Use workspace layout**. See [File surfaces](custom-views.md) for the layout
surface and [Design system](design-system.md) for the visual tokens.

## Browse a website without leaving a tab

Use the tab bar, command palette, or `Ctrl/Cmd+Shift+O` to open a website tab.
It starts at DuckDuckGo and provides Back, Forward, Reload, and an address bar.
Entering a hostname adds `https://`; only HTTP and HTTPS addresses are loaded.
Browser tabs use a persistent browser partition, separate from HTMX view
sessions.

The command palette can import Chrome cookies into that browser partition so
compatible websites reuse existing logins. This copies cookies into Neuron's
browser session; treat it as sensitive account data. It is not a general Chrome
profile sync and may skip cookies it cannot import.

## Install and receive updates

Neuron packages NSIS, portable, AppX, DMG/ZIP, AppImage, and Debian artifacts.
A packaged production build outside the Windows Store checks its configured
GitHub release feed and uses the operating system notification flow when an
update is available; Windows Store builds leave updating to the Store. Current
signing and platform-specific caveats are maintained in the
[distribution guide](distribution.md).

## Use or change keyboard shortcuts

`Mod` means Ctrl on Windows/Linux and Command on macOS. These are the complete
default configurable shortcuts in version 0.4.3:

| Action | Default |
| --- | --- |
| Open command palette | `Mod+K` |
| New note or section | `Mod+N` |
| New HTMX view in current folder | `Mod+G` |
| Open website tab | `Mod+Shift+O` |
| Toggle sidebar | `Mod+B` |
| Toggle side panel | `Mod+J` |
| Toggle bottom panel | `` Mod+` `` |
| Toggle zen mode | `Alt+Z` |

Open **Settings → Keyboard shortcuts**, select a binding, and press a new key
combination; Escape cancels capture, and **Reset to defaults** restores the
table above. In zen mode, press Escape twice quickly to exit. Surface-local
editor and canvas controls are separate from this configurable default list.
