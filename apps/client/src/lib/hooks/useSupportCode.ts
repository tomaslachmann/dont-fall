import { useEffect, useMemo } from "react";
import type { ClientErrorKind } from "@dont-fall/shared";
import { newSupportCode, reportClientError } from "../errorReport.js";

/**
 * A support code for a failure a route shows on the error screen itself
 * (ADR 0110) — one per failure, filed once. `undefined` while nothing failed.
 */
export const useSupportCode = (kind: ClientErrorKind, message: string | null): string | undefined => {
  const code = useMemo(() => (message === null ? undefined : newSupportCode()), [message]);
  useEffect(() => {
    if (code !== undefined && message !== null) reportClientError({ code, kind, message });
  }, [code, kind, message]);
  return code;
};
