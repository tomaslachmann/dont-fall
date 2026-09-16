import {
  chevronPose,
  CONVEYOR_SPEEDS,
  conveyorWorldVelocity,
  ICE_OVERLAY_LIFT,
  ICE_OVERLAY_OPACITY,
  ICE_TILE_WORLD,
  moduleHasBounceSurface,
  moduleHasIceSurface,
  BOUNCE_OVERLAY_LIFT,
  BOUNCE_SHEET_SEGMENTS,
  BOUNCE_TILE_WORLD,
  bounceDomeLift,
  moduleHasMudSurface,
  motionPose,
  MUD_OVERLAY_LIFT,
  MUD_SIDE_COLOR,
  MUD_SLOSH_PHASE_STEP,
  MUD_TILE_WORLD,
  mudSloshOffset,
  segmentOrientation,
  segmentScale,
  stripLayout,
  TICK_DT,
  type Box,
  type Module,
  type Segment,
} from "@dont-fall/shared";
import * as THREE from "three";

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
 * An icy Segment's sheet (ADR 0066) — the same translucent texture the game
 * scene lays (`iceOverlays.ts`), built here in the Segment's own local
 * frame so it rides placement, scale and Motion with the rest of the
 * group's content. Parent under the Motion node, never the outer group.
 * Sheets attached ice as well as module-authored ice (the retired Module
 * keeps rendering); returns `undefined` when neither applies or the
 * texture hasn't loaded yet (the engine re-syncs when it lands).
 */
export const addIceOverlay = (
  motionNode: THREE.Group,
  segment: Segment,
  module: Module,
  template: THREE.Object3D | undefined,
  texture: THREE.Texture | undefined,
  maxAnisotropy = 1,
): THREE.Mesh | undefined => {
  if (!texture || (segment.ice !== true && !moduleHasIceSurface(module))) return undefined;
  const { center, halfExtents } = module.footprint.bounds;

  // Fresh geometry/material per sheet (not shared): `disposeGroup` frees a
  // discarded group mesh-by-mesh, and this file's own rule is fresh
  // allocations everywhere for exactly that reason. The clone shares the
  // image but repeats for this deck's own size.
  const sheet = texture.clone();
  sheet.needsUpdate = true;
  sheet.wrapS = THREE.RepeatWrapping;
  sheet.wrapT = THREE.RepeatWrapping;
  sheet.repeat.set((halfExtents.x * 2) / ICE_TILE_WORLD, (halfExtents.z * 2) / ICE_TILE_WORLD);
  sheet.anisotropy = maxAnisotropy;
  const material = new THREE.MeshStandardMaterial({
    map: sheet,
    transparent: true,
    opacity: ICE_OVERLAY_OPACITY,
    roughness: 0.4,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const geometry = new THREE.PlaneGeometry(halfExtents.x * 2, halfExtents.z * 2);
  geometry.rotateX(-Math.PI / 2); // the plane's height becomes depth: a flat XZ sheet
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(center.x, deckTopLocal(module, template) + ICE_OVERLAY_LIFT, center.z);
  motionNode.add(mesh);
  return mesh;
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
): THREE.Mesh | undefined => {
  if (segment.bounce !== true && !moduleHasBounceSurface(module)) return undefined;
  const { center, halfExtents } = module.footprint.bounds;
  const width = halfExtents.x * 2;
  const depth = halfExtents.z * 2;

  const geometry = new THREE.PlaneGeometry(width, depth, BOUNCE_SHEET_SEGMENTS, BOUNCE_SHEET_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
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
  const map = texture?.clone();
  if (map) {
    map.needsUpdate = true;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(width / BOUNCE_TILE_WORLD, depth / BOUNCE_TILE_WORLD);
    map.anisotropy = maxAnisotropy;
  }
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
 * A muddy Segment's block (ADR 0067) — the same filled opaque mud the game
 * scene lays (`mudOverlays.ts`), built here in the Segment's own local
 * frame so it rides placement, scale and Motion with the rest of the
 * group's content. Parent under the Motion node, never the outer group.
 * Blocks attached mud as well as module-authored mud (the retired Module
 * keeps rendering); returns `undefined` when neither applies or the
 * texture hasn't loaded yet (the engine re-syncs when it lands).
 *
 * The `update` driver breathes the surface off the motion-preview clock
 * (same slosh the game runs, same `segmentIndex` phase stagger) — the
 * preview shows no Characters, so no rings spawn here; only the game
 * answers feet.
 */
export const addMudOverlay = (
  motionNode: THREE.Group,
  segment: Segment,
  segmentIndex: number,
  module: Module,
  template: THREE.Object3D | undefined,
  texture: THREE.Texture | undefined,
  maxAnisotropy = 1,
): { mesh: THREE.Mesh; update: (tick: number) => void } | undefined => {
  if (!texture || (segment.mud !== true && !moduleHasMudSurface(module))) return undefined;
  const { center, halfExtents } = module.footprint.bounds;

  // Fresh geometry/material per block (not shared): `disposeGroup` frees a
  // discarded group mesh-by-mesh, and this file's own rule is fresh
  // allocations everywhere for exactly that reason. The clone shares the
  // image but repeats — and breathes — for this deck's own size.
  const sheet = texture.clone();
  sheet.needsUpdate = true;
  sheet.wrapS = THREE.RepeatWrapping;
  sheet.wrapT = THREE.RepeatWrapping;
  sheet.repeat.set((halfExtents.x * 2) / MUD_TILE_WORLD, (halfExtents.z * 2) / MUD_TILE_WORLD);
  sheet.anisotropy = maxAnisotropy;
  const topMaterial = new THREE.MeshStandardMaterial({
    map: sheet,
    // Opaque and matte: mud is a mass you stand in, not a film you look
    // through — translucent mud would show the feet through instead of
    // sinking them.
    transparent: false,
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  // One instance behind all five untextured slots — the sides are the
  // filled gap down to the deck, the bottom never faces a camera.
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: MUD_SIDE_COLOR,
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const geometry = new THREE.BoxGeometry(halfExtents.x * 2, MUD_OVERLAY_LIFT, halfExtents.z * 2);
  // Box faces [+x, -x, +y, -y, +z, -z]: the texture rides the +y top.
  const mesh = new THREE.Mesh(geometry, [
    sideMaterial,
    sideMaterial,
    topMaterial,
    sideMaterial,
    sideMaterial,
    sideMaterial,
  ]);
  // Centred vertically: the surface sits half the lift above the origin.
  mesh.position.set(center.x, deckTopLocal(module, template) + MUD_OVERLAY_LIFT / 2, center.z);
  motionNode.add(mesh);

  const phase = segmentIndex * MUD_SLOSH_PHASE_STEP;
  const update = (tick: number): void => {
    const slosh = REDUCED_MOTION ? { u: 0, v: 0 } : mudSloshOffset(tick * TICK_DT, phase);
    sheet.offset.set(slosh.u, slosh.v);
  };
  return { mesh, update };
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
  const content = template ? template.clone(true) : new THREE.Group();
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
