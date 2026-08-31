# 0004 — Fixed 30 Hz simulation, rendering interpolates independently

The simulation runs at a fixed 30 Hz timestep. Rendering runs independently at the
display's refresh rate and interpolates between the two most recent simulation
states. Game logic is never coupled to frame delta time.

This is adopted from M1, not retrofitted later. The feel tuned in the local
playground must be the feel that ships on the server, so the same fixed tick runs
from day one. Building the render-interpolation layer early also means the
interpolation used for remote entities in M2 (ADR 0003) is already in place.

## Consequences

- M1 must include a render-interpolation layer even though it is single-player.
- Input is sampled per frame but only applied at simulation ticks; combined with
  local prediction (ADR 0003) the added input latency is imperceptible for this
  genre.
- 30 Hz (not 60) is a deliberate cost/consistency choice for the on-demand
  authoritative servers (ADR 0002).
