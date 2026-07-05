# Architecture

Neuron is a two-process Electron application with a narrow preload bridge.

## Main process

`src/main/main.ts` owns privileged operations: application windows, repository selection, filesystem reads and writes, file watching, settings persistence, shell access, terminal execution, and approved network requests. The renderer never receives direct Node.js access.

Installed builds load `dist/renderer/index.html`. Development builds load the local Vite server. The packaged demo repository and window icon resolve from `process.resourcesPath`; development resolves them from the project tree.

## Preload bridge

`src/main/preload.ts` exposes explicit IPC methods through `contextBridge`. `contextIsolation` remains enabled and `nodeIntegration` remains disabled. Add new privileged capabilities as small typed methods rather than exposing `ipcRenderer` or Node modules wholesale.

## Renderer

The React renderer owns workspace state, navigation, note tabs, CodeMirror editing, preview rendering, graph interactions, themes, and plugin presentation. `src/renderer/electron.d.ts` describes the bridge available to renderer code.

## Notes and repositories

A repository is an ordinary folder. Neuron scans `.md`, `.mdx`, and `.vw` files, stores paths relative to the selected repository, and writes text without converting the document into a proprietary format. Chokidar reports external changes back to the renderer.

## File-driven surfaces

`.vw` files are small JSON *declarations*, not stored render output. Opening one renders a block view instead of the Markdown editor. `src/renderer/surfaces/` holds the registry: `getSurface(path)` maps the `.vw` extension to `ViewSurface`. View blocks can render static text and metrics, fetch local repository sources for file counts and tables, draw charts, show checklists, and run trusted named actions such as opening the active repository in VS Code.

`neuron.config` is still supported as the internal workspace shell layout. It uses the same layout parser and panel renderers, but it is not a public surface extension.

## Terminal and automations

The main process spawns interactive PTYs with `node-pty` (`terminal:spawn/write/resize/kill`, streamed over `terminal:data`); the renderer renders them with xterm.js (`components/XtermTerminal.tsx`). node-pty ships ABI-stable N-API prebuilds, so packaging sets `npmRebuild: false` and unpacks it from the asar. Automations are named command sequences stored in settings and run one-shot through the existing `terminal:run` bridge.

## Settings

Application and plugin settings are stored as JSON in Electron's user-data directory. A migration path preserves settings created by older AutoNote builds. Credentials are not bundled into renderer assets or committed to the repository.

## Markdown and MDX

CodeMirror provides raw and live editing. The reading/split preview supports headings, lists, tasks, tables, quotes, code, wiki-links, and the built-in MDX component set. Plugin-provided MDX components are registered through the plugin host.

## Plugin boundary

Plugins are local modules activated by the host. A plugin can register commands, panels, and MDX components. Runtime access is capability-based: active note context, note creation/opening, namespaced storage, and approved AI/network bridges. Panels explicitly choose a `side` or `bottom` location.

## Packaging

Vite emits renderer assets to `dist/renderer`; TypeScript emits the main process to `dist/main`. Electron Builder packages those outputs, the canonical icon, and example repository. GitHub Actions performs platform-native release builds from version tags.
