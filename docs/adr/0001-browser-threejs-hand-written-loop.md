# 0001 — Browser target, Three.js, hand-written game loop

DON'T FALL ships as a browser game written in TypeScript, rendered with Three.js,
with a hand-written fixed-step game loop rather than a full engine (Unity, Godot,
PlayCanvas).

The project is solo and partly a learning exercise, and it needs a custom
authoritative netcode layer (ADR 0002, 0003). A full engine's WebGL/WASM export
is heavy, and its networking and loop assumptions fight a custom snapshot model.
Three.js gives maximum control over the game loop and network integration, which
is exactly where the hard problems are, at the cost of writing scene management,
character control, and tooling by hand.

## Considered options

- **Three.js + custom loop** (chosen) — full control, most learning, most boilerplate.
- **Babylon.js** — more batteries included, but its scene graph and physics plugins
  add opinions we'd fight when wiring a custom server sim.
- **Unity / Godot WebGL export** — mature editors and physics, but heavy web builds
  and awkward to bolt a bespoke authoritative-snapshot netcode onto.
