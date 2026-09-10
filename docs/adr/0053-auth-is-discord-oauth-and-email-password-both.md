# 0053 — Auth is Discord OAuth *and* email/password, not Discord-only

## Context

ADR 0052 recorded Q10 of its grilling session ("Auth method?") as answered "(b) OAuth only,
Discord." That was a misreading: the user's one-word reply ("oauth") to a three-option question —
(a) email+password with a reset flow, (b) OAuth only, (c) both — was taken as selecting (b) when
the intent was (c), both together, same as the recommendation the question itself carried. M9
ticket 11 phase 1 was built against the wrong reading: `apps/track-service`'s Discord OAuth flow
is real and correct, but it's the only login path that exists.

This is the same failure ADR 0051 named and fixed once already for a different decision: a
misrecorded answer doesn't just need a mental correction, it needs a written one, because every
ticket and every future session builds off the doc, not off what was actually said.

## Decision

**Both.** Discord OAuth (ADR 0052, phase 1, already built) stays exactly as implemented — one of
two ways to reach an Account, not the only one. Alongside it: a real email/password credential
store, owned by `apps/track-service` (same place Accounts already live), with its own signup,
login, and password-reset flow. Either path resolves to the same `Account` shape (`accounts.ts`)
and the same session token mechanism (`createSession`/`getAccountBySessionToken`) — a Player who
signs up with email/password and one who logs in with Discord are indistinguishable to everything
downstream of `Account`.

Also settled, in a short follow-up round rather than left open:
- **Password reset is out of scope for now.** Signup and login ship; reset needs a real
  transactional-email decision (which provider) that hasn't been made, so it's deferred rather
  than built against a guessed answer.
- **Both allowed on one Account, not mutually exclusive.** A Player may sign up with email/
  password and later link Discord, or log in with Discord first and later add a password — either
  order, same Account either way. This needs a real linking flow (not just "the second login
  method overwrites the first"), built as part of this correction.
- **Password hashing: `node:crypto`'s `scrypt`**, not a new dependency (argon2/bcrypt would both
  need one — a native binding or a pure-JS reimplementation). A random salt per password, a
  timing-safe comparison on verify.

## Consequences

- `CONTEXT.md`'s **Account** entry ("created via Discord login") is now inaccurate and needs
  updating to name both paths.
- M9 ticket 11's "Decided scope" and "What's left" sections need correcting: email/password
  signup/login (built as part of this correction) and linking (also built) move out of the
  not-yet-built list; password reset is the one genuinely deferred piece, pending an email
  provider decision.
- No code from phase 1 is wrong or needs reverting — Discord OAuth was always going to exist
  either way; it's just not exclusive. `accounts.discordId` becomes nullable and gains `email`/
  `passwordHash` columns; since no real deployment ever held the Discord-only shape (it only
  existed inside this session's own tests), this needed no data migration, just a corrected
  `CREATE TABLE`.
