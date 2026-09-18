# 0107 — Online testing: the client on GitHub Pages, the server in a Codespace

## Context

The user, on 2026-09-18, wanted to play the game online with other people. They
had found no good free hosting and asked for GitHub Pages, "co je zdarma" (which
is free), with an integration to deploy it.

GitHub Pages serves static files and nothing else. It runs no process, so it
cannot run Docker, a WebSocket or the API. The user asked whether the whole
Docker stack could run there anyway; it cannot. GitHub Actions can run Docker
only as a time-limited job nobody can connect to.

Two things in the code also assumed that everything was one machine:

- The client derived every backend from the host serving the page:
  `http://<host>:8081` for the API and `ws://<host>:<port>` for a Match
  server. On Pages that host is `github.io`.
- Every Lobby's Match server listens on a port of its own (ADR 0054). A
  hosted server exposes one address, not a range of ports.

Settled with the user in a question round the same day. The options were a
free always-on VM, the user's Mac behind a Cloudflare tunnel, and GitHub
Codespaces.

## Decision

**The client and the Track builder are built to GitHub Pages; the server
runs in a GitHub Codespace, with its port made public; players sign in with
email and password.**

- **One address for everything.** The API proxies a Lobby's WebSocket at
  `/match/<port>`. It replays the handshake to that port on localhost and
  pipes the two sockets together. It answers only for a port a live Lobby
  holds, so it is not an open proxy onto the machine. The Match servers
  themselves are unchanged.
- **The page is told where its server is.** A `?server=<https origin>` on any
  URL sets it for that browser and is kept in `localStorage`, so a deep link
  or a reload keeps it. An empty `?server=` clears it. Without one, a build's
  `VITE_SERVER_URL` is used, and without that the old local behaviour holds.
  The builder, on the same origin, reads the same setting.
- **Pages is a subpath.** A Pages build runs under `/<repo>/`, the builder
  under `/<repo>/builder/`. The router and every public file URL (models,
  skins, hats, sounds) read Vite's `BASE_URL`. The game's `index.html` is
  copied to `404.html`, so a deep link still boots the app. The game and the
  builder link to each other through `VITE_BUILDER_URL` and `VITE_CLIENT_URL`.
- **The integration.**
  - `.github/workflows/pages.yml` builds both on every push to `main` (or by
    hand) and deploys them with the official Pages actions.
  - `.devcontainer/` makes a Codespace install the workspace and start the
    server on every start.
  - `pnpm run online` starts the API, publishes any authored Track the Codespace's
    database lacks, makes port 8081 public, and prints the link to send.
- **Email and password only.** Discord OAuth needs a registered redirect URL.
  A Codespace's address holds only while that Codespace exists, and the user
  chose not to have Discord online.

## Considered options

- **Everything on Pages, in Docker.** This is impossible, for the reasons
  above.
- **The user's Mac behind a Cloudflare quick tunnel.** It is free with no
  account, and `cloudflared` was already installed. But the address changes
  on every run, so the link does too, and the Mac has to stay on. The
  `?server=` mechanism works for it unchanged if it is wanted later.
- **An always-free VM (Oracle Cloud).** It is always on and has a fixed
  address, but it needs a card to register and more setup. It stays
  available: the API image and `pnpm run online --public <url>` already fit it.

## Consequences

- A Codespace on a personal account is free for about 60 hours a month at 2
  cores. It sleeps after 30 minutes idle (the account setting allows up to 4
  hours) and has to be started again from GitHub before a session.
- Anyone with the link reaches the whole API, publishing included. It is a
  testing setup, not a release.
- The database lives in the Codespace and survives stops and restarts, but not
  deleting the Codespace.
- The builder's Playtest opens the game on Pages; its standalone
  `?track=` Match server (the fixed port 8080) does not exist online, but
  free-roam Practice, which is what Playtest opens, needs no Match server.
