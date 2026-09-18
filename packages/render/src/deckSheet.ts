import * as THREE from "three";
import type { DeckPlan } from "@dont-fall/shared";

/**
 * Geometry for a Surface sheet cut to a deck's own shape (ADR 0096), shared by
 * the game and the Track builder so a round deck wears the same round sheet in
 * both.
 *
 * A `DeckPlan` is already in the deck's frame — flat, centred on the deck's
 * own centre, scaled — so these build straight from it and the caller seats
 * the result exactly as it seated the rectangle it replaces. UVs mirror
 * `THREE.PlaneGeometry`'s over the footprint rectangle, so a sheet texture's
 * `repeat` keeps the texel density it had.
 */

const planUvs = (plan: DeckPlan, halfX: number, halfZ: number): Float32Array => {
  const uvs = new Float32Array(plan.vertices.length * 2);
  for (const [i, v] of plan.vertices.entries()) {
    uvs[i * 2] = halfX === 0 ? 0.5 : v.x / (2 * halfX) + 0.5;
    uvs[i * 2 + 1] = halfZ === 0 ? 0.5 : 0.5 - v.z / (2 * halfZ);
  }
  return uvs;
};

/** A flat sheet lying in the deck's plane at y = 0 — ice, and the bounce sheet's rest lattice. */
export const deckSheetGeometry = (plan: DeckPlan, halfX: number, halfZ: number): THREE.BufferGeometry => {
  const positions = new Float32Array(plan.vertices.length * 3);
  const normals = new Float32Array(plan.vertices.length * 3);
  for (const [i, v] of plan.vertices.entries()) {
    positions[i * 3] = v.x;
    positions[i * 3 + 2] = v.z;
    normals[i * 3 + 1] = 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(planUvs(plan, halfX, halfZ), 2));
  geometry.setIndex([...plan.indices]);
  return geometry;
};

/** Undirected edges used by exactly one triangle — the outline of the plan, holes included. */
export const deckPlanOutline = (plan: DeckPlan): [number, number][] => {
  const counts = new Map<string, { a: number; b: number; count: number }>();
  for (let t = 0; t + 2 < plan.indices.length; t += 3) {
    const tri = [plan.indices[t]!, plan.indices[t + 1]!, plan.indices[t + 2]!];
    for (let e = 0; e < 3; e += 1) {
      const a = tri[e]!;
      const b = tri[(e + 1) % 3]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const found = counts.get(key);
      if (found) found.count += 1;
      else counts.set(key, { a, b, count: 1 });
    }
  }
  return [...counts.values()].filter((edge) => edge.count === 1).map((edge) => [edge.a, edge.b] as [number, number]);
};

/**
 * The footprint rectangle a deck falls back to when it has no plan — a flat
 * XZ quad centred on the origin, where the plane's own height becomes depth.
 * `segments` subdivides it, for a sheet whose shape lives in its vertices.
 */
export const deckRectGeometry = (width: number, depth: number, segments = 1): THREE.BufferGeometry => {
  const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
};
