# 08 — Two Round types, two browsers, one server

**What to build:** The proof. Not a test file — the thing running.

Every milestone since M1 has been signed off by playing it, and the ones that found real bugs found
them here rather than in vitest. M5's claim is that two Round types share one engine, and the only
way to believe it is to run both against the same server without restarting it.

**Blocked by:** 01–07.

**Status:** done

- [x] A Race, played by two browsers, behaving exactly as it did in M4 — Countdown, Finish Zone,
      Qualification, the clock, Elimination on expiry
- [x] A Survival Round on the arena: one Player shoves the other off, the shoved one is eliminated
      and does not respawn, the last one standing Qualifies, the Round ends on the Survivor Target
- [x] A Survival Round that ends on the clock instead, with everyone still standing Qualifying
- [x] Both Round types on the same server process, one after the other, with no restart between
- [x] A mid-Round disconnect during Survival: recorded, and the world unchanged for whoever is left

**Done.** Two real `apps/client` browsers (two separate headless Chrome instances, driven over raw CDP —
one tab each, because a hidden tab's `requestAnimationFrame` is suspended and its game loop stops) against
the real Match server and track-service. Three Rounds back to back on **one server process, never
restarted**: a Race on a 15-second Revision, then Survival on the arena, then Survival on a 10-second one —
plus a refused Race and a mid-Round disconnect. 27 assertions, all passing, driving the game the way a
Player does: clicking the real Lobby, and moving with real key events.

What it proved: both browsers see one Countdown and are released into RUNNING within 2 ms of each other;
the clock counts down and a Race that runs out of it Eliminates whoever was still running; the host's
Round-type pick reaches the other browser and its Track's authored Survivor Target is shown to both before
the start; a Race on the arena is refused with a reason both Players can read, and the server refuses the
`start` itself, not just the button; and Survival plays — B walks out to the lip, A dashes into it and
shoves it over, B is Eliminated and never Respawns (it just keeps falling), the Round ends on the Survivor
Target with 0:56 still on the clock, and the last one standing Qualifies. Then the same Lobby, unchanged,
runs a Survival Round that ends on its clock instead with everyone still standing Qualifying.

**Three real bugs it found, that vitest had not.** All three are the seam between M5's "an eliminated
Character is marked, not removed" (ticket 04) and machinery written when a departing Character simply
vanished — which is exactly the kind of thing only running it finds:

1. *Ghosts.* When the last Player dropped mid-Round, the Match snapped back to LOBBY around a world still
   holding their eliminated body. Those Characters counted as connected Players on every later client's
   HUD, and — since `allQualified` needs a `finishTick` from *every* Character — no Race on that server
   could ever again end by everyone Qualifying, only by running out its clock. Every way back to a Lobby
   now rebuilds the world, not just the host going again from Results.
2. *A Track pick froze everyone already in the Lobby.* `resetToFreshLobby` restarted the Match's Tick
   epoch, but a client seeds its prediction tick into that epoch exactly once, at join (ADR 0027), and
   never re-seeds. Every input an already-connected client sent afterward addressed a Tick the server had
   passed, so nothing it sent was applied again — the host picking a Track, or anyone going again from
   Results, left everyone standing on a Track they could see and not walk on. The rebuilt simulation now
   carries on from the Tick the server is already on (`syncTick`).
3. *A Player who left mid-Round appeared twice on the Results Screen* — once as "Did not reach a
   Checkpoint" (their Character is still there now) and again as "Left early". One row now, the DNF one,
   carrying the progress their Character actually made; and a Qualification earned before the drop is
   still ranked rather than demoted.
