# JSON Canvas enhancements — investigation and implementation plan

Status: Phase 1 + the `neuron.style` v1 extension implemented (2026-07-11).
Living document; reconcile against `.claude/json-canvas-backlog.md` for what
remains. Implementation reports: §10.

## 1. Current architecture (investigation results)

### How a `.canvas` file flows through Neuron today

1. **Open** — `App.tsx` treats every workspace file uniformly: `notes:read`
   IPC returns the raw text, `getSurface(path)` (`src/renderer/surfaces/index.ts`)
   maps the `canvas` extension to `CanvasSurface`, which App renders inside
   `SurfaceBoundary` (crash isolation). The header's Preview/Source toggle
   swaps the surface for the raw CodeMirror editor on the same content.
2. **In-memory state** — `CanvasSurface.tsx` (previously ~570 lines, one
   component) parsed the JSON into a `CanvasDoc { nodes, edges }` held in
   React state, with refs mirroring doc/pan/zoom for gesture handlers.
3. **Render** — absolutely-positioned divs inside one transformed container
   (`translate(pan) scale(zoom)`); groups render first (behind), then one SVG
   for all edges (cubic Bézier, arrow marker), then cards. No virtualization.
4. **Edit** — gestures (pan/move/resize/connect) attach window-level pointer
   listeners for their duration. In-flight changes `stage()` (state only);
   gesture end / blur `write()`s.
5. **Save** — `write()` serializes the whole doc (tab-indented, matching
   Obsidian) and calls `notes:write` IPC, which performs an **atomic write**
   (temp file + rename) in the main process. `lastWritten` remembers the text
   so the watcher echo of our own write is ignored.
6. **External changes** — chokidar (`notes:changed`) → re-read → adopt if the
   text differs from `lastWritten`. Obsidian/git/script edits land live.
7. **Shared infra** — theme via CSS variables (`--canvas`, `--surface`,
   `--ink*`, `--accent`, `--divider`); URL security via
   `lib/view-security.ts` (`safeUrl`, 2 MB doc budget); tests are
   framework-free Node scripts in `tools/*.test.mjs` (esbuild-transpiled,
   `assert`); keyboard chords in `lib/keybindings.ts`; command palette is a
   props-drilled component (no global command registry); radix primitives
   (context menu, dropdown, dialog…) exist in `components/ui/`.

### Weaknesses found

| Weakness | Impact |
| --- | --- |
| Top-level unknown JSON keys dropped on parse (`{nodes, edges}` reconstruction) | **Data loss** for files from richer tools; violates JSON Canvas round-trip expectations. (Node/edge-level unknown props happened to survive because objects were reused/spread.) |
| No undo/redo | Any mistake (delete, drag, edit) is unrecoverable except via git |
| Single-item selection only | No multi-move, batch color, batch delete, alignment |
| No clipboard, no duplicate | Can't copy structures within or across canvases |
| No z-order commands | Array order is z-index per spec, but users can't change it |
| Unknown node types rendered as broken empty cards (`type` narrowed to 4 literals but data flows through) | Foreign extensions look broken; risk of accidental edits |
| Text nodes render plain text | Spec says text is Markdown |
| `fromEnd`/`toEnd` (spec optional arrow endpoints) ignored | Direction can't be controlled |
| No validation diagnostics | Malformed file = one generic error line |
| Broken file references silent | Card shows "Not loaded" with no repair affordance |
| Everything in one component | New features multiply an already-large file |
| No canvas tests at all | Regressions invisible |

Not broken (keep as-is): atomic write + echo suppression + watcher adoption is
a sound persistence loop; per-gesture window listeners are simple and correct;
CSS-variable theming; SurfaceBoundary isolation; Source-mode escape hatch.

## 2. Compatibility rules (binding)

- The official spec (jsoncanvas.org) is the baseline: `nodes[]` + `edges[]`,
  node types `text|file|link|group`, geometry `x/y/width/height`, colors
  `"1"–"6"` or hex, edges with `fromNode/toNode`, optional
  `fromSide/toSide/fromEnd/toEnd/color/label`. Node array order = z-order.
- Standard fields are never renamed, reinterpreted, or defaulted-into-existence.
- Unknown **top-level**, **node-level**, and **edge-level** properties survive
  load→edit→save byte-for-byte in structure (proven by round-trip tests).
- Unknown node **types** are preserved untouched and rendered as a read-only
  fallback card (movable, but content never modified).
- Neuron-only data lives in a single namespaced `neuron` object per node/edge/
  document, carrying `version: 1`. Nothing outside that object is Neuron-owned.
  Files never gain a `neuron` key unless a Neuron-only feature is actually used.
- Serialization stays tab-indented + trailing newline (Obsidian convention).
- Malformed files show diagnostics and a Source-mode pointer; they are never
  auto-"fixed", truncated, or blanked.

## 3. Proposed architecture

Split by responsibility, matching repo conventions (cf. `lib/frontmatter/`),
not by a maximal folder taxonomy — this codebase favors few, cohesive modules:

```
src/renderer/canvas/
  model.ts       — types, parse (with diagnostics), serialize, unknown-field
                   preservation, geometry/side/path utils, fragment
                   copy/paste helpers (ID regeneration), z-order ops
  history.ts     — undo/redo as an immutable-snapshot stack (docs are
                   immutable objects; a snapshot is a reference, so cost ≈ 0).
                   Coalescing is structural: only committed writes push.
  markdown.tsx   — minimal safe Markdown renderer for text cards (React
                   elements only, no HTML injection path)
src/renderer/surfaces/CanvasSurface.tsx
                 — rendering + interaction only; consumes the modules above
tools/canvas-model.test.mjs
                 — unit + round-trip tests (established esbuild/assert stack)
```

Rules: parsing never touches the DOM; persisted document state (CanvasDoc) is
immutable and distinct from transient interaction state (selection, viewport,
gesture, editing — React state, never serialized); every committed mutation
goes through one `write()` chokepoint that pushes history and persists;
styling uses theme tokens; Electron access stays behind the existing preload
methods (`notes:read/write`, `views:file`).

Why snapshots instead of an operation/command class hierarchy: documents are
capped at 2 MB and updates are already immutable, so retaining previous doc
references gives correct, trivially-coalesced undo for free. An operation
model would add ~10 classes and inverse bookkeeping for zero user-visible
gain at this scale. The `write()` chokepoint preserves the option to switch
later without touching call sites (recorded in the backlog).

## 4. Feature matrix (candidates evaluated)

Value/complexity/risk: L(ow) M(ed) H(igh). Phase 1 = this change.

| # | Feature | User value | Complexity | Risk | Compatibility impact | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Unknown-field + unknown-node-type preservation | H (data safety) | M | L | Required by spec ethos | **1** |
| 2 | Parse diagnostics (errors vs recoverable warnings) | M | L | L | None | **1** |
| 3 | Undo/redo with drag/typing coalescing | H | M | M | None | **1** |
| 4 | Multi-selection (shift-click, marquee) + batch move/delete/color | H | M | M | None | **1** |
| 5 | Copy/cut/paste/duplicate as JSON Canvas fragments (cross-canvas via system clipboard) | H | M | L | Fragment format = spec subset | **1** |
| 6 | Z-order commands (front/back) | M | L | L | Uses spec's array-order rule | **1** |
| 7 | Markdown rendering in text cards (safe subset) | H | M | M (sanitize) | Spec-aligned (text is MD) | **1** |
| 8 | Edge arrows: direction toggle, reverse, no-arrow (`fromEnd`/`toEnd`) | M | L | L | Standard fields | **1** |
| 9 | Context menus (background/node/edge) | H | L | L | None | **1** |
| 10 | Keyboard: nudge, Escape, select-all, delete, undo chords | H | L | L | None | **1** |
| 11 | Alignment + distribution on selection | M | L | L | None | **1** |
| 12 | Zoom controls (buttons, fit selection, reset) | M | L | L | None | **1** |
| 13 | Broken file-reference indicator | M | L | L | None | **1** |
| 14 | Snap-to-grid toggle | M | L | L | None | **1** |
| 15 | `neuron` style extension (border, font size, shape, presets) | H | M | M | Namespaced, versioned | 2 |
| 16 | Style presets (Idea/Question/Task/Decision…) | M | M | L | Rides on #15 | 2 |
| 17 | Node behavior flags (locked, pinned, hidden) via `neuron` | M | M | L | Namespaced | 2 |
| 18 | Minimap | M | M | M (perf) | None | 2 |
| 19 | Canvas search + match stepping + fade non-matches | H | M | L | None | 2 |
| 20 | Drag notes from sidebar / OS files onto canvas | H | M | M (DnD plumbing) | None | 2 |
| 21 | Paste image from clipboard (writes asset file + file node) | M | M | M (fs writes) | Standard file node | 2 |
| 22 | Group auto-fit / padding / drag-into-out membership rules | M | M | M | Containment stays geometric (spec-compatible) | 2 |
| 23 | Tidy/grid/stack layouts (one-step undo) | M | M | M | None | 3 |
| 24 | Templates (file-based, ID regen on insert) | M | M | L | Plain .canvas files | 3 |
| 25 | Viewport memory per canvas (app settings, not file) | L | L | L | Editor state, kept out of file | 3 |
| 26 | Export selection as new canvas / compatibility export (strip `neuron`) | M | L | L | Improves interop | 3 |
| 27 | PNG/SVG export | M | H | M | None | 3 |
| 28 | Live Markdown note preview with backlinks/tags metadata | M | H | M | Degrades to std file node | 3 |
| 29 | Task checkboxes with status rollup at group level | M | H | M | MD tasks stay in text | 3 |
| 30 | Mermaid / Markdown-outline import-export | L | H | M | Lossy by nature | 4 |
| 31 | Query/dynamic collection nodes | M | H | H | Needs careful fallback | 4 |
| 32 | Edge orthogonal routing around nodes | L | H | M | None | 4 |
| 33 | AI-assisted canvas ops (summarize cluster, suggest links) | M | H | H | Must not gate core editing | 4 |
| 34 | Spatial index + viewport culling for 5k nodes | M | H | M | None | When benchmarks demand |

## 5. Selected Phase 1 scope and why

**Data safety, undo, multi-select editing, clipboard, and spec completeness
(items 1–14).** Rationale: the prompt's own priority order (data integrity →
persistence → selection/undo/clipboard → editing) matches what investigation
found broken. Everything visual (styles, minimap, layouts) builds on a
selection/history/model foundation — shipping styles first would mean
re-plumbing them through undo later. Phase 1 leaves the app fully working,
is reviewable as one coherent change, and every later phase is additive.

Deferred (recorded in backlog with reasons): `neuron` style system (needs the
inspector UX decision), drag-and-drop, search, minimap, layouts, templates,
exports, dynamic nodes.

## 6. Risks, security, performance

- **Risk: refactor regressions** — mitigated by keeping the persistence loop
  identical (same write/echo/watch pattern) and adding the first-ever canvas
  test suite before/with the change.
- **Risk: undo vs external edits** — watcher adoption clears redo and pushes
  the adopted state as a new history entry; undo never resurrects a state the
  file never had. Documented in code.
- **Security: Markdown rendering** — custom renderer emits React elements
  only (no `dangerouslySetInnerHTML`), escaping is inherent; links go through
  `safeUrl`; no images-from-web in text cards; no HTML passthrough. Unknown
  node content is never executed or interpreted.
- **Security: clipboard paste** — pasted JSON is validated by the same parser
  (budgets, shape checks) before insertion; IDs regenerated; oversized
  payloads rejected.
- **Performance** — Phase 1 keeps the render model (no virtualization). The
  2 MB doc budget bounds worst cases; history holds references, not copies.
  Baseline measurements and culling are deferred until a benchmarked need
  (backlog: performance follow-ups).

## 7. Testing strategy

`tools/canvas-model.test.mjs` (esbuild + assert, matching the repo's stack):
parse/serialize round-trips (standard file, unknown top-level/node/edge
fields, unknown node types, `neuron` extension data, malformed inputs,
duplicate IDs, dangling edges), fragment copy/paste ID regeneration and
geometry offsetting, z-order ops, alignment/distribution math, history
push/undo/redo/cap/coalesce semantics, markdown renderer safety (no raw HTML,
`javascript:` links dropped). Component/E2E tests are a recorded gap — the
repo has no component test runner, and adding one is out of scope here.

## 8. Migration & rollback

No file migration: Phase 1 writes only standard fields (plus whatever was
already in the file). No settings migration. Rollback = revert the commit;
files saved by the new code remain valid for the old code and other tools.

## 9. Definition of done (Phase 1)

Standard files open/edit/save interoperably; unknown data round-trips
(tested); undo/redo works across all mutations; multi-select
move/delete/color/align/z-order work; clipboard within and across canvases
works; text cards render Markdown safely; unsupported types render as
preserved fallbacks; type check + full test suite + production build pass;
docs and `.claude/json-canvas-backlog.md` updated.

## 10. Implementation status reports

### 2026-07-11 — Phase 0 + Phase 1 (foundation scope)

All matrix items 1–14 shipped. New modules: `src/renderer/canvas/model.ts`
(parse/serialize with diagnostics + unknown-field preservation, geometry,
fragments, z-order, align/distribute), `canvas/history.ts` (snapshot undo,
cap 100, coalesced via the stage→flush chokepoint), `canvas/markdown.tsx`
(React-elements-only renderer; raw HTML inert, `javascript:` links dropped);
`surfaces/CanvasSurface.tsx` rewritten to interaction/rendering only.
Features: parse warnings badge, undo/redo, Shift-click + marquee
multi-selection, batch move/color/delete, align/distribute,
front/back z-order, copy/cut/paste/duplicate as standard JSON Canvas
fragments (system clipboard, ID regeneration), snap-to-grid, arrow-key nudge,
`Ctrl+A/C/X/V/D/Z`, context menus (background/node/edge), `fromEnd`/`toEnd`
arrow controls + reverse, missing-file badges, unsupported-node fallback
cards, zoom controls (fit all/selection). Verified: `npm test` (4 suites),
renderer typecheck (canvas-clean; two pre-existing failures in unrelated
uncommitted files — exact text in the backlog), `npm run build`. Key
decisions: snapshot undo over operation classes (§3); Shift+drag marquee to
preserve pan muscle memory; foreign node types render read-only.

### 2026-07-11 — `neuron.style` extension v1 (narrow scope)

Versioned `neuron` extension shipped per §2's rules: `getNodeStyle` validates
field-by-field (partial objects work; out-of-range values ignored);
`setNodeStyle` creates `neuron` lazily on first nonstandard change, removes
it when the last style clears, preserves unknown sibling keys, and refuses to
edit unsupported future versions (read-only preservation). Properties (v1
only): `shape` (rectangle/rounded/pill/ellipse), `borderStyle`
(solid/dashed/dotted), `borderWidth` (0–8), `textAlign`, `fontSize` (8–64),
`opacity` (0.05–1), `preset` (provenance). Standard `color` stays
authoritative and is never duplicated into the extension; presets
(idea/question/warning/decision) write concrete props + the standard color so
other apps degrade correctly. Multi-selection styling is one doc change = one
undo entry. UI: toolbar palette button + context-menu "Style…" open a compact
panel; groups excluded from styling in v1. Icons, shadows, cover images,
arbitrary fonts, and unrestricted colors deliberately deferred until this
foundation proves stable. Tests cover malformed/future/partial extensions,
lazy create/remove, sibling preservation, multi-apply, presets, and exact
round-trips.
