# 03 — Hit

**What to build:** Pressing the Hit input swings at whoever is directly in front of you within
melee range. Landing it knocks them back — or down, if hard enough — exactly like running
into them today, and cancels a Dash either of you had in progress.

**Blocked by:** 01 — Character facing

**Status:** ready-for-agent

- [ ] A new input triggers Hit, on its own cooldown — usable again only once it expires,
      mirroring Dash's own cooldown idiom (including HUD display)
- [ ] Hit only connects with a Character within short range, in front of you (using your
      replicated facing) — reuses Bump's existing contact/Impact pipeline rather than a new
      hitbox system
- [ ] Connecting produces an Impact on the target, exactly as forceful contact already does
      today (Stagger or Ragdoll, by the existing magnitude thresholds)
- [ ] Connecting cancels an in-progress Dash for both the striker and the target
- [ ] Behaves identically whether the Round is a Race or a Survival Round — no Round-type
      branching
- [ ] Covered by shared-package tests: connects within range/facing, misses outside it, applies
      an Impact, cancels both Characters' Dash, respects its own cooldown, and survives a
      reconciliation replay without double-firing
