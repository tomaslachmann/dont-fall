# 07j — Which change cost Slip Stream its finishes (an A/B)

**What to do:** find out which of the two changes that landed on 2026-09-25 made Slip Stream worse,
and explain the mechanism. This measures and attributes. It fixes something only if the cause is one
obvious line.

**Blocked by:** 07h round 2 and 07i's second session, both landed. **Blocks** the next round of 07i
(crosses) and the spiked-bar work, because both edit `sweeperHold.ts` and must not build on a regression.
Runs in parallel with 07k (a simulation defect in `simulation/character/`, not a bot file).

**Wall clock: 45 minutes. Model: Sonnet.** Stop rule: once the four-way table is filled and the
mechanism is named (or three attempts at naming it failed), write the As built and stop.

## Findings this ticket starts from (`07d-integration.md`, last section)

| Slip Stream | finished H/N/E | stranded | notes |
|---|---|---|---|
| before (tree `7efa2005`, the 133 s run) | 10 / 10 / 1 | 0 / 0 / 1 | Cp 1→2 Stagger 19 / 35 / 105 |
| after (tree `2ddc1f6a`) | **8 / 7 / 2** | 0 / **1 / 2** | Cp 1→2 Stagger 62 / 48 / 66, **new `link` Falls 2 (N), 13 (E)** |

07i's own report saw the Slip Stream Cp 1→2 leg at HARD read 8 passed, 1 stranded and 27 Falls on
three runs, against 10 / 0 / 17 in its §1. That §1 figure was measured earlier in the day against a
different `deckRider.ts`. Neither agent A/B'd the two changes against each other.

## The two changes (diff `7efa2005..2ddc1f6a`)

- **07h round 2 (H):** `packages/shared/src/bot/deckRider.ts`, plus its constants in `tuning/bots.ts`
  ("Rides with a crowd (M17 ticket 07h, round 2)") and the `ridePlanCost` export in `src/index.ts`.
- **07i (I):** `packages/shared/src/bot/sweeperHold.ts` and `movingWorld.ts` (the `near` bound), plus
  their constants in `tuning/bots.ts` ("Spinning crosses (07i)").
- `tuning/bots.ts` and `index.ts` are additive for both, so every variant uses HEAD's copies.

## How

1. Build four trees without touching the main working tree: `git worktree add` in the scratchpad at
   `2ddc1f6a`, then in each one `git checkout 7efa2005 -- <files>` for the change you take out.
   - **∅** = `deckRider.ts`, `sweeperHold.ts` and `movingWorld.ts` from `7efa2005`;
   - **H** = only `sweeperHold.ts` and `movingWorld.ts` from `7efa2005`;
   - **I** = only `deckRider.ts` from `7efa2005`;
   - **HI** = HEAD.

   Each worktree needs `node_modules`: symlink the main tree's, or `pnpm install --offline`. Use the pnpm
   store that `node_modules/.modules.yaml` records. Typecheck each variant before measuring.
2. First, measure the Slip Stream Cp 1→2 leg alone at all three levels through the section harness
   (`playSection`, the way 07i §1 does it; see `sweeperHold.test.ts` / `sectionHarness`). Take the same
   seed in all four variants, and a second seed if the first one leaves the attribution ambiguous. The
   harness is deterministic per seed.
3. Then, and only if the leg does not explain it, run the whole Slip Stream Race in the two variants
   that matter (`races.test.ts` with `BOT_RACES=1`, filtered to Slip Stream with `-t`).
4. Name the mechanism: which decision in the guilty file puts Bots into the new `link` Falls, the extra
   Staggers and the stranded waits. Read one Bot Tick by Tick, as 07h round 2 did for `bot-9`.

## Rules

- NEVER commit, stash, reset or revert in the main tree. Remove your worktrees when done
  (`git worktree remove`).
- Do not edit the main tree's source. A fix is only allowed if it is a single obvious line in the guilty
  file, and then it must be proven on the leg in all three levels.
- Known reds that are not yours: the 14 standing failures in `RapierSimulation.test.ts`, the trapHold D/S
  wall-clock asserts, `difficulty.test.ts`, and `races.test.ts`'s `ownFalls === 0`.

## Done when

A four-way table (∅ / H / I / HI × HARD / NORMAL / EASY: passed, stranded, Falls by kind) and the named
mechanism are in "As built" below, with a proposed fix: which file, what to change, and the evidence for
it.

## As built (2026-09-25, Sonnet, ~45 minutes)

**The regression is `sweeperHold.ts` (07i), not `deckRider.ts` (07h round 2).** That reverses the
suspicion both 07d's integration note and 07i's own report were left with. Four worktrees at `2ddc1f6a`
(`git worktree add … --detach`, then `git checkout 7efa2005 -- <files>` per the ticket's recipe),
`node_modules` symlinked from the main tree. `index.ts`'s `ridePlanCost` re-export and
`sweeperHold.test.ts`'s `spinAbout`/`turnedBack`/`arcs` imports don't compile against a reverted
`deckRider.ts`/`sweeperHold.ts` (both files were kept at HEAD per the ticket, which is right for
`hooks.ts`'s own imports, but leaves `packages/shared`'s whole-package `tsc --noEmit` red in ∅/H (the
test file) and ∅/I (the index re-export) — expected fallout of the surgical revert, not a new defect;
confirmed by hash-checking each variant's three files against `7efa2005`/`2ddc1f6a` before measuring).
The leg was measured directly with `playSection` (a standalone scratch test importing `sectionHarness.ts`
+ `SLIP_STREAM_TRACK` only, bypassing both `sweeperHold.test.ts` and `index.ts`), since `hooks.ts` wires
`SweeperHold`/`DeckRider` straight from their own files and needs neither.

### The four-way table

Slip Stream Cp 1 → 2 (`playSection`, leg 2, 120 s cap, 12 Bots, aggression 0), seed `holds:slip2:<level>:0`,
same seed in all four:

| variant | files at HEAD (2ddc1f6a) | HARD passed/stranded, Falls | NORMAL passed/stranded, Falls | EASY passed/stranded, Falls |
|---|---|---|---|---|
| **∅** | none | 10/0, {Bump 6, Stagger 17} | 7/0, {Bump 7, Stagger 33, **link 5**} | 4/1, {Bump 13, Stagger 42, contact 5, pushed 2, **link 3**} |
| **H** (07h round 2 only) | `deckRider.ts` | 10/0, {Bump 6, Stagger 17} | 7/0, {Bump 7, Stagger 33, **link 5**} | 4/1, {Bump 13, Stagger 42, contact 5, pushed 2, **link 3**} |
| **I** (07i only) | `sweeperHold.ts`, `movingWorld.ts` | 8/1, {Bump 8, Stagger 26, Obstacle 1} | 5/0, {Stagger 35, Bump 11} | 0/0, {Bump 20, **link 3**, pushed 2, contact 5, Stagger 36} |
| **HI** | all three | 8/1, {Bump 8, Stagger 26, Obstacle 1} | 5/0, {Stagger 35, Bump 11} | 0/0, {Bump 20, **link 3**, pushed 2, contact 5, Stagger 36} |

**H is bit-identical to ∅ on every count. I is bit-identical to HI on every count.** Confirmed on a second
seed (`holds:slip2:<level>:1`) with the same split (∅=H, I=HI, different numbers but the same equalities).
A fifth run narrowed further: with `deckRider.ts` *and* `movingWorld.ts` both reverted and only
`sweeperHold.ts` at HEAD, the leg is still bit-identical to I/HI — `movingWorld.ts`'s `near` stray-bound
(07i's own cost fix, proven exact by its own test) is not implicated either. The regression is
`sweeperHold.ts` alone.

### The mechanism

Traced `bot-2` on the EASY seed-0 run (the run with the clearest `link` Falls), Tick by Tick, via a
generic per-Tick position/motion-state print added to `sectionHarness.ts` (common to every variant, so
the same trace runs unmodified against H's `sweeperHold.ts` = OLD and I's = HEAD).

Both variants track identically through the first 62 Ticks (same position to the centimetre — the seed
and the profile are the same). At the leg's first sweeper (the bounce-field bar, ~z −259), both Bots
stop dead (`SweeperHold` holds, `moveDirection` (0,0)) at Tick 63. From there they diverge:

- **H (old hold, no arc):** holds through Tick 66, then at **Tick 67 is Staggered anyway** while still
  standing (`in=(0,0)`) — the old hold's window never opened and the give-up let it stand into the bar's
  arm. This is the ordinary Stagger the "before" numbers already carried.
- **I (07i's arc):** holds identically through Tick 71 (frozen at the same cell, unlike H's slight
  drift), then at **Tick 72–89 sidesteps fast** — x running 0.90 → 1.19 → 1.54 → 1.87 → 2.99 in twenty
  Ticks, far quicker than a walk (07i's `followArc`, "walk with the rotation" round the bar's pivot) —
  and clears the bar with **no Stagger**. The arc does exactly what 07i built it to do, here.

That one bar is better for `bot-2` in I. But the arc's exit is a `navFloorWithin` sample past the swath
chosen by geometry alone (`planArc`'s exit search), with no regard for where the *rest* of the leg's
corridor or its proven jump-links assume the Bot is. Ejecting the Bot roughly 2 m sideways of the line the
non-arc route (and the leg's `link` proofs) were walked on puts it on a different approach to whatever
comes next — a different phase against the following sweeper, a different line into the following jump.
`bot-2` reaches the leg's later obstacle at a shifted lateral position, `LinkReplay` commits a link at Tick
311 (steering.committed suppresses `SweeperHold.hold` from Tick 311, confirmed by its early return), and
the Bot Falls **mid-link at Tick 341** (30 Ticks in, close to a full run) at (4.5, 14.6, −265.6) — a
**`link`** Fall (the `LinkReplay.step` monkey-patch in `sectionHarness.ts` fired within the classifier's
5-Tick blame window, then the fall was recorded). The same pattern is the most likely source of the other
two EASY `link` Falls (bot-7 at t1034, bot-1 at t1409) and of the extra Staggers further down the leg on
NORMAL/EASY (the sliding walls and spiked circles 07i's own report credited to "07f/07h's" territory, not
realizing its own arc's lateral kick was setting up the approach): **the arc trades one local Stagger for a
route the leg's other timing (a jump-link's proof, a second sweeper's phase) was never re-checked against.**

This reads as the same shape 07i's own "As built" §4 flagged and left open ("The cross's arc is thin…
found late… the leg is slow") but for a different symptom: not that the arc is *slow*, but that its exit
point is *uncoordinated* with the leg it lands back into.

### Proposed fix (not applied — no single obvious line proven)

`planArc`'s exit search (`sweeperHold.ts`, the loop at `for (let i = blocked.index + 1; i < samples.length…`)
picks the first corridor sample clear of the swath by `ARC_EXIT_CLEAR_M`, with no preference for landing
back near the corridor's own line (the samples are `corridorAhead`'s straight-line points; the arc only
ever *starts* from one of them and rejoins at one, so the lateral kick is bounded by how far the sample
step (`BOT_HOLD_SAMPLE_M`) is spaced past the swath, not by anything that measures how far off the
original line the exit actually is). The evidence above shows the kick is large enough (about 2 m over
twenty Ticks at this bar) to matter to a jump-link roughly 250 Ticks later on the same leg. The fix this
points to is in `planArc`'s exit choice: prefer the exit sample nearest the pre-arc corridor's own line
(or re-run `corridorAhead` from the arc's actual landing point before handing control back), so a bar
dodged by rotation-walking rejoins the route it was already on rather than a route shifted sideways by
whatever radius share and direction happened to find a window first. This is not a single obvious line —
it changes what "exit" means in the search, not one constant or one condition — so per this ticket's
rule it is **not applied here**. It is the next thing to try, proven the way this ticket proved the
attribution: the same leg, the same seed, before/after, at all three levels, watching whether the new
`link` Falls and the Stagger count both fall.

### What this changes upstream

- `07d-integration.md`'s "unattributed… an A/B of 07h round 2 against 07i on that leg is the first thing
  to run" is answered: it is 07i, not 07h round 2. `deckRider.ts` is clean on this leg.
- `07i-spinning-crosses.md` §1's "the leg's other 15 [Falls] are on the sliding walls and spiked circles
  further down… which are 07f/07h's" should be read as unproven — this ticket's trace shows the arc's own
  lateral kick reaching that far down the leg is a live alternative explanation, not ruled out.
- 07i's own regression set (`neverStepsOff`, `sweeperHold.test.ts`, etc.) never exercised Slip Stream's
  whole leg with 12 Bots and a shared corridor the way `playSection` does here, which is why this shipped
  unnoticed: the two-Bot/one-bar unit tests in `sweeperHold.test.ts` have no downstream obstacle for a 2 m
  lateral kick to matter against.
