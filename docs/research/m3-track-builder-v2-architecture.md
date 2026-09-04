# Track builder v2: gap assessment against `docs/track-builder-proposal.md`

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs) — see `docs/research/m2-netcode-transport.md` for
> the convention. This file compares the user-supplied architecture proposal
> at `docs/track-builder-proposal.md` against the actual M3 code as shipped
> (`packages/shared/src/track/*.ts`, `apps/track-service/src/*.ts`,
> `apps/track-builder/src/*.ts`), not from memory. It is not itself a decision
> record — if a staged adoption below is agreed, it becomes ADRs and tickets
> the normal way.
>
> **One open question this note deliberately does not answer:** does the
> Track builder stay an internal, dev-only authoring tool (matching every
> decision the M3 grilling session actually made — no accounts anywhere in
> the project yet, ADR 0024 defers a real account system, "čistě interní/
> dev-only, bez auth"), or does it become a player-facing UGC feature
> (matching how the proposal frames things — Trackmania/Fall Guys Creative
> comparisons, share codes, discovery, moderation)? That's the user's call.
> Section 3 assumes "stays internal" because that's what's actually been
> decided so far; section 3.4 flags exactly what flips if the answer changes.

## Recommendation

**Adopt the proposal's data-model spine (`PieceDefinition`-style piece
metadata with real sockets/footprint/placement rules, replacing the current
"one uniform footprint, append-only" model) and its editor UX spine
(command-pattern undo/redo, multi-select, arbitrary move/rotate/delete) —
both are needed regardless of the internal-vs-UGC answer, because the current
builder is structurally incapable of building anything but a straight
corridor of interchangeable-length pieces glued end-to-end.** Do **not** yet
adopt: the web asset/GLB/CDN pipeline (§14), the publishing/revision/
content-hash/share-code lifecycle (§15), or Phase 6/8's discovery/moderation
— all three assume untrusted third-party authors and a live sharing product,
neither of which exists here (every Module today is code-authored in
`packages/shared`, not player-uploaded content; track-service has no auth by
explicit M3-grilling decision). The 4-layer validator and `MovementSolver`
(§9) are worth building but scoped down hard for now — structural + basic
placement validation is cheap and closes a real bug (garbage `moduleId`s
saved today crash the Match server at Round start, not at save time); the
full reachability-graph/dynamic-mechanism validation is real engineering
that should wait until pieces actually have enough variety (junctions,
branches, moving platforms) for a human to plausibly build an unreachable
Track by accident. Test Mode is *already* close to the proposal's spec
(ticket 05's `playtest.ts` genuinely runs the shared `RapierSimulation` +
`advanceFixed`, not a fake preview) — the gap there is UX polish
(telemetry, auto-validate-before-test), not architecture.

---

## 1. Terminology reconciliation

| Current (`CONTEXT.md` / code) | Proposal | Same concept? |
|---|---|---|
| `Module` (`Module.ts`) | `PieceDefinition` | **Same concept, proposal is a strict superset.** Current `Module` = `{id, statics, props?, spinners?, checkpoint?}`, purely geometric. Proposal's `PieceDefinition` adds `placement` (grid/socket/surface/free/rotation rules), `footprint` (occupied grid cells, not just a bounding box), `sockets`, `capabilities`, `budget`, `validation` — none of which exist today in any form. **Adopting this means widening `Module`, not renaming it** — `CONTEXT.md`'s one-line definition ("A reusable template for a piece of Track... Authored once") stays true; it's the *code* interface that grows.
| `Segment` (`Track.ts`) | `TrackPiece` | **Same concept**, proposal's version adds a UUID `id` (current `Segment` has none — segments are anonymous, only addressable by array index, which is exactly what the proposal calls out as an anti-pattern: "index pole není identita"), `pieceVersion` (no versioning exists today at all), and `connections?` (explicit socket-to-socket wiring; today's Segments only carry a raw `position`+`rotation`, no relationship to neighbors). No glossary rename needed — `CONTEXT.md`'s "one concrete instance of a Module placed at a position in a Track" still holds.
| `Track` (`Track.ts`, `type Track = Segment[]`) | `TrackSnapshot` | **Same core concept, proposal is much heavier.** Current `Track` is *just* the ordered piece list. `TrackSnapshot` bundles that with `schemaVersion`/`gameplayVersion`/`pieceCatalogVersion`, `revision`+`contentHash` (immutability/publishing), `bounds`, `mode`, `seed`, and *first-class* `start`/`finish`/`checkpoints` fields. Today, Start/Checkpoint/Finish-equivalent data is scattered: `PLAYGROUND_SPAWN`/`playgroundSpawn` live outside the Track/Module system entirely (`packages/shared/src/playground.ts`), Checkpoints are optional fields *on a Module* (not first-class Track metadata), and there is no Finish/Qualification concept anywhere yet — that's explicitly M4 scope (`CLAUDE.md`'s roadmap: "Rounds, Qualification, Time Limit... M4"), not something to pull forward into the Track data model now.
| — (does not exist) | `Socket`/`SocketDefinition` | **Purely additive.** Nothing today lets two Modules "know" how they connect beyond the single global `MODULE_STEP` constant (`Module.ts`) applied uniformly regardless of content. `CONTEXT.md` has no term for this; if adopted, propose adding **Socket** to the glossary under Track: *"A named attachment point on a Module's footprint, with its own position/rotation, that another Module's Socket can align to."*
| — (does not exist, `MODULE_STEP` is the closest analog) | `Footprint` (grid cells + clearance) | **Purely additive**, and the single biggest structural gap. `MODULE_STEP` (`Module.ts:20`) is one global `Vec3` used identically for every Module regardless of content — there is no per-Module footprint at all, so two different-length pieces are structurally impossible today (confirmed in ticket 01's own commit message: *"the uniform footprint deliberately no longer allows"* the M1 original's varying platform widths/gaps). `CONTEXT.md` doesn't need a new glossary term for this — "Footprint" as the proposal uses it is an implementation detail of how a Module's placement rules work, not a domain concept a designer talks about.
| — (does not exist) | `PieceCatalog` | **Purely additive**, but arguably already half-exists informally as `MODULE_LIBRARY` (`modules.ts`) — a plain `Record<string, Module>` with no version, no catalog-level metadata. Adopting `PieceCatalog` as a *named, versioned* concept is a small formalization of something already there in spirit.
| — (does not exist anywhere) | `MechanismDefinition`, `MovementSolver`, `ValidationIssue`, `TrackBudget`, asset pipeline (§14), publishing/revision (§15) | **Purely additive**, no current analog at all, no glossary collision.

**Net assessment:** adopting the proposal's core vocabulary (`PieceDefinition`, `Socket`, `Footprint`, `PieceCatalog`) is additive/widening, not a rename — `Module`/`Segment`/`Track`/`Checkpoint` in `CONTEXT.md` stay accurate as one-line domain descriptions; only the *code-level* interfaces need to grow. `TrackSnapshot`'s `start`/`finish`/`checkpoints`-as-first-class-fields is the one place adoption would reach into M4 territory (Qualification/Finish Zone) before M4 has been designed — flagged in §2 below, not resolved here.

---

## 2. Gap assessment, subsystem by subsystem

### 2.1 Sockets, grid, placement rules (proposal §5)

**Gap: total.** Today there is exactly one placement mechanism: `chainTrack` (`Track.ts:26`) appends the next Segment at `previous.position + MODULE_STEP`, a single hardcoded `{x:0, y:-0.5, z:-6}` applied identically to every Module regardless of what it is. There is no grid, no socket, no rotation constraint (`Segment.rotation` exists in the type but is asserted to always be `0` — "Tracks are strictly linear," `Track.ts:12`), and no per-piece placement variation of any kind. This is the proposal's single sharpest criticism applied directly to this codebase: a "start" piece and a "sandbox" (end) piece are interchangeable at the type level and can be placed anywhere in a sequence — confirmed as a real, known gap already (M3 grilling Q5, "start uprostřed Tracku je vyloženě nesmyslný obsah").

### 2.2 Four-layer validation + `MovementSolver`/feasibility graph (§9)

**Gap: total**, but layered differently by cost:
- **Structural** (§9.3): almost free to add, and closes a real bug today. `track-service`'s `isTrack` (`index.ts`) only checks JSON *shape* (`moduleId` is a string, `position` is an object) — it never checks the `moduleId` actually exists in `MODULE_LIBRARY`. A garbage or stale `moduleId` saves successfully and only fails later, loudly, when the Match server calls `resolveTrack` at Round start (`Track.ts:47`, `throw new Error('Track references unknown Module...')`) — this is exactly the M3-grilling Q2 gap ("tichá časovaná bomba").
- **Placement** (§9.4, overlap/bounds/socket compatibility): meaningless until §2.1 (sockets/footprint) exists — nothing to validate placement *rules* against yet.
- **Playability** (§9.5–9.6, feasibility graph + shared `MovementSolver`): does not exist in any form. This is real, non-trivial engineering (a second consumer of the shared movement tuning constants, deliberately *not* a second physics engine per the proposal's own §9.6/§19 anti-pattern list) — appropriately deferred until pieces have enough variety that an unreachable Track is a plausible accident rather than a near-impossibility (today, with one linear corridor and no branches, reachability is trivially guaranteed by construction).
- **Dynamic** (§9.7, trigger graphs, moving platforms, timing gates): not applicable yet — none of those mechanism kinds exist in this codebase (only `Spinner`, which is already tick-derived and stateless in exactly the way §7.1 asks for — `spinnerAngleAt(config, tick)`, `packages/shared/src/simulation/Spinner.ts`).

### 2.3 Budget model (§12)

**Gap: total**, and low-value until content variety grows. With 6 Modules total, all cheap static geometry plus one Spinner, there is no real physics/render budget pressure to protect against yet. Worth revisiting once the catalog has real variety (moving platforms, more Spinners, dynamic Props at scale).

### 2.4 Asset/GLB pipeline (§14)

**Gap: total, and not the right gap to close now.** Every Module today is hand-authored TypeScript geometry (`modules.ts`) — primitive boxes, no meshes, no `assetId`, no GLB, no CDN. The proposal's entire §14 exists to solve *player-supplied or at-scale-authored visual assets* safely and performantly; there is exactly one author today (whoever edits `packages/shared`), committing plain data structures directly into the repo. This is squarely `docs/track-builder-proposal.md`'s own §19 anti-pattern ("Nedělat streaming dřív než profiler") applied one level up: don't build a CDN/manifest/Service-Worker pipeline before there's a real multi-asset, multi-author need.

### 2.5 Publishing/revisions/content-hash/share-code (§15) + Phase 6/8

**Gap: total, and structurally premature.** `track-service`'s `saveTrack` (`store.ts`) mutates a row in place (`onConflictDoUpdate` — the *opposite* of "Nemutovat publikované levely," §19) with no revision number, no `contentHash`, no immutability, no auth distinguishing "the author" from anyone else. This is fine and consistent with the actual M3 decision (dev-only tool, no accounts anywhere in the project) — but adopting §15 wholesale would mean building a publishing/revision/authorization system with **zero real users to serve it**, matching this project's own repeatedly-stated anti-pattern of not pre-building for speculative scale (ADR 0002: on-demand servers instead of a fleet; ADR 0016 deferred the same way; ADR 0029's SQLite-not-Postgres call explicitly named this exact pattern). Phase 6 ("Dva hráči mohou přes share code hrát stejnou immutable revision") and Phase 8 (discovery/moderation) assume a live sharing product this project does not have and has not decided to build.

### 2.6 Test Mode (§10)

**Gap: small, mostly UX polish, not architecture.** The proposal's core demand — "Test mode nesmí být fake editor preview... spustit stejnou RuntimeFactory jako match... skutečný Rapier svět a gameplay tuning" — is **already true** of `apps/track-builder/src/playtest.ts`: it instantiates the real `RapierSimulation`, steps it via the real `advanceFixed` (not a bespoke loop), and reads `CAPSULE_RADIUS`/`CAPSULE_HALF_HEIGHT` etc. from the same shared tuning constants the live game uses (verified live in a Playwright session during ticket 05 — the Character correctly failed to fall through the uniform-footprint bridge). What's actually missing against the proposal's spec: no automatic pre-test validation gate (§10 says "editor automaticky spustí quick validation" before test — today `Playtest` just checks the Track isn't empty), and no telemetry capture (checkpoint reached, respawn count, failure reproducibility via `trackId+revision+seed`) — cheap to add once §2.2's structural validation exists, but genuinely optional polish, not a correctness gap.

### 2.7 Command-pattern undo/redo, multi-select, duplicate, arbitrary move/rotate/delete (§11)

**Gap: total**, and this is the second sharpest, most user-visible gap (matching the M3-grilling Q6 verdict: "builder neni ready... nejde nic otacet posouvat menit uhly"). Today: `appendModule` (`trackState.ts`) only ever appends to the end; `removeLast` only ever removes the end. There is no selection concept, no arbitrary-index insert/delete, no move, no rotate (moot today anyway since `rotation` is always 0), no multi-select, no duplicate, no copy/paste, and no undo/redo of any kind — every edit is an immediate, irreversible array mutation in `main.ts`. The proposal's `EditorCommand` pattern (§11.3) is a clean, well-known fix (execute/undo/mergeWith) that's independent of the sockets/footprint question — it can be built against *today's* append-only model as a first step, or against the richer post-§2.1 model; either way it's the same shape.

### 2.8 Performance/lifecycle/AOI (§13)

**Gap: total, correctly so.** At 6 Modules and a handful of Rapier bodies, none of §13's triggers (rigid body counts, tick time, snapshot bytes/player/sec, draw calls) are remotely close to mattering. The proposal's own §13.1 ("Pro instancovaný match... není nutné nejdřív budovat open-world streaming") argues for exactly the posture this project already has everywhere else (ADR 0011: JSON not binary until size is a measured problem; ADR 0002: no orchestration until scale demands it). Nothing to do here now.

---

## 3. Staged adoption path (assuming the tool stays internal-only)

Ordered by "closes a real gap cheaply" first, "large but genuinely needed" second, "premature for a zero-UGC, zero-auth internal tool" last.

### 3.1 Do soon — cheap, closes a real bug or a real usability wall

1. **Structural validation at save/generate time** (§2.2): reject a `Track` whose `moduleId`s don't all exist in `MODULE_LIBRARY`, in `track-service`'s `POST /tracks` and `POST /tracks/generate` handlers. Small, and turns a silent future crash (Match server, at Round start) into an immediate, actionable 400 at save time.
2. **Real `PieceDefinition`-shaped `Module`**: add `footprint` (per-Module, not one global `MODULE_STEP`) and `sockets` (even a minimal `floor-in`/`floor-out` pair per Module to start) to the `Module` interface (`Module.ts`). This is the load-bearing change — it's what makes pieces of different sizes, junctions, and eventually branches possible at all, and every other editor-UX improvement (arbitrary move, rotate, duplicate) is much more valuable once placement isn't hardcoded to "always exactly `MODULE_STEP` after the last one."
3. **Command-pattern undo/redo + arbitrary select/move/rotate/delete/duplicate** (§2.7): the `EditorCommand` shape from §11.3, built against the builder's existing `currentTrack: Segment[]` state in `main.ts`. This directly answers "builder neni ready" — it's the difference between a demo and a tool someone can actually use to author content.
4. **Test Mode polish**: auto-run structural validation before entering playtest (once #1 exists), and log the reproducibility triple (`trackId`/track name + a fixed seed, since there's no `revision` concept yet) on a Test Mode failure.

### 3.2 Worth building, but real engineering — don't rush

5. **Placement validation** (bounds/socket-compatibility/overlap policy, §9.4) — meaningful once #2 (real sockets/footprint) lands.
6. **Shared `MovementSolver` + feasibility graph** (§9.5–9.6) — worth it once the catalog has enough variety (junctions, gaps, moving platforms) that "can a human actually finish this Track" stops being trivially true by construction. Build it as a *second consumer* of the existing shared tuning constants (`TICK_DT`, jump/dash tuning already in `packages/shared`), never a second physics world — matches the proposal's own §19 anti-pattern list and this project's existing "no rollback / no second determinism story" posture (`docs/adr/0013`'s forward note on `RapierSimulation` teleport residuals already lives with exactly this kind of "don't build a second simulation" discipline).
7. **Budget model** (§12) — once the catalog has pieces expensive enough (moving platforms, more dynamic Props) that a naive "how many can a Track have" question needs an actual answer.

### 3.3 Premature while the tool is internal-only, zero UGC, zero auth

8. **Web asset/GLB/CDN pipeline** (§14) — no player-supplied or even multi-author visual assets exist; every Module is hand-authored TypeScript.
9. **Publishing/revision/content-hash/share-code** (§15) — `track-service` has no auth by explicit decision; "immutable published revision" protects against untrusted-author drift and dispute-reproduction needs that don't exist with one internal author.
10. **Phase 6 (share code / custom lobby load) and Phase 8 (discovery, moderation, likes/featured)** — assume a live sharing product. Nothing in the roadmap (`CLAUDE.md`) commits to UGC distribution; M4 is Match structure (Rounds/Qualification/Time Limit) and first Screens, not a level-sharing feature.

### 3.4 What flips if the answer is "yes, this becomes player-facing UGC"

If the user's separate, still-open answer to "internal tool vs. UGC feature" comes back "UGC" — §3.3's items 8–10 stop being premature and become the actual hard requirements (an untrusted author absolutely needs server canonicalization + content-hash + immutable revisions before anything ships to a second player, per the proposal's own §19: "Nespoléhat na klientský validator"). That's a large, separate scope decision (accounts, moderation, a real asset pipeline) that should get its own grilling session if/when it's raised — not decided as a side effect of this gap analysis.

---

## 4. Worth doing regardless of the internal-vs-UGC answer

- **Command-pattern undo/redo** (§11.3): useful for literally any real editor, UGC or not. No reason to wait.
- **Real sockets + per-piece footprint** replacing the single global `MODULE_STEP`: the current system is structurally incapable of a junction, a branch, or even two pieces of different length — that's true whether the eventual author is a developer or a player.
- **Structural validation at save time**: a garbage Track crashing the Match server at Round start is a bug regardless of who's authoring content.
- **`PieceCatalog` as a named, versioned concept** (even before any of §15's revision machinery): formalizing `MODULE_LIBRARY` into something with its own version number costs little and makes the eventual `pieceCatalogVersion`/`gameplayVersion` split (§3.2 of the proposal) a straightforward addition later instead of a retrofit.
