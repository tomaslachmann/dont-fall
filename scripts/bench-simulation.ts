/**
 * What one simulation tick costs on the base race (M13 ticket 02) — no
 * browser, no sockets, the real shared step over the real GLBs.
 *
 * Server-shaped runs: an authoritative world with 1, 4 and 12 scripted
 * Characters, each also paying the snapshot build and one `JSON.stringify`
 * per client the Match loop pays. Two layouts: `start` (everyone on the spawn
 * grid, the crowded first seconds of a Round) and `spread` (one Character per
 * Checkpoint, the rest of the Round). Each runs twice: with the Track's
 * Motions (`moving`) and with every Segment at rest (`still`), so the Moving
 * Segments' share reads directly.
 *
 * Client-shaped run: a predicting world (one Character, the other eleven as
 * mirrors), with a 6-tick reconcile replay twice a second.
 *
 * Nothing here is part of `pnpm test`; the numbers belong in
 * `docs/research/gameplay-performance-culling-and-asset-loading.md`.
 *
 * Usage:  pnpm bench:sim                       (1/4/12 Characters, 1800 ticks)
 *         pnpm bench:sim --players 12 --ticks 3000
 *         pnpm bench:sim --json
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  BASE_RACE_TRACK,
  DurationHistogram,
  RapierSimulation,
  TICK_RATE_HZ,
  addVec3,
  emptySimulationTimings,
  initPhysics,
  isDownMotionState,
  loadAssetLibrary,
  movementDirection,
  resolveTrack,
  scaleVec3,
  trackSpawn,
  trackSpawnYaw,
  type DurationSummary,
  type Module,
  type SimInputs,
  type SimulationTimings,
  type Track,
  type Vec3,
} from "../packages/shared/src/index.js";
import { scriptedInput } from "./benchInputs.js";

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

const argValue = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
};
const TICKS = Number(argValue("ticks") ?? 1800);
const PLAYER_COUNTS = (argValue("players") ?? "1,4,12").split(",").map(Number);
const AS_JSON = process.argv.includes("--json");
/** Ticks run before measuring: the WASM and the JIT settle, Characters leave the ground contact of their spawn. */
const WARMUP_TICKS = 90;
/** One replay every this many ticks — twice a second, a lossy connection's correction rate. */
const REPLAY_EVERY_TICKS = 15;
const REPLAY_LENGTH = 6;

const tickHistogram = (): DurationHistogram => new DurationHistogram({ binMs: 0.01, rangeMs: 50, thresholdsMs: [2, 10] });

const TIMING_KEYS = Object.keys(emptySimulationTimings()) as (keyof SimulationTimings)[];

interface RunResult {
  scenario: string;
  characters: number;
  ticks: number;
  tick: DurationSummary;
  /** Mean of each Rapier/Moving Segment timing over the measured ticks. */
  timingMeans: SimulationTimings;
  /** Snapshot build plus one `JSON.stringify` per client, per tick (server runs). */
  snapshot?: DurationSummary;
  /** One 6-tick reconcile replay (the client run). */
  replay?: DurationSummary;
  falls: number;
  /** Share of measured Character-ticks spent down (`Ragdoll`/`GettingUp`) — the heavier path. */
  downShare: number;
}

const summariseTimings = (sums: SimulationTimings, count: number): SimulationTimings => {
  const means = emptySimulationTimings();
  for (const key of TIMING_KEYS) means[key] = count === 0 ? 0 : sums[key] / count;
  return means;
};

const addTimings = (sums: SimulationTimings, timings: SimulationTimings | null): void => {
  if (!timings) return;
  for (const key of TIMING_KEYS) sums[key] += timings[key];
};

const runServer = (
  library: Record<string, Module>,
  track: Track,
  label: string,
  count: number,
  layout: "start" | "spread",
): RunResult => {
  const resolved = resolveTrack(library, track);
  const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false, profileClock: () => performance.now() });
  const yaw = trackSpawnYaw(track) ?? 0;
  // `spread`: one Character per Checkpoint's Respawn (the Start first), side by side when they share one.
  const spots = [trackSpawn(track, 0, library), ...resolved.checkpoints.map((checkpoint) => checkpoint.respawn)];
  const right = movementDirection({ forward: false, back: false, left: false, right: true }, yaw);
  const ids = Array.from({ length: count }, (_, i) => `bot${i}`);
  const origins = new Map<string, Vec3>();
  ids.forEach((id, i) => {
    const point =
      layout === "start"
        ? trackSpawn(track, i, library)
        : addVec3(spots[i % spots.length]!, scaleVec3(right, (Math.floor(i / spots.length) - 0.5) * 1.5));
    sim.addCharacter(id, point);
    origins.set(id, point);
  });

  const tick = tickHistogram();
  const snapshot = tickHistogram();
  const timingSums = emptySimulationTimings();
  let downTicks = 0;
  for (let n = 0; n < WARMUP_TICKS + TICKS; n += 1) {
    const state = sim.snapshot();
    const inputs: Record<string, SimInputs> = {};
    for (const [i, id] of ids.entries()) inputs[id] = scriptedInput(i, n, state.characters[id]!.position, origins.get(id)!, yaw);

    const started = performance.now();
    sim.tick(inputs, "RUNNING");
    const tickMs = performance.now() - started;

    // What the Match loop does next every tick: one snapshot, one string per client.
    const snapshotStarted = performance.now();
    const built = sim.snapshot();
    for (let c = 0; c < count; c += 1) JSON.stringify({ type: "snapshot", state: built, serverTimeMs: snapshotStarted });
    const snapshotMs = performance.now() - snapshotStarted;

    if (n < WARMUP_TICKS) continue;
    tick.record(tickMs);
    snapshot.record(snapshotMs);
    addTimings(timingSums, sim.lastTickTimings());
    for (const c of Object.values(built.characters)) if (isDownMotionState(c.motionState)) downTicks += 1;
  }
  const final = sim.snapshot();
  const result: RunResult = {
    scenario: `server · ${layout} · ${label}`,
    characters: count,
    ticks: TICKS,
    tick: tick.summary(),
    timingMeans: summariseTimings(timingSums, TICKS),
    snapshot: snapshot.summary(),
    falls: Object.values(final.characters).reduce((sum, c) => sum + c.fallCount, 0),
    downShare: downTicks / (TICKS * count),
  };
  sim.dispose();
  return result;
};

const runClient = (library: Record<string, Module>, track: Track, others: number): RunResult => {
  const resolved = resolveTrack(library, track);
  const sim = new RapierSimulation({
    ...resolved,
    withDefaultCharacter: false,
    authoritative: false,
    profileClock: () => performance.now(),
  });
  const yaw = trackSpawnYaw(track) ?? 0;
  const origin = trackSpawn(track, 0, library);
  sim.addCharacter("me", origin);
  sim.syncMirrorCharacters(
    Object.fromEntries(Array.from({ length: others }, (_, i) => [`other${i}`, trackSpawn(track, i + 1, library)])),
  );

  const tick = tickHistogram();
  const replay = tickHistogram();
  const timingSums = emptySimulationTimings();
  const recent: SimInputs[] = [];
  let downTicks = 0;
  for (let n = 0; n < WARMUP_TICKS + TICKS; n += 1) {
    const input = scriptedInput(0, n, sim.snapshot().characters.me!.position, origin, yaw);
    recent.push(input);
    if (recent.length > REPLAY_LENGTH) recent.shift();

    const started = performance.now();
    sim.tick({ me: input }, "RUNNING");
    const tickMs = performance.now() - started;
    if (n >= WARMUP_TICKS) {
      tick.record(tickMs);
      addTimings(timingSums, sim.lastTickTimings());
      if (isDownMotionState(sim.snapshot().characters.me!.motionState)) downTicks += 1;
    }

    if (n >= WARMUP_TICKS && n % REPLAY_EVERY_TICKS === 0) {
      // What a correction costs `PredictionLoop.reconcile`: back to the acked
      // Tick, then every unacked input again, each a full tick.
      const now = sim.snapshot().tick;
      const replayStarted = performance.now();
      sim.syncTick(now - REPLAY_LENGTH);
      sim.replayLocalCharacter("me", recent, "RUNNING");
      replay.record(performance.now() - replayStarted);
    }
  }
  const final = sim.snapshot();
  const result: RunResult = {
    scenario: `client · 1 predicted + ${others} mirrors`,
    characters: 1,
    ticks: TICKS,
    tick: tick.summary(),
    timingMeans: summariseTimings(timingSums, TICKS),
    replay: replay.summary(),
    falls: final.characters.me!.fallCount,
    downShare: downTicks / TICKS,
  };
  sim.dispose();
  return result;
};

const fmt = (ms: number): string => ms.toFixed(3);

const main = async (): Promise<void> => {
  await initPhysics();
  const library = await loadAssetLibrary(
    async (url) => new Uint8Array(readFileSync(join(assetsDir, url.substring(url.lastIndexOf("/") + 1)))),
    "http://assets.local",
  );
  const moving = BASE_RACE_TRACK;
  const still: Track = BASE_RACE_TRACK.map(({ motion: _motion, ...segment }) => segment);

  const results: RunResult[] = [];
  for (const count of PLAYER_COUNTS) {
    for (const layout of ["start", "spread"] as const) {
      results.push(runServer(library, moving, "moving", count, layout));
      results.push(runServer(library, still, "still", count, layout));
    }
  }
  results.push(runClient(library, moving, Math.max(...PLAYER_COUNTS) - 1));

  const commit = (() => {
    try {
      return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch {
      return "unknown";
    }
  })();
  const machine = {
    commit,
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    os: `${platform()} ${release()}`,
    node: process.version,
    ticks: TICKS,
    tickRateHz: TICK_RATE_HZ,
  };

  if (AS_JSON) {
    console.log(JSON.stringify({ machine, results }, null, 2));
    return;
  }

  console.log(`base race · ${machine.cpu} (${machine.cores} cores) · ${machine.os} · node ${machine.node} · ${commit}`);
  console.log(`${TICKS} measured ticks per run after ${WARMUP_TICKS} warm-up; times in ms\n`);
  console.log(
    "| scenario | chars | tick p50 | p95 | p99 | max | >2 ms | >10 ms | step | collision | solver | user changes | moving seg. | char. sweeps | char. updates | snapshot p95 | replay p95 | falls | down |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const m = r.timingMeans;
    console.log(
      `| ${r.scenario} | ${r.characters} | ${fmt(r.tick.p50Ms)} | ${fmt(r.tick.p95Ms)} | ${fmt(r.tick.p99Ms)} | ${fmt(r.tick.maxMs)} | ${r.tick.over[0]} | ${r.tick.over[1]} | ` +
        `${fmt(m.stepMs)} | ${fmt(m.collisionDetectionMs)} | ${fmt(m.solverMs)} | ${fmt(m.userChangesMs)} | ${fmt(m.movingSegmentsMs)} | ${fmt(m.characterSweepsMs)} | ${fmt(m.characterUpdatesMs)} | ` +
        `${r.snapshot ? fmt(r.snapshot.p95Ms) : "—"} | ${r.replay ? fmt(r.replay.p95Ms) : "—"} | ${r.falls} | ${(r.downShare * 100).toFixed(0)} % |`,
    );
  }
  console.log("\nstep … char. updates are means per tick. step/collision/solver/user changes are Rapier's own profiler; moving seg. and the two char. columns are timed around the shared step's own loops, outside world.step().");
};

await main();
