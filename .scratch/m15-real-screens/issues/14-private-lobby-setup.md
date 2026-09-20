# 14 — A private Lobby is set up where it is created

**What to build:** PlaySelect's CREATE PRIVATE LOBBY sends its ROUNDS and WHO CAN JOIN. **FRIENDS**:
the host's friends see the Lobby (Friends, PlaySelect's FRIENDS IN A LOBBY) and join with one click,
and the code works for anyone. **INVITE ONLY**: a code or an invite, and friends are not shown it as
joinable. The user's choice, ADR 0110.

**Blocked by:** 07

**Status:** done on tests (2026-09-19)

- [x] `POST /lobbies` takes `matchLength` and `privacy` and knows the creating Account
- [x] The Lobby starts with that Match length (the stepper's range is `MIN/MAX_MATCH_LENGTH`)
- [x] Friends presence shows a FRIENDS Lobby as joinable and never an INVITE ONLY one; joining a
      friend's FRIENDS Lobby needs no code
- [x] Tests: both privacy modes, the initial Match length

## As built

- `POST /lobbies` reads `matchLength` (validated `MIN/MAX_MATCH_LENGTH`) and `privacy`
  (`friends` / `invite-only`, default invite-only), and the creator from the Bearer token. The Match
  server starts at that length (`matchLengthOverride`); the host can still change it in the Lobby.
- Presence: a private seat carries `friendsOf` — its creator for a FRIENDS Lobby, `null` otherwise.
  Only the creator's own presence shows the Lobby's ref and JOIN; an invite-only Lobby (or a FRIENDS
  one seen through anyone but its creator) reads just "in a Lobby", not joinable.
- PlaySelect's stepper runs `MIN_MATCH_LENGTH`–`MAX_MATCH_LENGTH` from `DEFAULT_MATCH_LENGTH`.
