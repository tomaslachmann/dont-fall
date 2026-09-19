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

## Amended by ADR 0109 (2026-09-19)

The server's half of the fixed 30 Hz was a `setInterval`, which drifted to 28.8–29.5 Hz natively and 25–27 Hz in Docker. It now ticks on a grid (`tickScheduler.ts`): Tick *n* is due at `anchor + n·TICK_MS`, one Tick per wake, and a wake that finds six or more due runs five and forgives the rest (`MAX_CATCH_UP_TICKS`).
