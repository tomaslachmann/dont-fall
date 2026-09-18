import {
  IDENTITY_QUAT,
  movingSegmentPose,
  spinnerAngleAt,
  TICK_DT,
  yawQuat,
  type EnvironmentPreset,
  type OrientedBox,
  type PropSnapshot,
  type RenderCharacter,
  type Vec3,
} from "@dont-fall/shared";
import { findSpinningParts, localBounds, lowestDrawnY, lowestMovingY, spinParts } from "@dont-fall/render";
import * as THREE from "three";
import { buildAirColumns } from "../airColumns.js";
import { buildAssetVisuals } from "../assetVisuals.js";
import { BouncePresses, buildBounceSheets, type BounceLanding } from "../bounceSheets.js";
import { buildConveyorStrips } from "../conveyorBelts.js";
import { createIceFooting, type IceFootingQuery } from "../iceFooting.js";
import { buildIceOverlays } from "../iceOverlays.js";
import { KNOCKDOWN_FLOOR_PROBE, KNOCKDOWN_FLOOR_REACH, type FloorQuery } from "../knockdownAnimation.js";
import { buildMudOverlays } from "../mudOverlays.js";
import { setShadowRole } from "../shadowRoles.js";
import { SpringSquashes, type SpringTrigger } from "../springSquash.js";
import type { StageConfig } from "../scene.js";

/** What the Track is drawn from — `StageConfig`'s Track half, defaults applied. */
export type TrackVisualsConfig = Required<
  Pick<
    StageConfig,
    | "statics"
    | "checkpoints"
    | "finishZones"
    | "spinners"
    | "props"
    | "assetTemplates"
    | "assetPlacements"
    | "springs"
    | "movingSegments"
    | "conveyors"
    | "iceDecks"
    | "mudDecks"
    | "bounceDecks"
    | "bounceTexture"
    | "volumes"
  >
> & {
  environment: EnvironmentPreset;
  /** The renderer's own anisotropy cap, for the deck sheets. */
  maxAnisotropy: number;
};

/** Everything the Track draws, and what the rest of the Stage asks of it. */
export interface TrackVisuals {
  /**
   * What the spring-arm camera and the knockdown floor probe hit: every still
   * piece, Moving Segment and Prop — never a sheet, strip, marker or the sky.
   */
  collidables: THREE.Object3D[];
  /** One group per Moving Segment, in `movingSegments` order, each posed by {@link poseMotion}. */
  movingGroups: readonly THREE.Group[];
  /** Where a deck's sheet or footing frame hangs: the scene, or its Moving Segment's group. */
  deckParent: (movingIndex: number | null) => THREE.Object3D;
  /** The lowest point the Track draws, anywhere its Motion can carry it — where the cloud floor stays under. */
  lowestSegmentY: number;
  /** The floor under a knocked-down Character (ADR 0076). */
  floorBelow: FloorQuery;
  /** Where a Character wobbles for standing on ice (ADR 0082). */
  onIce: IceFootingQuery;
  /** Place every Prop from its replicated pose. */
  placeProps: (props: PropSnapshot[]) => void;
  /**
   * Pose every Moving Segment and Spinner at tick `t`, and march the belts and
   * press the mud on the same clock — under every Character in `centres`.
   */
  poseMotion: (t: number, centres: Vec3[]) => void;
  /** Squash whichever Spring just fired (ADR 0069); returns the ones that settled back to rest. */
  squashSprings: (characters: Record<string, RenderCharacter>, nowMs: number) => readonly SpringTrigger[];
  /** Dent every bounce sheet under the Characters on it (ADR 0070); returns this frame's landings. */
  pressBounceSheets: (characters: Record<string, RenderCharacter>, nowMs: number) => readonly BounceLanding[];
  /** Advance every air column (ADR 0075), its swooshes facing `eye`. */
  updateAirColumns: (nowMs: number, eye: THREE.Vector3) => void;
  /** Turn every Asset part that spins on its own, a fan's rotor (ADR 0075). */
  spin: (nowMs: number) => void;
  /** Drop the references it holds; the Stage's scene-graph sweep frees what it drew. */
  dispose: () => void;
}

const boxMesh = (box: OrientedBox, material: THREE.Material): THREE.Mesh => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(box.halfExtents.x * 2, box.halfExtents.y * 2, box.halfExtents.z * 2),
    material,
  );
  mesh.position.set(box.center.x, box.center.y, box.center.z);
  // ADR 0034: a static's OrientedBox may carry a real rotation now — Props/
  // Checkpoint triggers/Spinner arms passed in here are still plain (rotation-
  // less) Boxes, which default to identity, unchanged from before.
  const q = box.rotation ?? IDENTITY_QUAT;
  mesh.quaternion.set(q.x, q.y, q.z, q.w);
  return mesh;
};

/**
 * Builds everything the Track draws into `scene`, in the order the scene
 * graph has always had — still pieces, Assets, Moving Segments, the deck
 * overlays, air columns, markers, Spinners, Props. The Environment comes
 * after, so the cloud floor can stay under all of it.
 */
export const buildTrackVisuals = (
  scene: THREE.Scene,
  {
    statics,
    checkpoints,
    finishZones,
    spinners,
    props,
    assetTemplates,
    assetPlacements,
    springs,
    movingSegments,
    conveyors,
    iceDecks,
    mudDecks,
    bounceDecks,
    bounceTexture,
    volumes,
    environment,
    maxAnisotropy,
  }: TrackVisualsConfig,
): TrackVisuals => {
  const platformMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2740, roughness: 0.95 });
  const collidables: THREE.Object3D[] = [];
  // The floor under a knocked-down Character (ADR 0076): a short ray down
  // against the same meshes the camera arm avoids, started just above the
  // Character so a pelvis sunk into the deck still finds it.
  const floorRay = new THREE.Raycaster();
  const floorOrigin = new THREE.Vector3();
  const floorDown = new THREE.Vector3(0, -1, 0);
  const floorBelow: FloorQuery = (x, y, z) => {
    floorRay.set(floorOrigin.set(x, y + KNOCKDOWN_FLOOR_PROBE, z), floorDown);
    floorRay.far = KNOCKDOWN_FLOOR_PROBE + KNOCKDOWN_FLOOR_REACH;
    const hit = floorRay.intersectObjects(collidables, false)[0];
    return hit ? hit.point.y : null;
  };
  // Everything still the Track draws, for where the cloud floor has to stay under.
  const stillTrack: THREE.Object3D[] = [];
  // Shadows (ADR 0074): every Track piece casts onto the pieces below it and
  // receives; a Character only casts; deck sheets and strips only receive, so
  // a shadow shows on a mud or ice deck rather than under its sheet; markers
  // and the Environment's own meshes do neither.
  for (const box of statics) {
    const mesh = setShadowRole(boxMesh(box, platformMaterial), "both");
    scene.add(mesh);
    collidables.push(mesh);
    stillTrack.push(mesh);
  }

  // Asset visuals (M8 ticket 03): one clone per placed asset Segment, standing
  // at the Segment's own origin/transform — the same placement `resolveTrack`
  // baked the collision trimeshes at. Their meshes join `collidables` so the
  // spring-arm camera treats authored shapes the way it treated the boxes
  // they replace (only leaf meshes are pushed, so the non-recursive raycast
  // needs no change for the nested clones).
  // Which drawn instance belongs to which Segment — `buildAssetVisuals` clones
  // one child per placement, in order, so the two line up by index. Only
  // Springs need looking up, so only Springs are kept.
  const springVisuals = new Map<number, THREE.Object3D>();
  if (assetPlacements.length > 0) {
    const assetVisuals = setShadowRole(buildAssetVisuals(assetTemplates, assetPlacements), "both");
    scene.add(assetVisuals);
    stillTrack.push(assetVisuals);
    assetVisuals.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) collidables.push(object);
    });
    const squashable = new Set(springs.map((spring) => spring.segmentIndex));
    assetPlacements.forEach((placement, i) => {
      const instance = assetVisuals.children[i];
      if (instance && squashable.has(placement.segmentIndex)) springVisuals.set(placement.segmentIndex, instance);
    });
  }
  const springSquashes = new SpringSquashes();
  // Each Spring's own authored size (ADR 0062), captured before any squash
  // multiplies it — so repeated fires can never compound into drift.
  const springBaseScale = new Map<THREE.Object3D, number>();
  const base = (instance: THREE.Object3D): number => {
    const remembered = springBaseScale.get(instance);
    if (remembered !== undefined) return remembered;
    springBaseScale.set(instance, instance.scale.x);
    return instance.scale.x;
  };

  // Moving Segments (ADR 0061): the Segment's whole visual in its local frame
  // under one group — an asset's template clone, or its Module boxes — so
  // posing the group poses everything it draws, exactly as the body does.
  const movingGroups = movingSegments.map((config) => {
    const group = new THREE.Group();
    const template = assetTemplates[config.moduleId];
    if (template) {
      // Collision boxes/trimeshes arrive already scaled (ADR 0062); the visual is scaled here.
      const visual = template.clone(true);
      visual.scale.setScalar(config.scale);
      group.add(visual);
    } else if (config.trimeshes.length > 0) {
      throw new Error(`asset "${config.moduleId}": no loaded visual template (fetch it before placing)`);
    }
    for (const { box } of config.boxes) group.add(boxMesh(box, platformMaterial));
    setShadowRole(group, "both");
    scene.add(group);
    group.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) collidables.push(object);
    });
    return group;
  });
  const poseMovingSegments = (t: number): void => {
    for (let i = 0; i < movingGroups.length; i += 1) {
      const pose = movingSegmentPose(movingSegments[i]!, t);
      const group = movingGroups[i]!;
      group.position.set(pose.position.x, pose.position.y, pose.position.z);
      group.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
      group.updateMatrixWorld(true);
    }
  };
  poseMovingSegments(0);
  const deckParent = (index: number | null): THREE.Object3D => (index === null ? scene : movingGroups[index]!);

  // Conveyor chevron strips (ADR 0064) — still belts parent to the scene, a
  // belt riding a Moving Segment parents under its group (already in that
  // frame) so it follows the carrier. Never `collidables`: flat decals on
  // the deck neither block the camera nor catch its raycast.
  const conveyorStrips = buildConveyorStrips(conveyors, movingSegments);
  for (const strip of conveyorStrips) deckParent(strip.movingIndex).add(setShadowRole(strip.object, "receiver"));

  // Ice slabs (ADR 0066, drawn per ADR 0107) — same parenting as the strips
  // above, never `collidables` for the same reason. Built from geometry and a
  // generated detail texture alone, so like the mud it is always drawn.
  const iceSheets = buildIceOverlays(iceDecks, movingSegments);
  for (const sheet of iceSheets) deckParent(sheet.movingIndex).add(setShadowRole(sheet.object, "receiver"));
  // Where a Character wobbles for standing on ice (ADR 0082): the same decks,
  // parented the same way, and there whether or not the sheets could be drawn.
  const onIce = createIceFooting(iceDecks, movingSegments, deckParent);

  // Mud (ADR 0067/0103) — the same treatment: never `collidables`, riding
  // carriers by re-parenting. Built from geometry alone, so it is always drawn.
  const mudSheets = buildMudOverlays(mudDecks, movingSegments);
  for (const sheet of mudSheets) deckParent(sheet.movingIndex).add(setShadowRole(sheet.object, "receiver"));

  // Bounce sheets (ADR 0070) — skin, never `collidables`: the deck's own flat
  // collider is what a Character stands on, and the sheet only draws what that
  // deck does to them.
  const bounceSheets = buildBounceSheets(bounceDecks, bounceTexture, movingSegments);
  for (const sheet of bounceSheets) deckParent(sheet.movingIndex).add(setShadowRole(sheet.object, "receiver"));
  const bouncePresses = new BouncePresses();

  // Air columns (ADR 0075) are drawn, never `collidables`: like a
  // Checkpoint's marker, the region is walked into, not collided with.
  // `buildAirColumns` allocates nothing without a column to draw, and a
  // zero-force Volume draws nothing. The disposal sweep frees what the
  // columns share, since every shared piece hangs off one of them.
  const airColumns = buildAirColumns(volumes, environment);
  for (const column of airColumns.columns) scene.add(column);

  // Every Asset part that turns on its own, a fan's rotor (ADR 0075), still
  // or riding a Moving Segment. Found once: the Track's pieces never change
  // under a Stage.
  const spinningParts = findSpinningParts(scene);

  const checkpointMaterial = new THREE.MeshBasicMaterial({
    color: 0x4fd1c5,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  // Only a retired block's region gets a marker — a Gate is its own art (ADR 0068).
  for (const cp of checkpoints) {
    if (cp.trigger) scene.add(boxMesh(cp.trigger, checkpointMaterial));
  }

  // Brighter and far more opaque than a Checkpoint's marker: a Checkpoint is
  // ambient reassurance you can miss, a Finish Zone is the thing you are
  // running at, and you have to be able to pick it out down the length of a
  // Track. Both use the same box treatment so they read as the same family
  // of "walk into this" region.
  // Built only when there is something to draw with it: `disposeSceneGraph`
  // reaches materials through the meshes that use them, so a material
  // allocated for an empty list would never be released.
  if (finishZones.some((zone) => zone.trigger)) {
    const finishZoneMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    for (const zone of finishZones) {
      if (zone.trigger) scene.add(boxMesh(zone.trigger, finishZoneMaterial));
    }
  }

  const spinnerMaterial = new THREE.MeshStandardMaterial({ color: 0xf25c54, roughness: 0.5 });
  const spinnerMeshes = spinners.map((config) => {
    const mesh = setShadowRole(
      boxMesh(
        { center: config.center, halfExtents: { x: config.armLength, y: config.halfHeight, z: config.armRadius } },
        spinnerMaterial,
      ),
      "both",
    );
    scene.add(mesh);
    collidables.push(mesh);
    // A Spinner turns about the vertical, which never takes it lower.
    stillTrack.push(mesh);
    return mesh;
  });

  const propMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.6 });
  const propMeshes = props.map((config) => {
    // An Asset Prop (ADR 0095) is drawn exactly like a Moving Segment: the
    // Asset's own template under a group whose pose is written every frame, so
    // one transform carries everything it draws.
    if (config.shape.kind === "asset") {
      const group = new THREE.Group();
      const template = assetTemplates[config.shape.moduleId];
      if (!template) throw new Error(`asset "${config.shape.moduleId}": no loaded visual template (fetch it before placing)`);
      const visual = template.clone(true);
      visual.scale.setScalar(config.shape.scale);
      group.add(visual);
      setShadowRole(group, "both");
      scene.add(group);
      group.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) collidables.push(object);
      });
      return group;
    }
    if (config.shape.kind === "box") {
      const mesh = setShadowRole(boxMesh({ center: config.center, halfExtents: config.shape.halfExtents }, propMaterial), "both");
      scene.add(mesh);
      collidables.push(mesh);
      return mesh;
    }
    const mesh = setShadowRole(new THREE.Mesh(new THREE.SphereGeometry(config.shape.radius, 16, 12), propMaterial), "both");
    mesh.position.set(config.center.x, config.center.y, config.center.z);
    scene.add(mesh);
    collidables.push(mesh);
    return mesh;
  });

  // Every still piece, and every Moving Segment wherever its Motion can carry
  // it. Props are left out, since they fall.
  const lowestSegmentY = Math.min(
    lowestDrawnY(stillTrack),
    ...movingGroups.map((group, i) => lowestMovingY(localBounds(group), movingSegments[i]!)),
  );

  return {
    collidables,
    movingGroups,
    deckParent,
    lowestSegmentY,
    floorBelow,
    onIce,
    placeProps: (snapshots) => {
      // Recomputed immediately (not left for the next render()) since the
      // camera arm raycasts against these meshes — via `collidables` —
      // before this frame renders.
      for (let i = 0; i < propMeshes.length; i += 1) {
        const mesh = propMeshes[i]!;
        const prop = snapshots[i];
        if (!prop) continue;
        mesh.position.set(prop.position.x, prop.position.y, prop.position.z);
        mesh.quaternion.set(prop.rotation.x, prop.rotation.y, prop.rotation.z, prop.rotation.w);
        mesh.updateMatrixWorld();
      }
    },
    poseMotion: (t, centres) => {
      poseMovingSegments(t);
      // Marched in sim time (not wall clock), so belts pause with the sim —
      // at true belt speed, so what you see is what carries you.
      for (const strip of conveyorStrips) strip.update(t * TICK_DT);
      // Feet sink into the mud on the same clock, and the ice sparkles on it.
      for (const sheet of mudSheets) sheet.update(t * TICK_DT, centres);
      for (const sheet of iceSheets) sheet.update(t * TICK_DT);
      // Recomputed immediately, same reason as the Props.
      for (let i = 0; i < spinnerMeshes.length; i += 1) {
        const config = spinners[i]!;
        const q = yawQuat(spinnerAngleAt(config, t));
        const mesh = spinnerMeshes[i]!;
        mesh.quaternion.set(q.x, q.y, q.z, q.w);
        mesh.updateMatrixWorld();
      }
    },
    squashSprings: (characters, nowMs) => {
      if (springs.length === 0) return [];
      for (const [segmentIndex, scale] of springSquashes.update(characters, springs, nowMs)) {
        const instance = springVisuals.get(segmentIndex);
        // Multiplied into the Segment's own scale (ADR 0062), never replacing
        // it: a 2x Spring squashes as a 2x Spring.
        if (instance) instance.scale.set(base(instance) * scale.xz, base(instance) * scale.y, base(instance) * scale.xz);
      }
      return springSquashes
        .settled()
        .flatMap((segmentIndex) => springs.find((candidate) => candidate.segmentIndex === segmentIndex) ?? []);
    },
    pressBounceSheets: (characters, nowMs) => {
      if (bounceSheets.length === 0) return [];
      const presses = bouncePresses.update(characters, nowMs);
      for (const sheet of bounceSheets) sheet.update(presses);
      return bouncePresses.landings();
    },
    updateAirColumns: (nowMs, eye) => {
      if (airColumns.columns.length === 0) return;
      airColumns.update(nowMs, eye);
    },
    spin: (nowMs) => spinParts(spinningParts, nowMs),
    dispose: () => {
      collidables.length = 0;
    },
  };
};
