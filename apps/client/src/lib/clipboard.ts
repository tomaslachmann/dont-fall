import { flash } from "./flash.js";

/**
 * The shell's one clipboard write — the Lobby's invite code, the Profile's
 * card copy and the Party's code and SHARE LINK share it, so a denied write
 * flashes honestly instead of claiming success. The outcome always lands on
 * the global flash stack — a success only when there are words for it: the
 * invite card says COPIED in place instead (`copied` of `null`), and reads
 * the answer to know when to.
 */
export const copyText = (text: string, copied: string | null, failed: string): Promise<boolean> => {
  if (navigator.clipboard === undefined) {
    flash("Clipboard isn't available here.", "error");
    return Promise.resolve(false);
  }
  return navigator.clipboard.writeText(text).then(
    () => {
      if (copied !== null) flash(copied);
      return true;
    },
    () => {
      flash(failed, "error");
      return false;
    },
  );
};
