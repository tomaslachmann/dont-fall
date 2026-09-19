# 05 — Every avatar is the Player's own

**What to build:** A Player's avatar is a picture they upload in Settings → ACCOUNT; without one,
their Discord picture; without that, the design's striped disc in their bean's Colour. Every small
`Avatar` shows it — never a hash of an id onto five gradients (`lib/avatarSkins.ts:12`). ADR 0110,
the user's answers on 2026-09-19.

**Blocked by:** —

**Status:** done on tests (2026-09-19) — PlaySelect's party and friends-in-a-Lobby faces wait on 07 / 16

- [x] API: an uploaded picture per Account (a WebP of at most ~200 KB, accepted by its header only),
      `PUT /auth/me/avatar` and `DELETE /auth/me/avatar`
- [x] API: `GET /avatars/:accountId` serves the upload, else redirects to the Discord picture, else
      404; cacheable, with a version so your own new picture shows at once
- [x] Client: the browser crops a PNG / JPG / WebP to a centred square, scales it to 256×256 and
      sends WebP
- [x] `Avatar` takes an Account id (or none) and a Colour: the picture, and the Colour disc when
      there is none or it fails to load
- [x] Settings → ACCOUNT, replacing its placeholder: the avatar with UPLOAD / REMOVE, the name,
      Discord, LOG OUT — composed from the mocks' rows, pills and `Avatar`
- [x] Every surface: Lobby roster, Countdown line, RaceHUD threat, SurvivalHud survivors,
      Spectator (followed, runners, ticker), BetweenRounds / Scoreboard rows, MatchOver, Friends,
      FriendAlerts, MainMenu. PlaySelect's faces are mock rows until 07 (friends in a Lobby) and
      16 (party) give them Players
- [x] `skinForPlayerId` is deleted
- [x] Tests: upload validation, the fallback order, each surface's Account id

## As built

- `account_avatars` holds the WebP bytes; `accounts.avatar_uploaded_at` is the version. `GET
  /avatars/:accountId` serves the upload (immutable when `?v=` matches), else 302s to the Discord
  picture, else 404s, each cached a minute otherwise. Public, like the Lobby roster.
- The client never carries a picture URL on the wire: `avatarLook(accountId, color, version?)`
  builds the address from the Account id every surface already has (`LobbyPlayer.accountId`,
  `PersistedMatchResult.accountIds`, friend views). Only your own surfaces (MainMenu, Settings) add
  the version, so a new upload shows there at once; anyone else's may lag a minute.
- Friend views gained the friend's `color` (and `fromColor` on requests and invites) for the disc;
  the betting ticker's `recentBets` gained the bettor's `accountId`.
- `ui/Avatar` takes a `look`: the design's striped disc in `stripesFor(color)` (Character Select's
  pairs, now `lib/bodyColors.ts`), the picture over it, and the disc alone once the picture fails.
- Settings → ACCOUNT: AVATAR (UPLOAD, REMOVE when there is one), NAME, DISCORD (linked or not —
  linking from the browser does not exist yet, since the authorize route needs a bearer header a
  navigation cannot send). LOG OUT stays in the sidebar, which now shows the real level; DONE goes home.
- The crop and scale happen on a canvas; a browser that cannot encode WebP (older Safari) is told
  so rather than sent a PNG the API would refuse.
