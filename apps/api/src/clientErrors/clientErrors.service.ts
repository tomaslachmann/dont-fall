import { CLIENT_ERROR_KINDS, SUPPORT_CODE_PATTERN } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { ServiceError } from "../http/errors.js";
import { getClientError, insertClientError, type ClientErrorRow } from "./clientErrors.dao.js";

/** How much of each free-text field a report keeps — enough to read, never a flood. */
const MAX_MESSAGE_CHARS = 2_000;
const MAX_FIELD_CHARS = 500;

const clip = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

/**
 * Files a client error under the support code the error screen showed (ADR
 * 0110): the kind, the error's own message, the page and the browser, and the
 * Account when the caller was signed in. Refuses a malformed code or kind;
 * everything free-text is clipped, never refused, so a report always lands.
 */
export const reportClientError = (
  db: ApiDb,
  body: unknown,
  accountId: string | null,
  nowMs: number,
): { code: string } => {
  const report = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (typeof report.code !== "string" || !SUPPORT_CODE_PATTERN.test(report.code)) {
    throw new ServiceError(400, "code must be a support code (DF-XXXX-XX)");
  }
  if (!CLIENT_ERROR_KINDS.includes(report.kind as (typeof CLIENT_ERROR_KINDS)[number])) {
    throw new ServiceError(400, `kind must be one of ${CLIENT_ERROR_KINDS.join(", ")}`);
  }
  insertClientError(db, {
    code: report.code,
    kind: report.kind as string,
    message: clip(report.message, MAX_MESSAGE_CHARS),
    page: clip(report.page, MAX_FIELD_CHARS),
    userAgent: clip(report.userAgent, MAX_FIELD_CHARS),
    accountId,
    reportedAt: nowMs,
  });
  return { code: report.code };
};

/** One report by its support code — 404 when none was filed under it. */
export const lookUpClientError = (db: ApiDb, code: string): ClientErrorRow => {
  const row = getClientError(db, code);
  if (!row) throw new ServiceError(404, `no report under "${code}"`);
  return row;
};
