# 0111 — Voice chat is relayed by our own server

## Context

ADR 0110 settled one thing about voice chat: it is **OFF / PARTY / ALL**, where PARTY is your party
(ticket 16), set in the pause menu and in Settings. It left the rest open, and M15 ticket 17 listed the
questions: the transport and a TURN server, open mic or push-to-talk, per-Player mute and who is
speaking, spatial or flat.

The user, on 2026-09-19: "co treba 17 teď" (what about 17 now). A research pass read the Lobby socket,
the Docker stack, the audio engine and the mocks, and the outside sources, and a second pass checked
its claims (`docs/research/voice-chat.md`). Three facts shaped every option:

- **The Codespace forwards only HTTPS/WSS** (ADR 0108). No UDP port, no raw TCP. So neither a TURN
  server nor a media server can live inside the stack; any WebRTC design needs a relay outside it for
  Players behind strict NATs.
- **Every Lobby's Match server runs in the API's one process** (ADR 0054/0058), on the event loop whose
  Tick timing ADR 0109 has just tuned, and the API's upgrade proxy copies every Lobby socket's bytes on
  that loop.
- **The design already speaks.** The mock pause sheet has VOICE CHAT, OFF / PARTY / ALL, initial PARTY
  (`test_components/src/screens/SettingsModal.tsx:20`). The mock Settings has VOICE CHAT on the AUDIO
  tab, captioned "Push to talk · V" (`test_components/src/screens/Settings.tsx:74-81`).

The research recommended Cloudflare's hosted SFU. The user answered three question rounds the same day
and chose otherwise on the transport. Every choice below marked "the user's" is one of those answers.

## Decision

### Opus over our own WebSocket (the user's choice)

Voice never leaves our stack. The client encodes its microphone to Opus and sends the frames over a
WebSocket; our server relays each frame to the Players who may hear it; each client decodes and plays
them.

- **Capture:** `getUserMedia` with `echoCancellation`, `noiseSuppression` and `autoGainControl`, mono.
  Samples are taken through an `AudioWorklet` on every browser, since Firefox has no
  `MediaStreamTrackProcessor` and one path is simpler than two.
- **Codec:** WebCodecs `AudioEncoder` / `AudioDecoder`, raw Opus packets (never Ogg-framed, which
  Safari's encoder rejects), 48 kHz mono, 20 ms frames, at a voice bitrate kept as a tuning constant.
- **Playback:** a small adaptive jitter buffer per speaker, feeding the page's one `AudioContext`
  (ADR 0087). TCP loses nothing, it only delays, so there is no loss to conceal: a late burst is caught
  up by dropping the oldest frames, and an empty buffer plays silence.
- **Browsers:** Chrome/Edge 94+, Firefox 130+ on desktop, Safari 26+. Elsewhere voice chat says it is
  unavailable in this browser; the game itself is unaffected.

Why, over the SFU: it works everywhere the game already works, the Codespace included, with no
third-party account, credential or bill, and no Player's address ever reaches a stranger or a third
party. The server sees every frame, so who hears whom is enforced, not suggested. What it costs, and the
user accepted: we own the jitter buffer; TCP's head-of-line blocking adds latency on a lossy link; and
WebCodecs sets the browser floor above.

### Its own socket, in a worker (the user's choice)

- **Voice has its own WebSocket**, separate from the Lobby socket, so a burst of voice never queues
  ahead of a Snapshot (ADR 0109).
- **The relay is a `worker_thread` of the API process, listening on its own port.** A worker cannot
  take over a socket accepted by the main thread, and the API's upgrade proxy copies bytes on the main
  loop. So in the online stack **nginx routes `/api/voice/` straight to the worker's port**, and no
  voice byte crosses the loop that runs every Lobby's Ticks. Where the API runs without nginx, its own
  upgrade handler forwards `/voice` to the worker, as it forwards `/match/<port>`; there the bytes do
  cross the main loop.
- **A voice socket is never a seat.** It authenticates with the Account's bearer token (the one the
  Lobby socket's `auth` already carries) and joins the voice room of the Lobby that Account is seated
  in. One seat per Account (ADR 0090) makes that Lobby unambiguous. No Account, no voice.
- **The main thread tells the worker who is in each Lobby** (Account ids, and each seat's Party once
  ticket 16 exists) over a `MessagePort`, whenever the roster changes. The worker never reads a Match.
- **Frames are binary**, with a small header; the worker stamps the sender itself and caps each
  sender's frame size and rate, dropping what exceeds them.

### Who hears whom

- **Two Players are linked**, meaning each hears the other, when **neither is OFF** and **either they
  are in the same Party or both chose ALL**. The rule is symmetric: nobody hears someone who cannot hear
  them back. **OFF** is neither sending nor hearing, not "listen only".
- The rule is one pure function in `packages/shared`, and the worker applies it to every frame.
- **The scope is one setting per device, PARTY by default** (the mock's own initial; the user's
  choice).
- **ALL resets to PARTY on joining a public Lobby** (the user's choice). An ALL picked for friends in a
  private Lobby never carries into a Lobby of strangers. The client knows which kind it joined from its
  own route.
- **PARTY waits for ticket 16** (the user's choice). Everything else here is built first. Until
  Parties exist, the scope Toggle offers **OFF / ALL** and defaults to OFF, which is exactly what PARTY
  without a Party would do: nobody is heard until both sides pick ALL. A PARTY that links to nobody
  would be a control with nothing behind it (ADR 0110). When 16 lands, PARTY is added and becomes the
  default.

### Talking (the user's choices)

- **Push-to-talk by default, on V**, the mock's own caption. `talk` is a new rebindable action. It is
  not a sim input and never reaches `sampleInput`; **Key bindings** stops meaning only gameplay
  actions. Before it is added, the two bindings read paths (the API's `toBindings`, the client's
  `readStoredBindings`) stop rejecting a stored record for a *missing* action, or adding `talk` would
  reset every saved custom layout.
- **Open mic is a choice**, in a TALK row: PUSH TO TALK / OPEN MIC. Open mic sends while an automatic
  gate is open: a fixed level threshold with a short hang time, both tuning constants, over the
  browser's noise suppression. There is no sensitivity control.
- **The listener is app-level**, owned by the voice session, so it works on the Lobby Screen, in a
  Round, on Standings and on the podium. It ignores keys while a text field has focus, stops sending on
  window `blur`, and counts mouse buttons only under pointer lock, like `PlayerInput`.
- **The microphone is asked for on the first press** (or on choosing OPEN MIC), never on joining.
  Hearing needs no microphone. **Once granted it stays open for the rest of the visit** and closes when
  the Player leaves, so no first syllable is clipped. The browser's microphone indicator stays lit and
  some Bluetooth headsets drop to their hands-free profile while it is open; the user accepted both.
  Nothing is encoded or sent while the Player is not talking.
- Refusal, no microphone, an insecure origin and an unsupported browser each get a Flash message
  saying what happened and what to do.

### How long voice lasts (the user's choice)

From joining a Lobby, through every Round and every Standings, **until the Player leaves the MatchOver
podium**. The Lobby and its socket close with the Match (ADR 0059), but the voice room does not: when
the Match ends, the worker keeps the room with the Match's last members until they leave it, capped by
a timeout. The client's voice session lives above the routes, so the navigation to `/match/:id` does
not end it. A Playtest and free-roam practice have no voice.

### Hearing (the user's choice)

- **In a Round, a voice is placed at its speaker's Character and never silenced**: equal-power
  direction, and a distance falloff that stops at a floor, so a far voice is quieter but never lost. On
  Screens, and for a speaker with no live Character (a spectator, an eliminated Player), it is flat.
- The chain lives outside the Stage, on the shared `AudioContext`, like music (ADR 0087). Positions
  reach it once a frame through a sink passed in `GameConfig` (ADR 0008), never through React.
- **A VOICE volume** joins the AUDIO sliders (the user's choice), applied as MASTER × VOICE by the voice
  chain itself, outside the Stage engine's bus loop.
- Your own voice is never played back to you.

### Speaking and mute (the user's choices)

- **Speaking is frames arriving.** With push-to-talk and with the open-mic gate, a Player's frames flow
  only while they talk, so the cue needs no level analysis: it starts on the first frame and ends a
  short while after the last. Only those edges reach React (ADR 0088).
- The cue is built from the mocks' pieces: a go-coloured `Avatar` ring wherever a row or card carries
  that Player, the same cue on their nameplate, and in a Round a row of whoever is speaking, shaped
  like the Survival HUD's avatar row, since nameplates can be off or out of view. The cue is always on.
- **A mute** silences one Player for the one muting, and only for hearing. It is **stored on the
  Account**, keyed by Account id, so a muted Player stays muted in every later Match. The worker stops
  sending a muted Player's frames to the Player who muted them.
- **Mutes are set in the pause sheet**, one row per linked Player under its VOICE CHAT row. **The
  pause sheet opens with Esc on the Lobby and Standings Screens too**, in place like the Friends sheet,
  so voice and mutes are reachable while the socket stays up; leaving for `/settings` never is the way.
  A muted Player's Lobby card shows a MUTED chip.

### Settings (the user's choice)

On **AUDIO**, where the mock and ADR 0110 put it (ticket 17's "GAMEPLAY" is corrected):

- **VOICE CHAT**, drawn as the pause sheet's scope Toggle, since a Switch cannot say PARTY or ALL. Its
  caption shows the live talk mode: "Push to talk · V" with the bound key, or "Open mic".
- **TALK**: PUSH TO TALK / OPEN MIC.
- **VOICE**, a volume slider beside the others.

Per device, like the rest of AUDIO and the pause sheet's rows. The AUDIO row and the pause sheet's row
read one store.

### Safety with strangers (the user's choice)

ALL needs both sides; ALL resets on joining a public Lobby; no address leaves our server; mutes are
remembered; the speaking cue is always on; only a seat bound to an Account has voice. **Not built, as
the user's accepted risk:** reporting, recording, a block beyond a mute, a host-wide mute, and any age
check (Accounts carry no age).

## Considered options

- **Cloudflare's hosted SFU, with its TURN** (the research's recommendation). Better media under loss
  (UDP, in-band FEC), one upload per client, addresses hidden from other Players. Rejected by the user:
  a usage-billed third-party account with two credentials, voice needing outbound internet even
  locally, and every Player's voice and address passing through a third party.
- **A WebRTC mesh with a hosted TURN.** Eleven uploads per client at 12 Players, every stranger learns
  your address unless every pair is relayed, and the TURN still sits outside the stack.
- **A self-hosted SFU and coturn.** Needs UDP and a public address, so it cannot run in the Codespace
  and would leave ADR 0108's hosting.
- **Voice on the Lobby socket, or relayed on the main thread.** Less code, but a voice burst would
  queue ahead of Snapshots, or the fan-out would share the Ticks' loop.
- **Voice through plain `<audio>` elements, flat.** Weighed in the research to avoid Chrome's handling
  of remote WebRTC audio in Web Audio. Moot here: there is no WebRTC stream, and decoded audio goes
  straight into Web Audio.
- **Default OFF, or ALL; ALL only in private Lobbies; ALL that sticks; report and recording.**
- **The microphone opened per press, or a Setting choosing when; a sensitivity slider; true
  proximity; flat voice everywhere; mutes for one Match; muting by clicking a Lobby card.**

## Consequences

- **Key bindings** gains an action that is not a sim input, and its read paths stop resetting a
  record that lacks one.
- The API process gains a voice worker with a port of its own, and nginx a route to it.
- The pause sheet, built by ticket 13 for a Round only, also opens on the Lobby and Standings Screens.
- The client's voice session outlives the Lobby socket, through the MatchOver podium.
- The Account gains its mutes.
- PARTY arrives with ticket 16, which must also give the worker each seat's Party.
- `CONTEXT.md` gains **Voice chat**, **Voice chat scope**, **Push-to-talk**, **Speaking**, **Mute** and
  **Voice link**, and **Key bindings** stops saying gameplay actions only.
- **Live checks, all the user's:** echo with speakers rather than headphones on each browser; latency
  on a lossy link; the placed voice's falloff; the open-mic gate's threshold; a Bluetooth headset with
  the microphone open; and how every cue looks.

## As built (2026-09-20)

Four things this ADR did not foresee, each settled by building it:

- **A voice socket can beat its own Lobby's first roster to the relay.** The Match server pushes the
  roster on the main thread while the socket is already open on the worker's port, so a client can
  arrive at a room that does not exist yet. Both refusals shared close code 4001 and are opposites, so
  the reason now names which (`VOICE_REFUSED_NO_ACCOUNT`, `VOICE_REFUSED_NO_ROOM`): a dead token is
  final, a room that is not ready yet redials.
- **`VoicePeer.linked` is the link rule alone**, not "would I hear them". It started as the rule less
  the listener's Mutes, which was correct for routing and wrong for drawing: the pause sheet's Mute
  rows are built from this list, so a Muted peer would have vanished from the only list that could
  unmute them. The relay keeps `hears` (the rule **and** the Mute) for deciding who a frame reaches.
- **The jitter buffer holds no audio.** TCP loses nothing and never reorders, so the only question is
  *when* an arriving frame plays — one number, where that speaker's scheduled audio runs out. A queue
  drained on a timer would answer the same question on a clock that is not the one the audio plays on.
  A backlog past the cap re-anchors and stops the pending sources, which is this ADR's "drop the
  oldest frames to catch up", exactly.
- **Capture gets its own 48 kHz `AudioContext`.** The page's shared one (ADR 0087) runs at whatever
  the hardware gives it, and a mismatch would mean resampling every frame by hand on the main thread.
  It is opened on the first talk press, which is a user gesture, so it starts running rather than
  suspended. Playback stays on the shared context, as this ADR says.

Two smaller ones: the capture worklet is registered from a `Blob` URL rather than a bundler asset,
because the app is served from three bases (ADR 0107/0108) and a `Blob` URL is the page's own origin
by construction; and `speakingAccounts` is a *pull* on `GameConfig` beside `onVoiceScene`'s push,
because a nameplate is placed per frame and so can never come through React (ADR 0060).
