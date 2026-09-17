import {
  addVec3,
  airColumnFrame,
  CONVEYOR_SPEEDS,
  conjugateQuat,
  dotVec3,
  holdsAloft,
  lengthVec3,
  movingSegmentPose,
  mulQuat,
  rotateVec3ByQuat,
  scaleVec3,
  subVec3,
  type AirColumnFrame,
  type ConveyorBelt,
  type DeckFrame,
  type MovingSegmentConfig,
  type Vec3,
  type VolumeConfig,
} from "@dont-fall/shared";
import type { LoopHandle, SoundEngine } from "./engine.js";
import type { SoundSlot } from "./slots.js";

/** A Volume's force (units/s²) whose fan hums at full volume: the fan Asset's own updraft. */
export const FAN_LOUD_FORCE = 40;
/** The quietest a fan's hum or a column's rush gets, as a share of full. */
export const AIR_GAIN_FLOOR = 0.3;
/** A belt's rattle rate at a standstill, and at the fastest preset. */
export const BELT_RATE_FROM = 0.8;
export const BELT_RATE_TO = 1.2;
/** A Spring's settle: its knock, lifted. */
export const SPRING_SETTLE_RATE = 1.4;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** How loud a fan or its column is for a Volume pushing with `force`. */
export const airLevel = (force: Vec3): number => clamp(lengthVec3(force) / FAN_LOUD_FORCE, AIR_GAIN_FLOOR, 1);

/** A belt's rattle rate at `speed` (units/s). */
export const beltRate = (speed: number): number =>
  BELT_RATE_FROM + (BELT_RATE_TO - BELT_RATE_FROM) * clamp(speed / CONVEYOR_SPEEDS.fast, 0, 1);

/** The point of a deck's top rectangle nearest to `point`. */
export const nearestPointOnDeck = (point: Vec3, deck: Pick<DeckFrame, "center" | "orientation" | "halfX" | "halfZ">): Vec3 => {
  const local = rotateVec3ByQuat(subVec3(point, deck.center), conjugateQuat(deck.orientation));
  const onDeck = { x: clamp(local.x, -deck.halfX, deck.halfX), y: 0, z: clamp(local.z, -deck.halfZ, deck.halfZ) };
  return addVec3(deck.center, rotateVec3ByQuat(onDeck, deck.orientation));
};

/** The point of an air column (a cylinder along its flow) nearest to `point`. */
export const nearestPointInColumn = (point: Vec3, column: AirColumnFrame): Vec3 => {
  const relative = subVec3(point, column.entry);
  const along = clamp(dotVec3(relative, column.axis), 0, column.length);
  const out = subVec3(relative, scaleVec3(column.axis, dotVec3(relative, column.axis)));
  const outLength = lengthVec3(out);
  const radial = outLength > column.halfWidth ? scaleVec3(out, column.halfWidth / outLength) : out;
  return addVec3(column.entry, addVec3(scaleVec3(column.axis, along), radial));
};

/**
 * Where a belt's deck is at `tick`: its rest frame, carried by its Moving
 * Segment when it rides one.
 */
export const beltDeckAt = (deck: DeckFrame, carrier: MovingSegmentConfig | undefined, tick: number): DeckFrame => {
  if (!carrier) return deck;
  const pose = movingSegmentPose(carrier, tick);
  const toCarrier = conjugateQuat(carrier.orientation);
  const local = rotateVec3ByQuat(subVec3(deck.center, carrier.position), toCarrier);
  return {
    ...deck,
    center: addVec3(rotateVec3ByQuat(local, pose.rotation), pose.position),
    orientation: mulQuat(pose.rotation, mulQuat(toCarrier, deck.orientation)),
  };
};

/** The machines on a Track, as their sounds see them. */
export interface SoundedMachines {
  volumes: readonly VolumeConfig[];
  conveyors: readonly ConveyorBelt[];
  movingSegments: readonly MovingSegmentConfig[];
}

/** The slots a Track's machines play: all a Stage needs to decode for them. */
export const machineSoundSlots = (track: {
  volumes?: readonly VolumeConfig[];
  conveyors?: readonly unknown[];
  launchPads?: readonly unknown[];
}): SoundSlot[] => {
  const slots: SoundSlot[] = [];
  const volumes = track.volumes ?? [];
  if (volumes.some(holdsAloft)) slots.push("segment.fan");
  if (volumes.some((volume) => airColumnFrame(volume) !== null)) slots.push("segment.air_rush");
  if ((track.conveyors ?? []).length > 0) slots.push("segment.belt");
  if ((track.launchPads ?? []).length > 0) slots.push("segment.spring_settle");
  return slots;
};

interface Belt {
  deck: DeckFrame;
  carrier: MovingSegmentConfig | undefined;
  loop: LoopHandle;
}

interface Column {
  frame: AirColumnFrame;
  rush: LoopHandle;
}

/**
 * The machines on a Track hum while you are near them (M14 ticket 08, ADR
 * 0087). Every one is a loop under the engine's nearest-k budget, silent past
 * its slot's `maxDistance`.
 *
 * - **Fans:** a Volume that holds a Character up hums at its entry face, where
 *   the fan is, louder the stronger its force.
 * - **Air columns:** every drawn column rushes at its point nearest the
 *   listener, so you hear the air you are standing in.
 * - **Belts:** a rattle at the point of the belt nearest the listener, faster
 *   for a faster belt, following a belt a Moving Segment carries.
 */
export class MachineSounds {
  private readonly columns: Column[];
  private readonly belts: Belt[];
  private readonly fans: LoopHandle[];

  constructor(engine: Pick<SoundEngine, "loop">, machines: SoundedMachines) {
    const drawn = machines.volumes.flatMap((volume) => {
      const frame = airColumnFrame(volume);
      return frame ? [{ volume, frame }] : [];
    });
    this.fans = drawn
      .filter(({ volume }) => holdsAloft(volume))
      .map(({ volume, frame }) => engine.loop("segment.fan", { at: frame.entry, gain: airLevel(volume.force) }));
    this.columns = drawn.map(({ volume, frame }) => ({
      frame,
      rush: engine.loop("segment.air_rush", { at: frame.entry, gain: airLevel(volume.force) }),
    }));
    this.belts = machines.conveyors.map((belt) => ({
      deck: belt.deck,
      carrier: machines.movingSegments.find((segment) => segment.segmentIndex === belt.segmentIndex),
      loop: engine.loop("segment.belt", {
        at: belt.deck.center,
        rate: beltRate(Math.hypot(belt.velocity.x, belt.velocity.y, belt.velocity.z)),
      }),
    }));
  }

  /** Once a frame, at the drawn Motion's `tick`, heard from `listener`. */
  update(tick: number, listener: Vec3): void {
    for (const { frame, rush } of this.columns) rush.set({ at: nearestPointInColumn(listener, frame) });
    for (const belt of this.belts) belt.loop.set({ at: nearestPointOnDeck(listener, beltDeckAt(belt.deck, belt.carrier, tick)) });
  }

  dispose(): void {
    for (const fan of this.fans) fan.stop();
    for (const { rush } of this.columns) rush.stop();
    for (const { loop } of this.belts) loop.stop();
  }
}
