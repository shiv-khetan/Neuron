import { useState } from 'react';
import { FolderGit2, FolderOpen, FolderPlus, Cloud, HardDrive, ExternalLink, Pencil, Trash2, Check, X, CircleDot } from 'lucide-react';
import type { RepositoryInfo } from '../electron.d';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { cn } from '../lib/utils';

interface RepositoriesPageProps {
  current: RepositoryInfo | null;
  recents: RepositoryInfo[];
  onCreate: () => void;
  onOpen: () => void;
  onSwitch: (dir: string) => void;
  onReload: () => void;
}

export default function RepositoriesPage({ current, recents, onCreate, onOpen, onSwitch, onReload }: RepositoriesPageProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  // Merge current into the list in case it isn't in recents yet.
  const repos = current && !recents.some((r) => r.path === current.path) ? [current, ...recents] : recents;

  const startEdit = (repo: RepositoryInfo) => { setEditing(repo.path); setDraftName(repo.name); };
  const saveEdit = async (dir: string) => {
    await window.electronAPI.repository.setName(dir, draftName);
    setEditing(null);
    onReload();
  };
  const reveal = (dir: string) => window.electronAPI.repository.reveal(dir);
  const remove = async (dir: string) => {
    await window.electronAPI.repository.remove(dir);
    setPendingRemove(null);
    onReload();
  };

  return (
    <div className="canvas-surface flex h-full w-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b divider-color px-6 py-4">
        <div>
          <h1 className="text-base font-semibold tracking-[-0.01em] text-[var(--ink)]">Repositories</h1>
          <p className="mt-1 text-xs text-[var(--ink-secondary)]">Every repository you've opened. A repository is just a folder of notes — local or in a synced folder.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={onOpen}><FolderOpen className="h-3.5 w-3.5" /> Open folder</Button>
          <Button size="sm" onClick={onCreate}><FolderPlus className="h-3.5 w-3.5" /> Create</Button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-6">
          {repos.length === 0 ? (
            <p className="py-16 text-center text-sm text-[var(--ink-muted)]">No repositories yet. Create one or open a folder to begin.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-[var(--divider)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--nav)] text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Location</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {repos.map((repo) => {
                    const isActive = current?.path === repo.path;
                    const isEditing = editing === repo.path;
                    const isConfirming = pendingRemove === repo.path;
                    return (
                      <tr key={repo.path} className={cn('border-t border-[var(--divider)]', isActive && 'bg-[color-mix(in_oklch,var(--accent)_8%,var(--surface))]')}>
                        <td className="px-4 py-2.5">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <Input autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveEdit(repo.path)} className="h-7 w-40" />
                              <button aria-label="Save name" className="interactive grid h-7 w-7 place-items-center rounded text-[var(--accent-strong)] hover:bg-[var(--surface-hover)]" onClick={() => saveEdit(repo.path)}><Check className="h-3.5 w-3.5" /></button>
                              <button aria-label="Cancel" className="interactive grid h-7 w-7 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)]" onClick={() => setEditing(null)}><X className="h-3.5 w-3.5" /></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <FolderGit2 className="h-4 w-4 shrink-0 text-[var(--accent-strong)]" />
                              <span className="font-medium text-[var(--ink)]">{repo.name}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5"><span className="font-mono text-[11px] text-[var(--ink-muted)]">{repo.path}</span></td>
                        <td className="px-4 py-2.5">
                          {repo.cloud
                            ? <span className="flex items-center gap-1.5 text-xs text-[var(--ink-secondary)]"><Cloud className="h-3.5 w-3.5" /> Cloud</span>
                            : <span className="flex items-center gap-1.5 text-xs text-[var(--ink-secondary)]"><HardDrive className="h-3.5 w-3.5" /> Local</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {isActive
                            ? <Badge variant="default"><CircleDot className="mr-1 h-3 w-3" /> Active</Badge>
                            : <span className="text-xs text-[var(--ink-muted)]">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            {!isActive && <Button size="sm" variant="outline" onClick={() => onSwitch(repo.path)}>Open</Button>}
                            <button aria-label="Reveal in file explorer" title="Reveal in file explorer" className="interactive grid h-7 w-7 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]" onClick={() => reveal(repo.path)}><ExternalLink className="h-3.5 w-3.5" /></button>
                            <button aria-label="Edit name" title="Edit name" className="interactive grid h-7 w-7 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]" onClick={() => startEdit(repo)}><Pencil className="h-3.5 w-3.5" /></button>
                            {isConfirming ? (
                              <button className="interactive rounded px-1.5 py-1 text-[10px] font-semibold text-[var(--danger)] hover:bg-[var(--danger-surface)]" onClick={() => remove(repo.path)}>Remove?</button>
                            ) : (
                              <button aria-label="Remove from list" title="Remove from list" className="interactive grid h-7 w-7 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--danger-surface)] hover:text-[var(--danger)]" onClick={() => setPendingRemove(repo.path)}><Trash2 className="h-3.5 w-3.5" /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-[var(--ink-muted)]">Remove only forgets a repository from this list — its folder and notes stay on disk.</p>
        </div>
      </ScrollArea>
    </div>
  );
}
