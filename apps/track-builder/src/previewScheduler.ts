/** One palette preview as the scheduler drives it — see `createModulePreview`. */
export interface SchedulablePreview {
  /** Draws the preview at its current angle. */
  draw: () => void;
  /** Advances the auto-rotate one step, then draws. */
  spin: () => void;
}

export interface PreviewSlot {
  visible: boolean;
  hovered: boolean;
}

interface Slot extends PreviewSlot {
  preview: SchedulablePreview;
  drawn: boolean;
}

/**
 * How long one frame may spend drawing not-yet-drawn stills. A first draw
 * can upload a large asset's geometry and texture, so a count budget would
 * still let a handful of heavy ones stack into one long frame.
 */
export const STILL_BUDGET_MS = 6;

/**
 * Decides which palette previews draw on a frame. Every preview used to
 * re-render every frame — hidden tab, scrolled away or not — which at 124
 * asset previews held the whole builder near 11 fps. Now a preview on
 * screen is drawn once as a still (the 3/4 camera already reads as 3D), and
 * only the hovered one keeps auto-rotating; first draws are spread across
 * frames under `STILL_BUDGET_MS`, always at least one per frame so they
 * finish.
 */
export class PreviewScheduler {
  private readonly slots: Slot[] = [];

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Registers a preview; the returned slot's `visible`/`hovered` are the caller's to keep current. */
  add(preview: SchedulablePreview): PreviewSlot {
    const slot: Slot = { preview, visible: false, hovered: false, drawn: false };
    this.slots.push(slot);
    return slot;
  }

  /**
   * Unregisters a preview (React unmount / StrictMode remount) — without
   * this a detached tile's slot keeps its last `visible` forever and the
   * scheduler draws into a dead canvas every frame.
   */
  remove(slot: PreviewSlot): void {
    const index = this.slots.indexOf(slot as Slot);
    if (index >= 0) this.slots.splice(index, 1);
  }

  frame(): void {
    const start = this.now();
    let drewStill = false;
    for (const slot of this.slots) {
      if (!slot.visible) continue;
      if (slot.hovered) {
        slot.preview.spin();
        slot.drawn = true;
      } else if (!slot.drawn && (!drewStill || this.now() - start < STILL_BUDGET_MS)) {
        slot.preview.draw();
        slot.drawn = true;
        drewStill = true;
      }
    }
  }
}
