# 07 — The Lobby: gather, pick a Track, start

**What to build:** Two Players meet before a Round instead of appearing in one. Each sets a
nickname, marks themselves ready, and sees the others' state live. The host — the first to
join — picks a Track from what track-service actually has, sees its Time Limit, and starts once
everyone is ready. Starting hands over to the server's Countdown.

**Blocked by:** 06 (the shell and routing this Screen lives in), 04 (the server-side start it
triggers).

**Status:** done

- [x] Lobby interactions — join, nickname, ready toggle, Track selection, start — travel the existing
      client↔server WebSocket. No lobby service and no second transport (ADR 0040)
- [x] The Track list comes from track-service's existing listing; picking one shows its Time Limit,
      which the Lobby only ever reads (ADR 0038)
- [x] The host is the first joiner, and start is gated on everyone being ready — enforced by the
      server, not by whichever client happens to click
- [x] Every Player sees the others' nicknames and ready state update live
- [x] Starting moves everyone into the Countdown together, on the selected Track
- [x] Manually verified live with two browsers: both join, set nicknames, toggle ready, the host
      picks a Track and starts, and both land in the same Countdown on that Track
