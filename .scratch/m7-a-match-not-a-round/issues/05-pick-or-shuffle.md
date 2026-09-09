# 05 — Pick or shuffle

**What to build:** Match length in the Lobby, and a server draw for whichever Rounds the host did
not pick.

**Blocked by:** ticket 04 (nothing to schedule until a Match has more than one Round).

**Status:** done

## Why

The Lobby today picks one Track and one Round type for one Round (`selectTrack`, `setRoundType`,
both host-gated). A Match of three needs three of each, and making the host choose all of them turns
the Lobby into a form. Making the server choose all of them takes away control M4 ticket 07 built
deliberately.

Settled in the grilling session: **the host may pick, but does not have to.** Whatever is left
unpicked the server draws.

## What to change

- [x] The Lobby sets **Match length**, default 3, host-gated like everything else there
- [x] Each Round slot may carry a host-picked Track and Round type, or be left empty
- [x] At Match start the server fills the empty slots. The draw respects the compatibility rule M5
      ticket 07 already enforces — a Race needs a Finish Zone — and reuses its refusal reason rather
      than inventing a second one
- [x] A Track is not drawn twice in one Match until the pool is exhausted
- [x] The Lobby shows what the Match will be: picked slots by name, drawn slots as unknown. Do not
      reveal a drawn Track early — the surprise is the point

## Done when

- [x] Server tests: a three-Round Match with nothing picked draws three compatible, distinct Tracks;
      with one picked, that one is honoured in its slot and the other two are drawn around it —
      **`roundDraw.test.ts`** covers the draw algorithm directly (isolated per-test track-service,
      deterministic); `matchServer.test.ts`'s own "pick or shuffle" describe block covers the
      end-to-end wire path (`setMatchLength`/`pickRoundSlot` through a real server, a picked Round 2
      Track honoured once the Match actually reaches it)
- [x] A pool smaller than the Match length repeats rather than failing, and does so predictably
      (exhaust, then start over)
- [x] A Match length of 1 behaves exactly like today's single-Round Match — this is the escape hatch
      that keeps Track-builder Playtest working — implicit: every pre-M7 test pinned to
      `matchLengthOverride: 1` (ticket 04's own fix) continues to pass unchanged, and `roundIndex: 0`
      (Round 1's own slot) is refused outright by `pickRoundSlot`, never entering the draw machinery
- [ ] **Live:** the host starts a three-Round Match having picked only the first Track, and the
      Lobby shows two unknown slots that turn out to be two different Tracks — **deferred to
      end-of-milestone live verification, by the user's own call**

## Watch out for

**Track-builder Playtest.** `App.tsx` takes `?track=` and that contract must not move
(`docs/architecture-review.md` §5 lists it among the things not to touch). A Playtest is a
one-Round Match with a picked Track — make sure that path stays exactly as short as it is.

**Compatibility is per Round type, not per Track.** ADR 0041 puts Track defaults under Round
overrides; the draw picks a pair, not a Track and then a type. Drawing a type first and then failing
to find a Track for it is the version of this that ends in a retry loop.

**The pool is whatever track-service has published**, which today includes a dozen test Tracks with
names like `test` and a raw UUID. That is fine for M7 and worth a note — a curated pool is a
track-service concern, not this milestone's.

## Implementation notes

**Round 1 is never drawn** — confirmed with the user before building (the ticket's own "at Match
start the server fills the empty slots" and the Playtest "must not move" watch-out pull in different
directions for Round 1 specifically). Round 1 always plays whatever's already loaded (`rt.fetched`/
`rt.roundType`, set by the boot Track, `?track=` Playtest reload, or an ordinary `selectTrack`/
`setRoundType`) — zero behaviour change to the existing single-Round flow. Only Rounds 2..matchLength
are ever drawn.

**Whole-Match draw, not per-Round** — settled after re-reading the ticket's own "at Match start the
server fills the empty slots" together with a hint from the user ("the server will cache the match
structure and will return it through sockets") that the earlier per-Round-lazy design this ticket
started from wasn't quite it. `MatchRuntime.buildMatchStructure()` draws every Round 2..N's slot in
one sequential pass (not `Promise.all` — each draw must see the previous one's `usedTrackIds` update
before the next runs), kicked off once as a fire-and-forget task the instant `start` fires
(`lobby.ts`) — Round 1 alone almost always outlasts the fetch, so by the time any later Round's
RESULTS phase is reached, `matchStructurePromise` has usually long since settled. Nothing is revealed
to clients ahead of time: the *drawn* answer for an unpicked slot lives only in `rt.matchStructure`,
server-side, until that Round actually starts and its Track/type ride the ordinary snapshot fields —
"the surprise is the point" is enforced by simply never sending the array.

**`roundDraw.ts`** (`apps/server/src/match`): `drawRound(ctx, pick)` resolves one slot. The
Track-then-type ordering the "watch out" warns against is sidestepped by a simpler fact:
`roundStartBlockedReason` already says Survival needs no Finish Zone at all ("every Track has ground
to be shoved off") — so drawing *a* Track never needs to search or reject candidates, only a
*specifically forced* Race (`pick.roundType === "race"` with no Track picked) does. An incompatible
manual combination (Race picked against a Track with no Finish Zone) drops the type pick and re-draws
one, rather than blocking a Match already in progress. Not-drawn-twice-until-exhausted is
`ctx.usedTrackIds`, mutated in place, reset to empty the moment a draw finds no unused candidate.

**Wire protocol**: `setMatchLength` (host/LOBBY-only, bounded by new `MIN_MATCH_LENGTH`/
`MAX_MATCH_LENGTH`) and `pickRoundSlot` (host/LOBBY-only; `roundIndex` 0-based, `0` — Round 1's own
slot — refused outright since it has its own pick mechanism already). `SnapshotMessage.lobby` gained
`matchLength` and `roundPicks` (the host's own picks only, `{trackId, roundType}` both nullable —
never the server's drawn answer).

**Lobby UI** (`LobbyScreen.tsx`): a +/- stepper for Match length (host; plain text for a guest), and
an "Upcoming Rounds" section (only rendered when `matchLength > 1`) — one row per Round 2..N, each a
pair of native `<select>`s (Track/Round type, "Random" as the empty-string option) for the host,
plain text for a guest. Deliberately plain-CSS-module chrome using the existing `Card`/native-input
patterns already in this file, not a new visual language — no live-verifiable design brief existed
for this control, so the priority was a correct, wired-up control over a polished one.

**Cross-cutting cancellation**: `MatchRuntime.closed` (set by `startServer`'s own `close()`) is
checked between every draw in `buildMatchStructure` — found necessary when the *test suite itself*
(dozens of pre-existing tests that call `start()` without pinning `matchLengthOverride`, now each
triggering a real background draw) started timing out intermittently: a closed-but-still-drawing
runtime from an earlier test kept making real track-service requests indefinitely, degrading response
times for whichever test happened to be running when load peaked. Not just a test workaround — a
real server that shuts down mid-Match shouldn't keep hitting track-service in the background either.

`/code-review high` — findings and fixes recorded in ticket 04's own Implementation Notes (the two
tickets' diffs were reviewed together, since ticket 05's real draw mechanism had already replaced
ticket 04's placeholder seam by the time the review ran). Full monorepo typecheck and `pnpm -r test`
green; `apps/server`'s suite re-run three consecutive times with no failures after the cancellation
fix (previously intermittent under full-suite load).
