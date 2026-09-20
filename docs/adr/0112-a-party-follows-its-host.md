# 0112 — A Party follows its host

## Context

ADR 0110 asked for parties: invite friends into a party from the menu, and a Quick Match seats the
party together (PlaySelect's BRINGING). Voice chat's PARTY scope (ADR 0111) is "the same Party". It
left the details to M15 ticket 16, to be settled with the user first.

The user settled them in three question rounds on 2026-09-19, and dropped a design for them the same
day: `PartyStrip` (`apps/client/src/ui/PartyStrip.tsx`, "on the MainMenu"), the Party menu mock
(`test_components/src/screens/Party.tsx`) and the INVITE FRIENDS card
(`test_components/src/screens/InviteFriends.tsx`). The design answers a good deal on its own. Only the
host invites and removes beans ("Only the host can invite or remove beans"), and the × removes at
once, with no confirm. A pending invite takes a slot, shows how long it has been out, and the host can
cancel it. There is a party CODE that "works for 10 minutes", with a SHARE LINK. A removed member sees
"X REMOVED YOU FROM THE PARTY". The hero on the menu is the party, "PARTY OF FOUR, IDLE LOOP".

A read-only sweep of the code a party builds on found:

- **No push channel from the API to a client exists.** A Lobby invite is handed out on exactly one
  `POST /friends/heartbeat`, and every Screen that mounts `useFriends()` (the main menu, PlaySelect,
  Friends, `GlobalAlerts`) runs its own heartbeat. Only `GlobalAlerts` shows invites, so an invite
  can be drained by a Screen that throws it away. This is a live bug today, and party invites on that
  channel would inherit it.
- **Nothing reserves a seat.** Quick Match picks a Lobby with room for one caller. Capacity is
  checked only when a socket connects. A Lobby that has just been told to `start` still reads LOBBY
  on `/status` for up to a Tick. A group that enters one after another can therefore be split by
  strangers, or land as spectators.
- **The broker's join routes do not know who is asking.** Nothing ties an Account to where it went.

## Decision

### What a Party is

A **Party** is up to **four** Accounts (`PARTY_MAX_SIZE`) who play together. The user's choice. A
public Lobby of ten stays mostly strangers, and bigger groups already have FRIENDS private Lobbies
(ADR 0110). A pending invite takes a slot until it is answered, cancelled or expires.

Everyone signed in has a Party. Alone, you are the **Party host** of a party of one, with a
**Party code** of your own. The host is the earliest-joined member, the same rule as a Lobby's host
(`resolveHostId`). When the host leaves or drops out, the next-earliest member becomes the host. The
design has no way to hand the lead over, so there is none.

### Only the host moves the Party, and the Party goes wherever the host goes

- **The host queues and everyone follows** (the user's choice). A member's FIND A MATCH and PLAY
  AGAIN are disabled, with a kicker that says whose call it is.
- **Everywhere** (the user's choice): Quick Match, PLAY AGAIN, creating a private Lobby, joining one
  by code, JOIN on a friend's Lobby, and accepting a Lobby invite. The SURVIVAL tile (ticket 15)
  joins them when it is built. A Lobby without room for the whole Party refuses, with the reason. It
  is never split.
- **PLAY waits for everyone** (the user's choice). The host's PLAY reads WAITING FOR <name> while
  any member is still in a Lobby, a Match or its results. Once every member is back in the menus it
  reads PLAY AS A PARTY · N BEANS READY. Nobody is pulled off a podium, and the host can remove a
  straggler.
- **The host leaving the Party's Lobby before its Match starts takes the Party out** (the user's
  choice). Members go back to the menu, with a flash naming who left.
- **A member going somewhere alone** (the user's choice): entering a different Lobby leaves the
  Party, with a flash. Stepping out of the Party's own Lobby keeps you in the Party, back in the
  menu. Nothing is blocked.
- **A member accepted while the Party sits in a Lobby** follows the host into it if there is room
  and the Match has not started. Otherwise they wait in the menu for the next PLAY.

### Who can join

- **The host invites friends, and recent players too** (the user's choice): the card's ONLINE, RECENT
  and ALL tabs. Pasting a bean's friend code into the card's search invites that bean. Offline beans
  and beans in another Party of two or more are BUSY and cannot be invited. A bean still in a Match
  can be (IN A MATCH · CAN STILL JOIN). They join the Party at once, and PLAY waits for them.
- **Anyone with the Party code joins** (the user's choice), for ten minutes (`PARTY_CODE_TTL_MS`),
  after which the host is shown a new one. The code is six characters from the friend-code alphabet.
  It works through SHARE LINK (`/party/<code>`, which joins after signing in) and when pasted into
  the joiner's own INVITE FRIENDS search. PlaySelect's JOIN PRIVATE LOBBY stays for Lobby codes only.
- **Joining another Party leaves your own.** Accepting an invite or a code is an explicit act, and it
  cancels your own pending invites.
- Party invites expire after five minutes (`PARTY_INVITE_TTL_MS`, the Lobby invite's own TTL). The
  invitee's decline, the host's cancel and expiry all take the pending slot out of the strip at once.

### A Party lasts while its members are online

The user's choice. A Party lives in the API's memory (`PartiesService`, beside `LobbiesService`),
never in SQLite, because everything it coordinates (Lobbies, voice rooms) is in memory too and dies
with the process. A member whose game has been closed for `PARTY_OFFLINE_GRACE_MS` (90 s, the online
window friends presence already uses) drops out. An API restart ends every Party, as it ends every
Lobby.

### One Account socket carries it all, instantly

The user's choice, over polling. Each signed-in client keeps one **Account socket**, a WebSocket to
the API at `/account` (online, `/api/account` through the same proxy the Lobby sockets use),
authenticated by a first `auth` message carrying the session token, as a Lobby socket is (never in
the URL). Over it the API pushes, the moment they change:

- the Party (members with their look and level, pending invites, the code and its expiry, where each
  member is);
- Party invites, arriving and gone;
- Lobby invites (the same `lobby_invites` rows, now pushed when created, with any undelivered ones
  pushed on connect);
- **follow**: "go to this Lobby, with this reservation";
- **left**: "the host left the Lobby";
- **removed**: "<host> removed you".

The client says one thing back: **where it is** (`menu`, `lobby` or `match`). `match` covers
everything from LOADING to leaving Rewards. That is what READY, WAITING FOR and the host-left rule
read.

The Account socket replaces the client's heartbeat. While it is open, the API records the Account's
presence beat itself every 30 s, so beans online and friends presence (ADR 0110) mean what they
meant, with one writer instead of four. `POST /friends/heartbeat` and every client call to it are
deleted. That fixes the lost-invite bug at its source: one owner, and nothing drained by a Screen that
does not show it.

An Account has one Account socket. A newer one (a second tab) takes over, and the older one is
closed with a reason its tab shows and does not reconnect, as ADR 0090 does for a Lobby seat.

Actions stay HTTP routes under `/party`, authenticated like every other API route and layered
controller → service (ADR 0058): invite, cancel, accept, decline, join by code, look a code up,
leave, remove, and the invite card's candidates. The socket only tells.

### A Lobby reserves the seats a Party is walking into

When the broker sends anyone signed in into a Lobby (a party of one included), it first asks that
Lobby's Match server for a **Reservation** per member. This is one atomic
`POST /reservations {accountIds}` on the Match server's own HTTP port, beside `/status`, guarded by a
secret the `LobbiesService` generates per process and hands to each Match server it starts. The
Match server grants all or none. It refuses when it is not in LOBBY, when a `start` has been
requested, or when its live sockets plus live reservations leave no room.

- A reservation lasts `SEAT_RESERVATION_TTL_MS` (15 s). It counts as taken in the capacity check and
  in `/status.playerCount`, so a stranger cannot take it and "N SLOTS OPEN" stays honest.
- A member's client connects with `?reservation=<token>`, which uses the reservation up.
- **A Lobby with live reservations cannot start.** The reason is on `startBlockedReason` (waiting for
  beans still arriving), the same field that already disables the host's Start. So nobody following
  their host lands as a spectator.
- Quick Match tries the open public Lobbies in order and takes the first that grants the whole
  Party, otherwise a fresh one. A code or JOIN into a Lobby without room is a 409 that says so.

This supersedes nothing. It closes the broker's stale-count and just-started races for every
signed-in entry. Ticket 15's auto-start must treat a reservation as a bean that is present but not
ready.

### Where it is shown

- **The main menu wears the Party while it is active**: `PartyStrip` along the bottom, where the
  stat tiles are, as in the Party mock. A Party is **active** once it has a second member or an
  invite out. Alone, the menu keeps its stat tiles (BEST SURVIVAL, WINS, GRABS BROKEN). This was the
  user's call after the first build replaced the tiles outright, which left two of those stats on no
  Screen. A member sees `<HOST>'S PARTY`, "Only the host can invite or remove beans." and WAITING FOR
  HOST slots. The host sees the code, INVITE FRIENDS and a × on every other bean. PLAY's kicker is
  the mock's: PLAY AS A PARTY · N BEANS READY in a Party, QUICK MATCH · N BEANS ONLINE alone.
- **A lone player starts a Party from the Friends screen** (the user's choice). Opened from the
  menu, its INVITE and INVITE ALL ONLINE send Party invites, where before they dead-ended at "Join a
  Lobby first". Opened inside a Lobby (ADR 0110), they stay Lobby invites. The first invite makes the
  Party active, and the strip, with its code and the invite card, takes the tiles' place.
- **The menu's hero draws every member's bean** (the user's choice), up to four, each in its own
  Colour or Skin and Hat, changing as members come and go.
- **INVITE FRIENDS opens the mock's invite card** over the menu, its rows computed by the API.
- **PlaySelect's BRINGING is real**: your face and your members'. "N friends in your party", and the
  title counts `lobbySize − partySize` strangers.
- **A Party invite** is the global alert stack's dark invite toast, kicked PARTY INVITE, with JOIN
  and ×. Being removed is the mock's toast, "X REMOVED YOU FROM THE PARTY".

### What voice chat reads

`PartiesService` answers which Party an Account is in, and tells a listener when that changes.
ADR 0111's worker takes each seat's Party from there, on the API's main thread, never from a client.
Wiring PARTY into voice is ticket 17's. This ADR only provides the answer.

## Consequences

- The API gains its first push channel to a client, and one more always-open socket per signed-in
  player. The client gains one owner for everything social that arrives unasked.
- `POST /friends/heartbeat` is gone. Presence beats are written by the API for each open Account
  socket. ADR 0110's definition of beans online (a beat younger than 90 s) is unchanged. Only who
  writes the beat changed.
- Every broker entry by a signed-in caller is party-aware and reserves its seats. Resolving a Lobby
  by code or id becomes a `POST`, because it now reserves.
- The Match server gains a second HTTP route, guarded by a per-process secret, and a start blocker.
  `/status` still has no guard of its own (see the risk below).
- A Party is gone after an API restart. That is accepted, because Lobbies are gone too.
- Known and left alone: a Match server's `/status` port is published by Docker (51000–51099) and
  answers anyone, seated Account ids included, even though its comment says it only answers
  localhost. That is not this ADR's to fix, and it is flagged separately.
