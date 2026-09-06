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

**Status:** ready-for-agent

- [ ] Both test copies call the exported `needsCorrection`; the copied predicates are deleted
- [ ] The stale `0.2` threshold and the missing `finishTick` term go with them
- [ ] Any test that was only passing because it tested the old rule is corrected, and the
      correction is explained in the commit — this is the one place in M4.5 where a changed
      assertion is expected rather than suspicious
- [ ] `predictionRegression` stays green
