import { useSyncExternalStore } from "react";
import { dismissFlash, getFlashesSnapshot, subscribeFlashes, type FlashTone } from "../lib/flash.js";
import { CrossIcon, TickIcon } from "./AnswerIcons";
import s from "./FlashHost.module.css";

const KICKER: Record<FlashTone, string> = {
  success: "DONE",
  info: "HEADS UP",
  error: "HOLD ON",
};

const BangIcon = () => (
  <svg viewBox="0 0 8 16" aria-hidden="true">
    <path d="M4 1v8" />
    <circle cx="4" cy="13" r="1.4" />
  </svg>
);

/**
 * The flash stack — the `FriendRequestAlert` mock's toasts, live and global.
 * Mounted once at the app shell, so a confirmation pushed from any Screen
 * (a sent invite, a copied code) is visible on every route until it fades or
 * is dismissed. The tone disc reuses the friend toasts' own answer glyphs;
 * only the info `!` is new.
 */
export default function FlashHost() {
  const flashes = useSyncExternalStore(subscribeFlashes, getFlashesSnapshot, getFlashesSnapshot);
  if (flashes.length === 0) return null;
  return (
    <div className={s.host} aria-live="polite">
      {flashes.map((entry) => (
        <div
          key={entry.id}
          role={entry.tone === "error" ? "alert" : "status"}
          className={[s.toast, entry.tone === "success" && s.toneSuccess, entry.tone === "info" && s.toneInfo, entry.tone === "error" && s.toneError]
            .filter(Boolean)
            .join(" ")}
        >
          <span className={s.disc} aria-hidden="true">
            {entry.tone === "success" ? <TickIcon /> : entry.tone === "info" ? <BangIcon /> : <CrossIcon />}
          </span>
          <span className={s.toastText}>
            <span className={s.toastKicker}>{KICKER[entry.tone]}</span>
            <span className={s.toastTitle}>{entry.title}</span>
          </span>
          <button type="button" className={s.dismiss} aria-label="Dismiss" onClick={() => dismissFlash(entry.id)}>
            <CrossIcon />
          </button>
        </div>
      ))}
    </div>
  );
}
