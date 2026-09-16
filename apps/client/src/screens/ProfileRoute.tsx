import { useState } from "react";
import { useNavigate } from "react-router";
import { levelForXp, xpLevelStart, xpToLeaveLevel } from "@dont-fall/shared";
import { useAccount } from "../lib/hooks/useAccount.js";
import Profile from "./Profile.js";

/**
 * `/profile` — your career card, reached from the Main Menu account block.
 * Identity (name, level, XP bar, skin render) reads off the Account through
 * the shared level curve; everything else stays honestly empty — career
 * stats aren't tracked, the inventory (badges) doesn't exist, and match
 * history is unwritten, each its own future slice, so the screen says that
 * instead of faking numbers.
 */
export function ProfileRoute() {
  const navigate = useNavigate();
  const { account } = useAccount();
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "info" } | null>(null);

  const xp = account?.xp ?? 0;
  const level = levelForXp(xp);

  return (
    <Profile
      name={account?.displayName ?? "BEAN"}
      skin={account?.bodySkin ?? null}
      level={level}
      xp={xp - xpLevelStart(level)}
      xpTarget={xpToLeaveLevel(level)}
      stats={null}
      badges={null}
      matches={null}
      notice={notice}
      onBack={() => navigate("/")}
      onShare={() => setNotice({ text: "Sharing isn't here yet.", tone: "info" })}
      onEditBean={() => navigate("/character")}
      onSeeAll={() => setNotice({ text: "Match history isn't here yet.", tone: "info" })}
    />
  );
}
