# 0045 — Character facing is a real, replicated field

Every Character's cosmetic facing (which way the model turns to look) has always been a
purely local, render-only computation on the owning client — smoothed toward the Character's
own `moveDirection` in `apps/client/src/render/scene.ts`, never touching `SimInputs` or
`CharacterSnapshot`. That was fine while a remote Character rendered as a capsule with no
front or back to get wrong.

M6 replaces the remote capsule with a real oriented, animated model (ADR 0046) and adds Hit
and Grab, both of which care which way a Character is aiming. Neither works from a direction
derived only from `velocity` — that direction is undefined while standing still and wrong
while strafing or backpedaling, exactly the moments a melee move or a grab is likely to fire.

## Decision

**Add a `facing` field (yaw, radians) to `SimInputs`/`CharacterSnapshot`**, sent by the owning
client from its own look-yaw every Tick, alongside `moveDirection`. The server treats it the
same as any other input: authoritative once received, replicated on the Snapshot, with no
validation beyond what already applies to the rest of `SimInputs`.

Rejected: deriving facing from `velocity`. It produces a visibly wrong or undefined direction
in exactly the states (standing still, strafing, being held) where Hit and Grab are aimed and
most likely to be used — the one case this field exists to serve.

## Consequences

- `SimInputs` and `CharacterSnapshot` both gain one `number` field — a small, permanent
  protocol addition, not a one-off.
- The local Character's own render-layer facing smoothing (`scene.ts`) is unaffected; this is
  additive wire data for *other* clients to render a remote Character's true orientation, not
  a replacement for the local player's own cosmetic lean/turn easing.
- Hit's and Grab's own targeting (who is "just ahead of you") reads this field rather than
  re-deriving a direction from position history.
