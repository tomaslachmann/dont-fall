# 10 — Bots fill a Lobby

**What to build:** the host's settings and the fill. In a **private** Lobby the host picks how
many Bots and their level. In a **public** Lobby the host ticks whether Bots are allowed and
sets a maximum and the level. The places left open fill with Bots **when the Round starts**,
up to that number and never past capacity; a live Reservation (ADR 0112) holds its place
before any Bot. A Bot looks like a Player (ADR 0129).

**Blocked by:** 03

**Status:** done on tests (2026-09-24)

- [x] Protocol: `setBots { enabled, max, level }`, host-only and LOBBY-only, enforced by the
      server (like `setMatchLength`); the settings ride the Lobby snapshot
- [x] UI: the controls composed from the design mocks' existing pieces in the private Lobby setup
      (M15 ticket 14) and the public Lobby's host panel. No invented visuals
- [x] Fill at start: `min(max, capacity − sockets − live Reservations)` Bots, seats given
      join orders after every human (so a Bot is never host)
- [x] Identity: a generated nickname from a list that reads like real display names, a random
      Colour or Skin and Hat from the whole catalogue. The same Bot keeps them for the whole Match
- [x] Bots stay for every Round of the Match and leave when the Lobby returns to LOBBY (the next
      start fills afresh)
- [x] Account-less participants: results, `personal_bests`, career, Leaderboards, Betting and
      `trackPlays` already key on `accountId`. A test per path proves a Bot row is skipped and a
      Bot can still place, qualify and win
- [x] Nothing that needs an Account shows for a Bot: profile, Friend request, invite, Mute and
      voice. Those controls follow `accountId`, the same way an anonymous seat's already do (checked)

## As built

**Settings (`packages/shared/src/match/LobbyBots.ts`).**

- `LobbyBots { enabled, max, level }` is one shape for both kinds of Lobby, and `BotLevel` is
  `"easy" | "normal" | "hard"` on the wire, like a Round type. A private host's count is `max`,
  with 0 meaning `enabled: false`. A public host ticks `enabled` and sets `max`.
- `defaultLobbyBots(maxPlayers)` is off, with `max` at capacity less the host, so ticking Bots on
  in a public Lobby fills it. `invalidLobbyBotsReason` is the one rule both the Lobby message and
  `POST /lobbies` apply: `max` is a whole number from 0 to `maxPlayers − 1`, because the host
  always holds a seat. `botsToFill(bots, free)` is `min(max, free)`, or 0 when off.
- `DEFAULT_BOT_LEVEL` and `BOT_SKIN_CHANCE` are in `tuning/match.ts`.

**Protocol.** `SetBotsMessage { type: "setBots", enabled, max, level }`. The snapshot carries
`lobby.bots: LobbyBots`, Lobby-scoped like `matchLength`. It is a setting, and no roster row
says which seat is a Bot. `lobby.ts` holds the message to the same rules as `setMatchLength`:
host only, LOBBY only, refused once `startRequested`, validated whole and never clamped.
`POST /lobbies` also takes `bots` for PlaySelect's private setup. It is validated by the API
and reaches the Match server as `StartServerConfig.bots`, like `matchLength`: where the host
starts, not a lock.

**The fill (`MatchRuntime.fillBots`).**

- It runs in the `start` handler the moment `start` is accepted: still LOBBY, before the tick that
  leaves it. The Round's betting board therefore opens with the Bots as runners, and the world
  loads with them in it.
- It seats `botsToFill()` Bots, which is `min(max, maxPlayers − seatsTaken())`. `seatsTaken`
  counts live Reservations, so a Reservation always wins. (Today `start` is also refused while
  any Reservation is live, ADR 0112, so the two never actually meet at a start.) Nothing takes a
  place in between: `reserveSeats` refuses once `startRequested`, and a connection is counted
  against every seat, Bots included.
- Each Bot goes through ticket 03's `addBot(identity)` and takes the next join order, so it
  comes after every human already here.

**The start rule.** `start` passes when `sockets + botsToFill() ≥ playersToStart`, so a host
alone can start against Bots. `canContinueMatch` counts Bots the same way, with at least one
connection, so the host alone plays every Round of the Match.

**A Bot is never host.** `MatchRuntime.hostId()` resolves the host over the human rows only.
Every host-only gate in `lobby.ts` and the snapshot's `hostId` read it; nothing on the server
calls `resolveHostId` over the whole roster any more. That covers ticket 03's case: a Bot seated
in LOBBY ahead of a later human, and the humans before it leaving.

**Identity (`packages/shared/src/match/botIdentity.ts`).**

- `BOT_NICKNAMES` holds 64 names that read like picked display names.
- `botIdentities(seed, count, taken)` draws names without repeats, never one already in the
  Lobby (ignoring case), and adds a number past the end of the list.
- Each Bot wears a Colour or a Skin, never both, and always a Hat, from the whole catalogue: a
  Bot has no level, so nothing is locked to it.
- The PRNG is mulberry32 over an FNV-1a hash, never `Math.random()`. The server seeds it with
  `${matchId}:${serverTick}` at the start.
- The fill happens once per Match, so a Bot keeps its identity for every Round.

**Lifetime.** `resetToFreshLobby` takes every Bot out before its rebuild: a Track pick, a
Playtest reload, and every return to LOBBY. It skips `removeBot`'s DNF, since whatever Round
they were in is over. The settings stay, so the next start fills afresh with new identities.
Ticket 03's "a Bot leaves with the last connection" is unchanged. So a Bot could now be in
LOBBY only by a direct `addBot` (ticket 03's test hook).

**Account-less paths, one test each.**

| Path | Test |
|---|---|
| results | `matches.test.ts`: a Bot's win stays on the stored results, `accountIds` names only the Player. The server test also checks the save names the Bots in every Round and attributes nothing to them. |
| `personal_bests` | `personalBests.test.ts`: `personalBestRuns`, pulled out of the loop as a pure function, skips a Bot that finished first and still reports the Player. |
| career | `career.test.ts`: a winning Bot leaves no row, and the beaten Player reads 2nd, no win. |
| Leaderboards | `leaderboards.test.ts`: a Bot that won and outlasted a Player is on neither board. |
| Betting | `betting.test.ts`: a Bot is a runner on the board and can be the Round's winner. |
| `trackPlays` | `matchRuntime.botFill.test.ts`: a two-Round Match with Bots records exactly one play per Round. |

**Betting, the conservative reading (settled here):** a Bot is never a *bettor*, since placing a
bet needs an Account. It stays a *runner* one can bet on, because it is a full participant that
looks like a Player, and hiding it from the board would mark it. No change was needed:
`openBettingArgs` already lists every seated row.

**Account-gated controls, checked.** Profile, Friend request, invite, Mute and voice all follow
`accountId`, and an anonymous seat already shows none of them. Nothing needed fixing:

- **Profile** is the Player's own; no Screen opens someone else's.
- **Friend requests** come from RECENT, which is `match_participants` and has no Bot rows.
- **Invites** go to Friends only.
- **Mutes** and the pause sheet's voice rows are the voice room's `linked` Accounts.
- **Voice**: the room is `AccountRoster`, Accounts only. The Lobby's MUTED chip and speaking
  ring are gated on `accountId !== null`.

**UI.** Everything is composed from pieces the setup already uses: `Stepper` and `Toggle`, in
the existing `setupHead` rows. There is no new CSS.

- **PlaySelect → CREATE PRIVATE LOBBY:** a BOTS stepper (0 to lobby size − 1). A BOT LEVEL
  toggle (EASY / NORMAL / HARD) appears once there are Bots. `bots` is sent only when there
  are some.
- **Lobby setup panel, private:** BOTS stepper, then BOT LEVEL when above 0.
- **Lobby setup panel, public:** ALLOW BOTS OFF/ON toggle; with ON, a MAX BOTS stepper and
  BOT LEVEL.
- A guest sees the values as text.

**For ticket 08:** the level is stored (`rt.lobbyBots.level`, fixed once `start` is sent) but no
Bot reads it yet, because `BotDriver.add(id)` takes no level and that file is ticket 04's. When
08 builds profiles, `addBot` should hand `this.lobbyBots.level` to `BotDriver.add(id, level)`.
`BotLevel` lives in `match/LobbyBots.ts`, where 08 can import it.

**Open questions (conservative choices made):**

- A Bot who leaves mid-Match is never replaced, and a human who leaves is not refilled. The fill
  happens once, at the start.
- A public Lobby's Bot settings belong to whoever hosts. When the host changes, the new host
  inherits them.
- Quick Match Lobbies start with Bots off. Nothing matchmade turns them on until ticket 15
  (M15) decides auto-start.

