# 0041 — Round configuration: Track defaults, Round overrides

ADR 0038 put the Time Limit on the Track Revision and explicitly rejected a lobby override
"for M4 ... one source of truth while the clock's fairness is still untested; **re-open when a
real use case (tournaments, custom games) asks for it**". That use case has arrived: Survival
needs a Survivor Target (CONTEXT.md — how many Players a Round leaves standing before it ends),
and multi-Round Matches will run *the same arena* at different targets — cutting a large field
early and deciding a winner last. A Revision-only value cannot express that without republishing
a Revision per Round, which ADR 0032 makes immutable on purpose.

## Decision

- A Track Revision carries **defaults about the place**: the Time Limit it already has, and a
  default Survivor Target ("this arena plays well down to 4").
- A Round carries **optional overrides about the contest**. Anything absent falls through to the
  Revision's default.
- Resolution happens **once, before COUNTDOWN**, producing a single `RoundRules` record
  (ADR 0043). Nothing downstream re-resolves, and nothing reads the two sources separately.
- **One scheme for every such value.** The Time Limit becomes overridable by the same mechanism
  rather than staying a special case, so nobody has to remember which values can be overridden.
- A Track may **never** carry which Round types it allows — that is validated when a Round starts,
  not tagged on content — nor whether a Fall respawns, which is the Round type's defining rule
  (ADR 0042).

The test for whether a value may live on a Track: *would a different Match on this same Track
reasonably want a different value?* If yes it is a default; if it is inseparable from the geometry
it is a fact about the Track.

## Considered options

- **Revision only** (ADR 0038's M4 position) — rejected now that a real use case exists: it makes
  one arena at two Survivor Targets impossible without publishing near-duplicate Revisions.
- **Round only** — rejected for exactly the reason ADR 0038 gave against server-side round config:
  it orphans the value from the thing it describes, and authored content stops being shareable
  because it no longer plays sensibly on its own.
- **Track constrains, Round supplies** (the Track sets bounds rather than a default) — rejected:
  an author tuning a Track can silently make a Match's rules unsatisfiable, and the failure shows
  up as an empty intersection far from the edit that caused it.
- **Tagging Tracks with compatible Round types** — rejected: it creates a compatibility matrix to
  maintain, and every new Round type would mean revisiting existing content. Start-time validation
  is one check in one place.

## Consequences

- This **reopens ADR 0038's deferral deliberately**, on the trigger that ADR named. ADR 0038's
  storage decision (a row attribute on `tracks`, `Segment[]` unchanged) stands untouched.
- The Track builder must be able to author every Track-level default, or half of this is
  unwritable — the Time Limit field it already has, plus a Survivor Target.
- Resolution is one pure function over two inputs, so it is directly testable and has one home.
- A Round with no overrides behaves exactly as M4 does today.
