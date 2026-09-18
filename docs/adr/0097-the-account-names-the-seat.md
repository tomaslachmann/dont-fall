# 0097 — The Account names the seat

## Context

The user, on 2026-09-18, asked for a pass over dead and vestigial code and
named the example:

> najit stary nepouzivany kod jako treba setNickname

`setNickname` was a `ClientMessage`, a server handler in `lobby.ts`, a method
on `GameHandle`, a method on `LobbyConnection`, a method on the
`useLobbyConnection` hook, a prop on `<Lobby>` and a `useEffect` inside it —
seven layers to carry one string.

What that string was: the Account's own `displayName`. ADR 0052 made signing in
mandatory, so the Lobby's nickname *input* went, and the effect that replaced
it read `account.displayName` and sent it the moment the roster came back with
a name that did not match. The server's own comment on the handler still said
"any connected Player may send this at any time" — a rule written for a text
box that no longer exists.

It was not, however, deletable on its own. The socket's `auth` handler resolves
a token against the API's `/auth/me` and kept `{ accountId, color, skin, hat }`
— not the display name. That round trip was the roster's only source of a real
name; without it every seat reads `"Player"`.

## Decision

**The seat is named by the Account the socket authenticates as, and by nothing
else.** `ResolvedAccount` gains `displayName`, parsed from the same `/auth/me`
response that has always carried it, and the `auth` bind sets the Lobby row's
nickname from it — trimmed, and capped at `NICKNAME_MAX_LENGTH`, because a
display name has no length limit of its own on the API.

**`setNickname` is deleted end to end**: the `SetNicknameMessage` interface and
its place in the `ClientMessage` union, the `lobby.ts` handler, and all five
client layers.

A resolution that carries no display name (an older API, a hand-made mock)
leaves the seat on the name it joined with, exactly as a failed resolution
leaves it anonymous. Auth stays enrichment, never a gate.

## Consequences

- One fewer client message, and one fewer thing a client can assert about
  itself. Before this, any connected socket could rename its seat to anything
  at any time in any phase; now a seat's name is whatever the API says the
  Account is called.
- The name now arrives on the `auth` round trip instead of a beat later, so a
  roster row no longer flashes `"Player"` and then corrects itself — it is
  `"Player"` only until the bind lands, which is the same instant the colour,
  skin and hat land.
- Three server tests changed from asserting the message to asserting the
  outcome. `"truncates and trims a nickname"` became `"names the seat from the
  Account's own display name, trimmed and capped"` and signs up with a long
  name to prove the cap; the bad-token test proves the socket survived with
  `setReady` instead of `setNickname`, and now also asserts that a refused
  token names nobody. Two `<Lobby>` tests collapsed into one that checks the
  Screen shows the roster's name and offers nothing to type.
- Changing a display name mid-Match does not rename the seat: the bind happens
  once, on `auth`. That was already true of colour, skin and hat, and nothing
  in the game lets you change your name mid-Match anyway.
