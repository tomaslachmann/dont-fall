# 0009 — `Simulation` owns Rapier; `SimState` is a plain serialisable POJO

Rapier's `World` is a live WASM object — it cannot be structured-cloned or sent
over the wire, which is what ADR 0003's snapshot netcode and ADR 0005's shared
`(state, inputs) -> state` step assumed. This ADR resolves that split.

## The split

**`SimState`** is a plain-data POJO and nothing else:

- the observable state of the world at one tick
- the network snapshot (ADR 0003)
- the source the renderer interpolates between (ADR 0004)

It contains **no Rapier handles** — no `RigidBody`, no `World`, no `Collider`
references. It must stay 100% serialisable.

**`Simulation`** owns the mechanism:

- the Rapier `World`
- the entity ↔ rigid-body mapping
- the simulation rules
- `tick(inputs)` — advance the world one fixed tick
- `snapshot()` — read the current world into a fresh `SimState`

```ts
const simulation = new RapierSimulation(config);
simulation.tick(inputs);
const snapshot = simulation.snapshot();
```

There is no `step(state)` free function — it stops making sense once Rapier holds
the state.

## `advanceFixed` stays engine-agnostic

`advanceFixed` drives any object matching a small contract, not `RapierSimulation`
directly:

```ts
interface FixedSimulation<TInput, TSnapshot> {
  tick(input: TInput): void;
  snapshot(): TSnapshot;
}
```

`RapierSimulation implements FixedSimulation`. M1 does not close the architecture
around Rapier — a fake in-memory `FixedSimulation` is a valid test double and a
valid future alternative.

## Directory layout in `packages/shared`

This layout is part of the decision — without it, someone "simplifies" by putting
a `RigidBody` on `SimState`.

```
packages/shared/src/
├── simulation/
│   ├── RapierSimulation.ts   ← owns the Rapier World; implements FixedSimulation
│   ├── entityMap.ts          ← entity id ↔ rigid-body handle (arrives with the 2nd tracked entity)
│   └── snapshot.ts           ← world → SimState assembly (arrives when >1 entity makes it
│                                worth extracting; until then it lives in RapierSimulation.snapshot())
├── state/
│   ├── SimState.ts           ← POJO only
│   └── interpolate.ts        ← SimState × SimState × alpha → render state
├── input/
│   └── movementDirection.ts  ← keys × cameraYaw → Vec3; knows neither Rapier nor Three
├── timing/
│   ├── advanceFixed.ts
│   └── FixedSimulation.ts    ← the contract above
├── math/
│   └── vec3.ts
└── tuning.ts
```

## Out of scope for M1

How a client reconstructs / reconciles a `Simulation` from an authoritative
`SimState` (rebuild bodies from the snapshot, replay local inputs, or use Rapier's
own serialization) is an M2 netcode decision. M1 only needs
`new RapierSimulation()` → `tick()` → `snapshot()`.

## Consequences

- Ticket 01's `step` free function and the `demo` entity are replaced by
  `RapierSimulation` and a `character` entity.
- `advanceFixed` takes a `FixedSimulation` + inputs and returns
  `{ snapshot, previousSnapshot, accumulatorMs, steps }`.
- Camera collision and other presentation concerns never call `Simulation` — they
  read snapshots only.
