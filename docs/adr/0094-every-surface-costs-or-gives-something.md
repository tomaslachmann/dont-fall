# 0094 — Every Surface costs something, or gives something back

## Context

From the user, after playing the four authored Tracks on 2026-09-18:

> na "trampoline" nemáme možnost skákat výš než normálně, dále žádná
> penalizace rychlosti na ledu a v blátě, na blátě by měla být nejvyšší
> a i penalizace skoku tam

Measured against the real simulation before changing anything, on a flat deck:

| Surface | running | jump |
|---|---|---|
| default | 5.85 u/s | 1.96 m |
| mud | 2.92 u/s | 1.96 m |
| ice | 4.10 u/s (still climbing) | 1.32 m |
| bounce | 6.00 u/s | 1.96 m |

So the report was three-quarters right and precisely so. Mud did halve top
speed (`topSpeedMultiplier` 0.5) but cost nothing on take-off. Ice's slower
number was purely its near-zero `grip` still accelerating after three seconds
— its *terminal* speed was concrete's, by design. And a jump timed on a
bounce deck reached exactly the height it reaches on concrete: `SURFACES.bounce`
had no `jumpMultiplier` at all, so the only thing the deck ever gave back was
its own passive rebound, which a jump then replaced rather than added to.

ADR 0035/0036 settled the ice half deliberately, quoting Quake and Source:
a slick Surface carries its whole feel in acceleration and turn authority,
never in max speed, because "ice makes you faster" is the intuitive answer and
the wrong one.

## Decision

**Every Surface now has an opinion about running and about jumping.** The two
knobs ADR 0035/0036 defined are unchanged; what changes is which Surfaces set
them.

| Surface | `topSpeedMultiplier` | `jumpMultiplier` | measured run | measured jump |
|---|---|---|---|---|
| default | 1 | — | 5.85 u/s | 1.96 m |
| ice | **0.8** (was 1) | 0.8 | 3.27 u/s | 1.32 m |
| mud | **0.4** (was 0.5) | **0.7** (was none) | 2.30 u/s | 1.05 m |
| bounce | 1 | **1.35** (was none) | 6.00 u/s | 3.32 m |

**Mud is the harshest floor in the game**, on both counts — that is what makes
a mud arm of a fork a real trade against an ice one rather than a slower
version of the same thing.

**Ice gets the milder speed penalty**, which amends ADR 0035/0036. That ADR's
rule is still right about *acceleration*: at `grip` 0.001 you barely build
speed, barely stop, and momentum you carry onto the ice is what you keep. What
it left out is the Player who has come to a stop on ice and is scrabbling
along it, who should not reach concrete's pace. The floor that takes your feet
is not also the floor that takes your time, so ice's cut stays well short of
mud's.

**A bounce deck is the only Surface that gives a jump back** — `1.35`, which
roughly doubles the height, since height goes with the square of take-off
speed.

**A jump taken on a bounce Surface takes the greater of the jump and the
deck's own rebound, never their sum.** The take-off branch runs before the
landing branch and leaves the velocity positive, so the landing branch — which
is what applied the rebound — never ran on a jump tick, and arriving hard then
jumping could be *worse* than arriving hard and doing nothing. `max` fixes that
and stays bounded: repeatedly timing a jump converges on the jump's own height
(`max(10.1, v·0.85)` → 10.1), where a sum would climb without limit. The jump
also clears `airbornePeakFallSpeed`, which it has now spent — left standing it
would be handed to a later bounce with no fall behind it, the stale-peak bug
the landing branch already documents at length.

## Consequences

- Two tests encoded the retired rule and now encode this one:
  `Surface.test.ts`'s "ice leaves top speed unchanged" becomes "ice and mud
  both cost speed, and mud costs the most", plus a new one for the jump
  multipliers; `RapierSimulation.test.ts`'s ice terminal-speed measurement now
  expects `WALK_SPEED * ICE_TOP_SPEED_MULTIPLIER`.
- Spin Cycle's bounce arm was laid edge to edge. It had 1.8 m gaps, which were
  fine when a bounce deck threw a jump 1.96 m; at 3.32 m, with the landing
  bouncing on by itself, the arm became a dice roll. Its hazard is now the
  bouncing, not the gaps.
- This also amends **ADR 0081**'s "mud runs" corner, which was arithmetic on
  the old 0.5: flat mud still clears both gait thresholds and runs, but mud up
  the steepest walkable slope is now 1.81 u/s, under `RUN_FROM_SPEED`'s 2.1, so
  a Character setting off up a muddy 35° slope plays the walk cycle. Kept
  rather than re-tuned around: a trudge is what the harshest floor in the game
  should look like.
- Nothing needed re-tuning for mud's gaps, because no authored Track asks for a
  jump on mud — every mud stretch is continuous. That is now a rule worth
  keeping: at `0.7` a jump out of mud clears almost nothing.
- Every constant lives in `tuning.ts` (`ICE_TOP_SPEED_MULTIPLIER`,
  `MUD_TOP_SPEED_MULTIPLIER`, `MUD_JUMP_MULTIPLIER`, `BOUNCE_JUMP_MULTIPLIER`),
  so `SURFACES` stays a table of named numbers rather than literals.
- **Whether these four numbers actually play right is the user's check**, as
  ADR 0092's were. What is proven here is only that they are the numbers the
  simulation now produces.

## Amendment (2026-09-18): the take-off Surface governs the air

The user's live play found the costs jumpable: "na surfacech jako ice a mud
skok nemění chování v letu … může se hýbat rychle přes skoky". Mid-air the
resolved Surface is always the default (there is no ground handle), so every
airborne tick ran at full top speed and full grip — a Character hopping
across mud spent most of the crossing unpenalised, measured at nearly twice
the running pace over the same flat.

The rule now: **the movement model's pair — the top-speed cap and the grip —
carries through the air off the Surface it took off from, until the next
ground contact adopts that floor's own** (`SurfaceController.apply` takes
`grounded`). Everything positional still resets in the air as before: a belt,
a bounce, a hazard needs the floor; a Volume applies wherever the Character
is. The carry is deliberately symmetric — a bounce deck's `1.35` rides its
own rebounds, which is "every Surface costs or *gives* something" applied to
the air too. A reconcile still falls back to `1 / 1` for its replay
(`SurfaceController.reconcile`), the same safest-reading rule as before.
