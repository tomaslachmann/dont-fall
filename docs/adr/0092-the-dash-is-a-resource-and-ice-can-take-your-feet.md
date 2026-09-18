# 0092 — The Dash is a resource, and ice can take your feet

## Context

From the user, playing the base race on 2026-09-17:

> dash a jump mají feel jako cheating, když se mačkají pořád tyhle kombinace
> dráha jde překonat úplně jednoduše

A jump reaching ~2.3 m, plus a Dash on a 1.5 s cooldown (0.5 s of real rest
after a 1 s burst), meant the answer to almost every obstacle was the same:
jump, dash, repeat. The geometry stopped being something to read and became
something to skip. Neither move was individually wrong — together, and
available constantly, they beat the course.

The same session asked for ice to stop being purely a steering problem:
jumping off it should cost something, and landing hard on it should be able
to put you down.

## Decision

**The jump is smaller.** `JUMP_VELOCITY` 10 → 7.5, apexing at ~1.3 m instead
of ~2.3 m before the hold boost. `baseRace.test.ts` — which walks the whole
course end to end — still passes, so the seeded Track remains completable.

**The Dash is a resource, not a move.** `DASH_DURATION_MS` 1000 → 3000 and
`DASH_COOLDOWN_MS` 1500 → 15 000. One long committed burst, once every
fifteen seconds. Spam is not nerfed, it is removed: there is nothing to mash.
`DASH_SPEED` 15 → 12, because a burst three times as long at the old speed
crossed 55 units — most of a Track section on one press.

Two consequences had to be handled rather than inherited:

- **The envelope grew a ramp-in.** `dashEnvelope` used to build toward full
  speed across the *whole* burst. Tripling the duration would have turned
  that into three seconds of gentle acceleration, which is not a dash.
  `DASH_RAMP_MS` (900, today's effective build time, written down rather than
  derived) now bounds the build, and the burst holds at full speed after it.
  Passing `rampIn = duration - rampOut` reproduces the old curve exactly, so
  this is the same shape with its plateau exposed.
- **Wall Impact needed no edit.** `WALL_IMPACT_MIN_SPEED` and
  `WALL_IMPACT_SCALE` were already derived from `DASH_SPEED` precisely so
  "a full-strength Dash into a wall lands exactly as hard as it always did"
  survives a tuning pass. It did.

**The Dash gets a meter, on both Round HUDs.** A fifteen-second recharge that
a Player can only discover by pressing the button is a worse move than a
1.5 s one. `RaceHudSnapshot` and `SurvivalHudSnapshot` share a
`RoundHudCommon` carrying `dashCharge` (0–1, rounded to twentieths) and
`dashReady`. Rounding is not cosmetic: ADR 0088 feeds the HUD what is
*drawn*, and 5% steps raise React twenty times per recharge instead of 450.
`dashReady` is read off the cooldown exactly and never off the rounded bar,
so a bar that rounds up to full a fifth of a second early cannot promise a
Dash the simulation would refuse. No protocol change — `dashCooldownMs` has
been on the snapshot since M2 ticket 05.

**Ice pushes back weakly and may not let you land.** Two new per-Surface
knobs, in the shape `bounce` already established — a property of the floor,
not something every tile has an opinion on:

- `jumpMultiplier` (ice: 0.8) scales take-off. Deliberately a take-off knob
  and not a gravity one: a jump that *starts* weak is legible, while a jump
  that starts normally and is then pulled down mid-air reads as the game
  cheating.
- `landingKnockdown` (ice: above 11 units/s, a 50% chance) puts the
  Character down on arrival, read against the same `airbornePeakFallSpeed` a
  bounce reads and for the same reason: the Surface can take a tick or two to
  resolve after a fast fall, by which point the instantaneous velocity is an
  earlier clamp's residue. The threshold sits above a plain jump's own
  landing speed, so hopping around on ice is never a coin flip — only a real
  drop is.

**The chance is drawn, not rolled.** The user asked for a chance rather than
a certainty, and `Math.random()` is not available to the step: it is pure
with respect to `(state, inputs)` (ADR 0003/0005), and the client predicts
its own Character with it. A real random number would make every coin flip a
disagreement — the client would guess wrong half the time and be corrected,
which is exactly the jitter prediction exists to prevent. `slipRoll(id, tick)`
hashes values *both sides already have*. `syncTick` already realigns the
client's `tickCount` to the server's before every replay, precisely so
tick-derived pure functions match (Spinner phase relies on the same
guarantee), so a predicted slip is a slip.

A knockdown gets its own `RagdollCause`, `"Slip"` — your own feet going, not
something hitting you.

## Consequences

- A Dash now covers 45 units instead of 13.5, and the tests that ran one to
  its end walked straight off the 40×40 test floor (the Character Fell,
  Respawned, and every "how far did it get" assertion silently measured the
  respawn). Those suites got a `LONG_GROUND` of their own. A ±90 floor breaks
  the character controller's sweep outright — it returns zero movement — so
  ±60 is the working size, found empirically and worth knowing.
- The wall-Impact suite's "sufficiently glancing hit" case moved from a 60°
  to a 65° approach: the burst used to still be building when it met the
  wall, and now arrives at full speed. The usable window is narrow at both
  ends (below ~62° the closing speed knocks down; past ~66° the Character
  clears the wall's z-extent without touching it) and was measured.
- All three numbers are provisional in the way this repo means it — named
  constants in `packages/shared/src/tuning.ts`, a measurement rather than a
  decision. The whole point of the pass is how it *plays*, which is the
  user's own check.
