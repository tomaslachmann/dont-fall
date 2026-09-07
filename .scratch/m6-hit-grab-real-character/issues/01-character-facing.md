# 01 — Character facing is real, replicated protocol state

**What to build:** Every Character's current look-direction becomes real, authoritative state
every other client can see, not a purely local rendering guess. A Player turning their view
turns their Character's known facing as seen from the server and from every other connected
client's Snapshot — even though nothing visibly renders it differently yet (that's ticket 02).

This is the foundation ticket for the milestone (ADR 0045): both Hit (03) and Grab (04) need
to know which way a Character is aiming to find "the Character just ahead of you," and the
real remote Character (02) needs it to orient the model correctly.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A Character's current look-yaw is sent to the server every Tick alongside its existing
      input, and the server treats it the same as any other input field — authoritative once
      received, no validation beyond what the rest of input already gets
- [ ] Every connected client can read any Character's current facing off the Snapshot,
      including its own
- [ ] The local Character's existing cosmetic facing/lean smoothing is unchanged — this is
      additive wire data for observers, not a replacement for local render easing
- [ ] Covered by a shared-package test: facing round-trips through a Tick unchanged, and
      survives a reconciliation replay without drifting or resetting
