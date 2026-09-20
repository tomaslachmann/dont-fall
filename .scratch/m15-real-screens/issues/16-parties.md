# 16 — Parties

**What to build:** Invite friends into a party from the menu. A Quick Match seats the party
together, and PlaySelect's BRINGING shows who is in it. Voice chat's PARTY (17) is the party. The
user's choice, ADR 0110.

**Blocked by:** —

**Status:** done on tests (2026-09-20) — settled with the user on 2026-09-19 (three question rounds) plus
two calls after the first build, **ADR 0112**. Visual and live checks are the user's.

## Settled

The user's answers were all the recommended ones, and their own design drop (`ui/PartyStrip.tsx`, the
`Party` and `InviteFriends` mocks in `test_components/src/screens/`) answered the rest. Full text in
ADR 0112. In short:

- **Four beans** (`PARTY_MAX_SIZE`); a pending invite takes a slot.
- **Only the host moves the Party, and it follows everywhere**: Quick Match, PLAY AGAIN, a created
  private Lobby, a code, JOIN on a friend's Lobby, an accepted Lobby invite. A Lobby without room
  refuses (409, with the reason). The Party is never split.
- **PLAY waits for everyone** in the menus (WAITING FOR <name>).
- **Host leaves the Party's Lobby before its Match → the Party leaves with them.** A member entering
  a *different* Lobby leaves the Party. Stepping out of the Party's own Lobby does not.
- **Friends, recent players and anyone with the code** (ten minutes, SHARE LINK `/party/<code>`, or
  pasted into your own invite card's search). A friend code pasted there invites that bean.
- **In memory, while online.** A member drops out 90 s after their Account socket closes.
- **One Account socket per client**, pushing everything instantly. It replaces the heartbeat (the
  lost-Lobby-invite bug goes with it).
- **Reservations** on the Match server, so a Party is seated together and never started without.
- **The main menu wears the Party while it is active** (a second member or an invite out):
  `PartyStrip` in the stat tiles' place, the invite card, a hero of every member's bean. Alone, the
  tiles stay. The user's call after the first build, 2026-09-19.
- **A lone player starts a Party from the Friends screen**: opened from the menu, its INVITE / INVITE
  ALL ONLINE send Party invites; inside a Lobby they stay Lobby invites. The user's choice.

## Build

Contracts are in `packages/shared/src/social/Party.ts` and `tuning/match.ts` (Parties). Every slice
codes against them and does not change them without a reason written here.

### S1 — Match server: Reservations (`apps/server`)

- [x] `ServerConfig.reservationSecret?: string`. Without one, `/reservations` answers 404.
- [x] `POST /reservations` beside `/status` (the same `createStatusHandler` listener, which becomes a
      small router): header `x-reservation-secret`, JSON `{ accountIds: string[] }`. Grants **all or
      none**: `200 { reservations: { [accountId]: token } }`. `409` when phase ≠ LOBBY, a `start` was
      requested, or `sockets + live reservations + n > maxPlayers`. `401` for a wrong secret, `400`
      for a bad body.
- [x] A reservation lives `SEAT_RESERVATION_TTL_MS`. Live ones count in `ensureCapacity` and in
      `/status.playerCount`.
- [x] A connection with `?reservation=<token>` of a live reservation uses it up (passes capacity in
      that seat's place). An unknown or expired token is an ordinary connection.
- [x] `startBlockedReason()` names the beans still arriving while any reservation is live, so the
      `start` gate refuses and the host's Start shows why. The tick loop drops expired reservations
      and marks the snapshot dirty when the reason changes.
- [x] Tests: all-or-none, capacity with reservations, token use, expiry, start blocked then free,
      refused after `start`, the secret.

### S2 — API: Parties, the Account socket, party-aware entries (`apps/api`)

- [x] `PartiesService` (in memory, `apps/api/src/party/`, framework-free with an injectable clock
      like `LobbiesService`): one Party per Account. Implicit party of one; host = earliest `joinedAt`;
      invites (TTL), code (TTL, rotated, six characters from the friend-code alphabet), `place` per
      member, offline grace (`PARTY_OFFLINE_GRACE_MS`) off the Account socket's open/close, the
      Party's `lobby`. `partyOf(accountId)` and `onChange(listener)` for voice (ADR 0111 / ticket 17).
- [x] Routes `apps/api/src/party/party.controller.ts`, bearer-authenticated like `/friends`:
  - `GET /party/candidates` → `PartyCandidatesView` (friends + recent players, state per ADR 0112:
    offline and in another Party of 2+ are `busy`; already a member is `busy`; pending is `invited`)
  - `GET /party/lookup/:code` → `PartyCodeLookup` (a live Party code, else a friend code), 404 otherwise
  - `POST /party/invites {accountId}` → `201 { inviteId }`. 403 not the host, or not a friend or
    recent player. 409 full, busy, offline, already invited or already a member. 404 unknown.
  - `DELETE /party/invites/:id` (host) → 204; `POST /party/invites/:id/accept` → `PartyView`;
    `POST /party/invites/:id/decline` → 204
  - `POST /party/join {code}` → `PartyView` (404 unknown or expired, 409 full, 400 your own)
  - `POST /party/leave` → 204; `DELETE /party/members/:accountId` (host) → 204
- [x] **Account socket** at `ACCOUNT_SOCKET_PATH` on the API's HTTP server: `ws` in `noServer`
      mode, routed from the existing `upgrade` handler next to `proxyMatchSockets` (`ws` becomes a
      dependency). First message `auth {token}`, answered `ready`, then `party`, and any undelivered
      Lobby invites (marked delivered). Bad auth closes `ACCOUNT_SOCKET_UNAUTHORIZED`. A newer socket
      for the same Account closes the older with `ACCOUNT_SOCKET_REPLACED`. While a socket is open
      the API records the presence beat every `ACCOUNT_BEAT_MS` (and on connect).
- [x] Pushes: `party` to every member on any change; `partyInvite` / `partyInviteGone`; Lobby
      invites at `POST /friends/invite` time; `follow`, `left`, `removed`.
- [x] `place` messages update the member. When the host's place leaves `lobby` while the Party's
      `lobby` is set and the Match has not started, every member still in that Lobby gets `left`.
- [x] `POST /friends/heartbeat` and `heartbeat()` are deleted (`recordBeat` stays as the socket's
      writer). Presence and beans online read the same `presence_beats` as before.
- [x] **Party-aware entries** in `LobbiesService` (a `PartiesService` and a `reserveSeats` seam,
      real HTTP by default, with a per-process secret handed to every `startMatchServer`):
  - `POST /lobbies/quick-match`, `POST /lobbies` (create), and a new `POST /lobbies/join
    {code} | {lobbyId}` that replaces `GET /lobbies/code/:code` and `GET /lobbies/:id` (their only
    callers are the client's; delete them). Each answers `LobbyEntryGrant` (create also
    `code`/`isPrivate`).
  - Anonymous caller: as today, with no reservation. A member who is not the host leaves the Party
    (`leftPartyOf`), then enters alone. The host: every other member's place must be `menu`, else
    409 `waiting for <name>`. Reserve for every member at once (Quick Match: the first open public
    Lobby that grants, else a fresh one; create: the new Lobby; code or id: that Lobby, else 409
    `no room for your party of N`), set the Party's `lobby`, push `follow` to the members, and
    return the host's own reservation.
  - A member accepted while the Party sits in a Lobby with its host gets a reservation and a
    `follow` there, when one is granted.
- [x] Tests: the service's rules (every bullet above) on a fake clock; routes via `inject`; the
      Account socket over a real `ws` client (auth, push, replace, beat); the entries with a fake
      `reserveSeats`.

### S3 — Client: the socket, following, gating (`apps/client`)

- [x] `lib/social/accountSocket.ts`: one module-level owner (the `gamePresence.ts` pattern), open
      while signed in, reconnecting with backoff (not after `ACCOUNT_SOCKET_REPLACED`), holding the
      Party, Party invites and Lobby invites; `useParty()` / `useSocialInbox()` via
      `useSyncExternalStore`. `useFriends` loses its heartbeat and its `invites`.
- [x] Place reporting: `lobby` on the Lobby Screen while its phase is LOBBY, `match` from LOADING
      until leaving Rewards, `menu` otherwise.
- [x] `lib/api/party.ts` for the routes. `lobbyBroker` answers `LobbyEntryGrant`; `lobbyPath`
      carries `reservation`, and the Lobby socket's URL passes `?reservation=` to the Match server.
- [x] `GlobalAlerts`: the Party invite toast (the dark invite toast, PARTY INVITE, JOIN / ×);
      `removed` as the mock's toast; `follow` navigates to the Lobby; `left` goes back to the menu
      with a flash; `replaced` flashes; `leftPartyOf` flashes.
- [x] PlaySelect: BRINGING is you + your members, "N friends in your party", `lobbySize − partySize`
      strangers; a member's FIND A MATCH is disabled with whose call it is; the host's reads WAITING
      FOR <name> until everyone is in the menus. Rewards' PLAY AGAIN likewise.

### S4 — Client: the Party on the main menu (`apps/client`)

- [x] `PartyStrip` on the main menu per the Party mock's layout, fed by `useParty()` (its `Avatar`
      prop moves to the live kit's `look`). Host: code, INVITE FRIENDS, × on everyone else (remove
      or cancel). Member: `<HOST>'S PARTY`, "Only the host can invite or remove beans.". LEAVE PARTY
      disabled alone.
- [x] PLAY's kicker: PLAY AS A PARTY · N BEANS READY in a Party, QUICK MATCH · N BEANS ONLINE alone.
- [x] The invite card (the `InviteFriends` mock's `InviteCard`, ported) over the menu: ONLINE / RECENT
      / ALL from `/party/candidates`, INVITE / CANCEL, a pasted code looked up (a Party: JOIN; a
      bean: INVITE), the code and SHARE LINK (`/party/<code>`).
- [x] `/party/:code` joins after signing in, then the menu, with a flash.
- [x] The menu's hero draws every member's bean in its own look.

### S5 — The user's calls after the first build

- [x] MainMenu renders `PartyStrip` only while the Party is active (members ≥ 2 or pending ≥ 1);
      alone, the stat tiles (BEST SURVIVAL / WINS / GRABS BROKEN, the career query) come back as
      they were.
- [x] `FriendsRoute` opened from the menu (no `lobbyRef`): INVITE → `POST /party/invites
      {accountId}`, INVITE ALL ONLINE → one per free online friend, with the same flashes; inside a
      Lobby, unchanged Lobby invites.

### Left as follow-ups (found in review, not fixed here)

- **A host who closes the game while the Party sits in its Lobby never sends `left`.** The host-left
  rule reads `place` reports, and a closed game sends none, so members stay in the Lobby with
  strangers until the host drops out after the grace. Confirming it against the Lobby's own roster
  (`/status.accounts`) would fix it.
- **Party invites have no rate limit.** A cancel or decline frees the slot at once, so a host — a
  stranger, when inviting by friend code — can re-pop the sticky toast on one target without limit.
  A per-(sender, target) cooldown after a cancel, decline or expiry is the fix.
- **A friend code reveals whether its owner is online.** `GET /party/lookup/:code` answers `free`
  only when the Account socket is open, and the invite refusal says "is offline", so anyone holding
  a (permanent, freely shared) friend code can poll a stranger's sessions. Non-friends should get a
  state and a refusal that do not distinguish offline from busy.
- **StrictMode's double dial spends a Reservation token.** `useLobbyConnection` creates the socket
  before it can be cancelled, so the throwaway first socket uses the one-shot token and the real one
  arrives ordinary — it is refused when the Lobby is full. The seam needs to expose the socket (or
  take an AbortSignal) so the cleanup can close it.

### After

- [ ] `/code-review` high (netcode-adjacent: reservations, follow, the socket)
- [ ] M15.md checklist, CLAUDE.md status

## Not here

- Voice PARTY wiring (ticket 17 reads `PartiesService.partyOf` / `onChange`).
- SURVIVAL's Quick Match and public-Lobby auto-start (ticket 15), which must treat a reservation as
  a bean that is present but not ready.
