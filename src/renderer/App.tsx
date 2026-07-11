import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Notebook, MoreHorizontal, Eye, SplitSquareHorizontal, PenLine } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import MDXPreview from './components/MDXPreview';
import LiveEditor from './components/LiveEditor';
import TitleBar from './components/TitleBar';
import StatusBar from './components/StatusBar';
import RightPanel from './components/RightPanel';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuCheckboxItem, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { PluginProvider } from './plugins/host';
import { builtinPlugins } from './plugins/builtin';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { getSurface } from './surfaces';
import LayoutSurface from './surfaces/LayoutSurface';
import './surfaces/HtmxViewSurface'; // registers the .nhtml HTMX view surface
import './surfaces/DbSurface'; // registers the .db database surface
import './surfaces/CanvasSurface'; // registers the .canvas JSON Canvas surface
import { SurfaceBoundary } from './surfaces/SurfaceBoundary';
import BrowserView from './components/BrowserView';
import { DEFAULT_BINDINGS, eventToChord, resolveBindings, type Bindings } from './lib/keybindings';
import { DEFAULT_LAYOUT, resolveLayout, type WorkbenchLayout } from './lib/layout';
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
type EditorMode = 'live' | 'raw' | 'reading';

// Default content for new .nhtml HTMX views. Plain HTML + htmx attributes;
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
  const setBottomPanelOpen = (fn: ((v: boolean) => boolean) | boolean) => patchLayout({ bottomPanel: typeof fn === 'boolean' ? fn : fn(layoutRef.current.bottomPanel) });
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
      const data = await Promise.all(fileList.map(async (path) => ({ path, content: await window.electronAPI.readNote(path) })));
      setNotesData(data);
      const allTags = new Set<string>();
      data.forEach((note) => {
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
    } catch {
      setNotice('Could not load the workspace.');
    }
  }, []);

  useEffect(() => {
    if (!repository) { setNotes([]); setNotesData([]); setTags([]); setSelectedNote(null); return; }
    loadNotes();
  }, [repository, loadNotes]);

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
    return window.electronAPI.onNotesChanged((_event, path) => {
      void loadNotes();
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
  }, [loadNotes]);

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
    setNotice(null);
  }, []);

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

  // Create an .nhtml HTMX view in the current note's folder.
  const createSurfaceFile = useCallback(async () => {
    const folder = selectedNote && selectedNote.includes('/') ? selectedNote.slice(0, selectedNote.lastIndexOf('/') + 1) : '';
    let name = 'View.nhtml';
    let i = 2;
    while (notes.includes(`${folder}${name}`)) name = `View ${i++}.nhtml`;
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
  const defaultEditorMode: EditorMode = selectedNote && /\.(md|mdx)$/i.test(selectedNote) ? 'reading' : 'raw';
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
    openNote: handleSelectNote,
    createNote,
    refreshNotes: loadNotes,
  }), [selectedNote, noteContent, notes, handleSelectNote, createNote, loadNotes]);

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
        <div className="min-h-0 flex-1"><MDXPreview mdxContent={noteContent} onLineClick={handleLineClick} /></div>
      </div>
    </div>
  ) : (
    <Tabs defaultValue="source" className="flex h-full w-full flex-col">
      <div className="border-b divider-color px-3 py-2"><TabsList><TabsTrigger value="source">Source</TabsTrigger><TabsTrigger value="preview">Preview</TabsTrigger></TabsList></div>
      <TabsContent value="source" className="min-h-0 flex-1"><Editor ref={editorRef} value={noteContent} onChange={handleContentChange} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} /></TabsContent>
      <TabsContent value="preview" className="min-h-0 flex-1"><MDXPreview mdxContent={noteContent} onLineClick={handleLineClick} /></TabsContent>
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
            <div className="mode-switch" aria-label="Surface mode">
              <button aria-pressed={!surfaceEditing} className="interactive text-xs font-medium" onClick={() => setSurfaceSource(false)}>Preview</button>
              <button aria-pressed={surfaceEditing} className="interactive text-xs font-medium" onClick={() => setSurfaceSource(true)}>Source</button>
            </div>
          </div>
      ) : selectedNote && !browsing ? (
          <div className="flex h-full shrink-0 items-center gap-3 border-l border-[var(--divider)] px-3">
            {saveState === 'error' && <span role="status" className="text-[11px] text-[var(--danger)]">{saveLabel}</span>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button aria-label="View options" className="interactive grid h-7 w-7 place-items-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>View mode</DropdownMenuLabel>
                <DropdownMenuCheckboxItem checked={editorMode === 'live'} onCheckedChange={() => setEditorMode('live')}><PenLine className="mr-2 h-4 w-4" /> Live editor</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={editorMode === 'raw'} onCheckedChange={() => setEditorMode('raw')}><SplitSquareHorizontal className="mr-2 h-4 w-4" /> Edit as raw file (split)</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={editorMode === 'reading'} onCheckedChange={() => setEditorMode('reading')}><Eye className="mr-2 h-4 w-4" /> Reading view</DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
      ) : null}
    </header>
  );


  const notesView = selectedNote ? (
    <div className="flex h-full w-full flex-col">
      {editorHeader}
      <div className="min-h-0 flex-1">
        {browsing ? (
          <BrowserView key={selectedNote} url={selectedNote} />
        ) : Surface ? (
          surfaceEditing
            ? <Editor ref={editorRef} value={noteContent} onChange={handleContentChange} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} />
            : <SurfaceBoundary resetKey={`${selectedNote}:${noteContent.length}`}><Surface path={selectedNote} content={noteContent} notesData={notesData} onSelectNote={handleSelectNote} selectedNote={selectedNote} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} /></SurfaceBoundary>
        ) : (
          <>
            {editorMode === 'live' && <LiveEditor value={noteContent} onChange={handleContentChange} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} tagSuggestions={tags} onTagClick={setSelectedTag} onRequestRawMode={() => setEditorMode('raw')} removeEmptyFrontmatter={propsSettings.removeEmpty} defaultPropertiesCollapsed={propsSettings.collapsedByDefault} />}
            {editorMode === 'raw' && rawSplit}
            {editorMode === 'reading' && (
              <div className="h-full" onDoubleClick={() => setEditorMode('live')}><MDXPreview mdxContent={noteContent} onLineClick={handleLineClick} tagSuggestions={tags} onTagClick={setSelectedTag} showProperties={propsSettings.showInReading} defaultPropertiesCollapsed={propsSettings.collapsedByDefault} /></div>
            )}
          </>
        )}
      </div>
    </div>
  ) : (
    <section className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div className="empty-state-icon"><Notebook className="h-5 w-5" /></div>
      <h1 className="mt-5 text-base font-semibold text-[var(--ink)]">Choose a note to begin</h1>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--ink-secondary)]">Open a file from the sidebar, or create a new note or section.</p>
      <button className="interactive mt-4 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--canvas)]" onClick={() => requestCreate()}>Create note</button>
    </section>
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
    // Shell handles plain notes in its editor slot; surface files (.nhtml, .db, .canvas) and
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
      <TooltipProvider delayDuration={300}>
        <div className={`workspace-grid app-shell font-sans${layout.statusBar ? '' : ' no-status'}`}>
          <TitleBar
            repository={repository}
            recents={recents}
            activeNote={view === 'notes' ? selectedNote : null}
            sidebarOpen={sidebarOpen}
            rightPanelOpen={rightPanelOpen}
            bottomPanelOpen={bottomPanelOpen}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            onToggleRightPanel={() => setRightPanelOpen((v) => !v)}
            onToggleBottomPanel={() => setBottomPanelOpen((v) => !v)}
            onOpenMarketplace={() => setView('plugins')}
            onOpenCommandPalette={() => setPaletteOpen(true)}
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
                      selectedNote={selectedNote}
                      onSelectNote={handleSelectNote}
                      onDeleteNote={handleDeleteNote}
                      onRequestCreate={requestCreate}
                      onRequestCreateFolder={() => { setCreateTab('section'); setCreateSection(''); setCreateOpen(true); }}
                      onRefresh={loadNotes}
                      view={view}
                      mode={sidebarMode}
                      repositoryName={repository.name}
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
          onImportChromeLogins={importChromeLogins}
        />
      </TooltipProvider>
    </PluginProvider>
  );
}
