# 13 — Training against Bots from the menu

**What to build:** a menu choice to play against Bots, with the Track and the level picked,
**without a server** (ADR 0129): the local session `?freeroam=1` already boots
(`apps/client/src/game/practice.ts`) runs Bots from `packages/shared` as its own authority.

**Blocked by:** 09

**Status:** planned

- [ ] **Scope (the user, 2026-09-24): one Round, not a Match.** A Race (later Survival) against
      up to 11 Bots on the picked Track, with a finish placement at the end. The Match loop stays in
      `apps/server`; nothing moves into shared for this
- [ ] Menu entry composed from the mocks' pieces; Track + level picker
- [ ] Bots in the local session drawn as remote Characters (the client's own rigs, not the
      local one's)
