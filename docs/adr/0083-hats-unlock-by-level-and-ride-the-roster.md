# 0083 — Hats unlock by level and ride the roster

## Context

The first cosmetics with their own art arrived on 2026-09-17
(`BLIP_Cosmetics_v1`): six hats (traffic cone, pot, bucket, propeller cap,
crown, UFO). With them came a re-export of the rig,
`BLIP_Character_Cosmetics_v1.glb`. It is v7 (ADR 0081) with the same nodes
and the same clips, byte for byte (compared before the swap), plus one morph
target on the body, `Hat_Tuck`, which pulls the crest down into the head so
a closed hat covers it. Each hat is one rigid mesh with plain colour
materials and no textures. It is authored in the `head` bone's own frame, so
it goes on with no offset, turn or scale. The pack suggests an unlock level
for each hat.

The user's request: every Player sees what every other Player wears,
everywhere. The choice is saved on the Account, and the client gets a way to
pick one. Settled with the user the same day:

- **Hats unlock by level**, at the pack's levels (2, 5, 9, 14, 20, 30).
- **The pack is cleaned out of `public/`**: only the files the game loads
  stay there. The `.blend`, the zip, the GIF and the notes were shipped to
  every player's browser.
- **A knocked-down Character keeps its hat on.**

The body skin (M9 ticket 15) already travels the path a hat needs: a column
on the Account, `PUT /auth/me/cosmetics`, `/auth/me` read by the match
server on `auth`, the Lobby roster on every snapshot, and a map on the
saved Match result for the podium.

## Decision

**A hat is one more slot on that same path. Whether an Account may wear one
is derived from its XP, not stored.**

- **Shared owns the catalog and the rule.** `HATS` in
  `packages/shared/src/cosmetics.ts` lists id, name, unlock level and whether
  the hat covers the crest. The ids are stored and sent, so they are never
  renamed. `lockedHatReason` compares `levelForXp` of the Account's XP with
  the hat's level. `hatsUnlockedBetween` gives the Rewards screen the hats a
  Match unlocked.
- **The Account stores the hat, and nothing stores ownership.** `accounts.hat`
  is nullable text, and NULL means no hat, so nothing needs backfilling. XP
  only ever rises, so whatever an Account has unlocked stays unlocked. An
  ownership table would only repeat that until something is sold or given
  away. When it is (a shop, an event), ticket 13's ownership model takes over
  this rule.
- **The API checks the hat on write.** `PUT /auth/me/cosmetics` takes
  `bodySkin`, `hat`, or both. A slot left out keeps its value, and
  `hat: null` takes the hat off. It refuses with:
  - 400 for anything that isn't a hat id,
  - 403 for a hat above the Account's level,
  - 400 for a body with nothing to equip.

  Every slot is checked before anything is written. The client sends the hat
  only when the pick changed, so a hat that has since become locked never
  blocks a skin change.
- **The match server passes the hat through.** It reads the hat from the
  same `/auth/me` response as the skin and puts it on the Lobby roster
  (`LobbyPlayer.hat`) and on the drop record. It also keeps it for the saved
  result (`PersistedMatchResult.hats`, sparse, and `{}` on older rows). Like
  the skin it is not re-checked there: the API checked it on write, and a
  client draws no hat for an id it doesn't know.
- **The client draws a hat with a wardrobe** (`render/hats.ts`), one per
  renderer.
  - **Loading.** A hat's model is fetched the first time anyone on that
    renderer wears it, and never before.
  - **Wearing.** Each wearer gets a copy that shares the model's geometry and
    materials, added under the `head` bone. The crest tucks for every hat
    but the crown.
  - **What the wardrobe won't touch.** The tint (`tintModel`) and a remote
    rig's teardown leave a worn hat alone, because its materials belong to
    the wardrobe.
  - **Load order.** A hat arriving after the Player picked another is
    dropped. A swapped hat stays on until the next one arrives.
  - **Clones.** Remote rigs are cloned from the local Character, hat and all,
    so a rig's first `wear` takes the copy off at once.
  - **Failures.** An unknown id, or a model that failed to load, is drawn as
    no hat.
- **Everywhere the Character is drawn:**
  - the local Character and every remote one, in a Match and in free-roam;
  - the Character Select turntable;
  - the Main Menu hero, Profile, Rewards, and the MatchOver podium, which is
    drawn from the saved result.

  The Screens get icon URLs from `lib/hatAssets.ts`, which has no three.js,
  so the menu bundle stays free of it (ADR 0008).
- **Picking a hat.** Character Select's HAT tab lists:
  - NONE;
  - the hats the level has unlocked;
  - the rest, locked, with the level each one needs.

  SAVE writes the skin and, when it changed, the hat. When a Match's XP
  crosses a hat's level, the Rewards screen shows that hat (the last one, if
  it crossed several) on the card the design already had. EQUIP NEW HAT puts
  it on there.
- **The files.** `public/models/` now holds only what the game loads:
  - `BLIP.glb`, the cosmetics export;
  - `hats/<id>.glb` and `hats/<id>.png` for each hat.

  The rest of the pack stays in the artist's output folder.

## Consequences

- A fresh Account is level 1, so it can wear no hat until its XP reaches
  level 2 (1,000 XP). Testing a hat by hand needs an Account with XP.
- The replicated roster grows by one short string per Player. Nothing about
  the simulation changes.
- `FloatLimbs` (ADR 0077) still swings the crest bones while Floating. The
  tucked crest moves with them inside the head, and whether any of it pokes
  through a hat there is a visual check for the user. So are the hats' look
  on each skin and the preview camera's framing of the tall hats (crown,
  UFO), which is fitted before the hat loads.
- `MatchRuntime` now clears the saved skins between Matches as well as the
  hats. It already cleared nicknames and Account ids and forgot the skins,
  which only left stale entries in the saved map.

## Alternatives rejected

- **An ownership table now.** It would hold exactly what the XP already
  says. It becomes worth having the day a hat is sold or given.
- **Checking the level on every read, or in the match server.** A write
  already refuses a locked hat. Re-checking on read only matters if a hat's
  level is raised after Accounts wear it, and nothing does that.
- **Loading every hat up front.** Fetching only the worn ones matches how
  Track Assets load (ADR 0080). A hat is at most 170 KB, and one Player's
  late hat costs a moment bareheaded.
- **The pack's own helper (`BLIP_Cosmetics_v1.js`).** It allows one manager
  per head bone and has to run after the mixer every frame. Neither fits
  pooled, cloned rigs. No clip animates the morph, so setting it once is
  enough.
