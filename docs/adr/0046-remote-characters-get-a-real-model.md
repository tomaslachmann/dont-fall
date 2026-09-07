# 0046 — Remote Characters render the real model, not a placeholder capsule

Since M2 ticket 04, a remote Character has rendered as a plain tinted capsule
(`apps/client/src/render/scene.ts`) — a deliberate choice, recorded only as a code comment,
never an ADR: a different silhouette from the local MushroomKing so "that's someone else"
reads instantly, and cheap enough to scale toward ADR 0011's 12-player ceiling without
cloning a skinned rig per player.

M6 needs Hit and Grab to read as real combat between real bodies, not a capsule bumping
another capsule. That reason for the capsule no longer holds.

## Decision

**Every remote Character renders the same MushroomKing rig the local Character uses, cloned
once per connected Player, with a per-player color tint.** The tint is a deliberate,
minimal carry-over of the capsule's one genuine advantage — telling players apart at a
glance — now that every Character shares one mesh.

Ragdoll/GettingUp for a remote Character reuses the same canned Death-clip collapse the
local Character already plays, anchored the same way (pelvis-to-feet offset), rather than
driving the mesh from the `bones` data already on the wire. True bone-driven puppet
rendering stays out of scope — the local Character doesn't have it either (the rig's
skeleton doesn't cleanly support a dedicated get-up clip, per the existing code comment
in `characterModel.ts`), and building it for remote first would be solving a harder version
of a problem not yet solved for the easier case.

Considered and rejected: a distinct, cheaper model for remote Characters (still real, still
animated, just not identical to local). Rejected only for scope — one rig, reused, is the
smaller change; a second authored/rigged model is a real option worth revisiting once this
lands.

## Consequences

- One `AnimationMixer` and one cloned skinned rig per connected Player, up to ADR 0011's
  12-player ceiling — a real perf cost the flat capsule never had. M6's "Done when" includes
  a live check with 12 connected Characters for this reason, not as routine due diligence.
- Remote animation state (Idle/Walk/Run/Jump/Dash) is driven from `velocity`, `grounded`, and
  `dashing`/`dashSpeed` — already replicated on `CharacterSnapshot`, no new wire fields beyond
  `facing` (ADR 0045).
- `apps/client/src/render/scene.ts`'s `remoteGeometry`/`remoteMaterial` capsule path and its
  pooled `THREE.Mesh` map are replaced by a pooled cloned-rig-plus-mixer map, mirroring the
  local Character's own setup instead of diverging from it.
