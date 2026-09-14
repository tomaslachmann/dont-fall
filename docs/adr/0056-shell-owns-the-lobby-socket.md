# 0056 — The shell owns the Match-server socket; the game attaches to it

Until now the game opened the Match-server socket inside `boot()` and the
Lobby Screen only existed as an overlay rendered by `<GameCanvas>` — a roster,
a Ready switch and a Track pick cost a WASM boot, a renderer and a simulation.
The `/play` route had additionally rotted into two truths (a dead `PlayRoute`
booting the game, the route itself rendering the broker screen).

## Decision

- **One shell-owned socket per route visit** (`apps/client/src/lib/
  lobbyConnection.ts`, beside the existing `connection.ts`/`lobbyBroker.ts` —
  deliberately *not* `net/`, which is engine-side of the ADR 0008 split):
  `createLobbyConnection` dials, awaits the welcome,
  projects snapshots through the pure `toLobbySnapshot`, and exposes the
  eight Lobby actions. `useLobbyConnection` (`lib/`) publishes it as React
  state with a stable action identity.
- **`/lobby` renders the Lobby Screen directly while in LOBBY** (new
  `screens/LobbyRoute.tsx`) — no game boots for it. The moment the server
  leaves LOBBY, the same live connection hands over to `<GameCanvas>`, which
  boots the game *on top of it* (`GameConfig.connection`). Player identity
  (`welcome`) survives the handoff because the server binds it to the
  connection — a second socket would rejoin as a stranger (new id, lost
  Ready, lost host).
- **The game never closes a borrowed socket** (shell still owns the
  lifetime); it still closes one it dialed itself (standalone / `?track=`
  playtest). The game's own inline snapshot→Lobby mapping is deleted in
  favor of the shared `toLobbySnapshot` — one projection, two consumers.
- **`/play` splits by query param** (`lib/routeParams.ts`, pure and tested):
  bare `/play` is the broker screen (`PlaySelect` → `/lobby?port=`); with
  `?track=` it boots `<GameCanvas>` straight into the game (Track Builder's
  Playtest link, `?freeroam=1` practice). The dead `PlayRoute` is gone.
- **Lobby/Standings asymmetry stays**: Standings remains a `<GameCanvas>`
  overlay (it needs the booted game underneath); only LOBBY moved out, since
  only LOBBY precedes the boot.

## Consequences

- `LobbySnapshot`'s canonical home is `lib/lobbyConnection.ts`;
  `game/index.ts` and the Screens import it from there — no re-export, no
  second truth.
- Live-warn: the world no longer preloads behind the Lobby — the first
  COUNTDOWN shows the canvas boot (HUD "connecting…" text, then the in-game
  Countdown). Pre-warming the boot during LOBBY without rendering it is a
  possible follow-up, not this change.
- Phase can never return to LOBBY within a match session (`returnToLobby`
  retired, M7) — the route does not handle a LOBBY re-entry past the first
  handoff; reaching one would remount the Lobby Screen and reboot the game
  on the next start. If a future design reintroduces it, this route owns the
  fix.
