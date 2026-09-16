# 0070 — Bounce attaches to a Segment, and a bouncy deck wears an inflatable sheet that answers your feet

## Context

`SURFACES.bounce` (restitution 0.85, floor 6) has existed since M3.7 and
nothing has ever used it: no Asset carries it, and the only way to place it was
the procedural grey-box `bounce` Module, which looks exactly like a `bridge`.
ADR 0069 left it there deliberately — "the right model for a trampoline deck —
a Surface some future Asset carries, or an attachment in the inspector beside
ice and mud" — and then went looking for art.

The search (2026-09-15) came back empty in a useful way: the free KayKit
Platformer Pack's only bouncy pieces are the spring and the spring pads, both
already spent on launch pads (ADR 0069); the trap pack has none; KayKit's paid
EXTRA tier has a pinball *bumper*, which is a horizontal shove and not what
`SURFACES.bounce` does; and the CC0 trampolines on Poly Pizza are CC-BY, thin-
legged and off-style. The user's call: don't buy a model, follow ice and mud —
*"udělal bych to stejně, ale muselo by to být vypouklé jakoby nafukovací a
reagovat na skákání"* — and supplied the material (ambientCG Plastic 016 B).

Settled with the user (2026-09-15), two questions asked and answered.

## Decision

**Bounce is the third Segment Surface attachment, and its sheet is an
inflatable skin: convex at rest, dented by whoever is standing on it, ringing
after a landing — drawn, never simulated.**

- **`Segment.bounce?: boolean`** — exactly `true` when present, additive and
  optional exactly like `ice` (ADR 0066) and `mud` (ADR 0067). `resolveTrack`
  forces the Segment's every collider to the bounce Surface through the same
  one `attachedSurface`, and publish refuses **any** pair among the three: one
  deck, one Surface. The tie-break for a Track that arrives unvalidated is
  bounce > mud > ice, on mud's own rule — the visible top layer is the one the
  physics should match.
- **The collision stays flat.** The deck's collider is the box it always was;
  only vertices move. This is ADR 0069's line ("the collision never moves")
  held for the same reasons — no new replicated state, no desync surface, and
  the sim keeps the model it was tuned against.
- **The shape is shared, pure maths** (`BounceOverlay.ts`), so the builder's
  preview and the game draw the same skin: a dome pinned at the rim
  (`bounceDomeLift`, `bounceEdgeMask`), a press with a definite edge
  (`bouncePressFalloff`), and a landing's damped ring (`bounceWobble`). Every
  vertical term is multiplied by the edge mask, so the rim is stitched to its
  deck by construction — no dent, however deep, can push the border off it.
- **It answers feet, from state already on the wire.** A Character near the
  sheet presses it — standing on it *or* on the way down, because an inflatable
  gives way as you arrive and not at the instant of contact — and harder for a
  moment after a landing. The impact speed comes from tracking the fall the way
  the simulation's own `airbornePeakFallSpeed` does, because by the time a
  bounce has happened the speed that caused it is gone from the snapshot.
  Position and velocity are replicated already, so this costs the protocol nothing and a
  remote Character dents a sheet exactly like the local one — ADR 0069's
  argument for the Spring squash, applied again.
- **An inflatable is convex everywhere except under you**, which is also what
  keeps the visual honest: the dome would otherwise put the skin above the flat
  collider a Character stands on, and the dent puts it back down exactly where
  the feet are. The press is therefore tied to the dome: `BOUNCE_PRESS_DEPTH`
  is kept a shade above `BOUNCE_DOME_RISE`, and both are shaped by the same
  `bounceProfile`, so they cancel at the rim as well as dead centre. Raise one
  without the other and the sheet starts swallowing people to the ankles.
- **The profile is pumped, not pointed.** `1 - (1 - mask)²` rather than the
  mask itself: an inflated thing is fat and nearly flat across its top and does
  its bending near the edge where the skin is pulled to its frame. The plain
  mask peaked to a point in the middle and read as a tent (user, 2026-09-15:
  *"je to málo nafouklé"*), which is also why the rise is knee-high rather than
  ankle-high. `BOUNCE_PRESS_HEIGHT` is in turn kept above the rise, so the skin
  is already giving way by the time the feet reach the top of the dome — the
  three constants move together or not at all.
- **The material is ambientCG Plastic 016 B's Color map** (CC0), committed as
  `assets/bounce_surface.jpg` with the provenance sidecar the ice and mud maps
  already have, served by the same `/assets` route, tiled on the same pitch.
  The shine is the material's (roughness 0.18), not the map's: KayKit's own
  look is glossy plastic, and a photoreal rubber would read as canvas.
- **The builder shows the rest shape** — no Characters there to dent it — and
  `BOUNCE` joins `PLAIN`/`ICE`/`MUD` as the fourth choice in the inspector's
  one-deck-one-Surface control.

## Consequences

- New shared surface: `Segment.bounce`, `invalidBounceReason`/`isSegmentBounce`,
  `BounceDeck`, `moduleHasBounceSurface`, the `BOUNCE_*` constants and the four
  shape functions, plus `resolveTrack(...).bounceDecks` (renderers only — no
  protocol change).
- The API's surface-conflict check stops naming one specific pair and refuses
  any two attachments, so its message changed.
- The sheet is real geometry (24×24 quads per deck) rewritten every frame and
  re-normalled for the shine. That is the cost of the effect; if a Track ever
  sheets dozens of decks at once, the subdivision is one shared constant.
- A Character standing dead still keeps a dent under it — correct for an
  inflatable, and it means the sheet is never perfectly at rest while anyone is
  on it.
- The procedural `bounce` Module is **not** retired here: it now renders as a
  sheet like any other bouncy deck (`moduleHasBounceSurface`), the same courtesy
  ADR 0066/0067 gave the retired ice and mud Modules.
- Bounce still has no Asset of its own. If KayKit (or a future pack) ever ships
  a trampoline in this style, it can carry `surface: "bounce"` in its def and
  wear this same sheet with no further work.

## Alternatives rejected

- **Buying the KayKit EXTRA bumper.** Same artist, guaranteed style — but a
  bumper shoves you sideways, and `SURFACES.bounce` returns the speed you
  landed with. It would be art for a mechanic we have not built.
- **A CC-BY trampoline from Poly Pizza.** Free and pipeline-shaped (one `.glb`),
  but attribution-encumbered where everything else here is CC0, thin-legged
  where we need a deck, and visually from another game.
- **Doming the collider too.** Considered and put to the user: it would make
  the curve real (you would slide off the edges, and crossing it would be up
  then down). Rejected for this pass — a curved deck changes how every existing
  Track piece next to it plays, and the whole point of an attachment is that any
  deck can wear one.
- **A shader.** Cheaper per frame than moving vertices, but then the shape lives
  twice — once in GLSL for the look and once in TypeScript for the builder — and
  the two would drift. The geometry *is* the effect.
