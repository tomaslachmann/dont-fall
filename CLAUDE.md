# DON'T FALL

A chaotic multiplayer obstacle-racing game for the browser. Players run a physics
playground / obstacle course; the core fantasy is **physical chaos and player
interaction** — bumping, shoving, and falling. Fall Guys is the reference for
*match structure only*, never for feel.

Design philosophy: **Easy to understand. Hard to master. Hilarious when you fail.**

## Status

**M1 done** — a local physics playground (`docs/milestones/M1.md`, fully checked).
Tickets 01–07 in `.scratch/m1-playground/issues/`: monorepo + fixed 30 Hz sim + render
interpolation (01); Rapier kinematic-capsule Character, WASD, spring-arm camera,
pointer-lock free-look (02, 02b); platforms + Fall + Checkpoint respawn with a lockout
penalty (03); jump + dash (04); ragdoll state machine (05); `CharacterController`
extracted from `RapierSimulation` (05b); Spinner Obstacle, dynamic Props, dash-into-a-
wall Ragdoll (06); procedural Wobble + feel-tuning pass (07). Plus a pre-M2 polish pass
on Dash (nitro-style build-up, speed-gated wall Ragdoll, speed-lines effect) and a
MushroomKing character model swap. See ADRs 0006 / 0009 / 0010.

**M2 done** — netcode (`docs/milestones/M2.md`, "Done when" met and live-verified with 2
browsers). Authoritative Node server at a fixed 30 Hz (ADR 0002/0011); client-side
prediction + local replay for the local Character, discrete state always snaps (ADR
0013); a decaying render-time offset smooths both the local Character's correction and a
pushed Prop's (ADR 0022 / 0026), with the server consuming `input[serverTick]` rather than
FIFO (ADR 0027); Character-to-Character Bump reuses the M1 Impact pipeline one-sidedly
(ticket 04); ragdoll replication + entity-category/time-sync/snapshot-rate protocol-v2
(ADR 0018–0025). Full implementation surface: `.scratch/m2-netcode/issues/`. Two items
remain explicitly deferred as non-blocking polish (predicted-ragdoll jitter, Wobble
disabled for M2) — see M2.md's checklist.

**Next:** M3 — Procedural Segments (build a Track from Modules).

## Tech stack

- **Language:** TypeScript everywhere.
- **Client rendering:** Three.js, hand-written game loop. No full engine (Unity/Godot/PlayCanvas).
- **Physics:** Rapier (WASM). Same module on client and server.
- **Server (from M2):** Node. Authoritative. One instance spun up on-demand per Match.
- **Screens (from M4):** React + `react-router`, code-split from the game module. HUD is plain DOM, not React. (ADR 0008)
- **Monorepo:** pnpm workspaces.
- **Client bundler:** Vite.

## Repo structure

```
packages/shared/   Simulation step, domain types, tuning constants. Runs on BOTH client and server.
apps/client/       Three.js renderer, input, camera, prediction, interpolation.
apps/server/       Authoritative match server (M2+). Imports the sim step from shared.
docs/adr/          Architecture decision records. Read these before changing architecture.
docs/milestones/   Milestone specs. Each is a checklist with a one-line "done" definition.
CONTEXT.md         Glossary / ubiquitous language. Use these exact terms in code and docs.
```

## Non-negotiable architecture invariants

These are settled decisions with ADRs. Do not violate them without adding a superseding ADR.

1. **The simulation runs at a fixed 30 Hz.** Rendering runs independently at the
   display refresh rate and interpolates between simulation states. Never couple
   game logic to frame delta time. (ADR 0004)
2. **The simulation step lives in `packages/shared`** and is pure/deterministic
   with respect to `(state, inputs) -> state`. The client runs it for prediction;
   the server runs it as the authority. (ADR 0003, 0005)
3. **The server is authoritative** (from M2). Clients send inputs, never state.
   Clients predict only their own Character; all other entities are interpolated
   from server snapshots. No rollback. (ADR 0002, 0003)
4. **The Character is a kinematic capsule** driven by a state machine
   (`Controlled → Stagger → Ragdoll → GettingUp → Controlled`). The ragdoll is a
   separate articulated body activated on impact/fall. (ADR 0006)
5. **The HUD is plain DOM; Screens are React.** React owns the app shell and
   routing and mounts `<GameCanvas>`; the game loop never runs through React.
   The in-match HUD is drawn by the game. (ADR 0008)

## Roadmap

| Milestone | Goal |
|-----------|------|
| **M1** | Local physics playground. "Fun to walk, jump, bump, and fall." |
| **M2** | Netcode — 2 players validated, architected for up to 12 (ADR 0011), authoritative server. |
| **M3** | Procedural Segments — build a Track from Modules. |
| **M4** | Match structure — Rounds, Qualification, Time Limit. First Screens: React shell + lobby/results (ADR 0008). |
| later | Power-ups, Grab, Betting/Spectator, level themes, the Skyfall final. |

## Working agreements

- Read `CONTEXT.md` before naming anything. If you need a term it lacks, propose
  adding it rather than inventing a synonym.
- Tuning values (jump height, dash cooldown, fall threshold, etc.) live as named
  constants in `packages/shared`, not scattered magic numbers.
- Keep `CONTEXT.md` a glossary only — no implementation detail, no decisions.
  Decisions go in `docs/adr/`.
- When a change is hard to reverse, surprising without context, and the result of
  a real trade-off, add an ADR.
- `/code-review` at **medium** for scaffold/plumbing/small-feature tickets;
  **high** only for intricate logic (netcode, physics state machines, procedural
  generation).
