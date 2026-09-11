import { lazy, Suspense } from 'react';
import type { NoteData } from '../lib/knowledge-graph';
export type { NoteData } from '../lib/knowledge-graph';
export interface GraphCanvasProps {
  notesData: NoteData[];
  onSelectNote: (note: string) => void;
  selectedNote: string | null;
  searchQuery?: string;
  emptyHint?: string;
  compact?: boolean;
  scope?: 'repo' | 'active' | 'folder';
  folder?: string;
}
const SigmaGraph = lazy(() => import('./SigmaGraph'));
export default function GraphCanvas(props: GraphCanvasProps) {
  return <Suspense fallback={<div role="status" className="p-3 text-xs text-[var(--ink-muted)]">Loading connections…</div>}><SigmaGraph {...props} /></Suspense>;
}
