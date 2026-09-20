import type { Vec3 } from "@dont-fall/shared";
import * as THREE from "three";

/**
 * Other beans' names over their heads in a Round (ADR 0110) — the pause
 * sheet's SHOW OTHER BEANS' NAMES. Plain DOM beside the canvas, placed every
 * frame by projecting each head through the Stage's camera: a per-frame value,
 * so never through React (ADR 0060). The design has no nameplate of its own;
 * this is its plate pill — the charge card's dark plate, its UI type.
 */

/** How far above the capsule's centre a plate sits (m) — clear of the head and a hat. */
export const NAMEPLATE_HEAD_OFFSET = 1.35;
/** Past this distance (m) a plate hides: a crowd of names far off is noise. */
export const NAMEPLATE_MAX_DISTANCE = 40;

export interface NameplateEntry {
  id: string;
  name: string;
  position: Vec3;
  /** Whether this Player is talking right now (ADR 0111) — the plate goes go-coloured while they are. */
  speaking?: boolean;
}

/** The plate's ordinary colours, and the ones it wears while its Player is talking. */
const PLATE_QUIET = { background: "rgba(43, 27, 77, .6)", color: "var(--df-color-on-brand, #fff)" };
const PLATE_SPEAKING = { background: "var(--df-color-go, #2FD9A0)", color: "var(--df-color-go-ink, #0E4736)" };

export interface Nameplates {
  /** Places every plate for this frame's camera; hides them all when `visible` is false. */
  update: (camera: THREE.Camera, width: number, height: number, entries: readonly NameplateEntry[], visible: boolean) => void;
  dispose: () => void;
}

/** Where a head lands on screen, in px, or `null` when it is behind the camera or too far away. */
export const projectNameplate = (
  camera: THREE.Camera,
  width: number,
  height: number,
  position: Vec3,
): { x: number; y: number } | null => {
  const head = new THREE.Vector3(position.x, position.y + NAMEPLATE_HEAD_OFFSET, position.z);
  if (camera.position.distanceTo(head) > NAMEPLATE_MAX_DISTANCE) return null;
  const ndc = head.project(camera);
  if (ndc.z < -1 || ndc.z > 1) return null;
  return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
};

export const createNameplates = (mount: HTMLElement): Nameplates => {
  const layer = document.createElement("div");
  Object.assign(layer.style, { position: "fixed", inset: "0", pointerEvents: "none", overflow: "hidden" });
  mount.appendChild(layer);
  const plates = new Map<string, HTMLSpanElement>();

  const plateFor = (id: string): HTMLSpanElement => {
    let plate = plates.get(id);
    if (!plate) {
      plate = document.createElement("span");
      Object.assign(plate.style, {
        position: "absolute",
        left: "0",
        top: "0",
        padding: "3px 9px",
        borderRadius: "999px",
        background: PLATE_QUIET.background,
        color: PLATE_QUIET.color,
        font: "var(--df-weight-label, 800) 11px/1 var(--df-font-ui, sans-serif)",
        letterSpacing: "0.06em",
        whiteSpace: "nowrap",
        transform: "translate(-50%, -100%)",
        willChange: "transform",
      });
      layer.appendChild(plate);
      plates.set(id, plate);
    }
    return plate;
  };

  return {
    update: (camera, width, height, entries, visible) => {
      const seen = new Set<string>();
      if (visible) {
        for (const entry of entries) {
          const at = projectNameplate(camera, width, height, entry.position);
          if (at === null) continue;
          const plate = plateFor(entry.id);
          const label = entry.name.toUpperCase();
          if (plate.textContent !== label) plate.textContent = label;
          // The same cue the Avatars wear (ADR 0111), in the one vocabulary a
          // bare DOM pill has. Written only on the change: this runs for every
          // plate every frame, and assigning an unchanged style still costs a
          // style recalculation.
          const look = entry.speaking === true ? PLATE_SPEAKING : PLATE_QUIET;
          if (plate.style.background !== look.background) {
            plate.style.background = look.background;
            plate.style.color = look.color;
          }
          plate.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -100%)`;
          plate.style.display = "";
          seen.add(entry.id);
        }
      }
      for (const [id, plate] of plates) {
        if (seen.has(id)) continue;
        if (entries.some((entry) => entry.id === id)) plate.style.display = "none";
        else {
          plate.remove();
          plates.delete(id);
        }
      }
    },
    dispose: () => layer.remove(),
  };
};
