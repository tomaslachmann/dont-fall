# 04 — Movement verbs: jump + dash

**What to build:** The two movement verbs beyond walking. Jump with variable
height (longer hold = higher, up to a cap), coyote time ~100 ms after leaving an
edge, and **no double jump**. Dash: a fixed-magnitude impulse in the direction of
movement (not the camera), usable both on the ground and in the air, on a
cooldown of ~1 s. Both run inside the shared sim step. Dashing into a wall has no
special consequence yet — that lands in ticket 06 once Ragdoll exists.

**Blocked by:** 02

**Status:** done

- [x] Variable-height jump (`JUMP_VELOCITY` + `JUMP_HOLD_GRAVITY_SCALE` while held & rising, capped by `JUMP_HOLD_MAX_TICKS`); button state sampled per frame, edge derived in the sim
- [x] Coyote time `COYOTE_MS` (100 ms) — jump still works just after leaving an edge
- [x] No double jump — coyote is consumed on take-off; a mid-air press does nothing
- [x] Dash: smoothstep-eased burst (`dashEnvelope`) — ramps in and out over `DASH_RAMP_MS`, peak `DASH_SPEED` in the middle, along the move direction (last direction if idle), ground and air
- [x] Dash cooldown `DASH_COOLDOWN_MS` (1 s), enforced; `character.dashCooldownMs` surfaced as a HUD bar
- [x] All values in `packages/shared/tuning.ts`; `SimInputs` gained `jumpHeld` / `dashHeld`

**Notes:** jump/dash live in `JumpController` / `DashController`
(`simulation/movementVerbs.ts`). `dashEnvelope(elapsed, duration, ramp)` is the
pure smooth-start/stop curve. `SimState.character` gained `dashCooldownMs`.
Rapier autostep was disabled (hitched during fast dash movement; M1 platforms
don't need it). Feel values (tap ≈ 2.3u, hold ≈ 3.3u, dash peak ≈ 28 u/s over
230 ms) are starting points for ticket 07.
