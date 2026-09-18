import type { MatchRuntime } from "../match/matchRuntime.js";
import type { Vec3 } from "@dont-fall/shared";

/**
 * What a connection *is* to the Match — the one thing about a connection that
 * genuinely branches, named instead of spelled out as `if (spectating)` in
 * three places.
 *
 * Two kinds today. A Player is seated by the simulation and is a DNF if they
 * leave mid-Round (M4 ticket 05); a spectator is in the Lobby's list and in no
 * Round at all (M7 ticket 08), so they have no body to remove and no result to
 * spoil. A third kind (an admin monitor, say) is a third object here, not a
 * third branch in the connection handler.
 *
 * Note what a seat is *not*: the Track Builder's Playtest (`?track=`) is not a
 * kind of seat. It is a step a connection may perform before taking one —
 * reloading the Track — after which it sits down as an ordinary Player.
 */
export interface Seat {
  readonly kind: "player" | "spectator";
  /** Called once the connection is registered, with the spawn frame resolved for it. */
  take: (rt: MatchRuntime, id: string, spawn: Vec3) => void;
  /** Called on `'close'`, before the shared cleanup, while `lobbyPlayers` still holds this seat's row. */
  release: (rt: MatchRuntime, id: string, midRound: boolean) => void;
}

const PLAYER_SEAT: Seat = {
  kind: "player",
  take: (rt, id, spawn) => rt.simulation.addCharacter(id, spawn),
  release: (rt, id, midRound) => {
    // Leaving *while the Round is being raced* is a DNF (M4 ticket 05) — not
    // during the Countdown, where nobody has raced yet, and not during
    // ROUND_END/RESULTS, where this Player's result is already decided and a
    // DNF would overwrite a Qualification they earned. The nickname is
    // captured here because `lobbyPlayers` is the only place it lives, and
    // the Results Screen has nothing else to call them by.
    if (midRound && !rt.dnf.some((entry) => entry.id === id)) {
      const row = rt.lobbyPlayers.get(id);
      rt.dnf.push({
        id,
        nickname: row?.nickname ?? "Player",
        accountId: row?.accountId ?? null,
        color: row?.color ?? null,
        skin: row?.skin ?? null,
        hat: row?.hat ?? null,
      });
    }
    // Eliminated, not removed, mid-Round (M5 ticket 04, ADR 0042): pulling a
    // rigid body out of the world would disturb contact resolution for
    // everyone still racing. Outside RUNNING nobody is relying on this body,
    // so a plain removal is still correct and cheaper.
    if (midRound) rt.simulation.eliminateCharacter(id);
    else rt.simulation.removeCharacter(id);
  },
};

const SPECTATOR_SEAT: Seat = {
  kind: "spectator",
  take: (rt, id) => rt.spectators.add(id),
  // Nothing: they never raced, so there is no result to record, and no
  // simulation ever seated them, so there is no body to take out.
  release: () => {},
};

/**
 * Which seat a fresh connection takes (M7 ticket 08). Joining mid-Match
 * spectates: dropping a fresh Character into a Race already in progress is
 * unfair both ways. COUNTDOWN still seats — the Round has not begun racing, so
 * arriving before it starts is joining it, not interrupting it.
 *
 * Gated on someone actually being here, not on the phase alone: the return to
 * LOBBY is decided by the tick loop, so between the last Player leaving and
 * the next tick the phase still reads RESULTS with nobody in it, and a Round
 * with no Players in it is not a Round to protect.
 */
export const seatForJoin = (rt: MatchRuntime): Seat =>
  rt.sockets.size > 0 && rt.match.phase !== "LOBBY" && rt.match.phase !== "COUNTDOWN" ? SPECTATOR_SEAT : PLAYER_SEAT;

/**
 * Which seat a connection holds *now* — re-read rather than remembered from
 * join, and that is load-bearing: `resetToFreshLobby` clears `spectators`, so
 * a spectator who waited out a Match is a seated Player in the next one. A
 * seat captured at join would leave that Character's body in the world forever.
 */
export const seatOf = (rt: MatchRuntime, id: string): Seat => (rt.spectators.has(id) ? SPECTATOR_SEAT : PLAYER_SEAT);
