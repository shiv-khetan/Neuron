import * as React from 'react';
import { Blocks, FileCode2, FolderGit2, LayoutGrid, Search, Settings, Tag } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '../lib/utils';

type View = 'notes' | 'repositories' | 'plugins' | 'settings' | 'gallery';
export type SidebarMode = 'files' | 'search' | 'tags';

interface ActivityRailProps {
  view: View;
  sidebarMode: SidebarMode;
  sidebarOpen: boolean;
  tagCount: number;
  /** Select a sidebar mode (opens the sidebar; re-selecting toggles it closed). */
  onSelectMode: (mode: SidebarMode) => void;
  onNavigate: (view: View) => void;
}

function RailButton({ label, active, badge, onClick, children }: {
  label: string; active: boolean; badge?: number; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            'interactive relative grid h-10 w-full place-items-center border-l-2 border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]',
            active && 'border-[var(--accent)] text-[var(--ink)]',
          )}
        >
          {children}
          {badge !== undefined && badge > 0 && (
            <span className="absolute right-1 top-1 min-w-[14px] rounded-full bg-[var(--accent)] px-1 text-center text-[9px] font-semibold leading-[14px] text-[var(--canvas)]">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

// Narrow icon rail: top items switch the sidebar's content, bottom items open
// full-page views. Re-clicking the active top item collapses the sidebar.
export default function ActivityRail(props: ActivityRailProps) {
  const { view, sidebarMode, sidebarOpen, tagCount, onSelectMode, onNavigate } = props;
  const modeActive = (mode: SidebarMode) => view === 'notes' && sidebarOpen && sidebarMode === mode;

  return (
    <nav aria-label="Activity" className="nav-surface flex h-full w-10 shrink-0 flex-col items-stretch border-r divider-color py-1">
      <RailButton label="Explorer" active={modeActive('files')} onClick={() => onSelectMode('files')}>
        <FileCode2 className="h-[18px] w-[18px]" />
      </RailButton>
      <RailButton label="Search notes" active={modeActive('search')} onClick={() => onSelectMode('search')}>
        <Search className="h-[18px] w-[18px]" />
      </RailButton>
      <RailButton label="Tags" active={modeActive('tags')} badge={tagCount} onClick={() => onSelectMode('tags')}>
        <Tag className="h-[18px] w-[18px]" />
      </RailButton>
      <RailButton label="Workspaces" active={view === 'repositories'} onClick={() => onNavigate('repositories')}>
        <FolderGit2 className="h-[18px] w-[18px]" />
      </RailButton>

      <div className="mt-auto">
        <RailButton label="Component gallery" active={view === 'gallery'} onClick={() => onNavigate('gallery')}>
          <LayoutGrid className="h-[18px] w-[18px]" />
        </RailButton>
        <RailButton label="Integrations & Plugins" active={view === 'plugins'} onClick={() => onNavigate('plugins')}>
          <Blocks className="h-[18px] w-[18px]" />
        </RailButton>
        <RailButton label="Settings" active={view === 'settings'} onClick={() => onNavigate('settings')}>
          <Settings className="h-[18px] w-[18px]" />
        </RailButton>
      </div>
    </nav>
  );
}
