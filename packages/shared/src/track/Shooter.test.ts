import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics, RapierSimulation } from "../simulation/RapierSimulation.js";
import { CAPSULE_BOTTOM_OFFSET } from "../tuning/character.js";
import { TICK_DT, TICK_RATE_HZ } from "../tuning/clock.js";
import { SHOOTER_MAX_IN_FLIGHT } from "../tuning/world.js";
import { loadAssetModule } from "./asset.js";
import { assetIdsOf, attachAssetGeometry } from "./assetModules.js";
import { BOMB_MODULE_DEFS } from "./bombAssetDefs.js";
import { SHOOTER_BOMB_FUSE_SECONDS } from "../tuning/fight.js";
import { invalidAttachmentReason } from "./Attachment.js";
import { DF_MODULE_DEFS, SHOOTER_LIFE_SECONDS, SHOOTER_PERIOD_SECONDS, SHOOTER_SPEED } from "./dfAssetDefs.js";
import type { Module } from "./Module.js";
import { resolveTrack } from "./resolveTrack.js";
import {
  invalidShooterReason,
  SHOOTER_BOMB_ASSET_ID,
  shooterBodies,
  shooterDefOf,
  shooterMuzzleAt,
  shooterShotAt,
  shooterShotsInFlight,
  type ShooterTiming,
} from "./Shooter.js";
import type { Segment } from "./Track.js";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");

const shooterModule = (): Module => {
  const def = DF_MODULE_DEFS.find((entry) => entry.id === "shooter")!;
  return attachAssetGeometry(
    def,
    loadAssetModule(new Uint8Array(readFileSync(join(assets, "shooter.glb"))), { footprint: def.footprint.bounds }),
  );
};

const DEF = DF_MODULE_DEFS.find((entry) => entry.id === "shooter")!.shooter!;

const place = (extra: Partial<Segment> = {}): Segment => ({
  moduleId: "shooter",
  position: { x: 0, y: 0, z: 0 },
  rotation: 0,
  ...extra,
});

describe("what a Shooter is (ADR 0119)", () => {
  it("knows how many of its balls can be in the air before the Round runs", () => {
    expect(shooterShotsInFlight(DEF)).toBe(Math.ceil(SHOOTER_LIFE_SECONDS / SHOOTER_PERIOD_SECONDS));
    expect(shooterShotsInFlight({ ...DEF, periodSeconds: 10, lifeSeconds: 1 })).toBe(1);
    expect(shooterShotsInFlight(DEF)).toBeLessThanOrEqual(SHOOTER_MAX_IN_FLIGHT);
  });

  it("fires on the Tick, not on a message", () => {
    const period = Math.round(SHOOTER_PERIOD_SECONDS / TICK_DT);

    expect(shooterShotAt(DEF, 0)).toBe(0);
    expect(shooterShotAt(DEF, 1)).toBeNull();
    expect(shooterShotAt(DEF, period)).toBe(1);
    expect(shooterShotAt(DEF, period * 4)).toBe(4);
  });

  it("aims on two axes that run independently", () => {
    const resolved = resolveTrack({ shooter: shooterModule() }, [place()]);
    const { aim } = resolved.shooters[0]!;

    // Two axes, two clocks: the barrel's pitch happens inside the carriage's
    // yaw, and because they do not share a period the muzzle covers an area
    // rather than retracing one line.
    expect(aim.def.yaw.period).not.toBe(aim.def.pitch.period);
    const sweep = [0, 20, 40, 60].map((tick) => shooterMuzzleAt(aim, tick));
    const xs = sweep.map((at) => at.direction.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.5);
    const ys = sweep.map((at) => at.direction.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.1);
    // …and every shot leaves along a unit direction from a point out front.
    for (const at of sweep) {
      expect(Math.hypot(at.direction.x, at.direction.y, at.direction.z)).toBeCloseTo(1, 6);
      expect(at.position.z).toBeGreaterThan(0);
    }
  });

  it("turns with the Segment it was placed on", () => {
    const resolved = resolveTrack({ shooter: shooterModule() }, [place({ rotation: Math.PI })]);
    const straight = resolveTrack({ shooter: shooterModule() }, [place()]);

    const turned = shooterMuzzleAt(resolved.shooters[0]!.aim, 0).direction;
    const ahead = shooterMuzzleAt(straight.shooters[0]!.aim, 0).direction;
    expect(turned.z).toBeCloseTo(-ahead.z, 5);
  });

  it("takes its author's numbers, each axis on its own", () => {
    const resolved = resolveTrack({ shooter: shooterModule() }, [
      place({ shooter: { periodSeconds: 1, speed: 30, lifeSeconds: 2, yawDegrees: 0, pitchSeconds: 9 } }),
    ]);

    expect(resolved.shooters[0]!.aim.def.speed).toBe(30);
    expect(resolved.shooters[0]!.propIndices).toHaveLength(2);
    // A cannon held still on one axis and slowed on the other — neither
    // change touches the other, and a held axis stops moving its body too.
    expect(resolved.shooters[0]!.aim.def.yaw.amplitude).toBe(0);
    expect(resolved.shooters[0]!.aim.def.pitch.period).toBe(9);
    expect(resolved.movingSegments.map((body) => body.part)).toEqual(["barrel"]);
    expect(shooterDefOf(DEF, undefined)).toBe(DEF);
    // …and never more balls than a Round allows, however they were asked for.
    expect(shooterShotsInFlight(shooterDefOf(DEF, { periodSeconds: 0.2, lifeSeconds: 40 }))).toBeLessThanOrEqual(SHOOTER_MAX_IN_FLIGHT);
  });

  it("gives every ball a body from the start, and parks it until it is fired", () => {
    const resolved = resolveTrack({ shooter: shooterModule() }, [place()]);

    expect(resolved.props).toHaveLength(shooterShotsInFlight(DEF));
    expect(resolved.props.every((prop) => prop.projectile === true)).toBe(true);
    expect(resolved.shooters[0]!.propIndices).toEqual(resolved.props.map((_, i) => i));
  });

  it("refuses a timing that is not one, at publish", () => {
    expect(invalidShooterReason({ periodSeconds: 2, speed: 10, lifeSeconds: 4 })).toBeUndefined();
    expect(invalidShooterReason({ periodSeconds: 0 })).toMatch(/periodSeconds/);
    expect(invalidShooterReason({ speed: -1 })).toMatch(/speed/);
    expect(invalidShooterReason({ muzzle: { x: 0, y: 0, z: 0 } })).toMatch(/no "muzzle"/);
    // The budget is checkable exactly when both halves of it are on the Segment.
    expect(invalidShooterReason({ periodSeconds: 0.2, lifeSeconds: 10 })).toMatch(/past the/);
    expect(invalidShooterReason({ lifeSeconds: 10 })).toBeUndefined();
    expect(invalidAttachmentReason({ shooter: { lifeSeconds: 0 } })).toMatch(/lifeSeconds/);
  });
});

describe("a Shooter firing in a world", () => {
  const GROUND: Module = {
    id: "ground",
    statics: [{ center: { x: 0, y: -0.5, z: 8 }, halfExtents: { x: 8, y: 0.5, z: 12 } }],
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: -0.5, z: 8 }, halfExtents: { x: 8, y: 0.5, z: 12 } }, clearance: 0.5 },
  };

  beforeAll(async () => {
    await initPhysics();
  });

  const world = (extra: Partial<Segment> = {}, stand?: { x: number; z: number }) => {
    const resolved = resolveTrack({ shooter: shooterModule(), ground: GROUND }, [
      { moduleId: "ground", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      place(extra),
    ]);
    const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
    if (stand) sim.addCharacter("me", { x: stand.x, y: CAPSULE_BOTTOM_OFFSET + 0.05, z: stand.z });
    const run = (seconds: number, until?: () => boolean): void => {
      for (let n = 0; n < Math.round(seconds * TICK_RATE_HZ); n += 1) {
        sim.tick({});
        if (until?.()) return;
      }
    };
    return { sim, run, balls: () => sim.snapshot().props, me: () => sim.snapshot().characters.me! };
  };

  it("waits with every ball inside it, then puts one in the air on the Tick its period comes round", () => {
    const { sim, run, balls } = world();
    expect(balls()).toHaveLength(shooterShotsInFlight(DEF));
    expect(balls().every((ball) => ball.live === false)).toBe(true);

    run(SHOOTER_PERIOD_SECONDS - TICK_DT);
    expect(balls().filter((ball) => ball.live)).toHaveLength(0);

    run(TICK_DT);
    const live = balls().filter((ball) => ball.live);
    expect(live).toHaveLength(1);
    const v = live[0]!.velocity!;
    expect(Math.hypot(v.x, v.y, v.z)).toBeGreaterThan(SHOOTER_SPEED * 0.8);
    sim.dispose();
  });

  it("never has more in the air than its numbers allow, and recycles them", () => {
    const { sim, run, balls } = world();
    let most = 0;
    run(20, () => {
      most = Math.max(most, balls().filter((ball) => ball.live).length);
      return false;
    });

    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(shooterShotsInFlight(DEF));
    sim.dispose();
  });

  it("knocks down what a fresh shot reaches", () => {
    // The barrel points 10° below level at rest, so an author who wants it
    // firing flat across a deck tips the whole piece up by that much (ADR
    // 0034's free placement) — which is also how it was measured.
    const { sim, run, me } = world({ pitch: -0.1745, shooter: { periodSeconds: 0.5, speed: SHOOTER_SPEED, lifeSeconds: 3 } }, { x: 0, z: 6 });
    let down = false;
    run(14, () => (down ||= me().motionState === "Ragdoll"));

    expect(down).toBe(true);
    sim.dispose();
  });

  it("knocks nobody down with a ball that is not going fast enough", () => {
    // The same cannon at a sixth of the speed. Nothing about a Projectile
    // says "knock down": it goes through the closing-speed gate every Moving
    // Segment goes through (ADR 0037), so a slow one can only ever shove.
    const { sim, run, me } = world({ pitch: -0.1745, shooter: { periodSeconds: 0.5, speed: 4, lifeSeconds: 3 } }, { x: 0, z: 6 });
    let down = false;
    run(14, () => (down ||= me().motionState === "Ragdoll"));

    expect(down).toBe(false);
    sim.dispose();
  });
});

describe("a Shooter firing Bombs (ADR 0127)", () => {
  const GROUND: Module = {
    id: "ground",
    statics: [{ center: { x: 0, y: -0.5, z: 8 }, halfExtents: { x: 8, y: 0.5, z: 12 } }],
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: -0.5, z: 8 }, halfExtents: { x: 8, y: 0.5, z: 12 } }, clearance: 0.5 },
  };
  const bombModule = (): Module => {
    const def = BOMB_MODULE_DEFS.find((entry) => entry.id === SHOOTER_BOMB_ASSET_ID)!;
    return attachAssetGeometry(
      def,
      loadAssetModule(new Uint8Array(readFileSync(join(assets, `${SHOOTER_BOMB_ASSET_ID}.glb`))), { footprint: def.footprint.bounds }),
    );
  };
  const BOMBS = { ammo: "bomb" as const, periodSeconds: 1, lifeSeconds: 2 };

  beforeAll(async () => {
    await initPhysics();
  });

  const world = (shooter: ShooterTiming, stand?: { x: number; z: number }, extra: Partial<Segment> = {}) => {
    const resolved = resolveTrack({ shooter: shooterModule(), ground: GROUND, [SHOOTER_BOMB_ASSET_ID]: bombModule() }, [
      { moduleId: "ground", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      place({ shooter, ...extra }),
    ]);
    const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
    if (stand) sim.addCharacter("me", { x: stand.x, y: CAPSULE_BOTTOM_OFFSET + 0.05, z: stand.z });
    const run = (seconds: number, until?: () => boolean): void => {
      for (let n = 0; n < Math.round(seconds * TICK_RATE_HZ); n += 1) {
        sim.tick({});
        if (until?.()) return;
      }
    };
    return { sim, run, resolved };
  };

  it("burns SHOOTER_BOMB_FUSE_SECONDS unless the Shooter gives its own life, and names bomb A for loading", () => {
    expect(shooterDefOf(DEF, { ammo: "bomb" }).lifeSeconds).toBe(SHOOTER_BOMB_FUSE_SECONDS);
    expect(shooterDefOf(DEF, { ammo: "bomb", lifeSeconds: 4 }).lifeSeconds).toBe(4);
    expect(assetIdsOf([place({ shooter: { ammo: "bomb" } })])).toEqual(["shooter", SHOOTER_BOMB_ASSET_ID]);
    expect(invalidShooterReason({ ammo: "rocket" })).toMatch(/ammo/);
  });

  it("keeps bomb A bodies, enough that a spent one has finished going off before it is fired again", () => {
    const { resolved } = world(BOMBS);
    const bodies = resolved.shooters[0]!.propIndices.map((index) => resolved.props[index]!);

    expect(bodies).toHaveLength(shooterBodies(shooterDefOf(DEF, BOMBS)));
    expect(bodies.length).toBeGreaterThan(shooterShotsInFlight(shooterDefOf(DEF, BOMBS)));
    expect(bodies.every((body) => body.shape.kind === "asset" && body.shape.moduleId === SHOOTER_BOMB_ASSET_ID)).toBe(true);
    expect(bodies.every((body) => body.bomb?.fuseSeconds === BOMBS.lifeSeconds)).toBe(true);
  });

  it("fires a bomb lit, which goes off after its fuse where it is, and waits there for its Shooter", () => {
    const { sim, run } = world(BOMBS);
    run(BOMBS.periodSeconds);
    const lit = sim.snapshot().bombs ?? [];
    expect(lit).toHaveLength(1);
    const [row] = lit;
    expect(row!.detonateTick).toBeDefined();

    run(BOMBS.lifeSeconds);
    const spent = (sim.snapshot().bombs ?? []).find((candidate) => candidate.propIndex === row!.propIndex)!;
    expect(spent.blasted).toBe(true);
    expect(spent.blastTick).toBeDefined();
    expect(spent.returnTick).toBeUndefined();
    expect(sim.snapshot().props[row!.propIndex]!.live).toBe(false);
    sim.dispose();
  });

  it("knocks down what a fresh shot reaches, as a ball does — before any blast", () => {
    // The barrel held still and levelled, so the first shot is the one that lands.
    const { sim, run } = world(
      { ammo: "bomb", periodSeconds: 2, speed: SHOOTER_SPEED, lifeSeconds: 3, yawDegrees: 0, pitchDegrees: 0 },
      { x: 0, z: 6 },
      { pitch: -0.1745 },
    );
    let cause: string | undefined;
    run(4, () => {
      const me = sim.snapshot().characters.me!;
      if (me.motionState === "Ragdoll") cause ??= me.ragdollCause;
      return cause !== undefined;
    });

    expect(cause).toBe("Obstacle");
    sim.dispose();
  });

  it("fires balls, and says so, where bomb A is not loaded", () => {
    const resolved = resolveTrack({ shooter: shooterModule() }, [place({ shooter: BOMBS })]);

    expect(resolved.props.every((prop) => prop.shape.kind === "ball" && prop.bomb === undefined)).toBe(true);
    expect(resolved.warnings.some((warning) => warning.includes(SHOOTER_BOMB_ASSET_ID))).toBe(true);
  });
});
