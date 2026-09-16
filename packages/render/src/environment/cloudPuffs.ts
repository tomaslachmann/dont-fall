import { wrapAround, type EnvironmentPreset, type EnvironmentWind } from "@dont-fall/shared";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { seededRandom } from "./random.js";

/**
 * The side of the square field the puffs wrap around, centred on the camera.
 * Half of it is past the game's fog, so a puff wrapping from one edge to the
 * other happens where nothing is visible; {@link PUFF_EDGE_FADE} shrinks it to
 * nothing first anyway, for the builder's unfogged preview.
 */
export const PUFF_FIELD_SIZE = 400;
/** How far inside the field's edge a puff starts shrinking toward it. */
export const PUFF_EDGE_FADE = 40;
/**
 * No puff above the cloud floor comes closer than this, horizontally, to the
 * camera: the band sits at the Track's height, and a cloud drifting across the
 * route would hide it (ADR 0074: an Environment never affects play). Puffs
 * beneath the floor may come right up to it.
 */
export const PUFF_CLEARANCE_ABOVE_FLOOR = 70;
/** How far a puff takes to grow to full size once past its clearance. */
export const PUFF_CLEARANCE_FADE = 30;

/** Distinct puff shapes; each is one draw call. */
export const PUFF_VARIANTS = 3;
/** A puff's size (world units across its widest sphere cluster), smallest to largest. */
const PUFF_SIZE = { min: 5, max: 14 } as const;
/** How far toward the preset's shade colour a puff's tint may go. */
const PUFF_TINT_SPREAD = 0.45;
/** How much of the shade colour a puff gives off itself, so its unlit side never goes grey (research §3). */
const PUFF_EMISSIVE = 0.25;
/** The toon style's three bands of light, darkest first. */
const TOON_BANDS = [96, 176, 255] as const;
/** The same clouds on every load. */
const PUFF_SEED = 7;

/** One puff as scattered: where it starts, its full size and turn, and how clear of the camera it keeps. */
export interface Puff {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly size: number;
  readonly yaw: number;
  readonly variant: number;
  readonly clearance: number;
}

export interface PuffPlacement {
  x: number;
  y: number;
  z: number;
  /** 0 hides the puff. */
  scale: number;
}

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * Where `puff` is drawn `seconds` into the wall clock (never sim time — a cloud
 * tells the player nothing about the game): drifted by the wind, wrapped into
 * the field around the camera, and shrunk toward the field's edge and inside
 * its clearance, so it never pops in or out of view.
 */
export const puffPlacement = (
  puff: Puff,
  wind: EnvironmentWind,
  seconds: number,
  cameraX: number,
  cameraZ: number,
): PuffPlacement => {
  const x = wrapAround(puff.x + wind.x * seconds, cameraX, PUFF_FIELD_SIZE);
  const z = wrapAround(puff.z + wind.z * seconds, cameraZ, PUFF_FIELD_SIZE);
  const half = PUFF_FIELD_SIZE / 2;
  const towardEdge = Math.max(Math.abs(x - cameraX), Math.abs(z - cameraZ));
  const edge = 1 - smoothstep(half - PUFF_EDGE_FADE, half, towardEdge);
  const clear = puff.clearance > 0 ? smoothstep(puff.clearance, puff.clearance + PUFF_CLEARANCE_FADE, Math.hypot(x - cameraX, z - cameraZ)) : 1;
  return { x, y: puff.y, z, scale: puff.size * edge * clear };
};

/**
 * The preset's puffs, scattered over the field in its bands around `floorY`:
 * the count shared out as evenly as the bands allow, the variants taken in
 * turn. Seeded, so an Environment is the same on every load.
 */
export const scatterPuffs = (preset: EnvironmentPreset, floorY: number, seed = PUFF_SEED): Puff[] => {
  const { bands, count } = preset.puffs;
  if (bands.length === 0) return [];
  const next = seededRandom(seed);
  const puffs: Puff[] = [];
  for (let i = 0; i < count; i += 1) {
    const band = bands[i % bands.length]!;
    const size = PUFF_SIZE.min + next() * (PUFF_SIZE.max - PUFF_SIZE.min);
    puffs.push({
      x: (next() - 0.5) * PUFF_FIELD_SIZE,
      y: floorY + band.low + next() * (band.high - band.low),
      z: (next() - 0.5) * PUFF_FIELD_SIZE,
      size,
      yaw: next() * Math.PI * 2,
      variant: i % PUFF_VARIANTS,
      clearance: band.high > 0 ? PUFF_CLEARANCE_ABOVE_FLOOR : 0,
    });
  }
  return puffs;
};

/**
 * One chunky low-poly cloud shape, about 1 unit across: a handful of
 * icospheres flattened along a wide, low body (research §3).
 */
const puffGeometry = (next: () => number): THREE.BufferGeometry => {
  const spheres = 4 + Math.floor(next() * 4);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < spheres; i += 1) {
    const radius = i === 0 ? 0.3 : 0.14 + next() * 0.12;
    const part = new THREE.IcosahedronGeometry(radius, 1);
    part.translate(
      i === 0 ? 0 : (next() - 0.5) * 0.6,
      i === 0 ? 0 : (next() - 0.3) * 0.12,
      i === 0 ? 0 : (next() - 0.5) * 0.3,
    );
    parts.push(part);
  }
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  // A flat underside, the way cumulus sits.
  merged.scale(1, 0.75, 1);
  return merged;
};

const puffMaterial = (preset: EnvironmentPreset, gradientMap: THREE.Texture | null): THREE.Material => {
  const shade = new THREE.Color(preset.puffs.shade);
  if (preset.puffs.style === "toon") {
    return new THREE.MeshToonMaterial({
      name: "environment-puffs",
      color: 0xffffff,
      gradientMap,
      emissive: shade,
      emissiveIntensity: PUFF_EMISSIVE,
    });
  }
  // Standard rather than Lambert: only standard materials take `scene.environment`,
  // so the puffs are filled in the sky's colours like the Assets are.
  return new THREE.MeshStandardMaterial({
    name: "environment-puffs",
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    flatShading: true,
    emissive: shade,
    emissiveIntensity: PUFF_EMISSIVE,
  });
};

const toonGradient = (): THREE.DataTexture => {
  const texture = new THREE.DataTexture(Uint8Array.from(TOON_BANDS), TOON_BANDS.length, 1, THREE.RedFormat);
  texture.name = "environment-puffs-toon-bands";
  // MeshToonMaterial's docs require nearest filtering, or the bands blur into a gradient.
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

/**
 * How a puff looks, for anything else that draws puffs in the sky's own
 * style: a fan's air (ADR 0075). It uses the same shape recipe, the same
 * material for the preset's style, and the same lit-to-shade tint as the
 * clouds, so the air belongs to the sky it sits under.
 */
export interface PuffLook {
  /** `variants` shapes, each about one unit across. */
  readonly geometries: readonly THREE.BufferGeometry[];
  readonly material: THREE.Material;
  /** Writes into `out` the colour `share` of the way from the preset's lit cloud colour toward its shade. */
  tint(share: number, out: THREE.Color): THREE.Color;
  dispose(): void;
}

/** A {@link PuffLook} for `preset`, its shapes drawn from `seed`. */
export const createPuffLook = (preset: EnvironmentPreset, variants: number, seed: number): PuffLook => {
  const next = seededRandom(seed);
  const geometries = Array.from({ length: variants }, () => puffGeometry(next));
  const gradientMap = preset.puffs.style === "toon" ? toonGradient() : null;
  const material = puffMaterial(preset, gradientMap);
  const lit = new THREE.Color(preset.puffs.lit);
  const shade = new THREE.Color(preset.puffs.shade);
  return {
    geometries,
    material,
    tint: (share, out) => out.copy(lit).lerp(shade, share),
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
      gradientMap?.dispose();
    },
  };
};

export interface CloudPuffs {
  readonly group: THREE.Group;
  update(cameraPosition: THREE.Vector3, nowMs: number): void;
  dispose(): void;
}

/**
 * Chunky clouds that drift and wrap around the camera so the field never ends
 * (ADR 0074, research §3): {@link PUFF_VARIANTS} merged low-poly shapes, one
 * opaque `InstancedMesh` each, tinted per instance between the preset's lit
 * and shade colours. Lit in the preset's style. Never cast or receive a
 * shadow, never collide.
 */
export const createCloudPuffs = (preset: EnvironmentPreset, floorY: number): CloudPuffs => {
  const puffs = scatterPuffs(preset, floorY);
  const next = seededRandom(PUFF_SEED + 1);
  const gradientMap = preset.puffs.style === "toon" ? toonGradient() : null;
  const material = puffMaterial(preset, gradientMap);
  const lit = new THREE.Color(preset.puffs.lit);
  const shade = new THREE.Color(preset.puffs.shade);

  const group = new THREE.Group();
  group.name = "environment-puffs";

  const variants = Array.from({ length: PUFF_VARIANTS }, (_, variant) => {
    const members = puffs.filter((puff) => puff.variant === variant);
    const mesh = new THREE.InstancedMesh(puffGeometry(next), material, members.length);
    mesh.name = `environment-puffs-${variant}`;
    // Its bounding sphere is computed once and never follows the drifting
    // instances, so culling would drop puffs that are in view.
    mesh.frustumCulled = false;
    const tint = new THREE.Color();
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    members.forEach((_, i) => {
      // Hidden until the first `update` places it, rather than a unit puff at the origin.
      mesh.setMatrixAt(i, hidden);
      mesh.setColorAt(i, tint.copy(lit).lerp(shade, next() * PUFF_TINT_SPREAD));
    });
    group.add(mesh);
    return { mesh, members, turns: members.map((puff) => new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, puff.yaw)) };
  });

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  return {
    group,
    update: (cameraPosition, nowMs) => {
      const seconds = nowMs / 1000;
      for (const { mesh, members, turns } of variants) {
        members.forEach((puff, i) => {
          const placement = puffPlacement(puff, preset.puffs.wind, seconds, cameraPosition.x, cameraPosition.z);
          position.set(placement.x, placement.y, placement.z);
          scale.setScalar(placement.scale);
          mesh.setMatrixAt(i, matrix.compose(position, turns[i]!, scale));
        });
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose: () => {
      for (const { mesh } of variants) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
      material.dispose();
      gradientMap?.dispose();
    },
  };
};
