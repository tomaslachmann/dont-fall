import type { Module } from "./Module.js";

/**
 * The shape of a deck's walking surface, seen from above (ADR 0096) — what an
 * ice, mud or bounce sheet is cut to.
 *
 * Every sheet used to be a rectangle the size of the Module's footprint, which
 * is right for a platform and wrong for everything else: a round piece wore a
 * square of ice, overhanging its own rim on four corners. So the plan is read
 * off the Asset's own collision instead — the triangles that make up its top
 * face, projected flat.
 *
 * Coordinates are in the deck's own frame: relative to the `DeckFrame`'s
 * centre, in the Module's unrotated x/z, already scaled. A renderer builds the
 * geometry from these and then seats it with the same deck transform it used
 * for the rectangle.
 */
export interface DeckPlan {
  vertices: { x: number; z: number }[];
  /** Triangles, three indices into {@link vertices} each, in the Asset's own up-facing winding. */
  indices: number[];
}

/**
 * How far below the collision's highest point a triangle may sit and still
 * count as part of the top face. Generous enough for a authored bevel's float
 * error, tight enough that the face below a lip is not swept in.
 */
const DECK_TOP_EPSILON = 0.02;

/**
 * Under this share of the footprint rectangle a plan is not believed and the
 * rectangle is kept. A ramp Asset is why: its highest point is one edge, so
 * "the triangles at the top" is a sliver rather than the surface you walk on.
 */
const DECK_PLAN_MIN_COVERAGE = 0.1;

/** At or above this share, the top face *is* the rectangle and there is nothing to cut. */
const DECK_PLAN_MAX_COVERAGE = 0.99;

/**
 * The plan of `module`'s deck at `scale`, or `undefined` to keep the footprint
 * rectangle — for a procedural Module (no Asset collision to read), for a
 * shape whose top face already fills its footprint, and for one whose top face
 * is too small a part of it to be the surface anyone walks on.
 */
export const deckPlanOf = (module: Module, scale = 1): DeckPlan | undefined => {
  const meshes = module.asset?.meshes ?? [];
  if (meshes.length === 0) return undefined;
  let top = -Infinity;
  for (const mesh of meshes) {
    for (const p of mesh.positions) top = Math.max(top, p.y);
  }
  if (!Number.isFinite(top)) return undefined;

  const { center, halfExtents } = module.footprint.bounds;
  const vertices: { x: number; z: number }[] = [];
  const indices: number[] = [];
  const seen = new Map<string, number>();
  const vertex = (p: { x: number; z: number }): number => {
    const x = (p.x - center.x) * scale;
    const z = (p.z - center.z) * scale;
    const key = `${x.toFixed(4)},${z.toFixed(4)}`;
    const found = seen.get(key);
    if (found !== undefined) return found;
    seen.set(key, vertices.length);
    vertices.push({ x, z });
    return vertices.length - 1;
  };

  let area = 0;
  for (const mesh of meshes) {
    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
      const a = mesh.positions[mesh.indices[i]!]!;
      const b = mesh.positions[mesh.indices[i + 1]!]!;
      const c = mesh.positions[mesh.indices[i + 2]!]!;
      // The whole triangle has to lie on the top face: one vertex up there is
      // the edge of a bevel, not the surface.
      if (a.y < top - DECK_TOP_EPSILON || b.y < top - DECK_TOP_EPSILON || c.y < top - DECK_TOP_EPSILON) continue;
      // The face normal's own Y: up-facing is what gets walked on, and a
      // downward face at the same height is the underside of something.
      const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      if (normalY <= 0) continue;
      area += normalY / 2;
      // The Asset's own winding, kept: the triangle already faces up in the
      // file's handedness, and the renderers build their geometry in it.
      indices.push(vertex(a), vertex(b), vertex(c));
    }
  }

  if (indices.length === 0) return undefined;
  const rectangle = 4 * halfExtents.x * halfExtents.z;
  if (rectangle <= 0) return undefined;
  const coverage = area / rectangle;
  if (coverage < DECK_PLAN_MIN_COVERAGE || coverage > DECK_PLAN_MAX_COVERAGE) return undefined;
  return { vertices, indices };
};

/**
 * `plan` with every triangle split into four, `levels` times over — for a
 * sheet whose shape is carried by moving its vertices (the bounce sheet's
 * dome and the dents in it), which needs more of them than a collision mesh
 * has.
 */
const subdivideDeckPlan = (plan: DeckPlan, levels: number): DeckPlan => {
  let current = plan;
  for (let level = 0; level < levels; level += 1) {
    const vertices = current.vertices.map((v) => ({ ...v }));
    const indices: number[] = [];
    const middles = new Map<string, number>();
    const middle = (i: number, j: number): number => {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      const found = middles.get(key);
      if (found !== undefined) return found;
      const a = vertices[i]!;
      const b = vertices[j]!;
      middles.set(key, vertices.length);
      vertices.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
      return vertices.length - 1;
    };
    for (let t = 0; t + 2 < current.indices.length; t += 3) {
      const [a, b, c] = [current.indices[t]!, current.indices[t + 1]!, current.indices[t + 2]!];
      const [ab, bc, ca] = [middle(a, b), middle(b, c), middle(c, a)];
      indices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    current = { vertices, indices };
  }
  return current;
};

/** How many triangles a sheet whose shape is carried by its vertices wants, whatever its plan started with. */
const DECK_PLAN_SMOOTH_TRIANGLES = 400;
/** Past this the vertex count grows faster than the smoothness shows. */
const DECK_PLAN_MAX_SUBDIVISION = 4;

/**
 * `plan` subdivided until it has at least {@link DECK_PLAN_SMOOTH_TRIANGLES}
 * triangles — a collision mesh's two-triangle top and a round piece's
 * forty-eight both need to end up dense enough to dome and to dent.
 */
export const smoothDeckPlan = (plan: DeckPlan): DeckPlan => {
  const triangles = plan.indices.length / 3;
  if (triangles <= 0) return plan;
  const levels = Math.min(DECK_PLAN_MAX_SUBDIVISION, Math.max(0, Math.ceil(Math.log(DECK_PLAN_SMOOTH_TRIANGLES / triangles) / Math.log(4))));
  return subdivideDeckPlan(plan, levels);
};
