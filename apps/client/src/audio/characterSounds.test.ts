import { DASH_SPEED, JUMP_VELOCITY, type Vec3 } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import type { BounceLanding } from "../render/bounceSheets.js";
import type { PlayOptions } from "./engine.js";
import { landingSound } from "./landings.js";
import {
  BUMP_RATE,
  CharacterSounds,
  DASH_GAIN_FLOOR,
  dashLevel,
  GRIP_RATE,
  OWN_FIGHT_PRIORITY_BOOST,
  SLIDE_GAIN_FLOOR,
  slideLevel,
  swingLevel,
  type CharacterSoundEngine,
  type CharacterSoundWorld,
  type SoundCharacter,
} from "./characterSounds.js";
import { OTHER_PLAYER_GAIN, SOUND_SLOTS, type SoundSlot } from "./slots.js";

/** Records what was played, and hands back handles that record what was done to them. */
const fakeEngine = () => {
  const played: { slot: SoundSlot; options: PlayOptions }[] = [];
  const started: { slot: SoundSlot; options: PlayOptions; sets: PlayOptions[]; stopped: boolean }[] = [];
  const loops: { slot: SoundSlot; options: PlayOptions; sets: PlayOptions[]; stopped: boolean }[] = [];
  const engine: CharacterSoundEngine = {
    play: (slot, options = {}) => {
      played.push({ slot, options });
      return true;
    },
    start: (slot, options = {}) => {
      const voice = { slot, options, sets: [] as PlayOptions[], stopped: false };
      started.push(voice);
      return { set: (next) => voice.sets.push(next), stop: () => (voice.stopped = true) };
    },
    loop: (slot, options = {}) => {
      const loop = { slot, options, sets: [] as PlayOptions[], stopped: false };
      loops.push(loop);
      return { set: (next) => loop.sets.push(next), stop: () => (loop.stopped = true) };
    },
  };
  return { engine, played, started, loops, slots: () => played.map((play) => play.slot) };
};

const BOUNCE_X = 50;
const SPRING = { x: 20, y: 0.5, z: 0 };
const world: CharacterSoundWorld = {
  onBounce: (centre) => centre.x >= BOUNCE_X,
  springAt: (centre) => (Math.abs(centre.x - SPRING.x) < 3 ? SPRING : undefined),
  fallY: -3,
};

const standing = (over: Partial<SoundCharacter> & { at?: Vec3; vy?: number } = {}): SoundCharacter => {
  const { at, vy, ...rest } = over;
  return {
    position: at ?? { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: vy ?? 0, z: 0 },
    grounded: true,
    motionState: "Controlled",
    dashing: false,
    dashSpeed: 0,
    launchPadEpoch: 0,
    respawnCount: 0,
    eliminated: false,
    hitEpoch: 0,
    hitChargeMs: 0,
    hitReactEpoch: 0,
    grabEpoch: 0,
    grabbingId: null,
    ragdollEpoch: 0,
    ragdollCause: "Fall",
    ...rest,
  };
};
const jumping = (over: Partial<SoundCharacter> & { at?: Vec3 } = {}) => standing({ grounded: false, vy: JUMP_VELOCITY, ...over });

const THEM = { x: 5, y: 1, z: 0 };

describe("CharacterSounds: getting around (M14 ticket 05, ADR 0087)", () => {
  it("plays your own jump unpanned, and another player's where they are, quieter", () => {
    const { engine, played } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    sounds.update({ me: standing(), them: standing({ at: THEM }) }, "me", 0);
    sounds.update({ me: jumping(), them: jumping({ at: THEM }) }, "me", 16);
    expect(played).toEqual([
      { slot: "character.jump", options: { gain: 1 } },
      { slot: "character.jump", options: { at: THEM, gain: OTHER_PLAYER_GAIN } },
    ]);
  });

  it("lands heavy or light by the fall, and not at all on a bounce deck", () => {
    const { engine, played, slots } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    sounds.update({ me: standing() }, "me", 0);
    sounds.update({ me: standing({ grounded: false, vy: -20 }) }, "me", 16);
    sounds.update({ me: standing() }, "me", 600);
    expect(played.at(-1)).toEqual({ slot: "character.land_heavy", options: { gain: landingSound({ fallSpeed: 20 }).gain } });

    const onDeck = { x: BOUNCE_X, y: 1, z: 0 };
    sounds.update({ me: standing({ at: onDeck, grounded: false, vy: -20 }) }, "me", 700);
    sounds.update({ me: standing({ at: onDeck, vy: 12 }) }, "me", 1300);
    // Thrown back up off the deck: the deck's thump, not a jump.
    sounds.update({ me: standing({ at: onDeck, grounded: false, vy: 11 }) }, "me", 1316);
    expect(slots()).toEqual(["character.land_heavy"]);
  });

  it("thumps a bounce deck's landings, only on the deck, for anyone", () => {
    const { engine, played } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    const onDeck = { x: BOUNCE_X + 1, y: 1, z: 0 };
    const landings: BounceLanding[] = [
      { id: "me", position: { x: BOUNCE_X, y: 1, z: 0 }, speed: 7 },
      { id: "them", position: onDeck, speed: 20 },
      { id: "far", position: { x: 0, y: 1, z: 0 }, speed: 20 },
    ];
    const characters = { me: standing(), them: standing({ at: onDeck }), far: standing() };
    sounds.update(characters, "me", 0, landings);
    expect(played).toEqual([
      { slot: "surface.bounce", options: { gain: landingSound({ fallSpeed: 7 }).gain } },
      { slot: "surface.bounce", options: { at: onDeck, gain: OTHER_PLAYER_GAIN } },
    ]);
  });

  it("boings at the Spring another player fired, and your own unpanned", () => {
    const { engine, played } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    const onSpring = { x: SPRING.x + 1, y: 1.5, z: 0 };
    sounds.update({ me: standing({ at: onSpring }), them: standing({ at: onSpring }) }, "me", 0);
    sounds.update({ me: standing({ at: onSpring, launchPadEpoch: 1 }), them: standing({ at: onSpring, launchPadEpoch: 1 }) }, "me", 16);
    sounds.update({ me: jumping({ at: onSpring, launchPadEpoch: 1 }), them: jumping({ at: onSpring, launchPadEpoch: 1 }) }, "me", 50);
    expect(played).toEqual([
      { slot: "character.spring", options: {} },
      { slot: "character.spring", options: { at: SPRING, gain: OTHER_PLAYER_GAIN } },
    ]);
  });

  it("pops a Respawn where it happened, and whistles only your own fall", () => {
    const { engine, played, slots } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    const below = { x: 0, y: -5, z: 0 };
    sounds.update({ me: standing(), them: standing({ at: THEM }) }, "me", 0);
    sounds.update(
      { me: standing({ at: below, grounded: false, vy: -10 }), them: standing({ at: below, grounded: false, vy: -10 }) },
      "me",
      400,
    );
    expect(slots()).toEqual(["character.fall"]);
    sounds.update({ me: standing({ respawnCount: 1 }), them: standing({ at: THEM, respawnCount: 1 }) }, "me", 900);
    expect(played.slice(1)).toEqual([
      { slot: "character.respawn", options: { gain: 1 } },
      { slot: "character.respawn", options: { at: THEM, gain: OTHER_PLAYER_GAIN } },
    ]);
  });

  describe("Dash", () => {
    it("starts a woosh at its floor and follows the build-up while the burst lasts", () => {
      const { engine, started } = fakeEngine();
      const sounds = new CharacterSounds(engine, world);
      sounds.update({ me: standing() }, "me", 0);
      sounds.update({ me: standing({ dashing: true, dashSpeed: 0 }) }, "me", 16);
      sounds.update({ me: standing({ dashing: true, dashSpeed: DASH_SPEED }) }, "me", 500);
      expect(started).toHaveLength(1);
      expect(started[0]!.slot).toBe("character.dash");
      expect(started[0]!.options).toEqual({ gain: DASH_GAIN_FLOOR, rate: dashLevel(0).rate });
      expect(started[0]!.sets).toEqual([{ gain: 1, rate: dashLevel(DASH_SPEED).rate }]);

      // The burst ends: the woosh plays out on its own, no longer followed.
      sounds.update({ me: standing() }, "me", 1016);
      sounds.update({ me: standing({ dashing: true, dashSpeed: 3 }) }, "me", 1100);
      expect(started[0]!.sets).toHaveLength(1);
      expect(started[0]!.stopped).toBe(false);
    });

    it("rises in level and pitch with speed", () => {
      expect(dashLevel(DASH_SPEED / 2).gain).toBeGreaterThan(dashLevel(0).gain);
      expect(dashLevel(DASH_SPEED / 2).rate).toBeGreaterThan(dashLevel(0).rate);
      expect(dashLevel(DASH_SPEED * 3)).toEqual(dashLevel(DASH_SPEED));
    });

    it("is cut by a knockdown", () => {
      const { engine, started } = fakeEngine();
      const sounds = new CharacterSounds(engine, world);
      sounds.update({ them: standing({ at: THEM }) }, "me", 0);
      sounds.update({ them: standing({ at: THEM, dashing: true, dashSpeed: 5 }) }, "me", 16);
      expect(started[0]!.options).toEqual({ at: THEM, gain: dashLevel(5).gain * OTHER_PLAYER_GAIN, rate: dashLevel(5).rate });
      sounds.update({ them: standing({ at: THEM, motionState: "Ragdoll", grounded: false }) }, "me", 300);
      expect(started[0]!.stopped).toBe(true);
    });
  });

  describe("Sliding", () => {
    it("loops a scrape while Sliding, following speed, and lets it go on leaving", () => {
      const { engine, loops } = fakeEngine();
      const sounds = new CharacterSounds(engine, world);
      const slidingAt = (speed: number) => standing({ motionState: "Sliding", velocity: { x: speed, y: 0, z: 0 } });
      sounds.update({ me: slidingAt(0) }, "me", 0);
      sounds.update({ me: slidingAt(12) }, "me", 16);
      expect(loops).toHaveLength(1);
      expect(loops[0]!.slot).toBe("character.slide");
      expect(loops[0]!.options).toEqual({ gain: SLIDE_GAIN_FLOOR, rate: slideLevel(0).rate });
      expect(loops[0]!.sets).toEqual([{ gain: 1, rate: slideLevel(12).rate }]);

      sounds.update({ me: standing() }, "me", 33);
      expect(loops[0]!.stopped).toBe(true);
      sounds.update({ me: slidingAt(4) }, "me", 50);
      expect(loops).toHaveLength(2);
    });

    it("places another player's scrape where they slide", () => {
      const { engine, loops } = fakeEngine();
      const sounds = new CharacterSounds(engine, world);
      sounds.update({ them: standing({ at: THEM, motionState: "Sliding" }) }, "me", 0);
      expect(loops[0]!.options).toEqual({ at: THEM, gain: SLIDE_GAIN_FLOOR * OTHER_PLAYER_GAIN, rate: slideLevel(0).rate });
    });
  });

  it("is silent for an eliminated Character, and stops what it was playing", () => {
    const { engine, played, started, loops } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    sounds.update({ them: standing({ at: THEM, motionState: "Sliding", dashing: true }) }, "me", 0);
    sounds.update({ them: standing({ at: THEM, motionState: "Sliding" }) }, "me", 16);
    sounds.update({ them: standing({ at: THEM, dashing: true, motionState: "Sliding" }) }, "me", 2000);
    expect(started).toHaveLength(1);

    const out = { at: { x: 0, y: -9, z: 0 }, eliminated: true, grounded: false, vy: -20, respawnCount: 4, launchPadEpoch: 3 };
    sounds.update({ them: standing({ ...out, motionState: "Ragdoll" }) }, "me", 2100);
    expect(loops[0]!.stopped).toBe(true);
    expect(started[0]!.stopped).toBe(true);
    const before = played.length;
    sounds.update({ them: standing({ ...out, motionState: "Ragdoll", respawnCount: 5, launchPadEpoch: 4 }) }, "me", 3000);
    sounds.update({ them: standing({ ...out, motionState: "Ragdoll" }) }, "me", 4000, [
      { id: "them", position: { x: BOUNCE_X, y: 1, z: 0 }, speed: 20 },
    ]);
    expect(played).toHaveLength(before);
  });

  it("stops a Character's loops when it leaves, and forgets it", () => {
    const { engine, played, loops } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    sounds.update({ them: standing({ at: THEM, motionState: "Sliding", launchPadEpoch: 1 }) }, "me", 0);
    sounds.update({}, "me", 16);
    expect(loops[0]!.stopped).toBe(true);
    // Back under the same id with a higher Epoch: history, not a Spring.
    sounds.update({ them: standing({ at: THEM, launchPadEpoch: 2 }) }, "me", 1000);
    expect(played).toEqual([]);
  });

  it("stops everything on dispose", () => {
    const { engine, started, loops } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    sounds.update({ me: standing(), them: standing({ at: THEM }) }, "me", 0);
    sounds.update({ me: standing({ motionState: "Sliding" }), them: standing({ at: THEM, dashing: true }) }, "me", 16);
    sounds.dispose();
    expect(loops[0]!.stopped).toBe(true);
    expect(started[0]!.stopped).toBe(true);
  });
});

const own = (slot: SoundSlot) => SOUND_SLOTS[slot].priority + OWN_FIGHT_PRIORITY_BOOST;

describe("CharacterSounds: fighting (M14 ticket 06, ADR 0087)", () => {
  it("swings louder the more it was charged, your own outranking anyone else's", () => {
    const { engine, played } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    sounds.update({ me: standing(), them: standing({ at: THEM }) }, "me", 0);
    sounds.update({ me: standing({ hitChargeMs: 600 }), them: standing({ at: THEM, hitChargeMs: 100 }) }, "me", 400);
    sounds.update({ me: standing({ hitEpoch: 1 }), them: standing({ at: THEM, hitEpoch: 1 }) }, "me", 433);
    expect(played).toEqual([
      { slot: "character.hit_swing", options: { ...swingLevel(1), priority: own("character.hit_swing") } },
      {
        slot: "character.hit_swing",
        options: { ...swingLevel(100 / 600), at: THEM, gain: swingLevel(100 / 600).gain * OTHER_PLAYER_GAIN },
      },
    ]);
  });

  it("lands a Hit heavy when the swing that threw it could knock down, and at the one hit", () => {
    const { engine, played } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    const near = { x: 6, y: 1, z: 0 };
    // The victim comes first in the frame: the pairing waits for every swing.
    sounds.update({ them: standing({ at: THEM }), me: standing({ at: near }) }, "me", 0);
    sounds.update({ them: standing({ at: THEM }), me: standing({ at: near, hitChargeMs: 600 }) }, "me", 400);
    sounds.update({ them: standing({ at: THEM, hitReactEpoch: 1 }), me: standing({ at: near, hitEpoch: 1 }) }, "me", 433);
    expect(played.at(-1)).toEqual({ slot: "character.hit_land_heavy", options: { at: THEM, gain: OTHER_PLAYER_GAIN } });

    // A tap lands medium, and your own being hit is unpanned and outranks.
    sounds.update({ them: standing({ at: THEM, hitEpoch: 1 }), me: standing({ at: near, hitReactEpoch: 1 }) }, "me", 2000);
    sounds.update({ them: standing({ at: THEM, hitEpoch: 2 }), me: standing({ at: near, hitReactEpoch: 2 }) }, "me", 2033);
    expect(played.at(-1)).toEqual({ slot: "character.hit_land", options: { priority: own("character.hit_land") } });
  });

  it("lands medium when no swing was seen", () => {
    const { engine, played } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    sounds.update({ me: standing() }, "me", 0);
    sounds.update({ me: standing({ hitReactEpoch: 1 }) }, "me", 16);
    expect(played).toEqual([{ slot: "character.hit_land", options: { priority: own("character.hit_land") } }]);
  });

  it("reaches with cloth and grips when a hold starts", () => {
    const { engine, slots, played } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    sounds.update({ them: standing({ at: THEM }) }, "me", 0);
    sounds.update({ them: standing({ at: THEM, grabEpoch: 1 }) }, "me", 16);
    sounds.update({ them: standing({ at: THEM, grabEpoch: 1, grabbingId: "me" }) }, "me", 50);
    expect(slots()).toEqual(["character.grab", "character.grip"]);
    expect(played[1]!.options).toEqual({ rate: GRIP_RATE, at: THEM, gain: OTHER_PLAYER_GAIN });
  });

  it("knocks down hard or medium by cause, then settles on getting up", () => {
    const { engine, slots } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    sounds.update({ me: standing() }, "me", 0);
    sounds.update({ me: standing({ motionState: "Ragdoll", ragdollEpoch: 1, ragdollCause: "Spinner" }) }, "me", 16);
    sounds.update({ me: standing({ motionState: "GettingUp", ragdollEpoch: 1, ragdollCause: "Spinner" }) }, "me", 1500);
    sounds.update({ me: standing({ ragdollEpoch: 1, ragdollCause: "Spinner" }) }, "me", 2500);
    sounds.update({ me: standing({ motionState: "Ragdoll", ragdollEpoch: 2, ragdollCause: "Hit" }) }, "me", 3000);
    expect(slots()).toEqual(["character.knockdown_hard", "character.getup", "character.knockdown"]);
  });

  it("thuds a Bump, and not the Stagger a Hit or a Respawn brings", () => {
    const { engine, played, slots } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    sounds.update({ them: standing({ at: THEM }) }, "me", 0);
    sounds.update({ them: standing({ at: THEM, motionState: "Stagger" }) }, "me", 16);
    expect(played).toEqual([{ slot: "character.bump", options: { rate: BUMP_RATE, at: THEM, gain: OTHER_PLAYER_GAIN } }]);

    sounds.update({ them: standing({ at: THEM }) }, "me", 1000);
    sounds.update({ them: standing({ at: THEM, hitReactEpoch: 1 }) }, "me", 2000);
    sounds.update({ them: standing({ at: THEM, hitReactEpoch: 1, motionState: "Stagger" }) }, "me", 2033);
    sounds.update({ them: standing({ at: THEM, hitReactEpoch: 1 }) }, "me", 3000);
    sounds.update({ them: standing({ at: THEM, hitReactEpoch: 1, respawnCount: 1, motionState: "Stagger" }) }, "me", 4000);
    expect(slots()).toEqual(["character.bump", "character.hit_land", "character.respawn"]);
  });

  it("is silent for an eliminated Character", () => {
    const { engine, played } = fakeEngine();
    const sounds = new CharacterSounds(engine, world);
    sounds.update({ them: standing({ at: THEM }) }, "me", 0);
    sounds.update(
      {
        them: standing({
          at: THEM,
          eliminated: true,
          motionState: "Ragdoll",
          ragdollEpoch: 1,
          ragdollCause: "Disconnect",
          hitReactEpoch: 1,
          hitEpoch: 1,
        }),
      },
      "me",
      16,
    );
    expect(played).toEqual([]);
  });
});
