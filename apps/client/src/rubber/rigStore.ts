import type { BoneSpec } from "@dont-fall/shared";
import * as THREE from "three";
import type { RigDraft } from "./rigTool.js";

/**
 * Keeps the work across a reload (the user's ask, 2026-09-20: "musíme to
 * ukládat průběžně"). A tuning session is an hour of small decisions and
 * losing it to a refresh — or to a mistyped number — is the worst thing this
 * page could do.
 *
 * Per-viewer browser storage, so it never leaves the machine and never
 * reaches anything else. Every read and write is guarded: a private window,
 * cleared site data or a blocked origin all throw here, and the page has to
 * carry on with the numbers it was built with.
 */

const KEY = "dont-fall.rubber.rig.v2";

type SavedJoint = {
  name: string;
  parent: string | null;
  at: { x: number; y: number; z: number };
  width: number;
  depth: number;
  length: number;
  shapeOffset: { x: number; y: number; z: number };
  roundness: number;
  mass: number;
  drives?: string;
  aim?: { x: number; y: number; z: number; w: number };
  fixedRotation?: { x: number; y: number; z: number; w: number };
  hullPoints?: readonly { x: number; y: number; z: number }[];
};

interface Saved {
  /** Which skeleton was last being worked on. */
  selected?: string;
  /** What was done to each one, kept apart so switching never costs anything. */
  perSkeleton?: Record<string, { draft: SavedJoint[]; bones: BoneSpec[] }>;
}

/** What has been done to one skeleton. */
export interface RigWork {
  draft: RigDraft;
  bones: readonly BoneSpec[];
}

/** Everything the page would hate to lose: the work on each skeleton, and which one was open. */
export interface RigSession {
  selected: string;
  work: Record<string, RigWork>;
}

export const saveRig = (session: RigSession): void => {
  try {
    const saved: Saved = { selected: session.selected, perSkeleton: {} };
    for (const [name, work] of Object.entries(session.work)) {
      saved.perSkeleton![name] = {
        draft: work.draft.map((joint) => ({ ...joint, at: { x: joint.at.x, y: joint.at.y, z: joint.at.z } })),
        bones: [...work.bones],
      };
    }
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage is a convenience here, never a requirement.
  }
};

/**
 * What was saved, or nothing. `hinge` is deliberately not carried across:
 * nothing in the tool can change one, so it is taken fresh from the skeleton
 * the draft is rebuilt against rather than risking a stale copy.
 */
export const loadRig = (): RigSession | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    if (!saved.perSkeleton) return null;
    const work: Record<string, RigWork> = {};
    for (const [name, kept] of Object.entries(saved.perSkeleton)) {
      if (!kept.draft || !kept.bones) continue;
      work[name] = {
        draft: kept.draft.map((joint) => ({ ...joint, at: new THREE.Vector3(joint.at.x, joint.at.y, joint.at.z) })),
        bones: kept.bones,
      };
    }
    return { selected: saved.selected ?? "game", work };
  } catch {
    return null;
  }
};

export const clearRig = (): void => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do: there was nothing to clear.
  }
};
