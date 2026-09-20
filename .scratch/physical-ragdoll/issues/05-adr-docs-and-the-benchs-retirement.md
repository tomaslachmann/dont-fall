# 05 — ADR, docs, and the bench's retirement

**What to build:** The paper trail, the perf answer, and the cleanup — after the user's live check
passes, not before.

**Blocked by:** 01–04, and the user's live check

**Status:** planned

- [ ] ADR "The ragdoll is the knockdown": supersedes ADR 0076's look (the GetUp clip survives, the
      KO clip retires from knockdowns), amends ADR 0047 (the "deliberate remainder" closes — ball
      joints get cone + twist stops via rope joints), amends ADR 0104 (physical limp carry,
      physical clamped Hurl), records the bake pipeline and the port's settled questions (Hurl
      clamp, Struggle stays animated — the user's answers, 2026-09-20)
- [ ] `docs/networking-model.md`'s ragdoll row: 15 bones, bones also while Held-limp
- [ ] `CONTEXT.md`: Ragdoll / GettingUp / Limp descriptions follow the new look (glossary only)
- [ ] `pnpm bench:sim` after — against the before-run captured ahead of ticket 01; if the eager 15
      hull bodies cost, lazy-build on first knockdown
- [ ] The old `Ragdoll`, `RAGDOLL_BONES`, `blendGettingUpBones` and their tests retire;
      `apps/client/src/rubber/` (untracked) is deleted on the user's word
- [ ] The retired joint-limit constants (`RAGDOLL_SPINE_LIMIT` …) leave `tuning/knockdown.ts` —
      the baked spec carries the rig's anatomy; tuning keeps only feel (damping, timers,
      `GETUP_DRIVE_MS`)

## Notes

- Waiting on the user before this ticket closes: every look and feel — the fall, the get-up seam,
  the hang, the throw, the lean — plus whether `RAGDOLL_MIN_MS` still reads right when the fall
  is worth watching.
