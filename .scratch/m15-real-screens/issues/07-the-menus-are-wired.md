# 07 — The menus are wired

**What to build:** Every menu value that has real data behind it reads it. ADR 0110.

**Blocked by:** —

**Status:** done on tests (2026-09-19)

- [x] MainMenu WINS from `GET /career`
- [x] Settings shows the Account's level (`levelForXp`), not "LVL 42"; DONE goes back
- [x] PlaySelect: "Drop into the next race with N strangers" from `maxPlayers − 1`; the FRIENDS IN A
      LOBBY row lists real friends in joinable Lobbies from friends presence, with their code
- [x] Lobby INVITE FRIENDS sends real invites (`POST /friends/invite`), not just a copied code
- [x] Friends: the "N ONLINE · M TOTAL" pill shows the ONLINE tab instead of doing nothing
- [x] Discover: TRENDING ranks by plays in the last 7 days and "TODAY'S FEATURED" by the last 24 h
      (`track_plays` needs a timestamp per play if it lacks one); a Track without a Thumbnail shows
      the plain Stage, not "EXISTING TRACK THUMBNAIL"
- [x] Auth: KEEP ME LOGGED IN decides whether the token outlives the tab
- [x] ErrorScreen: a real support code, and the failure really filed under it (the user's choice)
- [x] No-WebGL fallbacks drop the design's "3D CHARACTER RENDER" captions
- [x] `MainMenuScreen.tsx` and its test are deleted (mounted nowhere)
- [x] Tests for new wiring

## As built

- PlaySelect: the stranger count is `maxPlayers − 1`; FRIENDS IN A LOBBY lists friends whose presence
  is a joinable Lobby (USE CODE for a private one, JOIN for a public one) and hides when there are none.
- Lobby: INVITE FRIENDS renders `FriendsPanel` (extracted from `FriendsRoute`) in place with the
  Lobby's `LobbyRef`; the code itself copies. `lobbyPath` adds `?id=`, `parseLobbyParams` reads it.
- Discover: a `track_play_log` keeps a week of timestamped plays (pruned on every write);
  `TrackListing` gained `playsThisWeek` / `playsToday`; TRENDING and TODAY'S FEATURED read them.
- KEEP ME LOGGED IN off stores the token in `sessionStorage`; `getStoredToken` reads both.
- Client errors: `client_errors` table, `POST /client-errors`, `GET /internal/client-errors/:code`
  (service token); `ErrorBoundary` and the results page file theirs (`useSupportCode`).
- No-WebGL fallbacks read NO 3D PREVIEW; the pose line under it stays (it names the animation).
- Left alone: `screens/authUi/*` is imported by nothing (dead, but never shown); the signup box
  "I'M OK WITH FALLING OVER A LOT" is a joke, not a claim.
