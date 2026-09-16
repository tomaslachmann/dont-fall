/**
 * Solid collision parts for Assets (ADR 0065, `docs/research/moving-obstacle-collision-shapes.md`).
 *
 * A collision trimesh is a hollow shell: on a moving kinematic body it traps
 * whatever gets inside it (measured: a ragdoll carried inside `trap_trapball`'s
 * ball for a whole swing). So at build time every Asset also gets *solid*
 * parts — fitted primitives, convex hulls, or a convex decomposition — stored as
 * mesh-less `role: "solid"` nodes that the shared reader and both simulations
 * rebuild verbatim. Nothing is fitted at runtime, so client and server can never
 * disagree.
 *
 * Per collision mesh: weld, split into connected components, gather the small
 * ones (chain links, spikes) into one group, then per component or group try —
 * in order — a ball, a cylinder or capsule along each principal axis, and an
 * oriented box, accepting a primitive only when its volume matches the part's
 * convex hull within a tolerance; otherwise one convex hull, or a V-HACD
 * decomposition when a closed part is clearly concave (a hoop, a pipe, a
 * platform with a hole) so its hole stays open.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";
import type { SolidShape } from "../packages/shared/src/track/asset.js";
import { readAssetModel } from "../packages/shared/src/track/asset.js";
import type { Gltf } from "./convert-lib.js";
import { writeGlb } from "./convert-lib.js";

await RAPIER.init();

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

export interface SolidPartSpec {
  shape: SolidShape;
  position: Vec3;
  rotation: Quat;
}

/** A primitive is accepted when the part's hull fills at least this much of it. */
export const PRIMITIVE_FILL_MIN = 0.88;
/**
 * A closed part whose mesh fills less of its hull than this is concave enough
 * that one hull (or a primitive fitted to it) would close a hole a Character
 * should pass through — measured: `platform_hole` 0.87, pipes 0.29–0.37, a hoop
 * 0.33, while bevelled platforms, slopes and balls sit at 1.00 and a barrier's
 * shallow groove at 0.91 (closing that loses nothing).
 */
export const CONCAVE_FILL_MAX = 0.9;
/** A component smaller than this share of its mesh's diagonal is "small" and gathered with the others. */
export const SMALL_COMPONENT_SHARE = 0.15;
/** Hull points are rounded to this many decimals when stored. */
const DECIMALS = 4;

const round = (n: number): number => Number(n.toFixed(DECIMALS)) || 0;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

interface Component {
  points: Vec3[];
  /** Triangles over `points` (welded indices); empty for a gathered group. */
  triangles: [number, number, number][];
}

/** Weld by position and split a triangle mesh into connected components. */
export const splitComponents = (positions: Vec3[], indices: number[]): Component[] => {
  const weld = new Map<string, number>();
  const welded: Vec3[] = [];
  const idOf = (p: Vec3): number => {
    const key = `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`;
    let id = weld.get(key);
    if (id === undefined) {
      id = welded.length;
      weld.set(key, id);
      welded.push(p);
    }
    return id;
  };
  const tris: [number, number, number][] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    tris.push([idOf(positions[indices[t]!]!), idOf(positions[indices[t + 1]!]!), idOf(positions[indices[t + 2]!]!)]);
  }
  const parent = welded.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (const [a, b, c] of tris) {
    parent[find(b)] = find(a);
    parent[find(c)] = find(a);
  }
  const byRoot = new Map<number, { ids: Map<number, number>; points: Vec3[]; triangles: [number, number, number][] }>();
  const componentOf = (root: number) => {
    let component = byRoot.get(root);
    if (!component) byRoot.set(root, (component = { ids: new Map(), points: [], triangles: [] }));
    return component;
  };
  const local = (component: { ids: Map<number, number>; points: Vec3[] }, id: number): number => {
    let index = component.ids.get(id);
    if (index === undefined) {
      index = component.points.length;
      component.ids.set(id, index);
      component.points.push(welded[id]!);
    }
    return index;
  };
  for (const [a, b, c] of tris) {
    const component = componentOf(find(a));
    component.triangles.push([local(component, a), local(component, b), local(component, c)]);
  }
  return [...byRoot.values()].map(({ points, triangles }) => ({ points, triangles }));
};

const diagonal = (points: Vec3[]): number => {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of points) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
    max.z = Math.max(max.z, p.z);
  }
  return length(sub(max, min));
};

/** A convex hull's own vertices and volume (three's QuickHull). */
export const convexHullOf = (points: Vec3[]): { vertices: Vec3[]; volume: number } => {
  const hull = new ConvexHull().setFromPoints(points.map((p) => new Vector3(p.x, p.y, p.z)));
  const vertices = new Map<string, Vec3>();
  let volume = 0;
  for (const face of hull.faces) {
    const loop: Vec3[] = [];
    let edge = face.edge;
    do {
      const p = edge.head().point;
      loop.push({ x: p.x, y: p.y, z: p.z });
      edge = edge.next;
    } while (edge !== face.edge);
    for (const v of loop) vertices.set(`${v.x},${v.y},${v.z}`, v);
    // Fan the face against the origin: signed tetra volumes sum to the hull's volume.
    for (let i = 1; i + 1 < loop.length; i += 1) {
      const a = loop[0]!;
      const b = loop[i]!;
      const c = loop[i + 1]!;
      volume += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6;
    }
  }
  return { vertices: [...vertices.values()], volume: Math.abs(volume) };
};

/** Volume enclosed by a closed triangle set, or `undefined` when it has open edges. */
export const closedVolume = (component: Component): number | undefined => {
  if (component.triangles.length === 0) return undefined;
  const edges = new Map<string, number>();
  let volume = 0;
  for (const [ia, ib, ic] of component.triangles) {
    for (const [u, v] of [
      [ia, ib],
      [ib, ic],
      [ic, ia],
    ] as const) {
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    const a = component.points[ia]!;
    const b = component.points[ib]!;
    const c = component.points[ic]!;
    volume += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6;
  }
  for (const count of edges.values()) if (count < 2) return undefined;
  return Math.abs(volume);
};

/**
 * How much of its hull a closed part fills (0–1), or `undefined` when that
 * can't be trusted: open meshes, and self-intersecting "closed" ones whose
 * overlapping shells count twice (`trap_trapball`'s chain reads 9.9).
 */
const fillOf = (component: Component, hullVolume: number): number | undefined => {
  const enclosed = closedVolume(component);
  if (enclosed === undefined) return undefined;
  const fill = enclosed / hullVolume;
  return fill > 1.02 ? undefined : fill;
};

/** Principal axes of a point cloud (Jacobi eigen-decomposition of its covariance), strongest first. */
export const principalAxes = (points: Vec3[]): Vec3[] => {
  const n = points.length;
  const mean = scale(points.reduce(add, { x: 0, y: 0, z: 0 }), 1 / n);
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const d = sub(p, mean);
    const v = [d.x, d.y, d.z];
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) c[i * 3 + j]! += (v[i]! * v[j]!) / n;
  }
  const a = [...c];
  const e = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 50; sweep += 1) {
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      const apq = a[p * 3 + q]!;
      if (Math.abs(apq) < 1e-12) continue;
      const theta = (a[q * 3 + q]! - a[p * 3 + p]!) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cos = 1 / Math.sqrt(t * t + 1);
      const sin = t * cos;
      for (let k = 0; k < 3; k += 1) {
        const akp = a[k * 3 + p]!;
        const akq = a[k * 3 + q]!;
        a[k * 3 + p] = cos * akp - sin * akq;
        a[k * 3 + q] = sin * akp + cos * akq;
      }
      for (let k = 0; k < 3; k += 1) {
        const apk = a[p * 3 + k]!;
        const aqk = a[q * 3 + k]!;
        a[p * 3 + k] = cos * apk - sin * aqk;
        a[q * 3 + k] = sin * apk + cos * aqk;
      }
      for (let k = 0; k < 3; k += 1) {
        const ekp = e[k * 3 + p]!;
        const ekq = e[k * 3 + q]!;
        e[k * 3 + p] = cos * ekp - sin * ekq;
        e[k * 3 + q] = sin * ekp + cos * ekq;
      }
    }
  }
  return [0, 1, 2]
    .map((i) => ({ value: a[i * 3 + i]!, axis: { x: e[0 * 3 + i]!, y: e[1 * 3 + i]!, z: e[2 * 3 + i]! } }))
    .sort((l, r) => r.value - l.value)
    .map(({ axis }) => scale(axis, 1 / (length(axis) || 1)));
};

/** The rotation taking local Y onto `axis` (and local X onto `side`, when given). */
const rotationFromAxes = (xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Quat => {
  const m00 = xAxis.x;
  const m10 = xAxis.y;
  const m20 = xAxis.z;
  const m01 = yAxis.x;
  const m11 = yAxis.y;
  const m21 = yAxis.z;
  const m02 = zAxis.x;
  const m12 = zAxis.y;
  const m22 = zAxis.z;
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = { w: 0.25 / s, x: (m21 - m12) * s, y: (m02 - m20) * s, z: (m10 - m01) * s };
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m10 + m01) / s, z: (m02 + m20) / s };
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 - m00 + m11 - m22);
    q = { w: (m02 - m20) / s, x: (m10 + m01) / s, y: 0.25 * s, z: (m21 + m12) / s };
  } else {
    const s = 2 * Math.sqrt(1 - m00 - m11 + m22);
    q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m21 + m12) / s, z: 0.25 * s };
  }
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: round(q.x / n), y: round(q.y / n), z: round(q.z / n), w: round(q.w / n) };
};

const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** The best-fitting primitive for a convex point set, or `undefined` if none fills well enough. */
export const fitPrimitive = (hull: { vertices: Vec3[]; volume: number }): SolidPartSpec | undefined => {
  const points = hull.vertices;
  if (points.length < 4 || hull.volume <= 0) return undefined;
  const candidates: { spec: SolidPartSpec; volume: number }[] = [];
  const axes = principalAxes(points);

  // Ball: about the extent's centre.
  {
    const lo = { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)), z: Math.min(...points.map((p) => p.z)) };
    const hi = { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)), z: Math.max(...points.map((p) => p.z)) };
    const centre = scale(add(lo, hi), 0.5);
    const radius = Math.max(...points.map((p) => length(sub(p, centre))));
    candidates.push({
      spec: { shape: { type: "ball", radius: round(radius) }, position: roundVec(centre), rotation: IDENTITY },
      volume: (4 / 3) * Math.PI * radius ** 3,
    });
  }

  // Cylinder / capsule along each principal axis, and the oriented box.
  const spans = axes.map((axis) => {
    const t = points.map((p) => dot(p, axis));
    return { axis, min: Math.min(...t), max: Math.max(...t) };
  });
  for (let i = 0; i < 3; i += 1) {
    const { axis, min, max } = spans[i]!;
    const others = spans.filter((_, j) => j !== i);
    const mid = (min + max) / 2;
    const centreAcross = others.reduce((acc, s) => add(acc, scale(s.axis, (s.min + s.max) / 2)), { x: 0, y: 0, z: 0 });
    const centre = add(centreAcross, scale(axis, mid));
    const radius = Math.max(...points.map((p) => length(sub(sub(p, centre), scale(axis, dot(sub(p, centre), axis))))));
    const half = (max - min) / 2;
    const side = others[0]!.axis;
    const rotation = rotationFromAxes(side, axis, cross(side, axis));
    candidates.push({
      spec: { shape: { type: "cylinder", halfHeight: round(half), radius: round(radius) }, position: roundVec(centre), rotation },
      volume: Math.PI * radius * radius * 2 * half,
    });
    // A capsule shorter than its caps is a ball (the ball candidate above covers it).
    if (half - radius > 0.02 * radius) {
      candidates.push({
        spec: { shape: { type: "capsule", halfHeight: round(half - radius), radius: round(radius) }, position: roundVec(centre), rotation },
        volume: Math.PI * radius * radius * 2 * (half - radius) + (4 / 3) * Math.PI * radius ** 3,
      });
    }
  }
  {
    const [a, b, c] = spans as [(typeof spans)[0], (typeof spans)[0], (typeof spans)[0]];
    const centre = add(add(scale(a.axis, (a.min + a.max) / 2), scale(b.axis, (b.min + b.max) / 2)), scale(c.axis, (c.min + c.max) / 2));
    const h = { x: (a.max - a.min) / 2, y: (b.max - b.min) / 2, z: (c.max - c.min) / 2 };
    if (h.x > 1e-4 && h.y > 1e-4 && h.z > 1e-4) {
      candidates.push({
        spec: {
          shape: { type: "box", halfExtents: roundVec(h) },
          position: roundVec(centre),
          rotation: rotationFromAxes(a.axis, b.axis, cross(a.axis, b.axis)),
        },
        volume: 8 * h.x * h.y * h.z,
      });
    }
  }

  // Tightest first; on a tie the earlier (simpler) candidate — the ball — wins.
  const best = candidates
    .map((candidate, order) => ({ ...candidate, order }))
    .filter((candidate) => candidate.volume > 0 && hull.volume / candidate.volume >= PRIMITIVE_FILL_MIN)
    .sort((l, r) => (Math.abs(l.volume - r.volume) < 1e-9 * r.volume ? l.order - r.order : l.volume - r.volume))[0];
  return best?.spec;
};

const roundVec = (v: Vec3): Vec3 => ({ x: round(v.x), y: round(v.y), z: round(v.z) });

const hullPart = (vertices: Vec3[]): SolidPartSpec => ({
  shape: { type: "hull", points: vertices.map(roundVec) },
  position: { x: 0, y: 0, z: 0 },
  rotation: IDENTITY,
});

/** V-HACD through Rapier (the same library both simulations run), each part reduced to its hull vertices. */
const decompose = (component: Component): SolidPartSpec[] | undefined => {
  const vertices = new Float32Array(component.points.flatMap((p) => [p.x, p.y, p.z]));
  const indices = new Uint32Array(component.triangles.flat());
  const desc = RAPIER.ColliderDesc.convexDecomposition(vertices, indices, { maxConvexHulls: 16, resolution: 64 });
  if (!desc) return undefined;
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  try {
    const compound = world.createCollider(desc).shape as unknown as {
      shapes: { vertices: Float32Array }[];
      positions: Vec3[];
      rotations: Quat[];
    };
    const parts: SolidPartSpec[] = [];
    compound.shapes.forEach((shape, i) => {
      const at = compound.positions[i] ?? { x: 0, y: 0, z: 0 };
      const q = compound.rotations[i] ?? IDENTITY;
      const points: Vec3[] = [];
      for (let v = 0; v + 2 < shape.vertices.length; v += 3) {
        const p = { x: shape.vertices[v]!, y: shape.vertices[v + 1]!, z: shape.vertices[v + 2]! };
        // Rotate by q, then translate — each sub-shape sits at its own place in the compound.
        const u = { x: q.x, y: q.y, z: q.z };
        const t = scale(cross(u, p), 2);
        points.push(add(add(add(p, scale(t, q.w)), cross(u, t)), at));
      }
      const hull = convexHullOf(points);
      if (hull.vertices.length >= 4 && hull.volume > 1e-9) parts.push(hullPart(hull.vertices));
    });
    return parts.length > 0 ? parts : undefined;
  } finally {
    world.free();
  }
};

/** Solid parts for one collision mesh. `decomposeConcave` false forces a single hull per concave part. */
export const solidPartsFor = (positions: Vec3[], indices: number[], decomposeConcave = true): SolidPartSpec[] => {
  const components = splitComponents(positions, indices);
  if (components.length === 0) return [];
  const meshDiagonal = diagonal(components.flatMap((c) => c.points));
  const small = components.filter((c) => diagonal(c.points) < SMALL_COMPONENT_SHARE * meshDiagonal);
  // Several small pieces (chain links, spikes) collide as one group; a lone small piece stays itself.
  const groups: Component[] =
    small.length >= 3
      ? [...components.filter((c) => !small.includes(c)), { points: small.flatMap((c) => c.points), triangles: [] }]
      : components;

  const parts: SolidPartSpec[] = [];
  for (const component of groups) {
    const hull = convexHullOf(component.points);
    if (hull.vertices.length < 4 || hull.volume <= 1e-9) continue;
    // Concavity first: a primitive fitted to a hoop's hull is a solid disc.
    const fill = fillOf(component, hull.volume);
    if (fill !== undefined && fill < CONCAVE_FILL_MAX) {
      const pieces = decomposeConcave ? decompose(component) : undefined;
      parts.push(...(pieces ?? [hullPart(hull.vertices)]));
      continue;
    }
    parts.push(fitPrimitive(hull) ?? hullPart(hull.vertices));
  }
  return parts;
};

/**
 * Add `role: "solid"` nodes for every collision mesh of a converted file (its
 * final, seated frame) — run after `seatOnPivot`. Returns the parts, for the
 * converter's log.
 */
export const addSolidNodes = (json: Gltf, bin: Buffer): SolidPartSpec[] => {
  const model = readAssetModel(new Uint8Array(writeGlb(json, bin)));
  const parts = model.collision.flatMap((mesh) => solidPartsFor(mesh.positions, mesh.indices));
  const nodes = (json.nodes ??= []);
  const scene = json.scenes?.[0];
  if (!scene) throw new Error("addSolidNodes: no scene");
  parts.forEach((part, i) => {
    const shape =
      part.shape.type === "hull"
        ? { type: "hull", points: part.shape.points.flatMap((p) => [p.x, p.y, p.z]) }
        : part.shape.type === "box"
          ? { type: "box", halfExtents: [part.shape.halfExtents.x, part.shape.halfExtents.y, part.shape.halfExtents.z] }
          : part.shape;
    const node: Record<string, unknown> = { name: `solid_${i}_${part.shape.type}`, extras: { role: "solid", shape } };
    if (part.position.x !== 0 || part.position.y !== 0 || part.position.z !== 0) {
      node.translation = [part.position.x, part.position.y, part.position.z];
    }
    if (part.rotation.w !== 1) node.rotation = [part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w];
    scene.nodes = [...(scene.nodes ?? []), nodes.length];
    nodes.push(node);
  });
  return parts;
};

/** One short line per Asset for the converter's log: `ball r1.16 · cylinder r0.08 h2.6 · hull×3`. */
export const describeParts = (parts: SolidPartSpec[]): string => {
  const hulls = parts.filter((p) => p.shape.type === "hull").length;
  const primitives = parts
    .filter((p) => p.shape.type !== "hull")
    .map((p) => {
      const s = p.shape;
      if (s.type === "ball") return `ball r${s.radius}`;
      if (s.type === "box") return `box ${s.halfExtents.x}×${s.halfExtents.y}×${s.halfExtents.z}`;
      if (s.type === "capsule" || s.type === "cylinder") return `${s.type} r${s.radius} h${s.halfHeight}`;
      return s.type;
    });
  return [...primitives, ...(hulls > 0 ? [`hull×${hulls}`] : [])].join(" · ");
};
