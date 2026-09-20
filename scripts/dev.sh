#!/usr/bin/env bash
# Starts everything needed to play locally: the single API service (via
# Docker, ticket 13 — matching how it actually runs in practice, ADR 0058:
# tracks, assets, auth, and lobbies on one origin), the standalone Match
# server (for a quick single-Lobby test that doesn't need Create/Join/Quick
# Match — the API's own lobbies spin up their in-process Match servers on
# demand), and the client dev server. The API must be reachable before the
# Match server starts, so this waits for its health check before starting
# the rest, giving a clean local-dev failure point rather than relying on
# the Match server's own bounded startup retry (ticket 12, a safety net for
# real container-start-order races, not the primary signal here).
#
# The Track builder (apps/track-builder) is a dev tool, not part of playing
# the game, so it's off by default — pass --builder (or -b) to also start it.
#
# The DB GUI (the `db-gui` compose service, sqlite-web on the API's SQLite
# file) is the same kind of opt-in dev tool — pass --db-gui to also start
# it on http://localhost:8082. It shows the same database in either API
# mode: the one SQLite file at `apps/api/data/track-service.sqlite` (a
# compose bind mount, so also visible from inside containers).
#
# The track-builder MCP server (apps/mcp-track-builder, ADR 0114) is stdio —
# the MCP client spawns it per session, so this script can't host it. Pass
# --mcp to start what it needs instead (the API is already here; the builder
# serves the thumbnail page `screenshot_draft` renders through) and print
# the `mcpServers` snippet to add to the client config. Implies --builder.
#
# The API runs via Docker by default (ticket 13 — matching how it actually
# runs in practice). Pass --api=local to run it as a plain tsx watch
# process instead: hot-reloads on every API change with no compose rebuild,
# and — decisively while lobby sockets are concerned — its in-process Match
# servers bind ports on your machine, reachable from the browser. The price
# is parity (not the production shape). The database is the same file in
# both modes, so accounts/tracks carry over; never run both modes at once
# (SQLite has a single writer).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Match-server service token for the betting open/settle calls (ticket 14):
# the local API, the standalone Match server below, and the API's own
# in-process brokered servers all read this same env. Dev default,
# overridable — never ship a real deployment on it.
export SERVICE_TOKEN="${SERVICE_TOKEN:-local-dev-betting-token}"

WITH_BUILDER=0
WITH_DB_GUI=0
WITH_MCP=0
API_MODE="docker"
for arg in "$@"; do
  case "$arg" in
    --builder|-b) WITH_BUILDER=1 ;;
    --db-gui) WITH_DB_GUI=1 ;;
    --mcp) WITH_MCP=1; WITH_BUILDER=1 ;;
    --api=docker|--api=local) API_MODE="${arg#--api=}" ;;
    *)
      echo "Usage: pnpm dev [--api=docker|local] [--builder|-b] [--db-gui] [--mcp]" >&2
      exit 1
      ;;
  esac
done

DEV_PORTS="8081,8080,5173"
if [ "$WITH_BUILDER" = 1 ]; then DEV_PORTS="$DEV_PORTS,5174"; fi
if [ "$WITH_DB_GUI" = 1 ]; then DEV_PORTS="$DEV_PORTS,8082"; fi
CLEANED_UP=0

cleanup() {
  [ "$CLEANED_UP" = 1 ] && return
  CLEANED_UP=1
  echo "Stopping dev processes..."
  # `docker compose down` is the normal way the API stops now, but
  # 8081 stays in the force-kill list too (code review, ticket 13) — if
  # `docker compose up --build` never actually got the API listening,
  # or a stray non-Docker process is already squatting on 8081 from earlier
  # manual debugging, `docker compose down` won't touch it and this port
  # would otherwise go uncleaned, unlike every other dev port.
  if [ "$API_MODE" = "docker" ] || [ "$WITH_DB_GUI" = 1 ]; then
    if [ "$WITH_DB_GUI" = 1 ]; then
      docker compose --profile tools down
    else
      docker compose down
    fi
  fi
  # `pnpm --filter ... dev &` backgrounds a pnpm wrapper, not tsx/vite
  # themselves — pnpm doesn't forward the signal to what it spawned, so
  # killing the job's own PID leaves the real process listening. Kill by
  # port instead, same as the run skill's own guidance. This is also what
  # stops a `--api=local` API (it listens on 8081 like the container did).
  lsof -ti:"$DEV_PORTS" -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [ "$API_MODE" = "docker" ]; then
  if [ "$WITH_DB_GUI" = 1 ]; then
    docker compose --profile tools up --build &
  else
    docker compose up --build &
  fi
else
  echo "api: local mode (tsx watch, no Docker — see the header comment for the trade-offs)."
  # better-sqlite3 creates the file but not its dir (fresh clones have no
  # `data/` — its contents are gitignored), and the db-gui bind below needs
  # the same dir to exist.
  mkdir -p apps/api/data
  pnpm --filter @dont-fall/api dev &
  if [ "$WITH_DB_GUI" = 1 ]; then
    # Only the GUI: the API itself runs above, on the same bind-mounted file.
    docker compose --profile tools up db-gui &
  fi
fi

echo "Waiting for the api..."
until curl -sf http://localhost:8081/health >/dev/null 2>&1; do
  sleep 0.3
done
echo "api ready."

pnpm --filter @dont-fall/server dev &
pnpm --filter @dont-fall/client dev &
if [ "$WITH_BUILDER" = 1 ]; then
  pnpm --filter @dont-fall/track-builder dev &
fi
if [ "$WITH_DB_GUI" = 1 ]; then
  echo "Waiting for the db-gui..."
  until curl -sf http://localhost:8082/ >/dev/null 2>&1; do
    sleep 0.3
  done
  echo "db-gui ready at http://localhost:8082"
fi
if [ "$WITH_MCP" = 1 ]; then
  echo "Waiting for the builder (the MCP server screenshots through it)..."
  until curl -sf http://localhost:5174/thumbnail.html >/dev/null 2>&1; do
    sleep 0.3
  done
  echo "MCP prerequisites ready. Add this to the client config:"
  echo "{"
  echo '  "mcpServers": {'
  echo '    "dont-fall-track-builder": {'
  echo '      "command": "pnpm",'
  echo '      "args": ["--filter", "@dont-fall/mcp-track-builder", "start"],'
  echo "      \"cwd\": \"$(pwd)\","
  echo '      "env": { "TRACK_API_URL": "http://localhost:8081" }'
  echo "    }"
  echo "  }"
  echo "}"
fi

# Everything above runs in the background and this waits on it — bash defers
# a pending trap until a *foreground* command finishes, which for a long-lived
# dev server would mean Ctrl+C never actually reaches `cleanup`. Signals
# during `wait` are handled immediately instead.
wait
