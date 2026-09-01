# 07 — Disconnect handling

**What to build:** When a player's connection ends — closing the tab, a network drop —
their Character disappears cleanly from every other connected client's view, and the
server keeps running normally with however many players remain, ready for someone new to
join (ADR 0011).

**Blocked by:** 04.

**Status:** done

- [x] Closing one client's connection removes that Character from the server's
      simulation (`socket.on("close")` → `simulation.removeCharacter(id)`, since ticket
      02; frees the capsule, controller and ragdoll bodies via `dispose`)
- [x] Every other connected client stops seeing the disconnected player's Character
      within one broadcast tick — the next `simulation.snapshot()` omits it; the client
      drops the remote mesh (`applyRemoteCharacters`) and the local-world mirror
      (`syncMirrorCharacters`) the same tick
- [x] The server process keeps running and keeps serving — hardened this ticket: every
      broadcast `send` is wrapped (`trySend`) so a socket dropping mid-write can't escape
      the tick loop; the whole tick body is `try`/`catch` so a bad physics step logs and
      continues; per-socket `'error'` handler (ticket 04) and `wss 'error'` reject
      (ticket 04) already covered the connect/bind paths. Tested against an abrupt TCP
      drop (`terminate()`, no close frame), not just a clean close.
- [x] A new client can connect and play normally after another disconnected — `joinCount`
      keeps advancing so the new player still gets a distinct spawn slot; tested.

**Also:** the disconnected client itself (tab still open, network/server gone) now freezes
on the last frame with a "connection lost — reload to rejoin" HUD instead of silently
running its prediction into the void. No reconnect in M2 (ADR 0011) — a reload rejoins as
a fresh player.
