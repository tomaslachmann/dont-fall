// Scratch launcher for M5 ticket 08's live verification — not committed.
// Boots the real match server with short Countdown/Round-End/Time-Limit
// windows so a live two-browser session doesn't have to wait out real
// production-length timers.
import { startServer } from "./matchServer.js";

const server = await startServer({
  playersToStart: 2,
  countdownMs: 1500,
  roundEndMs: 1500,
  timeLimitMsOverride: Number(process.env.M5_TIME_LIMIT_MS ?? 20000),
  ...(process.env.M5_SURVIVOR_TARGET ? { survivorTargetOverride: Number(process.env.M5_SURVIVOR_TARGET) } : {}),
});
console.log(`DON'T FALL verify-server listening on ws://localhost:${server.port}`);
