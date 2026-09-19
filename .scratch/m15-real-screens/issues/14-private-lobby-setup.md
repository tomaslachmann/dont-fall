# 14 — A private Lobby is set up where it is created

**What to build:** PlaySelect's CREATE PRIVATE LOBBY sends its ROUNDS and WHO CAN JOIN. **FRIENDS**:
the host's friends see the Lobby (Friends, PlaySelect's FRIENDS IN A LOBBY) and join with one click,
and the code works for anyone. **INVITE ONLY**: a code or an invite, and friends are not shown it as
joinable. The user's choice, ADR 0110.

**Blocked by:** 07

**Status:** planned

- [ ] `POST /lobbies` takes `matchLength` and `privacy` and knows the creating Account
- [ ] The Lobby starts with that Match length (the stepper's range is `MIN/MAX_MATCH_LENGTH`)
- [ ] Friends presence shows a FRIENDS Lobby as joinable and never an INVITE ONLY one; joining a
      friend's FRIENDS Lobby needs no code
- [ ] Tests: both privacy modes, the initial Match length
