# 08 — Fold the M1 Spinner into Motion

**What to build:** the `checkpoint-spinner` bar becomes a Spin through the same
moving-Segment path and Impact rule; `Spinner` and `spinnerKnockback` retire.

**Blocked by:** 02, 04.

**Status:** planned.

## What to change

- [ ] Re-express the Module's spinner as moving geometry through Motion
- [ ] Delete `Spinner.ts`, `SPINNER_KNOCKBACK_*`, the `Spinner` RagdollCause
      (or alias it) and the client's spinner rendering path
- [ ] Existing Spinner tests re-pointed at Motion; a live check on the M1 Track is the user's
