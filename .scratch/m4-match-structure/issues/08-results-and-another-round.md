# 08 — Results, and going again

**What to build:** When the Round ends both Players see how it went — who qualified and in what
order, who did not and how far they got, and how often each of them fell — and then go back to the
Lobby, where the host can start another Round on a different Track. This is the ticket that closes
the loop the milestone is named for.

**Blocked by:** 07 (the Lobby to return to), 05 (the Round result to show).

**Status:** done

- [x] A Results Screen ranks qualified Players by finish time, and everyone else by how far along the
      Track they got (CONTEXT.md: Results)
- [x] Falls per Player are shown — the game is called DON'T FALL and this is the only place the count
      is ever read
- [x] Both Players return to the Lobby from Results; there is no auto-rematch timer, the host decides
- [x] The host can start a second Round on a different Track, and it runs exactly like the first
- [x] Manually verified live with two browsers, as one continuous session: Lobby → Countdown → Race →
      Results (the real React screen, ranked from real server data) → the host's real "Back to Lobby"
      click returning both live to the Lobby → a fresh Round started from there. The second-round-on-
      a-different-Track and Lobby-start mechanics reuse `selectTrack`/`start` exactly as ticket 07's
      own live session already verified; this session's own automated integration test covers the
      identical "start a second Round once back in the Lobby" path end to end.
