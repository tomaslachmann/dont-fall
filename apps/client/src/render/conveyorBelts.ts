import {
  chevronPose,
  conjugateQuat,
  rotateVec3ByQuat,
  stripLayout,
  yawQuat,
  type ConveyorBelt,
  type MovingSegmentConfig,
} from "@dont-fall/shared";
import * as THREE from "three";
import { seatOnDeck } from "./deckSeat.js";

/**
 * KayKit arrow white — a belt's arrows are the `platform_arrow` look: a fat
 * white chevron painted on the deck's own coloured top, never a plate over
 * it. No dark backing, so the asset's texture stays visible and the arrows
 * read as printed on the surface, exactly like the authored piece.
 */
const CHEVRON_COLOR = 0xffffff;

/**
 * Lift above the deck top: a decal's clearance, just enough to win depth
 * (with the chevrons' own polygon offset) without visibly floating.
 */
const STRIP_LIFT = 0.015;

/**
 * Frozen chevrons for `prefers-reduced-motion`: the march is reinforcement,
 * never the message — the chevrons' own orientation already points along
 * the flow, so freezing the phase keeps every bit of meaning.
 */
const REDUCED_MOTION =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * One belt's chevron strip (ADR 0064) — a grid of KayKit-white arrows lying
 * on the Segment's own deck top, marching along the flow at the belt's own
 * true speed, so what you see is exactly what carries you.
 */
export interface ConveyorStrip {
  /**
   * The strip, transformed into its parent's own frame — the scene for a
   * still Segment, the Moving Segment's group (placement only, motion
   * unapplied, exactly like its box visuals) for a moving one.
   */
  object: THREE.Group;
  /**
   * Index into the `moving` array this belt rides, or `null` for a still
   * Segment (parent to the scene). Aligned with the stage's own
   * `movingGroups`, which follow the same array in the same order.
   */
  movingIndex: number | null;
  /** March the chevrons — `tSeconds` is continuous *sim* time, so belts pause with the sim. */
  update: (tSeconds: number) => void;
}

/**
 * A KayKit `platform_arrow` chevron pointing +Y in shape space — laid flat it
 * points along -Z (three.js forward). Proportions measured off the authored
 * 2×2×1 top (1.9 wide: tip z −0.65, wing front −0.25, notch +0.25, wing back
 * +0.65), normalised to a 1.2-wide glyph: the same fat arrow, sized to its
 * grid cell instead of full-bleed. Already centred, so no post-rotation
 * translate.
 */
const chevronGeometry = (): THREE.ShapeGeometry => {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.41); // tip
  shape.lineTo(0.6, 0.16); // wing front, right
  shape.lineTo(0.6, -0.41); // wing back, right
  shape.lineTo(0, -0.16); // notch
  shape.lineTo(-0.6, -0.41); // wing back, left
  shape.lineTo(-0.6, 0.16); // wing front, left
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2); // +Y (the tip) becomes -Z; the arrow lies in the XZ plane
  return geo;
};

/** The yaw taking -Z (the chevrons' own forward) onto `(x, z)`. */
const yawToFlow = (x: number, z: number): number => Math.atan2(-x, -z);

export const buildConveyorStrips = (
  allBelts: readonly ConveyorBelt[],
  moving: readonly MovingSegmentConfig[],
): ConveyorStrip[] => {
  // An Asset that *is* a belt draws its own flow — its slats ride a loop
  // (ADR 0120), and a chevron strip over them would be a second answer.
  const belts = allBelts.filter((belt) => belt.own !== true);
  if (belts.length === 0) return [];
  // One geometry/material pair per stage, shared by every strip in it — the
  // same sharing `checkpointMaterial` already relies on (dispose reaches
  // them through the meshes; repeated disposal is harmless). Lit, like the
  // texture it sits in — an unlit decal would stay full-bright where the
  // deck shades, and read as floating. The polygon offset wins depth at a
  // decal's lift, where a bare 0.015 could z-fight at a distance.
  const chevronGeo = chevronGeometry();
  const chevronMat = new THREE.MeshStandardMaterial({
    color: CHEVRON_COLOR,
    roughness: 0.85,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide,
  });

  return belts.map((belt) => {
    const speed = Math.hypot(belt.velocity.x, belt.velocity.z);
    const { halfX, halfZ } = belt.deck;

    // The flow in the deck's own frame. A belt's velocity is world-horizontal
    // (ADR 0064); on a pitched deck the strip still lies in the deck's plane,
    // pointing where that flow runs across it.
    const flow = rotateVec3ByQuat(belt.velocity, conjugateQuat(belt.deck.orientation));
    const across = Math.hypot(flow.x, flow.z) || 1;
    const fx = flow.x / across;
    const fz = flow.z / across;

    // The deck frame's flow/lateral half-extents: the deck rect projected
    // onto the flow direction and its perpendicular. A free-angle belt runs
    // diagonally across its deck as readily as along it.
    const halfL = halfX * Math.abs(fx) + halfZ * Math.abs(fz);
    const halfW = halfX * Math.abs(fz) + halfZ * Math.abs(fx);

    // The grid itself is shared layout math (`conveyorStrip.ts`) — the same
    // belt an author places is the belt a player runs on, by construction.
    const layout = stripLayout(halfL, halfW);
    const { unit, perRow, rows } = layout;

    const object = new THREE.Group();
    const movingIndex = moving.findIndex((c) => c.segmentIndex === belt.segmentIndex);
    seatOnDeck(object, belt.deck, STRIP_LIFT, moving[movingIndex], yawQuat(yawToFlow(fx, fz)));

    const chevrons: THREE.Mesh[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let i = 0; i < perRow; i += 1) {
        const chevron = new THREE.Mesh(chevronGeo, chevronMat);
        chevron.scale.setScalar(unit);
        const p0 = chevronPose(layout, i, 0);
        chevron.position.set(layout.laterals[row]!, p0.y, p0.z);
        chevron.rotation.x = p0.pitch;
        chevron.userData.marchIndex = i;
        object.add(chevron);
        chevrons.push(chevron);
      }
    }

    return {
      object,
      movingIndex: movingIndex < 0 ? null : movingIndex,
      update: (tSeconds: number) => {
        // True belt speed in units/s — what you see is what carries you.
        // Each chevron also folds over the deck edge at the travel ends
        // (half still on top, half already bending down), so the wrap reads
        // as a belt feeding around its roller, never teleporting.
        const phase = REDUCED_MOTION ? 0 : tSeconds * speed;
        for (const chevron of chevrons) {
          const pose = chevronPose(layout, chevron.userData.marchIndex as number, phase);
          chevron.position.z = pose.z;
          chevron.position.y = pose.y;
          chevron.rotation.x = pose.pitch;
        }
      },
    };
  });
};
