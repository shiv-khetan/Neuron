import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Notebook, MoreHorizontal, Eye, SplitSquareHorizontal, PenLine } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import MDXPreview from './components/MDXPreview';
import LiveEditor from './components/LiveEditor';
import SearchAndGraph from './components/SearchAndGraph';
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
import { TooltipProvider } from './components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuCheckboxItem, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { PluginProvider } from './plugins/host';
import { builtinPlugins } from './plugins/builtin';
import type { RepositoryInfo } from './electron.d';
import { applyTheme, DEFAULT_APPEARANCE, normalizeAppearance, PRESETS, type Appearance } from './lib/theme';

interface NoteData { path: string; content: string }
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type View = 'notes' | 'graph' | 'repositories' | 'plugins' | 'settings';
type EditorMode = 'live' | 'raw' | 'reading';

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

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSection, setCreateSection] = useState('');
  const [wide, setWide] = useState(true);

  const saveVersion = useRef(0);
  const editorRef = useRef<any>(null);

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
        const tagRegex = /(?:^|\s)#([A-Za-z0-9_-]+)(?=\s|$|\.|,)/g;
        let match;
        while ((match = tagRegex.exec(note.content)) !== null) {
          const tag = match[1];
          if (!/^[0-9a-fA-F]{3,6}$/.test(tag) && !/^\d+$/.test(tag)) allTags.add(tag);
        }
      });
      setTags(Array.from(allTags).sort((a, b) => a.localeCompare(b)));
    } catch {
      setNotice('Could not load the repository.');
    }
  }, []);

  useEffect(() => {
    if (!repository) { setNotes([]); setNotesData([]); setTags([]); setSelectedNote(null); return; }
    loadNotes();
  }, [repository, loadNotes]);

  useEffect(() => {
    if (!window.electronAPI?.onNotesChanged) return;
    return window.electronAPI.onNotesChanged(() => loadNotes());
  }, [loadNotes]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedNote || !window.electronAPI) { setNoteContent(''); setSaveState('idle'); return; }
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
    setView((v) => (v === 'graph' ? 'graph' : 'notes'));
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
    if (!result.success) setNotice(`Changes to “${selectedNote}” could not be saved.`);
  }, [selectedNote]);

  const requestCreate = useCallback((section?: string) => {
    setCreateSection(section ?? '');
    setCreateOpen(true);
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
    let mode = selectedNote ? editorModes[selectedNote] || 'live' : 'live';
    if (mode === 'reading') {
      setEditorMode('raw');
    }
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

  const editorMode: EditorMode = (selectedNote && editorModes[selectedNote]) || 'live';
  const setEditorMode = (mode: EditorMode) => {
    if (selectedNote) setEditorModes((prev) => ({ ...prev, [selectedNote]: mode }));
  };

  // --- Derived --------------------------------------------------------------
  const filteredNotes = useMemo(
    () => (selectedTag
      ? notesData.filter((note) => new RegExp(`(?:^|\\s)#${selectedTag}(?=\\s|$|\\.|,)`).test(note.content)).map((note) => note.path)
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
  useEffect(() => {
    const compute = () => {
      const available = window.innerWidth - (sidebarOpen ? 264 : 0) - (rightPanelOpen ? 340 : 0);
      setWide(available >= 1000);
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [sidebarOpen, rightPanelOpen]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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

  const notesView = selectedNote ? (
    <div className="flex h-full w-full flex-col">
      <header className="pane-header flex items-center justify-between border-b">
        <NoteTabs tabs={openTabs} activeTab={selectedNote} onSelect={handleSelectNote} onClose={closeTab} onCreate={() => requestCreate()} />
        <div className="flex h-full shrink-0 items-center gap-3 border-l border-[var(--divider)] px-3">
          <span role="status" className={`flex items-center gap-2 text-[11px] ${saveState === 'error' ? 'text-[var(--danger)]' : 'text-[var(--ink-muted)]'}`}>
            {saveState === 'saved' && <span className="status-dot" />}{saveLabel}
          </span>
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
      </header>
      <div className="min-h-0 flex-1">
        {editorMode === 'live' && <LiveEditor value={noteContent} onChange={handleContentChange} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} />}
        {editorMode === 'raw' && rawSplit}
        {editorMode === 'reading' && <MDXPreview mdxContent={noteContent} onLineClick={handleLineClick} />}
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
    mainContent = <SettingsPage appearance={appearance} onAppearanceChange={handleAppearanceChange} />;
  } else if (view === 'graph') {
    mainContent = <SearchAndGraph notesData={notesData} onSelectNote={handleSelectNote} selectedNote={selectedNote} />;
  } else {
    mainContent = notesView;
  }

  return (
    <PluginProvider catalog={builtinPlugins} bridge={bridge}>
      <TooltipProvider delayDuration={300}>
        <div className="workspace-grid app-shell font-sans">
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
          />

          {!repoReady ? (
            <div className="grid place-items-center text-sm text-[var(--ink-muted)]">Loading…</div>
          ) : !repository ? (
            <RepositoryOnboarding recents={recents} onCreate={createRepository} onOpen={openRepository} onSwitch={switchRepository} />
          ) : (
            <div className="flex min-h-0 overflow-hidden">
              {sidebarOpen && (
                <div className="w-[264px] shrink-0">
                  <Sidebar
                    notes={filteredNotes}
                    selectedNote={selectedNote}
                    onSelectNote={handleSelectNote}
                    onDeleteNote={handleDeleteNote}
                    onRequestCreate={requestCreate}
                    view={view}
                    onNavigate={setView}
                    repositoryName={repository.name}
                    tags={tags}
                    onSelectTag={setSelectedTag}
                    selectedTag={selectedTag}
                  />
                </div>
              )}

              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex min-h-0 min-w-0 flex-1">
                  <main className="canvas-surface relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
                    {notice && (
                      <div role="alert" className="surface-danger absolute left-1/2 top-3 z-50 flex max-w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-md border px-3 py-2 text-xs text-[var(--ink)] shadow-lg">
                        <span>{notice}</span>
                        <button className="interactive min-h-[28px] text-[var(--danger)] hover:text-[var(--ink)]" onClick={() => setNotice(null)}>Dismiss</button>
                      </div>
                    )}
                    {mainContent}
                  </main>

                  {rightPanelOpen && (
                    <div className="w-[340px] shrink-0">
                      <RightPanel location="side" onOpenMarketplace={() => setView('plugins')} onClose={() => setRightPanelOpen(false)} />
                    </div>
                  )}
                </div>

                {bottomPanelOpen && (
                  <div className="h-[260px] min-h-[160px] shrink-0">
                    <RightPanel location="bottom" onOpenMarketplace={() => setView('plugins')} onClose={() => setBottomPanelOpen(false)} />
                  </div>
                )}
              </div>
            </div>
          )}

          <StatusBar repositoryName={repository?.name ?? null} activeNote={view === 'notes' ? selectedNote : null} saveState={saveState} />
        </div>

        <CreateModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          sections={sections}
          initialSection={createSection}
          onCreateNote={createNote}
          onCreateSection={createSectionFolder}
        />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          notes={notes}
          onSelectNote={handleSelectNote}
          onOpenGraph={() => setView('graph')}
          onOpenMarketplace={() => setView('plugins')}
          onOpenSettings={() => setView('settings')}
          onCreate={() => requestCreate()}
        />
      </TooltipProvider>
    </PluginProvider>
  );
}
