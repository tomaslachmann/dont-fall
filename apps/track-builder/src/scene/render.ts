import {
  smoothDeckPlan,
  chevronPose,
  CONVEYOR_SPEEDS,
  conveyorWorldVelocity,
  moduleHasBounceSurface,
  moduleHasIceSurface,
  BOUNCE_OVERLAY_LIFT,
  BOUNCE_SHEET_SEGMENTS,
  BOUNCE_TILE_WORLD,
  bounceDomeLift,
  addVec3,
  hasMotion,
  moduleHasMudSurface,
  motionPose,
  rotateVec3ByQuat,
  scaleVec3,
  segmentOrientation,
  segmentScale,
  stripLayout,
  TICK_DT,
  type Box,
  type DeckFrame,
  type DeckPlan,
  type Module,
  type Segment,
} from "@dont-fall/shared";
import * as THREE from "three";
import {
  ICE_SEAT_LIFT,
  MUD_SEAT_LIFT,
  buildIceSlab,
  buildMudMass,
  deckRectGeometry,
  deckSheetGeometry,
  motionCarry,
  templateForPlacement,
  tileDeckTexture,
  type MudDeckPlacement,
} from "@dont-fall/render";

const CONVEYOR_CHEVRON_COLOR = 0xffffff;

/** Frozen chevrons for `prefers-reduced-motion` — orientation still points along the flow, the march is reinforcement only. */
const REDUCED_MOTION =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A Segment Conveyor's chevron strip (ADR 0064) — the same strip the game
 * scene draws (`conveyorBelts.ts`), built here in the Segment's own local
 * frame so it rides placement, scale and Motion with the rest of the
 * group's content. Parent under the Motion node, never the outer group:
 * the strip must follow the carrier when one moves. The grid itself is
 * shared layout math (`stripLayout`/`chevronPose`) — the belt an author
 * places is the belt a player runs on, by construction.
 *
 * Returns the march driver (simulation tick, fractional — the viewport feeds
 * its motion-preview clock), or `undefined` when the Segment runs no belt.
 */
/**
 * The deck top in local space: the asset template's own visual top, else
 * (before its bytes land) the footprint's top. Chevron strips and ice
 * sheets share it, so the two can never disagree about where the deck is.
 */
const deckTopLocal = (module: Module, template: THREE.Object3D | undefined): number => {
  const tops = template ? templateParts(template).map((part) => part.center.y + part.halfExtents.y) : [];
  return tops.length > 0 ? Math.max(...tops) : module.footprint.bounds.center.y + module.footprint.bounds.halfExtents.y;
};

export const addConveyorBelt = (
  motionNode: THREE.Group,
  segment: Segment,
  module: Module,
  template: THREE.Object3D | undefined,
): ((tick: number) => void) | undefined => {
  const conveyor = segment.conveyor;
  if (!conveyor) return undefined;
  // Local flow: the same helper `resolveTrack` uses, at zero Segment yaw.
  const flow = conveyorWorldVelocity(conveyor, 0);
  const speed = CONVEYOR_SPEEDS[conveyor.preset];
  const { center, halfExtents } = module.footprint.bounds;
  const deckTop = deckTopLocal(module, template);

  // The footprint rect projected onto the local flow and its perpendicular
  // (deckYaw is 0 in local space, so the projection is just |fx|/|fz|).
  const fx = flow.x / speed;
  const fz = flow.z / speed;
  const layout = stripLayout(
    halfExtents.x * Math.abs(fx) + halfExtents.z * Math.abs(fz),
    halfExtents.x * Math.abs(fz) + halfExtents.z * Math.abs(fx),
  );

  const strip = new THREE.Group();
  strip.position.set(center.x, deckTop + 0.015, center.z);
  strip.rotation.y = Math.atan2(-flow.x, -flow.z); // -Z (the chevrons' forward) onto the flow
  motionNode.add(strip);

  // Fresh geometry/material per strip (not shared): `disposeGroup` frees a
  // discarded group mesh-by-mesh, and this file's own rule is fresh
  // allocations everywhere for exactly that reason. The glyph is the game
  // scene's own KayKit `platform_arrow` chevron (see `conveyorBelts.ts` for
  // the measured proportions) — no dark plate under it, so the asset's own
  // coloured top stays visible and the arrows read as printed on it.
  const chevronShape = new THREE.Shape();
  chevronShape.moveTo(0, 0.41); // tip
  chevronShape.lineTo(0.6, 0.16); // wing front, right
  chevronShape.lineTo(0.6, -0.41); // wing back, right
  chevronShape.lineTo(0, -0.16); // notch
  chevronShape.lineTo(-0.6, -0.41); // wing back, left
  chevronShape.lineTo(-0.6, 0.16); // wing front, left
  chevronShape.closePath();
  const chevronGeo = new THREE.ShapeGeometry(chevronShape);
  chevronGeo.rotateX(-Math.PI / 2);
  const chevronMat = new THREE.MeshStandardMaterial({
    color: CONVEYOR_CHEVRON_COLOR,
    roughness: 0.85,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide,
  });

  const chevrons: THREE.Mesh[] = [];
  for (let row = 0; row < layout.rows; row += 1) {
    for (let i = 0; i < layout.perRow; i += 1) {
      const chevron = new THREE.Mesh(chevronGeo, chevronMat);
      chevron.scale.setScalar(layout.unit);
      const p0 = chevronPose(layout, i, 0);
      chevron.position.set(layout.laterals[row]!, p0.y, p0.z);
      chevron.rotation.x = p0.pitch;
      chevron.userData.marchIndex = i;
      strip.add(chevron);
      chevrons.push(chevron);
    }
  }

  return (tick: number) => {
    const phase = REDUCED_MOTION ? 0 : tick * TICK_DT * speed;
    for (const chevron of chevrons) {
      const pose = chevronPose(layout, chevron.userData.marchIndex as number, phase);
      chevron.position.z = pose.z;
      chevron.position.y = pose.y;
      chevron.rotation.x = pose.pitch;
    }
  };
};

/**
 * Where an icy Segment's deck is in the world (ADR 0066/0105), and how it
 * moves — the ice twin of {@link mudPlacementOf}, so ice runs on across a
 * seam into a neighbouring icy deck exactly as mud does. `undefined` when
 * the Segment runs no ice.
 */
export const icePlacementOf = (
  segment: Segment,
  module: Module,
  template: THREE.Object3D | undefined,
  plan: DeckPlan | undefined,
): MudDeckPlacement | undefined => {
  if (segment.ice !== true && !moduleHasIceSurface(module)) return undefined;
  return deckPlacementOf(segment, module, template, plan);
};

/**
 * An icy Segment's slab (ADR 0066, drawn per ADR 0107) — the same opaque
 * pastel slab the game scene lays (`iceOverlays.ts`), from the same
 * `@dont-fall/render` builder, set into the Segment's own local frame so it
 * rides placement, scale and Motion with the rest of the group's content.
 * Parent under the Motion node, never the outer group. The slab is built in
 * metres, so it undoes the group's scale, like the mud.
 */
export const addIceOverlay = (
  motionNode: THREE.Group,
  segment: Segment,
  module: Module,
  template: THREE.Object3D | undefined,
  self: MudDeckPlacement | undefined,
  all: readonly MudDeckPlacement[],
): THREE.Group | undefined => {
  if (!self) return undefined;
  const scale = segmentScale(segment);
  const { center } = module.footprint.bounds;
  const { object } = buildIceSlab(self, all);
  object.position.set(center.x, deckTopLocal(module, template) + ICE_SEAT_LIFT / scale, center.z);
  object.scale.setScalar(1 / scale);
  motionNode.add(object);
  return object;
};

/**
 * A bouncy Segment's sheet (ADR 0070) — the same inflatable skin the game
 * scene lays (`bounceSheets.ts`), from the same shared {@link bounceDomeLift}.
 * The builder has no Characters to dent it, so this is the rest shape: taut,
 * convex, pinned at the rim. Built in the Segment's own local frame like the
 * ice sheet, and parented under the Motion node so it rides a carrier.
 */
export const addBounceOverlay = (
  motionNode: THREE.Group,
  segment: Segment,
  module: Module,
  template: THREE.Object3D | undefined,
  texture: THREE.Texture | undefined,
  maxAnisotropy = 1,
  plan: DeckPlan | undefined,
): THREE.Mesh | undefined => {
  if (segment.bounce !== true && !moduleHasBounceSurface(module)) return undefined;
  const { center, halfExtents } = module.footprint.bounds;
  const width = halfExtents.x * 2;
  const depth = halfExtents.z * 2;

  // Cut to the deck's own shape when it has one (ADR 0096) — the engine's
  // cached plan, subdivided like the game's since the dome lives in the
  // vertices. A missing plan keeps the footprint rectangle.
  const geometry = plan
    ? deckSheetGeometry(smoothDeckPlan(plan), halfExtents.x, halfExtents.z)
    : deckRectGeometry(width, depth, BOUNCE_SHEET_SEGMENTS);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const u = halfExtents.x === 0 ? 0 : position.getX(i) / halfExtents.x;
    const v = halfExtents.z === 0 ? 0 : position.getZ(i) / halfExtents.z;
    position.setY(i, bounceDomeLift(u, v));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();

  // Fresh geometry/material per sheet, like the ice sheet above — `disposeGroup`
  // frees a discarded group mesh by mesh.
  const map = texture ? tileDeckTexture(texture, { tileWorld: BOUNCE_TILE_WORLD, width, depth, maxAnisotropy }) : undefined;
  const material = new THREE.MeshStandardMaterial({
    ...(map ? { map } : { color: 0x36c9f0 }),
    roughness: 0.18,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(center.x, deckTopLocal(module, template) + BOUNCE_OVERLAY_LIFT, center.z);
  motionNode.add(mesh);
  return mesh;
};

/**
 * Where a muddy Segment's deck is in the world (ADR 0067/0103), and how it
 * moves — what a mud mass needs to know about itself and every other mud deck
 * on the Track, so mud runs on across a seam into a neighbour exactly as it
 * does in the game. `undefined` when the Segment runs no mud. Built at the
 * rest pose from the same deck top the other overlays read.
 */
export const mudPlacementOf = (
  segment: Segment,
  module: Module,
  template: THREE.Object3D | undefined,
  plan: DeckPlan | undefined,
): MudDeckPlacement | undefined => {
  if (segment.mud !== true && !moduleHasMudSurface(module)) return undefined;
  return deckPlacementOf(segment, module, template, plan);
};

/** The deck-and-carry half {@link mudPlacementOf} and {@link icePlacementOf} share — only the gate differs. */
const deckPlacementOf = (
  segment: Segment,
  module: Module,
  template: THREE.Object3D | undefined,
  plan: DeckPlan | undefined,
): MudDeckPlacement => {
  const scale = segmentScale(segment);
  const orientation = segmentOrientation(segment);
  const { center, halfExtents } = module.footprint.bounds;
  const top = deckTopLocal(module, template);
  const deck: DeckFrame = {
    center: addVec3(segment.position, rotateVec3ByQuat(scaleVec3({ x: center.x, y: top, z: center.z }, scale), orientation)),
    yaw: segment.rotation,
    orientation,
    halfX: halfExtents.x * scale,
    halfZ: halfExtents.z * scale,
    ...(plan ? { plan: { vertices: plan.vertices.map((v) => ({ x: v.x * scale, z: v.z * scale })), indices: plan.indices } } : {}),
  };
  return hasMotion(segment.motion) ? { deck, carry: motionCarry(segment.position, orientation, scale, segment.motion!) } : { deck };
};

/**
 * A muddy Segment's mass (ADR 0067/0103) — the same mud the game scene lays
 * (`mudOverlays.ts`), from the same `@dont-fall/render` builder, set into the
 * Segment's own local frame so it rides placement and Motion with the rest
 * of the group's content. Parent under the Motion node, never the outer
 * group. The mass is built in metres, so it undoes the group's scale: mud is
 * as deep on a scaled-up piece as on any other.
 */
export const addMudOverlay = (
  motionNode: THREE.Group,
  segment: Segment,
  module: Module,
  template: THREE.Object3D | undefined,
  self: MudDeckPlacement | undefined,
  all: readonly MudDeckPlacement[],
): THREE.Group | undefined => {
  if (!self) return undefined;
  const scale = segmentScale(segment);
  const { center } = module.footprint.bounds;
  const { object } = buildMudMass(self, all);
  object.position.set(center.x, deckTopLocal(module, template) + MUD_SEAT_LIFT / scale, center.z);
  object.scale.setScalar(1 / scale);
  motionNode.add(object);
  return object;
};

/** `userData` key marking a group whose geometry/materials a cached asset template owns — see `buildSegmentGroup`. */
export const SHARES_TEMPLATE_RESOURCES = "sharesTemplateResources";

/**
 * Builds one placed Segment's viewport Group (M8 ticket 05): a clone of its
 * Asset's loaded visual template — empty until the bytes land, since
 * nothing procedural is drawn any more (ADR 0078) — then the Segment's own
 * placement transform, through the one shared helper, never separate
 * positioning code. Returns `undefined` for an unknown Module (the
 * viewport skips it, as before).
 *
 * Clones share the template's geometry/materials, so an asset Segment's
 * group is tagged `SHARES_TEMPLATE_RESOURCES` and `disposeGroup` leaves it
 * alone: the template is cached for the session, and freeing its buffers on
 * every rebuild re-uploaded every placed asset (and recompiled its shaders,
 * in both the viewport's and the previews' contexts) on each edit — cheap
 * with four tiny files, a visible hitch per click with heavy trap meshes.
 */
export const buildSegmentGroup = (
  modules: Record<string, Module>,
  segment: Segment,
  assetTemplates: Record<string, THREE.Group> = {},
): THREE.Group | undefined => {
  const module = modules[segment.moduleId];
  if (!module) return undefined;
  const template = assetTemplates[segment.moduleId];
  // A painted Segment clones what its paint wears — its authored file, or the
  // flat tint built once per (file, paint) — never the placed file itself.
  const content = template ? templateForPlacement(assetTemplates, segment.moduleId, segment.color).clone(true) : new THREE.Group();
  if (template) content.userData[SHARES_TEMPLATE_RESOURCES] = true;
  // Placement on the outer group, Motion on the inner node (ADR 0061): a
  // Motion is a pose in the Segment's own local frame, so the gizmo keeps
  // editing the rest placement while the piece moves inside it.
  const motionNode = new THREE.Group();
  motionNode.add(content);
  const group = new THREE.Group();
  group.add(motionNode);
  group.userData[MOTION_NODE] = motionNode;
  applySegmentTransform(group, segment);
  return group;
};

/** A mesh's bounds in `frame`'s own coordinates, as a shared `Box`. */
export const meshBoundsIn = (mesh: THREE.Mesh, frame: THREE.Object3D): Box => {
  frame.updateWorldMatrix(true, true);
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const toFrame = frame.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const box = mesh.geometry.boundingBox!.clone().applyMatrix4(toFrame);
  const c = box.getCenter(new THREE.Vector3());
  const h = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  return { center: { x: c.x, y: c.y, z: c.z }, halfExtents: { x: h.x, y: h.y, z: h.z } };
};

/**
 * The separate parts of an asset's visual template (M11 ticket 06 follow-up):
 * one box per mesh, in the template's own frame — which, every Asset being
 * seated on its pivot, is the Module's frame. What lets the Motion panel tell
 * a sweeper's post from its arm.
 */
export const templateParts = (template: THREE.Object3D): Box[] => {
  const meshes: THREE.Mesh[] = [];
  template.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && !object.userData.impactTint) meshes.push(object as THREE.Mesh);
  });
  return meshes.map((mesh) => meshBoundsIn(mesh, template));
};

/** `userData` key of a Segment group's inner node, the one its Motion poses — see `buildSegmentGroup`. */
export const MOTION_NODE = "motionNode";

/** Pose a Segment group's Motion at simulation tick `tick` (fractional), or back at rest when it has none. */
export const applyMotionAt = (group: THREE.Object3D, segment: Segment, tick: number): void => {
  const node = group.userData[MOTION_NODE] as THREE.Object3D | undefined;
  if (!node) return;
  if (!segment.motion) {
    node.position.set(0, 0, 0);
    node.quaternion.identity();
    return;
  }
  const pose = motionPose(segment.motion, tick);
  node.position.set(pose.position.x, pose.position.y, pose.position.z);
  node.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
};

/**
 * Applies a Segment's full placement (position + 3D orientation, ADR 0034)
 * to its Module group — the one place `viewport.ts` (the Track overview) and
 * `playtest.ts` (the local playtest scene) both do this, instead of each
 * duplicating `group.quaternion.set(...)` from `segmentOrientation` inline
 * (code review, ticket 01: the two copies would otherwise need to be kept in
 * sync by hand).
 */
export const applySegmentTransform = (group: THREE.Object3D, segment: Segment): void => {
  group.position.set(segment.position.x, segment.position.y, segment.position.z);
  const q = segmentOrientation(segment);
  group.quaternion.set(q.x, q.y, q.z, q.w);
  group.scale.setScalar(segmentScale(segment));
};

/**
 * Frees every Mesh/Line's geometry/material under `group` (code review,
 * ticket 08) — the overlays (belt chevrons, ice/mud/bounce sheets) allocate
 * fresh geometry and materials per Segment, so a discarded Group leaks GPU
 * buffers if `setTrack` (the whole-Track overview, called on every edit, not
 * just append) doesn't dispose the previous one before replacing it.
 * `THREE.Line` alongside `THREE.Mesh` (M3.7 ticket 02, code review): an
 * `ArrowHelper` is a Group containing both a Line (its shaft) and a Mesh
 * (its head) — checking only `Mesh` silently leaks the shaft's own
 * geometry/material.
 *
 * A subtree tagged `SHARES_TEMPLATE_RESOURCES` is skipped whole: its
 * geometry/materials belong to a cached asset template, not to it.
 */
export const disposeGroup = (group: THREE.Object3D): void => {
  if (group.userData[SHARES_TEMPLATE_RESOURCES] === true) return;
  if (group instanceof THREE.Mesh || group instanceof THREE.Line) {
    group.geometry.dispose();
    const materials = Array.isArray(group.material) ? group.material : [group.material];
    for (const material of materials) material.dispose();
  }
  for (const child of group.children) disposeGroup(child);
};

/** Half the diagonal of `group`'s bounding box — used to frame a preview camera. */
export const boundingRadius = (group: THREE.Group): number => {
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const radius = size.length() / 2;
  return Number.isFinite(radius) && radius > 0 ? radius : 4;
};
