# 10 — Leaderboards

**What to build:** The main menu's LEADERBOARDS opens a Screen with three boards, the user's pick:
wins all-time, best Race time per Track (from `personal_bests`), best Survival (from 09). The design
has no Leaderboards screen, so it is composed from the mocks' pieces (Scoreboard and Profile rows,
tabs, pills). ADR 0110.

**Blocked by:** 05, 09

**Status:** done on tests (2026-09-19)

- [x] `GET /leaderboards/:board` (wins, survival) and a per-Track Race board, top N plus your own row
- [x] The Screen: a tab per board, a Track picker on the Race board, your own row marked
- [x] Tests: ranking, ties, your row outside the top N

## As built

- `GET /leaderboards/wins`, `/leaderboards/survival`, `/leaderboards/race/:trackId` (signed in):
  the top `LEADERBOARD_SIZE` (50) ranked with ties shared (`rankWithTies`), and `you` wherever the
  caller ranks. Wins count Matches at placement 1; Survival is the longest single stay; the Race
  board is `personal_bests` fastest first. Ties list in account-id order.
- The Screen (`/leaderboards`) is the Scoreboard's table and the Friends tabs; the Race board
  walks the raceable Tracks of the listing with PREV / NEXT pills; your row is marked, and shown
  under the top when you are further down. `formatStay` (mm:ss) is shared with the main menu.
