# 07 — End to end: build a track through the MCP server

**What to build:** Live verification with a real MCP client over stdio
against a real API: discover (categories → modules → detail), draft a small
Race (bulk place, sugar surfaces, course), `validate`, `screenshot`,
`publish`, then open the result in the track-builder and run one Round on it.
Proves the seam tickets 01–06 only test in slices: the tools compose into a
buildable, playable Track. ADR 0114.

**Blocked by:** 01, 02, 03, 04, 05, 06

**Status:** planned

- [ ] Real-client session builds + validates + screenshots + publishes a Race
- [ ] Published track opens in the builder and plays one Round in the game
- [ ] README: register the server in a client, `TRACK_API_URL`, tool overview
