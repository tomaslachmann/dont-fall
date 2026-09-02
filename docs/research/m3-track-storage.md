# M3 track storage: database choice for the Track builder's save/load API

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs) — see `docs/research/m2-netcode-transport.md` for the
> convention. This file feeds a specific design discussion; it is not itself a
> decision record. If the recommendation below is adopted, it should be captured
> as an ADR the normal way.

Scope: M3 introduces the project's first persistence layer. A new, separate,
always-on Node service (distinct from the ephemeral per-Match `apps/server`,
which stays exactly as ADR 0002/0011 describe — spun up on demand, torn down
after) hosts a save/load API for Tracks authored in an in-game/dev-only visual
Track builder. A Track is an ordered sequence of Segment placements — a small,
self-contained document (`{moduleId, position, rotation}` tuples), not a web of
relations. No querying beyond "load this Track by ID" / "list saved Tracks" is
needed today. This service is expected to run in a Docker container, and there
is a real, separate future plan (explicitly out of M3's scope) for a full
Account/Player system that will eventually need to relate to this data. This
note does not re-litigate the builder's own scope (single-player local testing
only, no multiplayer) — only what stores the Tracks it saves.

## Recommendation

**SQLite, accessed through Drizzle ORM, in a single named Docker volume — not
Postgres, not yet.** SQLite's own documentation states its target case
explicitly: appropriate when "the application ... runs on a single machine" or
network filesystem isn't in play, when at most one write is happening at a
time (readers/writers can queue), and dataset size stays well under the
terabyte range — precisely this service's shape (a solo/small-team dev tool
saving small JSON-shaped documents, no concurrent multi-editor writes expected
at M3's scale). Its own framing is blunt about the comparison this note is
making: "SQLite does not compete with client/server databases. SQLite competes
with fopen()." [SQLite — Appropriate Uses For SQLite](https://www.sqlite.org/whentouse.html)
Postgres is the right migration target *later*, specifically when the stated
future need (an Account system, presumably real concurrent multi-user writes
and relational joins against Player/Account rows) actually arrives — not
speculatively now, matching this project's established pattern of deferring
infrastructure until a real, measured need exists (ADR 0002's on-demand
servers instead of a standing fleet; ADR 0011's JSON-not-binary-yet; M2's
explicit "no accounts, no persistence"). Running the SQLite file on a Docker
named volume is the documented safe pattern; the one hard constraint is that
its WAL mode's shared-memory coordination file requires the two containers
sharing a volume to also share a kernel/filesystem — true for Docker volumes
on one host, **false for NFS/CIFS network storage**, which must fall back to
the older DELETE journal mode if ever used. [SQLite WAL, Simon Willison — research: SQLite WAL Mode Across Docker Containers Sharing a Volume](https://simonwillison.net/2026/Apr/7/sqlite-wal-docker-containers/)

**Use Drizzle, not Prisma, for the ORM layer.** Both support SQLite, but
Drizzle's own docs show first-class Node driver support for `better-sqlite3`
(the most mature, synchronous, battle-tested Node SQLite binding),
`node:sqlite` (Node's own built-in, driver-free option), and `libsql`; setup
for a local file-backed database is a handful of lines — a driver, a schema
file, a config file, `drizzle-kit push`. [Drizzle ORM — Get Started: SQLite](https://orm.drizzle.team/docs/get-started/sqlite-new)
Both Drizzle and Prisma can target Postgres later, so this isn't a one-way
door either way — but Drizzle's query-builder style (compose SQL-shaped calls
directly) stays closer to the "no framework, dependency-light" posture already
established for the transport/message-format choices in ADR 0011, versus
Prisma's separate declarative-schema-and-generated-client model. [Prisma — Prisma ORM vs Drizzle](https://www.prisma.io/docs/orm/v7/more/comparisons/prisma-and-drizzle)

**Do not add Litestream (or any replication tool) for M3.** It solves
continuous off-box backup/replication of a production SQLite file to object
storage for disaster recovery [Litestream](https://litestream.io/) — a real
concern once actual users' authored content must survive a lost volume, but
premature for an internal dev tool whose content (for now) can be regenerated
or re-authored if lost. Revisit if/when saved Tracks become something a wider
team or the future Account-holding players actually depend on not losing.

---

## 1. SQLite vs Postgres for this specific shape

- SQLite's own "Appropriate Uses" page gives four conditions favoring it:
  application and database on the same machine (no network separation), low
  write concurrency (single writer, others can queue), data comfortably under
  roughly a terabyte, and a preference for zero-administration deployment.
  This project's Track-storage service matches all four today: it's a small
  Node service saving small JSON-shaped documents from a single-person/small-team
  dev tool, with no concurrent multi-editor write load expected.
  [SQLite — Appropriate Uses For SQLite](https://www.sqlite.org/whentouse.html)
- Its own comparison line is the sharpest way to frame the decision: "SQLite
  does not compete with client/server databases. SQLite competes with
  `fopen()`." — i.e., the real alternative being displaced here is "a directory
  of hand-committed JSON files" (which is exactly what ADR-adjacent M1/M2
  content like `PLAYGROUND_PROPS`/`PLAYGROUND_STATICS` already is), not a
  distributed production database. [SQLite — Appropriate Uses For SQLite](https://www.sqlite.org/whentouse.html)
- The same page's flip side is equally direct about when to leave: real
  network separation between app and database, many concurrent writers that
  can't tolerate queuing, or approaching terabyte-scale data. None of these
  are true for M3's stated scope; the Account-system future is explicitly the
  trigger for revisiting, not a reason to pre-build for it now.
  [SQLite — Appropriate Uses For SQLite](https://www.sqlite.org/whentouse.html)
- Independent 2026 coverage of exactly this class of decision (a small,
  single-operator service, admin-only or low-frequency writes, no budget for a
  managed DB) converges on the same answer, while flagging the honest
  counter-signal: Postgres is the better call the moment the team or
  concurrency is expected to actually grow, or once analytical/relational
  querying is needed — which is precisely how this project already frames the
  Account system, as a distinct *future* milestone, not part of M3.
  [SQLite vs Postgres for the Solo Founder in 2026](https://abhishekchaudhary.com/blog/sqlite-vs-postgres-solo-founder)

## 2. Running SQLite in a Docker container safely

- WAL mode's concurrency guarantees rely on a memory-mapped shared-memory
  coordination file (`.db-shm`); this works correctly when two containers
  share a Docker volume on the **same host**, because containers share the
  host kernel and the mmap-backed coordination genuinely is shared memory
  underneath. [Simon Willison — research: SQLite WAL Mode Across Docker Containers Sharing a Volume](https://simonwillison.net/2026/Apr/7/sqlite-wal-docker-containers/)
- WAL still serializes writers — "WAL doesn't give you concurrent writes...
  at any moment, exactly one transaction holds the write lock" — what it
  actually buys is that writes no longer block reads and reads no longer
  block writes, which is the concurrency this service actually needs (the
  builder is not expected to have many simultaneous writers). [Simon Willison — research: SQLite WAL Mode Across Docker Containers Sharing a Volume](https://simonwillison.net/2026/Apr/7/sqlite-wal-docker-containers/)
- The one real trap: WAL's shared-memory file "does not work reliably over
  NFS, CIFS, or other network filesystems" — the moment the database file
  needs to live on networked/shared storage rather than a local Docker
  volume, WAL must be dropped for the older DELETE journal mode, or the
  service should move to a client/server database instead. Since this
  service is a single always-on container with a local named volume, this
  doesn't apply today, but it's the concrete tripwire for "this needs
  Postgres now." [Simon Willison — research: SQLite WAL Mode Across Docker Containers Sharing a Volume](https://simonwillison.net/2026/Apr/7/sqlite-wal-docker-containers/)

## 3. ORM/driver choice

- Drizzle ships first-class support for three Node SQLite drivers —
  `better-sqlite3`, Node's own built-in `node:sqlite`, and `libsql` (a SQLite
  fork tuned for low query latency) — and a local file-backed setup is a
  driver install, a schema file, a `drizzle.config.ts`, and `drizzle-kit push`;
  no server process to stand up for local development. [Drizzle ORM — Get Started: SQLite](https://orm.drizzle.team/docs/get-started/sqlite-new)
- Drizzle's own comparison against Prisma frames the real tradeoff: Drizzle
  is "a traditional SQL query builder" you compose queries with directly,
  while Prisma models the schema declaratively and generates a client/migration
  pipeline around it — Drizzle stays closer to plain SQL, Prisma adds more
  structure and code generation. Either can target Postgres later; this is a
  workflow preference, not a lock-in decision. [Prisma — Prisma ORM vs Drizzle](https://www.prisma.io/docs/orm/v7/more/comparisons/prisma-and-drizzle)
- **Caveat on "migrating later is easy":** switching the underlying dialect
  from SQLite to Postgres is not a free flip even with the same ORM — SQLite
  has a different type system and dialect-specific behavior (e.g. its
  operators and type affinity rules) that a Postgres migration will need to
  actually re-map, not just repoint a connection string. What Drizzle buys is
  a familiar query-builder mental model and migration tooling on both sides,
  not a zero-cost swap. Budget an actual (small) migration step whenever the
  Account-system trigger arrives.

## 4. Explicitly out of scope for M3

- **Litestream** (or any continuous-replication tool) — solves shipping a
  live SQLite file's changes to object storage for disaster recovery
  [Litestream](https://litestream.io/) — real value once saved Tracks are
  content real users depend on, premature for an internal authoring tool
  today.
- **Postgres itself** — the correct target once the Account system (already
  planned, explicitly not M3) needs real relational joins against Player
  rows and/or genuine concurrent multi-writer load; stood up then, not now,
  matching this project's consistent pattern of not pre-building for
  speculative future scale (ADR 0002, ADR 0011).
