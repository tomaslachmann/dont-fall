# 02 — `RoundRules`: the rules a Round runs by, as data

**What to build:** The record that tells the shared step what kind of Round this is — without ever
telling it *which* kind.

Per ADR 0043, the shared step reads **fields** (does a Fall respawn or eliminate; what grants
Qualification) and never a Round-type name. Per ADR 0041, the record is resolved **once, before
COUNTDOWN**, from the Track Revision's defaults under the Round's overrides, and replicated on the
snapshot beside `phase` so the client predicts against exactly what the server simulates.

Nothing changes behaviour in this ticket: the only Round type that exists is a Race, and a Race
must resolve to precisely what M4 does today.

**Blocked by:** 01 (the lock is the first field that matters).

**Status:** done

- [x] `RoundRules` is a plain data record in `packages/shared` — no Round-type enum reaches the
      step. `packages/shared/src/match/RoundRules.ts`: `{ timeLimitMs: number }` today, growing a
      field per future ticket (03's Fall rule, 05's Survivor Target), never a Round-type name
- [x] Resolution is one pure function: Track defaults under Round overrides, absent falls through.
      `resolveRoundRules(trackDefaults, overrides)` — each field resolves independently via `??`,
      so "absent" (including an explicit `undefined`, `exactOptionalPropertyTypes`-safe) always
      falls through to the Track's own default
- [x] It rides the snapshot beside `phase`; the client predicts against the replicated copy —
      `SnapshotMessage.roundRules`, set every tick from `rt.roundRules` (`matchLoop.ts`); the
      client's `RapierSimulation.syncRoundRules` adopts it every snapshot, the same cadence
      `phase` is captured at, correcting the client's own construction-time guess (the Track's
      bare default, since the client's own Track fetch never returns `timeLimitMs`) the instant
      the server's real resolved value — which a Match-level override can disagree with — arrives
- [x] The Time Limit resolves through the same mechanism as everything else (ADR 0041) — one
      scheme, no special cases. `MatchRuntime.roundTimeLimitMs()`'s ad-hoc
      `timeLimitMsOverride ?? fetched.timeLimitMs` is gone; `matchLoop.ts` reads
      `rt.roundRules.timeLimitMs`, resolved once per fresh Lobby by `buildSimulationFor`
      (`resolveRoundRules({timeLimitMs: fetched.timeLimitMs}, {timeLimitMs: config.timeLimitMsOverride})`)
      — `timeLimitMsOverride` was already conceptually a Round-level override; it now flows
      through the formal mechanism instead of being a special case
- [x] A Race resolves to today's behaviour exactly, pinned by the existing suite with no changed
      assertions — full server/client suites pass unchanged. A new
      `RapierSimulation.test.ts` test constructs two identical sims, one with a custom
      `RoundRules` and one with none, and asserts identical positions after identical ticks
- [x] Nothing varies the tick count, the Character iteration order, or the set of simulated
      bodies — `RoundRules` is carried but not read by the step in this ticket; `SimulationConfig`
      gains the field additively (`SimulationConfig`/snapshot both additive, per ADR 0043's own
      consequences)
