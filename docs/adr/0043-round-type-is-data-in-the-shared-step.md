# 0043 — A Round type is data in the shared step, never a branch on the mode

M5 needs per-Round-type rules inside a simulation step that is run by **both** the authoritative
server and the client's own prediction, and which must stay deterministic and identical on both
(ADR 0003, 0005). The obvious shapes — a subclass per Round type, or a `switch` on a mode enum
inside the step — both put the mode into the step. The question is whether that is safe.

Checked against released engine source rather than write-ups
(`docs/research/round-type-architecture.md`), three engines answer the same way:

- **Quake III's shared movement step contains no reference to the gametype at all.** The one
  shared file that consults it takes it as a **parameter**, carrying the source comment *"This
  needs to be the same for client side prediction and server use."* The server passes the game
  type; the prediction path passes a replicated copy of it.
- **Source SDK 2013's `gamemovement.cpp` — 4951 lines — makes zero `GameRules()` calls.**
- **Unreal is a negative result**: `GameMode` can be server-only precisely because nothing
  predicted consults it. Copy the split, not the location.

## Decision

- **`RoundRules` is a plain data record in `packages/shared`** — the fields the step actually
  reads (does a Fall respawn or eliminate; what grants Qualification), never a Round-type name.
- It is **resolved once, before COUNTDOWN** (ADR 0041) and **replicated on the snapshot beside
  `phase`**, so the client predicts against the same record the server simulates.
- **The shared step reads fields; it never branches on a Round-type identity, and there is no
  per-Round-type simulation subclass.** Adding a Round type means adding fields and a resolver,
  not editing the step.
- **Scoring, advancement and Round-end stay server-only** (ADR 0040 unchanged) — they depend on
  other Characters, which clients do not simulate.
- **A Round type may never vary** the tick count or step count, the Character collection's
  iteration order, or the set of simulated bodies. Anything that appears to need one of those is
  the wrong shape.

## Considered options

- **A simulation subclass per Round type** (`SurvivalSimulation extends RapierSimulation`) —
  rejected: subclass identity becomes state the client must agree about *before* it can predict
  anything, and it invites overriding the step itself, which is the one thing that must not vary.
- **`switch (roundType)` inside the shared step** — rejected: every new Round type edits the step
  that both sides must agree on, and it is precisely what neither Quake nor Source does.
- **Server-only rules, client told the outcome** — rejected: the client would predict a respawn
  the server never performed, and mis-predicting a Fall is half an RTT of the wrong world.
- **Rules as data on the Track** — rejected under ADR 0041: whether a Fall eliminates is the
  contest's rule, not the place's.

## Consequences

- `SimulationConfig` gains a `RoundRules` field and the snapshot gains the record; both are
  additive, and a Round with Race rules resolves to today's behaviour exactly.
- Terrain that changes during a Round (a collapsing floor) must be a pure function of the Tick in
  shared code — the `Spinner` pattern (ADR 0025) — never a server-sent event.
- The audit's two input-lock mechanisms (Qualification's lock inside the step, the phase lock
  outside it) must become one before this lands, or every Round type that changes who may move
  forks at that seam.
