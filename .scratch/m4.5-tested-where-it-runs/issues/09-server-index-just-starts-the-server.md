# 09 — `index.ts` starts the server, and nothing else

**What to build:** `apps/server/src/index.ts` is 846 lines, and `startServer` alone runs from line
200 to line 820 — **a 620-line function** holding the Track fetch, the WebSocket lifecycle, the
Lobby handlers, the input queue, the tick loop, phase advancement and the snapshot broadcast. An
entry point should start the server. This splits it by concern.

**Blocked by:** Nothing. Independent of ticket 08 (different app, no shared files).

**Status:** ready-for-agent

## The split

Folders by kind, the same principle ticket 08 applies to the client — seven modules loose in
`src/` would only be a smaller version of the problem.

```
src/
  index.ts              the entry point: read config, call startServer, the isMain guard. Nothing else
  matchServer.ts        the composition root — startServer wires the three concerns below together
                        and owns the WebSocket server's lifecycle
  match/
    matchLoop.ts        the tick loop: phase advancement, the sim step, snapshot build and broadcast
    lobby.ts            the Lobby handlers: setNickname, setReady, selectTrack, start
  net/
    inputRouter.ts      the per-client input queue: dedupe by tick, lastApplied, the lastInputTick ack
    wire.ts             send, trySend, truncateForCloseReason
  track/
    trackSource.ts      fetchTrack, FetchedTrack, and the reload path selectTrack and `?track=` share
```

`matchServer.ts` sits above the folders rather than inside `match/`: it composes all three, and a
composition root that lives inside one of the things it composes invites the other two to reach
through it. `net/` deliberately matches the client's own `net/` — both sides of the same wire.

Tests move next to what they test. `index.test.ts` is the black-box suite over real sockets and
belongs with `matchServer.ts`; `tickAddressedInput.integration.test.ts` belongs with `net/`.

- [ ] `index.ts` does nothing but start the server
- [ ] The folders above exist and each module owns one concern; nothing imports a module to reach
      through it to another
- [ ] Pure moves — `git mv`-equivalent plus imports. **No logic changes, no renamed exports, no
      signature changes.** A diff with behaviour in it is the wrong diff
- [ ] `startServer`'s public shape is untouched: the tests construct it exactly as they do now
- [ ] Full suite green with no changed assertions (M4.5's standing rule)
- [ ] Land on a clean tree, in one commit, for the same reason ticket 08 says so

## What M5 will do to this, and why that is fine

M5 reshapes the *contents* of `matchLoop.ts` (the input lock, `RoundRules` at COUNTDOWN, the
round-end conditions) and `lobby.ts` (picking a Round type). It does not reshape their *existence*
— every module above is a seam the pre-M5 audit named independently, and `trackSource`,
`inputRouter` and `wire` are untouched by M5 entirely.

That is the point: M5 then edits a two-hundred-line module instead of an eight-hundred-line file.
The earlier worry — that splitting now means guessing at boundaries M5 is about to impose — applied
to picking seams *inside* the match loop, not to giving the match loop a file of its own.

## Coverage, before moving anything

All three of the audit's server extractions are already protected, which is what makes this safe
and is the difference from `scene.ts` (excluded from M4.5 for having none):

- `trackSource` — 7 tests on the reload path, including the `serverTick`-reset regression that once
  left everyone unable to move
- `inputRouter` — `tickAddressedInput.integration.test.ts` plus the dedupe/ack tests
- `matchLoop` — `MatchPhase.test.ts` unit-tests the pure machine; `index.test.ts` covers the wiring

`lobby.ts` is the thin spot: M4.5 ticket 07 added `selectTrack`'s tests, but `setNickname`'s
trimming and `setReady`'s phase gate are still only exercised incidentally. If anything here needs
a characterisation test before it moves, it is those two.
