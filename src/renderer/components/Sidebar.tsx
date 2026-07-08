import { useMemo, useState } from 'react';
import { ChevronRight, ChevronsDownUp, FileCode2, FilePlus2, FolderClosed, FolderGit2, FolderOpen, FolderPlus, Plus, RefreshCw, Search, Tag, Trash2, X } from 'lucide-react';
import type { SidebarMode } from './ActivityRail';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '../lib/utils';

type View = 'notes' | 'repositories' | 'plugins' | 'settings' | 'gallery';

interface SidebarProps {
  notes: string[];
  selectedNote: string | null;
  onSelectNote: (note: string) => void;
  onDeleteNote: (note: string) => Promise<boolean>;
  onRequestCreate: (section?: string) => void;
  onRequestCreateFolder: () => void;
  onRefresh: () => Promise<void>;
  view: View;
  mode: SidebarMode;
  repositoryName: string;
  tags: string[];
  onSelectTag: (tag: string | null) => void;
  selectedTag: string | null;
}

interface TreeNode {
  name: string;
  path: string;
  folders: Map<string, TreeNode>;
  files: { name: string; path: string }[];
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', folders: new Map(), files: [] };
  for (const full of paths) {
    const segments = full.split('/');
    const fileName = segments.pop() as string;
    let node = root;
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      if (!node.folders.has(segment)) {
        node.folders.set(segment, { name: segment, path: prefix, folders: new Map(), files: [] });
      }
      node = node.folders.get(segment) as TreeNode;
    }
    node.files.push({ name: fileName, path: full });
  }
  return root;
}

function allFolderPaths(node: TreeNode, out: string[] = []): string[] {
  for (const child of node.folders.values()) {
    out.push(child.path);
    allFolderPaths(child, out);
  }
  return out;
}

function ToolbarButton({ label, onClick, busy, children }: { label: string; onClick: () => void; busy?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-busy={busy}
          onClick={onClick}
          className="interactive grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function Sidebar(props: SidebarProps) {
  const { notes, selectedNote, onSelectNote, onDeleteNote, onRequestCreate, onRequestCreateFolder, onRefresh, view, mode, repositoryName, tags, onSelectTag, selectedTag } = props;
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deletingNote, setDeletingNote] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // The search box only filters in search mode; the explorer always shows all.
  const query = mode === 'search' ? search.trim().toLowerCase() : '';
  const filtered = useMemo(() => notes.filter((n) => n.toLowerCase().includes(query)), [notes, query]);
  const tree = useMemo(() => buildTree(filtered), [filtered]);

  const toggleFolder = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const collapseAll = () => setCollapsed(new Set(allFolderPaths(tree)));

  const refresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  const handleDelete = async (note: string) => {
    setDeletingNote(note);
    const ok = await onDeleteNote(note);
    setDeletingNote(null);
    if (ok) setPendingDelete(null);
  };

  const renderFile = (file: { name: string; path: string }, depth: number) => {
    const isSelected = selectedNote === file.path && view === 'notes';
    const isConfirming = pendingDelete === file.path;
    return (
      <div key={file.path} className="note-row group interactive mb-0.5 flex items-center gap-2 pr-2" data-selected={isSelected} style={{ paddingLeft: `${8 + depth * 14}px` }}>
        <button aria-current={isSelected ? 'page' : undefined} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left" onClick={() => { onSelectNote(file.path); setPendingDelete(null); }}>
          <FileCode2 className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-[var(--accent-strong)]' : 'text-[var(--ink-muted)]')} />
          <span className="truncate font-mono text-[12px]">{file.name.replace(/\.(md|mdx)$/, '')}</span>
        </button>
        {isConfirming ? (
          <button aria-busy={deletingNote === file.path} disabled={deletingNote === file.path} className="interactive min-h-[28px] rounded px-1.5 py-1 text-[10px] font-semibold text-[var(--danger)] hover:bg-[var(--danger-surface)]" onClick={() => handleDelete(file.path)}>
            {deletingNote === file.path ? 'Deleting…' : 'Delete'}
          </button>
        ) : (
          <button aria-label={`Delete ${file.name}`} title="Delete note" className="interactive grid h-7 w-7 place-items-center rounded text-[var(--ink-muted)] opacity-0 hover:bg-[var(--danger-surface)] hover:text-[var(--danger)] group-focus-within:opacity-100 group-hover:opacity-100" onClick={() => setPendingDelete(file.path)}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  };

  const renderFolder = (node: TreeNode, depth: number): React.ReactNode => {
    const isOpen = !collapsed.has(node.path);
    return (
      <div key={node.path}>
        <div className="note-row group interactive mb-0.5 flex items-center gap-1.5 pr-2" style={{ paddingLeft: `${8 + depth * 14}px` }}>
          <button className="flex min-w-0 flex-1 items-center gap-1.5 py-2 text-left" onClick={() => toggleFolder(node.path)}>
            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)] transition-transform', isOpen && 'rotate-90')} />
            {isOpen ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--accent-strong)]" /> : <FolderClosed className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />}
            <span className="truncate text-[12px] font-medium">{node.name}</span>
          </button>
          <button aria-label={`New note in ${node.name}`} title="New note in section" className="interactive grid h-7 w-7 place-items-center rounded text-[var(--ink-muted)] opacity-0 hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] group-hover:opacity-100" onClick={() => onRequestCreate(node.path)}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {isOpen && (
          <div>
            {[...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name)).map((child) => renderFolder(child, depth + 1))}
            {node.files.sort((a, b) => a.name.localeCompare(b.name)).map((file) => renderFile(file, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const noteTree = (
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
      {[...tree.folders.values()].sort((a, b) => a.name.localeCompare(b.name)).map((child) => renderFolder(child, 0))}
      {tree.files.sort((a, b) => a.name.localeCompare(b.name)).map((file) => renderFile(file, 0))}
      {filtered.length === 0 && <div className="px-2 py-8 text-center text-xs leading-5 text-[var(--ink-muted)]">{query ? 'No notes match your search.' : 'No notes yet. Create one to start writing.'}</div>}
    </div>
  );

  return (
    <aside className="nav-surface flex h-full w-full shrink-0 select-none flex-col border-r">
      {mode === 'files' && (
        <section aria-label="Explorer" className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-1 border-b divider-color px-3 py-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
              <span className="truncate text-xs font-semibold text-[var(--ink)]" title={repositoryName}>{repositoryName}</span>
              <span className="shrink-0 rounded bg-[var(--surface)] px-1.5 font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">{filtered.length}</span>
            </div>
            <div className="flex shrink-0 items-center">
              <ToolbarButton label="New note" onClick={() => onRequestCreate()}><FilePlus2 className="h-3.5 w-3.5" /></ToolbarButton>
              <ToolbarButton label="New section" onClick={onRequestCreateFolder}><FolderPlus className="h-3.5 w-3.5" /></ToolbarButton>
              <ToolbarButton label="Refresh explorer" busy={refreshing} onClick={() => void refresh()}>
                <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              </ToolbarButton>
              <ToolbarButton label="Collapse sections" onClick={collapseAll}><ChevronsDownUp className="h-3.5 w-3.5" /></ToolbarButton>
            </div>
          </div>
          {noteTree}
        </section>
      )}

      {mode === 'search' && (
        <section aria-label="Search notes" className="flex min-h-0 flex-1 flex-col">
          <div className="border-b divider-color p-3">
            <label className="relative block">
              <span className="sr-only">Search notes</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input autoFocus className="field py-1.5 pl-8 pr-8 text-xs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes" />
              {search && <button aria-label="Clear search" className="interactive absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-[var(--ink-muted)] hover:text-[var(--ink)]" onClick={() => setSearch('')}><X className="h-3.5 w-3.5" /></button>}
            </label>
            <p className="mt-1.5 px-0.5 text-[11px] text-[var(--ink-muted)]">{filtered.length} of {notes.length} notes</p>
          </div>
          {noteTree}
        </section>
      )}

      {mode === 'tags' && (
        <section aria-label="Tag filters" className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b divider-color px-3 py-2 text-xs text-[var(--ink-muted)]">
            <span className="flex items-center gap-1.5 font-semibold text-[var(--ink)]"><Tag className="h-3.5 w-3.5 text-[var(--ink-muted)]" />Tags</span>
            {selectedTag && <button className="interactive text-[var(--accent-strong)] hover:text-[var(--ink)]" onClick={() => onSelectTag(null)}>Clear filter</button>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tags.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs leading-5 text-[var(--ink-muted)]">No tags yet. Add #tags to your notes to filter by them.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => <button key={tag} aria-pressed={selectedTag === tag} className="tag-button interactive px-2 font-mono text-[10px]" onClick={() => onSelectTag(selectedTag === tag ? null : tag)}>#{tag}</button>)}
              </div>
            )}
          </div>
        </section>
      )}
    </aside>
  );
}
