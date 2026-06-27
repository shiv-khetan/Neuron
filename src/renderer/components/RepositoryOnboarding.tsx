import { FolderPlus, FolderOpen, FolderGit2, Cloud, ArrowRight } from 'lucide-react';
import type { RepositoryInfo } from '../electron.d';
import { Button } from './ui/button';

interface RepositoryOnboardingProps {
  recents: RepositoryInfo[];
  onCreate: () => void;
  onOpen: () => void;
  onSwitch: (dir: string) => void;
}

export default function RepositoryOnboarding({ recents, onCreate, onOpen, onSwitch }: RepositoryOnboardingProps) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto bg-[var(--canvas)] px-6 py-10">
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--accent)] text-[var(--canvas)]">
            <FolderGit2 className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-[-0.01em] text-[var(--ink)]">Open a workspace</h1>
            <p className="text-sm text-[var(--ink-secondary)]">A workspace is just a folder of Markdown notes — local, or inside a synced folder.</p>
          </div>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <button
            onClick={onCreate}
            className="interactive group flex flex-col items-start rounded-lg border border-[var(--divider)] bg-[var(--surface)] p-5 text-left hover:border-[color-mix(in_oklch,var(--accent)_40%,var(--divider))]"
          >
            <span className="grid h-9 w-9 place-items-center rounded-md border border-[var(--divider)] bg-[var(--canvas)] text-[var(--accent-strong)]">
              <FolderPlus className="h-4 w-4" />
            </span>
            <h2 className="mt-3 text-sm font-semibold text-[var(--ink)]">Create workspace</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-secondary)]">Pick a location and start a fresh workspace with a welcome note.</p>
            <span className="mt-3 flex items-center gap-1 text-xs font-medium text-[var(--accent-strong)] opacity-0 transition-opacity group-hover:opacity-100">
              New folder <ArrowRight className="h-3 w-3" />
            </span>
          </button>

          <button
            onClick={onOpen}
            className="interactive group flex flex-col items-start rounded-lg border border-[var(--divider)] bg-[var(--surface)] p-5 text-left hover:border-[color-mix(in_oklch,var(--accent)_40%,var(--divider))]"
          >
            <span className="grid h-9 w-9 place-items-center rounded-md border border-[var(--divider)] bg-[var(--canvas)] text-[var(--accent-strong)]">
              <FolderOpen className="h-4 w-4" />
            </span>
            <h2 className="mt-3 text-sm font-semibold text-[var(--ink)]">Open existing folder</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-secondary)]">Point Neuron at any folder — including a OneDrive or Dropbox folder.</p>
            <span className="mt-3 flex items-center gap-1 text-xs font-medium text-[var(--accent-strong)] opacity-0 transition-opacity group-hover:opacity-100">
              Choose folder <ArrowRight className="h-3 w-3" />
            </span>
          </button>
        </div>

        {recents.length > 0 && (
          <div className="mt-7">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">Recent</div>
            <div className="overflow-hidden rounded-lg border border-[var(--divider)]">
              {recents.map((repo, index) => (
                <button
                  key={repo.path}
                  onClick={() => onSwitch(repo.path)}
                  className={`interactive flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-hover)] ${index > 0 ? 'border-t border-[var(--divider)]' : ''}`}
                >
                  <FolderGit2 className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--ink)]">
                      {repo.name}
                      {repo.cloud && <Cloud className="h-3 w-3 text-[var(--ink-muted)]" />}
                    </div>
                    <div className="truncate font-mono text-[11px] text-[var(--ink-muted)]">{repo.path}</div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="mt-8 text-center text-[11px] text-[var(--ink-muted)]">
          Your notes stay as plain files on disk. Neuron never uploads them.
        </p>
        <div className="mt-3 flex justify-center sm:hidden">
          <Button variant="secondary" size="sm" onClick={onCreate}>Get started</Button>
        </div>
      </div>
    </div>
  );
}
