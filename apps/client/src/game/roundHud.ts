import {
  controlLabel,
  DASH_COOLDOWN_MS,
  SPIN_OVERSPIN_MS,
  SPIN_WINDUP_MS,
  survivalCritical,
  threatBehind,
  TICK_MS,
  type BombState,
  type HeldPhase,
  type KeyBindings,
  type LiveRace,
  type MatchPhase,
  type Racer,
  type RoundRules,
} from "@dont-fall/shared";

/**
 * A hold this client's Character is in, at either end (ADR 0104) — the
 * design's `Grabbed` over the live Round for the one held, `HoldingPanel`
 * for the one holding. Every fraction is rounded to twentieths, like the Dash
 * meter (ADR 0088), and the time to tenths.
 */
export type HoldHud =
  | {
      role: "held";
      /** Who has you. */
      by: string;
      phase: HeldPhase;
      /** The escape meter, 0–1 — your own prediction of it, so a wiggle shows at once. */
      escape: number;
      /** The two keys to wiggle between, as the Player has them bound (left, right). */
      wiggleKeys: [string, string];
    }
  | {
      role: "grabbing";
      /** Who you have. */
      holding: string;
      phase: HeldPhase;
      /** How close they are to getting free, 0–1 — the server's word on their meter. */
      escape: number;
      /** Time left in the current window — the Struggle's, then your Limp window — floored to tenths of a second. */
      timeLeftMs: number;
      /** How far your Spin has wound up, 0–1 — your own prediction of it. */
      windup: number;
      /** How far past full speed you have held it, 0–1: at 1 you are dizzy. */
      overspin: number;
      /** Hit's key (hold to Spin, let go to Hurl) and Grab's (let go), as bound. */
      spinKey: string;
      letGoKey: string;
    }
  | {
      /** Carrying a Prop (ADR 0125): nothing to fight back, no window — only the throw. */
      role: "carrying";
      /** What you carry, as the panel names it ("CONE"). */
      holding: string;
      /** A lit Bomb's fuse (ADR 0126), floored to tenths of a second — absent for anything else. */
      fuseMs?: number;
      windup: number;
      overspin: number;
      /** Hit's key (tap to toss, hold to Spin) and Grab's (put down), as bound. */
      spinKey: string;
      letGoKey: string;
    };

/**
 * What both Round HUDs show regardless of type (ADR 0088/0092) — the Dash
 * meter, which is the same fact and the same bar on a Race and on a Survival
 * Round, and a hold (ADR 0104), which is too.
 */
export interface RoundHudCommon {
  /**
   * How far the Dash has recharged, 0–1. Rounded to twentieths: the raw
   * cooldown counts down every one of the 30 snapshots a second, and ADR 0088
   * is explicit that the HUD is fed what is *drawn*, not what is known — at
   * 5% steps a 15 s recharge raises React twenty times instead of 450.
   */
  dashCharge: number;
  /**
   * Whether the Dash can fire right now. Read off the cooldown exactly, never
   * off {@link dashCharge} — a bar rounded up to 1 a fifth of a second early
   * would promise a Dash the simulation would refuse.
   */
  dashReady: boolean;
  /**
   * Whole seconds until the Dash is back, rounded up — the charge card's
   * RECHARGES IN (ADR 0110). Whole seconds for the same reason as
   * {@link dashCharge}: a tenth would raise React ten times a second.
   */
  dashRechargeS: number;
  /** The Dash's key, as the charge card names it. */
  dashKey: string;
  /** The hold you are in, either end, or `null` (ADR 0104). */
  hold: HoldHud | null;
}

/** The Race HUD's facts (ADR 0088), every number already rounded to what is drawn. */
export interface RaceHudSnapshot extends RoundHudCommon {
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
export interface SurvivalHudSnapshot extends RoundHudCommon {
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
  /** Whether that Player left the Match rather than fell out of the Round (ADR 0110) — a disconnect eliminates too. */
  lastOutLeft: boolean;
  critical: boolean;
}

export type RoundHudSnapshot = RaceHudSnapshot | SurvivalHudSnapshot;

/** The slice of a replicated Character the HUD reads. */
export interface HudCharacter extends Racer {
  eliminated: boolean;
  eliminatedTick: number | null;
  /** Milliseconds until this Character may Dash again; 0 when it may now (ADR 0092). */
  dashCooldownMs: number;
  /** Both ends of a hold, and where it has got to (ADR 0104). */
  grabbingId: string | null;
  /** The Prop this Character carries, by index (ADR 0125). */
  carryingProp: number | null;
  heldByGrabberId: string | null;
  heldPhase: HeldPhase | null;
  holdEndsTick: number | null;
  escapeProgress: number;
}

/** What this client's own prediction says about its end of a hold — ahead of any snapshot (ADR 0104). */
export interface PredictedHold {
  escapeProgress: number;
  spinMs: number;
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
  /** What the Prop at an index is called (ADR 0125). */
  propLabelOf: (index: number) => string;
  /** Every Bomb that is not lying (ADR 0126) — the snapshot's `bombs`. */
  bombs: readonly BombState[];
  /** Who dropped out of this Round by leaving the Match (the snapshot's `dnf`). */
  leftIds: readonly string[];
  /** The snapshot's Tick — what a hold's `holdEndsTick` counts down to. */
  tick: number;
  predicted: PredictedHold;
  bindings: KeyBindings;
}

/** A fraction rounded to what a bar draws. */
const twentieths = (fraction: number): number => Math.round(Math.min(1, Math.max(0, fraction)) * 20) / 20;

/** The first control bound to `controls`, in the HUD's short dialect, or `—` when there is none. */
const keyOf = (controls: readonly string[]): string => (controls.length > 0 ? controlLabel(controls[0]!, "short") : "—");

/**
 * The hold `me` is in, at either end, for the HUD (ADR 0104). Who, which part
 * and how long are the server's; the meter the held Player is filling and the
 * Spin the grabber is winding are that Player's own prediction, so each moves
 * the instant its key is pressed.
 */
export const buildHoldHud = (input: RoundHudInput, me: HudCharacter): HoldHud | null => {
  const { characters, predicted, bindings } = input;
  if (me.carryingProp !== null) {
    const detonateTick = input.bombs.find((row) => row.propIndex === me.carryingProp)?.detonateTick;
    return {
      role: "carrying",
      holding: input.propLabelOf(me.carryingProp),
      ...(detonateTick === undefined
        ? {}
        : { fuseMs: Math.floor((Math.max(0, detonateTick - input.tick) * TICK_MS) / 100) * 100 }),
      windup: twentieths(predicted.spinMs / SPIN_WINDUP_MS),
      overspin: twentieths((predicted.spinMs - SPIN_WINDUP_MS) / SPIN_OVERSPIN_MS),
      spinKey: keyOf(bindings.hit),
      letGoKey: keyOf(bindings.grab),
    };
  }
  const heldRow = me.heldByGrabberId !== null ? me : me.grabbingId !== null ? characters[me.grabbingId] : undefined;
  if (!heldRow || heldRow.heldPhase === null) return null;
  if (me.heldByGrabberId !== null) {
    return {
      role: "held",
      by: input.nicknameOf(me.heldByGrabberId),
      phase: heldRow.heldPhase,
      escape: twentieths(predicted.escapeProgress),
      wiggleKeys: [keyOf(bindings.left), keyOf(bindings.right)],
    };
  }
  const ticksLeft = heldRow.holdEndsTick === null ? 0 : Math.max(0, heldRow.holdEndsTick - input.tick);
  return {
    role: "grabbing",
    holding: input.nicknameOf(me.grabbingId!),
    phase: heldRow.heldPhase,
    escape: twentieths(heldRow.escapeProgress),
    timeLeftMs: Math.floor((ticksLeft * TICK_MS) / 100) * 100,
    windup: twentieths(predicted.spinMs / SPIN_WINDUP_MS),
    overspin: twentieths((predicted.spinMs - SPIN_WINDUP_MS) / SPIN_OVERSPIN_MS),
    spinKey: keyOf(bindings.hit),
    letGoKey: keyOf(bindings.grab),
  };
};

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
  // ADR 0092: your own Dash recharge, on both HUDs. Off the snapshot rather
  // than the prediction, like everything else here — a Dash is a fifteen-
  // second wait, so a round trip's worth of lag on the bar is invisible.
  const common: RoundHudCommon = {
    dashCharge: Math.round((1 - Math.min(1, Math.max(0, me.dashCooldownMs / DASH_COOLDOWN_MS))) * 20) / 20,
    dashReady: me.dashCooldownMs <= 0,
    dashRechargeS: Math.ceil(Math.max(0, me.dashCooldownMs) / 1000),
    dashKey: keyOf(input.bindings.dash),
    hold: buildHoldHud(input, me),
  };

  if (roundRules.fallBehavior === "eliminate") {
    const alive = ids.filter((id) => !characters[id]!.eliminated).sort((a, b) => (a === myId ? -1 : b === myId ? 1 : a.localeCompare(b)));
    let lastOut: { id: string; tick: number } | null = null;
    for (const id of ids) {
      const tick = characters[id]!.eliminatedTick;
      if (characters[id]!.eliminated && tick !== null && (lastOut === null || tick > lastOut.tick)) lastOut = { id, tick };
    }
    return {
      ...common,
      kind: "survival",
      remaining: alive.length,
      startedWith: ids.length,
      alive,
      youAlive: !me.eliminated,
      survivedMs: Math.floor(elapsedMs / 1000) * 1000,
      lastOut: lastOut === null ? null : input.nicknameOf(lastOut.id),
      lastOutLeft: lastOut !== null && input.leftIds.includes(lastOut.id),
      critical: survivalCritical(alive.length, roundRules.survivorTarget, input.timeLeftMs),
    };
  }

  const places = input.liveRace?.places ?? {};
  const threatId = input.liveRace ? threatBehind(myId, places, characters) : null;
  return {
    ...common,
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
