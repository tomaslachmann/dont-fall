import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { vec3, type Vec3 } from "../../math/vec3.js";
import { CAPSULE_BOTTOM_OFFSET, CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from "../../tuning/character.js";
import { TICK_RATE_HZ } from "../../tuning/clock.js";
import type { StaticTrimesh } from "../../track/resolveTrack.js";
import { STATIC_GROUPS } from "../collisionGroups.js";
import { DEFAULT_CHARACTER_ID, RapierSimulation, initPhysics } from "../RapierSimulation.js";
import { IDLE_INPUTS } from "../SimInputs.js";
import { createCapsule } from "./Capsule.js";
import { getUpSpot } from "./getUpSpot.js";

beforeAll(async () => {
  await initPhysics();
});

/** A closed, outward-wound box as a trimesh — hollow to Rapier, like every authored Asset. */
const boxTrimesh = (center: Vec3, half: Vec3): StaticTrimesh => {
  const vertices: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    vertices.push(vec3(center.x + sx * half.x, center.y + sy * half.y, center.z + sz * half.z));
  }
  // Vertex i is (sx, sy, sz) = bits (4, 2, 1).
  const faces = [
    [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], // −x, +x
    [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], // −y, +y
    [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3], // −z, +z
  ];
  return { vertices, indices: faces.flat(), surface: "default" };
};

const addTrimesh = (world: RAPIER.World, mesh: StaticTrimesh): void => {
  const vertices = new Float32Array(mesh.vertices.flatMap((v) => [v.x, v.y, v.z]));
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(vertices, new Uint32Array(mesh.indices), RAPIER.TriMeshFlags.ORIENTED).setCollisionGroups(STATIC_GROUPS),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );
};

/** A world with a floor at y = 0, a Character's capsule parked out of the way, and `meshes`. */
const worldWith = (...meshes: StaticTrimesh[]) => {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0).setCollisionGroups(STATIC_GROUPS));
  for (const mesh of meshes) addTrimesh(world, mesh);
  const capsule = createCapsule(world, vec3(0, 50, 0));
  capsule.collider.setEnabled(false); // as it is while the body is down
  world.step();
  return { world, capsule };
};

const overlapsStill = (world: RAPIER.World, at: Vec3): boolean =>
  world.intersectionWithShape(
    { x: at.x, y: at.y + 0.02, z: at.z },
    { x: 0, y: 0, z: 0, w: 1 },
    new RAPIER.Capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
  ) !== null;

const STANDING_Y = CAPSULE_BOTTOM_OFFSET;
/** A barrier whose near face is z = 2.5, as tall as a Character. */
const BARRIER = boxTrimesh(vec3(0, 0.75, 4), vec3(1.5, 0.75, 1.5));

describe("getUpSpot — a Character never gets up inside still geometry (M17 ticket 06b)", () => {
  it("stands where the clip says when that is clear", () => {
    const { capsule } = worldWith(BARRIER);
    const wanted = vec3(0.2, STANDING_Y, 1.4);
    expect(getUpSpot(capsule, wanted, vec3(0.2, 0.35, 1.8))).toEqual(wanted);
  });

  it("moves a capsule the clip put inside a barrier out on the body's own side", () => {
    // The numbers the belt case measured: pelvis against the face, clip
    // origin 0.38 past it — inside.
    const { world, capsule } = worldWith(BARRIER);
    const wanted = vec3(0, STANDING_Y, 2.63);
    expect(overlapsStill(world, wanted)).toBe(true);
    const spot = getUpSpot(capsule, wanted, vec3(0, 0.38, 2.25));
    expect(overlapsStill(world, spot)).toBe(false);
    expect(spot.z + CAPSULE_RADIUS).toBeLessThanOrEqual(2.5);
    expect(spot.z).toBeGreaterThan(2.5 - CAPSULE_RADIUS - 0.2); // the nearest clear spot, not a long way off
  });

  it("never stands up on the far side of a thin wall, even where that side is clear", () => {
    // A 5 cm panel at z = 2.5: the clip origin lands clear, beyond it.
    const { world, capsule } = worldWith(boxTrimesh(vec3(0, 0.75, 2.525), vec3(1.5, 0.75, 0.025)));
    const wanted = vec3(0, STANDING_Y, 2.95);
    expect(overlapsStill(world, wanted)).toBe(false);
    const spot = getUpSpot(capsule, wanted, vec3(0, 0.38, 2.25));
    expect(spot.z).toBeLessThan(2.5);
    expect(overlapsStill(world, spot)).toBe(false);
  });
});

describe("getting up against a barrier a belt carried the body into (M17 ticket 06b, Slip Stream)", () => {
  // A belt running +z into a barrier: a Character knocked down on it rides
  // into the barrier's face (z = 2.5) and settles pressed against it. Before
  // the fix, every one of these got up with its capsule inside the barrier,
  // and never moved again.
  const cases = [
    { spawnX: -0.3, flow: 2, shove: vec3(-3, 4, 8) },
    { spawnX: 0.35, flow: 3, shove: vec3(3, 4, 9) },
    { spawnX: -0.04, flow: 4, shove: vec3(0, 4, 10) },
  ];

  for (const { spawnX, flow, shove } of cases) {
    it(`gets up clear of it and walks away (belt ${flow} u/s)`, () => {
      const sim = new RapierSimulation({
        spawn: vec3(spawnX, CAPSULE_BOTTOM_OFFSET + 0.1, 0),
        statics: [{ center: vec3(0, -0.5, 0), halfExtents: vec3(10, 0.5, 20) }],
        staticConveyors: [vec3(0, 0, flow)],
        staticTrimeshes: [BARRIER],
      });
      const character = () => sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      for (let i = 0; i < 10; i += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
      sim.applyImpact(DEFAULT_CHARACTER_ID, shove, "Bump");

      let wentDown = false;
      for (let i = 0; i < 400 && !(wentDown && character().motionState === "Controlled"); i += 1) {
        sim.tick({ [DEFAULT_CHARACTER_ID]: IDLE_INPUTS });
        if (character().motionState === "Ragdoll") wentDown = true;
      }
      expect(wentDown).toBe(true);
      expect(character().motionState).toBe("Controlled");

      const standing = character().position;
      expect(standing.z + CAPSULE_RADIUS).toBeLessThanOrEqual(2.5 + 0.02);

      const away = { ...IDLE_INPUTS, moveDirection: vec3(0, 0, -1) };
      for (let i = 0; i < TICK_RATE_HZ; i += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: away });
      expect(character().position.z).toBeLessThan(standing.z - 0.5);
    });
  }
});
