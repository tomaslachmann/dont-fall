# 15 — Character selection

**What to build:** A selectable/equippable character model system — distinct from ticket 13's
ownership data — needed by `CharacterSelect.tsx`'s turntable/pick UI.

**Blocked by:** ticket 04 (scope decision), ticket 13 (needs cosmetic-ownership data to gate
locked/owned skins).

**Status:** planned — speculative pending ticket 04; do not start without its outcome.

## Why

No selectable-character or cosmetic-ownership concept exists anywhere. Every `skin` hit in
`packages/shared/src` is either Rapier's physics contact-skin margin
(`tuning.ts:232`, `RAGDOLL_CONTACT_SKIN`) or the initials-based `Avatar` rendering in
`LobbyScreen.tsx` — nothing about a selectable player model. `docs/research/
screens-inventory.md:204-209` already flagged this as a genuine gap; still true.

See `docs/research/test-components-design-screens-gap-analysis.md`, "Backend/domain gaps"
(Character selection/cosmetics entry) and screen row 1m.

## What to change

*(Deliberately unscoped — placeholder until ticket 04 confirms scope and ticket 13's ownership
model exists. Also needs a decision on where "which model renders as your Character" lives —
client-only cosmetic swap vs. replicated state other Players need to see, which touches ADR
0046's remote-Character-model work.)*

## Done when

- [ ] Not yet scoped

## Watch out

- Don't start implementation from this ticket's current state. Flag the ADR 0046 interaction
  (replicated character model) to whoever scopes this — it's not purely a menu-screen concern.
