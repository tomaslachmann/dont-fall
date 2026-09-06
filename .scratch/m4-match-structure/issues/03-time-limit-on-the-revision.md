# 03 — Every Track carries its own Time Limit

**What to build:** A Track author sets how long a Race on this Track gets, it is published with the
Revision, and the Match server counts it down from its own Tick while every client watches the same
clock in the HUD. A long Track can be given more time than a short one, which is the whole reason
the value lives with the Track rather than with the server (ADR 0038).

**Blocked by:** None — can start immediately, in parallel with 02.

**Status:** done

- [x] A Revision carries its own Time Limit, keyed like every other per-Revision attribute. The
      published `Segment[]` contract is unchanged — this is a row attribute, not part of what
      `resolveTrack` parses (ADR 0038)
- [x] Pre-M4 Revisions, the M1 seed included, backfill a 180 s default and keep loading and playing
      unchanged
- [x] The Track builder edits it as a number on the Draft, and each publish writes the value with the
      new Revision
- [x] The Match server fetches it along with the Track through the existing fetch-by-id path and
      counts down from its own Tick — the client never computes time remaining, only renders it
- [x] The Snapshot carries the time remaining; the HUD shows a running Round timer driven by server
      time
- [x] Reaching zero does not yet end anything — that is ticket 05. This ticket delivers an authored,
      authoritative, visible clock
- [x] Manually verified live: publish a Track with a non-default Time Limit, join it, and watch the
      HUD count down from the authored value in two browsers at once
