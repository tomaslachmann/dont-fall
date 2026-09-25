# 18 — Ride reservations: slots with leases, between Bots

**Design:** ADR 0130's amendment, point 3. **Evidence:**
- ticket 14 "As built (phase 3)": the diagnosis, and throughput collapsing when the crowd dodged;
- 07l: twelve Bots on a 0.8 m ring;
- 07h: rides with a crowd.

**Status:** planned. **After 15 and 17.**

**Start with one endpoint:** the base race's spinning squares (Cp 2→3), the worst crowd leg (pushed
27 / 44 at NORMAL / EASY). Then the moving rows (Cp 1→2). Then Spin Cycle's carousels.

## Build

- **A `RideTraffic` per ride link, owned by the `BotTrack`.** It is shared by every Bot on the
  authority and deterministic, with nothing random.
- **Slots per link, each a time window.** An approach slot (a waiting spot), a board slot (the run-up
  and jump window), aboard slots (spots on the deck, in its frame, spread round the ring as 07l
  proposed), and an exit slot.
- **Order.** Stable, by ETA to the link, then distance, then the Bot id as the tie-breaker. Alighting
  outranks boarding. Where two flows conflict, alternate them (zipper).
- **Token.** A Bot leaves its waiting slot only when it holds the board token. The token is released on
  a confirmed board or alight, on a Fall, or on its **lease timeout**. The timeout guarantees ADR 0129's
  "never stranded": no Bot waits longer than `BOT_RIDE_LEASE_MAX_TICKS`, and a test holds that.
- **Humans reserve nothing.** An observed Character in or entering a slot's space voids that slot for
  its window. The Bot yields and takes the next one. It reads only what it observes, late as usual.
- **Style hook, no numbers yet.** Compliance (how strictly a Bot keeps its turn), patience and gap
  acceptance are profile fields for 21. The safety part of a slot, meaning where it is and when, is
  never style.
- **The rider acts on slots.** `DeckRider` walks to its slot, waits there, and runs its script when it
  holds the token. Nothing else steers a slot walk. A late view is covered by the slot's own spacing,
  not by a crowd margin.

## Measure, on the endpoint's leg first, same seeds

- passes, and throughput per minute through the link;
- wait p50 and p95;
- starvation, meaning the lease ran out;
- `pushed` and `contact` on the leg;
- step-offs;
- think µs.

## Targets

- base race Cp 2→3 at NORMAL and EASY: `pushed` + `contact` halved, against ticket 14's last run;
- throughput no worse than without slots;
- starvation 0;
- step-offs 0.

## Falsification

If reservations lower throughput or cause starvation without lowering `pushed`, the slot granularity
or the priority is wrong. Record which, and do not widen to other links.

## Files

`deckRider.ts`, a new `bot/rideTraffic.ts` and its test, `tuning/bots.ts`, and `BotTrack` for the
shared owner.

## Regression set

As in 15, plus `fightRace` (the exemption).

Known reds that are not yours: the 14 in `RapierSimulation.test.ts`, the trapHold D/S wall-clock asserts, `difficulty.test.ts`, `races.test.ts`'s `ownFalls === 0`, `sweeperHold` base1's ordering, `deckRider`'s table-build times and the `think ≤ 40 µs` asserts under load (see ticket 14's As built lists).
