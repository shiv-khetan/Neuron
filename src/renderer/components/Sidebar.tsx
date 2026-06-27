import { useMemo, useState } from 'react';
import { Blocks, ChevronRight, FileCode2, FolderClosed, FolderGit2, FolderOpen, Plus, Search, Settings, Tag, Trash2, X } from 'lucide-react';
import { cn } from '../lib/utils';

type View = 'notes' | 'repositories' | 'plugins' | 'settings' | 'gallery';

interface SidebarProps {
  notes: string[];
  selectedNote: string | null;
  onSelectNote: (note: string) => void;
  onDeleteNote: (note: string) => Promise<boolean>;
  onRequestCreate: (section?: string) => void;
  view: View;
  onNavigate: (view: View) => void;
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

export default function Sidebar(props: SidebarProps) {
  const { notes, selectedNote, onSelectNote, onDeleteNote, onRequestCreate, view, onNavigate, repositoryName, tags, onSelectTag, selectedTag } = props;
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deletingNote, setDeletingNote] = useState<string | null>(null);

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => notes.filter((n) => n.toLowerCase().includes(query)), [notes, query]);
  const tree = useMemo(() => buildTree(filtered), [filtered]);

  const toggleFolder = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

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

  return (
    <aside className="nav-surface flex h-full w-full shrink-0 select-none flex-col border-r">
      <div className="border-b divider-color p-3">
        <button
          aria-pressed={view === 'repositories'}
          onClick={() => onNavigate('repositories')}
          className={cn(
            'interactive mb-2 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-xs font-medium',
            view === 'repositories'
              ? 'border-[color-mix(in_oklch,var(--accent)_34%,var(--divider))] bg-[color-mix(in_oklch,var(--accent)_12%,var(--surface))] text-[var(--ink)]'
              : 'border-[var(--divider)] text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
          )}
        >
          <FolderGit2 className="h-3.5 w-3.5 text-[var(--accent-strong)]" /> Workspaces
        </button>

        <label className="relative mt-1 block">
          <span className="sr-only">Search notes</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
          <input className="field py-1.5 pl-8 pr-8 text-xs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes" />
          {search && <button aria-label="Clear search" className="interactive absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-[var(--ink-muted)] hover:text-[var(--ink)]" onClick={() => setSearch('')}><X className="h-3.5 w-3.5" /></button>}
        </label>
      </div>

      <section aria-label="Notes" className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
            <span className="truncate text-xs font-semibold text-[var(--ink)]" title={repositoryName}>{repositoryName}</span>
            <span className="shrink-0 rounded bg-[var(--surface)] px-1.5 font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">{filtered.length}</span>
          </div>
          <button aria-label="Create note or section" title="Create" className="interactive grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]" onClick={() => onRequestCreate()}>
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
          {[...tree.folders.values()].sort((a, b) => a.name.localeCompare(b.name)).map((child) => renderFolder(child, 0))}
          {tree.files.sort((a, b) => a.name.localeCompare(b.name)).map((file) => renderFile(file, 0))}
          {filtered.length === 0 && <div className="px-2 py-8 text-center text-xs leading-5 text-[var(--ink-muted)]">{search ? 'No notes match your search.' : 'No notes yet. Create one to start writing.'}</div>}
        </div>
      </section>

      {tags.length > 0 && (
        <section aria-label="Tag filters" className="max-h-44 border-t divider-color p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--ink-muted)]">
            <span className="flex items-center gap-1.5"><Tag className="h-3.5 w-3.5" />Filter by tag</span>
            {selectedTag && <button className="interactive text-[var(--accent-strong)] hover:text-[var(--ink)]" onClick={() => onSelectTag(null)}>Clear</button>}
          </div>
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {tags.map((tag) => <button key={tag} aria-pressed={selectedTag === tag} className="tag-button interactive px-2 font-mono text-[10px]" onClick={() => onSelectTag(selectedTag === tag ? null : tag)}>#{tag}</button>)}
          </div>
        </section>
      )}

      <div className="border-t divider-color p-2">
        <button
          aria-pressed={view === 'plugins'}
          onClick={() => onNavigate('plugins')}
          className={cn(
            'interactive flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium',
            view === 'plugins'
              ? 'bg-[var(--surface-hover)] text-[var(--ink)]'
              : 'text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
          )}
        >
          <Blocks className="h-3.5 w-3.5" /> Integrations & Plugins
        </button>
        <button
          aria-pressed={view === 'settings'}
          onClick={() => onNavigate('settings')}
          className={cn(
            'interactive mt-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium',
            view === 'settings'
              ? 'bg-[var(--surface-hover)] text-[var(--ink)]'
              : 'text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
          )}
        >
          <Settings className="h-3.5 w-3.5" /> Settings
        </button>
      </div>
    </aside>
  );
}
