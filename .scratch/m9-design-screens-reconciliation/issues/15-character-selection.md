# 15 — Character selection

**What to build:** A selectable/equippable character model system — distinct from ticket 13's
ownership data — needed by `CharacterSelect.tsx`'s turntable/pick UI.

**Blocked by:** nothing, for the stub described below — it can land as part of the M9 wiring pass
(alongside tickets 5–10), independent of accounts/currency. Real selection logic is blocked on new
character models (a separate, already-in-progress art/pipeline workstream) and ticket 13 (needs
cosmetic-ownership data to gate locked/owned skins), neither of which this ticket needs yet.

**Status:** done — the stub scope below was superseded mid-pass: body-color
selection shipped as a full slice (persisted on the Account, replicated to
the match, tinted in game) with a live 3D turntable, and the factory base
joined as an eighth skin whose eyes keep their authored color.

## Decided scope (ADR 0052)

- **Ships now as a stub.** Wire `CharacterSelect.tsx`'s screen in; picking any character shows a
  "not implemented" message (a plain alert is fine) instead of doing anything. No backend, no
  ownership check, no persistence.
- **Real selection is explicitly deferred**, not cut — it waits on new character models existing
  (each one needs a rig, animations, and ragdoll bone mapping per ADR 0047) and on ticket 13's
  ownership data, once that's built. Revisit this ticket's scope when either lands.

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

Stub (this wiring pass):

- [x] `CharacterSelect.tsx` wired behind AuthGate at `/character`, with a
  CHARACTER pill on the Main Menu and back-to-menu navigation
- [x] SAVE and OPEN SHOP honestly say the action isn't implemented (plain
  alert, per the scope above) instead of pretending — no backend, no
  ownership check, no persistence
- [x] Covered: `CharacterSelect.test.tsx` (tabs/swatches/callbacks),
  `CharacterSelectRoute.test.tsx` (render/back/alerts), App routing cases

Body-color selection (shipped, superseding the stub above):

- [x] SAVE persists via `PUT /auth/me/cosmetics` (`accounts.bodySkin`, shared
  `invalidBodySkinReason`); the pick pre-selects off `GET /auth/me`
- [x] The skin replicates to the match (lobby roster → snapshot) and tints
  the local model, every remote rig, and the free-roam bean
- [x] The turntable renders the real BLIP rig (idle, auto-rotate, ROTATE spin,
  PLAY EMOTE wiggle, RANDOMISE) with a live preview tint; WebGL-less
  environments degrade to the caption
- [x] The factory base is the eighth skin (id 7, `BASE_BODY_SKIN_ID`) —
  untinted, with a "BASE" panel label; eye materials never take the tint
  (`playerTint.ts`, BLIP-specific by authored material name)
- [x] Covered: `cosmetics.test.ts` (range + tri-state `bodySkinHue`),
  `playerTint.test.ts` (eyes/base/restore), `CharacterSelect.test.tsx`,
  `CharacterSelectRoute.test.tsx` (incl. base SAVE), API auth suite

Hats (ADR 0083, 2026-09-17):

- [x] Six hats from the first cosmetics pack, catalogued in shared (`HATS`),
  unlocked by the Account's level (derived from XP, no ownership table)
- [x] Saved on the Account (`accounts.hat`) through the same `PUT
  /auth/me/cosmetics` (403 for a locked hat), replicated on the Lobby roster
  and kept on the saved Match result for the podium
- [x] Worn on the head bone by every rig: local, remote, free-roam, the
  turntable, the menu hero, Profile, Rewards and the podium; the crest tucks
  under every hat but the crown
- [x] The HAT tab picks one (locked tiles show their level); Rewards
  announces a hat a Match unlocked and EQUIP NEW HAT puts it on
- [x] Covered: `cosmetics.test.ts`, the API auth, DAO and DB suites,
  `hats.test.ts` (against the real files), `remoteCharacterPool.hats.test.ts`,
  `CharacterSelect.test.tsx`, `CharacterSelectRoute.test.tsx`,
  `endRoutes.test.tsx`
- [ ] Live check (the user's): the hats on every skin, the crest under a hat
  while Floating, the preview framing of the crown and UFO

Real selection (deferred — revisit when new character art or ticket 13 lands):

- [ ] Not yet scoped

## Watch out

- Don't start implementation from this ticket's current state. Flag the ADR 0046 interaction
  (replicated character model) to whoever scopes this — it's not purely a menu-screen concern.
