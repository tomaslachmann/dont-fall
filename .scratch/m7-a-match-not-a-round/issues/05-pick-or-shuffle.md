# 05 — Pick or shuffle

**What to build:** Match length in the Lobby, and a server draw for whichever Rounds the host did
not pick.

**Blocked by:** ticket 04 (nothing to schedule until a Match has more than one Round).

**Status:** blocked

## Why

The Lobby today picks one Track and one Round type for one Round (`selectTrack`, `setRoundType`,
both host-gated). A Match of three needs three of each, and making the host choose all of them turns
the Lobby into a form. Making the server choose all of them takes away control M4 ticket 07 built
deliberately.

Settled in the grilling session: **the host may pick, but does not have to.** Whatever is left
unpicked the server draws.

## What to change

- [ ] The Lobby sets **Match length**, default 3, host-gated like everything else there
- [ ] Each Round slot may carry a host-picked Track and Round type, or be left empty
- [ ] At Match start the server fills the empty slots. The draw respects the compatibility rule M5
      ticket 07 already enforces — a Race needs a Finish Zone — and reuses its refusal reason rather
      than inventing a second one
- [ ] A Track is not drawn twice in one Match until the pool is exhausted
- [ ] The Lobby shows what the Match will be: picked slots by name, drawn slots as unknown. Do not
      reveal a drawn Track early — the surprise is the point

## Done when

- [ ] Server tests: a three-Round Match with nothing picked draws three compatible, distinct Tracks;
      with one picked, that one is honoured in its slot and the other two are drawn around it
- [ ] A pool smaller than the Match length repeats rather than failing, and does so predictably
      (exhaust, then start over)
- [ ] A Match length of 1 behaves exactly like today's single-Round Match — this is the escape hatch
      that keeps Track-builder Playtest working
- [ ] **Live:** the host starts a three-Round Match having picked only the first Track, and the
      Lobby shows two unknown slots that turn out to be two different Tracks

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
