import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileWarning, Loader2, RotateCw, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { registerSurface, type SurfaceProps } from './index';
import type { HtmxViewOpenResult } from '../electron.d';

// The HTMX view tab. The document itself renders inside a sandboxed <webview>
// (no Node, no preload, isolated in-memory partition) pointed at the loopback
// view server — user-authored HTML never touches the privileged renderer DOM.
// The existing Preview/Source header toggle doubles as "Edit source".

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; sessionId: string; url: string; partition: string; name: string }
  | { kind: 'needs-approval'; name: string; permissions: string[]; description?: string }
  | { kind: 'error'; message: string }
  | { kind: 'crashed' };

const CAP_LABELS: Record<string, string> = {
  'workspace.files.write': 'Modify existing files in its allowed paths',
  'workspace.files.create': 'Create new files in its allowed paths',
  'workspace.files.delete': 'Delete files in its allowed paths',
  'variables.write': 'Update writable workspace variables',
  'workspace.files.read': 'Read files in its allowed paths',
  'workspace.directories.list': 'List workspace files',
  'workspace.search': 'Search notes',
  'notes.read': 'Read note content and metadata',
  'tags.read': 'Read tags',
  'variables.read': 'Read workspace variables',
};

export function HtmxViewSurface({ path, colorScheme }: SurfaceProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const webviewRef = useRef<any>(null);
  const sessionRef = useRef<string | null>(null);

  const open = useCallback(async () => {
    setPhase({ kind: 'loading' });
    if (sessionRef.current) { void window.electronAPI.htmxViews.close(sessionRef.current); sessionRef.current = null; }
    const result: HtmxViewOpenResult = await window.electronAPI.htmxViews.open(path, colorScheme ?? 'dark');
    if (result.status === 'ready') {
      sessionRef.current = result.sessionId;
      setPhase({ kind: 'ready', ...result });
    } else if (result.status === 'needs-approval') {
      setPhase({ kind: 'needs-approval', name: result.name, permissions: result.permissions, description: result.description });
    } else {
      setPhase({ kind: 'error', message: result.message });
    }
  }, [path, colorScheme]);

  useEffect(() => {
    void open();
    return () => {
      if (sessionRef.current) { void window.electronAPI.htmxViews.close(sessionRef.current); sessionRef.current = null; }
    };
  }, [open]);

  // Reload the tab (not the app) when this view's source or .neuron config
  // changes on disk. A fresh session re-reads manifest and permissions.
  useEffect(() => {
    return window.electronAPI.onNotesChanged((_event, changed) => {
      // Not variables.json: views write variables through the API and a reload
      // on every variable change would wipe in-page form state.
      const mine = changed === path
        || changed === path.replace(/\.nhtml$/i, '.neuron.json')
        || changed.startsWith('.neuron/fragments/')
        || changed.startsWith('.neuron/styles/')
        || changed === '.neuron/config.json';
      if (mine) void open();
    });
  }, [path, open]);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || phase.kind !== 'ready') return;
    const onCrash = () => setPhase({ kind: 'crashed' });
    wv.addEventListener('render-process-gone', onCrash);
    return () => wv.removeEventListener('render-process-gone', onCrash);
  }, [phase.kind]);

  const approve = async (scope: 'always' | 'once') => {
    const result = await window.electronAPI.htmxViews.approve(path, scope);
    if (result.success) void open();
    else setPhase({ kind: 'error', message: result.error ?? 'Approval failed.' });
  };

  const centered = (children: React.ReactNode) => (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">{children}</div>
  );

  if (phase.kind === 'loading') {
    return centered(<><Loader2 className="h-5 w-5 animate-spin text-[var(--ink-muted)]" /><p className="text-xs text-[var(--ink-muted)]">Starting view…</p></>);
  }

  if (phase.kind === 'needs-approval') {
    const writeCaps = phase.permissions.filter((p) => p in CAP_LABELS);
    return centered(
      <div className="w-full max-w-md rounded-lg bg-[var(--surface)] p-5 text-left">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
          <ShieldQuestion className="h-4 w-4 text-[var(--accent-strong)]" /> “{phase.name}” requests permissions
        </div>
        {phase.description ? <p className="mt-1 text-xs text-[var(--ink-secondary)]">{phase.description}</p> : null}
        <ul className="mt-3 space-y-1.5">
          {writeCaps.map((cap) => (
            <li key={cap} className="flex items-start gap-2 text-xs text-[var(--ink-secondary)]">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
              <span>{CAP_LABELS[cap]} <code className="text-[10px] text-[var(--ink-muted)]">({cap})</code></span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-[var(--ink-muted)]">Permissions are limited to the paths declared in the view manifest. Editing the manifest re-requests approval.</p>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => void approve('always')}>Allow for this view</Button>
          <Button variant="secondary" onClick={() => void approve('once')}>Allow once</Button>
        </div>
      </div>,
    );
  }

  if (phase.kind === 'error') {
    return centered(<><FileWarning className="h-5 w-5 text-[var(--danger)]" /><p className="max-w-md text-xs text-[var(--ink-secondary)]">{phase.message}</p><p className="text-[11px] text-[var(--ink-muted)]">Switch to Source mode to edit this view or its manifest.</p></>);
  }

  if (phase.kind === 'crashed') {
    return centered(
      <>
        <AlertTriangle className="h-5 w-5 text-[var(--danger)]" />
        <p className="text-xs text-[var(--ink-secondary)]">This view crashed. Neuron itself is unaffected.</p>
        <Button variant="secondary" onClick={() => void open()}><RotateCw className="h-4 w-4" /> Reload view</Button>
      </>,
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-[var(--canvas)]">
      <div className="flex items-center gap-2 border-b divider-color px-3 py-1.5">
        <span className="truncate text-xs font-medium text-[var(--ink)]">{phase.name}</span>
        <span className="text-[10px] text-[var(--ink-muted)]">HTMX view · isolated</span>
        <button
          type="button"
          title="Reload view"
          aria-label="Reload view"
          className="interactive ml-auto grid h-6 w-6 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
          onClick={() => void open()}
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <webview
          ref={webviewRef}
          src={phase.url}
          partition={phase.partition}
          style={{ width: '100%', height: '100%', display: 'flex' }}
        />
      </div>
    </div>
  );
}

registerSurface('nhtml', HtmxViewSurface);

export default HtmxViewSurface;
