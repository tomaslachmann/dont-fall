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
# it on http://localhost:8082. Docker API mode only: `--api=local` keeps
# its own SQLite file outside the compose volume, so the GUI would show
# the wrong database and the flag is refused in that mode.
#
# The API runs via Docker by default (ticket 13 — matching how it actually
# runs in practice). Pass --api=local to run it as a plain tsx watch
# process instead: hot-reloads on every API change with no compose rebuild,
# and — decisively while lobby sockets are concerned — its in-process Match
# servers bind ports on your machine, reachable from the browser. The price
# is parity (not the production shape) plus a different SQLite file than
# the Docker volume, so accounts/tracks don't carry between the two modes.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Match-server service token for the betting open/settle calls (ticket 14):
# the local API, the standalone Match server below, and the API's own
# in-process brokered servers all read this same env. Dev default,
# overridable — never ship a real deployment on it.
export SERVICE_TOKEN="${SERVICE_TOKEN:-local-dev-betting-token}"

WITH_BUILDER=0
WITH_DB_GUI=0
API_MODE="docker"
for arg in "$@"; do
  case "$arg" in
    --builder|-b) WITH_BUILDER=1 ;;
    --db-gui) WITH_DB_GUI=1 ;;
    --api=docker|--api=local) API_MODE="${arg#--api=}" ;;
    *)
      echo "Usage: pnpm dev [--api=docker|local] [--builder|-b] [--db-gui]" >&2
      exit 1
      ;;
  esac
done

if [ "$WITH_DB_GUI" = 1 ] && [ "$API_MODE" = "local" ]; then
  echo "--db-gui needs the Docker API: --api=local keeps its own SQLite file outside the compose volume (see the header comment)." >&2
  exit 1
fi

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
  if [ "$API_MODE" = "docker" ]; then
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
  pnpm --filter @dont-fall/api dev &
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

# Everything above runs in the background and this waits on it — bash defers
# a pending trap until a *foreground* command finishes, which for a long-lived
# dev server would mean Ctrl+C never actually reaches `cleanup`. Signals
# during `wait` are handled immediately instead.
wait
