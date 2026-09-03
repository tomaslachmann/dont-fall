# 04 — Volumes, and the updraft

**What to build:** A region of air that lifts a Character inside it. Ride it up, drift out of the
side, land.

**Blocked by:** M3.6 ticket 07 (the rename that frees the word `Volume`). Independent of the Surface
work — a Volume is its own entity kind, not a Surface.

**Status:** blocked

- [ ] A Module can carry Volumes as their **own entity kind**, never a collider wearing a special
      material. glTF, Unreal, Source and Quake all separate the two (ADR 0036)
- [ ] Containment reuses the pipeline a Checkpoint's trigger already proves works, which has been
      correct for rotated and tilted Segments since ADR 0034 — not a second implementation
- [ ] An updraft applies an upward force to a Character inside it. **No flight mode**: no new
      Character state, no new controls, no camera change. You are blown upward and you flail — which
      is the intended comedy, and which keeps the effect a pure function of position with nothing to
      replicate
- [ ] Overlapping Volumes: exactly one wins by priority, never summed. Summing turns an authoring
      mistake into what looks like a physics bug
- [ ] Every Volume carries a maximum induced speed — a wind Volume without one is an unbounded
      integrator
- [ ] Manually verified live: ride an updraft up, drift out of the side of it, and land without being
      knocked down
