# 07 — Look and sound

**What to build:** The hold reads at a glance and is heard: the Held body kicks while Struggling and
hangs while Limp, the Spin blurs round, and the Hurl, the dizzy fall and the escape each have a
sound. Presentation only (ADR 0087): derived on the client from state it already has.

**Blocked by:** 03, 04

**Status:** done on tests (2026-09-18) — every live check is the user's

- [x] Held Struggle: `Struggle_Air` (lifted). Limp: a hanging pose, which can be a still frame of
      the knockdown pose or a procedural droop, and no new clip needed
- [x] Grabber: `Grab_HoldIn` loop while carrying; the Spin turns the whole rig from the
      replicated/predicted `facing`; the Hurl plays `Grab_DropOut` (or `Punch`) on release
- [x] Sounds from edges (`fightCues.ts`): escape, going Limp, a Spin whoosh once a turn rising with
      wind-up, the Hurl. Dizzy is the grabber's own knockdown (cause `"Dizzy"`, medium). All four are
      stand-ins over existing files (`slots.ts`), so no credits changed; no per-wiggle tick — a
      rustle per keypress over the column's own meter read as noise on paper, and is easy to add
- [x] Tests: the cue edge detectors (escape, Limp, Hurl, dizzy) fire once per event, including
      across a replay (the refractory window `characterSounds` already uses)
