import { flash } from "./flash.js";

/**
 * The shell's one clipboard write — the Lobby's invite code and the
 * Profile's card copy share it, so a denied write flashes honestly instead
 * of claiming success. Fire-and-forget: the outcome always lands on the
 * global flash stack.
 */
export const copyText = (text: string, copied: string, failed: string): void => {
  if (navigator.clipboard === undefined) {
    flash("Clipboard isn't available here.", "error");
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => flash(copied),
    () => flash(failed, "error"),
  );
};
