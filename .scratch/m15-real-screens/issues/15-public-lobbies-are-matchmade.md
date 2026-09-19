# 15 — Public Lobbies are matchmade (design open)

**What to build:** A public Lobby starts itself. PlaySelect's QUEUE shows the real time until the
nearest one starts. The main menu's SURVIVAL tile is a Quick Match into public Lobbies that play
only Survival Rounds. REGION shows the server's configured name and the measured round trip. Amends
ADR 0040 for public Lobbies. The user's choice, ADR 0110.

**Blocked by:** 16 if a party must be seated together

**Status:** planned — **settle with the user first**, then write its ADR

Open questions:
- When does a public Lobby start: at N ready beans, after a timer from the first join, or both?
  What are N and the timer?
- Who picks the Tracks and Round types in a public Lobby, now that nobody hosts it?
- A Lobby that started: do latecomers wait for the next Match, or get a fresh Lobby?
- The region name: a server config value (e.g. `DONTFALL_REGION`)?
