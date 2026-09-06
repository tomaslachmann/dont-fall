# 02 — The Finish Zone grants Qualification

**What to build:** A Track can have a Finish Zone, and running into it qualifies you. Enter it and
your Character's input locks where it stands, still visible in the zone, while the server records
when you got there and tells every client who has qualified.

Deliberately an area rather than a line (CONTEXT.md), so the end of a Race stays chaotic and
contested — two Characters can arrive together and shove each other through it.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A `Module` gains an optional Finish Zone: a detection-only trigger region, shaped like a
      Checkpoint's trigger, with no Respawn point. It never pushes and never respawns; a Checkpoint
      never doubles as one (ADR 0039)
- [x] Detection reuses the containment pipeline Checkpoints already prove rotation-safe, so a Finish
      Zone on a rotated or tilted Segment is correct without a second implementation
- [x] The server detects capsule-centre entry, records the Tick at which it happened per Character,
      and locks that Character's input while leaving it standing in the zone as a spectator
- [x] The Snapshot carries who has qualified and when; Qualification stays a pure function of
      position, derived identically on both sides
- [x] The Track builder can place a Finish Zone on a Draft, and the seed content gets one authored so
      existing Tracks become raceable
- [x] Every pre-M4 Module resolves unchanged; a Track with no Finish Zone simply is not raceable yet
- [x] Shortcuts that launch a Character straight into the zone stay legal — the M4 rule is "entry
      counts" (ADR 0039)
- [x] The HUD shows the qualifying Player their own placement banner on entry
- [x] Manually verified live: run into the zone, watch input lock and the banner appear, with a
      second browser seeing the same Character stopped in the zone
