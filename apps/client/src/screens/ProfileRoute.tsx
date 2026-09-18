import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { levelForXp, xpLevelStart, xpToLeaveLevel } from "@dont-fall/shared";
import { useAccount } from "../lib/hooks/useAccount.js";
import { copyText } from "../lib/clipboard.js";
import { fetchCareer } from "../lib/api/career.js";
import { toCareerMatchRows, toCareerStatTiles, toEarnedBadgeNames } from "../lib/careerView.js";
import Profile from "./Profile.js";

/** History rows before SEE ALL — the full page (up to the API's own ceiling) past it. */
const COLLAPSED_ROWS = 5;

/**
 * `/profile` — your career card, reached from the Main Menu account block.
 * Identity (name, level, XP bar, bean render) reads off the Account through
 * the shared level curve; everything else reads off `GET /career` — stat
 * tiles, badges, and the finished-Match history, all derived from Matches
 * that actually happened. SEE ALL unfolds the whole fetched page; SHARE CARD
 * copies a text card to the clipboard.
 */
export function ProfileRoute() {
  const navigate = useNavigate();
  const { account } = useAccount();
  const careerQuery = useQuery({ queryKey: ["career"], queryFn: fetchCareer });
  const [expanded, setExpanded] = useState(false);

  const xp = account?.xp ?? 0;
  const level = levelForXp(xp);
  const career = careerQuery.data ?? null;
  const failed = careerQuery.isError;

  const rows = career === null ? null : toCareerMatchRows(career.matches, Date.now());
  const shown = rows === null ? null : expanded ? rows : rows.slice(0, COLLAPSED_ROWS);

  const share = (): void => {
    const lines = [`${account?.displayName ?? "BEAN"} · LEVEL ${level} — DON'T FALL`];
    if (career !== null) {
      const { stats } = career;
      lines.push(`${stats.matches} Matches · ${stats.wins} Wins · ${stats.falls} Falls`);
      lines.push(`Badges ${career.badges.earned.length} of ${career.badges.total}`);
    }
    copyText(lines.join("\n"), "Card copied to clipboard.", "Couldn't copy the card.");
  };

  return (
    <Profile
      name={account?.displayName ?? "BEAN"}
      color={account?.color ?? null}
      skin={account?.skin ?? null}
      hat={account?.hat ?? null}
      level={level}
      xp={xp - xpLevelStart(level)}
      xpTarget={xpToLeaveLevel(level)}
      stats={career === null ? null : toCareerStatTiles(career.stats)}
      badges={career === null ? null : { earned: career.badges.earned.length, total: career.badges.total }}
      badgeNames={career === null ? [] : toEarnedBadgeNames(career.badges.earned)}
      matches={shown}
      failed={failed}
      onBack={() => navigate("/")}
      onShare={() => void share()}
      onEditBean={() => navigate("/character")}
      onSeeAll={() => setExpanded((was) => !was)}
      seeAllLabel={expanded ? "SHOW LESS" : "SEE ALL"}
    />
  );
}
