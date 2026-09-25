# 05 — A stronger blast, and Shooters that fire bombs

**What to build:** a Blast's own throw (about 3× further) and 6 m reach (ADR 0126,
amended); a Shooter's AMMO · BALL / BOMB, with bombs fired lit on a 3 s fuse (ADR 0127).

**Blocked by:** 02

**Status:** done on tests (2026-09-23)

- [x] `BOMB_BLAST_LAUNCH_SPEED`, `BOMB_BLAST_RADIUS` 6; `launchScaleOf("Blast")`
- [x] `ShooterTiming.ammo`, `SHOOTER_BOMB_FUSE_SECONDS`, `shooterBodies`, `assetIdsOf` names bomb A
- [x] Shot bombs lit on firing, never parked by their life, waiting for their Shooter once spent
- [x] A shot bomb can be picked up; a thrown one hits once
- [x] Builder AMMO toggle; MCP `set_shooter` `ammo`
- [x] Tests: the throw, the fuse default, bodies, lit-then-spent, a direct hit, the fallback to balls
