import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BASE_BODY_SKIN_ID, hatById, levelForXp } from "@dont-fall/shared";
import { saveCosmetics } from "../lib/api/auth.js";
import { flash } from "../lib/flash.js";
import { useAccount } from "../lib/hooks/useAccount.js";
import CharacterSelect from "./CharacterSelect.js";

/**
 * `/character` — your bean (M9 ticket 15), reached from the Main Menu.
 * The equipped skin and hat (ADR 0083) load off the Account and SAVE
 * persists them; each pick is Route state so it survives the async account
 * load. The hat only rides the save when it changed, so an equipped hat
 * never blocks a skin change. A failed save flashes on the global stack
 * rather than pretending the bean changed; the shop still has no screen, so
 * it flashes that too.
 */
export function CharacterSelectRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { account } = useAccount();
  const equipped = account?.bodySkin ?? 0;
  const equippedHat = account?.hat ?? null;
  const [selected, setSelected] = useState<number | null>(null);
  // `undefined` is "not picked yet" — `null` is a pick: no hat.
  const [hatPick, setHatPick] = useState<string | null | undefined>(undefined);
  const effective = selected ?? equipped;
  const effectiveHat = hatPick === undefined ? equippedHat : hatPick;
  const skinLabel = equipped === BASE_BODY_SKIN_ID ? "BASE" : `SKIN ${equipped + 1}`;
  const hatName = hatById(equippedHat)?.name;

  return (
    <CharacterSelect
      equipped={hatName ? `${skinLabel} · ${hatName}` : skinLabel}
      selected={effective}
      onSelect={setSelected}
      hat={effectiveHat}
      onSelectHat={setHatPick}
      level={levelForXp(account?.xp ?? 0)}
      onBack={() => navigate("/")}
      onSave={() => {
        saveCosmetics(effectiveHat === equippedHat ? { bodySkin: effective } : { bodySkin: effective, hat: effectiveHat })
          .then(() => queryClient.invalidateQueries({ queryKey: ["account"] }))
          .catch((err: unknown) =>
            flash(`Couldn't save your bean: ${err instanceof Error ? err.message : String(err)}`, "error"),
          );
      }}
      onShop={() => flash("The shop isn't here yet.", "info")}
    />
  );
}
