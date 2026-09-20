/**
 * The pause sheet's Voice chat block (ADR 0111), built once and read by all
 * three Screens that open the sheet: the Lobby, a running Round, and
 * Standings.
 *
 * It joins four things none of which owns the others — the relay's room, this
 * Account's Mutes, this device's scope, and whoever the Screen can name — so
 * it lives here rather than being assembled three times slightly differently.
 */
import { useEffect, useMemo } from "react";
import { avatarLook, NO_AVATAR, type AvatarLook } from "../avatar.js";
import { useVoiceSettings } from "../hooks/useVoiceSettings.js";
import type { PauseVoice, PauseVoicePeer } from "../../screens/PauseMenu.js";
import { loadMutes, setMute, useMutes } from "./mutes.js";
import { useVoiceRoom } from "./session.js";

/** Whoever the Screen can put a name and a face to, by Account. */
export interface VoiceNames {
  /** This Player's nickname and look, or `null` for someone the Screen no longer has on its roster. */
  (accountId: string): { nickname: string; look: AvatarLook } | null;
}

/**
 * What the rows say when there is nobody on them — one line per reason, so
 * "nobody is here" and "you turned it off" never read the same.
 */
export const voiceEmptyReason = (scope: string, connected: boolean, anyoneElse: boolean): string => {
  if (scope === "OFF") return "Voice chat is off. Pick PARTY or ALL to be heard.";
  if (!connected) return "Connecting to voice…";
  if (!anyoneElse) return "Nobody else is here yet.";
  // Linked to nobody, with people around: the rule did not join them (ADR 0111).
  return scope === "PARTY"
    ? "Only your party can hear you. Pick ALL to talk to everyone here."
    : "Nobody else has picked ALL yet.";
};

/**
 * The block, or `null` where there is no voice at all — a Playtest, free
 * roam, or a browser that cannot decode. The sheet then simply has no voice
 * rows, rather than rows that do nothing.
 */
export const usePauseVoice = (names: VoiceNames, anyoneElse: boolean): PauseVoice => {
  const room = useVoiceRoom();
  const { isMuted } = useMutes();
  const [settings, writeSettings] = useVoiceSettings();

  // Read once, when a sheet that shows Mutes is first opened — not at sign-in,
  // which most visits would pay for and never use.
  useEffect(() => void loadMutes(), []);

  const peers = useMemo<PauseVoicePeer[]>(
    () =>
      room.linked.map((accountId) => {
        const named = names(accountId);
        return {
          accountId,
          nickname: named?.nickname ?? "Bean",
          look: named?.look ?? NO_AVATAR,
          speaking: room.isSpeaking(accountId),
          muted: isMuted(accountId),
        };
      }),
    // `names` is rebuilt every render by its Screen, so it is deliberately not
    // a dependency: what actually moves is the room and the Mutes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room, isMuted],
  );

  return {
    scope: settings.scope,
    onScope: (scope) => writeSettings({ ...settings, scope }),
    peers,
    onMute: (accountId, muted) => void setMute(accountId, muted),
    emptyReason: voiceEmptyReason(settings.scope, room.connected, anyoneElse),
  };
};

/** A `VoiceNames` over a Lobby roster — the shape every Screen here already holds. */
export const namesFromRoster = (
  players: readonly { accountId: string | null; nickname: string; color: number | null }[],
): VoiceNames => {
  const byAccount = new Map(players.filter((p) => p.accountId !== null).map((p) => [p.accountId!, p]));
  return (accountId) => {
    const player = byAccount.get(accountId);
    return player === undefined ? null : { nickname: player.nickname, look: avatarLook(accountId, player.color) };
  };
};
