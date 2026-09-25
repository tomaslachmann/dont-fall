import { lengthVec3, normalizeVec3, scaleVec3, subVec3, type Vec3 } from "../math/vec3.js";
import { surfaceConfig } from "../track/Surface.js";
import { BOT_BELT_HEIGHT_M, BOT_BELT_MIN_OWN_SPEED } from "../tuning/bots.js";
import { CAPSULE_BOTTOM_OFFSET, WALK_SPEED } from "../tuning/character.js";
import type { BotTrack } from "./Bot.js";
import type { HookContext, PushHook } from "./hooks.js";
import { navSurfaceAt } from "./navMesh.js";
import type { Steering } from "./PathBot.js";

/*
 * M17 ticket 07c: a belt is a cost or a gift along its direction (ADR 0064),
 * never a mechanism a Bot plans a route round (that is a new item, if the
 * user wants it — see the ticket's "Out of scope"). What this file does is
 * bend a Bot's own steering for the floor's flow under it, and hand the
 * guard that flow (`Steering.drift`) so `EdgeGuard` never lets a belt carry
 * a Bot past an edge unnoticed.
 */

/**
 * The belt flow (world, horizontal, units/s) under a capsule at `position`,
 * from the Track's `conveyors` deck frames (the same source the renderer
 * draws and `resolveTrack` gave physics), or `null`. A linear scan: the
 * authored Tracks have at most ~20 belts. A belt on a Moving Segment is
 * never matched here — none is authored (M17 ticket 07's groundwork), and
 * `resolved.conveyors`' deck frames are the Track's rest-pose ones.
 */
export const beltUnder = (track: BotTrack, position: Vec3): Vec3 | null => {
  const { conveyors } = track.resolved;
  for (let i = 0; i < conveyors.length; i += 1) {
    const belt = conveyors[i]!;
    const { center, yaw, halfX, halfZ } = belt.deck;
    if (Math.abs(position.y - CAPSULE_BOTTOM_OFFSET - center.y) > BOT_BELT_HEIGHT_M) continue;
    const dx = position.x - center.x;
    const dz = position.z - center.z;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    if (Math.abs(lx) <= halfX && Math.abs(lz) <= halfZ) return belt.velocity;
  }
  return null;
};

/**
 * The push hook a belt bends a Bot's steering with (M17 ticket 07c): the
 * along-belt component of a Bot's move saturates (a belt faster than a walk
 * wins, ADR 0064), and the across-belt component is compensated away, so a
 * Bot crossing a cross belt walks a straight line instead of a diagonal into
 * the wall or the edge. A stand on a belt **holds its ground** (M17 ticket
 * 07g): the move is the belt's flow reversed, as much of a walk as the flow
 * is, so a Bot holding for a sweeper, waiting its turn or standing at its
 * goal is not carried off by the belt (measured on the base race's belt
 * climb: a held Bot was carried back three metres a hold, and walked them
 * again into the same wall). The guard is told the flow (`Steering.drift`)
 * either way, so edge recovery (already `EdgeGuard`'s own) carries a
 * drifting Bot back in. Stateless: one instance is shared by every Bot
 * (`defaultHooks`).
 */
export class BeltPush implements PushHook {
  compensate(ctx: HookContext, steering: Steering): Steering {
    const f = beltUnder(ctx.view.track, ctx.self.position);
    if (f === null) return steering;
    const surface = surfaceConfig(navSurfaceAt(ctx.view.track.nav, ctx.self.position) ?? undefined);
    const walk = WALK_SPEED * surface.topSpeedMultiplier;
    if (steering.moveDirection.x === 0 && steering.moveDirection.z === 0) {
      const flow = lengthVec3(f);
      if (flow < BOT_BELT_MIN_OWN_SPEED || walk <= 0) return { ...steering, drift: f };
      // The sim reads a move's length as a share of the walk, so this stands still on a belt slower than a walk.
      return { ...steering, moveDirection: scaleVec3(f, -Math.min(1, flow / walk) / flow), drift: f };
    }
    const wish = scaleVec3(steering.moveDirection, walk);
    const own = subVec3(wish, f);
    if (lengthVec3(own) < BOT_BELT_MIN_OWN_SPEED) return { ...steering, drift: f };
    return { ...steering, moveDirection: normalizeVec3(own), drift: f };
  }
}
