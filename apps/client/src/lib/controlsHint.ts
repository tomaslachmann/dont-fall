import { controlLabel, type KeyBindings } from "@dont-fall/shared";

/**
 * The one-line control hint both HUDs share (M9 controls): the match HUD's
 * plain-DOM text and practice's React bar render this, each with its own
 * tail (`mouse look` vs `click to look · Esc back`). First control per
 * action, short dialect — the full record lives one tab away in Settings.
 */
export const controlsHint = (bindings: KeyBindings): string => {
  const firstOrDash = (controls: readonly string[]): string =>
    controls.length > 0 ? controlLabel(controls[0]!, "short") : "—";
  // Movement in diamond order, like the keys sit.
  const move = [bindings.forward, bindings.left, bindings.back, bindings.right].map(firstOrDash).join("");
  return (
    `${move} move · ${firstOrDash(bindings.jump)} jump · ${firstOrDash(bindings.dash)} dash · ` +
    `${firstOrDash(bindings.hit)} hit · ${firstOrDash(bindings.grab)} grab`
  );
};
