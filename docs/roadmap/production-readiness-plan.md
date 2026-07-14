# Neuron production-readiness roadmap

Date: 2026-07-11 · Baseline commit: `6b88bab` (v1.4.0) · Author: audit pass 1.

This is the durable plan a future contributor executes without this chat. It
records the verified state of the repo, an Obsidian comparison, a
feature-parity matrix, prioritized milestones, a risk register, and a testing
master plan. Companion docs: `docs/plans/json-canvas-enhancements.md` (canvas),
`docs/htmx-views.md` (HTMX platform), `.claude/json-canvas-backlog.md`
(canvas backlog + handoff log).

**Scope of this audit pass:** repository inventory, security spot-audit of
content-rendering paths, governance/CI review, Obsidian reference research,
and one bounded implementation slice. It is *not* a full test-execution audit
— many suites named below do not yet exist and are specified as work, not
claimed as done.

---

## 1. Verified repository inventory

Evidence = files read this pass unless noted "inferred".

| Area | Location | State |
| --- | --- | --- |
| Electron main | `src/main/main.ts` | Windows, IPC, watcher, atomic writes, PTYs, AI/net proxies, web-contents hardening. **Complete-ish.** |
| Preload bridge | `src/main/preload.ts` | `contextBridge` allowlist; no raw `ipcRenderer`. **Complete.** |
| HTMX platform | `src/main/htmx/*` | Loopback server, session tokens, path policy, manifests, capability model. Tested (`tools/htmx-views.test.mjs`). **Complete for its scope.** |
| Renderer shell | `src/renderer/App.tsx` | Single central editor region + sidebars + resizable docks (react-resizable-panels) + right/bottom peek panels. Tabs are a flat `openTabs: string[]`. **Partial** (no split editor groups). |
| Surface registry | `src/renderer/surfaces/index.ts` | Extension→component map (`nhtml`, `db`, `canvas`). **Complete.** |
| Canvas | `src/renderer/canvas/*` + `surfaces/CanvasSurface.tsx` | Model/history/markdown + full editor; `neuron.style` v1. Tested (`tools/canvas-model.test.mjs`). **Complete for Phase 1 + style v1.** |
| DB surface | `src/renderer/surfaces/DbSurface.tsx` | Notion-style typed DB. **Complete** (untested by automation). |
| Markdown/MDX preview | `src/renderer/components/MDXPreview.tsx`, `LiveEditor.tsx`, `mdx-components.tsx` | Hand-rolled line renderer + `Badge`/`Callout`. **Insecure** — see Risk R1 (stored XSS), fixed this pass. Not a real MDX compiler. |
| Frontmatter | `src/renderer/lib/frontmatter/*` | Parse/serialize with round-trip preservation; editable properties UI (`components/properties/`). Tested (`tools/frontmatter.test.mjs`). **Complete.** |
| Editor | `src/renderer/components/Editor.tsx` | CodeMirror source editor. **Complete.** |
| Command palette | `src/renderer/components/CommandPalette.tsx` | Props-drilled action list + plugin commands. **No central command registry.** |
| Keybindings | `src/renderer/lib/keybindings.ts` + `App.tsx` dispatcher + `SettingsPage` editor | Flat `Record<actionId, chord>`; single `window.keydown` dispatcher in App; capture-to-rebind UI. **Partial** — no conflict detection, no scopes, no multi-binding, no versioned schema. |
| Layout | `src/renderer/lib/layout.ts` | Boolean visibility flags only (activityBar/sidebar/rightPanel/bottomPanel/statusBar/zen). **No split-tree engine.** |
| Plugins | `src/renderer/plugins/*` | In-renderer trusted modules (AI providers, terminal, calendar). Capability-ish bridge; **not sandboxed third-party**. |
| Search | `App.tsx` in-memory tag/text filter; HTMX `/search` = bounded workspace scan | **Partial** — no index, no global search UI. |
| Settings | `src/main/main.ts` JSON store + `views/SettingsPage.tsx` | **Complete** for current settings. |
| Theme/design system | `src/renderer/lib/theme.ts`, `components/ui/*`, `index.css` tokens | shadcn/radix primitives + CSS-var tokens. **Complete.** |
| Governance | `README.md`, `LICENSE` (MIT), `.github/{CONTRIBUTING,SECURITY}.md`, `docs/*` | Present. **Partial** — no CODE_OF_CONDUCT, no issue/PR templates. |
| CI | `.github/workflows/ci.yml` | **Only `npm run build`** on windows-latest. Does not run `npm test` or typecheck. **Major gap.** |
| Tests | `tools/*.test.mjs` (esbuild+assert Node scripts) | view-security, frontmatter, htmx-views, canvas-model. No component/E2E/a11y/perf. `npm test` runs the 4 unit suites only. |

### Architectural debt found
- **No central command registry**: palette, keybinding dispatcher, and menus
  each wire actions independently. Blocks layout commands, CLI, and slash menu.
- **Keybinding dispatcher is a single global `keydown`** with no focus scopes
  (App.tsx) — exactly the anti-pattern the layout work must not extend.
- **MDX is not compiled** — it's a bespoke line parser with a raw-HTML escape
  hatch (the XSS). Real MDX (`@mdx-js`) is a dependency but appears unused by
  the preview path (inferred; `@mdx-js/mdx` in package.json).
- **CI runs neither tests nor typecheck** → the two historical TS errors and
  any regression can merge silently.
- **README still advertises removed `.vw` block views** (stale after the HTMX
  migration). Docs drift.
- **`any` usage** in AI proxy responses (`main.ts`), acceptable but untyped.

---

## 2. Obsidian comparison (reference research, 2026-07-11)

Sources: obsidian.md/changelog, obsidian.md/help/plugin-security (fetched this
pass). Used only to identify mature workflows — no code/branding copied.

- Recent Obsidian: **CLI** (v1.12.2, scripting/automation), revamped settings
  window with search + keyboard/Vim nav (v1.13.0), **Bases** DB-view
  improvements (filter toolbar, drag-drop import, row menus), image resize,
  attachment cleanup, iOS share sheet, Mermaid auto-render.
- Plugin security (quoted): plugins "inherit Obsidian's access levels"; can
  "access files on your computer", "connect to the internet", "install
  additional programs"; Restricted Mode "prevent[s] third-party code
  execution" by default. **Neuron's differentiator:** capability-scoped HTMX
  views + sandboxed webviews are already a stronger model than Obsidian's
  all-or-nothing plugin trust. Preserve and lead with this.
- Workflow references (not requirements): quick switcher, backlinks/unlinked
  mentions, outgoing links, outline, page preview, bookmarks, local+global
  graph, daily notes/templates, file recovery, tab groups/splits/pop-out
  windows, saved workspaces, slides, PDF, web viewer.

---

## 3. Feature-parity matrix

State: ✅ complete · 🟡 partial · 🧪 experimental · ❌ missing. Priority: P0
(safety/blocking) → P3 (nice-to-have). Complexity: S/M/L/XL.

| Feature | Neuron | Evidence | Obsidian ref | Value | Cx | Risks | Priority / Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Workspace open / switch | ✅ | main.ts repo mgmt | vaults | High | — | — | done |
| File/folder ops | ✅ | notes:* IPC, Sidebar | ✓ | High | — | data-loss (see R4) | done |
| Tabs (flat) | 🟡 | App.openTabs | tab groups/splits | High | — | — | M2 |
| **Split editor groups / layout tree** | ❌ | layout.ts booleans only | splits, stacks, pop-out | High | XL | perf, persistence | **M2** |
| Editor modes (source/split/reading/live) | ✅ | App.tsx, LiveEditor | ✓ | High | — | — | done |
| Markdown render | 🟡 | MDXPreview | ✓ | High | — | **XSS R1** | P0 (fixed this pass) |
| MDX components | 🟡 | mdx-components | n/a | Med | L | exec policy | M6 |
| Internal `[[links]]` | 🟡 | link regex in App/panels | ✓ | High | M | rename safety | M3 |
| **Backlinks / unlinked mentions** | ❌ | — | ✓ | High | M | index perf | **M3** |
| Outgoing links panel | ❌ | — | ✓ | Med | S | — | M3 |
| Outline / document symbols | ❌ | — | ✓ | Med | M | — | M3 |
| Page (hover) preview | ❌ | — | ✓ | Med | M | perf, XSS | M3 |
| Tags view | 🟡 | sidebar tag filter | ✓ | Med | S | — | M3 |
| Properties | ✅ | frontmatter/* | ✓ | High | — | — | done |
| Search (indexed, global UI) | 🟡 | in-memory scan | ✓ | High | L | perf | M5 |
| Quick switcher | ❌ | — | ✓ | High | M | — | M1/M3 |
| Slash commands | ❌ | — | ✓ | Med | M | IME safety | M6 |
| Canvas | ✅ | canvas/* | ✓ | High | — | — | done (Phase 1) |
| DB views | ✅ | DbSurface | Bases | High | — | untested | M5 |
| HTMX views (capability-scoped) | ✅ **exceeds** | htmx/* | n/a | High | — | see R2 | done |
| Command palette | 🟡 | CommandPalette | ✓ | High | M | — | M1 |
| **Command registry (central)** | ❌ | — | ✓ | High | M | — | **M1** |
| Hotkeys (scopes, conflicts, multi) | 🟡 | keybindings.ts | ✓ | High | M | IME, dbl-fire | **M1** |
| Bookmarks | ❌ | — | ✓ | Med | M | — | M3 |
| Graph (local first) | ❌ | GraphCanvas exists for note links | ✓ | Med | L | perf, a11y | M3 |
| Daily notes / templates | ❌ | daily-calendar plugin only | ✓ | Med | M | unsafe eval | M7 |
| **File recovery / snapshots** | ❌ | atomic write only | file recovery | High | L | data-loss | **M4** |
| Note composer (split/merge) | ❌ | canvas "convert to note" only | ✓ | Med | M | link updates | M4 |
| External-change / conflict handling | 🟡 | lastWritten suppression | ✓ | High | M | **R4 races** | M4 |
| Import / export | ❌ | — | ✓ | Med | L | lossy | M7 |
| CLI | ❌ | — | ✓ (1.12.2) | Med | L | security | M6 |
| Plugin/extension sandbox | 🟡 | in-renderer trusted | restricted mode | High | XL | RCE | M6 |
| Accessibility | 🟡 | aria on many controls | ✓ | High | M | — | M8 |
| Localization | ❌ | — | ✓ | Low | L | — | M8 |
| Update flow | ✅ | electron-updater | ✓ | High | — | signing | M9 |
| Packaging / release | ✅ | electron-builder, release.yml | ✓ | High | — | unsigned | M9 |
| CI test gates | ❌ | build only | ✓ | High | S | — | **M0** |

**Where Neuron already leads Obsidian:** capability-scoped, sandboxed HTMX
view platform with per-view tokens and path policy; JSON Canvas unknown-field/
unknown-type round-trip preservation; versioned `neuron.style` extension.

---

## 4. Milestones

Each milestone leaves the app working, ships tests, and updates docs.

### M0 — Baseline correctness & cleanup (start here after this pass)
- Make CI run `typecheck` + `npm test` + `build` (currently build-only).
- Add a repo-wide `typecheck` script that cannot silently exclude files.
- Fix/clear the historical TS errors (already fixed at `6b88bab`; verify none
  remain).
- Fix stale README (`.vw` → `.nhtml`), add CODE_OF_CONDUCT, issue/PR templates.
- **DoD:** PR CI fails on type errors or failing tests; README accurate.

### M1 — Command & keyboard architecture  ← *documented next slice*
- Central typed command registry: `{ id, title, scope, when(), run(), defaultKeys[] }`.
- Focus-aware keyboard dispatcher with scopes: global, editor, canvas, modal,
  input, htmx-webview. Respects `defaultPrevented`, inputs, IME composition.
- Versioned hotkey settings schema + migration from the current flat map.
- Conflict detection: exact, prefix (future chords), OS-reserved, scope
  collisions; multiple bindings per command; add/remove/disable/reset in UI.
- Palette + settings editor consume the registry; no scattered `keydown`.
- Non-destructive **"Layout actions"** placeholder command (opens a stub
  palette) so M2 has an entry point. `Ctrl/Cmd+L` decision: see §7.
- **Tests:** command registration, chord normalization, conflict detection,
  scope precedence, migration. **DoD:** existing bindings preserved via
  migration; editor/canvas/HTMX shortcuts unaffected; no double-fire.

### M2 — Workspace layout engine
- Serializable split-tree: root → split nodes (orientation, ratios, min sizes,
  stable IDs) → tab-group leaves (ordered tabs, activeId, pin/preview/focus).
- Content state stays separate from layout state; no buffer duplication on move.
- Semantic layout commands (split/close/focus-directional/move-tab/maximize/
  equalize/rotate) via the M1 registry.
- Deterministic geometric focus navigation (overlap-then-distance, unit-tested).
- Versioned persisted-layout schema + migrations; missing-file placeholders.
- Saved workspaces (layout + view identities + sidebar state; no file content).
- **Defer** pop-out windows, stacked/linked views to a sub-milestone with data
  model notes. **DoD:** split/move/focus/restore all keyboard-driven + tested.

### M3 — Navigation & linked-knowledge views
Link index (filename/alias/heading/block, case rules); backlinks + unlinked
mentions; outgoing links; outline; page preview (safe renderer, cancellation);
bookmarks (stable descriptors); quick switcher; local graph first.

### M4 — Recovery & data integrity  (**high production priority**)
Periodic local snapshots/journal with retention limits + restore preview;
harden watcher/lastWritten races; tests for interrupted writes, disk-full,
rename races, deleted-open-file, line-ending preservation, crash recovery;
note composer with link updates + undo.

### M5 — Search & metadata scalability
Incremental index service; structured search + filters + ranking +
cancellation + excluded paths; large-vault benchmarks (100 / 10k / 100k).

### M6 — Extensibility & security
Capability-based extension model (lead with HTMX); restricted/safe mode;
optional CLI over the same command/service layer (no arbitrary eval); slash
menu; MDX execution policy decision.

### M7 — Examples & onboarding
Restructure `examples/` vs `test-fixtures/` (see §8); polished reference
workspace; per-example READMEs + learning-sequence index.

### M8 — Accessibility, localization, UX polish
Keyboard-only audit, focus order/visibility, contrast, reduced motion, 200%
zoom, screen-reader labels, splitter/tab semantics, color-independent states;
UI quality checklist applied to every screen; i18n scaffolding.

### M9 — Packaging, CI, releases, governance
Signed artifacts + checksum publication; release-smoke tests; dependency
audit + pinned actions; least-privilege workflows; release-readiness checklist.

---

## 5. Risk register

| ID | Risk | Likelihood | Impact | Components | Current control | Remaining exposure | Owner/Milestone | Verifying test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **R1** | **Stored XSS via note HTML → RCE** (note content with event handlers / nested `<img onerror>` injected by `dangerouslySetInnerHTML`) | High | **Critical** | MDXPreview.tsx:317 | **Sanitizer added this pass** (allowlist DOM walk, drops handlers/scripts/unsafe URLs) | Residual: other render paths (LiveEditor) share MDXPreview — verify | **fixed this pass** | `tools/sanitize-html.test.mjs` |
| R2 | HTMX token/capability escalation, SSRF, cross-view | Low | High | src/main/htmx/* | tokens, path policy, CSP, Host/Origin checks, rate limits | Needs adversarial test suite | M6 | `test:security` (todo) |
| R3 | Malicious plugin (in-renderer, full access) | Med | Critical | plugins/* | trusted-only, no 3rd-party install path yet | No sandbox for future 3rd-party | M6 | extension-security suite (todo) |
| R4 | Data loss on watcher/save race, crash mid-write, external replace | Med | High | main.ts, surfaces | atomic temp+rename, lastWritten suppression | No snapshots; race tests missing | M4 | data-integrity suite (todo) |
| R5 | Unsafe auto-update (unsigned) | Med | High | electron-updater, release.yml | GitHub release provenance | No code signing | M9 | release-smoke (todo) |
| R6 | Corrupted layout/settings migration | Low | Med | (future M2), settings | resolveLayout ignores junk | No versioned migration yet | M2 | migration unit tests |
| R7 | CI merges regressions (no test gate) | High | Med | .github/workflows/ci.yml | none | build-only CI | M0 | CI itself |
| R8 | Prototype pollution via parsed JSON/YAML | Low | High | frontmatter, canvas, htmx | htmx interpolation blocks `__proto__`; canvas spreads | Verify YAML schema safety | M6 | fuzz suite (todo) |

---

## 6. Testing master plan

**Current reality:** only unit-level `tools/*.test.mjs` exist; `npm test` runs
4 suites; CI runs none. Everything below except the four existing suites and
the new sanitizer suite is **specified work, not done.**

- **Unit** (`test:unit`): extend existing esbuild+assert scripts — path/URL
  policy, frontmatter, canvas geometry/history/style, **+ command registry,
  chord normalization, conflict detection, focus-neighbor math, layout-tree
  reducers, migrations** (M1/M2).
- **Component** (`test:components`): needs a DOM runner (none today — decision
  gate). Tabs, splits, palette, hotkey editor, properties, canvas toolbar,
  HTMX states, dialogs, focus traps, a11y labels.
- **Integration** (`test:integration`): open→edit→save→external-edit→restart;
  splitting/moving tabs; undo/redo; `.nhtml` sessions; permission prompts.
- **Electron E2E** (`test:electron`): launch production-like app; assert
  webviews cannot reach `require`/`process`/Electron/other cookies/fs.
- **Security** (`test:security`): malicious MD/MDX/YAML/Canvas/HTML/SVG/CSS/
  HTMX manifests; traversal, symlink escape, proto-pollution, XSS, SSRF, CSRF,
  token forgery, zip bombs. Seed: the new `sanitize-html.test.mjs`.
- **A11y / Performance / Visual / Cross-platform / Release-smoke:** per mandate
  §, deferred to M8/M9 with fixtures generated by scripts (not committed vaults).

**Test-command hygiene (M0):** introduce non-overlapping `test:unit`,
`typecheck`, `lint`, `build`, and a `test:all` that CI runs. `npm test` must
not pass while major suites are skipped — until those suites exist, keep
`npm test` = unit suites but make CI additionally run `typecheck`.

---

## 7. `Ctrl/Cmd+L` decision (for M1)

Analysis of current bindings (`keybindings.ts`): defaults use `mod+k`
(palette), `mod+n`, `mod+g`, `mod+shift+o`, `mod+b`, `mod+j`, `mod+\``,
`alt+z`. `mod+l` is **free**. However, HTMX webviews and any future browser
view treat `Ctrl+L` as address-bar focus, and the editor may want it.

**Decision (Option 1 + 3):** `mod+l` becomes the *configurable default* for a
normal **"Open layout actions"** command in the **workspace scope only** (not
delivered into editor/webview scopes). It opens a compact layout palette
(split/move/focus/resize/maximize/save/restore). Provide `mod+shift+l` as an
alternate default. Fully rebindable; conflict detector must flag it if a user
maps it into editor scope. macOS shows `⌘L`. Document in settings help text.

---

## 8. Example-folder restructuring plan (M7)

Today everything lives in `examples/demo-repo/` (mixes onboarding content,
troubleshooting fixtures like `properties/invalid-yaml.md`, and test data).
Target split (generate large/fixture content via scripts, don't commit big
vaults):

```
examples/getting-started/   welcome, nav hub, links, tags, properties, tasks
examples/canvas/            interop + neuron.style, foreign-field preservation
examples/databases/         typed DB views
examples/htmx-views/        read-only beginner example BEFORE writable ones
examples/properties/        happy-path types (no invalid files here)
test-fixtures/              invalid-yaml, malformed/future canvas, denied perms
docs/tutorials/             learning-sequence index
```
Each user-facing example gets a README (what it shows, how to open, required
permissions, platforms, exercises). HTMX examples: least-privilege manifests,
no remote deps, accessible forms, destructive demos confined to example-owned
data folders.

---

## 9. Non-goals (explicit)

Arbitrary code execution; generic filesystem proxy; raw `ipcRenderer` in the
renderer; unsafe template evaluation; unrestricted third-party plugins with
Node access; deleting user data/config without migration + backup; cloning
Obsidian's UI/branding/private APIs; adding features solely because Obsidian
has them; speculative rewrites of stable subsystems (canvas model, HTMX
server, frontmatter) for stylistic uniformity.

---

## 10. Definition of "production ready" (release gate)

All blocking suites green; zero unexplained type errors; migration tests for
every schema change; docs + changelog updated; signed/verifiable artifacts;
clean-install smoke test passes; documented rollback. `npm run build` passing
is **not** sufficient.

---

## 11. This session's bounded slice

Chose the **R1 security fix** over the default M1 slice, per the mandate's
"more urgent safety issue" carve-out — a stored XSS reaching the privileged
renderer outranks a layout-prep refactor.

- Added `src/renderer/lib/sanitize-html.ts`: allowlist DOMParser walk → React
  nodes (drops `script`/`style`/`iframe`/event handlers/`javascript:`+`data:`
  URLs; `href`/`src` via existing `safeUrl`). Mirrors `canvas/markdown.tsx`.
- `MDXPreview.tsx` raw HTML path now renders through it instead of
  `dangerouslySetInnerHTML`.
- Test: `tools/sanitize-html.test.mjs`, wired into `npm test`.

**Exact next task:** M0 (make CI run typecheck + `npm test`), then the M1
command/keybinding foundation as specified in §4 and §7.
