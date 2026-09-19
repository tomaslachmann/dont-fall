# 08 — Beans online are signed-in Accounts

**What to build:** `/game-settings` `onlinePlayers` counts Accounts with a presence heartbeat
younger than the online window (90 s), not only Players seated in a Lobby. ADR 0110, the user's
choice.

**Blocked by:** —

**Status:** done on tests (2026-09-19)

- [x] A DAO count over `presence_beats` with the same window friends presence uses (one constant)
- [x] `countOnlinePlayers` in the settings deps reads it; the lobbies-service count goes if nothing
      else uses it
- [x] MainMenu and PlaySelect need no change beyond what they read
- [x] Tests: a fresh beat counts, a stale one does not

## As built

- `countOnlineAccounts(db, nowMs)` in `friends.dao.ts` counts `presence_beats` younger than
  `ONLINE_WINDOW_MS`; `app.ts` hands it to the settings route. `LobbiesService.countOnlinePlayers`
  is gone.
