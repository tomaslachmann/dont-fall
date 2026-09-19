import { resolveEndpoints } from "../socket/connection.js";

/**
 * The client's single base for the merged API (ADR 0058) — one origin for
 * tracks, assets, auth, and lobbies, so no Screen or lib module threads a
 * `baseUrl`/`apiUrl` string through its own calls any more. Everything here
 * derives the origin from the host serving the page; every endpoint module
 * (`auth.ts`, `lobbyBroker.ts`, …) builds on `apiFetch`/`apiGet`/`apiPost`.
 */

const TOKEN_STORAGE_KEY = "df_auth_token";

export const getStoredToken = (): string | null =>
  localStorage.getItem(TOKEN_STORAGE_KEY) ?? sessionStorage.getItem(TOKEN_STORAGE_KEY);

/**
 * Keeps the session token (ADR 0110): past this tab when `remember` (KEEP ME
 * LOGGED IN, and every Discord sign-in), or only for this tab otherwise —
 * closing it signs the Player out.
 */
export const setStoredToken = (token: string, remember = true): void => {
  clearStoredToken();
  (remember ? localStorage : sessionStorage).setItem(TOKEN_STORAGE_KEY, token);
};

export const clearStoredToken = (): void => {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
};

/** This API's HTTP origin — `resolveEndpoints` without the Match-server socket half, which stays in `connection.ts`. */
export const apiBaseUrl = (host: string = location.hostname): string =>
  resolveEndpoints(host).apiUrl;

/** A non-2xx answer, or the API being unreachable at all. Carries the server's own `{error}` text when there is one. */
export class ApiError extends Error {
  /** The HTTP status behind this failure, when the API answered at all. Absent for a network failure. */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    if (status !== undefined) this.status = status;
  }
}

const bearerHeader = (): Record<string, string> => {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * One `fetch` against the API: prefixes `path` with the base URL and attaches
 * the stored Bearer [REDACTED] when there is one. Returns the raw `Response` — status
 * handling stays with the caller (`apiJson` for the common case). Only a
 * network failure throws here, so a Screen never sees a bare `TypeError`.
 */
export const apiFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: { ...bearerHeader(), ...init.headers },
    });
  } catch {
    throw new ApiError("Could not reach the API. Is it running?");
  }
  return res;
};

/**
 * The common case: JSON in (when `body` is given), JSON out. A non-2xx
 * throws `ApiError` with the server's own `{error}` text — the same shape
 * every endpoint already answers with — and an unreadable body becomes an
 * `ApiError` rather than a `SyntaxError` from `res.json()`.
 */
export const apiJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const res = await apiFetch(path, init);
  let body: { error?: unknown } & Record<string, unknown>;
  try {
    body = (await res.json()) as { error?: unknown } & Record<string, unknown>;
  } catch {
    throw new ApiError(`The API answered with something unreadable (HTTP ${res.status}).`, res.status);
  }
  if (!res.ok) {
    throw new ApiError(
      typeof body.error === "string" ? body.error : `The API refused that (HTTP ${res.status}).`,
      res.status,
    );
  }
  return body as T;
};

/** `GET path` → parsed JSON. The stored token rides along when there is one. */
export const apiGet = <T>(path: string): Promise<T> => apiJson<T>(path);

/** `POST path` with a JSON body (or none) → parsed JSON. */
export const apiPost = <T>(path: string, body?: unknown): Promise<T> =>
  apiJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
