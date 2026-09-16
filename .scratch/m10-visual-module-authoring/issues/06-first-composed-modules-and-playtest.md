# 06 — First composed Modules + playtest

**What to build:** Proof the loop works: a fence + two more Modules (author's
choice, at least one using cylinders, one using per-primitive color/radius)
composed purely in compose mode, exported, committed, placed on a Track —
and a real Match played on it.

**Blocked by:** 05 (the whole loop must exist before it can be proven).

**Status:** planned.

## Why

M10's point was never the abstraction — same as M5's second Round type, the
loop is proven only by content that went through it with the devtools
closed. Three Modules is the minimum that exercises boxes, cylinders,
colors, radii, Sockets, and export without turning the milestone into
content production.

## What to change

- [ ] Compose a fence Module (posts + rails, cylinders, colored) start to
      finish in compose mode — no code touched, no export hand-edited
- [ ] Compose two more Modules free choice, covering: per-primitive radius
      variance, per-primitive colors, Socket chaining (at least one chains
      into an M1 Module on a Track)
- [ ] Export + commit all three per ticket 05's docs, following them
      verbatim — every friction point goes back into the docs, not around
      them
- [ ] Place all three on one Track and play a real Match on it (live):
      walk every surface, bump every post, confirm looks match the builder

## Done when

- [ ] Three committed registry Modules, each traceable to a compose-mode
      session (no hand-written geometry in their statics)
- [ ] A real Match played live on a Track containing all three — feet flat,
      colors right, cylinders solid, no phantom or missing collision
- [ ] Builder preview vs. in-game render compared side by side for all
      three — same shapes, same colors, same radii
- [ ] The milestone's "Done when" reads true: a non-artist authored these
      without code or Blender

## Watch out for

**Dogfood honestly.** Every "I'll just fix this one number in the export"
is a compose-mode bug report — file it (fix or follow-up), don't normalize
hand-editing, or the loop rots before it's used.

**Three means three.** A fourth Module is content production, explicitly out
of M10 — stop at three even if composing is fun.
