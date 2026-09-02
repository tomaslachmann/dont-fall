import type { Module } from "./Module.js";
import { chainTrack, type Track } from "./Track.js";

const box = (center: { x: number; y: number; z: number }, halfExtents: { x: number; y: number; z: number }) => ({
  center,
  halfExtents,
});

/**
 * The M1 playground's five stops plus its end sandbox, ported from
 * `playground.ts`'s hand-authored world-space geometry (ticket 06's Spinner
 * tuning, ticket 07's feel-tuning) into reusable Modules on `MODULE_STEP`'s
 * uniform footprint (ADR 0030). Same beats, same Spinner/Prop/Checkpoint
 * tuning values, re-centered per-Module — not byte-identical world geometry
 * (M1's hand-tuned platform widths/gaps varied per-stop, which a uniform
 * footprint deliberately no longer allows), but the same declining run of
 * platforms and bridges with identical obstacle feel.
 */
export const M1_MODULES: Record<string, Module> = {
  start: {
    id: "start",
    statics: [
      box({ x: 0, y: -0.5, z: 0 }, { x: 4, y: 0.5, z: 4 }),
      box({ x: -3.2, y: 0.5, z: 0 }, { x: 0.4, y: 1.5, z: 3 }), // wall
    ],
  },
  bridge: {
    id: "bridge",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
  },
  "checkpoint-spinner": {
    id: "checkpoint-spinner",
    statics: [box({ x: 0, y: -0.1, z: 0 }, { x: 3, y: 0.5, z: 4 })],
    checkpoint: {
      respawn: { x: 0, y: 1.35, z: 0 },
      volume: { center: { x: 0, y: 1.35, z: 0 }, halfExtents: { x: 2.5, y: 2, z: 3.5 } },
    },
    spinners: [{ center: { x: 0, y: 0.95, z: 3 }, armLength: 2.5, halfHeight: 0.4, armRadius: 0.35, angularSpeed: 6.5 }],
  },
  "bridge-2": {
    id: "bridge-2",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
  },
  "checkpoint-end-props": {
    id: "checkpoint-end-props",
    statics: [box({ x: 0, y: -0.6, z: 0 }, { x: 4, y: 0.5, z: 4.5 })],
    checkpoint: {
      respawn: { x: 0, y: 0.85, z: 0 },
      volume: { center: { x: 0, y: 0.85, z: 0 }, halfExtents: { x: 3.5, y: 2, z: 4 } },
    },
    props: [
      { shape: { kind: "box", halfExtents: { x: 0.4, y: 0.4, z: 0.4 } }, center: { x: -1.5, y: 0.3, z: 1 } },
      { shape: { kind: "ball", radius: 0.4 }, center: { x: 1.5, y: 0.3, z: 1 } },
      { shape: { kind: "box", halfExtents: { x: 0.35, y: 0.35, z: 0.35 } }, center: { x: 0, y: 0.25, z: -1.5 } },
    ],
  },
  sandbox: {
    id: "sandbox",
    statics: [box({ x: 0, y: -0.1, z: 0 }, { x: 15, y: 0.5, z: 15 })],
  },
};

/** The M1 playground, reassembled through the Module/Track system (ticket 01). */
export const M1_TRACK: Track = chainTrack(
  ["start", "bridge", "checkpoint-spinner", "bridge-2", "checkpoint-end-props", "sandbox"],
  { x: 0, y: 0, z: 10 },
);

/**
 * Every Module currently known to the shared package — what the Match server
 * resolves a fetched Track against (ADR 0028). Grows as more Modules are
 * authored; today it's exactly M1's set.
 */
export const MODULE_LIBRARY: Record<string, Module> = M1_MODULES;
