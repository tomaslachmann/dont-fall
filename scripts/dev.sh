#!/usr/bin/env bash
# Starts everything needed to play locally: track-service, the Match server,
# and the client dev server. track-service must be reachable before the Match
# server will start (ADR 0028's accepted runtime dependency — it fetches a
# Track at startup and fails loudly, on purpose, if it can't) — so this waits
# for its health check before starting the other two, rather than papering
# over the dependency with retry logic in the server itself.
#
# The Track builder (apps/track-builder) is a separate dev tool, not part of
# playing the game, so it's intentionally not started here — run it with
# `pnpm --filter @dont-fall/track-builder dev` when you need it.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DEV_PORTS="8081,8080,5173"
CLEANED_UP=0

cleanup() {
  [ "$CLEANED_UP" = 1 ] && return
  CLEANED_UP=1
  echo "Stopping dev processes..."
  # `pnpm --filter ... dev &` backgrounds a pnpm wrapper, not tsx/vite
  # themselves — pnpm doesn't forward the signal to what it spawned, so
  # killing the job's own PID leaves the real process listening. Kill by
  # port instead, same as the run skill's own guidance.
  lsof -ti:"$DEV_PORTS" -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

pnpm --filter @dont-fall/track-service dev &

echo "Waiting for track-service..."
until curl -sf http://localhost:8081/health >/dev/null 2>&1; do
  sleep 0.3
done
echo "track-service ready."

pnpm --filter @dont-fall/server dev &
pnpm --filter @dont-fall/client dev &

# Everything above runs in the background and this waits on it — bash defers
# a pending trap until a *foreground* command finishes, which for a long-lived
# dev server would mean Ctrl+C never actually reaches `cleanup`. Signals
# during `wait` are handled immediately instead.
wait
