# 09 — Survival time and Struggles won are recorded

**What to build:** Each Match participant records its longest time alive in a Survival Round and
how many Struggles it won (ADR 0104). `/career` returns BEST SURVIVAL and GRABS BROKEN, and the main
menu shows them. ADR 0110.

**Blocked by:** —

**Status:** done on tests (2026-09-19)

- [x] The server counts Struggles won per Character per Round (a Struggle that frees you)
- [x] The server knows each Survival Round's time alive per Character (elimination Tick, or the
      Round's end for a survivor)
- [x] Both land on the stored Match and on `match_participants` (new columns, migrated in place)
- [x] `GET /career` stats gain `bestSurvivalMs` and `grabsBroken`
- [x] MainMenu BEST SURVIVAL and GRABS BROKEN read them
- [x] Tests: server counting, persistence, career aggregation

## As built

- The shared step counts a won Struggle per Character (`GrabHolds.escape` → `HoldWorld.struggleWon`),
  read by the Match server as `RapierSimulation.strugglesWon()` at each Round's end — never on the wire.
- Time alive is `survivalTimesMs` (`apps/server/src/match/career.ts`): from the Round's start Tick to
  the elimination Tick, or to ROUND_END's start for a survivor. The Match keeps each seat's longest.
- `PersistedMatchResult` gained `survivalMs` and `grabsBroken` maps (older saves default `{}`);
  `match_participants` gained `best_survival_ms` and `grabs_broken`, migrated in place; `/career`
  returns `bestSurvivalMs` (MAX) and `grabsBroken` (SUM).
- The main menu's three tiles read `/career` (the Profile's cache key), a dash until it arrives.
