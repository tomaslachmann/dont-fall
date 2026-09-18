# 0105 — Every Track is known before a loader shows it

## Context

The user, on 2026-09-18, after playing: the game's waits were "blank screens
Loading Track… — a white screen with the base font, nothing from our design".
Three faults stacked:

- The waits (`LoadingScreen`, the session check, signing in) sat on the old
  kit's `Screen`, a flat surface, with a type token (`--df-type-body`) the
  design never defined, so the text fell back to the browser's font.
- `<GameCanvas>` starts with no Lobby snapshot of its own. Until the game
  module had loaded and raised one, it did not know which Track the Round was
  on, so the first loader had no name and no art. Then the name arrived as the
  Track's id, then its real name (a full Track fetch), and the screenshot
  popped in last.
- The four code-authored Tracks (Spin Cycle, Slip Stream, Cog Arena, Sky
  Rings) had no Thumbnail at all, so their loaders and cards never had art.

The user's ask: have every Track's name and picture loaded before any of it is
needed, so every screen is a designed one, and give the authored Tracks their
pictures. Settled in a question round the same day.

## Decision

**The catalogue and every Thumbnail load right after sign-in, before the Main
Menu shows.** The session check's wait holds on until the Track listing is in
and each listed Thumbnail has decoded (or failed). The decoded images are kept
for the whole visit, so nothing that shows one later waits for it. A Track that
shows up later (a new publish, picked in the Lobby) is preloaded the moment
the listing refetches. Nothing here ever blocks forever: a failed listing or
image falls through to ADR 0085's fallbacks.

**Thumbnail URLs are Revision-pinned.** `TrackListing` carries the latest
`revision`, and every client image reads `/tracks/:id/thumbnail?revision=N`.
That response is immutable and cached forever (ADR 0085), and a republish gets
a new URL of its own. Preloading a "latest" URL that revalidates every 30 s
would not have been a real preload.

**The Round loader knows its Track from its first frame.** `<GameCanvas>`
falls back to the route's own Lobby snapshot (the one that handed the socket
over, ADR 0056) until the game raises its own. The name comes off the
preloaded listing, not the full Track fetch.

**Every wait is the design's.** No mock has a loading screen, so the waits are
composed from pieces the mocks have (the user approved the composition):

- **The Round loader**: a Stage on the Lobby's background, with the Track's
  screenshot as the Stage's own field, under a plate-coloured scrim as its
  sheen. It shows
  `ROUND n OF m`, the Track's name in the display face at headline size, the
  mode `Chip`, and a glass `Chip` with a status dot that says what it waits on
  (`LOADING TRACK…`, `WAITING FOR PLAYERS 3/4`).
- **Every other wait** (session, sign-in, connecting to the Lobby, results,
  beans, saving): the menu's Stage (`--df-stage-menu`, `--df-sheen-menu`), the
  Logo, and the same glass status chip.

The old kit's `Screen` leaves these waits.

**Design slots marked "EXISTING TRACK THUMBNAIL" show the real one.** These
are the Lobby's Round rows and BetweenRounds' next-up card (Discover already
did). They show the image when the Track has one and keep the stripes when it
does not.

**The code-authored Tracks carry their own Thumbnail, as the base race
does.** Each is `assets/<id>.jpg`, rendered from a camera written beside the
render page in the Track builder (`thumbnail.html`, driven by
`pnpm render:thumbnails`). `pnpm publish:tracks` sends it with the Track.

This amends ADR 0085 twice:

- Its note that code-owned Tracks have no Thumbnail no longer holds.
- It rejected a headless render because a fixed camera frames badly. These
  cameras are not fixed. Each is framed per Track, by whoever wrote the
  Track, and the render is looked at before it is kept.

## Considered options

- **Preload on entering the Lobby.** Offered and declined: the Main Menu
  showing a moment sooner is worth less than never seeing a half-built
  screen.
- **The user frames the four Tracks in the builder.** Offered. The user chose
  code-framed renders, so a republish from code keeps its picture.
- **Keep the plain waits and redesign only the Round loader.** Offered and
  declined: "krásné screeny napříč vším" (beautiful screens everywhere).

## Consequences

- Sign-in takes a little longer: one listing plus one JPEG (~50–150 KB) per
  Track. Fine at today's catalogue. A catalogue in the hundreds would want the
  preload limited to what the Lobby can pick.
- `TrackListing` grew a field (`revision`), and every consumer building one in
  a test grew it too.
- Re-rendering an authored Track's picture is a script run plus a look at the
  result. A publish then carries it, as a new Revision like any other edit
  (ADR 0032).
