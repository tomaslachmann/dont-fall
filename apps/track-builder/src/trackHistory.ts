import type { Track } from "@dont-fall/shared";

/**
 * Undo/redo for the Track builder (ticket 08) as a plain stack of whole-Track
 * snapshots, not per-operation `EditorCommand.undo()` inversion logic. A
 * Track here is a handful of Segments, not thousands — snapshotting the
 * whole array on every edit is simpler and has no real cost at this scale.
 * `docs/track-builder-proposal.md`'s command-object pattern (with per-command
 * `undo`, coalescing, audit logs) solves problems — large history size,
 * collaboration, diffing revisions — this tool doesn't have yet; reach for
 * it if one of those becomes real.
 */
export class TrackHistory {
  private undoStack: Track[] = [];
  private redoStack: Track[] = [];
  private current: Track;

  constructor(initial: Track) {
    this.current = initial;
  }

  get track(): Track {
    return this.current;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Applies `next` as a new, undoable state. */
  apply(next: Track): void {
    this.undoStack.push(this.current);
    this.redoStack = [];
    this.current = next;
  }

  /** Replaces the current state without creating an undo step (e.g. loading a Track). */
  reset(next: Track): void {
    this.undoStack = [];
    this.redoStack = [];
    this.current = next;
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (previous === undefined) return;
    this.redoStack.push(this.current);
    this.current = previous;
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.current);
    this.current = next;
  }
}
