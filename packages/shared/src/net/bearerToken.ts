/**
 * A crypto-random opaque bearer token — ADR 0024's `sessionToken` shape,
 * shared so the match server's own reconnect token, the API's Account
 * session token, and its OAuth CSRF `state` value all come from one place
 * instead of three independent call sites drifting apart.
 *
 * Web Crypto (`crypto.getRandomValues`), not `node:crypto` — this file lives
 * in `packages/shared`, which runs on both the server *and* the client
 * (`CLAUDE.md`'s repo-structure invariant); `node:crypto` is Node-only and
 * Vite externalizes it for the browser, crashing on first access. Web
 * Crypto is available as a global in both a browser and modern Node
 * (stable since Node 20) with no import needed.
 */

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url (RFC 4648 §5) — the same shape `Buffer.toString("base64url")` produced before this moved off `node:crypto`. */
const toBase64Url = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64URL_ALPHABET[b0 >> 2];
    out += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    if (b1 !== undefined) out += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    if (b2 !== undefined) out += BASE64URL_ALPHABET[b2 & 0x3f];
  }
  return out;
};

export const randomBearerToken = (bytes = 32): string => {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return toBase64Url(array);
};
