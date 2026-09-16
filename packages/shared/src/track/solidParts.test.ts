import RAPIER from "@dimforge/rapier3d-compat";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics } from "../simulation/RapierSimulation.js";
import type { Quat } from "../math/quat.js";
import { readAssetModel, type SolidPart, type SolidShape } from "./asset.js";
import { ASSET_MODULE_DEFS, assetFileName } from "./assetModules.js";

// The build-time fitter lives in `scripts/`, outside this package's sources:
// imported by a computed path so the package's typecheck stays inside `src`.
type Spec = { shape: SolidShape; position: V; rotation: Quat };
type Hull = { vertices: V[]; volume: number };
const FITTER = "../../../../scripts/convert-solids.js";
const { convexHullOf, fitPrimitive, solidPartsFor } = (await import(/* @vite-ignore */ FITTER)) as {
  convexHullOf: (points: V[]) => Hull;
  fitPrimitive: (hull: Hull) => Spec | undefined;
  solidPartsFor: (positions: V[], indices: number[], decomposeConcave?: boolean) => Spec[];
};

beforeAll(async () => {
  await initPhysics();
});

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
const modelOf = (id: string) => readAssetModel(new Uint8Array(readFileSync(join(assetsRoot, assetFileName(id)))));

type V = { x: number; y: number; z: number };

/** A closed, outward-wound mesh from a parametric surface (u, v) → point, wrapped in both directions. */
const wrappedMesh = (rows: number, cols: number, at: (u: number, v: number) => V, capPoles = false) => {
  const positions: V[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rows; r += 1) for (let c = 0; c < cols; c += 1) positions.push(at(r / rows, c / cols));
  const id = (r: number, c: number) => r * cols + (c % cols);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) indices.push(id(r, c), id(r, c + 1), id(r + 1, c), id(r, c + 1), id(r + 1, c + 1), id(r + 1, c));
  }
  void capPoles;
  return { positions, indices };
};
const sphere = (radius: number) =>
  wrappedMesh(16, 24, (u, v) => ({
    x: radius * Math.sin(u * Math.PI) * Math.cos(v * 2 * Math.PI),
    y: radius * Math.cos(u * Math.PI),
    z: radius * Math.sin(u * Math.PI) * Math.sin(v * 2 * Math.PI),
  }));
const torus = (major: number, minor: number) => {
  const positions: V[] = [];
  const indices: number[] = [];
  const rings = 32;
  const sides = 12;
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < sides; j += 1) {
      const u = (i / rings) * 2 * Math.PI;
      const v = (j / sides) * 2 * Math.PI;
      positions.push({ x: (major + minor * Math.cos(v)) * Math.cos(u), y: minor * Math.sin(v), z: (major + minor * Math.cos(v)) * Math.sin(u) });
    }
  }
  const id = (i: number, j: number) => (i % rings) * sides + (j % sides);
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < sides; j += 1) indices.push(id(i, j), id(i + 1, j), id(i, j + 1), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1));
  }
  return { positions, indices };
};

describe("fitting solid parts (scripts/convert-solids.ts, ADR 0065)", () => {
  it("fits a ball to a sphere", () => {
    const { positions, indices } = sphere(1.2);
    const parts = solidPartsFor(positions, indices);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.shape.type).toBe("ball");
    expect((parts[0]!.shape as { radius: number }).radius).toBeCloseTo(1.2, 1);
  });

  it("fits a box to a box's corners and a capsule to a long rounded rod", () => {
    const corners: V[] = [];
    for (const x of [-2, 2]) for (const y of [-0.25, 0.25]) for (const z of [-1, 1]) corners.push({ x, y, z });
    expect(fitPrimitive(convexHullOf(corners))!.shape).toEqual({ type: "box", halfExtents: { x: 2, y: 1, z: 0.25 } });

    const rod: V[] = [];
    for (let k = 0; k <= 40; k += 1) {
      const t = k / 40;
      // A capsule: radius 0.3, straight part from y = -1 to y = 1, hemispherical caps.
      for (let a = 0; a < 12; a += 1) {
        const angle = (a / 12) * 2 * Math.PI;
        const y = -1.3 + 2.6 * t;
        const cap = Math.max(0, Math.abs(y) - 1);
        const r = Math.sqrt(Math.max(0, 0.09 - cap * cap));
        rod.push({ x: r * Math.cos(angle), y, z: r * Math.sin(angle) });
      }
    }
    expect(fitPrimitive(convexHullOf(rod))!.shape.type).toBe("capsule");
  });

  it("decomposes a hoop rather than closing its hole", () => {
    const { positions, indices } = torus(1.5, 0.2);
    const parts = solidPartsFor(positions, indices);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.shape.type === "hull")).toBe(true);
    // The centre of the hole is inside none of the parts: a Character still fits through.
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const inside = parts.some((part) => {
      const points = (part.shape as { points: V[] }).points.flatMap((p) => [p.x, p.y, p.z]);
      const collider = world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(points))!);
      return collider.containsPoint({ x: 0, y: 0, z: 0 });
    });
    world.free();
    expect(inside).toBe(false);
  });
});

/** Distance from `point` to the nearest of `parts` (0 inside), through the same Rapier shapes the simulation builds. */
const distanceToParts = (world: RAPIER.World, colliders: RAPIER.Collider[], point: V): number =>
  Math.min(...colliders.map((collider) => {
    const projection = collider.projectPoint(point, true)!;
    return projection.isInside ? 0 : Math.hypot(projection.point.x - point.x, projection.point.y - point.y, projection.point.z - point.z);
  }));

const collidersFor = (world: RAPIER.World, parts: SolidPart[]): RAPIER.Collider[] =>
  parts.map((part) => {
    const s = part.shape;
    const desc =
      s.type === "ball" ? RAPIER.ColliderDesc.ball(s.radius)
      : s.type === "capsule" ? RAPIER.ColliderDesc.capsule(s.halfHeight, s.radius)
      : s.type === "cylinder" ? RAPIER.ColliderDesc.cylinder(s.halfHeight, s.radius)
      : s.type === "box" ? RAPIER.ColliderDesc.cuboid(s.halfExtents.x, s.halfExtents.y, s.halfExtents.z)
      : RAPIER.ColliderDesc.convexHull(new Float32Array(s.points.flatMap((p) => [p.x, p.y, p.z])))!;
    return world.createCollider(desc.setTranslation(part.position.x, part.position.y, part.position.z).setRotation(part.rotation));
  });

describe("every committed Asset's solid parts (ADR 0065)", () => {
  it("gives trap_trapball a ball for its ball and a capsule for its chain", () => {
    const types = modelOf("trap_trapball").solid.map((part) => part.shape.type).sort();
    expect(types).toEqual(["ball", "capsule"]);
  });

  it("has solid parts on every Asset, and they cover its collision mesh", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const misses: string[] = [];
    for (const def of ASSET_MODULE_DEFS) {
      const model = modelOf(def.id);
      expect(model.solid.length, `${def.id} has no solid parts`).toBeGreaterThan(0);
      const colliders = collidersFor(world, model.solid);
      const h = def.footprint.bounds.halfExtents;
      const tolerance = 0.1 * Math.hypot(h.x, h.y, h.z) * 2;
      for (const mesh of model.collision) {
        const step = Math.max(1, Math.floor(mesh.positions.length / 40));
        for (let i = 0; i < mesh.positions.length; i += step) {
          const distance = distanceToParts(world, colliders, mesh.positions[i]!);
          if (distance > tolerance) {
            misses.push(`${def.id}: vertex ${i} is ${distance.toFixed(3)} from its solid parts (tolerance ${tolerance.toFixed(3)})`);
            break;
          }
        }
      }
      for (const collider of colliders) world.removeCollider(collider, false);
    }
    world.free();
    expect(misses).toEqual([]);
  });
});
