import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BASE_BODY_SKIN_ID } from "@dont-fall/shared";
import { saveBodySkin } from "../lib/api/auth.js";
import { useAccount } from "../lib/hooks/useAccount.js";
import CharacterSelect from "./CharacterSelect.js";

/**
 * `/character` — your bean (M9 ticket 15), reached from the Main Menu.
 * The equipped skin loads off the Account and SAVE persists it; the pick
 * itself is Route state so it survives the async account load. A failed
 * save says so inline rather than pretending the bean changed; the shop
 * still has no screen, so it says that too.
 */
export function CharacterSelectRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { account } = useAccount();
  const equipped = account?.bodySkin ?? 0;
  const [selected, setSelected] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const effective = selected ?? equipped;

  return (
    <CharacterSelect
      equipped={equipped === BASE_BODY_SKIN_ID ? "BASE" : `SKIN ${equipped + 1}`}
      selected={effective}
      notice={notice}
      onSelect={(index) => {
        setSelected(index);
        setNotice(null);
      }}
      onBack={() => navigate("/")}
      onSave={() => {
        setNotice(null);
        saveBodySkin(effective)
          .then(() => queryClient.invalidateQueries({ queryKey: ["account"] }))
          .catch((err: unknown) =>
            setNotice({
              text: `Couldn't save your bean: ${err instanceof Error ? err.message : String(err)}`,
              tone: "error",
            }),
          );
      }}
      onShop={() => setNotice({ text: "The shop isn't here yet.", tone: "info" })}
    />
  );
}
