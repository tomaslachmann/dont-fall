import { createPuffLook, type PuffLook } from "@dont-fall/render";
import {
  AIR_PUFF_COUNT,
  AIR_PUFF_VARIANTS,
  AIR_SWOOSH_COUNT,
  AIR_SWOOSH_SEGMENTS,
  airColumnFrame,
  airPuffPlacement,
  airPuffSeed,
  airSwooshAlpha,
  airSwooshHead,
  airSwooshPoint,
  airSwooshSeed,
  airSwooshSpan,
  airSwooshWidth,
  type AirColumnFrame,
  type EnvironmentPreset,
  type Vec3,
  type VolumeConfig,
} from "@dont-fall/shared";
import * as THREE from "three";

/**
 * Frozen flow for `prefers-reduced-motion`. The motion only reinforces the
 * message: parked swooshes still spiral along the force and parked puffs
 * still sit in the mouth, so freezing the clock keeps all of the meaning.
 */
const REDUCED_MOTION =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Swooshes read as lit air, not geometry: near-white with a breath of sky. */
const SWOOSH_COLOR = 0xf4fbff;
/**
 * Across a swoosh, from edge to edge, how opaque it is. Solid through the
 * middle, with a short ramp at each edge: a crisp cartoon edge that still
 * doesn't crawl.
 */
const SWOOSH_EDGE_TEXELS = 32;
const SWOOSH_EDGE_FROM = 0.55;
/** A different shape seed from the sky's own puffs, so the air's never repeat a cloud's. */
const PUFF_LOOK_SEED = 75;
/** How far ahead along the column a swoosh looks to find its own direction. */
const TANGENT_STEP = 0.01;

/**
 * The columns a Stage draws (ADR 0075): one per Volume with a flow. Each is
 * cartoon swooshes spiralling along the Volume's force, plus puffs popping out
 * of its entry face. It is cosmetic from end to end: the sim reads the Volume
 * off `resolveTrack`, never this.
 */
export interface AirColumns {
  /** One group per drawn Volume, in world space, for the caller to add to the scene. */
  readonly columns: readonly THREE.Group[];
  /**
   * Advances the flow to `nowMs` (render-rate, wall clock, like every other
   * overlay). The swooshes turn their faces toward the camera at
   * `cameraPosition`.
   */
  update(nowMs: number, cameraPosition: THREE.Vector3): void;
  /** Frees what the columns share. Scene sweeps reach it all too; this is for callers that don't sweep. */
  dispose(): void;
}

/** The edge profile across a swoosh, as an alpha map: `uv.x` 0 → 1 is one edge to the other. */
const swooshEdge = (): THREE.DataTexture => {
  const data = new Uint8Array(SWOOSH_EDGE_TEXELS * 4);
  for (let i = 0; i < SWOOSH_EDGE_TEXELS; i += 1) {
    const across = Math.abs(((i + 0.5) / SWOOSH_EDGE_TEXELS) * 2 - 1);
    const t = Math.min(Math.max((across - SWOOSH_EDGE_FROM) / (1 - SWOOSH_EDGE_FROM), 0), 1);
    const alpha = Math.round(255 * (1 - t * t * (3 - 2 * t)));
    // An alpha map is read from its green channel.
    data.set([alpha, alpha, alpha, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, SWOOSH_EDGE_TEXELS, 1);
  texture.name = "air-swoosh-edge";
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
};

/** One static index buffer's worth of ribbon quads, for `count` ribbons of `segments` pieces. */
const ribbonGeometry = (count: number, segments: number): THREE.BufferGeometry => {
  const perRibbon = (segments + 1) * 2;
  const vertices = count * perRibbon;
  const uv = new Float32Array(vertices * 2);
  const indices: number[] = [];
  for (let i = 0; i < count; i += 1) {
    for (let j = 0; j <= segments; j += 1) {
      const v = i * perRibbon + j * 2;
      uv.set([0, j / segments, 1, j / segments], v * 2);
      if (j < segments) indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage),
  );
  // White with per-vertex alpha: the material's colour tints, the alpha fades each point along the column.
  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array(vertices * 4).fill(1), 4).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  return geometry;
};

interface Shared {
  swooshMaterial: THREE.MeshBasicMaterial;
  puffLook: PuffLook;
}

const swooshSeeds = Array.from({ length: AIR_SWOOSH_COUNT }, (_, i) => airSwooshSeed(i));
const puffSeeds = Array.from({ length: AIR_PUFF_COUNT }, (_, i) => airPuffSeed(i));

const buildColumn = (frame: AirColumnFrame, shared: Shared): { group: THREE.Group; update: AirColumns["update"] } => {
  const group = new THREE.Group();
  group.name = "air-column";
  // The column's own frame: origin at the entry face, +Y along the force.
  const turn = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(frame.axis.x, frame.axis.y, frame.axis.z),
  );
  const entry = new THREE.Vector3(frame.entry.x, frame.entry.y, frame.entry.z);
  group.position.copy(entry);
  group.quaternion.copy(turn);
  const toLocal = turn.clone().invert();

  const swooshGeometry = ribbonGeometry(AIR_SWOOSH_COUNT, AIR_SWOOSH_SEGMENTS);
  const swooshes = new THREE.Mesh(swooshGeometry, shared.swooshMaterial);
  swooshes.name = "air-swooshes";
  // Rebuilt every frame, so its bounding sphere never follows the ribbons.
  swooshes.frustumCulled = false;
  group.add(swooshes);
  const positions = swooshGeometry.getAttribute("position") as THREE.BufferAttribute;
  const colors = swooshGeometry.getAttribute("color") as THREE.BufferAttribute;

  const tint = new THREE.Color();
  const puffGroups = Array.from({ length: AIR_PUFF_VARIANTS }, (_, variant) => {
    const members = puffSeeds.filter((seed) => seed.variant === variant);
    const mesh = new THREE.InstancedMesh(shared.puffLook.geometries[variant]!, shared.puffLook.material, members.length);
    mesh.name = `air-puffs-${variant}`;
    mesh.frustumCulled = false;
    members.forEach((seed, i) => mesh.setColorAt(i, shared.puffLook.tint(seed.tint, tint)));
    group.add(mesh);
    return { mesh, members };
  });

  const camera = new THREE.Vector3();
  const here: Vec3 = { x: 0, y: 0, z: 0 };
  const ahead: Vec3 = { x: 0, y: 0, z: 0 };
  const tangent = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const across = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const perRibbon = (AIR_SWOOSH_SEGMENTS + 1) * 2;

  const update = (nowMs: number, cameraPosition: THREE.Vector3): void => {
    const t0 = REDUCED_MOTION ? 0 : nowMs;
    // The camera in the column's frame, so every ribbon is built there.
    camera.copy(cameraPosition).sub(entry).applyQuaternion(toLocal);

    swooshSeeds.forEach((seed, i) => {
      const head = airSwooshHead(t0, seed, frame);
      const span = airSwooshSpan(seed);
      for (let j = 0; j <= AIR_SWOOSH_SEGMENTS; j += 1) {
        const s = j / AIR_SWOOSH_SEGMENTS;
        const t = head - s * span;
        airSwooshPoint(t, seed, frame, here);
        airSwooshPoint(t + TANGENT_STEP, seed, frame, ahead);
        tangent.set(ahead.x - here.x, ahead.y - here.y, ahead.z - here.z);
        toCamera.set(camera.x - here.x, camera.y - here.y, camera.z - here.z);
        // Face-on to the camera: the ribbon's width runs across both its own
        // direction and the line of sight.
        across.crossVectors(tangent, toCamera);
        const length = across.length();
        across.multiplyScalar(length > 1e-9 ? airSwooshWidth(s) / 2 / length : 0);
        const v = i * perRibbon + j * 2;
        positions.setXYZ(v, here.x - across.x, here.y - across.y, here.z - across.z);
        positions.setXYZ(v + 1, here.x + across.x, here.y + across.y, here.z + across.z);
        const alpha = airSwooshAlpha(t);
        colors.setW(v, alpha);
        colors.setW(v + 1, alpha);
      }
    });
    positions.needsUpdate = true;
    colors.needsUpdate = true;

    for (const { mesh, members } of puffGroups) {
      members.forEach((seed, i) => {
        const placed = airPuffPlacement(t0, seed, frame);
        position.set(placed.x, placed.y, placed.z);
        rotation.setFromAxisAngle(up, placed.yaw);
        scale.setScalar(placed.scale);
        mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  };

  return { group, update };
};

/**
 * Builds one column per Volume with a flow to draw, in `environment`'s
 * cloud style. A zero-force Volume draws nothing: walking into one does
 * nothing, so nothing should promise flow. With no column to draw, nothing
 * is allocated.
 */
export const buildAirColumns = (volumes: readonly VolumeConfig[], environment: EnvironmentPreset): AirColumns => {
  const frames = volumes
    .map(airColumnFrame)
    .filter((frame): frame is AirColumnFrame => frame !== null && frame.length > 0 && frame.halfWidth > 0);
  if (frames.length === 0) return { columns: [], update: () => {}, dispose: () => {} };

  const edge = swooshEdge();
  const shared: Shared = {
    swooshMaterial: new THREE.MeshBasicMaterial({
      name: "air-swooshes",
      color: SWOOSH_COLOR,
      vertexColors: true,
      alphaMap: edge,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    puffLook: createPuffLook(environment, AIR_PUFF_VARIANTS, PUFF_LOOK_SEED),
  };
  const built = frames.map((frame) => buildColumn(frame, shared));
  for (const column of built) column.update(0, new THREE.Vector3(0, 0, 1));
  return {
    columns: built.map((column) => column.group),
    update: (nowMs, cameraPosition) => {
      for (const column of built) column.update(nowMs, cameraPosition);
    },
    dispose: () => {
      for (const { group } of built) {
        (group.getObjectByName("air-swooshes") as THREE.Mesh).geometry.dispose();
        group.traverse((object) => {
          if ((object as THREE.InstancedMesh).isInstancedMesh) (object as THREE.InstancedMesh).dispose();
        });
      }
      shared.swooshMaterial.dispose();
      edge.dispose();
      shared.puffLook.dispose();
    },
  };
};
