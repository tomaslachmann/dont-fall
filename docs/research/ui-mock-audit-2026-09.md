# UI mock audit (2026-09-19)

The user's ask: go through the UI and resolve what is still mocked ("beans online" and the like).
Three read-only sweeps covered every production Screen, the in-Round HUD, the routes that feed them
and the API/match-server producers behind each value. Nothing was changed by the sweep itself.

A value counts as **real** only when the production path (the route in `App.tsx`, or `GameCanvas`)
feeds it from the Lobby socket, the API or the Account. Prop defaults that production always
overrides are not listed.

## 1. Bugs (wrong today, no design question)

| # | Where | What is wrong |
|---|---|---|
| B1 | BetweenRounds, `GameCanvas.tsx:213-218,397` | "THIS ROUND" gains and the move arrows show once, then read `+0` on the next 500 ms re-render: the effect overwrites `prevTotalsRef` with the current totals and the rows are recomputed against themselves. `matchView.ts:138-147` already derives the gain from the last `roundResults` entry. |
| B2 | BetweenRounds SCOREBOARD, `GameCanvas.tsx:670-672` | Navigating to `/scoreboard` unmounts `LobbyRoute` and closes the socket: the Player leaves the Match. |
| B3 | Betting, `server/match/betting.ts:38` → `api/bets/bets.service.ts:158` | A Round with no placement-1 row (abandoned) settles with `winnerIds: []`, which the API refuses with a 400. The pool stays open and stakes are never refunded. |
| B4 | Round number, `GameCanvas.tsx:138,180` | Counted from COUNTDOWN edges this client saw. A mid-Match join or a reload reads `ROUND 0`, and a bet goes to Round 0 (404). The server keys betting on `roundResults.length + 1`; `LobbySnapshot` has no Round number. |
| B5 | FinishedOrOut NEXT ROUND IN, `GameCanvas.tsx:560` | Shows `lobby.timeLimitMs`, which is the current Round's time left (`lobbyConnection.ts:115`), not when the next Round starts. |
| B6 | Countdown GRID SPOT, `GameCanvas.tsx:460` | `joinOrder + 1`, a counter that never compacts, so it can read `07/04`. |
| B7 | Scores | `roundScore` is fractional (4 Players → `66.666…`); BetweenRounds, the MatchOver podium, its gap note and the Scoreboard render it unrounded. |
| B8 | Rewards claim, `api/rewards/rewards.service.ts:46-76` | Credits whatever placement rows the client sends; `?me=` is a socket id, so anyone can view or claim another Player's rows. `match_results` now stores `accountIds`, so the server can derive the rows itself. The "sockets don't know Accounts" comment is stale. |
| B9 | Rewards BACK TO LOBBY, `RewardsRoute.tsx:82` | Goes to `/play`, same as PLAY AGAIN. |
| B10 | Survival | A mid-Round disconnect is also eliminated (`server/seats.ts:52`), so a quitter reads as "X WAS ELIMINATED". |
| B11 | Countdown / BetweenRounds mode chip | `tone="race"` hardcoded, so SURVIVAL is drawn in Race colours (`Countdown.tsx:67`, `BetweenRounds.tsx:127`). |
| B12 | Countdown / FinishedOrOut checkpoints | The CHECKPOINT row shows `00 / 00` on Survival arenas. The Countdown's `+N` bubble shows `+0` with ≤5 Players. |
| B13 | BetweenRounds `n OF m READY` | `m` counts Players who left and spectators. |
| B14 | Spectator WINS N, `Spectator.tsx:83` | Odds before your own stake joins the pool. |
| B15 | Spectator betting window | Opens at LOADING for 60 s; the panel only appears after your run ends, so the board is usually already CLOSED. |

## 2. Real data exists, only not wired

- **Avatars everywhere**: every small `Avatar` is a hash of the socket/Account id onto five
  gradients (`lib/avatarSkins.ts:12`). The real Colour/Skin/Hat is on `LobbyPlayer` and the Account,
  and the wire carries `avatarUrl` for Friends. Affects Lobby, Countdown line, RaceHUD threat,
  SurvivalHud survivors, Friends, FriendAlerts, Scoreboard, MatchOver "YOU FINISHED", Spectator
  ticker (hardcoded `mint`), MainMenu (hardcoded `pink`).
- **MainMenu WINS 137**: `GET /career` `stats.wins`.
- **Settings "LVL 42"**: `levelForXp(account.xp)`.
- **PlaySelect "31 strangers"**: `maxPlayers − 1` from `/game-settings`.
- **PlaySelect FRIENDS IN A LOBBY row** (hardcoded `WOBBLETOAST · PLUMJA`): `useFriends` presence
  `in-lobby` carries the private Lobby's code and open slots.
- **Lobby INVITE FRIENDS**: only copies the code; `POST /friends/invite` exists.
- **Countdown PB line**: never passed; `usePersonalBest` already feeds RaceHUD.
- **Spectator PLACE**: a local rank by Checkpoints (`frameLoop.ts:471-477`); the server sends
  `liveRace.places`. **ALIVE FOR**: time since this client saw RUNNING, not the followed bean's.
- **Rewards coin split**: shows MATCH only; bet payouts are credited at settle but never shown.
  "UNLOCKED AT" shows the new level, not the hat's `unlockLevel`.
- **FinishedOrOut TIME**: snapshot arrival time; exact is `(finishTick − roundStartTick) × TICK_MS`.
- **BetweenRounds AUTO-START IN**: a client guess using the default `STANDINGS_READY_TIMEOUT_MS`;
  the server's is configurable and no deadline is sent.
- **Discover TRENDING / "TODAY'S FEATURED CHAOS"**: all-time `track_plays`, nothing time-windowed.

## 3. Placeholder captions and false copy (delete or make true)

- Countdown "GAMEPLAY FEED · BEANS ON THE START LINE" (`Countdown.tsx:82`), FinishedOrOut
  "GAMEPLAY FEED · RUN ENDING" (`:115`), Spectator "GAMEPLAY FEED / FOLLOWING ANOTHER BEAN" (`:137`).
- "EXISTING TRACK THUMBNAIL" (Discover `:164`, BetweenRounds `:123` when the next pick is random).
- No-WebGL fallbacks: "3D CHARACTER RENDER", "WINNER CELEBRATION LOOP" and the like.
- ErrorScreen: SUPPORT CODE `DF-7742-QX` is constant and "We logged it" is untrue — nothing logs.
- Settings GAMEPLAY and ACCOUNT panes: "PANE · SAME ROW VOCABULARY…".
- `MainMenuScreen.tsx` is mounted nowhere (dead code with its test).

## 4. Needs a definition (the user's call)

- **Beans online** (MainMenu, PlaySelect): today Players seated in any live Lobby
  (`lobbies.service.ts:145`), so a Player on the menu is not counted. `presence_beats` holds a
  heartbeat every 30 s from every signed-in client, counted online for 90 s.
- **MainMenu BEST SURVIVAL / GRABS BROKEN**: nothing stores a Survival time per participant or a
  won Struggle.
- **MainMenu BUILD "4 DRAFT TRACKS"**: no draft concept; every Track's author is `DEFAULT_AUTHOR_ID`.

## 5. Systems the design shows that do not exist

- MainMenu: SURVIVAL tile and LEADERBOARDS (both `console.log`). No leaderboard or shop screen
  exists in the design either (its own "try next" list names both).
- PlaySelect: REGION + ping, QUEUE wait, BRINGING / party, WHO CAN JOIN (friends-only Lobby),
  ROUNDS stepper (never sent; `POST /lobbies` reads only `isPrivate`).
- CharacterSelect: EMOTES tab (falls through to colours), locked "LV 45"/"SHOP ONLY" swatches,
  NAME CARD, VICTORY POSE, OPEN SHOP.
- Settings: SCREEN SHAKE (local state; there is no screen shake in the game), DONE (`console.log`).
- Auth: KEEP ME LOGGED IN (never sent), FORGOT? (flash only).
- Friends: the "N ONLINE · M TOTAL" pill is a button with no action.

## 6. Design pieces with no production counterpart

- **Ragdoll** overlay (FLOPPED, SLAMMED BY X, HITS TAKEN, GET UP mash): motion state and
  `ragdollCause` exist; the attacker, the time left and a mash-to-get-up mechanic do not.
- **Elimination** card (KNOCKED OUT, SURVIVED, POSITION, GRABS BROKEN, BEANS LEFT): mostly
  `runEnd` and `remaining`; GRABS BROKEN needs the Struggle count above.
- **DashFeedback** (TOP SPEED, 3 charges, RECHARGES IN): the game has one Dash, not three charges.
- **SettingsModal** (in-game PAUSED sheet): nothing opens a pause; voice chat and nameplates do not
  exist.
- SystemSheet (design-system reference) and the TrackBuilder mock (the real builder is its own app)
  are not player screens.
