import { FileCode2, Globe, Plus, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface NoteTabsProps {
  tabs: string[];
  activeTab: string;
  onSelect: (note: string) => void;
  onClose: (note: string) => void;
  onCreate: () => void;
  onNewBrowser: () => void;
}

const isUrl = (s: string) => /^https?:\/\//.test(s);

function noteLabel(path: string) {
  if (isUrl(path)) {
    try { return new URL(path).hostname.replace(/^www\./, ''); } catch { return path; }
  }
  return path.split('/').pop()?.replace(/\.(md|mdx)$/, '') ?? path;
}

export default function NoteTabs({ tabs, activeTab, onSelect, onClose, onCreate, onNewBrowser }: NoteTabsProps) {
  return (
    <nav aria-label="Open notes" className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto">
      {tabs.map((note) => {
        const active = note === activeTab;
        return (
          <div
            key={note}
            className={cn(
              'group flex min-w-[8rem] max-w-[13rem] shrink-0 items-center border-r border-[var(--divider)]',
              active ? 'bg-[var(--canvas)] text-[var(--ink)]' : 'text-[var(--ink-muted)] hover:bg-[var(--surface)] hover:text-[var(--ink-secondary)]',
            )}
          >
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              title={note}
              className="interactive flex min-w-0 flex-1 items-center gap-2 self-stretch px-3 text-left text-xs"
              onClick={() => onSelect(note)}
              onAuxClick={(event) => { if (event.button === 1) onClose(note); }}
            >
              {isUrl(note)
                ? <Globe className={cn('h-3.5 w-3.5 shrink-0', active && 'text-[var(--accent-strong)]')} />
                : <FileCode2 className={cn('h-3.5 w-3.5 shrink-0', active && 'text-[var(--accent-strong)]')} />}
              <span className="truncate font-mono">{noteLabel(note)}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${noteLabel(note)}`}
              title="Close tab"
              className={cn(
                'interactive mr-1 grid h-7 w-7 shrink-0 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
                active ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
              )}
              onClick={() => onClose(note)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        aria-label="Create note"
        title="Create note"
        className="interactive grid h-full w-10 shrink-0 place-items-center text-[var(--ink-muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
        onClick={onCreate}
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Open website tab"
        title="Open website tab"
        className="interactive grid h-full w-10 shrink-0 place-items-center text-[var(--ink-muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
        onClick={onNewBrowser}
      >
        <Globe className="h-4 w-4" />
      </button>
    </nav>
  );
}
