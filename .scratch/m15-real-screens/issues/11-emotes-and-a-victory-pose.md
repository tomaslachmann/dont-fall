# 11 — Emotes and a victory pose

**What to build:** An Account picks an emote and a victory pose in Character Select (the EMOTES
tab, PLAY EMOTE, VICTORY POSE). The emote plays on your bean in the main menu and in Character
Select; the victory pose plays on your Profile and on the MatchOver podium when you win. Outside a
Round only, stored on the Account like a Hat. The set is the rig's: Win, Shrug, Sulk, Wobble, Punch.
ADR 0110.

**Blocked by:** —

**Status:** done on tests (2026-09-19)

- [x] Account columns `emote` and `victoryPose`, set through `PUT /auth/me/cosmetics`
- [x] Character Select: the EMOTES tab lists the set and previews it; VICTORY POSE picks the pose;
      RANDOMISE re-rolls the open tab, not always the Colour
- [x] Main menu: the hero plays your emote in place of the old Win loop
- [x] Profile and the MatchOver podium play the victory pose
- [x] Tests: storing, the podium's pose, the Character Select controls

## Changed in the question round

The ticket first put the emote on your bean in the Lobby, as a Lobby message everyone sees. The user
chose "Menu + Profil + pódium" instead (2026-09-19): the emote plays in the main menu and in Character
Select, the victory pose on the Profile and on the podium when you win. The Lobby has no 3D bean to
play it on, so nothing rides the roster and no Lobby message was added. The VICTORY POSE button
steps through the set, and the turntable shows each pose as it is picked ("Tlačítko přepíná").

## As built

- `EMOTES` in `packages/shared/src/cosmetics.ts` (`win`, `shrug`, `sulk`, `wobble`, `punch`), with
  `DEFAULT_EMOTE` `wobble` and `DEFAULT_VICTORY_POSE` `win`. They are free like colours, so there is no
  level gate. `invalidEmoteReason` names the set in the 400.
- Account columns `emote` and `victory_pose`, with CREATE and ALTER migrations in `db.ts`.
- The podium's pose is read from the winner's Account at read time (`victoryPosesOf` in
  `matches.service.ts`), not stored with the Match. It is a signature: a Player who changes it
  changes it on every past podium too. `GET /matches/:id` answers `MatchResultResponse`
  (`PersistedMatchResult` plus `victoryPoses`), and a seat whose Account is gone simply has none.
- `EMOTE_SEQUENCES` in `CharacterPreview.tsx`: Win, Shrug and Sulk play their authored
  In/Hold/Out triplets. Wobble and Punch are one clip each, followed by a 1.6 s Idle rest so that a
  looped Punch reads as a pose. Every clip named is one `BLIP.glb` ships (checked against its JSON chunk).
- The turntable plays an emote once, then idles (`emoteOnce`). `CharacterPreview` grew a
  `playToken`, so the same emote asked for twice restarts rather than being ignored as an unchanged
  sequence. The old `EMOTE_HOLD_MS` Wobble swap is gone.
- Only 1st on the podium plays a victory pose. 2nd still sulks and 3rd still shrugs, since the
  performance is positional. The caption names the pose (`VICTORY POSE · PUNCH`), as the Profile's does.
- RANDOMISE re-rolls whichever tab is open (COLOR, SKIN, HAT or EMOTES), never to the current pick.
  For a skin or a hat, taking it off counts as a pick.
- `useMatchResult` now reads through `lib/api/matches.ts`'s `getMatchResult`, which had no callers.

**Waiting on the user:** how each emote looks on the real rig, especially whether the Punch and
Wobble rests are the right length, and the menu hero's Idle → emote rhythm.
