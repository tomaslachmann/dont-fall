import {
  survivalCritical,
  threatBehind,
  type LiveRace,
  type MatchPhase,
  type Racer,
  type RoundRules,
} from "@dont-fall/shared";

/** The Race HUD's facts (ADR 0088), every number already rounded to what is drawn. */
export interface RaceHudSnapshot {
  kind: "race";
  /** Your placement in this Round if it ended now; `null` until the server has placed you. */
  place: number | null;
  /** Everyone in the Round, you included. */
  field: number;
  /** Time since the Round started, floored to tenths — the clock never shows finer. */
  elapsedMs: number;
  checkpointsReached: number;
  checkpoints: number;
  /** Your split at your latest Checkpoint, whole ms; `null` while there is none to show. */
  splitMs: number | null;
  /** Who is right behind you, or `null`. */
  threat: { id: string; nickname: string } | null;
}

/** The Survival HUD's facts (ADR 0088). No placement: the measure is how many are left. */
export interface SurvivalHudSnapshot {
  kind: "survival";
  remaining: number;
  startedWith: number;
  /** Everyone still standing, you first while you are. */
  alive: string[];
  /** Whether you are still standing — and so `alive[0]`. */
  youAlive: boolean;
  /** Time since the Round started, floored to whole seconds. */
  survivedMs: number;
  /** The nickname of whoever was Eliminated last, or `null` before anyone was. */
  lastOut: string | null;
  critical: boolean;
}

export type RoundHudSnapshot = RaceHudSnapshot | SurvivalHudSnapshot;

/** The slice of a replicated Character the HUD reads. */
export interface HudCharacter extends Racer {
  eliminated: boolean;
  eliminatedTick: number | null;
}

export interface RoundHudInput {
  myId: string;
  phase: MatchPhase;
  roundRules: RoundRules;
  timeLeftMs: number;
  characters: Record<string, HudCharacter>;
  liveRace: LiveRace | null;
  /** How many Checkpoints the loaded Track has. */
  checkpoints: number;
  nicknameOf: (id: string) => string;
}

/**
 * The Round HUD's whole input, off one server snapshot (ADR 0088) — `null`
 * outside RUNNING, or for a client with no Character in the Round (a
 * mid-Match spectator). Every value is rounded to what the HUD draws, so the
 * caller's JSON dedupe raises React only when something visible changed.
 */
export const buildRoundHud = (input: RoundHudInput): RoundHudSnapshot | null => {
  const { myId, characters, roundRules } = input;
  const me = characters[myId];
  if (input.phase !== "RUNNING" || me === undefined) return null;
  const elapsedMs = Math.max(0, roundRules.timeLimitMs - input.timeLeftMs);
  const ids = Object.keys(characters);

  if (roundRules.fallBehavior === "eliminate") {
    const alive = ids.filter((id) => !characters[id]!.eliminated).sort((a, b) => (a === myId ? -1 : b === myId ? 1 : a.localeCompare(b)));
    let lastOut: { id: string; tick: number } | null = null;
    for (const id of ids) {
      const tick = characters[id]!.eliminatedTick;
      if (characters[id]!.eliminated && tick !== null && (lastOut === null || tick > lastOut.tick)) lastOut = { id, tick };
    }
    return {
      kind: "survival",
      remaining: alive.length,
      startedWith: ids.length,
      alive,
      youAlive: !me.eliminated,
      survivedMs: Math.floor(elapsedMs / 1000) * 1000,
      lastOut: lastOut === null ? null : input.nicknameOf(lastOut.id),
      critical: survivalCritical(alive.length, roundRules.survivorTarget, input.timeLeftMs),
    };
  }

  const places = input.liveRace?.places ?? {};
  const threatId = input.liveRace ? threatBehind(myId, places, characters) : null;
  return {
    kind: "race",
    place: places[myId] ?? null,
    field: ids.length,
    elapsedMs: Math.floor(elapsedMs / 100) * 100,
    checkpointsReached: (me.checkpointIndex ?? -1) + 1,
    checkpoints: input.checkpoints,
    splitMs: input.liveRace?.splits[myId]?.gapMs ?? null,
    threat: threatId === null ? null : { id: threatId, nickname: input.nicknameOf(threatId) },
  };
};
