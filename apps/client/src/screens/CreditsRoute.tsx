import { useMemo } from "react";
import { useNavigate } from "react-router";
import creditsMarkdown from "../../public/sounds/CREDITS.md?raw";
import { creditsView, parseSoundCredits } from "../audio/credits.js";
import Credits from "./Credits.js";

/**
 * `/credits` — the Credits Screen (M14 ticket 14), from the library's own
 * `CREDITS.md`, read in at build time. BACK returns wherever the Player came
 * from: the main menu or Settings.
 */
export function CreditsRoute() {
  const navigate = useNavigate();
  const view = useMemo(() => creditsView(parseSoundCredits(creditsMarkdown)), []);
  return <Credits view={view} onBack={() => navigate(-1)} />;
}
