import { orientBox, type Box, type OrientedBox } from "../math/box.js";
import type { Quat } from "../math/quat.js";
import { addVec3, rotateVec3ByQuat, scaleVec3, type Vec3 } from "../math/vec3.js";
import type { Checkpoint } from "../simulation/Checkpoint.js";
import type { FinishZone } from "../simulation/FinishZone.js";
import type { LaunchPadConfig } from "../simulation/LaunchPad.js";
import type { MovingSegmentConfig } from "../simulation/MovingSegment.js";
import type { PropConfig } from "../simulation/Prop.js";
import type { SpinnerConfig } from "../simulation/Spinner.js";
import type { VolumeConfig } from "../simulation/Volume.js";
import { PROP_ASSET_DENSITY, PROP_ASSET_MASS_MAX, PROP_ASSET_MASS_MIN } from "../tuning/world.js";
import { surfaceAttachmentOf } from "./Attachment.js";
import { moduleHasBounceSurface, type BounceDeck } from "./BounceOverlay.js";
import { conveyorWorldVelocity, DEPRECATED_MODULE_IDS, type ConveyorBelt, type DeckFrame } from "./Conveyor.js";
import { floorBelow, RESPAWN_ABOVE_FLOOR } from "./Course.js";
import { placeGate } from "./Gate.js";
import { moduleHasIceSurface, type IceDeck } from "./IceOverlay.js";
import { launchHeightOf, launchVelocityFor } from "./Launch.js";
import type { Hazard, Module } from "./Module.js";
import { hasMotion } from "./Motion.js";
import { moduleHasMudSurface, type MudDeck } from "./MudOverlay.js";
import { DEFAULT_SURFACE, type SurfaceId } from "./Surface.js";
import {
  gateCheckpointPlans,
  scaleBox,
  scaleSolidShape,
  segmentDeckFrame,
  segmentOrientation,
  segmentScale,
  type Segment,
  type Track,
} from "./Track.js";

/**
 * One asset Module's collision mesh in world space (M8 ticket 02) — the
 * trimesh half of what `resolveTrack` returns. `statics`/`staticSurfaces`
 * stay the box half; the two never mix within one Module (one carrying
 * both is refused), and `RapierSimulation` consumes both through the same
 * `staticSurfaceByHandle` machinery, never a parallel one.
 */
export interface StaticTrimesh {
  vertices: Vec3[];
  indices: number[];
  surface: SurfaceId;
  /** The owning Module's hazard, if any (ADR 0061). */
  hazard?: Hazard;
  /** World-space belt flow, when the owning Segment carries a Conveyor (ADR 0064). */
  conveyor?: Vec3;
}

/**
 * A Track flattened into the world-space geometry `RapierSimulation` and the
 * renderers consume — resolved once, never in the tick loop.
 */
export interface ResolvedTrack {
  statics: OrientedBox[];
  /**
   * Index-aligned with `statics`: the Surface each box collapses to
   * (`FloorBox.surface ?? Module.surface ?? "default"`, ADR 0036), or the
   * Segment's attached one, which wins over all of them.
   */
  staticSurfaces: SurfaceId[];
  /** Index-aligned with `statics`: the belt flow its Segment runs (ADR 0064), `undefined` for still floor. */
  staticConveyors: (Vec3 | undefined)[];
  /** World-space asset collision, index-aligned with nothing — each entry carries its own Surface (M8 ticket 02). */
  staticTrimeshes: StaticTrimesh[];
  props: PropConfig[];
  spinners: SpinnerConfig[];
  checkpoints: Checkpoint[];
  /**
   * Every Finish Zone the Track's Segments carry, in Track order (M4 ticket
   * 02, ADR 0039) — plural here and singular on the Module for exactly the
   * same reason `checkpoints`/`checkpoint` are. Empty for a Track that has no
   * Finish Zone at all, which is simply not raceable yet.
   */
  finishZones: FinishZone[];
  launchPads: LaunchPadConfig[];
  /**
   * Which Segment each entry of `launchPads` came from, index-aligned with it
   * (ADR 0069). Renderers only: it is what lets a client squash the Spring
   * that actually fired. Nothing that simulates reads it.
   */
  launchPadOwners: number[];
  volumes: VolumeConfig[];
  /**
   * Every Segment with a Motion (ADR 0061), its collision kept in local space
   * for one kinematic body — and therefore absent from `statics` and
   * `staticTrimeshes`. What it authors besides collision (Checkpoint, pads,
   * Finish Zone, Volumes, Props, Spinners) still resolves at the rest pose.
   */
  movingSegments: MovingSegmentConfig[];
  /** Every attached belt, for the renderers — physics reads belts off ground colliders, never this (ADR 0064). */
  conveyors: ConveyorBelt[];
  /** Every ice-surfaced deck, for the renderers — physics reads the Surface off ground colliders, never this (ADR 0066). */
  iceDecks: IceDeck[];
  /** Every mud-surfaced deck, for the renderers — same contract as `iceDecks` (ADR 0067). */
  mudDecks: MudDeck[];
  /** Every bouncy deck, for the renderers — same contract again (ADR 0070). */
  bounceDecks: BounceDeck[];
  /**
   * One human-readable line per thing the Track asks for that it will not get
   * — a retired Module, a Prop with nothing to collide as, a Checkpoint mark
   * off a gate. The Track still loads; the author has something to fix.
   */
  warnings: string[];
}

/**
 * What a Segment's collision is (ADR 0061/0095), and therefore where most of
 * what it authors goes:
 *
 * - `moving` — a kinematic body its Motion poses, collision in local space;
 * - `prop` — a dynamic body physics owns: an Asset Prop with solid parts to
 *   collide as (an Asset without any cannot be one, and stays `still`);
 * - `still` — everything else, baked into world-space colliders.
 *
 * Decided once, here, because every guard that went wrong in `resolveTrack`
 * was this question asked again somewhere else. The client's still Asset
 * visuals ask it too.
 */
export type SegmentBody = "still" | "moving" | "prop";

export const segmentBody = (segment: Segment, module: Module): SegmentBody => {
  if (hasMotion(segment.motion)) return "moving";
  if (segment.prop === true && (module.asset?.solid?.length ?? 0) > 0) return "prop";
  return "still";
};

/** One Segment as every family reads it — placed once, before any of them runs. */
interface PlacedSegment {
  index: number;
  segment: Segment;
  module: Module;
  orientation: Quat;
  scale: number;
  body: SegmentBody;
  /** World-space belt flow, when the Segment carries a Conveyor (ADR 0064). */
  belt: Vec3 | undefined;
  /** What a collision part carries besides its shape and Surface: the Module's hazard (ADR 0061) and the belt. */
  partExtras: { hazard?: Hazard; conveyor?: Vec3 };
  /** A Module-local box scaled, turned and placed — a real rotated collider at any angle (ADR 0034/0062). */
  placeBox: (box: Box) => OrientedBox;
  /** A Module-local point scaled, turned and placed. */
  placePoint: (point: Vec3) => Vec3;
  /**
   * The Surface a collision part ends up with: an attached one wins over
   * everything authored on the Segment (ADR 0066/0067/0070) — the whole deck
   * skates, drags or throws — then the part's own, then its Module's (ADR 0036).
   */
  surfaceOf: (authored: SurfaceId | undefined) => SurfaceId;
  /** The deck its overlays sit on — measured once, however many overlays share it. */
  deck: () => DeckFrame;
}

const placeSegment = (index: number, segment: Segment, modules: Record<string, Module>): PlacedSegment => {
  const module = modules[segment.moduleId];
  if (!module) throw new Error(`Track references unknown Module "${segment.moduleId}"`);
  if (module.asset && module.statics.length > 0) {
    throw new Error(`Module "${module.id}" carries both statics and asset geometry — exactly one may describe its collision`);
  }
  const orientation = segmentOrientation(segment);
  const scale = segmentScale(segment);
  const belt = segment.conveyor ? conveyorWorldVelocity(segment.conveyor, segment.rotation) : undefined;
  const attachedSurface = surfaceAttachmentOf(segment)?.surface;
  let deck: DeckFrame | undefined;
  return {
    index,
    segment,
    module,
    orientation,
    scale,
    body: segmentBody(segment, module),
    belt,
    partExtras: {
      ...(module.hazard === undefined ? {} : { hazard: module.hazard }),
      ...(belt === undefined ? {} : { conveyor: belt }),
    },
    placeBox: (box) => orientBox(scaleBox(box, scale), segment.position, orientation),
    placePoint: (point) => addVec3(rotateVec3ByQuat(scaleVec3(point, scale), orientation), segment.position),
    surfaceOf: (authored) => attachedSurface ?? authored ?? module.surface ?? DEFAULT_SURFACE,
    deck: () => (deck ??= segmentDeckFrame(segment, module, scale, orientation)),
  };
};

/** What the families write into: the output, plus which Segment each still collider came from. */
interface Resolving extends ResolvedTrack {
  /** Index-aligned with `statics` — a gate's floor probe skips its own Segment's. */
  staticOwners: number[];
  /** Index-aligned with `staticTrimeshes`, for the same probe. */
  trimeshOwners: number[];
}

/** One part of what a placed Segment resolves to. */
type Family = (placed: PlacedSegment, out: Resolving) => void;

/**
 * A retired Module still loads, and says what replaced it: pads lost their
 * behaviour to the Segment Conveyor (ADR 0064), while ice/mud keep their
 * Surface and only their authoring moved to the Segment (ADR 0066/0067) — an
 * old Track must grip exactly where it always did.
 */
const warnRetiredModule: Family = ({ index, segment }, out) => {
  const { moduleId } = segment;
  if (!DEPRECATED_MODULE_IDS.has(moduleId)) return;
  const courseFix: Record<string, string> = {
    start: "mark any Segment as the Start instead",
    finish: "place a finish sign instead",
    sandbox: "place a finish sign instead",
    "checkpoint-spinner": "switch a hoop or an arch on as a Checkpoint instead",
    "checkpoint-end-props": "switch a hoop or an arch on as a Checkpoint instead",
  };
  if (courseFix[moduleId]) {
    out.warnings.push(`Segment ${index} references retired block "${moduleId}": ${courseFix[moduleId]} (ADR 0068) — it still works for now`);
  } else if (moduleId === "ice" || moduleId === "mud") {
    out.warnings.push(
      `Segment ${index} references retired Module "${moduleId}": ` +
        `attach ${moduleId} to the Segment instead — this Segment keeps its ${moduleId} for now`,
    );
  } else if (moduleId === "updraft") {
    out.warnings.push(
      `Segment ${index} references retired Module "updraft": ` +
        "place a fan instead — this Segment keeps its deck, but the air is gone",
    );
  } else {
    out.warnings.push(
      `Segment ${index} references retired Module "${moduleId}": ` +
        "its pad no longer fires — attach a Conveyor to the Segment instead",
    );
  }
};

/** Collision — one of three bodies ({@link segmentBody}), each built its own way. */
const resolveCollision: Family = (placed, out) => {
  const { index, segment, module, scale } = placed;
  switch (placed.body) {
    case "moving":
      out.movingSegments.push({
        segmentIndex: index,
        moduleId: segment.moduleId,
        position: segment.position,
        orientation: placed.orientation,
        scale,
        motion: segment.motion!, // a moving body has one, by definition
        boxes: module.statics.map((box) => ({
          box: scaleBox(box, scale),
          surface: placed.surfaceOf(box.surface),
          ...(placed.belt === undefined ? {} : { conveyor: placed.belt }),
        })),
        solids: (module.asset?.solid ?? []).map((part) => ({
          shape: scaleSolidShape(part.shape, scale),
          position: scaleVec3(part.position, scale),
          rotation: part.rotation,
          surface: placed.surfaceOf(part.surface),
          ...placed.partExtras,
        })),
        // A hollow trimesh only when the Asset has no solid parts (a file from before ADR 0065).
        trimeshes: (module.asset?.solid?.length ? [] : (module.asset?.meshes ?? [])).map((mesh) => ({
          vertices: scale === 1 ? mesh.positions : mesh.positions.map((p) => scaleVec3(p, scale)),
          indices: mesh.indices,
          surface: placed.surfaceOf(mesh.surface),
          ...placed.partExtras,
        })),
      });
      return;

    case "prop": {
      // An Asset Prop (ADR 0095) collides as its authored solid parts, exactly
      // as a Moving Segment does — a hollow trimesh on a body that moves traps
      // whatever ends up inside it. Weight follows size: the footprint's own
      // volume, so a cone skitters and a two-metre ball has to be leaned on.
      const { halfExtents } = scaleBox(module.footprint.bounds, scale);
      const volume = 8 * halfExtents.x * halfExtents.y * halfExtents.z;
      out.props.push({
        mass: Math.min(PROP_ASSET_MASS_MAX, Math.max(PROP_ASSET_MASS_MIN, volume * PROP_ASSET_DENSITY)),
        shape: {
          kind: "asset",
          moduleId: segment.moduleId,
          scale,
          parts: module.asset!.solid!.map((part) => ({
            shape: scaleSolidShape(part.shape, scale),
            position: scaleVec3(part.position, scale),
            rotation: part.rotation,
          })),
        },
        center: segment.position,
        rotation: placed.orientation,
      });
      return;
    }

    case "still":
      for (const box of module.statics) {
        out.statics.push(placed.placeBox(box));
        out.staticOwners.push(index);
        out.staticSurfaces.push(placed.surfaceOf(box.surface));
        out.staticConveyors.push(placed.belt);
      }
      if (segment.prop === true && module.asset !== undefined) {
        out.warnings.push(`Segment ${index} ("${segment.moduleId}") is a Prop but its Asset has no solid parts — it stays where it is`);
      }
      for (const mesh of module.asset?.meshes ?? []) {
        out.trimeshOwners.push(index);
        out.staticTrimeshes.push({
          vertices: mesh.positions.map((p) => placed.placePoint(p)),
          indices: [...mesh.indices],
          surface: placed.surfaceOf(mesh.surface),
          ...placed.partExtras,
        });
      }
  }
};

/**
 * What the renderers draw on a deck (ADR 0064/0066/0067/0070) — physics reads
 * belts and Surfaces off the colliders, never these. A Prop has no deck: it
 * is a body, and publish refuses a belt or a sheet on one (ADR 0099).
 */
const resolveDecks: Family = (placed, out) => {
  if (placed.body === "prop") return;
  const { index: segmentIndex, segment, module } = placed;
  if (placed.belt !== undefined) out.conveyors.push({ segmentIndex, velocity: placed.belt, deck: placed.deck() });
  if (segment.ice === true || moduleHasIceSurface(module)) out.iceDecks.push({ segmentIndex, deck: placed.deck() });
  if (segment.mud === true || moduleHasMudSurface(module)) out.mudDecks.push({ segmentIndex, deck: placed.deck() });
  if (segment.bounce === true || moduleHasBounceSurface(module)) out.bounceDecks.push({ segmentIndex, deck: placed.deck() });
};

/**
 * The Props and Spinners a procedural Module authors itself (M1). Both are
 * placed but never tilted: a Prop has no spawn orientation yet, and a Spinner
 * always turns about world Y — only its position and the yaw it starts at
 * follow the Segment (known limitations, ADR 0034).
 */
const resolveModuleBodies: Family = (placed, out) => {
  const { module, scale, segment } = placed;
  for (const prop of module.props ?? []) {
    const shape: PropConfig["shape"] =
      prop.shape.kind === "box"
        ? { kind: "box", halfExtents: scaleVec3(prop.shape.halfExtents, scale) }
        : prop.shape.kind === "ball"
          ? { kind: "ball", radius: prop.shape.radius * scale }
          : // A procedural Module never authors an Asset Prop — that is a
            // Segment Attachment (ADR 0095), resolved with the collision.
            prop.shape;
    out.props.push({ ...prop, shape, center: placed.placePoint(prop.center) });
  }
  for (const spinner of module.spinners ?? []) {
    out.spinners.push({
      ...spinner,
      center: placed.placePoint(spinner.center),
      armLength: spinner.armLength * scale,
      halfHeight: spinner.halfHeight * scale,
      armRadius: spinner.armRadius * scale,
      initialAngle: (spinner.initialAngle ?? 0) + segment.rotation,
    });
  }
};

/**
 * The course a Segment carries: a retired block's Checkpoint, Finish Zones,
 * and a finish sign's gate (ADR 0039/0068). Gate Checkpoints resolve after
 * every Segment, once there is floor to probe for ({@link
 * resolveGateCheckpoints}); here they only warn when they cannot be one.
 */
const resolveCourse: Family = (placed, out) => {
  const { index, segment, module } = placed;
  if (module.checkpoint) {
    out.checkpoints.push({ respawn: placed.placePoint(module.checkpoint.respawn), trigger: placed.placeBox(module.checkpoint.trigger) });
  }
  // Detection only (ADR 0039): no respawn point to place alongside it.
  if (module.finishZone) out.finishZones.push({ trigger: placed.placeBox(module.finishZone.trigger) });
  // A finish sign always Qualifies. Its opening stays still — publish refuses
  // Motion on one, and one that arrives with it anyway gets no gate.
  if (module.gate?.role === "finish" && placed.body !== "moving") {
    out.finishZones.push({ gate: placeGate(module.gate.opening, segment.position, placed.orientation, placed.scale) });
  }
  if (segment.checkpoint === undefined) return;
  if (module.gate?.role !== "checkpoint") {
    out.warnings.push(`Segment ${index} is marked Checkpoint ${segment.checkpoint.order}, but "${segment.moduleId}" is not a hoop or an arch — ignored`);
  } else if (placed.body === "moving") {
    out.warnings.push(`Segment ${index} (Checkpoint ${segment.checkpoint.order}) moves — a Checkpoint gate must stay still, ignored`);
  }
};

/**
 * Launch pads: a Module's own (M3.7) and a Spring's (ADR 0069). A throw is a
 * direction — rotated by the Segment, never translated. A Spring's trigger
 * scales with it (a bigger Spring is a bigger target); its throw does not
 * (the height is the number the author typed), and tilting the Segment aims it.
 */
const resolveLaunches: Family = (placed, out) => {
  const { index, segment, module } = placed;
  for (const pad of module.launchPads ?? []) {
    out.launchPads.push({ trigger: placed.placeBox(pad.trigger), velocity: rotateVec3ByQuat(pad.velocity, placed.orientation) });
    out.launchPadOwners.push(index);
  }
  if (!module.launch) return;
  const height = launchHeightOf(segment.launch, module.launch);
  out.launchPads.push({
    trigger: placed.placeBox(module.launch.trigger),
    velocity: rotateVec3ByQuat(launchVelocityFor(height), placed.orientation),
  });
  out.launchPadOwners.push(index);
  if (placed.body === "moving") {
    out.warnings.push(
      `segment ${index} (${segment.moduleId}): a Spring on a Moving Segment launches from where it rests — its trigger stays at the rest pose`,
    );
  }
};

/** Volumes (M3.7): a force is a direction, like a launch pad's throw — rotated, never translated. */
const resolveVolumes: Family = (placed, out) => {
  for (const volume of placed.module.volumes ?? []) {
    out.volumes.push({ ...volume, bounds: placed.placeBox(volume.bounds), force: rotateVec3ByQuat(volume.force, placed.orientation) });
  }
};

/**
 * Every family, in the order a Segment's entries land in the arrays they
 * share — `warnings`, `props` (an Asset Prop before its Module's own),
 * `finishZones`, `launchPads` — so the order is the contract, not an accident.
 * A new thing a Segment resolves to is a new family here.
 */
const SEGMENT_FAMILIES: readonly Family[] = [
  warnRetiredModule,
  resolveCollision,
  resolveDecks,
  resolveModuleBodies,
  resolveCourse,
  resolveLaunches,
  resolveVolumes,
];

/**
 * Gate Checkpoints, after any retired block's and by number (ADR 0068). Last,
 * because a respawn's floor can only be found once every still collider is
 * placed — each probe skipping its own gate's.
 */
const resolveGateCheckpoints = (track: Track, modules: Record<string, Module>, out: Resolving): void => {
  for (const entry of gateCheckpointPlans(track, modules)) {
    const ownBoxes = out.statics.filter((_, i) => out.staticOwners[i] !== entry.segmentIndex);
    const ownMeshes = out.staticTrimeshes.filter((_, i) => out.trimeshOwners[i] !== entry.segmentIndex);
    let floor = entry.respawn;
    for (const probe of entry.probes) floor ??= floorBelow(probe, ownBoxes, ownMeshes);
    if (!floor) {
      out.warnings.push(`Segment ${entry.segmentIndex} (Checkpoint ${entry.order}) has no floor in front of or behind it — pick a respawn spot; not a Checkpoint until then`);
      continue;
    }
    out.checkpoints.push({ respawn: { x: floor.x, y: floor.y + RESPAWN_ABOVE_FLOOR, z: floor.z }, gate: entry.gate });
  }
};

/**
 * Flattens a Track into the world-space geometry `RapierSimulation` and the
 * renderers consume. Each Segment is placed once, then every family in
 * {@link SEGMENT_FAMILIES} reads it; gate Checkpoints come last.
 */
export const resolveTrack = (modules: Record<string, Module>, track: Track): ResolvedTrack => {
  const out: Resolving = {
    statics: [],
    staticSurfaces: [],
    staticConveyors: [],
    staticTrimeshes: [],
    props: [],
    spinners: [],
    checkpoints: [],
    finishZones: [],
    launchPads: [],
    launchPadOwners: [],
    volumes: [],
    movingSegments: [],
    conveyors: [],
    iceDecks: [],
    mudDecks: [],
    bounceDecks: [],
    warnings: [],
    staticOwners: [],
    trimeshOwners: [],
  };
  for (const [index, segment] of track.entries()) {
    const placed = placeSegment(index, segment, modules);
    for (const family of SEGMENT_FAMILIES) family(placed, out);
  }
  resolveGateCheckpoints(track, modules, out);
  const { staticOwners: _staticOwners, trimeshOwners: _trimeshOwners, ...resolved } = out;
  return resolved;
};
