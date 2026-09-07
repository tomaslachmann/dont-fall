# 02 — A real, oriented, animated remote Character

**What to build:** Every other Player in your Match appears as the same walking, running,
jumping, idling Mushroom King you play as yourself — tinted a distinct color per Player —
never the plain capsule placeholder that's stood in since M2. It faces the direction it's
actually looking, using ticket 01's replicated facing.

Retires the capsule placeholder for good (ADR 0046).

**Blocked by:** 01 — Character facing

**Status:** ready-for-agent

- [ ] A remote Character renders the same shared model the local Character uses, oriented by
      its replicated facing, in place of the capsule
- [ ] Idle/Walk/Run/Jump/Dash animation states play correctly for a remote Character, driven
      from its own replicated speed/ground/dash state — no new wire fields beyond facing
- [ ] Each connected Player gets a visually distinct, stable color tint, so "who's who" reads
      at a glance the way the capsule's own tint used to
- [ ] A remote Character's Ragdoll/GettingUp plays the same canned collapse/recovery the local
      Character already uses — not true bone-driven puppetry (explicitly out of scope)
- [ ] Live-verified with 12 connected Characters: frame rate holds and every one renders and
      animates correctly, satisfying ADR 0011's ceiling
