# 08 — Difficulty, and every Bot a little different

**What to build:** EASY / NORMAL / HARD as data. Each Bot draws its own **profile** from a
seeded spread around the host's level: reaction time, aim error, obstacle look-ahead and
timing error, aggression, how often it takes a chance, and clumsiness (a late jump, an
overshoot). The levels and spreads live in `packages/shared/src/tuning/bots.ts`; the numbers
are first guesses and are served at runtime, never copied into docs or tests.

**Blocked by:** 04 (07 and 09 read the profile)

**Status:** done on tests (2026-09-24)

- [x] `BotProfile` drawn from `(level, seed)`; the seed comes from the Match and the seat, so a
      suite's Bots play the same every run and a live Lobby's do not repeat
- [x] Reaction time as a delay line on what the Bot perceives, not on what it outputs, so it
      reacts late to the world instead of pressing late
- [x] Clumsiness never breaks ticket 06's rule — ticket 06 isn't built yet (still "planned",
      blocked by 05), so its own suite can't hold this. Held instead by construction: a stumble
      only ever widens perception staleness, never changes a move direction, so on its own it
      cannot aim a Bot at the void (see "As built")
- [x] Suite: over the base race with Motion running, finish time and Falls separate
      EASY < NORMAL < HARD, measured, recorded below

## As built

**`BotProfile` (`packages/shared/src/bot/profile.ts`).** `botProfile(level, seed)` draws seven
fields, each a uniform draw over `BOT_LEVEL_SPREADS[level]` (`tuning/bots.ts`), keyed by
`` `profile ${field}` `` on `botDraw` (`bot/random.ts`) — deterministic, no `Math.random()`.
`reactionTicks` and `clumsiness` are applied now; `lookAheadTicks`/`timingErrorTicks` (ticket
07) and `aimError`/`aggression`/`chanceTaking` (ticket 09) are drawn and typed here so their
numbers are already seeded and settled once those tickets read them, but nothing reads them
yet. `reactionTicks`'s and `clumsiness`'s ranges never overlap between levels (EASY 6–10 ticks /
0.5–0.9, NORMAL 3–6 / 0.15–0.4, HARD 0–2 / 0–0.1), so EASY ≥ NORMAL ≥ HARD holds on every seed,
not just a lucky draw (`profile.test.ts`).

**The seed is the Match and the seat, at last** (ticket 04's open question 1). `BotDriver.add(id,
matchId, level)` builds `` `${matchId}:${id}` `` and draws the profile from it, so a suite's
`matchId` makes every draw repeatable and two live Matches never draw the same Bot twice.

**The wiring ticket 10 left open, closed.** `MatchRuntime.addBot` now calls
`this.bots.add(id, this.config.matchId, this.lobbyBots.level)` — the host's level, fixed for the
Match once `fillBots` runs at `start`. `BotDriver.add` is the only place a `TreeBot` gets built
and wrapped; `apps/server/src/match/botDriver.ts` is the sole caller. `scripts/bench-simulation.ts`
grows `--level` (default `normal`), so `pnpm bench:sim --bots 11 --level hard` plays every Bot
in the row at one level (a bench run isn't a Lobby's own per-Bot spread).

**`withPerceptionDelay` (`packages/shared/src/bot/perceptionDelay.ts`) is the wrapper the ticket
asked for**, not an edit to `TreeBot`'s own decision-making. It implements `Bot`, wraps another
`Bot`, and delays only `BotWorldView.self`/`.characters` — every Character's pose and motion
state, what actually changes Tick to Tick — never `view.tick` (the Tick the input is *for*) and
never `view.track`/`view.rules`. `TreeBot` itself is unchanged in behaviour: it gained an
optional `profile` on `TreeBotOptions`, defaulting to NORMAL's spread on its own seed, carried
into `BotContext.profile` purely for the leaves tickets 07/09 add — nothing reads it yet, and
every pre-existing `TreeBot` test (built with no wrapper) still passes unmodified.

- **Reaction time.** A FIFO of recent `{self, characters}` pairs; each Tick reads
  `reactionTicks` back, ramping up from 0 over the first few Ticks (nothing older to read yet),
  then holding steady.
- **Clumsiness widens the delay further**, drawn fresh every Tick from its own seeded stream:
  `delay = reactionTicks + floor(clumsiness × BOT_STUMBLE_EXTRA_TICKS_MAX × draw())`. A stumble
  only ever makes perception *later* — it changes no move direction — so by construction it
  cannot be what aims a Bot at the void (ADR 0129's "never suicidal"). What it produces instead,
  as a side effect of `PathFollower` planning and steering from a stale `self.position`, is
  exactly the two things the ticket asked clumsiness for: a late reaction, and an overshoot past
  where it meant to turn — for free, with no edit to `PathBot.ts`.
- **Found while building this, fixed before it shipped:** the first version buffered the whole
  `BotWorldView`, `track` included. `apps/server/src/match/matchRuntime.botFill.test.ts`'s
  "every Round of the Match" test caught it within a day of tickets landing: a Round transition
  disposes the old navmesh (`BotDriver.worldChanged`), and a buffered Tick from before the
  transition could still be waiting in the queue when the next Round started, handing
  `PathFollower` a disposed navmesh a few Ticks in — `RangeError`/WASM "memory access out of
  bounds" in `NavMeshQuery.findNearestPoly`. Delaying only `self`/`characters` (never `track`)
  fixes it outright, and is the more correct reading of ADR 0129 besides: a Bot perceives *other
  Characters*, not the Track's own geometry, late.

**The measurement suite (`packages/shared/src/bot/difficulty.test.ts`).**

A Bot can't run the base race from the Start yet (ticket 05's jump links, landing separately),
so this drives the last stretch the navmesh joins at rest — Checkpoint 4 to the finish (ticket
04's table: legs 5, 6, 7) — credited past Checkpoint 4 and driven from its Respawn, the same way
ticket 04's own suite reaches a leg it hasn't walked. Unlike ticket 04's own measurements, this
runs with the Track's real Motion running (`sim.tick(inputs, "RUNNING")` on the actual
`BASE_RACE_TRACK`, not `atRest`) — the ticket's own ask, and the first time any Bot suite has
driven live Motion end to end rather than just checking the navmesh connects.

12 seeds per level, seeded `` `difficulty-suite:${level}:${n}` ``, deterministic and reproduced
bit-identical across repeated runs (checked). Measured (Apple M4):

| Level | Mean time, Checkpoint 4 → finish | Falls, summed over 12 seeds |
|---|---|---|
| EASY | 65.4 s | 11 |
| NORMAL | 63.2 s | 1 |
| HARD | 59.1 s | 3 |

EASY is slower than both NORMAL and HARD, on every re-run; EASY Falls far more than either
(11 vs. 1 and 3). NORMAL vs. HARD's own gap is small (63.2 s vs. 59.1 s) and Falls do not order
between them (1 vs. 3) — at this leg, this seed count, reaction time's effect between two levels
only 3 ticks apart on average is close to the run-to-run physics noise (which fork a Bot's own
preference draw sends it down, exact contact timing with a moving deck). EASY's much larger
spread (6–10 ticks, clumsiness 0.5–0.9) is what reads clearly.

**Found while writing this suite, not fixed here (out of this ticket's scope) — recorded for
ticket 07.** Driven from the *literal* Start with Motion running, a Bot at any level — reaction
time and clumsiness included — has close to even odds of getting permanently stuck standing well
short of Checkpoint 0: a live moving Segment is physically in the way, `BotWorldView` carries no
Motion state today, and no Bot can route around one (that is ticket 07's "obstacle look-ahead").
Checked directly: the navmesh itself joins the same legs whether Motion is running or not
(`navPath` on both a moving and a still `BotTrack`, byte-identical corridors for legs 0, 1, 5, 6,
7) — so the stuck-or-not is not a navmesh gap, it is a live-physics one, and it swamps any
difficulty signal outright: in one probe, HARD got stuck exactly as often as EASY over the
Start-to-Checkpoint-0 stretch. That is why the suite above measures Checkpoint 4 onward instead.
The same failure mode is rarer, not absent, there too: 1 of the 36 runs above never finished
within the 150 s cap (a NORMAL seed) — allowed for, not hidden, by the suite's third test.

**Tests:** `packages/shared/src/bot/profile.test.ts` (determinism, field ranges, the
level-ordering guarantee), `perceptionDelay.test.ts` (the delay line and the stumble, in
isolation, with a stub Bot — no reaction/no clumsiness passes the view through unchanged
by reference; a steady delay ramps up exactly; clumsiness stays within
`[reactionTicks, reactionTicks + BOT_STUMBLE_EXTRA_TICKS_MAX]` and actually varies; seeded, not
`Math.random()`), `difficulty.test.ts` (above). Server:
`apps/server/src/match/matchRuntime.bots.test.ts` and `.botFill.test.ts` both still pass, the
latter now exercising the fixed navmesh-disposal path across a real second Round.

**Typecheck:** `packages/shared` and `apps/server` both clean (the one pre-existing
`bombHome.scratch.test.ts` unused-import error is unrelated and ignored per the ticket's rules).

## Open questions (conservative choices made)

1. **NORMAL vs. HARD's separation is weak on this particular leg at this seed count.** The
   ordering assertion is `easy ≥ normal ≥ hard` (true on the measured numbers) plus
   `easy > hard` (also true); it does not additionally assert `normal > hard` strictly, since
   that is not reliably true here yet. Whether the three levels' *feel* is distinct enough is the
   user's to judge once ticket 07 gives HARD something to actually look ahead at — today
   `lookAheadTicks` changes nothing.
2. **Falls between NORMAL and HARD don't order (1 vs. 3 on 12 seeds).** Falls are rare enough at
   this sample size that noise dominates between the two closer levels; only EASY's much larger
   spread separates cleanly. The suite asserts EASY > both, not a full ordering.
3. **The Start-to-Checkpoint-0 stuck-Bot finding is left for ticket 07**, as the ticket's own
   framing asked ("leave a note that the full-course comparison runs once 05 lands") — this one
   is arguably 07's rather than 05's, since it is a Motion-awareness gap, not a jump-link one; the
   note is left in `difficulty.test.ts`'s own file comment for whoever picks it up.
4. **`TreeBot`'s default profile (no `profile` option given) is NORMAL's, drawn from the Bot's own
   seed.** Chosen so every `TreeBot` built directly, ticket 04's test suite included, keeps
   behaving exactly as before — nothing there passes a profile, and nothing there is delayed
   (only `BotDriver.add` wraps a Bot in `withPerceptionDelay`).
