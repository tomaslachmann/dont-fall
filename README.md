# dont-fall

A chaotic multiplayer obstacle-racing game for the browser. `CLAUDE.md` is the
map of the project, and `docs/adr/` holds the decisions behind it.

## Play online (ADR 0108)

Online is the same Docker stack as local, behind one address: the game at
`/`, the Track builder at `/builder/`, the API at `/api/`.

**Once:** on GitHub, open the repo and go to Code → Codespaces → Create codespace
on main. The first start installs everything and builds the images, which
takes a few minutes.

**Every session:**

1. Start the Codespace (github.com/codespaces). It starts the game by itself.
2. In its terminal, run:

   ```bash
   pnpm run online
   ```

   It prints the one link to send (`https://<codespace>-8088.app.github.dev/`).
   Always with `run`: a bare `pnpm online` can be taken for `pnpm exec`. If it
   says it could not make port 8088 public, open the PORTS tab, right-click
   8088 and choose Port Visibility → Public.
3. Players sign in with email and password.

A personal account gets about 60 free Codespace hours a month on 2 cores.
The Codespace sleeps after 30 minutes idle, and its database survives until
the Codespace is deleted.

## The same thing locally

```bash
pnpm run online
```

That runs the game on http://localhost:8088, in Docker, exactly as it runs
online. `pnpm dev` stays the development loop.
