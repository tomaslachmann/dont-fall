# 11 — Emotes and a victory pose

**What to build:** An Account picks an emote and a victory pose in Character Select (the EMOTES
tab, PLAY EMOTE, VICTORY POSE). The emote plays on your bean in the Lobby, and the victory pose on
the MatchOver podium. Outside a Round only, stored on the Account like a Hat. The set is the rig's:
Win, Shrug, Sulk, Wobble, Punch. ADR 0110.

**Blocked by:** —

**Status:** planned

- [ ] Account columns `emote` and `victoryPose`, set through `PUT /auth/me/cosmetics`, carried on
      the Lobby roster like `hat`
- [ ] Character Select: the EMOTES tab lists the set and previews it; VICTORY POSE picks the pose;
      RANDOMISE re-rolls the open tab, not always the Colour
- [ ] Lobby: play your emote on your bean (a Lobby message, so everyone sees it)
- [ ] MatchOver podium plays each winner's victory pose
- [ ] Tests: storing, roster, which clip each surface plays
