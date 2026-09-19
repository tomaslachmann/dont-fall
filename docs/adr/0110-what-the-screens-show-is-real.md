# 0110 — What the Screens show is real

## Context

The user, on 2026-09-19: "ted projit UI a vyresit namockovane veci asi jako beans online atd" (now
go through the UI and resolve the mocked things, like beans online).

A read-only sweep of every Screen, the in-Round HUD and the producers behind them
(`docs/research/ui-mock-audit-2026-09.md`) found three kinds of untruth:

- **values that are wrong today**, for example a between-Rounds gain that drops to `+0` and a
  locally counted Round number;
- **values the game already has but does not wire**, for example every small avatar being a hash
  of an id rather than the Player's Colour, Skin and Hat;
- **values nothing backs**, for example BEST SURVIVAL, a queue wait, a party, emotes, a pause menu.

The standing rule from ADR 0088 and the working agreement still hold: a field the design shows is
built, not hidden, after its meaning has been agreed. Four question rounds with the user the same
day settled the meanings below. Every choice marked "the user's" is an answer from those rounds.

## Decision

### Nothing a Screen shows is invented

A value on a Screen or the HUD is either fed by the Lobby socket, the API or the Account, or it is
interface wording. Prop defaults holding mock data never reach production. Design captions that
labelled a picture in the mock ("GAMEPLAY FEED…", "EXISTING TRACK THUMBNAIL", "3D CHARACTER
RENDER") are deleted, and copy that claims something untrue (the ErrorScreen's "we logged it" and
its constant support code) is made true or removed.

### Definitions

- **Beans online** counts every Account whose presence heartbeat (`presence_beats`, sent every
  30 s by every signed-in client) is younger than the online window friends presence already uses
  (90 s). The user's choice, over counting only Players seated in a Lobby.
- **The Round number** is the server's, `roundResults.length + 1` from when the Round starts
  loading, replicated on the snapshot (`round`). The client stops counting COUNTDOWN edges. Betting already keys on the server's number.
- **Rewards** are derived by the server from the stored Match (`match_results` keeps each Player's
  Account id), never from placement rows the client sends. This closes ADR 0059's "honest
  limitation".
- **An avatar is a picture the Player uploads** (the user's call, over drawing their bean): in
  Settings → ACCOUNT, as PNG, JPG or WebP, cropped by the browser to a centred square, scaled to
  256×256 and sent as WebP, which the API accepts only by its header and up to a small size. Without
  one it is their Discord picture, and without that the design's striped disc in their bean's
  Colour. Every Account's picture has one address, `GET /avatars/<accountId>`, so anything that
  knows an Account id (the Lobby roster, a stored Match, a friend) draws it with no new field on the
  wire. Settings → ACCOUNT, a placeholder until now, holds it with the name, Discord and LOG OUT.
- **Discover**: TRENDING ranks by plays in the last 7 days, and TODAY'S FEATURED CHAOS by the last
  24 hours, falling back to the 7 days when nothing was played that day. The user's choice.
- **BEST SURVIVAL** is an Account's longest time alive in a single Survival Round, and **GRABS
  BROKEN** is how many Struggles it has won (ADR 0104). Both are recorded per Match participant
  from now on. The user chose building the tracking over swapping in stats that already exist.
- **Leaderboards** has three boards, the user's pick: wins all-time, best Race time per Track (from
  `personal_bests`), and best Survival. The design has no Leaderboards screen, so it is composed
  from the mocks' existing pieces (ADR 0105's rule).

### Around a Round (a fourth question round, the same day)

- **Betting stays open while at least two runners are still in the Round**, and closes the Tick one
  is left, or when the Round settles. The user's choice, over a longer fixed window or betting from
  the Countdown. The Match server tells the API (`POST /bets/rounds/close`); the old 60 s window
  becomes a ceiling (`BETTING_CEILING_MS`) for a server that never does. A Round with no winner at
  all refunds every stake. The panel reads CLOSES AT 1 LEFT.
- **The verdict's timer reads ROUND ENDS IN** the Round's time left, the latest it can end. The
  design's NEXT ROUND IN cannot be known while others are still running.
- **The knocked-out card names who put you out**: GRABBED / HURLED / HIT BY, the last other
  Character to grab, Hurl or hit (a Hit, a Bump, a swung or flying body) you within
  `ELIMINATION_CREDIT_MS` (5 s) of the Fall that eliminated you. The shared step records it as
  `eliminatedBy` on the Character's snapshot, set once with `eliminated`. Nobody, no plate.
- **A tie at the top of a Match still names one winner** on MatchOver. The user's choice.

### Around the menus (a fifth question round, the same day)

- **The error screen's support code is real** (the user's choice, over removing it): the client
  makes a `DF-XXXX-XX` code, shows it, and files the failure under it (`POST /client-errors`:
  kind, message, page, browser, the Account when signed in); support reads it back by code with
  the service token. "We logged it with the code below" is then true.
- **INVITE FRIENDS opens the Friends screen in place**, over the Lobby like its Track browser, so
  the socket stays up; its INVITE and INVITE ALL ONLINE send real invites to this Lobby (a public
  one by the broker's id, now carried on `/lobby?id=`), each confirmed on the flash stack. Copying
  the code, which the button used to do, moved to the code itself, with the same flash.
- **PLAY AGAIN and BACK TO LOBBY differ** on Rewards: the Lobby a Match ran in closes with it
  (ADR 0059), so PLAY AGAIN is a Quick Match straight away and BACK TO LOBBY the choice of Lobby.
- **The Friends screen's "N ONLINE · M TOTAL" pill** shows the ONLINE tab rather than doing nothing.
- **KEEP ME LOGGED IN** decides whether the session token outlives the tab.

### Private Lobbies are set up where they are created

- **ROUNDS** on PlaySelect sets the new Lobby's initial Match length. The host can still change it
  in the Lobby.
- **WHO CAN JOIN**: **FRIENDS** means the host's friends see the Lobby (Friends, PlaySelect's
  FRIENDS IN A LOBBY) and join it with one click, while the code works for anyone. **INVITE ONLY**
  means a code or an invite, and friends are not shown it as joinable. The user's choice.

### Public Lobbies are matchmade

The user chose a real queue over a count of waiting beans. A public Lobby starts itself: QUEUE
shows the real time until the nearest one starts. The **SURVIVAL** tile on the main menu is a Quick
Match into public Lobbies that play only Survival Rounds. REGION shows the one server's configured
name and the measured round trip to it. This amends ADR 0040's host-gated start for public Lobbies
only. The thresholds are settled in their own ADR when the ticket is built.

### New systems the design assumes

The user asked for all of these. Each gets its own ADR once its details are settled with the user
in its ticket:

- **Parties**: invite friends into a party from the menu, and a Quick Match seats the party
  together (PlaySelect's BRINGING).
- **Voice chat**: OFF / PARTY / ALL, where PARTY is your party.
- **Drafts**: a Track has an owning Account and may be a draft. The main menu's BUILD tile counts
  your drafts.

### Presentation choices

- **Emotes and a victory pose** play outside a Round only: Character Select (PLAY EMOTE), your bean
  in the Lobby, and the MatchOver podium. They are stored on the Account like a Hat, with no change
  to the Round protocol. The set is what the rig has: Win, Shrug, Sulk, Wobble and Punch. The
  user's choice, over an in-Round emote key.
- **The Dash meter** becomes the mock DashFeedback's charge card (DASH CHARGE, the key, one pip for
  the one Dash, RECHARGES IN), and it blinks while the Dash is ready. The DashFeedback overlay
  itself is not ported.
- **The pause menu** (the mock's SettingsModal) opens on Esc in a Round and holds three real
  settings: **screen shake** on impact (OFF / LOW / FULL, a camera shake that does not exist yet),
  **nameplates** over other beans (OFF / ON, which do not exist yet), and voice chat. The same
  settings live on Settings → GAMEPLAY.

### Not built now

Password reset, the shop (OPEN SHOP, "SHOP ONLY" swatches, NAME CARD), the Ragdoll overlay and the
Elimination card. Their controls stay as they are until their own milestone.

## Consequences

- The snapshot gains a Round number and a Standings deadline, and a match participant row gains a
  survived time and a Struggles-won count.
- The shared step gains one replicated field, a Character's `eliminatedBy`, set once with
  `eliminated` and taken from the server on reconcile; nothing else in the step reads it.
- `POST /rewards/claim` stops taking rounds from the client, so a client cannot mint earnings.
- Public Lobbies stop waiting for a host, which ADR 0040 assumed they would.
- Parties, voice chat, public-Lobby auto-start and drafts are the four decisions left open. Each is
  settled with the user before its ticket is built.
