import { randomBytes } from "node:crypto";

/**
 * A crypto-random opaque bearer token — ADR 0024's `sessionToken` shape,
 * shared so the match server's own reconnect token, track-service's Account
 * session token, and its OAuth CSRF `state` value all come from one place
 * instead of three independent `randomBytes(...).toString("base64url")`
 * call sites drifting apart.
 */
export const randomBearerToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
