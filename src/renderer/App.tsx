import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Eye, FileCode2 } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import MDXPreview from './components/MDXPreview';
import LiveEditor from './components/LiveEditor';
import TitleBar from './components/TitleBar';
import StatusBar from './components/StatusBar';
import RightPanel from './components/RightPanel';
import FloatingGraph from './components/FloatingGraph';
import RepositoryOnboarding from './components/RepositoryOnboarding';
import CreateModal from './components/CreateModal';
import CommandPalette from './components/CommandPalette';
import NoteTabs from './components/NoteTabs';
import RepositoriesPage from './views/RepositoriesPage';
import PluginsPage from './views/PluginsPage';
import SettingsPage from './views/SettingsPage';
import ComponentGallery from './views/ComponentGallery';
import { TooltipProvider } from './components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { PluginProvider } from './plugins/host';
import { builtinPlugins } from './plugins/builtin';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { getSurface } from './surfaces';
import LayoutSurface from './surfaces/LayoutSurface';
import './surfaces/HtmxViewSurface'; // registers the .html view surface
import './surfaces/DbSurface'; // registers the .db database surface
import './surfaces/CanvasSurface'; // registers the .canvas JSON Canvas surface
import './surfaces/MermaidSurface'; // registers the Mermaid diagram surface
import { SurfaceBoundary } from './surfaces/SurfaceBoundary';
import { EDIT_MODES, type EditMode } from './surfaces/panels';
import { Segmented } from './components/ui/segmented';
import BrowserView from './components/BrowserView';
import { DEFAULT_BINDINGS, eventToChord, resolveBindings, type Bindings } from './lib/keybindings';
import { DEFAULT_LAYOUT, resolveLayout, type WorkbenchLayout } from './lib/layout';
import WorkspaceExplorer from './views/WorkspaceExplorer';
import { ExplorerProvider } from './lib/explorer-state';
import {
  addRecent, pruneRecents, recentsKey, resolveRecents, type RecentEntry,
} from './lib/workspace-explorer';
import { registerTerminalOpener } from './lib/terminal-bus';
import ActivityRail, { type SidebarMode } from './components/ActivityRail';
import { parseFrontmatter, normalizeStringList } from './lib/frontmatter';

interface PropertiesSettings { removeEmpty: boolean; showInReading: boolean; collapsedByDefault: boolean }
const DEFAULT_PROPERTIES_SETTINGS: PropertiesSettings = { removeEmpty: true, showInReading: true, collapsedByDefault: false };

const isUrl = (s: string | null): s is string => !!s && /^https?:\/\//.test(s);

// The workspace's own config lives in a .neuron folder at the workspace root.
const SHELL_CONFIG = '.neuron/layout.json';
import type { RepositoryInfo } from './electron.d';
import { applyTheme, DEFAULT_APPEARANCE, normalizeAppearance, PRESETS, type Appearance } from './lib/theme';

interface NoteData { path: string; content: string }
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type View = 'notes' | 'repositories' | 'plugins' | 'settings' | 'gallery';
// The same three modes the layout shell offers, under the same names. This was
// 'raw' here and 'split' there, presented as a dropdown here and a button row
// there, so the identical choice looked and read like two different features
// depending on whether the workspace happened to have a layout.json.
type EditorMode = EditMode;

// Default content for new .html views. Plain HTML + htmx attributes;
// Neuron serves it from the local view server with the neuron-view stylesheet.
const HTMX_VIEW_TEMPLATE = `<h1>New HTMX view</h1>
<p>This is ordinary HTML with <a href="https://htmx.org">htmx</a> attributes.
It talks to Neuron's local API — see <code>GET /api/v1/context</code>.</p>

<section class="neuron-grid cols-3">
  <div class="neuron-card" hx-get="/api/v1/fragments/workspace-summary" hx-trigger="load" hx-swap="innerHTML">
    Loading…
  </div>
</section>

<section class="neuron-card">
  <form hx-get="/api/v1/search" hx-target="#search-results"
        hx-trigger="submit, input changed delay:300ms from:#query">
    <label for="query">Search notes</label>
    <input id="query" class="neuron-input" name="query" type="search" autocomplete="off" />
  </form>
  <div id="search-results"></div>
</section>
`;

const NEURON_CONFIG_TEMPLATE = `{
  "direction": "horizontal",
  "children": [
    { "size": 20, "panel": { "type": "tree" } },
    { "size": 52, "group": { "direction": "vertical", "children": [
      { "size": 70, "panel": { "type": "editor" } },
      { "size": 30, "panel": { "type": "terminal" } }
    ] } },
    { "size": 28, "panel": { "type": "graph", "scope": "active", "title": "Linked notes" } }
  ]
}
`;

export default function App() {
  const [repository, setRepository] = useState<RepositoryInfo | null>(null);
  const [recents, setRecents] = useState<RepositoryInfo[]>([]);
  const [repoReady, setRepoReady] = useState(false);

  const [notes, setNotes] = useState<string[]>([]);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [noteContent, setNoteContent] = useState('');
  const [notesData, setNotesData] = useState<NoteData[]>([]);
  const [view, setView] = useState<View>('notes');
  const [editorModes, setEditorModes] = useState<Record<string, EditorMode>>({});
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [appearanceReady, setAppearanceReady] = useState(false);

  // The workspace explorer.
  //
  // `atHome` is deliberately its own flag rather than being inferred from
  // `selectedNote === null`. Having no file open implies the explorer, but the
  // reverse is not true: clicking the workspace title must show it WITHOUT
  // closing anyone's tabs, so home has to be a place you can navigate to while
  // a note is still open. Conflating the two is how the explorer either refuses
  // to appear or refuses to go away.
  const [atHome, setAtHome] = useState(false);
  const [explorerFolder, setExplorerFolder] = useState('');
  const [explorerRecents, setExplorerRecents] = useState<RecentEntry[]>([]);

  // Workbench layout: which shell regions are visible. Persisted per user.
  const [layout, setLayout] = useState<WorkbenchLayout>(DEFAULT_LAYOUT);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('files');
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const zenPrevRef = useRef<WorkbenchLayout | null>(null);
  const lastEscapeRef = useRef(0);

  const commitLayout = useCallback((next: WorkbenchLayout) => {
    setLayout(next);
    void window.electronAPI?.settings.set('layout', next);
  }, []);

  const patchLayout = useCallback((patch: Partial<WorkbenchLayout>) => {
    const prev = layoutRef.current;
    let next = { ...prev, ...patch };
    if (patch.zen === true && !prev.zen) {
      // Entering zen: hide the chrome, remember what to restore.
      zenPrevRef.current = prev;
      next = { ...next, activityBar: false, sidebar: false, rightPanel: false, bottomPanel: false };
    } else if (patch.zen === false && prev.zen) {
      next = { ...(zenPrevRef.current ?? DEFAULT_LAYOUT), zen: false };
    }
    commitLayout(next);
  }, [commitLayout]);

  useEffect(() => {
    void window.electronAPI?.settings.get<Partial<WorkbenchLayout>>('layout').then((stored) => {
      if (stored) setLayout(resolveLayout(stored));
    });
    void window.electronAPI?.settings.get<Partial<PropertiesSettings>>('properties').then((stored) => {
      if (stored) setPropsSettings({ ...DEFAULT_PROPERTIES_SETTINGS, ...stored });
    });
  }, []);

  const updatePropsSettings = useCallback((next: PropertiesSettings) => {
    setPropsSettings(next);
    void window.electronAPI?.settings.set('properties', next);
  }, []);

  const sidebarOpen = layout.sidebar;
  const rightPanelOpen = layout.rightPanel;
  const bottomPanelOpen = layout.bottomPanel;
  const setSidebarOpen = (fn: (v: boolean) => boolean) => patchLayout({ sidebar: fn(layoutRef.current.sidebar) });
  const setRightPanelOpen = (fn: ((v: boolean) => boolean) | boolean) => patchLayout({ rightPanel: typeof fn === 'boolean' ? fn : fn(layoutRef.current.rightPanel) });
  const graphOverlayOpen = layout.graphOverlay;
  const toggleGraphOverlay = () => patchLayout({ graphOverlay: !layoutRef.current.graphOverlay });
  const setBottomPanelOpen = (fn: ((v: boolean) => boolean) | boolean) => patchLayout({ bottomPanel: typeof fn === 'boolean' ? fn : fn(layoutRef.current.bottomPanel) });

  // A <Run /> button in a note reveals the terminal it is about to write to.
  // Running a command into a panel the user cannot see would hide the one part
  // of this that makes it reviewable.
  useEffect(() => registerTerminalOpener(() => {
    if (!layoutRef.current.bottomPanel) patchLayout({ bottomPanel: true });
  }), [patchLayout]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSection, setCreateSection] = useState('');
  const [createTab, setCreateTab] = useState<'note' | 'section'>('note');
  const [wide, setWide] = useState(true);
  const [bindings, setBindings] = useState<Bindings>(DEFAULT_BINDINGS);
  const [surfaceSourceMode, setSurfaceSourceMode] = useState<Record<string, boolean>>({});
  const [shellConfig, setShellConfig] = useState<string | null>(null);
  const [pendingShellConfig, setPendingShellConfig] = useState<string | null>(null);
  const [propsSettings, setPropsSettings] = useState<PropertiesSettings>(DEFAULT_PROPERTIES_SETTINGS);

  const saveVersion = useRef(0);
  const editorRef = useRef<any>(null);
  const browserCounter = useRef(0);

  // --- Appearance -----------------------------------------------------------
  useLayoutEffect(() => {
    applyTheme(appearance);
  }, [appearance]);

  useEffect(() => {
    if (!window.electronAPI) { setAppearanceReady(true); return; }
    let cancelled = false;
    (async () => {
      const stored = await window.electronAPI?.settings.get<Appearance>('appearance');
      if (cancelled) return;
      const next = normalizeAppearance(stored);
      applyTheme(next);
      setAppearance(next);
      setAppearanceReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!appearanceReady || !window.electronAPI) return;
    void window.electronAPI.settings.set('appearance', appearance).then((result) => {
      if (!result.success) setNotice('Appearance settings could not be saved.');
    });
  }, [appearance, appearanceReady]);

  const handleAppearanceChange = useCallback((next: Appearance) => {
    const normalized = normalizeAppearance(next);
    applyTheme(normalized);
    setAppearance(normalized);
  }, []);

  // --- Repository -----------------------------------------------------------
  const reloadRepoState = useCallback(async () => {
    if (!window.electronAPI) return;
    setRepository(await window.electronAPI.repository.getCurrent());
    setRecents(await window.electronAPI.repository.listRecent());
  }, []);

  useEffect(() => {
    if (!window.electronAPI) { setRepoReady(true); return; }
    (async () => { await reloadRepoState(); setRepoReady(true); })();
    return window.electronAPI.repository.onChanged(() => { void reloadRepoState(); });
  }, [reloadRepoState]);

  const createRepository = useCallback(async () => {
    const repo = await window.electronAPI?.repository.create();
    if (repo) { setRepository(repo); void reloadRepoState(); }
  }, [reloadRepoState]);
  const openRepository = useCallback(async () => {
    const repo = await window.electronAPI?.repository.open();
    if (repo) { setRepository(repo); void reloadRepoState(); }
  }, [reloadRepoState]);
  const switchRepository = useCallback(async (dir: string) => {
    const result = await window.electronAPI?.repository.switch(dir);
    if (result?.success && result.repository) { setRepository(result.repository); setView('notes'); void reloadRepoState(); }
  }, [reloadRepoState]);

  // --- Notes ----------------------------------------------------------------
  const loadNotes = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      const fileList = await window.electronAPI.listNotes();
      setNotes(fileList);
      setOpenTabs((current) => current.filter((note) => fileList.includes(note)));
      setSelectedNote((current) => current && fileList.includes(current) ? current : null);
      // Configuration is reachable in the explorer but is not knowledge: it is
      // not a graph node, it has no wiki-links, its words are not yours, and it
      // should not turn up in a search for something you wrote. `notes` keeps
      // it so it can be opened; `notesData` -- what the graph, tags, search and
      // link index are all built from -- does not.
      const data = await Promise.all(
        fileList
          .filter((path) => !path.startsWith('.neuron/'))
          .map(async (path) => ({ path, content: await window.electronAPI.readNote(path) })),
      );
      setNotesData(data);

    } catch {
      setNotice('Could not load the workspace.');
    }
  }, []);

  useEffect(() => {
    if (!repository) { setNotes([]); setNotesData([]); setTags([]); setSelectedNote(null); return; }
    loadNotes();
  }, [repository, loadNotes]);

  useEffect(() => {
      const allTags = new Set<string>();
      notesData.forEach((note) => {
        // Body #tags…
        const tagRegex = /(?:^|\s)#([A-Za-z0-9_-]+)(?=\s|$|\.|,)/g;
        let match;
        while ((match = tagRegex.exec(note.content)) !== null) {
          const tag = match[1];
          if (!/^[0-9a-fA-F]{3,6}$/.test(tag) && !/^\d+$/.test(tag)) allTags.add(tag);
        }
        // …plus frontmatter tags (scalar or list form).
        const fm = parseFrontmatter(note.content);
        if (fm.valid && fm.data.tags != null) normalizeStringList(fm.data.tags).forEach((t) => allTags.add(t));
      });
      setTags(Array.from(allTags).sort((a, b) => a.localeCompare(b)));
  }, [notesData]);

  // Recents are per workspace and per machine, so they live in the settings
  // bridge beside `layout` rather than in a file inside the workspace that
  // would sync someone's browsing history to every other machine.
  useEffect(() => {
    setExplorerFolder('');
    if (!repository) { setExplorerRecents([]); return; }
    let cancelled = false;
    void window.electronAPI?.settings.get<unknown>(recentsKey(repository.path)).then((stored) => {
      if (!cancelled) setExplorerRecents(resolveRecents(stored));
    });
    return () => { cancelled = true; };
  }, [repository]);

  useEffect(() => {
    if (!repository) return;
    void window.electronAPI?.settings.set(recentsKey(repository.path), explorerRecents);
  }, [repository, explorerRecents]);

  // Paths move and vanish outside the app. Prune against the current listing so
  // a stale entry disappears quietly instead of offering a link that opens
  // nothing -- and compare before setting, or this loops forever.
  useEffect(() => {
    setExplorerRecents((current) => {
      const pruned = pruneRecents(current, explorerPaths);
      return pruned.length === current.length ? current : pruned;
    });
  }, [notes]);

  useEffect(() => {
    if (!repository || !window.electronAPI) { setShellConfig(null); return; }
    let cancelled = false;
    void (async () => {
      let content = await window.electronAPI.readNote(SHELL_CONFIG);
      if (content.startsWith('Error:')) {
        // Migrate the legacy root-level neuron.config into .neuron/layout.json.
        const legacy = await window.electronAPI.readNote('neuron.config');
        if (legacy.startsWith('Error:')) { if (!cancelled) setShellConfig(null); return; }
        await window.electronAPI.writeNote(SHELL_CONFIG, legacy);
        content = legacy;
      }
      if (!cancelled) setShellConfig(content);
    })();
    return () => { cancelled = true; };
  }, [repository]);

  useEffect(() => {
    if (!window.electronAPI?.onNotesChanged) return;
    let cancelled = false;
    const versions = new Map<string, number>();
    const unsubscribe = window.electronAPI.onNotesChanged((event, path) => {
      const version = (versions.get(path) ?? 0) + 1;
      versions.set(path, version);
      if (event === 'unlink') {
        setNotes(current => current.filter(n => n !== path));
        setNotesData(current => current.filter(n => n.path !== path));
        setOpenTabs(current => current.filter(n => n !== path));
        setSelectedNote(current => current === path ? null : current);
      } else {
        void window.electronAPI.readNote(path).then(content => {
          if (cancelled || versions.get(path) !== version || content.startsWith('Error:')) return;
          setNotes(current => current.includes(path) ? current : [...current, path].sort());
          if (!path.startsWith('.neuron/')) setNotesData(current => {
            const existing = current.find(n => n.path === path);
            if (existing?.content === content) return current;
            return existing ? current.map(n => n.path === path ? { path, content } : n) : [...current, { path, content }];
          });
        }).catch(() => { if (!cancelled) setNotice('Could not update the changed note.'); });
      }
      if (path !== SHELL_CONFIG) return;
      void window.electronAPI?.readNote(SHELL_CONFIG).then((content) => {
        if (content.startsWith('Error:')) {
          setShellConfig(null);
          setPendingShellConfig(null);
          return;
        }
        setPendingShellConfig(content);
      });
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [repository]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedNote || isUrl(selectedNote) || !window.electronAPI) { setNoteContent(''); setSaveState('idle'); return; }
      try {
        const content = await window.electronAPI.readNote(selectedNote);
        if (!cancelled) { setNoteContent(content); setSaveState('saved'); }
      } catch {
        if (!cancelled) setNotice(`Could not open “${selectedNote}”.`);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedNote]);

  const handleSelectNote = useCallback((note: string) => {
    setSelectedNote(note);
    setOpenTabs((current) => current.includes(note) ? current : [...current, note]);
    setView('notes');
    // Opening a file leaves home, whichever route got here -- sidebar, explorer,
    // command palette or a wiki-link. One place to clear it, because a second
    // route that forgot would leave the explorer covering the note it opened.
    setAtHome(false);
    if (!isUrl(note)) setExplorerRecents((current) => addRecent(current, { path: note, kind: 'file' }));
    setNotice(null);
  }, []);

  /** Show the workspace explorer without disturbing what is already open. */
  const goHome = useCallback((folder = '') => {
    setView('notes');
    setExplorerFolder(folder);
    setAtHome(true);
    setNotice(null);
  }, []);

  const navigateExplorer = useCallback((folder: string) => {
    setExplorerFolder(folder);
    if (folder) setExplorerRecents((current) => addRecent(current, { path: folder, kind: 'folder' }));
  }, []);

  const clearExplorerRecents = useCallback(() => setExplorerRecents([]), []);

  // The file list, minus the workspace's own configuration.
  //
  // Filtered from `notes` rather than taken from `notesData`, for two reasons.
  // notesData exists to be READ -- it carries every file's contents for the
  // graph, tags and search -- and an explorer needs names, not bodies. And it
  // holds only what could be read as text, so sourcing from it would silently
  // hide binaries: a .png in the workspace would simply not appear.
  //
  // `.neuron/` is excluded here and nowhere else, on purpose: the sidebar is
  // the file tree and still shows it, because editing layout.json by hand is a
  // real thing to want. The explorer is where you land with nothing open, and
  // offering the workspace's own configuration there put a row that the app
  // rewrites as you use it -- churning under the cursor -- ahead of your notes.
  // (The graph shows only notes with wiki-links, so it never had the question.)
  const explorerPaths = useMemo(
    () => notes.filter((path) => !path.startsWith('.neuron/')),
    [notes],
  );

  // One state object for both empty editor areas: the plain shell's pane and
  // the layout shell's `editor` panel. Two consumers, one folder and one Recent
  // list, so they cannot drift apart.
  const explorerState = useMemo(() => ({
    atHome,
    repositoryName: repository?.name ?? 'Workspace',
    // notesData, not notes: it is the list already filtered of `.neuron/`, so
    // the explorer cannot offer to open the workspace's own configuration --
    // which the sidebar and graph both hide. Using the raw list listed .neuron
    // as the first folder in the workspace.
    paths: explorerPaths,
    folder: explorerFolder,
    navigate: navigateExplorer,
    openFile: handleSelectNote,
    recents: explorerRecents,
    clearRecents: clearExplorerRecents,
  }), [atHome, repository, explorerPaths, explorerFolder, navigateExplorer, handleSelectNote, explorerRecents, clearExplorerRecents]);

  const createNote = useCallback(async (relativePath: string, content?: string): Promise<boolean> => {
    if (!window.electronAPI) return false;
    const title = relativePath.split('/').pop()!.replace(/\.(md|mdx)$/, '').replace(/[-_]/g, ' ');
    const body = content ?? `# ${title}\n\nStart writing here. Link another note with [[Note name]].\n`;
    const result = await window.electronAPI.writeNote(relativePath, body);
    if (!result.success) { setNotice(`Could not create “${relativePath}”. ${result.error ?? ''}`.trim()); return false; }
    await loadNotes();
    setSelectedNote(relativePath);
    setOpenTabs((current) => current.includes(relativePath) ? current : [...current, relativePath]);
    setView('notes');
    setSaveState('saved');
    return true;
  }, [loadNotes]);

  const createSectionFolder = useCallback(async (path: string, firstNoteName?: string): Promise<boolean> => {
    if (!window.electronAPI) return false;
    const result = await window.electronAPI.createSection(path);
    if (!result.success) { setNotice(`Could not create section “${path}”. ${result.error ?? ''}`.trim()); return false; }
    if (firstNoteName) {
      let file = firstNoteName.trim();
      if (!/\.(md|mdx)$/.test(file)) file += '.mdx';
      await createNote(`${path}/${file}`);
    } else {
      await loadNotes();
    }
    return true;
  }, [createNote, loadNotes]);

  const handleDeleteNote = useCallback(async (note: string): Promise<boolean> => {
    if (!window.electronAPI) return false;
    const result = await window.electronAPI.deleteNote(note);
    if (!result.success) { setNotice(`Could not delete “${note}”. ${result.error ?? ''}`.trim()); return false; }
    setOpenTabs((current) => current.filter((tab) => tab !== note));
    setSelectedNote((current) => (current === note ? null : current));
    await loadNotes();
    return true;
  }, [loadNotes]);

  const handleContentChange = useCallback(async (value: string) => {
    setNoteContent(value);
    if (!selectedNote || !window.electronAPI) return;
    const version = ++saveVersion.current;
    setSaveState('saving');
    setNotesData((previous) => previous.map((note) => (note.path === selectedNote ? { ...note, content: value } : note)));
    const result = await window.electronAPI.writeNote(selectedNote, value);
    if (version !== saveVersion.current) return;
    setSaveState(result.success ? 'saved' : 'error');
    if (result.success && selectedNote === SHELL_CONFIG) setPendingShellConfig(value);
    if (!result.success) setNotice(`Changes to “${selectedNote}” could not be saved.`);
  }, [selectedNote]);

  const requestCreate = useCallback((section?: string) => {
    setCreateTab('note');
    setCreateSection(section ?? '');
    setCreateOpen(true);
  }, []);

  // Create an .html view in the current note's folder.
  const createSurfaceFile = useCallback(async () => {
    const folder = selectedNote && selectedNote.includes('/') ? selectedNote.slice(0, selectedNote.lastIndexOf('/') + 1) : '';
    let name = 'View.html';
    let i = 2;
    while (notes.includes(`${folder}${name}`)) name = `View ${i++}.html`;
    await createNote(`${folder}${name}`, HTMX_VIEW_TEMPLATE);
  }, [selectedNote, notes, createNote]);

  const toggleShell = useCallback(async () => {
    if (shellConfig) { setShellConfig(null); return; }
    if (!window.electronAPI) return;
    const existing = await window.electronAPI.readNote(SHELL_CONFIG);
    const missing = existing.startsWith('Error:');
    if (missing) await window.electronAPI.writeNote(SHELL_CONFIG, NEURON_CONFIG_TEMPLATE);
    setShellConfig(missing ? NEURON_CONFIG_TEMPLATE : existing);
    setView('notes');
  }, [shellConfig]);

  // Pull Chrome's cookies into the in-app browser session (stay logged in).
  const importChromeLogins = useCallback(async () => {
    if (!window.electronAPI) return;
    setNotice('Importing Chrome logins…');
    const r = await window.electronAPI.cookies.importChrome();
    setNotice(r.success
      ? `Imported ${r.imported ?? 0} Chrome cookies${r.skipped ? ` (${r.skipped} skipped)` : ''}. Open a website tab to use them.`
      : `Chrome import failed: ${r.error ?? 'unknown error'}`);
  }, []);

  // Open a website as a browser tab. The hash keeps each new tab a distinct key;
  // the in-view URL bar lets the user navigate anywhere from there.
  const openWebsite = useCallback(() => {
    const n = ++browserCounter.current;
    const url = `https://duckduckgo.com/#neuron-tab-${n}`;
    setSelectedNote(url);
    setOpenTabs((current) => (current.includes(url) ? current : [...current, url]));
    setView('notes');
  }, []);

  const closeTab = useCallback((note: string) => {
    setOpenTabs((current) => {
      const index = current.indexOf(note);
      const remaining = current.filter((tab) => tab !== note);
      setSelectedNote((active) => {
        if (active !== note) return active;
        return remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? null;
      });
      return remaining;
    });
  }, []);

  /**
   * Tick or untick a task from the rendered view.
   *
   * The Markdown is the source of truth, so this rewrites the one line rather
   * than holding the tick in renderer state: reading mode has no editor behind
   * it, and a tick that lived only on screen would vanish on reload.
   */
  const handleToggleTask = useCallback((lineIndex: number, checked: boolean) => {
    const lines = noteContent.split('\n');
    const line = lines[lineIndex];
    if (line === undefined) return;

    const next = checked
      ? line.replace(/\[( | )\]/, '[x]')
      : line.replace(/\[[xX]\]/, '[ ]');
    if (next === line) return;

    lines[lineIndex] = next;
    handleContentChange(lines.join('\n'));
  }, [noteContent, handleContentChange]);

  const handleLineClick = useCallback((lineIndex: number) => {
    const targetLine = lineIndex + 1;
    let mode = selectedNote ? editorModes[selectedNote] || 'reading' : 'reading';
    // In reading view, a single click shouldn't switch modes — double-click enters live.
    if (mode === 'reading') return;
    setTimeout(() => {
      const view = editorRef.current?.view;
      if (view) {
        try {
          const doc = view.state.doc;
          const safeLine = Math.max(1, Math.min(targetLine, doc.lines));
          const line = doc.line(safeLine);
          view.dispatch({
            selection: { anchor: line.from, head: line.from },
            scrollIntoView: true,
          });
          view.focus();
        } catch (e) {
          console.error('Failed to jump to line:', e);
        }
      }
    }, 50);
  }, [selectedNote, editorModes]);

  // Markdown opens in reading view; other text files (JSON config, CSS, manifests) open as raw source.
  const defaultEditorMode: EditorMode = selectedNote && /\.(md|mdx)$/i.test(selectedNote) ? 'reading' : 'split';
  const editorMode: EditorMode = (selectedNote && editorModes[selectedNote]) || defaultEditorMode;
  const setEditorMode = (mode: EditorMode) => {
    if (selectedNote) setEditorModes((prev) => ({ ...prev, [selectedNote]: mode }));
  };

  // --- Derived --------------------------------------------------------------
  const filteredNotes = useMemo(
    () => (selectedTag
      ? notesData.filter((note) => {
          if (new RegExp(`(?:^|\\s)#${selectedTag}(?=\\s|$|\\.|,)`).test(note.content)) return true;
          const fm = parseFrontmatter(note.content);
          return fm.valid && fm.data.tags != null && normalizeStringList(fm.data.tags).includes(selectedTag);
        }).map((note) => note.path)
      : notes),
    [selectedTag, notesData, notes],
  );

  const sections = useMemo(() => {
    const set = new Set<string>();
    for (const path of notes) {
      const segments = path.split('/');
      segments.pop();
      let prefix = '';
      for (const segment of segments) { prefix = prefix ? `${prefix}/${segment}` : segment; set.add(prefix); }
    }
    return Array.from(set).sort();
  }, [notes]);

  const bridge = useMemo(() => ({
    activeNote: selectedNote,
    noteContent,
    notes,
    notesData,
    openNote: handleSelectNote,
    createNote,
    refreshNotes: loadNotes,
  }), [selectedNote, noteContent, notes, notesData, handleSelectNote, createNote, loadNotes]);

  // --- Responsive (raw split collapses to tabs when narrow) -----------------
  // Panels are user-resizable, so responsive mode only needs the viewport width.
  useEffect(() => {
    const compute = () => setWide(window.innerWidth >= 1100);
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  // Load configurable keybindings once.
  useEffect(() => {
    if (!window.electronAPI) return;
    void window.electronAPI.settings.get<Bindings>('keybindings').then((stored) => setBindings(resolveBindings(stored)));
  }, []);

  const updateBindings = useCallback((next: Bindings) => {
    setBindings(next);
    void window.electronAPI?.settings.set('keybindings', next);
  }, []);

  // Global shortcut dispatcher, driven by the (configurable) binding map.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Zen mode exits on a double Escape press.
      if (event.key === 'Escape' && layoutRef.current.zen) {
        const now = Date.now();
        if (now - lastEscapeRef.current < 900) { patchLayout({ zen: false }); lastEscapeRef.current = 0; return; }
        lastEscapeRef.current = now;
      }
      const chord = eventToChord(event);
      if (!chord) return;
      const match = Object.entries(bindings).find(([, c]) => c === chord);
      if (!match) return;
      event.preventDefault();
      switch (match[0]) {
        case 'palette': setPaletteOpen((open) => !open); break;
        case 'new-note': requestCreate(); break;
        case 'new-view': void createSurfaceFile(); break;
        case 'open-website': openWebsite(); break;
        case 'toggle-sidebar': setSidebarOpen((v) => !v); break;
        case 'toggle-right': setRightPanelOpen((v) => !v); break;
        case 'toggle-bottom': setBottomPanelOpen((v) => !v); break;
        case 'toggle-zen': patchLayout({ zen: !layoutRef.current.zen }); break;
        case 'toggle-graph': toggleGraphOverlay(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [bindings, requestCreate, createSurfaceFile, openWebsite, patchLayout]);

  const saveLabel = { idle: 'No note open', saving: 'Saving…', saved: 'Saved locally', error: 'Save failed' }[saveState];

  const rawSplit = wide ? (
    <div className="flex h-full w-full divide-x divider-color">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="pane-header flex items-center border-b px-4 text-[11px] font-medium text-[var(--ink-muted)]">Source</div>
        <div className="min-h-0 flex-1"><Editor ref={editorRef} value={noteContent} onChange={handleContentChange} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} /></div>
      </div>
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="pane-header flex items-center border-b px-4 text-[11px] font-medium text-[var(--ink-muted)]">Preview</div>
        <div className="min-h-0 flex-1"><MDXPreview onToggleTask={handleToggleTask} mdxContent={noteContent} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} onLineClick={handleLineClick} notes={notes} onWikiLinkClick={handleSelectNote} /></div>
      </div>
    </div>
  ) : (
    <Tabs defaultValue="source" className="flex h-full w-full flex-col">
      <div className="border-b divider-color px-3 py-2"><TabsList><TabsTrigger value="source">Source</TabsTrigger><TabsTrigger value="preview">Preview</TabsTrigger></TabsList></div>
      <TabsContent value="source" className="min-h-0 flex-1"><Editor ref={editorRef} value={noteContent} onChange={handleContentChange} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} /></TabsContent>
      <TabsContent value="preview" className="min-h-0 flex-1"><MDXPreview onToggleTask={handleToggleTask} mdxContent={noteContent} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} onLineClick={handleLineClick} notes={notes} onWikiLinkClick={handleSelectNote} /></TabsContent>
    </Tabs>
  );

  const browsing = isUrl(selectedNote);
  const Surface = selectedNote && !browsing ? getSurface(selectedNote) : undefined;
  const surfaceEditing = !!(selectedNote && Surface && surfaceSourceMode[selectedNote]);
  const setSurfaceSource = (source: boolean) => { if (selectedNote) setSurfaceSourceMode((prev) => ({ ...prev, [selectedNote]: source })); };

  const editorHeader = (
    <header className="pane-header flex items-center justify-between border-b">
      <NoteTabs tabs={openTabs} activeTab={selectedNote ?? ''} onSelect={handleSelectNote} onClose={closeTab} onCreate={() => requestCreate()} onNewBrowser={openWebsite} />
      {selectedNote && Surface ? (
          <div className="flex h-full shrink-0 items-center border-l border-[var(--divider)] px-3">
            <Segmented
              label="Surface mode"
              value={surfaceEditing ? 'source' : 'preview'}
              onChange={(next) => setSurfaceSource(next === 'source')}
              options={[
                { value: 'preview', label: 'Preview', icon: <Eye className="h-3.5 w-3.5" /> },
                { value: 'source', label: 'Source', icon: <FileCode2 className="h-3.5 w-3.5" /> },
              ]}
            />
          </div>
      ) : selectedNote && !browsing ? (
          <div className="flex h-full shrink-0 items-center gap-3 border-l border-[var(--divider)] px-3">
            {saveState === 'error' && <span role="status" className="text-[11px] text-[var(--danger)]">{saveLabel}</span>}
            {/* Not in a layout workspace. There the editor is a panel that owns
                its own view mode, so this switch drove nothing -- two identical
                controls one above the other, and only the lower one worked. It
                was invisible while this was a dropdown and the other a row of
                text; giving them the same shape is what showed it. */}
            {!shellConfig && <Segmented label="View mode" value={editorMode} onChange={setEditorMode} options={EDIT_MODES} />}
          </div>
      ) : null}
    </header>
  );


  // Home wins over the open note, which is what lets the workspace title show
  // the explorer without closing tabs -- they stay in `openTabs`, and clicking
  // one calls handleSelectNote, which clears `atHome` and brings it back.
  const notesView = selectedNote && !atHome ? (
    <div className="flex h-full w-full flex-col">
      {editorHeader}
      <div className="min-h-0 flex-1">
        {browsing ? (
          <BrowserView key={selectedNote} url={selectedNote} />
        ) : Surface ? (
          surfaceEditing
            ? <Editor ref={editorRef} value={noteContent} onChange={handleContentChange} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} />
            : <SurfaceBoundary resetKey={`${selectedNote}:${noteContent.length}`}><Surface path={selectedNote} content={noteContent} notesData={notesData} onSelectNote={handleSelectNote} selectedNote={selectedNote} onChangeNote={handleContentChange} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} /></SurfaceBoundary>
        ) : (
          <>
            {editorMode === 'live' && <LiveEditor value={noteContent} onChange={handleContentChange} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} tagSuggestions={tags} onTagClick={setSelectedTag} notes={notes} onWikiLinkClick={handleSelectNote} onRequestRawMode={() => setEditorMode('split')} removeEmptyFrontmatter={propsSettings.removeEmpty} defaultPropertiesCollapsed={propsSettings.collapsedByDefault} />}
            {editorMode === 'split' && rawSplit}
            {editorMode === 'reading' && (
              <div className="h-full" onDoubleClick={() => setEditorMode('live')}><MDXPreview onToggleTask={handleToggleTask} mdxContent={noteContent} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} onLineClick={handleLineClick} tagSuggestions={tags} onTagClick={setSelectedTag} notes={notes} onWikiLinkClick={handleSelectNote} showProperties={propsSettings.showInReading} defaultPropertiesCollapsed={propsSettings.collapsedByDefault} /></div>
            )}
          </>
        )}
      </div>
    </div>
  ) : (
    // What used to be a blank "Choose a note to begin" panel. Nothing selected
    // means the explorer at the workspace root; the tabs, if any, are untouched.
    <WorkspaceExplorer
      repositoryName={explorerState.repositoryName}
      paths={explorerState.paths}
      folder={explorerState.folder}
      onNavigate={explorerState.navigate}
      onOpenFile={explorerState.openFile}
      recents={explorerState.recents}
      onClearRecents={explorerState.clearRecents}
    />
  );

  let mainContent: React.ReactNode;
  if (view === 'repositories') {
    mainContent = <RepositoriesPage current={repository} recents={recents} onCreate={createRepository} onOpen={openRepository} onSwitch={switchRepository} onReload={reloadRepoState} />;
  } else if (view === 'plugins') {
    mainContent = <PluginsPage onOpenSidePanel={() => setRightPanelOpen(true)} onOpenBottomPanel={() => setBottomPanelOpen(true)} />;
  } else if (view === 'settings') {
    mainContent = <SettingsPage appearance={appearance} onAppearanceChange={handleAppearanceChange} bindings={bindings} onBindingsChange={updateBindings} properties={propsSettings} onPropertiesChange={updatePropsSettings} />;
  } else if (view === 'gallery') {
    mainContent = <ComponentGallery />;
  } else if (shellConfig && !Surface && !browsing) {
    // Shell handles plain notes in its editor slot; surface files (.html, .db, .canvas) and
    // browser tabs are full-page documents, so let them fall through to notesView.
    mainContent = (
      <div className="flex h-full w-full flex-col">
        {editorHeader}
        <div className="min-h-0 flex-1">
          <LayoutSurface
            path={SHELL_CONFIG}
            content={shellConfig}
            notesData={notesData}
            onSelectNote={handleSelectNote}
            selectedNote={selectedNote}
            noteContent={noteContent}
            onChangeNote={handleContentChange}
            colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'}
          />
        </div>
      </div>
    );
  } else {
    mainContent = notesView;
  }

  return (
    <PluginProvider catalog={builtinPlugins} bridge={bridge}>
      <ExplorerProvider value={explorerState}>
      <TooltipProvider delayDuration={300}>
        <div className={`workspace-grid app-shell font-sans${layout.statusBar ? '' : ' no-status'}`}>
          <TitleBar
            repository={repository}
            recents={recents}
            activeNote={view === 'notes' ? selectedNote : null}
            sidebarOpen={sidebarOpen}
            rightPanelOpen={rightPanelOpen}
            graphOpen={graphOverlayOpen}
            bottomPanelOpen={bottomPanelOpen}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            onToggleRightPanel={() => setRightPanelOpen((v) => !v)}
            onToggleGraph={toggleGraphOverlay}
            onToggleBottomPanel={() => setBottomPanelOpen((v) => !v)}
            onOpenMarketplace={() => setView('plugins')}
            onOpenCommandPalette={() => setPaletteOpen(true)}
            onOpenSettings={() => setView('settings')}
            onSwitchRepo={switchRepository}
            onOpenRepo={openRepository}
            onCreateRepo={createRepository}
            layout={layout}
            onLayoutChange={patchLayout}
            onResetLayout={() => { zenPrevRef.current = null; commitLayout({ ...DEFAULT_LAYOUT }); }}
          />

          {!repoReady ? (
            <div className="grid place-items-center text-sm text-[var(--ink-muted)]">Loading…</div>
          ) : !repository ? (
            <RepositoryOnboarding recents={recents} onCreate={createRepository} onOpen={openRepository} onSwitch={switchRepository} />
          ) : (
            <div className="flex min-h-0 min-w-0 overflow-hidden">
              {layout.activityBar && (
                <ActivityRail
                  view={view}
                  sidebarMode={sidebarMode}
                  sidebarOpen={sidebarOpen}
                  tagCount={tags.length}
                  onSelectMode={(mode) => {
                    if (view === 'notes' && sidebarOpen && sidebarMode === mode) { patchLayout({ sidebar: false }); return; }
                    setSidebarMode(mode);
                    setView('notes');
                    if (!sidebarOpen) patchLayout({ sidebar: true });
                  }}
                  onNavigate={setView}
                />
              )}
            <PanelGroup direction="horizontal" autoSaveId="neuron.shell.h" className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
              {sidebarOpen && (
                <>
                  <Panel id="sidebar" order={1} defaultSize={18} minSize={12} maxSize={40} className="min-w-0">
                    <Sidebar
                      notes={filteredNotes}
                      notesData={notesData}
                      selectedNote={selectedNote}
                      onSelectNote={handleSelectNote}
                      onDeleteNote={handleDeleteNote}
                      onRequestCreate={requestCreate}
                      onRequestCreateFolder={() => { setCreateTab('section'); setCreateSection(''); setCreateOpen(true); }}
                      onRefresh={loadNotes}
                      view={view}
                      mode={sidebarMode}
                      repositoryName={repository.name}
                      onGoHome={() => goHome()}
                      tags={tags}
                      onSelectTag={setSelectedTag}
                      selectedTag={selectedTag}
                    />
                  </Panel>
                  <PanelResizeHandle className="resize-handle resize-handle-v" />
                </>
              )}

              <Panel id="center" order={2} minSize={30} className="min-w-0">
                <PanelGroup direction="vertical" autoSaveId="neuron.shell.v" className="flex min-h-0 flex-col">
                  <Panel id="center-row" order={1} minSize={30} className="min-h-0">
                    <PanelGroup direction="horizontal" autoSaveId="neuron.center.h" className="flex min-h-0">
                      <Panel id="main" order={1} minSize={30} className="min-w-0">
                        <main className="canvas-surface relative flex h-full w-full min-w-0 flex-col overflow-hidden">
                          {notice && (
                            <div role="alert" className="surface-danger absolute left-1/2 top-3 z-50 flex max-w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-md border px-3 py-2 text-xs text-[var(--ink)] shadow-lg">
                              <span>{notice}</span>
                              <button className="interactive min-h-[28px] text-[var(--danger)] hover:text-[var(--ink)]" onClick={() => setNotice(null)}>Dismiss</button>
                            </div>
                          )}
                          {pendingShellConfig && (
                            <div role="status" className="surface-danger absolute left-1/2 top-3 z-50 flex max-w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-md border px-3 py-2 text-xs text-[var(--ink)] shadow-lg">
                              <span>The workspace layout (.neuron/layout.json) changed. Update to the latest view?</span>
                              <button className="interactive min-h-[28px] rounded px-2 font-medium text-[var(--accent-strong)] hover:bg-[var(--surface-hover)]" onClick={() => { setShellConfig(pendingShellConfig); setPendingShellConfig(null); setView('notes'); }}>Update view</button>
                              <button className="interactive min-h-[28px] rounded px-2 text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]" onClick={() => setPendingShellConfig(null)}>Not now</button>
                            </div>
                          )}
                          {mainContent}
                          {/* Notes only. It is a map of the workspace, so it
                              has nothing to say over Settings, Plugins or
                              Repositories -- and it was covering their controls,
                              which an E2E click timeout caught. Anchored to
                              <main> rather than the notes view because a
                              workspace with a shell config renders a layout
                              instead of notesView, and the map is just as
                              useful there. Not the window, so it never covers
                              the sidebar or status bar. Zen mode exists to
                              remove chrome, so it hides this too. */}
                          {graphOverlayOpen && !layout.zen && view === 'notes' && (
                            <FloatingGraph
                              key={repository?.path}
                              notesData={notesData}
                              selectedNote={selectedNote}
                              onSelectNote={handleSelectNote}
                              onClose={toggleGraphOverlay}
                            />
                          )}
                        </main>
                      </Panel>
                      {rightPanelOpen && (
                        <>
                          <PanelResizeHandle className="resize-handle resize-handle-v" />
                          <Panel id="right" order={2} defaultSize={26} minSize={15} maxSize={50} className="min-w-0">
                            <RightPanel location="side" onOpenMarketplace={() => setView('plugins')} onClose={() => setRightPanelOpen(false)} />
                          </Panel>
                        </>
                      )}
                    </PanelGroup>
                  </Panel>
                  {bottomPanelOpen && (
                    <>
                      <PanelResizeHandle className="resize-handle resize-handle-h" />
                      <Panel id="bottom" order={2} defaultSize={28} minSize={12} maxSize={70} className="min-h-0">
                        <RightPanel location="bottom" onOpenMarketplace={() => setView('plugins')} onClose={() => setBottomPanelOpen(false)} />
                      </Panel>
                    </>
                  )}
                </PanelGroup>
              </Panel>
            </PanelGroup>
            </div>
          )}

          {layout.statusBar && <StatusBar repositoryName={repository?.name ?? null} activeNote={view === 'notes' ? selectedNote : null} saveState={saveState} />}
        </div>

        <CreateModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          sections={sections}
          initialSection={createSection}
          initialTab={createTab}
          onCreateNote={createNote}
          onCreateSection={createSectionFolder}
        />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          notes={notes}
          onSelectNote={handleSelectNote}
          onOpenMarketplace={() => setView('plugins')}
          onOpenSettings={() => setView('settings')}
          onCreate={() => requestCreate()}
          onCreateSurface={createSurfaceFile}
          onOpenWebsite={openWebsite}
          onOpenGallery={() => setView('gallery')}
          onToggleShell={toggleShell}
          shellActive={!!shellConfig}
          onToggleGraph={toggleGraphOverlay}
          graphActive={graphOverlayOpen}
          onImportChromeLogins={importChromeLogins}
          bindings={bindings}
        />
      </TooltipProvider>
      </ExplorerProvider>
    </PluginProvider>
  );
}
