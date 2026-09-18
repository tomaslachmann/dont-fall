# 0108 — Online is the Docker stack, on one address

## Context

ADR 0107 put the game on GitHub Pages and the server in a Codespace. In use it
turned out as fiddly as it was to explain. A page on `github.io` has to be told
where its server is (`?server=…`). The first real session broke on exactly
that: signed out, the auth gate's redirect dropped the query before anything
had read it, and every request went to `http://github.io:8081`. The user, on
2026-09-18: "proč jsi to neudělal prostě v Dockeru, kde by to bylo všechno
mnohem jednodušší — už to tak běží lokálně" (why not simply in Docker, where
all of it would be much simpler; it already runs that way locally).

They were right. Pages was only there because it is free. A Codespace runs
Docker too, and with the game and the API on one address there is nothing to
be told.

## Decision

**Online play is the same Docker stack as local play, behind one address.**

- **A `web` service in `docker-compose.yml`** (`apps/web/`). It is nginx
  serving the game at `/` and the Track builder at `/builder/`, and passing
  `/api/` to the API: HTTP, and every Lobby's WebSocket at
  `/api/match/<port>`, which the API carries on to the Lobby (ADR 0107).
  - Both apps are built inside the image with `VITE_SERVER_URL=/api`. That
    path is read against the page's own origin, so the same image works at
    `http://localhost:8088` and at a Codespace's `https://…-8088.app.github.dev`
    with nothing baked in.
- **`pnpm run online` starts it.** It runs `docker compose up -d --build api
  web`, waits for `/api/health`, publishes any authored Track the database
  lacks, makes port 8088 public in a Codespace, and prints the one link.
  Locally the same command gives `http://localhost:8088`.
- **The Codespace installs Docker** (the `docker-in-docker` feature) and runs
  `pnpm run online` on every start.
- **Host ports can move** (`DONTFALL_API_PORT`, `DONTFALL_WEB_PORT`,
  `DONTFALL_LOBBY_PORTS`), so a second stack can run beside the first. That is
  how this one was verified, on 18081 and 18088, without touching the running
  one.
- **A `.dockerignore`** keeps `node_modules`, the pnpm store, `.git` and the
  SQLite files out of every build context. Each image installs its own.

Kept from ADR 0107:

- The API's `/match/<port>` proxy: the web image depends on it.
- `?server=` and `VITE_SERVER_URL` for a page served somewhere else.
- The `BASE_URL`-aware public file URLs.
- The Pages workflow. It still builds and deploys, and is simply not how
  anyone plays any more.

The server base can now carry a path (`https://host/api`), not only an
origin.

## Considered options

- **Keep Pages and fix the redirect.** That was done (`serverOrigin()` runs at
  app start), and it would work. But it keeps two addresses, a query
  parameter on every link, and a second way of running the game that nobody
  runs locally.
- **Serve the game from the API process itself.** It is one container fewer,
  but the game's routes (`/auth`, `/rewards`, `/match/:id`) collide with the
  API's, so the API would have needed a prefix of its own anyway. nginx in
  front gives the prefix without touching the API.

## Consequences

- The first `pnpm run online` in a fresh Codespace builds both images, which
  takes a few minutes. Later starts reuse the build cache.
- The Codespace's usage limits (ADR 0107) apply unchanged.
- `pnpm dev` stays the development loop. The `web` image is a built copy, so
  editing code means `pnpm run online` again (Docker rebuilds what changed).
