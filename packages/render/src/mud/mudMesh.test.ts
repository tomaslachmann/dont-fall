import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  ASSET_MODULE_DEFS,
  AUTHORED_TRACKS,
  IDENTITY_QUAT,
  loadAssetLibrary,
  resolveTrack,
  type DeckFrame,
  type SegmentMotion,
} from "@dont-fall/shared";
import { MUD_BUBBLE_INSET, MUD_BUBBLE_SWELL, MUD_DENT_DEPTH, MUD_DENT_REFILL_SECONDS, MUD_DEPTH, MUD_SEAT_LIFT } from "./mudLook.js";
import { buildMudMass, mudBubblePose, simmerMud } from "./mudMesh.js";
import { deckToWorld, isOnDeck, motionCarry, mudBubbleSites, mudOutline, nearestFreeEdge, type MudDeckPlacement } from "./mudShape.js";

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");

const rect = (x: number, z: number, half = 2, y = 0, halfX = half): MudDeckPlacement => ({
  deck: { center: { x, y, z }, yaw: 0, orientation: IDENTITY_QUAT, halfX, halfZ: half } satisfies DeckFrame,
});

/** A turn about the vertical line through `pivot`, in the Segment's own frame. */
const spin = (speed: number, pivot = { x: 0, y: 0, z: 0 }): SegmentMotion => ({ spin: { axis: { x: 0, y: 1, z: 0 }, pivot, speed } });

const bodyOf = (mass: { object: THREE.Group }, name = "mud-body"): THREE.Mesh => mass.object.getObjectByName(name) as THREE.Mesh;

const points = (mesh: THREE.Mesh): THREE.Vector3[] => {
  const position = mesh.geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i));
};

describe("mud (ADR 0103)", () => {
  it("is cut square at a free edge — full depth right to it, and a side from the deck up to the top — and heaped into clods everywhere", () => {
    const deck = rect(0, 0, 8);
    const mass = buildMudMass(deck, [deck]);
    const body = points(bodyOf(mass));
    const onRim = (p: THREE.Vector3): boolean => Math.abs(Math.abs(p.x) - 8) < 1e-6 || Math.abs(Math.abs(p.z) - 8) < 1e-6;

    // No roll-off: the body stands as tall at its edge as anywhere.
    const onEdge = body.filter(onRim);
    expect(onEdge.length).toBeGreaterThan(0);
    for (const p of onEdge) expect(p.y).toBeGreaterThan(MUD_DEPTH * 0.6);
    // The side stands on the deck and reaches the body's own top, all the way round.
    const side = points(bodyOf(mass, "mud-sides"));
    expect(Math.min(...side.map((p) => p.y))).toBeCloseTo(0, 9);
    const key = (p: THREE.Vector3): string => `${p.x.toFixed(4)},${p.z.toFixed(4)},${p.y.toFixed(4)}`;
    const tops = new Set(side.filter((p) => p.y > 0).map(key));
    for (const p of onEdge) expect(tops.has(key(p))).toBe(true);
    for (const p of side) expect(onRim(p)).toBe(true);
    // Lit from outside: each side triangle faces away from the deck, and its normals agree.
    const sideNormal = bodyOf(mass, "mud-sides").geometry.getAttribute("normal");
    for (let t = 0; t < side.length; t += 3) {
      const [a, b, c] = [side[t]!, side[t + 1]!, side[t + 2]!];
      const facing = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
      const centre = a.clone().add(b).add(c).setY(0);
      expect(facing.dot(centre)).toBeGreaterThan(0);
      expect(new THREE.Vector3().fromBufferAttribute(sideNormal, t).dot(facing)).toBeGreaterThan(0.99);
    }

    // A clod and a crease between them, not a slab — and never a hole to the deck.
    const heights = body.map((p) => p.y);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.12);
    expect(Math.min(...heights)).toBeGreaterThan(MUD_DEPTH * 0.6);
    // Never outside the deck it covers.
    for (const p of body) expect(isOnDeck(deck.deck, p, 1e-6)).toBe(true);
  });

  it("draws two mud decks side by side as the one surface a deck the size of both would be — no groove, and no cut side, at the seam", () => {
    const left = rect(-2, 0);
    const right = rect(2, 0);
    const all = [left, right];
    // The one edge they share is a seam; every other edge is cut.
    expect(mudOutline(left, all).filter((edge) => !edge.free)).toHaveLength(1);
    expect(mudOutline(right, all).filter((edge) => !edge.free)).toHaveLength(1);

    // Heights along world x = 0, keyed by z: the field is sampled in the
    // world, so all three read the same clods there.
    const alongSeam = (placement: MudDeckPlacement, others: MudDeckPlacement[], localX: number): Map<string, number> =>
      new Map(
        points(bodyOf(buildMudMass(placement, others)))
          .filter((p) => Math.abs(p.x - localX) < 1e-6)
          .map((p) => [p.z.toFixed(3), p.y]),
      );
    const whole = rect(0, 0, 2, 0, 4);
    const one = alongSeam(whole, [whole], 0);
    const fromLeft = alongSeam(left, all, 2);
    const fromRight = alongSeam(right, all, -2);
    expect(fromLeft.size).toBeGreaterThan(10);
    for (const [z, y] of fromLeft) {
      expect(one.get(z)!, `z ${z}`).toBeCloseTo(y, 5);
      expect(fromRight.get(z)!, `z ${z}`).toBeCloseTo(y, 5);
    }
    // ...and that surface is mud standing proud, not a trench down to the deck,
    // with no cut side standing in the middle of it.
    expect(Math.max(...fromLeft.values())).toBeGreaterThan(MUD_DEPTH);
    const leftSides = points(bodyOf(buildMudMass(left, all), "mud-sides"));
    expect(leftSides.length).toBeGreaterThan(0);
    // On the seam's line only the two corners it shares with a cut edge.
    for (const p of leftSides.filter((q) => Math.abs(q.x - 2) < 1e-6)) expect(Math.abs(p.z)).toBeCloseTo(2, 6);
  });

  it("runs on between decks that turn together, and is cut between decks that do not, or do not sit level", () => {
    const still = rect(-2, 0);
    const turning: MudDeckPlacement = { ...rect(2, 0), carry: motionCarry({ x: 2, y: 0, z: 0 }, IDENTITY_QUAT, 1, spin(1.2)) };
    expect(mudOutline(still, [still, turning]).every((edge) => edge.free)).toBe(true);
    const higher = rect(2, 0, 2, 0.5);
    expect(mudOutline(still, [still, higher]).every((edge) => edge.free)).toBe(true);

    // One turntable in two halves: both turn about the world point between them.
    const left: MudDeckPlacement = { ...rect(-2, 0), carry: motionCarry({ x: -2, y: 0, z: 0 }, IDENTITY_QUAT, 1, spin(1.2, { x: 2, y: 0, z: 0 })) };
    const right: MudDeckPlacement = { ...rect(2, 0), carry: motionCarry({ x: 2, y: 0, z: 0 }, IDENTITY_QUAT, 1, spin(1.2, { x: -2, y: 0, z: 0 })) };
    expect(mudOutline(left, [left, right]).filter((edge) => !edge.free)).toHaveLength(1);
  });

  it("makes Cog Arena's mud petal one mass: only its outer rim is cut, the bevels between its eight pieces covered", async () => {
    const arena = AUTHORED_TRACKS.find((authored) => authored.id === "cog-arena")!.track;
    const ids = new Set(arena.map((segment) => segment.moduleId));
    const library = await loadAssetLibrary(
      async (url) => new Uint8Array(readFileSync(join(assetsRoot, url.slice(url.lastIndexOf("/") + 1)))),
      "",
      ASSET_MODULE_DEFS.filter((def) => ids.has(def.id)),
    );
    const { mudDecks } = resolveTrack(library, arena);
    const all: MudDeckPlacement[] = mudDecks.map(({ deck }) => ({ deck }));
    expect(all).toHaveLength(8);
    // The petal's middle: the one point its four quarter circles share.
    const circles = mudDecks.filter(({ segmentIndex }) => arena[segmentIndex]!.moduleId.includes("circle"));
    const centre = circles.reduce((sum, { deck }) => ({ x: sum.x + deck.center.x / 4, z: sum.z + deck.center.z / 4 }), { x: 0, z: 0 });
    // A quarter curve spans the petal's radius, twice its own half-width.
    const radius = 2 * Math.max(...all.map(({ deck }) => deck.halfX));

    for (const [i, placement] of all.entries()) {
      const edges = mudOutline(placement, all);
      const isCircle = arena[mudDecks[i]!.segmentIndex]!.moduleId.includes("circle");
      for (const edge of edges) {
        const world = [edge.a, edge.b].map((p) => deckToWorld(placement.deck, p));
        const out = Math.min(...world.map((p) => Math.hypot(p.x - centre.x, p.z - centre.z)));
        // Free exactly where it is the petal's own rim: a quarter curve's outer arc.
        expect(edge.free, `piece ${i} edge at ${out.toFixed(2)} m`).toBe(!isCircle && out > radius - 0.5);
      }
    }
  });

  it("covers a bevelled piece out to its footprint, and its cut side reaches down over the bevel to the piece's own side", () => {
    // A 4 × 4 piece whose flat top stops 0.1 short of every edge: a 45° bevel.
    const top = { vertices: [{ x: -1.9, z: -1.9 }, { x: 1.9, z: -1.9 }, { x: 1.9, z: 1.9 }, { x: -1.9, z: 1.9 }], indices: [0, 1, 2, 0, 2, 3] };
    const piece: MudDeckPlacement = { deck: { ...rect(0, 0).deck, plan: top } };
    const mass = buildMudMass(piece, [piece]);
    const body = points(bodyOf(mass));
    expect(Math.max(...body.map((p) => Math.abs(p.x)))).toBeCloseTo(2, 6);
    expect(Math.max(...body.map((p) => Math.abs(p.z)))).toBeCloseTo(2, 6);
    const side = points(bodyOf(mass, "mud-sides"));
    expect(Math.min(...side.map((p) => p.y))).toBeCloseTo(-(0.1 + MUD_SEAT_LIFT), 6);
  });

  it("bubbles instead of pooling: spots spread over the deck, none near a cut side, and no puddle anywhere", () => {
    const deck = rect(0, 0, 6);
    const edges = mudOutline(deck, [deck]);
    const sites = mudBubbleSites(deck.deck, edges);
    expect(sites.length).toBeGreaterThan(8);
    for (const site of sites) expect(nearestFreeEdge(site, edges).distance).toBeGreaterThanOrEqual(MUD_BUBBLE_INSET);
    // Spread out, not bunched: every quarter of the deck has some.
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      expect(sites.some((site) => Math.sign(site.x) === sx && Math.sign(site.z) === sz)).toBe(true);
    }
    const mass = buildMudMass(deck, [deck]);
    expect(mass.object.getObjectByName("mud-puddles")).toBeUndefined();
    expect((mass.object.getObjectByName("mud-bubbles") as THREE.InstancedMesh).count).toBe(sites.length);
  });

  it("swells a bubble out of the mud, pops it, and leaves a ring that spreads and sinks back in", () => {
    const site = { x: 0, z: 0, y: 0.2, radius: 0.1, period: 2, phase: 0 };
    const at = (share: number) => mudBubblePose(site, share * site.period);
    // Swelling: growing, rising, and no ring.
    const early = at(0.1);
    const late = at(MUD_BUBBLE_SWELL - 0.02);
    expect(late.bubble.radius).toBeGreaterThan(early.bubble.radius);
    expect(late.bubble.y).toBeGreaterThan(early.bubble.y);
    expect(early.bubble.y).toBeLessThan(site.y); // mostly under the surface as it starts
    expect(early.ring.spread).toBe(0);
    // Popped: the bubble is gone and the ring is out, wider than the bubble was.
    const popped = at(MUD_BUBBLE_SWELL + 0.02);
    expect(popped.bubble.radius).toBe(0);
    expect(popped.ring.spread).toBeGreaterThan(site.radius);
    const spread = at(MUD_BUBBLE_SWELL + 0.15);
    expect(spread.ring.spread).toBeGreaterThan(popped.ring.spread);
    expect(spread.ring.height).toBeLessThan(popped.ring.height);
    // And round again: the next bubble is the first one's twin.
    const again = at(1.1);
    expect(again.bubble.radius).toBeCloseTo(early.bubble.radius, 9);
    expect(again.bubble.y).toBeCloseTo(early.bubble.y, 9);
  });

  it("draws the bubbles from the time alone — the same time, the same bubbles, in the game or the builder", () => {
    const deck = rect(3, -2, 5);
    const matrices = (mass: { object: THREE.Group }): number[] =>
      Array.from((mass.object.getObjectByName("mud-bubbles") as THREE.InstancedMesh).instanceMatrix.array);
    const one = buildMudMass(deck, [deck]);
    const other = buildMudMass(deck, [deck]);
    one.simmer(7.3);
    // The builder holds no handles: it bubbles every mass under its scene.
    const scene = new THREE.Scene();
    scene.add(other.object);
    simmerMud(scene, 7.3);
    expect(matrices(other)).toEqual(matrices(one));
    one.simmer(8.1);
    expect(matrices(one)).not.toEqual(matrices(other));
  });

  it("gives way under feet standing in it and fills back in behind them", () => {
    const deck = rect(0, 0, 3);
    const mass = buildMudMass(deck, [deck]);
    const body = bodyOf(mass);
    const rest = points(body);
    // Somewhere well inside, on top of a clod.
    const nearest = rest.reduce((best, p, i) => (Math.abs(p.x) < 2 && Math.abs(p.z) < 2 && p.y > rest[best]!.y ? i : best), 0);
    const foot = { x: rest[nearest]!.x, y: 0, z: rest[nearest]!.z };
    const heightNow = (): number => body.geometry.getAttribute("position").getY(nearest);

    mass.wade(10, [foot]);
    mass.wade(10.12, []);
    expect(rest[nearest]!.y - heightNow()).toBeGreaterThan(MUD_DENT_DEPTH * 0.6);
    mass.wade(10 + MUD_DENT_REFILL_SECONDS + 0.1, []);
    expect(heightNow()).toBeCloseTo(rest[nearest]!.y, 6);

    // Jumping over it, or standing off it, presses nothing.
    mass.wade(20, [{ ...foot, y: 1.2 }, { ...foot, x: 5 }]);
    mass.wade(20.12, []);
    expect(heightNow()).toBeCloseTo(rest[nearest]!.y, 6);
  });

  it("takes the cut side down with a dent at the edge", () => {
    const deck = rect(0, 0, 3);
    const mass = buildMudMass(deck, [deck]);
    const sides = bodyOf(mass, "mud-sides");
    const tallestNear = (x: number): number =>
      Math.max(...points(sides).filter((p) => Math.abs(p.x - x) < 0.1 && Math.abs(p.z + 3) < 1e-6).map((p) => p.y));
    const before = tallestNear(0);
    mass.wade(10, [{ x: 0, y: 0, z: -3 }]);
    mass.wade(10.12, []);
    expect(before - tallestNear(0)).toBeGreaterThan(MUD_DENT_DEPTH * 0.5);
  });
});
