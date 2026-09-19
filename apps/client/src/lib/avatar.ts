import { apiBaseUrl } from "./api/base.js";

/**
 * What an avatar is drawn from (ADR 0110): the Account's picture, if it has
 * one, and the Colour its bean wears, for the disc under it — the disc is
 * what shows when there is no Account, no picture, or it fails to load.
 */
export interface AvatarLook {
  src: string | null;
  color: number | null;
}

/**
 * An Account's picture address (ADR 0110): its upload, else its Discord
 * picture, else a 404 the disc answers. `version` is the upload time — your
 * own, after a new upload, so it shows at once; anyone else's may lag a minute.
 */
export const avatarSrc = (accountId: string | null | undefined, version?: number | null): string | null =>
  accountId ? `${apiBaseUrl()}/avatars/${encodeURIComponent(accountId)}${version ? `?v=${version}` : ""}` : null;

/** The look of an Account (or of an anonymous seat, with `null`) in its bean's Colour. */
export const avatarLook = (accountId: string | null | undefined, color: number | null | undefined, version?: number | null): AvatarLook => ({
  src: avatarSrc(accountId, version),
  color: color ?? null,
});

/** The disc alone: nobody to picture, the default bean's Colour. */
export const NO_AVATAR: AvatarLook = { src: null, color: null };
