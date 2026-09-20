/**
 * Thin client over the track API (ADR 0114, D9) — the MCP server's only
 * window into stored Tracks and drafts. Registry data (modules,
 * attachments) comes from `@dont-fall/shared` directly, never over HTTP:
 * it is code, version-locked with this package, and the API never serves
 * it. Every failure arrives as {@link ApiError} with the API's own message,
 * so a tool error names what the API refused.
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface TrackApi {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body: unknown) => Promise<T>;
  put: <T>(path: string, body: unknown) => Promise<T>;
  patch: <T>(path: string, body: unknown) => Promise<T>;
  del: <T>(path: string) => Promise<T>;
}

export const createTrackApi = (baseUrl: string): TrackApi => {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
    } catch (err) {
      throw new ApiError(0, `track API at ${baseUrl} unreachable: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const message = await res
        .json()
        .then((json) => (json as { error?: unknown }).error)
        .catch(() => undefined);
      throw new ApiError(res.status, typeof message === "string" ? message : `HTTP ${res.status} on ${method} ${path}`);
    }
    return (await res.json()) as T;
  };
  return {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body),
    put: (path, body) => call("PUT", path, body),
    patch: (path, body) => call("PATCH", path, body),
    del: (path) => call("DELETE", path),
  };
};
