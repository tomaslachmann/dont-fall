# 17 — Voice chat (design open)

**What to build:** Voice chat OFF / PARTY / ALL, in the pause menu and Settings → GAMEPLAY. The
user's choice, ADR 0110.

**Blocked by:** 13, 16

**Status:** planned — **settle with the user first**, then write its ADR

Open questions:
- Transport: a WebRTC mesh signalled over the Lobby socket, or a media server? A TURN server for
  players behind strict NATs (the online stack is Docker, ADR 0108)
- Open mic or push-to-talk, and which key
- Per-Player mute, and who is speaking on screen
- Spatial (placed at the Character) or flat
