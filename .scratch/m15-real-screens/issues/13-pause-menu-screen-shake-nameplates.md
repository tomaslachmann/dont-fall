# 13 — The pause menu, screen shake and nameplates

**What to build:** Esc in a Round opens the mock SettingsModal (PAUSED). It holds three real
settings, which also live on Settings → GAMEPLAY: screen shake on impact (OFF / LOW / FULL),
nameplates over other beans (OFF / ON), and voice chat (17). ALL SETTINGS opens Settings; QUIT MATCH
leaves. The game never pauses; the sheet is over live play. ADR 0110.

**Blocked by:** — (the voice chat row waits for 17)

**Status:** done on tests (2026-09-19) — the voice chat row waits for 17

- [x] The pause sheet, ported 1:1; Esc toggles it and it releases pointer lock
- [x] Screen shake: a camera shake on impact, knockdown and hard landing, scaled by the setting
- [x] Nameplates: other Characters' names drawn over them in a Round
- [x] Both settings stored per device like audio and video; Settings keeps them where the design
      puts them — SCREEN SHAKE on AUDIO (now real), SHOW OTHER BEANS' NAMES on GAMEPLAY (replacing
      its placeholder)
- [x] Settings → ACCOUNT is ticket 05's (the avatar, name, Discord, LOG OUT)
- [x] Tests: the settings, the shake scale, the pause toggle

## As built

- `lib/gameplaySettings.ts` (`dontfall.gameplay.v1`, per device, a window event for live changes);
  `useGameplaySettings` for the Screens; the Stage subscribes.
- Screen shake: `render/cameraShake.ts` — the own Character's cues through the same `FightCues` /
  `MovementCues` the sounds use (knockdown heavy 0.9 / medium 0.65, Hit taken 0.45, bump 0.25, a
  landing above 10 u/s up to 0.5) as trauma that drains at 1.5/s; the jolt is trauma² × the setting
  (OFF 0, LOW 0.4, FULL 1), at most 0.3 m and 0.04 rad, applied after the spring arm places the
  camera. Every number is a first guess for the user to feel.
- Nameplates: `render/nameplates.ts`, plain DOM beside the canvas (ADR 0060), each remote head
  projected through the camera every frame; hidden past 40 m, behind the camera, and for the
  eliminated. The design has no nameplate: it is the charge card's dark plate pill.
- Pause: the frame loop raises `onPause` on a locked → unlocked edge outside LOBBY (never before the
  first lock); `GameHandle.resume` relocks from the closing click. ALL SETTINGS opens `Settings`
  over the Match with an `onClose`, since leaving the route would leave the Match. QUIT MATCH is
  the verdict's LEAVE.
