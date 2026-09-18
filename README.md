# dont-fall

A chaotic multiplayer obstacle-racing game for the browser. `CLAUDE.md` is the
map of the project, and `docs/adr/` holds the decisions behind it.

## Play online (ADR 0107)

The game and the Track builder are on GitHub Pages. The server runs in a
GitHub Codespace, because Pages serves files and nothing else.

**Once:**

1. In the repo, open Settings → Pages → Build and deployment and set
   Source: GitHub Actions. Every push to `main` then builds and deploys the
   game (`.github/workflows/pages.yml`). The Actions tab can also run it by
   hand.
2. Code → Codespaces → Create codespace on main. The first start installs
   everything, which takes a few minutes.

**Every session:**

1. Start the Codespace (github.com/codespaces). It starts the server by
   itself.
2. In its terminal, run:

   ```bash
   pnpm online
   ```

   It prints the link to send: the game, with the server's address on it
   (`?server=https://…`). If it says it could not make port 8081 public, open
   the PORTS tab, right-click 8081 and choose Port Visibility → Public.
3. Players sign in with email and password.

A personal account gets about 60 free Codespace hours a month on 2 cores.
The Codespace sleeps after 30 minutes idle, and its database survives until
the Codespace is deleted.

Any server with a public address works the same way:

```bash
pnpm online --public https://your.server.example
```
