import { useState } from 'react';
import Editor from '../components/Editor';
import LiveEditor from '../components/LiveEditor';
import GraphCanvas from '../components/GraphCanvas';
import MDXPreview from '../components/MDXPreview';
import XtermTerminal from '../components/XtermTerminal';
import type { NoteData, SurfaceProps } from './index';
import type { PanelSpec } from './layout';

export interface PanelContext {
  spec: PanelSpec;
  surface: SurfaceProps;
}

export type PanelRenderer = (context: PanelContext) => JSX.Element;

const registry = new Map<string, PanelRenderer>();

export function registerPanel(kind: string, renderer: PanelRenderer): void {
  registry.set(kind, renderer);
}

export function getPanel(kind: string): PanelRenderer | undefined {
  return registry.get(kind);
}

function folderOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i + 1) : '';
}

function scopeNotes(surface: SurfaceProps, spec: PanelSpec): NoteData[] {
  const scope = typeof spec.scope === 'string' ? spec.scope : 'repo';
  if (scope === 'active' && surface.selectedNote) {
    const active = surface.notesData.find((note) => note.path === surface.selectedNote);
    if (!active) return [];
    const links = new Set<string>();
    const re = /\[\[(.*?)\]\]/g;
    let match;
    while ((match = re.exec(active.content)) !== null) {
      const target = match[1].trim().toLowerCase();
      for (const note of surface.notesData) {
        const label = note.path.replace(/\.(md|mdx)$/, '').toLowerCase();
        const base = label.split('/').pop();
        if (label === target || base === target) links.add(note.path);
      }
    }
    return surface.notesData.filter((note) => note.path === active.path || links.has(note.path));
  }
  if (scope === 'folder') {
    const root = typeof spec.root === 'string' ? spec.root : folderOf(surface.selectedNote ?? surface.path);
    return surface.notesData.filter((note) => note.path.startsWith(root));
  }
  return surface.notesData;
}

function GraphPanel({ spec, surface }: PanelContext) {
  return (
    <div className="h-full">
      <GraphCanvas
        notesData={scopeNotes(surface, spec)}
        onSelectNote={surface.onSelectNote}
        selectedNote={surface.selectedNote}
        emptyHint="Select a note to see it and its linked notes here."
      />
    </div>
  );
}

type EditMode = 'reading' | 'live' | 'split';

// The main slot in a neuron.config shell. Three views like the standalone editor:
// reading (default), live editor (double-click to enter), and split source+preview.
function EditorPanel({ surface }: PanelContext) {
  const { selectedNote, noteContent, onChangeNote, colorScheme } = surface;
  const [modes, setModes] = useState<Record<string, EditMode>>({});

  const isNote = !!selectedNote && /\.(md|mdx)$/.test(selectedNote);
  if (!selectedNote || !isNote || noteContent === undefined || !onChangeNote) {
    return <div className="grid h-full place-items-center px-6 text-center text-xs text-[var(--ink-muted)]">Select a note from the sidebar or graph to edit it here.</div>;
  }

  const mode = modes[selectedNote] ?? 'reading';
  const setMode = (next: EditMode) => setModes((prev) => ({ ...prev, [selectedNote]: next }));
  const scheme = colorScheme ?? 'dark';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-0.5 border-b border-[var(--divider)] px-2 py-1">
        {(['reading', 'live', 'split'] as EditMode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={`interactive rounded px-2 py-0.5 text-[11px] font-medium capitalize ${mode === m ? 'bg-[var(--surface-hover)] text-[var(--ink)]' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'reading' && (
          <div className="h-full overflow-auto" onDoubleClick={() => setMode('live')}>
            <MDXPreview mdxContent={noteContent} onLineClick={() => undefined} />
          </div>
        )}
        {mode === 'live' && <LiveEditor value={noteContent} onChange={onChangeNote} colorScheme={scheme} />}
        {mode === 'split' && (
          <div className="flex h-full divide-x divide-[var(--divider)]">
            <div className="min-w-0 flex-1"><Editor value={noteContent} onChange={onChangeNote} colorScheme={scheme} /></div>
            <div className="min-w-0 flex-1 overflow-auto"><MDXPreview mdxContent={noteContent} onLineClick={() => undefined} /></div>
          </div>
        )}
      </div>
    </div>
  );
}

function TreePanel({ surface }: PanelContext) {
  return (
    <div className="h-full overflow-auto border-r border-[var(--divider)] bg-[var(--surface)] p-2">
      {surface.notesData.map((note) => (
        <button
          key={note.path}
          type="button"
          className="interactive block w-full truncate rounded px-2 py-1.5 text-left font-mono text-xs text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
          onClick={() => surface.onSelectNote(note.path)}
        >
          {note.path}
        </button>
      ))}
    </div>
  );
}

function TerminalPanel() {
  return <XtermTerminal />;
}

function PreviewPanel({ spec, surface }: PanelContext) {
  const path = typeof spec.path === 'string' ? spec.path : surface.selectedNote;
  const note = surface.notesData.find((item) => item.path === path);
  return <MDXPreview mdxContent={note?.content ?? ''} onLineClick={() => undefined} />;
}

registerPanel('editor', EditorPanel);
registerPanel('tree', TreePanel);
registerPanel('graph', GraphPanel);
registerPanel('terminal', TerminalPanel);
registerPanel('preview', PreviewPanel);
registerPanel('note', PreviewPanel);
