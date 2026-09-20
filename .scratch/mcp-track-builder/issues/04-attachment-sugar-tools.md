# 04 — Attachment sugar tools

**What to build:** Explicit validated per-attachment tools over index lists
(D6+D11, never a single index): `set_surface` (ice/mud/bounce/clear —
one deck one Surface, the existing conflict rule), `set_motion`,
`set_conveyor`, `set_launch`, `set_prop`, `set_paint`, `set_course`
(start/checkpoint + order). Each validates its own value with the shared
`invalid*Reason` helpers and reports per-index results; a bad value fails
the call naming the index, changing nothing. Placement stays raw — no
layout helpers (D2 boundary). ADR 0114.

**Blocked by:** 03

**Status:** planned

- [ ] Seven sugar tools over index lists, shared validators, atomic per call
- [ ] Surface conflict rule enforced (ice+ mud refused, same message as publish)
- [ ] Tests: every tool happy path + per-index error + atomicity on bad value
