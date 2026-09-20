# 17 — Voice chat

**What to build:** Voice chat OFF / PARTY / ALL, relayed by our own server (**ADR 0111**, settled with
the user in three question rounds on 2026-09-19; research in `docs/research/voice-chat.md`). Opus over
its own WebSocket to a relay in a worker thread of the API; push-to-talk on V with an open-mic choice;
a voice placed at its Character in a Round; mutes on the Account, set in the pause sheet; the setting
on Settings → AUDIO (not GAMEPLAY, as this ticket first said). ADR 0110.

**Blocked by:** 16 for PARTY only. Everything else is built first, with the scope Toggle offering
OFF / ALL until Parties exist. 13's pause sheet is done on tests; 17 extends it (the voice rows, and
opening on the Lobby and Standings Screens), so coordinate with the session that owns 13's files.

**Status:** done on tests (2026-09-20). Every checklist item is built and green; nothing about voice
has ever made a sound in this repo, so every listening and visual check below is the user's.

- [x] Bindings: the API's `toBindings` and the client's `readStoredBindings` stop rejecting a record
      for a missing action; then `talk` on `KeyV`, with its CONTROLS row
- [x] The link rule as a pure function in `packages/shared` (OFF / ALL now, PARTY with 16)
- [x] The voice worker: its own port, bearer-token auth to an Account seated in a Lobby, never a seat;
      rosters from the main thread over a `MessagePort`; binary frames stamped with the sender, capped
      in size and rate; mutes applied; the room kept past the Match's end until its members leave,
      capped by a timeout
- [x] Routing: nginx `/api/voice/` straight to the worker's port; the API's upgrade handler forwards
      `/voice` where there is no nginx; `docker-compose.yml`
- [x] The client voice session, above the routes (Lobby → Rounds → Standings → MatchOver): capture
      through an `AudioWorklet`, WebCodecs Opus encode/decode, a jitter buffer per speaker, playback on
      the shared `AudioContext`
- [x] Talking: the app-level push-to-talk listener (text fields, `blur`, mouse only under pointer
      lock); open mic with a fixed gate (threshold and hang time as tuning constants); the microphone
      asked on the first press, then open for the visit; Flash messages for refusal, no microphone, an
      insecure origin and an unsupported browser
- [x] ALL resets to PARTY on joining a public Lobby
- [x] Hearing: placed at the Character in a Round (equal-power, falloff to a floor) through a
      `GameConfig` sink, flat elsewhere; MASTER × VOICE
- [x] Speaking: edges from frames arriving; the go ring on Avatars and nameplates; the HUD row of
      speakers
- [x] Mutes on the Account (API), sent to the worker; the rows in the pause sheet; the MUTED chip on a
      Lobby card; the pause sheet opening on the Lobby and Standings Screens
- [x] Settings → AUDIO: VOICE CHAT (the scope Toggle, captioned with the live talk mode), TALK, VOICE
      volume; `SettingsAudio.test.tsx`'s "no VOICE CHAT" flips
- [x] `CONTEXT.md` terms (done with the ADR)
- [x] Tests: the link rule, the read-path fix, the worker's auth/relay/caps/mutes/podium room, the jitter
      buffer, the gate, the settings

**Waiting on the user, once built:** echo with speakers on each browser, latency on a lossy link, the
placed voice's falloff, the open-mic gate, a Bluetooth headset, and every cue's look.
