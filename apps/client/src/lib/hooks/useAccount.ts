import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAccount, type Account } from "../api/auth.js";
import { clearStoredToken, getStoredToken } from "../api/base.js";

export type AuthStatus = "checking" | "authed" | "unauthed";

export interface UseAccountResult {
  status: AuthStatus;
  account: Account | null;
  /** Re-runs the check — call after a successful login/signup elsewhere on the page, or to retry a failed check. */
  recheck: () => void;
}

/**
 * The mandatory-login gate's own state (`AuthGate`, ADR 0052/0053): the
 * stored Bearer [REDACTED] resolved against the API, cached under `["account"]` so
 * every consumer (`AuthGate`, the menu identity, the settings icon) shares
 * one answer instead of each fetching `/auth/me`. `AuthGate` mounts once
 * for the whole authed route tree (a React Router layout route), not per
 * navigation, so this isn't re-checked on every `/`→`/play` navigation —
 * and after a login the auth Screen invalidates the key outright rather
 * than hoping a remount refetches.
 */
export const useAccount = (): UseAccountResult => {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["account"],
    queryFn: fetchAccount,
  });

  // A settled `null` with a token still stored means the 401 case — the
  // token is expired or was revoked (logout, elsewhere) — so drop it, same
  // as the hand-rolled effect did before. Skipped while pending (a login
  // that hasn't answered yet is not a dead token) and on error (the API
  // unreachable is not "logged out": a transient blip shouldn't force a
  // real re-login once the service comes back — fail closed below, token
  // intact).
  useEffect(() => {
    if (!isPending && data === null && getStoredToken()) clearStoredToken();
  }, [isPending, data]);

  const recheck = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ["account"] }),
    [queryClient],
  );
  const status: AuthStatus = isPending ? "checking" : data ? "authed" : "unauthed";
  return { status, account: data ?? null, recheck };
};
