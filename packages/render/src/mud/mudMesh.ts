import * as THREE from "three";
import type { Vec3 } from "@dont-fall/shared";
import {
  MUD_BODY_ROUGHNESS,
  MUD_BUBBLE_COLOR,
  MUD_BUBBLE_RING,
  MUD_BUBBLE_RING_SPREAD,
  MUD_BUBBLE_ROUGHNESS,
  MUD_BUBBLE_SWELL,
  MUD_DENT_ABOVE,
  MUD_DENT_DEPTH,
  MUD_DENT_INTERVAL_SECONDS,
  MUD_DENT_POOL_SIZE,
  MUD_DENT_PRESS_SECONDS,
  MUD_DENT_RADIUS,
  MUD_DENT_REFILL_SECONDS,
  MUD_FLOOR,
  MUD_GRID_MAX_CELLS,
  MUD_GRID_SPACING,
  MUD_RING_COLOR,
  MUD_SEAT_LIFT,
  MUD_SIDE_COLOR,
  MUD_SIDE_FOOT_COLOR,
} from "./mudLook.js";
import {
  MUD_TOP,
  deckRegion,
  deckToWorld,
  distanceToEdge,
  isOnDeck,
  mudBevel,
  mudBubbleSites,
  mudColor,
  mudCoverage,
  mudHeight,
  mudOutline,
  type MudBubbleSite,
  type MudDeckPlacement,
} from "./mudShape.js";

/**
 * A deck's mud as something to draw (ADR 0103) — the game and the Track
 * builder both build it here, so both show the same mass.
 */
export interface MudMass {
  /**
   * The body, its cut sides, its bubbles and any seam skirts, in the deck's
   * own frame with the deck top at y = 0 — the caller seats it where the deck
   * is, as it would any deck overlay.
   */
  object: THREE.Group;
  /**
   * Press the surface under `feet` (deck frame) at `tSeconds`, and let
   * earlier presses fill back in. Feet high above the mud press nothing; feet
   * off the deck press nothing. Only the game calls this — the builder has
   * nobody wading.
   */
  wade: (tSeconds: number, feet: readonly Vec3[]) => void;
  /**
   * Bubble at `tSeconds`: each spot swells a bubble out of the mud, pops it,
   * and lets the ring it leaves spread and sink back in. A pure function of
   * the time, so any clock drives it — the game's sim time, the builder's
   * wall clock — and the same time always draws the same bubbles.
   */
  simmer: (tSeconds: number) => void;
}

type Point = { x: number; z: number };

const cross2 = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

/** `polygon` cut to the side of `p`→`q` that `sign` says is inside (Sutherland–Hodgman, one edge). */
const clipToEdge = (polygon: Point[], p: Point, q: Point, sign: number): Point[] => {
  const out: Point[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i]!;
    const next = polygon[(i + 1) % polygon.length]!;
    const dc = sign * cross2(p, q, current);
    const dn = sign * cross2(p, q, next);
    if (dc >= 0) out.push(current);
    if ((dc > 0 && dn < 0) || (dc < 0 && dn > 0)) {
      const t = dc / (dc - dn);
      out.push({ x: current.x + (next.x - current.x) * t, z: current.z + (next.z - current.z) * t });
    }
  }
  return out;
};

/**
 * A regular grid cut exactly to the deck's region: every cell's two triangles
 * clipped against every region triangle they overlap. The outline stays the
 * deck's own (a quarter disc stays round, a hole stays open) while the inside
 * is evenly dense enough to carry lumps — which a round Asset's own top face,
 * a fan of long thin slivers, is not. Exported for the ice (ADR 0107), whose
 * slab is cut from the same cloth.
 */
export const gridCutToRegion = (
  region: [Point, Point, Point][],
  halfX: number,
  halfZ: number,
): { vertices: Point[]; triangles: [number, number, number][] } => {
  // The grid is the footprint's, so neighbouring decks cut on the same lines
  // wherever their footprints line up.
  const spacing = Math.max(MUD_GRID_SPACING, (2 * Math.max(halfX, halfZ)) / MUD_GRID_MAX_CELLS);
  const nx = Math.max(1, Math.ceil((2 * halfX) / spacing));
  const nz = Math.max(1, Math.ceil((2 * halfZ) / spacing));
  const cellX = (2 * halfX) / nx;
  const cellZ = (2 * halfZ) / nz;
  const vertices: Point[] = [];
  const triangles: [number, number, number][] = [];
  const index = new Map<string, number>();
  const vertex = (p: Point): number => {
    const key = `${Math.round(p.x * 1e4)},${Math.round(p.z * 1e4)}`;
    const found = index.get(key);
    if (found !== undefined) return found;
    index.set(key, vertices.length);
    vertices.push(p);
    return vertices.length - 1;
  };
  const corner = (i: number, j: number): Point => ({ x: -halfX + i * cellX, z: -halfZ + j * cellZ });

  for (const [a, b, c] of region) {
    const sign = Math.sign(cross2(a, b, c));
    if (sign === 0) continue;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) + halfX) / cellX));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) + halfX) / cellX));
    const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) + halfZ) / cellZ));
    const j1 = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z, c.z) + halfZ) / cellZ));
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const [p00, p10, p11, p01] = [corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)];
        for (const cell of [
          [p00, p10, p11],
          [p00, p11, p01],
        ]) {
          let piece = cell;
          piece = clipToEdge(piece, a, b, sign);
          piece = clipToEdge(piece, b, c, sign);
          piece = clipToEdge(piece, c, a, sign);
          if (piece.length < 3) continue;
          const ids = piece.map(vertex);
          for (let k = 1; k + 1 < ids.length; k += 1) {
            const [u, v, w] = [ids[0]!, ids[k]!, ids[k + 1]!];
            if (u === v || v === w || u === w) continue;
            if (Math.abs(cross2(vertices[u]!, vertices[v]!, vertices[w]!)) < 1e-9) continue;
            triangles.push([u, v, w]);
          }
        }
      }
    }
  }
  return { vertices, triangles };
};

/** Up-facing in three.js: counter-clockwise seen from +y, which in x/z is a *negative* `cross2`. */
const upFacing = (vertices: Point[], [u, v, w]: [number, number, number]): [number, number, number] =>
  cross2(vertices[u]!, vertices[v]!, vertices[w]!) > 0 ? [u, w, v] : [u, v, w];

const srgbToLinear = (rgb: [number, number, number]): THREE.Color => new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);

/** The cosine hump a dent presses: 1 under the foot, 0 at {@link MUD_DENT_RADIUS}. */
const dentFalloff = (r: number): number => (r >= MUD_DENT_RADIUS ? 0 : (1 + Math.cos((Math.PI * r) / MUD_DENT_RADIUS)) / 2);
const dentFalloffSlope = (r: number): number => (r >= MUD_DENT_RADIUS ? 0 : (-Math.PI / (2 * MUD_DENT_RADIUS)) * Math.sin((Math.PI * r) / MUD_DENT_RADIUS));

/** How deep a dent pressed `age` seconds ago is, as a share of {@link MUD_DENT_DEPTH}: in fast, out slowly, then gone. */
export const mudDentDepth = (age: number): number => {
  if (!(age >= 0) || age >= MUD_DENT_REFILL_SECONDS) return 0;
  if (age < MUD_DENT_PRESS_SECONDS) return age / MUD_DENT_PRESS_SECONDS;
  const t = (age - MUD_DENT_PRESS_SECONDS) / (MUD_DENT_REFILL_SECONDS - MUD_DENT_PRESS_SECONDS);
  return 1 - t * t * (3 - 2 * t);
};

/** The cut side's colour at its top, and at its foot, where it falls into its own shadow. */
const SIDE = new THREE.Color(MUD_SIDE_COLOR);
const SIDE_FOOT = new THREE.Color(MUD_SIDE_FOOT_COLOR);

/** Frozen for `prefers-reduced-motion`: the bubbles hold still, and the mud still reads as mud. */
const REDUCED_MOTION =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** Every placed bubble spot's `simmer`, by the mass it belongs to — what {@link simmerMud} walks a scene for. */
const simmers = new WeakMap<THREE.Object3D, (tSeconds: number) => void>();

/** Shared scratch for the per-frame instance matrices. */
const scratch = { matrix: new THREE.Matrix4(), position: new THREE.Vector3(), scale: new THREE.Vector3(), rotation: new THREE.Quaternion() };

/**
 * Where a bubble spot is at `tSeconds`: the bubble's centre and radius while
 * it swells (radius 0 once it has popped), and the ring's spread and height
 * while it sinks back in (0 outside its moment). A pure function of the
 * time, exported so a test can read a pop without drawing one.
 */
export const mudBubblePose = (
  site: MudBubbleSite,
  tSeconds: number,
): { bubble: { y: number; radius: number; stretch: number }; ring: { spread: number; height: number } } => {
  const cycle = (((tSeconds / site.period + site.phase) % 1) + 1) % 1;
  const bubble = { y: site.y, radius: 0, stretch: 1 };
  const ring = { spread: 0, height: 0 };
  if (cycle < MUD_BUBBLE_SWELL) {
    const s = cycle / MUD_BUBBLE_SWELL;
    // Out of the mud and up: mostly under the surface as it starts, most of
    // a dome by the time it goes, wobbling as it fills and stretching just
    // before the pop.
    const radius = site.radius * (0.2 + 0.8 * easeOutCubic(s)) * (1 + 0.05 * Math.sin(s * Math.PI * 6));
    bubble.radius = radius;
    bubble.y = site.y + radius * (-0.6 + 0.5 * s);
    bubble.stretch = 1 + 0.18 * s ** 4;
  } else if (cycle < MUD_BUBBLE_SWELL + MUD_BUBBLE_RING) {
    const q = (cycle - MUD_BUBBLE_SWELL) / MUD_BUBBLE_RING;
    ring.spread = site.radius * (1 + (MUD_BUBBLE_RING_SPREAD - 1) * easeOutCubic(q));
    ring.height = site.radius * 0.55 * (1 - q);
  }
  return { bubble, ring };
};

/**
 * Builds `self`'s mud. `all` is every mud deck on the Track (it may include
 * `self`): an edge that runs on into one of them, moving with this one, is a
 * seam rather than a cut side, so the mud carries across it at full depth.
 */
export const buildMudMass = (self: MudDeckPlacement, all: readonly MudDeckPlacement[]): MudMass => {
  const { deck } = self;
  const coverage = mudCoverage(deck);
  const edges = mudOutline(self, all);
  const { vertices, triangles } = gridCutToRegion(deckRegion(coverage), deck.halfX, deck.halfZ);

  // One read of the field per vertex: height, slope, colour.
  const count = vertices.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const baseHeight = new Float32Array(count);
  const baseSlope = new Float32Array(count * 2);
  const heightAt = (p: Point): number => {
    const world = deckToWorld(deck, p);
    return mudHeight(world.x, world.z);
  };
  const STEP = 0.01;
  for (const [i, p] of vertices.entries()) {
    const world = deckToWorld(deck, p);
    const height = mudHeight(world.x, world.z);
    const gx = (heightAt({ x: p.x + STEP, z: p.z }) - heightAt({ x: p.x - STEP, z: p.z })) / (2 * STEP);
    const gz = (heightAt({ x: p.x, z: p.z + STEP }) - heightAt({ x: p.x, z: p.z - STEP })) / (2 * STEP);
    baseHeight[i] = height;
    baseSlope[i * 2] = gx;
    baseSlope[i * 2 + 1] = gz;
    positions.set([p.x, height, p.z], i * 3);
    const length = Math.hypot(gx, 1, gz);
    normals.set([-gx / length, 1 / length, -gz / length], i * 3);
    const colour = srgbToLinear(mudColor(world.x, world.z));
    colours.set([colour.r, colour.g, colour.b], i * 3);
  }

  const body = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const normalAttribute = new THREE.BufferAttribute(normals, 3);
  body.setAttribute("position", positionAttribute);
  body.setAttribute("normal", normalAttribute);
  body.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  const faces = triangles.map((triangle) => upFacing(vertices, triangle));
  body.setIndex(faces.flat());
  // Dents only ever lower the surface, so the rest pose bounds it for good.
  body.computeBoundingSphere();

  const group = new THREE.Group();
  group.name = "mud";
  const bodyMesh = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: MUD_BODY_ROUGHNESS, metalness: 0 }));
  bodyMesh.name = "mud-body";
  group.add(bodyMesh);

  // --- The cut side --------------------------------------------------------
  // Where the mud stops, it stops square: a wall up to the top along every
  // boundary edge of the body that lies on a free edge. Its top is the body's
  // own boundary vertices, so it meets the top exactly and follows it down
  // when a foot dents the edge; its own vertices keep their own outward
  // normals, so the edge reads as a cut and not a roll. Its foot is where the
  // bevel the mud grew out over meets the piece's side — the deck top, on a
  // piece without one — so the cut side hides the bevel and never runs down
  // the piece's own side.
  const bevel = mudBevel(deck);
  const sideFoot = bevel > 0 ? -(bevel + MUD_SEAT_LIFT) : 0;
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
  const sideTop: number[] = []; // side vertex → body vertex its top follows (-1 for a foot)
  const sidePositions: number[] = [];
  const sideNormals: number[] = [];
  const sideColours: number[] = [];
  for (const { from, to, count: uses } of edgeUses.values()) {
    if (uses !== 1) continue;
    const [a, b] = [vertices[from]!, vertices[to]!];
    if (!onFreeEdge({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 })) continue;
    // Each face is wound up-facing — a negative `cross2` in x/z — so its
    // inside lies on the −(dz, −dx) side of a boundary edge a→b: out is (−dz, dx).
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const out = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
    // Top a, foot a, foot b / top a, foot b, top b — outward-facing that way round.
    for (const [vertex, top] of [
      [from, true],
      [from, false],
      [to, false],
      [from, true],
      [to, false],
      [to, true],
    ] as const) {
      const p = vertices[vertex]!;
      sideTop.push(top ? vertex : -1);
      sidePositions.push(p.x, top ? baseHeight[vertex]! : sideFoot, p.z);
      sideNormals.push(out.x, 0, out.z);
      const colour = top ? SIDE : SIDE_FOOT;
      sideColours.push(colour.r, colour.g, colour.b);
    }
  }
  const sidePositionArray = new Float32Array(sidePositions);
  const sidePositionAttribute = new THREE.BufferAttribute(sidePositionArray, 3);
  if (sidePositions.length > 0) {
    const side = new THREE.BufferGeometry();
    side.setAttribute("position", sidePositionAttribute);
    side.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(sideNormals), 3));
    side.setAttribute("color", new THREE.BufferAttribute(new Float32Array(sideColours), 3));
    side.computeBoundingSphere();
    const sideMesh = new THREE.Mesh(side, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: MUD_BODY_ROUGHNESS + 0.2, metalness: 0 }));
    sideMesh.name = "mud-sides";
    group.add(sideMesh);
  }

  // A seam's skirt: where the mud runs on into a neighbour the two surfaces
  // meet at full depth, cut on different grids. The skirt, a shade below the
  // surface, is what a hairline between them shows instead of the deck.
  const skirt: number[] = [];
  for (const edge of edges) {
    if (edge.free) continue;
    const length = Math.hypot(edge.b.x - edge.a.x, edge.b.z - edge.a.z);
    const steps = Math.max(1, Math.ceil(length / MUD_GRID_SPACING));
    for (let k = 0; k < steps; k += 1) {
      const p = { x: edge.a.x + ((edge.b.x - edge.a.x) * k) / steps, z: edge.a.z + ((edge.b.z - edge.a.z) * k) / steps };
      const q = { x: edge.a.x + ((edge.b.x - edge.a.x) * (k + 1)) / steps, z: edge.a.z + ((edge.b.z - edge.a.z) * (k + 1)) / steps };
      const hp = Math.max(0, heightAt(p) - 0.01);
      const hq = Math.max(0, heightAt(q) - 0.01);
      // Both windings: which side faces out is the neighbour's business.
      skirt.push(p.x, hp, p.z, q.x, hq, q.z, q.x, 0, q.z, p.x, hp, p.z, q.x, 0, q.z, p.x, 0, p.z);
      skirt.push(p.x, hp, p.z, q.x, 0, q.z, q.x, hq, q.z, p.x, hp, p.z, p.x, 0, p.z, q.x, 0, q.z);
    }
  }
  if (skirt.length > 0) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(skirt), 3));
    geometry.computeVertexNormals();
    const skirtMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: MUD_SIDE_COLOR, roughness: 1, metalness: 0 }));
    skirtMesh.name = "mud-seams";
    group.add(skirtMesh);
  }

  // --- Bubbles ---------------------------------------------------------------
  // One instanced sphere per spot, and one instanced ring. Posed by `simmer`
  // from the time alone; a spot between bubbles, or a ring outside its
  // moment, is scaled to nothing.
  const sites = mudBubbleSites(coverage, edges);
  let simmer = (_tSeconds: number): void => {};
  if (sites.length > 0) {
    const bubbles = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshStandardMaterial({ color: MUD_BUBBLE_COLOR, roughness: MUD_BUBBLE_ROUGHNESS, metalness: 0 }),
      sites.length,
    );
    bubbles.name = "mud-bubbles";
    const ringGeometry = new THREE.TorusGeometry(1, 0.22, 6, 18);
    ringGeometry.rotateX(Math.PI / 2);
    const rings = new THREE.InstancedMesh(
      ringGeometry,
      new THREE.MeshStandardMaterial({ color: MUD_RING_COLOR, roughness: MUD_BODY_ROUGHNESS, metalness: 0 }),
      sites.length,
    );
    rings.name = "mud-rings";
    for (const mesh of [bubbles, rings]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Small, moving, and inside the body's own bounds: never culled on
      // their own, never casting.
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      group.add(mesh);
    }
    simmer = (tSeconds: number): void => {
      for (const [i, site] of sites.entries()) {
        const { bubble, ring } = mudBubblePose(site, tSeconds);
        scratch.position.set(site.x, bubble.y, site.z);
        scratch.scale.set(bubble.radius, bubble.radius * bubble.stretch, bubble.radius);
        bubbles.setMatrixAt(i, scratch.matrix.compose(scratch.position, scratch.rotation, scratch.scale));
        scratch.position.set(site.x, site.y - 0.01, site.z);
        scratch.scale.set(ring.spread, ring.height, ring.spread);
        rings.setMatrixAt(i, scratch.matrix.compose(scratch.position, scratch.rotation, scratch.scale));
      }
      bubbles.instanceMatrix.needsUpdate = true;
      rings.instanceMatrix.needsUpdate = true;
    };
    simmer(0);
    simmers.set(group, simmer);
  }

  // --- Wading --------------------------------------------------------------
  // Vertices bucketed a dent's width apart, so a press finds the few it moves.
  const bucketOf = (x: number, z: number): string => `${Math.floor(x / MUD_DENT_RADIUS)},${Math.floor(z / MUD_DENT_RADIUS)}`;
  const buckets = new Map<string, number[]>();
  for (const [i, p] of vertices.entries()) {
    const key = bucketOf(p.x, p.z);
    const list = buckets.get(key);
    if (list) list.push(i);
    else buckets.set(key, [i]);
  }
  const dents = Array.from({ length: MUD_DENT_POOL_SIZE }, () => ({ x: 0, z: 0, bornAt: Number.NEGATIVE_INFINITY }));
  let lastPressAt = Number.NEGATIVE_INFINITY;
  let moved = new Set<number>();
  const reach = MUD_TOP + MUD_DENT_ABOVE;

  const wade = (tSeconds: number, feet: readonly Vec3[]): void => {
    if (tSeconds - lastPressAt >= MUD_DENT_INTERVAL_SECONDS) {
      let pressed = false;
      for (const foot of feet) {
        if (foot.y > reach || !isOnDeck(coverage, foot, 0)) continue;
        const slot = dents.reduce((oldest, dent) => (dent.bornAt <= oldest.bornAt ? dent : oldest));
        slot.x = foot.x;
        slot.z = foot.z;
        slot.bornAt = tSeconds;
        pressed = true;
      }
      if (pressed) lastPressAt = tSeconds;
    }

    const live = dents
      .map((dent) => ({ dent, depth: MUD_DENT_DEPTH * mudDentDepth(tSeconds - dent.bornAt) }))
      .filter(({ depth }) => depth > 0);
    const touched = new Set<number>();
    for (const { dent } of live) {
      const bx = Math.floor(dent.x / MUD_DENT_RADIUS);
      const bz = Math.floor(dent.z / MUD_DENT_RADIUS);
      for (let i = bx - 1; i <= bx + 1; i += 1) {
        for (let j = bz - 1; j <= bz + 1; j += 1) {
          for (const v of buckets.get(`${i},${j}`) ?? []) touched.add(v);
        }
      }
    }
    if (touched.size === 0 && moved.size === 0) return;

    for (const v of new Set([...touched, ...moved])) {
      const p = vertices[v]!;
      // The deepest press over this vertex wins: a trail of overlapping
      // presses is one trough, not a stack of them.
      let deepest = 0;
      let slopeX = 0;
      let slopeZ = 0;
      for (const { dent, depth } of live) {
        const dx = p.x - dent.x;
        const dz = p.z - dent.z;
        const r = Math.hypot(dx, dz);
        const press = depth * dentFalloff(r);
        if (press <= deepest) continue;
        deepest = press;
        const slope = r > 1e-6 ? (depth * dentFalloffSlope(r)) / r : 0;
        slopeX = slope * dx;
        slopeZ = slope * dz;
      }
      const rest = baseHeight[v]!;
      const floored = rest - deepest < MUD_FLOOR;
      const height = Math.max(Math.min(rest, MUD_FLOOR), rest - deepest);
      const gx = floored ? 0 : baseSlope[v * 2]! - slopeX;
      const gz = floored ? 0 : baseSlope[v * 2 + 1]! - slopeZ;
      positions[v * 3 + 1] = height;
      const length = Math.hypot(gx, 1, gz);
      normals[v * 3] = -gx / length;
      normals[v * 3 + 1] = 1 / length;
      normals[v * 3 + 2] = -gz / length;
    }
    moved = touched;
    positionAttribute.needsUpdate = true;
    normalAttribute.needsUpdate = true;
    // The cut side's top follows the body's edge down into a dent.
    if (sideTop.length > 0) {
      for (const [i, v] of sideTop.entries()) if (v >= 0) sidePositionArray[i * 3 + 1] = positions[v * 3 + 1]!;
      sidePositionAttribute.needsUpdate = true;
    }
  };

  return { object: group, wade, simmer };
};

/**
 * Bubbles every mud mass under `root` at `tSeconds` — for a scene that holds
 * masses without keeping their handles, as the Track builder's does (it
 * rebuilds them with every edit). Frozen for `prefers-reduced-motion`, like a
 * fan's rotor.
 */
export const simmerMud = (root: THREE.Object3D, tSeconds: number): void => {
  const seconds = REDUCED_MOTION ? 0 : tSeconds;
  root.traverse((node) => simmers.get(node)?.(seconds));
};

/** Free a mass's GPU buffers — its geometry and materials are its own. */
export const disposeMudMass = (mass: MudMass): void => {
  mass.object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    (node.material as THREE.Material).dispose();
  });
};
