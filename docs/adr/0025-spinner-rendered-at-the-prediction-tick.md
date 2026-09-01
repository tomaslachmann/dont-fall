# 0025 — The Spinner is rendered at the prediction tick, uniformly

The Spinner is a "kinematic pure-function" entity: its pose is `spinnerAngleAt(tick)`, exact
at any tick, no divergence possible, no wire data. That makes it the one entity where the
client can choose *which* tick to display it at.

The local Character's prediction collides with the Spinner at the **prediction tick**
(~1–2 ticks ahead of the server). Everything else the client doesn't predict is drawn at
the **render tick** (~66 ms in the past, ADR 0017/0020). So the Spinner can be shown either
way, and the choice is a real trade-off:

- **Render tick** — visually consistent with other interpolated entities, but the blade is
  ~2–3 ticks behind where the local Character's own prediction was hit. "The blade is
  visibly nowhere near me and I'm on the ground."
- **Prediction tick** — matches the local Character's own collision experience, but when
  spectating another player near the Spinner, the blade is offset relative to that player
  (who is drawn at *their* interpolation time).

## Decision

**Render the Spinner at the prediction tick, uniformly** (not a distance-based hybrid).

- Your own knockdown looking wrong is immediate and personal; the spectating mismatch is
  diffuse, and the other player's knockdown timing comes from the server anyway (ADR 0015).
- A hybrid ("prediction tick only when you're near it") would introduce an **approach-time
  pop** — a discrete jump in the Spinner's time base as you enter collision range, formally
  the same error class as an LOD pop (hard switching between discrete representations of one
  object). A continuous angular drift (the uniform choice's cost) is less perceptually
  disruptive than a discrete jump of the same magnitude.
- Precedent: Unreal community solutions for the identical "networked rotating platform"
  problem drive the platform off `GetServerWorldTimeSeconds + ExactPing` on a single
  consistent forward-predicted time base, with no distance-based switching.

**No cited source quantifies the perceptibility threshold for rotational drift on a fast
hazard.** So this ADR carries a **measurable revision criterion** rather than "revisit if it
looks broken": if the expected angular offset — `spinnerAngularSpeed × (LEAD + INTERP_DELAY)`
— exceeds **[TBD, e.g. 20°]** at the 95th-percentile session RTT, the hybrid or a
capped-lead variant must be reconsidered. The mismatch is a **per-observer value** dependent
on that observer's own RTT (their LEAD) — two players watching the same third player at the
same Spinner see different offsets. Record the observed distribution in playtests.

## Consequences

- The client renders the Spinner from `estimatedServerTick + LEAD` (its prediction tick),
  not `serverInterp.renderTick(now)` — a change from the current code, and it applies to all
  clients including pure spectators.
- No wire or authority change — the Spinner stays out of `SimState`.
- This is the concrete rule for the "kinematic pure-function" category in ADR 0018's entity
  table; future entities of that kind (e.g. a Pendulum) follow it.
