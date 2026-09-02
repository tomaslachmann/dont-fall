#!/usr/bin/env bash
# Starts everything needed to play locally: track-service (via Docker, ticket
# 13 — matching how it actually runs in practice, ADR 0028/0029), the Match
# server, and the client dev server. track-service must be reachable before
# the Match server will start, so this waits for its health check before
# starting the other two, giving a clean local-dev failure point rather than
# relying on the Match server's own bounded startup retry (ticket 12, a
# safety net for real container-start-order races, not the primary signal
# here).
#
# The Track builder (apps/track-builder) is a dev tool, not part of playing
# the game, so it's off by default — pass --builder (or -b) to also start it.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

WITH_BUILDER=0
for arg in "$@"; do
  case "$arg" in
    --builder|-b) WITH_BUILDER=1 ;;
    *)
      echo "Usage: pnpm dev [--builder|-b]" >&2
      exit 1
      ;;
  esac
done

DEV_PORTS="8081,8080,5173"
if [ "$WITH_BUILDER" = 1 ]; then DEV_PORTS="$DEV_PORTS,5174"; fi
CLEANED_UP=0

cleanup() {
  [ "$CLEANED_UP" = 1 ] && return
  CLEANED_UP=1
  echo "Stopping dev processes..."
  # `docker compose down` is the normal way track-service stops now, but
  # 8081 stays in the force-kill list too (code review, ticket 13) — if
  # `docker compose up --build` never actually got track-service listening,
  # or a stray non-Docker process is already squatting on 8081 from earlier
  # manual debugging, `docker compose down` won't touch it and this port
  # would otherwise go uncleaned, unlike every other dev port.
  docker compose down
  # `pnpm --filter ... dev &` backgrounds a pnpm wrapper, not tsx/vite
  # themselves — pnpm doesn't forward the signal to what it spawned, so
  # killing the job's own PID leaves the real process listening. Kill by
  # port instead, same as the run skill's own guidance.
  lsof -ti:"$DEV_PORTS" -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

docker compose up --build &

echo "Waiting for track-service..."
until curl -sf http://localhost:8081/health >/dev/null 2>&1; do
  sleep 0.3
done
echo "track-service ready."

pnpm --filter @dont-fall/server dev &
pnpm --filter @dont-fall/client dev &
if [ "$WITH_BUILDER" = 1 ]; then
  pnpm --filter @dont-fall/track-builder dev &
fi

# Everything above runs in the background and this waits on it — bash defers
# a pending trap until a *foreground* command finishes, which for a long-lived
# dev server would mean Ctrl+C never actually reaches `cleanup`. Signals
# during `wait` are handled immediately instead.
wait
