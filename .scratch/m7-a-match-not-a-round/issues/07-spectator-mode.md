# 07 — Spectator Mode

**What to build:** A Player out of a Round follows one still in it, instead of staring at their own
body.

**Blocked by:** ticket 04 (until Rounds run in sequence, being out of one is nearly the end of the
session and the dead time does not bite).

**Status:** implemented — live verification pending (no sockets or browser in this sandbox; see below)

## Why

Since M5 ticket 04 (ADR 0042) an eliminated Character is marked, not removed: its body stays in the
world with its collider disabled, and the camera stays on it. That was tolerable when the Round was
the session. Under ADR 0049 a Player eliminated thirty seconds into Round one of three has minutes
of watching a corpse ahead of them.

`CONTEXT.md` has defined **Spectator Mode** since before any of this, and **Bet** is defined
strictly in terms of it. This is the ticket that makes it exist.

## What to change

- [x] While eliminated and the Round is still running, the camera follows a Character still in it
- [x] A key cycles between the living Characters; the choice is the client's own — nothing about
      who you are watching goes to the server or onto the snapshot
- [x] The follow camera reuses the spring arm the local Character already uses, aimed at somebody
      else, rather than a second camera implementation
- [x] It ends with the Round, never later — the next Round starts you playing (ADR 0049)
- [x] Input stays locked, as it already is for an eliminated Character (M5 ticket 01, ADR 0044).
      Spectating must not become a way to send inputs

## Done when

- [x] The camera never has nobody to follow: the last Character standing in a Survival Round, a
      Round where everyone is eliminated in the same Tick, and a Round with one Player are all
      handled without a frozen or null camera
- [x] Leaving Spectator Mode at the Round's end hands the camera back cleanly — no leftover offset
      or target from ADR 0026's smoothing
- [ ] **Live:** two browsers, one Player shoved off in a Survival Round, watches the other play out
      the rest of the Round from a following camera, and is playing again in the next Round

## Watch out for

**The spectated Character is a remote one**, interpolated from snapshots (ADR 0025), not predicted.
A camera glued to it will show interpolation that the owning client never sees on itself. Use the
same render-time offset machinery the rest of the remote rendering uses rather than reading raw
snapshot positions.

**Your own body is still lying there** and other Players can still see it. Nothing here removes it —
ADR 0042 is deliberate about that.

**Do not build a free camera.** It was considered and rejected in the grilling session: more code
(controls, collision, bounds) and worse for Bet, where you want to watch a specific Player.

## Implementation notes

Client-only — no protocol, server, or shared change. `RenderCharacter` carries no
liveness, so who is living is read off the authoritative snapshot's own `eliminated`
flags (ADR 0042) while the followed *pose* comes from the interpolated render world
(`serverRender`, ADR 0025), never a raw snapshot position.

- New `apps/client/src/game/spectator.ts` (game side of the ADR 0008 split):
  `isSpectating` (RUNNING-only — CONTEXT.md "lasts until the Round ends"),
  `livingIds` (everyone un-eliminated but yourself, sorted), `nextSpectatorTarget`
  (first/wrap), and `SpectatorController` (sticky target, `reset` on exit).
- `KeyboardInput.consumeSpectateNext()`: edge-triggered `KeyC` presses, auto-repeat
  ignored, drained every frame even while playing so a `C` typed in a Lobby nickname
  can't bank a stale cycle.
- `game/index.ts` frame loop aims the existing `stage.updateCamera` spring arm at the
  followed Character; nobody living falls back to your own body (always a valid, live
  target). The banner names the followed Player (`SPECTATING <name> · C for next`) via
  a new optional `matchBanner` field — a playing Round still shows nothing.
- Input untouched: an eliminated Character is never stepped (ADR 0042/0044), so
  spectating can't drive. Offset hygiene is inherited: while eliminated the local
  Character is down, so `decayCapsuleOffset` zeroes the ADR 0026 offset every frame,
  and reconcile clears `eliminated` onto the rebuilt world next Round.
- `/code-review`: subagents unavailable in this session (`agent_tree_authority_not_ready`),
  so both axes done inline — one cleanup applied (a `!` replaced with a narrowed const).
  Full monorepo typecheck green; client 267, shared 607, ui 21, track-builder 88 green.
  Server/track-service suites cannot run here — the sandbox denies even loopback
  `listen` (`EPERM`), and no browser is installed — same environmental cause, zero
  server files touched by this change.
- **Live verification still open**, blocked on environment, not on code: `pnpm dev`,
  two browsers into a Survival Round (match length ≥ 2, same Track both Rounds —
  the client only reloads Tracks in LOBBY, a pre-existing ticket-04/05 gap outside
  this ticket), shove one Player off, check the follow camera + `C` cycling + the
  banner, and confirm both play the next Round.
