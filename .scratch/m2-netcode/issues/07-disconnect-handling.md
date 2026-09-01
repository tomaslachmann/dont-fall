# 07 — Disconnect handling

**What to build:** When a player's connection ends — closing the tab, a network drop —
their Character disappears cleanly from every other connected client's view, and the
server keeps running normally with however many players remain, ready for someone new to
join (ADR 0011).

**Blocked by:** 04.

**Status:** ready-for-agent

- [ ] Closing one client's connection removes that Character from the server's
      simulation
- [ ] Every other connected client stops seeing the disconnected player's Character
      within one broadcast tick of the disconnect
- [ ] The server process itself keeps running and keeps serving remaining/future
      connections — it does not crash, hang, or shut down because a player left
- [ ] A new client can still connect and play normally after another player has
      disconnected
