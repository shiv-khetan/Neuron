import type { ComponentType } from 'react';

/** A note in memory: repo-relative path + raw file content. */
export interface NoteData {
  path: string;
  content: string;
}

/**
 * Props every file-surface receives. A surface replaces the Markdown editor for
 * files whose extension is registered below — the file itself is a small JSON
 * *declaration*, never stored render output.
 */
export interface SurfaceProps {
  /** Repo-relative path of the opened special file. */
  path: string;
  /** Raw file content (JSON config). */
  content: string;
  /** All notes in the repo (for view blocks and previews). */
  notesData: NoteData[];
  /** Open a note by repo-relative path. */
  onSelectNote: (note: string) => void;
  selectedNote: string | null;
  /** Live content of the active note when rendering the internal neuron.config shell. */
  noteContent?: string;
  /** Persist a change to the active note from the internal shell editor panel. */
  onChangeNote?: (value: string) => void;
  /** Editor color scheme for the internal shell editor panel. */
  colorScheme?: 'light' | 'dark';
}

export type Surface = ComponentType<SurfaceProps>;

/** Extension (without dot) → surface component. Populated by registerSurface. */
const registry = new Map<string, Surface>();

export function registerSurface(extension: string, surface: Surface): void {
  registry.set(extension.toLowerCase().replace(/^\./, ''), surface);
}

/** Returns the surface for a path's extension, or undefined for normal notes. */
export function getSurface(path: string): Surface | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? registry.get(ext) : undefined;
}

/** Extensions that are special surfaces (used to label/route in the UI). */
export const SURFACE_EXTENSIONS = ['vw', 'db', 'canvas'] as const;

/** True if a path is any special surface file. */
export function isSurfaceFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return (SURFACE_EXTENSIONS as readonly string[]).includes(ext);
}
