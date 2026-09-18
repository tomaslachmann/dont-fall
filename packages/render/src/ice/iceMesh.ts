import * as THREE from "three";
import { gridCutToRegion } from "../mud/mudMesh.js";
import {
  deckRegion,
  deckToWorld,
  distanceToEdge,
  mudBevel,
  mudCoverage,
  mudOutline,
  nearestFreeEdge,
  type MudDeckPlacement,
} from "../mud/mudShape.js";
import {
  ICE_BODY_ROUGHNESS,
  ICE_COLOR_CRACK,
  ICE_COLOR_LIGHT,
  ICE_CRACK_ALPHA,
  ICE_CRACK_HALO_ALPHA,
  ICE_DEPTH,
  ICE_DETAIL_SIZE,
  ICE_DETAIL_TILE,
  ICE_GLINT_COLOR,
  ICE_SEAT_LIFT,
  ICE_SIDE_COLOR,
  ICE_SIDE_FOOT_COLOR,
  ICE_SIDE_ROUGHNESS,
  ICE_SPECK_ALPHA_MAX,
} from "./iceLook.js";
import { iceColor, iceCrack, iceGlintPose, iceGlintSites, iceRim, iceSpecks } from "./iceShape.js";

/**
 * A deck's ice as something to draw (ADR 0107) — the game and the Track
 * builder both build it here, so both show the same slab.
 */
export interface IceSlab {
  /**
   * The slab, its cut sides, its detail and its glints, in the deck's own
   * frame with the deck top at y = 0 — the caller seats it where the deck is,
   * as it would any deck overlay.
   */
  object: THREE.Group;
  /**
   * Sparkle at `tSeconds`: each glint spot pops its star for a moment on its
   * own period and phase. A pure function of the time, so any clock drives
   * it — the game's sim time, the builder's wall clock — and the same time
   * always draws the same sparkles.
   */
  glint: (tSeconds: number) => void;
}

type Point = { x: number; z: number };

const cross2 = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

/** Up-facing in three.js: counter-clockwise seen from +y, which in x/z is a *negative* `cross2`. */
const upFacing = (vertices: Point[], [u, v, w]: [number, number, number]): [number, number, number] =>
  cross2(vertices[u]!, vertices[v]!, vertices[w]!) > 0 ? [u, w, v] : [u, v, w];

const srgbToLinear = (rgb: [number, number, number]): THREE.Color => new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);

/** Frozen for `prefers-reduced-motion`: the glints hold still, and the ice still reads as ice. */
const REDUCED_MOTION =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Every slab's `glint`, by the object that carries it — what {@link glintIce} walks a scene for. */
const glints = new WeakMap<THREE.Object3D, (tSeconds: number) => void>();

const scratch = { matrix: new THREE.Matrix4(), position: new THREE.Vector3(), scale: new THREE.Vector3(), rotation: new THREE.Quaternion() };
const UP = new THREE.Vector3(0, 1, 0);

let sharedDetail: THREE.DataTexture | null = null;

/**
 * The one detail texture every ice slab wears (ADR 0107): the crack veins and
 * the frozen bubbles, generated once — pure functions of position, no file,
 * no DOM — on a tile that wraps. Anchored to world space by the slab's own
 * UVs, so a vein runs on across a seam between two decks. Shared and never
 * disposed with a slab: the next Track's ice wears the same winter.
 */
export const iceDetailTexture = (): THREE.DataTexture => {
  if (sharedDetail) return sharedDetail;
  const size = ICE_DETAIL_SIZE;
  const data = new Uint8Array(size * size * 4);
  const crack = srgbToLinear([((ICE_COLOR_CRACK >> 16) & 255) / 255, ((ICE_COLOR_CRACK >> 8) & 255) / 255, (ICE_COLOR_CRACK & 255) / 255]);
  const halo = srgbToLinear([((ICE_COLOR_LIGHT >> 16) & 255) / 255, ((ICE_COLOR_LIGHT >> 8) & 255) / 255, (ICE_COLOR_LIGHT & 255) / 255]);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const x = ((i + 0.5) / size) * ICE_DETAIL_TILE;
      const z = ((j + 0.5) / size) * ICE_DETAIL_TILE;
      const veins = iceCrack(x, z, ICE_DETAIL_TILE);
      const speck = iceSpecks(x, z, ICE_DETAIL_TILE);
      const alpha = Math.max(veins.vein * ICE_CRACK_ALPHA, veins.halo * ICE_CRACK_HALO_ALPHA, speck * ICE_SPECK_ALPHA_MAX);
      // The vein's near-white wins over the halo's pale blue where both show.
      const t = veins.vein;
      const at = (j * size + i) * 4;
      data[at] = Math.round(255 * (halo.r + (crack.r - halo.r) * t));
      data[at + 1] = Math.round(255 * (halo.g + (crack.g - halo.g) * t));
      data[at + 2] = Math.round(255 * (halo.b + (crack.b - halo.b) * t));
      data[at + 3] = Math.round(255 * alpha);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  sharedDetail = texture;
  return texture;
};

/** The star one glint pops: two thin crossed arms lying flat on the slab. */
const starGeometry = (): THREE.BufferGeometry => {
  const w = 0.09;
  const positions: number[] = [];
  const quad = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): void => {
    positions.push(ax, 0, az, bx, 0, bz, cx, 0, cz, ax, 0, az, cx, 0, cz, dx, 0, dz);
  };
  quad(-0.5, -w, 0.5, -w, 0.5, w, -0.5, w);
  quad(-w, -0.5, w, -0.5, w, 0.5, -w, 0.5);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geometry;
};

/**
 * Builds `self`'s ice. `all` is every ice deck on the Track (it may include
 * `self`): an edge that runs on into one of them, moving with this one, is a
 * seam rather than a cut side, so the slab carries across it at full depth —
 * the mud's own seam rule (ADR 0103), on the mud's own machinery.
 */
export const buildIceSlab = (self: MudDeckPlacement, all: readonly MudDeckPlacement[]): IceSlab => {
  const { deck } = self;
  const coverage = mudCoverage(deck);
  const edges = mudOutline(self, all);
  const { vertices, triangles } = gridCutToRegion(deckRegion(coverage), deck.halfX, deck.halfZ);

  // One read per vertex: the pastel, the frost rim, and the world UV the
  // detail texture is anchored by.
  const count = vertices.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (const [i, p] of vertices.entries()) {
    const world = deckToWorld(deck, p);
    positions.set([p.x, ICE_DEPTH, p.z], i * 3);
    normals.set([0, 1, 0], i * 3);
    const rim = iceRim(nearestFreeEdge(p, edges).distance);
    const colour = srgbToLinear(iceColor(world.x, world.z, rim));
    colours.set([colour.r, colour.g, colour.b], i * 3);
    uvs.set([world.x / ICE_DETAIL_TILE, world.z / ICE_DETAIL_TILE], i * 2);
  }
  const faces = triangles.map((triangle) => upFacing(vertices, triangle));
  const index = faces.flat();

  const group = new THREE.Group();
  group.name = "ice";

  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  body.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  body.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  body.setIndex(index);
  body.computeBoundingSphere();
  const bodyMesh = new THREE.Mesh(
    body,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: ICE_BODY_ROUGHNESS, metalness: 0 }),
  );
  bodyMesh.name = "ice-body";
  group.add(bodyMesh);

  // The cracks and frozen bubbles, a hair above the top so they win depth —
  // the one translucent layer, over an opaque slab, so there is nothing to
  // mis-sort against.
  const detail = new THREE.BufferGeometry();
  const detailPositions = new Float32Array(positions);
  for (let i = 1; i < detailPositions.length; i += 3) detailPositions[i] = ICE_DEPTH + 0.002;
  detail.setAttribute("position", new THREE.BufferAttribute(detailPositions, 3));
  detail.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
  detail.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  detail.setIndex(index);
  detail.computeBoundingSphere();
  const detailMesh = new THREE.Mesh(
    detail,
    new THREE.MeshStandardMaterial({
      map: iceDetailTexture(),
      transparent: true,
      depthWrite: false,
      roughness: 0.3,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  detailMesh.name = "ice-detail";
  group.add(detailMesh);

  // The cut side (the mud's rule, ADR 0103): where the ice stops it stops
  // square, a wall from the top down to where the bevel it grew out over
  // meets the piece's side — frost at its lip, a deeper blue at its foot.
  const bevel = mudBevel(deck);
  const sideFoot = bevel > 0 ? -(bevel + ICE_SEAT_LIFT) : 0;
  const edgeUses = new Map<string, { from: number; to: number; count: number }>();
  for (const [u, v, w] of faces) {
    for (const [a, b] of [
      [u, v],
      [v, w],
      [w, u],
    ] as const) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const found = edgeUses.get(key);
      if (found) found.count += 1;
      else edgeUses.set(key, { from: a, to: b, count: 1 });
    }
  }
  const freeEdges = edges.filter((edge) => edge.free);
  const onFreeEdge = (p: Point): boolean => freeEdges.some((edge) => distanceToEdge(p, edge.a, edge.b) < 1e-4);
  const SIDE = new THREE.Color(ICE_SIDE_COLOR);
  const SIDE_FOOT = new THREE.Color(ICE_SIDE_FOOT_COLOR);
  const sidePositions: number[] = [];
  const sideNormals: number[] = [];
  const sideColours: number[] = [];
  for (const { from, to, count: uses } of edgeUses.values()) {
    if (uses !== 1) continue;
    const [a, b] = [vertices[from]!, vertices[to]!];
    if (!onFreeEdge({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 })) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const out = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
    for (const [vertex, top] of [
      [from, true],
      [from, false],
      [to, false],
      [from, true],
      [to, false],
      [to, true],
    ] as const) {
      const p = vertices[vertex]!;
      sidePositions.push(p.x, top ? ICE_DEPTH : sideFoot, p.z);
      sideNormals.push(out.x, 0, out.z);
      const colour = top ? SIDE : SIDE_FOOT;
      sideColours.push(colour.r, colour.g, colour.b);
    }
  }
  if (sidePositions.length > 0) {
    const side = new THREE.BufferGeometry();
    side.setAttribute("position", new THREE.BufferAttribute(new Float32Array(sidePositions), 3));
    side.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(sideNormals), 3));
    side.setAttribute("color", new THREE.BufferAttribute(new Float32Array(sideColours), 3));
    side.computeBoundingSphere();
    const sideMesh = new THREE.Mesh(
      side,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: ICE_SIDE_ROUGHNESS, metalness: 0 }),
    );
    sideMesh.name = "ice-sides";
    group.add(sideMesh);
  }

  // A seam's skirt, exactly the mud's: where the ice runs on into a
  // neighbour cut on a different grid, a wall a shade below the surface is
  // what a hairline between them shows instead of the deck.
  const skirt: number[] = [];
  for (const edge of edges) {
    if (edge.free) continue;
    const length = Math.hypot(edge.b.x - edge.a.x, edge.b.z - edge.a.z);
    const steps = Math.max(1, Math.ceil(length / 0.5));
    const h = ICE_DEPTH - 0.01;
    for (let k = 0; k < steps; k += 1) {
      const p = { x: edge.a.x + ((edge.b.x - edge.a.x) * k) / steps, z: edge.a.z + ((edge.b.z - edge.a.z) * k) / steps };
      const q = { x: edge.a.x + ((edge.b.x - edge.a.x) * (k + 1)) / steps, z: edge.a.z + ((edge.b.z - edge.a.z) * (k + 1)) / steps };
      skirt.push(p.x, h, p.z, q.x, h, q.z, q.x, 0, q.z, p.x, h, p.z, q.x, 0, q.z, p.x, 0, p.z);
      skirt.push(p.x, h, p.z, q.x, 0, q.z, q.x, h, q.z, p.x, h, p.z, p.x, 0, p.z, q.x, 0, q.z);
    }
  }
  if (skirt.length > 0) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(skirt), 3));
    geometry.computeVertexNormals();
    const skirtMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: ICE_SIDE_FOOT_COLOR, roughness: ICE_SIDE_ROUGHNESS, metalness: 0 }),
    );
    skirtMesh.name = "ice-seams";
    group.add(skirtMesh);
  }

  // --- Glints ---------------------------------------------------------------
  // One instanced star per spot, posed by `glint` from the time alone; a spot
  // between sparkles is scaled to nothing.
  const sites = iceGlintSites(coverage, edges);
  let glint = (_tSeconds: number): void => {};
  if (sites.length > 0) {
    const stars = new THREE.InstancedMesh(
      starGeometry(),
      new THREE.MeshBasicMaterial({ color: ICE_GLINT_COLOR, transparent: true, opacity: 0.95, depthWrite: false }),
      sites.length,
    );
    stars.name = "ice-glints";
    stars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Small, popping, and inside the body's own bounds: never culled on
    // their own, never casting.
    stars.frustumCulled = false;
    stars.castShadow = false;
    group.add(stars);
    glint = (tSeconds: number): void => {
      for (const [i, site] of sites.entries()) {
        const pose = iceGlintPose(site, tSeconds);
        scratch.position.set(site.x, ICE_DEPTH + 0.01, site.z);
        scratch.rotation.setFromAxisAngle(UP, pose.spin);
        scratch.scale.set(pose.scale, 1, pose.scale);
        stars.setMatrixAt(i, scratch.matrix.compose(scratch.position, scratch.rotation, scratch.scale));
      }
      stars.instanceMatrix.needsUpdate = true;
    };
    glint(0);
    glints.set(group, glint);
  }

  return { object: group, glint };
};

/**
 * Sparkles every ice slab under `root` at `tSeconds` — for a scene that holds
 * slabs without keeping their handles, as the Track builder's does (it
 * rebuilds them with every edit). Frozen for `prefers-reduced-motion`, like
 * the mud's bubbles.
 */
export const glintIce = (root: THREE.Object3D, tSeconds: number): void => {
  const seconds = REDUCED_MOTION ? 0 : tSeconds;
  root.traverse((node) => glints.get(node)?.(seconds));
};

/** Free a slab's GPU buffers — its geometry and materials are its own; the shared detail texture stays. */
export const disposeIceSlab = (slab: IceSlab): void => {
  slab.object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    (node.material as THREE.Material).dispose();
  });
};
