/** Extracts one cookie value from a `Cookie` header — pure, shared by every route that reads cookies. */
export const parseCookie = (header: string | undefined, name: string): string | undefined => {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
};

/** The Bearer [REDACTED] off an `Authorization` header, or `undefined` when there isn't one. */
export const bearerToken = (authorization: string | undefined): string | undefined => {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  return authorization.slice("Bearer ".length);
};
