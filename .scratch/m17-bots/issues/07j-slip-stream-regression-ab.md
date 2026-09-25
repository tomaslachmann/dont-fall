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
