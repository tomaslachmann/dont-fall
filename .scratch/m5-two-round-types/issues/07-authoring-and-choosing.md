# 07 — Authoring a Survivor Target, and choosing a Round type

**What to build:** The two ends that make Survival reachable by a player rather than by a test.

**Authoring:** the Track builder writes a Track's default Survivor Target, exactly as ticket 03 of
M4 taught it to write the Time Limit — a number on the Draft, written with the Revision, restored
on load. Without it, half of ADR 0041 is unauthorable.

**Choosing:** the Lobby picks the Round type, and the server refuses to start a Round whose Track
cannot support it — a Race needs a Finish Zone. Validated at Round start, never by tagging Tracks
with the Round types they allow (ADR 0041), because that would be a compatibility matrix to
maintain and re-check against every existing Track.

**Blocked by:** 02 (there must be something to author into) and M4 ticket 07's Lobby.

**Status:** done

- [x] The builder authors a default Survivor Target; publish writes it, load restores it
- [x] The Lobby picks the Round type and shows it to everyone before the start
- [x] Starting a Race on a Track with no Finish Zone is refused with a reason a player can read —
      replacing today's silent "not raceable"
- [x] Nothing tags a Track with the Round types it allows

**Done:**

*Authoring.* `TrackRoundDefaults` (`packages/shared/src/track/Track.ts`) names the pair a Revision
carries — the Time Limit and the Survivor Target — so the stored row, the builder's publish and the
Match server's fetch move them together and one of the three can't silently drop a field. track-service
gained a `survivor_target` column with the same additive `ALTER TABLE ... DEFAULT` backfill ADR 0038
used, so every Revision published before M5 keeps loading unchanged; `invalidSurvivorTargetReason`
rejects (never clamps) an out-of-bounds publish, since a Revision is immutable. The builder authors it
in a field beside the Time Limit, with `parseDraftSurvivorTarget` shaped exactly like
`parseDraftTimeLimitMs`, and `Load` restores it. Bounds landed in `tuning.ts` as `MIN_/MAX_SURVIVOR_TARGET`
— the siblings ticket 05 deferred to here, absolute rather than relative to the roster, because publish
time cannot know how many Players a future Lobby will hold.

*Choosing.* `RoundType` (`packages/shared/src/match/RoundType.ts`) is the one place a Round type is a
*name*; `roundTypeOverrides` turns it into plain `RoundOverrides` before anything simulates, so ADR 0043
holds — nothing downstream branches on a mode. It deliberately overrides only `fallBehavior`: the
Survivor Target is a real Track default, and overriding it here would make the authored number
unreachable. The host picks with `setRoundType` (host-only, LOBBY-only, validated against `ROUND_TYPES`),
and `MatchRuntime.setRoundType` re-resolves the rules and syncs them into the live simulation without
rebuilding it — a Round type changes what the rules say, never what the world is. The pick rides
`lobby.roundType` on the snapshot so every Player sees it, alongside the resolved `roundRules` the
client already predicts against.

*Refusing.* `roundStartBlockedReason(roundType, trackHasFinishZone)` is read by both the `start` gate and
the snapshot's `lobby.startBlockedReason`, so what a Player is told and what the server enforces cannot
disagree. `trackHasFinishZone` is resolved once with the simulation (`resolveTrack` already answers it),
which is the whole of "validated at Round start" — no Track is tagged, and picking Survival makes the
same Track startable immediately.

Ticket 05's test-only `fallBehaviorOverride` is gone: it was the Round type standing in for a Lobby that
couldn't pick one, and the server's Survival tests now go through `setRoundType`. `survivorTargetOverride`
stays, as the same kind of Match-level override `timeLimitMsOverride` is over the same kind of Track default.

**Open, for ticket 08's live verification:** a Survival Round whose Survivor Target is at or above the
number of connected Players meets its ending condition on its first RUNNING tick (`survivorTargetReached`
is `survivors <= target`), so it ends before it is played. Now easy to reach, since a Track can author a
target of 4 and be run by two friends. Deliberately *not* added to `roundStartBlockedReason` here: the
obvious gate (`target >= connectedPlayers`) would also refuse a solo Playtest of Survival at the default
target of 1, which is how a Track author walks an arena to check its geometry. Whether to block, warn, or
leave it is a call to make with the two-browser playthrough in hand.
