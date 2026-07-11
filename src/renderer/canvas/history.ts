// Undo/redo for canvas documents as an immutable-snapshot stack. Docs are
// immutable objects, so a "snapshot" is just a reference — pushing costs
// nothing. Coalescing is structural: only committed writes push (a pointer
// drag or a typing burst stages many times but commits once).
//
// ponytail: snapshot stack, not an operation model — all mutations flow
// through one write() chokepoint, so swapping later is localized. Revisit if
// collaborative editing or >2 MB docs ever arrive.

import type { CanvasDoc } from './model';

const CAP = 100;

export class CanvasHistory {
  private past: CanvasDoc[] = [];
  private future: CanvasDoc[] = [];

  /** Record the document as it was *before* a committed change. Clears redo. */
  push(before: CanvasDoc): void {
    this.past.push(before);
    if (this.past.length > CAP) this.past.shift();
    this.future = [];
  }

  /** Returns the doc to restore, or null. `current` becomes redoable. */
  undo(current: CanvasDoc): CanvasDoc | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: CanvasDoc): CanvasDoc | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  /** Fresh document (initial load / different file): history restarts. */
  reset(): void {
    this.past = [];
    this.future = [];
  }
}
