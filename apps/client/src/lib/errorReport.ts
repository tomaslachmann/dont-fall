import { SUPPORT_CODE_ALPHABET, type ClientErrorKind } from "@dont-fall/shared";
import { apiPost } from "./api/base.js";

/** A fresh support code (ADR 0110) — `DF-XXXX-XX` from an alphabet with nothing ambiguous in it. */
export const newSupportCode = (random: () => number = Math.random): string => {
  const pick = (n: number): string =>
    Array.from({ length: n }, () => SUPPORT_CODE_ALPHABET[Math.floor(random() * SUPPORT_CODE_ALPHABET.length)]).join("");
  return `DF-${pick(4)}-${pick(2)}`;
};

/**
 * Files what went wrong under the code the error screen shows (ADR 0110), so
 * "we logged it with the code below" is true. Fire-and-forget: a report that
 * cannot be sent (the API is what broke) must never break the error screen.
 */
export const reportClientError = (report: { code: string; kind: ClientErrorKind; message: string }): void => {
  void apiPost("/client-errors", {
    ...report,
    page: `${location.pathname}${location.search}`,
    userAgent: navigator.userAgent,
  }).catch(() => {});
};
