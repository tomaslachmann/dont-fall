# 01 — Character facing is real, replicated protocol state

**What to build:** Every Character's current look-direction becomes real, authoritative state
every other client can see, not a purely local rendering guess. A Player turning their view
turns their Character's known facing as seen from the server and from every other connected
client's Snapshot — even though nothing visibly renders it differently yet (that's ticket 02).

This is the foundation ticket for the milestone (ADR 0045): both Hit (03) and Grab (04) need
to know which way a Character is aiming to find "the Character just ahead of you," and the
real remote Character (02) needs it to orient the model correctly.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A Character's current look-yaw is sent to the server every Tick alongside its existing
      input, and the server treats it the same as any other input field — authoritative once
      received, no validation beyond what the rest of input already gets
- [x] Every connected client can read any Character's current facing off the Snapshot,
      including its own
- [x] The local Character's existing cosmetic facing/lean smoothing is unchanged — this is
      additive wire data for observers, not a replacement for local render easing
- [x] Covered by a shared-package test: facing round-trips through a Tick unchanged, and
      survives a reconciliation replay without drifting or resetting

## Implementation notes

`SimInputs` gains `facing: number` (world-space yaw, radians) — mirrors `moveDirection`'s own
pattern (a plain angle the client already resolved from its camera, ADR 0009: the simulation
never needs to know about the camera itself). `IDLE_INPUTS.facing` defaults to 0.

`CharacterController` stores it unconditionally at the top of `beginTick` (same spot as
`jumpHeldLastTick`/`dashHeldLastTick`), and reports it in `snapshot()`. `CharacterState`/
`CharacterSnapshot`/`CharacterSnapshotFields` in `SimState.ts` all gained the field, defaulting
to 0 in `characterSnapshot()`.

**Deliberately excluded from `ReconcileBase`.** Facing is an input mirror, not simulation-owned
state — like `moveDirection`, it needs no "restore," it's simply whatever the most recently
applied input said. A reconciliation replay re-derives it tick-by-tick from the replayed
inputs' own `facing`, exactly like every other input field. Proved by a regression test mirroring
the dash suite's own "reconcile-then-replay" shape: a client reconciled to an older snapshot and
replayed forward lands on the same facing the undisturbed ground truth has, never reset or
frozen by the correction itself.

One correction made mid-implementation: an early draft of the test suite assumed facing should
*hold its last known value* across a tick with no input entry for a Character (mirroring the
server's own `lastApplied`-queue behavior). That's the wrong layer — `RapierSimulation.tick`
itself has always reset every input-derived field (including `moveDirection`) to `IDLE_INPUTS`
on a missing entry; "hold the last real input across a gap" is the server's queue mechanism
(`matchLoop.ts`), which operates on whole `SimInputs` objects and so already carries `facing`
along for free, no code change needed there. The test was corrected to assert the real
contract instead.

`apps/client/src/game/index.ts`'s `sampledInput` now sends `facing: look.yaw`.

Every other `SimInputs` object literal across the test suites (server, client, shared) needed
`facing: 0` added — a mechanical fixup, no behavior change.

Full monorepo typecheck clean; full test suite green (856 tests across all 6 packages, one
observed server-test flake on a `pnpm -r test` run that passed cleanly on its own and on a
repeat full run — pre-existing, unrelated to this change).
