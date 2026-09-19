# 13 — The pause menu, screen shake and nameplates

**What to build:** Esc in a Round opens the mock SettingsModal (PAUSED). It holds three real
settings, which also live on Settings → GAMEPLAY: screen shake on impact (OFF / LOW / FULL),
nameplates over other beans (OFF / ON), and voice chat (17). ALL SETTINGS opens Settings; QUIT MATCH
leaves. The game never pauses; the sheet is over live play. ADR 0110.

**Blocked by:** — (the voice chat row waits for 17)

**Status:** planned

- [ ] The pause sheet, ported 1:1; Esc toggles it and it releases pointer lock
- [ ] Screen shake: a camera shake on impact, knockdown and hard landing, scaled by the setting
- [ ] Nameplates: other Characters' names drawn over them in a Round
- [ ] Both settings stored per device like audio and video, on Settings → GAMEPLAY too, which
      replaces the "PANE · SAME ROW VOCABULARY" placeholder; the dead SCREEN SHAKE toggle goes
- [ ] Settings → ACCOUNT is ticket 05's (the avatar, name, Discord, LOG OUT)
- [ ] Tests: the settings, the shake scale, the pause toggle
