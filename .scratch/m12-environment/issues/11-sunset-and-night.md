# 11 — `sunset` and `night`

**What to build:** the two remaining presets, tuned across every piece (sky,
floor, puffs, fog, light, env map, shadows).

**Blocked by:** 03–07, 10 (to preview them)

**Status:** done (2026-09-16) — tests and typecheck; the palettes have never been seen (no WebGL here). The palette and readability check is the user's.

## What to change

- [x] `sunset`: a low sun disc (the only sun visible in a Round), a named
      `lightElevationDeg` so decks stay lit, warm palette
- [x] `night`: moon disc, cool light, stars (one `THREE.Points` or in the dome
      shader), fill light high enough that the route stays readable
- [x] Neither palette matches the KayKit deck-top blue
- [ ] Palette and readability check — the user's

## Notes

- ADR 0074 (the user asked for `night` in the first set). Starting palettes:
  research §7's table.
- Render-only by rule: `night` may not hide the route.

## As built

- Both presets in `packages/shared/src/track/Environment.ts`, starting from research §7's table:
  - **`sunset`:** violet `0x6f5ba7` → peach `0xffb38a` → dusky rose `0xb77f97`, horizon softness 1.2
    (the peach climbs higher). Sun disc 3.5° wide at azimuth 240°, 8° up, ahead of a run toward −Z,
    so a Round's chase camera sees it. The light is lifted to 35° (`lightElevationDeg`) at warm
    `0xffb070` × 2.6, hemisphere `0xffc9b0` × 0.45, environment map 0.45, exposure 1.05. Floor is
    pink-white `0xffe6ea` over mauve `0xb58aa8`; puffs `0xffe0d6` / `0xc596b0`.
  - **`night`:** indigo `0x1b1f4a` → blue-violet `0x3b3f7a` → near-black `0x0f1328`. Moon disc 2° at
    azimuth 150°, 16° up; moonlight lifted to 50° at cool `0xc6d4ff` × 1.3. A dark sky's
    environment map fills almost nothing, so the hemisphere `0x9fb4ff` × 1.6 carries the fill
    (map at 1, exposure 1.1). Floor is dim blue `0x6f7fb8` / `0x3a4278`, puffs `0x8c97c8` /
    `0x4a5288`, fog 45–180 (further than by day, so a gap ahead never hides in the dark), 700 stars.
  - Neither uses the deck tops' saturated cyan-blue: sunset is warm and violet, and night is indigo,
    darker and less saturated.
- **Measured, not guessed**, the way 04 balanced `day`: three.js r171's lighting terms integrated over
  each dome, luminance of an albedo-1 surface, exposure included. Brightness (each light's share):

  | | deck top | sides | underside |
  |---|---|---|---|
  | `day` | 0.62 | 0.21–0.46 | 0.17 |
  | `sunset` | 0.50 (80 %) | 0.24–0.58 | 0.18 |
  | `night` | 0.53 (85 %) | 0.18–0.36 | 0.04 |

  Night's route stays readable (tops at 85 % of day, sides at or above day's shaded sides). Only
  undersides go properly dark.
- **Stars** (`EnvironmentSky.stars?: { count, color, size }`): `packages/render/src/environment/stars.ts`.
  One `Points` of seeded unit directions spread evenly by area above y 0.08, with a `ShaderMaterial`
  using the dome's trick (`clip.xyww`, so anything in front of the sky hides them), a soft round dot
  from `gl_PointCoord`, `transparent` so it draws after the dome, fog and depth writes off, and the
  tone-mapping and colour-space includes. It follows the camera like the dome and is kept at
  `detail: "low"` (trivial cost). The moon is the preset's `sun` disc with a cool colour; the field's
  doc says so.
- Tests: every id has its own palette, lights stay above 0.5 in Y, the sunset sun is inside the
  chase camera's 22° and ahead of −Z, only night has stars, star directions (unit, above the
  horizon, even in area, seeded), the stars' material, and `createEnvironment` drawing, following
  and freeing them.
- `sunset` and `night` puffs use `soft` like `day`; the style question (06) covers them too.
