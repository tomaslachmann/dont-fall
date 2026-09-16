# PROTOTYPE — the new fan, its air flow and the float animation (throwaway)

Questions (user, 2026-09-16):

1. **Air.** Today's box + rings "look terrible and don't fit the game". What should the air over a
   fan look like? Round one tried realistic (haze, wisps, dust); round two leads with cartoon
   variants in the game's own language — swooshes spiralling up, and puffs built like the
   Environment's clouds.
2. **Float.** Held up by an updraft, BLIP freezes on one frame of the jump. Which loop reads best?
   `HOLD` rests on the apex under a partial `Struggle_Air`; `LOOP` lets vertical speed walk the
   playhead back and forth across `Jump_Rise` → `Jump_Apex` → `Jump_Fall`, so the updraft's own bob
   drives the loop. Both carry the same optional procedural layer (arms, legs, sway, crest).
3. **Rotor.** `fan_lower_poly.glb` with the rotor cut out at radius **0.64** (the user's pick), spun
   on its own.

Run: with `apps/client`'s dev server up (`pnpm --filter @dont-fall/client dev`), open
`http://localhost:5173/prototypes/fan-airflow/`.

| Key | |
|---|---|
| ← → | cycle the air flow (`?air=`) |
| A | cycle TODAY / HOLD / LOOP (`?anim=`) |
| H | STAY — keep BLIP in the column instead of drifting out after 6 s (`?stay=1`) |
| S | slow motion 1× / 0.5× / 0.25× |
| E | cycle the Environment (`?env=`) |

Every layer has a slider (signed where a limb could turn the wrong way — drag past zero to flip it).
"copy settings" puts the winning numbers on the clipboard; paste them back into the chat.

Nothing here is game code. The winner gets rewritten properly into the game (tickets in
`.scratch/fan/issues/`); this folder goes to a throwaway branch.
