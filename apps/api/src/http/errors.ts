/**
 * The service layer's error contract (ADR 0058) — domain failures with the
 * HTTP status they map to, thrown by services, rendered by controllers (or
 * the global handler) as `{ error: message }`. Framework-free on purpose:
 * nothing outside `controllers/` knows about Fastify, so services stay
 * callable — and testable — without HTTP at all.
 */
export class ServiceError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "ServiceError";
    this.statusCode = statusCode;
  }
}
