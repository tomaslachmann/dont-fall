import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BASE_BODY_COLOR_ID, DEFAULT_EMOTE, DEFAULT_VICTORY_POSE, hatById, levelForXp, skinById, type EmoteId } from "@dont-fall/shared";
import { saveCosmetics, type CosmeticsChoice } from "../lib/api/auth.js";
import { flash } from "../lib/flash.js";
import { useAccount } from "../lib/hooks/useAccount.js";
import CharacterSelect from "./CharacterSelect.js";

/**
 * `/character` — your bean (M9 ticket 15), reached from the Main Menu.
 * The equipped color, skin (ADR 0091), hat (ADR 0083), emote and victory
 * pose (ADR 0110) load off the Account and SAVE persists them; each pick is Route state so it survives
 * the async account load. Only the slots that actually changed ride the
 * save, so a locked-out hat the Account already wears can never refuse a
 * color change sent with it. A failed save flashes on the global stack
 * rather than pretending the bean changed; the shop still has no screen, so
 * it flashes that too.
 */
export function CharacterSelectRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { account } = useAccount();
  const equipped = account?.color ?? 0;
  const equippedSkin = account?.skin ?? null;
  const equippedHat = account?.hat ?? null;
  const [selected, setSelected] = useState<number | null>(null);
  // `undefined` is "not picked yet" — `null` is a pick: none.
  const [skinPick, setSkinPick] = useState<string | null | undefined>(undefined);
  const [hatPick, setHatPick] = useState<string | null | undefined>(undefined);
  const [emotePick, setEmotePick] = useState<EmoteId | undefined>(undefined);
  const [posePick, setPosePick] = useState<EmoteId | undefined>(undefined);
  const effective = selected ?? equipped;
  const effectiveSkin = skinPick === undefined ? equippedSkin : skinPick;
  const effectiveHat = hatPick === undefined ? equippedHat : hatPick;
  const effectiveEmote = emotePick ?? account?.emote ?? DEFAULT_EMOTE;
  const effectivePose = posePick ?? account?.victoryPose ?? DEFAULT_VICTORY_POSE;
  // What the bean is wearing, named: the skin when it has one, since that is
  // the whole body — the color underneath isn't drawn (ADR 0091).
  const bodyName = skinById(equippedSkin)?.name ?? (equipped === BASE_BODY_COLOR_ID ? "BASE" : `COLOUR ${equipped + 1}`);
  const hatName = hatById(equippedHat)?.name;

  return (
    <CharacterSelect
      equipped={hatName ? `${bodyName} · ${hatName}` : bodyName}
      color={effective}
      onSelectColor={setSelected}
      skin={effectiveSkin}
      onSelectSkin={setSkinPick}
      hat={effectiveHat}
      onSelectHat={setHatPick}
      emote={effectiveEmote}
      onSelectEmote={setEmotePick}
      victoryPose={effectivePose}
      onSelectVictoryPose={setPosePick}
      level={levelForXp(account?.xp ?? 0)}
      onBack={() => navigate("/")}
      onSave={() => {
        const choice: CosmeticsChoice = { color: effective };
        if (effectiveSkin !== equippedSkin) choice.skin = effectiveSkin;
        if (effectiveHat !== equippedHat) choice.hat = effectiveHat;
        if (effectiveEmote !== account?.emote) choice.emote = effectiveEmote;
        if (effectivePose !== account?.victoryPose) choice.victoryPose = effectivePose;
        saveCosmetics(choice)
          .then(() => queryClient.invalidateQueries({ queryKey: ["account"] }))
          .catch((err: unknown) =>
            flash(`Couldn't save your bean: ${err instanceof Error ? err.message : String(err)}`, "error"),
          );
      }}
      onShop={() => flash("The shop isn't here yet.", "info")}
    />
  );
}
