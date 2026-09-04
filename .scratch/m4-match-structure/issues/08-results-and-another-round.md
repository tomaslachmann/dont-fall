# 08 — Results, and going again

**What to build:** When the Round ends both Players see how it went — who qualified and in what
order, who did not and how far they got, and how often each of them fell — and then go back to the
Lobby, where the host can start another Round on a different Track. This is the ticket that closes
the loop the milestone is named for.

**Blocked by:** 07 (the Lobby to return to), 05 (the Round result to show).

**Status:** blocked

- [ ] A Results Screen ranks qualified Players by finish time, and everyone else by how far along the
      Track they got (CONTEXT.md: Results)
- [ ] Falls per Player are shown — the game is called DON'T FALL and this is the only place the count
      is ever read
- [ ] Both Players return to the Lobby from Results; there is no auto-rematch timer, the host decides
- [ ] The host can start a second Round on a different Track, and it runs exactly like the first
- [ ] Manually verified live with two browsers, as one continuous session: Lobby → Countdown → Race →
      one Player waits in the Finish Zone while the other finishes → Results → back to the Lobby →
      a second Round on another Track. This is the milestone's "Done when", performed
