import { State } from "mistreevous";
import type { Vec3 } from "../math/vec3.js";
import type { PlacedGate } from "../track/Gate.js";
import { BOT_GATE_THROUGH_M } from "../tuning/bots.js";
import type { BotWorldView } from "./Bot.js";
import { forkArms } from "./forks.js";
import type { Route } from "./PathBot.js";
import { botDraw } from "./random.js";
import type { BotContext, BotGoal } from "./TreeBot.js";

const groundDistance = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.z - a.z);

/** The leg a racer is on: which Checkpoint it runs to (the Checkpoint count for the finish), and where that is. */
interface Leg {
  index: number;
  /** Where the leg's gate or trigger is: what the fork arms are found toward. */
  centre: Vec3;
  /** Where to run: through the gate, or into the trigger. */
  target: Vec3;
}

/**
 * A point {@link BOT_GATE_THROUGH_M} past a gate on the side away from the
 * racer (ADR 0068: a gate counts when it is crossed, either way), at the
 * opening's lowest edge so the navmesh under it is found however tall the
 * gate is.
 */
const throughGate = (gate: PlacedGate, from: Vec3): Vec3 => {
  const length = Math.hypot(gate.n.x, gate.n.z);
  if (length === 0) return gate.center;
  const nx = gate.n.x / length;
  const nz = gate.n.z / length;
  const side = (from.x - gate.center.x) * nx + (from.z - gate.center.z) * nz >= 0 ? -1 : 1;
  return { x: gate.center.x + side * nx * BOT_GATE_THROUGH_M, y: gate.origin.y, z: gate.center.z + side * nz * BOT_GATE_THROUGH_M };
};

/**
 * The next Checkpoint in order, then the nearest Finish Zone (ADR 0039), or
 * `null` once this racer has finished, is out, or the Track has nowhere to
 * run to.
 */
const legOf = ({ self, track }: BotWorldView): Leg | null => {
  if (self.finishTick !== null || self.eliminated) return null;
  const { checkpoints, finishZones } = track.resolved;
  const index = (self.checkpointIndex ?? -1) + 1;
  const place = (zone: { gate?: PlacedGate | undefined; trigger?: { center: Vec3 } | undefined }): Leg => {
    const gate = zone.gate;
    const centre = gate ? gate.center : zone.trigger!.center;
    return { index, centre, target: gate ? throughGate(gate, self.position) : centre };
  };
  if (index < checkpoints.length) return place(checkpoints[index]!);
  let nearest: Leg | null = null;
  for (const zone of finishZones) {
    const leg = place(zone);
    if (nearest === null || groundDistance(self.position, leg.centre) < groundDistance(self.position, nearest.centre)) nearest = leg;
  }
  return nearest;
};

/**
 * This Bot's arm of the leg's fork, if the leg forks: its own seeded
 * preference, drawn once per leg, so a Lobby's Bots spread across the arms
 * (M17 ticket 04). The arms are found from the Checkpoint before the leg (the
 * first Bot's own spot for the first leg) and kept on the {@link BotTrack}.
 */
const armOf = (bot: BotContext, leg: Leg): Vec3 | null => {
  const { track, self } = bot.view;
  let arms = track.forks.get(leg.index);
  if (arms === undefined) {
    const from = leg.index > 0 ? track.resolved.checkpoints[leg.index - 1]!.respawn : self.position;
    arms = forkArms(track.nav, from, leg.centre);
    track.forks.set(leg.index, arms);
  }
  if (arms.length === 0) return null;
  return arms[Math.floor(botDraw(bot.seed, `fork ${leg.index}`) * arms.length)]!;
};

const raceRoute = (bot: BotContext, leg: Leg): Route => ({
  target: leg.target,
  via: armOf(bot, leg),
  // A new Checkpoint, a Respawn at the last one, or getting up somewhere: run the leg afresh.
  key: `${leg.index}:${bot.view.self.respawnCount}:${bot.recoveries}`,
  // Only a new leg or a Respawn sends the Bot through its arm again (M17 ticket 05).
  viaKey: `${leg.index}:${bot.view.self.respawnCount}`,
});

/**
 * The Race (M17 ticket 04, ADR 0129): Checkpoint to Checkpoint to the Finish
 * Zone over the navmesh. After a Fall the Respawn puts the Bot back on its
 * Checkpoint and the leg is planned again from there; after a knockdown, from
 * wherever it got up.
 */
export const RACE_GOAL: BotGoal = {
  tree: `
root [Goal] {
  sequence {
    condition [IsRacing]
    action [RunTheLeg]
  }
}
`,
  leaves: {
    IsRacing: ({ view }) => legOf(view) !== null,
    RunTheLeg: (bot) => {
      const leg = legOf(bot.view);
      if (leg === null) return State.FAILED;
      bot.run(raceRoute(bot, leg));
      return State.SUCCEEDED;
    },
  },
};
