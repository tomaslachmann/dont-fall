# 01 — One correction gate, not three

**What to build:** Nothing new. Delete two copies of a rule and point their tests at the real one.

The reconciliation correction gate — "does this server snapshot disagree with my prediction badly
enough to correct and replay?" — is implemented three times: in production
(`apps/client/src/reconcileGate.ts`), in the regression harness, and again in
`RapierSimulation.test.ts`. **Two of the three are already stale.** One still asserts
`positionError > 0.2`, a threshold ADR 0026 retired; both test copies are missing the `finishTick`
term M4 ticket 02 added. Both tests pass, guarding the wrong rule.

This is first because it is an afternoon's work that stops two netcode tests from lying, and it is
the small half of ticket 02.

**Blocked by:** None.

**Status:** done

- [x] Both test copies call the exported `needsCorrection`; the copied predicates are deleted —
      `RapierSimulation.test.ts`'s copy calls it directly; the regression harness's own
      `reconcileEpsilon`/`hardSnapM` knobs are a deliberate, documented baseline-vs-proposal
      research comparison the shared gate does not (and should not) parameterize, so it gains the
      missing `finishTick` branch as its own named reason instead of folding into `needsCorrection`
      wholesale — explained in the commit
- [x] The stale `0.2` threshold and the missing `finishTick` term go with them
- [x] Any test that was only passing because it tested the old rule is corrected — none were;
      `RapierSimulation.test.ts`'s 155 tests and the harness's 22 all still pass unchanged
- [x] `predictionRegression` stays green, numbers unchanged (checked against the pre-change run)
