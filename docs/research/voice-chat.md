# Voice chat: transport, who hears whom, push-to-talk, and where a voice sits

> **Decided: ADR 0111** (2026-09-19). The user settled every question below in three question
> rounds. Where the answers departed from this note, or settled what it left open:
>
> - **The transport:** Opus over our own WebSocket, relayed by a worker thread of the API, not
>   Cloudflare's SFU.
> - **Open mic** is offered as a choice beside push-to-talk.
> - **Voice lasts through the MatchOver podium.**
> - **ALL resets to PARTY** on joining a public Lobby.
> - **The microphone stays open** for the rest of the visit once granted.
>
> What follows is the research as it stood before those answers.

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs). It feeds the design discussion that M15 ticket 17 asks for
> (`.scratch/m15-real-screens/issues/17-voice-chat.md`). It is **not** a decision record:
> whatever is adopted becomes ticket 17's ADR the normal way.
>
> Written 2026-09-19, after the user asked: *"co treba 17 teď."* In English: what does 17 need
> now.
>
> **Already decided (ADR 0110, `docs/adr/0110-what-the-screens-show-is-real.md:110`):** voice chat
> is OFF / PARTY / ALL, where PARTY is your party (ticket 16). ADR 0110 counts voice chat as one of
> the four decisions still open (`:147-148`). Everything below is for the user to settle.
>
> **Line numbers** are as of 2026-09-19, re-read after review the same day. Another session is
> editing M15 files (tickets 10–14) right now, so lines in `PauseMenu.tsx`, `Settings.tsx`,
> `GameCanvas.tsx`, `MatchResultsRoute.tsx`, `lobbies.service.ts`, `friends.controller.ts`,
> `accounts.dao.ts`, ADR 0110 and tickets 13/14 may move. "WT" marks text that is only in the
> uncommitted working tree.
>
> **How claims are marked.** Codebase claims come from reading the cited lines. Outside claims come
> from the linked sources, read on 2026-09-19. Ones re-checked for this note are marked
> *(re-checked)*. *(unverified)* marks a claim with no primary source, or a source that could not be
> retrieved. *(inference)* marks my own reasoning or arithmetic.

## Recommendation

1. **Transport: a hosted SFU (Cloudflare Realtime SFU, with its TURN), signalled over the Lobby
   socket.** Each client opens one `RTCPeerConnection` to Cloudflare, sends one Opus stream, and
   receives only the streams its Match server lets it pull. The reasons:
   - The Codespace carries only HTTPS/WSS (§3.3), so no TURN server or SFU can live in the stack.
     Every WebRTC design therefore needs a relay *outside* it for players behind strict NATs, and
     Cloudflare's TURN is free when used with its SFU.
   - It hides every Player's IP address from strangers. A mesh can't do that unless every pair is
     relayed.
   - Each client uploads one stream instead of eleven at 12 Players.
   - The Match server, which already owns the roster, decides who hears whom. PARTY, ALL and mutes
     are then enforced, not just suggested.

   The cost: a usage-billed third-party account with two credentials (the SFU app's, and a TURN
   key's), and voice needs outbound internet (§4). If a third-party SFU is unwanted, the fallback
   is a mesh with Cloudflare's TURN. Opus over a WebSocket is the only fully self-contained path,
   and it means owning the most code.
2. **Who hears whom is a server rule, and it needs both sides to agree.** Two Players hear each
   other when neither is OFF and either they are in the same Party or both chose ALL. The default is
   **PARTY** in every Lobby, which is the mock's own `initial`. So no stranger hears you, and you hear
   no stranger, until both of you pick ALL (§5). Because the value is one per device, an ALL picked
   for friends carries into the next public Lobby; §5 lists the options.
3. **PARTY waits for ticket 16.** Nothing models a party yet, and the glossary forbids the word
   (§2.7). Settle 16's design first. Everything else in 17 can be built before it (§13).
4. **Push-to-talk on V** (the mock's own hint), as a rebindable Control named `talk`. First fix the
   bindings read paths, which would otherwise reset every saved layout the day `talk` is added
   (§6). Releasing the key stops the RTP stream (`sender.replaceTrack(null)`, or the encoding set
   `active: false`), not just `track.enabled = false`, which still sends silence frames (§6.2).
5. **Hearing needs no microphone.** The mic permission is asked on the first push-to-talk press,
   never on joining a Lobby (§6.4).
6. **In a Round, a voice is placed at its Character but never silenced by distance. On Screens it
   is flat** (§9). This is a feel call only live play can settle.
7. **Speaking cues and per-Player mute are built from the mocks' own pieces**: an Avatar `ring` in
   the go colour, `Row` + `Toggle` lists, a `Chip`. No new glyph is needed. Mutes are remembered on
   the Account, keyed by `accountId` (§8).
8. **One setting, on Settings → AUDIO where the design puts it.** The row keeps the mock's label
   and sub, with the live key ("Push to talk · V"). It is drawn as the pause sheet's OFF/PARTY/ALL
   `Toggle`, because a `Switch` cannot say PARTY or ALL (§10).
9. **A safety floor ships with ALL**: ALL is opt-in and both sides must choose it, IPs are hidden,
   mutes are remembered, the speaking cue is always shown, and only a seat bound to an Account can
   use voice. Reporting and recording are left out, and that is stated as the user's call (§11).

## 1. What was asked

The ticket's four open questions (`17-voice-chat.md:10-15`):

1. Transport: a WebRTC mesh signalled over the Lobby socket, or a media server? A TURN server for
   players behind strict NATs (the online stack is Docker, ADR 0108).
2. Open mic or push-to-talk, and which key.
3. Per-Player mute, and who is speaking on screen.
4. Spatial (placed at the Character) or flat.

The ticket also says: OFF / PARTY / ALL, in the pause menu and Settings → GAMEPLAY (`:3-4`). It is
blocked by 13 and 16 (`:6`). §10 shows that "GAMEPLAY" now contradicts ADR 0110's own WT text.

The briefing added more to cover: where signalling travels, what ALL and PARTY mean in who connects
to whom, the defaults for public and private Lobbies, the mic permission UX, echo cancellation
against the game's own audio, safety with strangers, and new glossary terms.

## 2. What the codebase has

### 2.1 The Lobby socket

- **JSON text frames only.** The protocol is "plain WebSocket carrying JSON… Binary encoding is
  deferred" (`packages/shared/src/net/protocol.ts:12-16`). `ServerMessage` is
  `welcome | snapshot | pong` (`:287`). `ClientMessage` has 13 members (`:448-461`).
- **Server.** `ws` is created as `new WebSocketServer({ server: httpServer })`: the attach option
  and nothing else, so no `maxPayload` (`apps/server/src/matchServer.ts:65`). Every send is
  `JSON.stringify` through `trySend`/`send` (`apps/server/src/net/wire.ts:31-41`).
- **Receiving on the server.** `wireMessages` parses inside a try/catch, drops malformed or binary
  frames, and handles `ping`, `input` and `sync` inline. Everything else goes to
  `handleLobbyMessage` (`apps/server/src/server/connections.ts:138-164`; `match/lobby.ts:36`).
- **Receiving on the client.** Three listeners call `JSON.parse(event.data as string)` with no guard
  (`lib/socket/connection.ts:79`, `lib/socket/lobbyConnection.ts:246`, `game/index.ts:239`).
  - A binary frame would throw in all three.
  - Both the Lobby's and the game's listeners ignore every type except `snapshot` / `pong`
    (`lobbyConnection.ts:245-254`, `game/serverMessages.ts:283-288`), so a new JSON message type is
    harmless to them.
- **Addressing exists, relaying does not.** `rt.sockets` is `Map<playerId, WebSocket>`
  (`apps/server/src/match/matchRuntime.ts:85`), so a message for one named peer can be delivered.
  But no handler forwards one client's payload to another today: every client message changes
  server state, which then rides the snapshot.
- **Identity.**
  - `playerId` is per connection and changes on every reconnect (`protocol.ts:24-25`).
  - `accountId` is bound asynchronously when the client sends `auth`, and stays `null` if that
    fails. "Auth is enrichment, never a start gate" (`match/lobby.ts:40-73`;
    `packages/shared/src/match/Lobby.ts:13-21`).
  - One seat per Account: a newer sign-in closes the older socket with code 4004 (`lobby.ts:21`,
    `:62-71`).
  - `welcome.sessionToken` is generated (`connections.ts:113-116`, "no reconnect logic acts on it
    yet") and never stored or read anywhere else in the sources *(re-checked by grep)*. So nothing
    today could authenticate a *second* socket as the same seat.

### 2.2 How long a Lobby visit lasts, and who is in it

- **One socket for the whole visit.** `/lobby` owns it (`screens/LobbyRoute.tsx:39-43`) and hands
  the same connection to `<GameCanvas>` when the phase leaves LOBBY (`:61-62`).
  - LOBBY, LOADING, COUNTDOWN, RUNNING, ROUND_END and RESULTS (Standings) all stay on it.
  - It closes when the route unmounts (`lib/hooks/useLobbyConnection.ts:79-84`, `conn?.close()`).
  - **It ends before the MatchOver podium.** When the Match ends, the client navigates to
    `/match/:id`, which unmounts the canvas, physics and socket (`components/GameCanvas.tsx:454-466`;
    the route at `App.tsx:81`; the podium at `screens/MatchResultsRoute.tsx:72`). The Lobby closes
    with its Match anyway (ADR 0110 `:82-83`; ADR 0059 `:30-31`). So today voice would stop before
    the podium; whether it should last through it is the user's call (§5).
  - A Playtest dials its own socket (`game/index.ts:98-106`). Free-roam practice has none.
- **`useMatchMusic` already spans Lobby and game at this level** (`LobbyRoute.tsx:42-43`). That is
  the precedent for a route-owned voice session.
- **Leaving for Settings closes the socket.** `/settings` is its own route (`apps/client/src/App.tsx:85`),
  so going there unmounts `BrokeredLobby`, and the Lobby Screen has no Settings entry anyway
  (`screens/Lobby.tsx`: only a Leave button, `:192`). The pause sheet opens only in a Round:
  `inRound` excludes LOBBY and RESULTS (`components/GameCanvas.tsx:353`, mounted at `:760-774`).
  **So today, nothing on the Lobby or Standings Screens could change a voice setting or a mute.**
- **Settings already opens in place over a Round.** The pause sheet's ALL SETTINGS mounts
  `<Settings>` without leaving the route (`GameCanvas.tsx:171-174`, `:760-774`). So the AUDIO pane
  is already reachable mid-Round with the socket up. That, beside the Friends sheet the Lobby opens
  in place for INVITE FRIENDS (`Lobby.tsx:160-168`; ADR 0110 `:78-81`), is the precedent for a
  Settings or pause entry on the Lobby and Standings Screens (§8.3, §10).
- **Spectators** (anyone who joins mid-Match) are in `rt.sockets` and the roster
  (`connections.ts:92-108`). No wire field marks them. The client infers it from their having no
  Character (`game/spectator.ts:21-22`).
- **Size.** ADR 0011 architects 12 Players (`docs/adr/0011-…md:1`, `:16`). The operational cap is
  `MAX_PLAYERS = 10`, which counts spectators and can be set per environment
  (`packages/shared/src/tuning/match.ts:82-89`; `apps/server/src/server/config.ts:140`;
  `connections.ts:25-29`). **Voice should be sized for 12.**
- **Public or private is known to the API and to the client, not to the Match server.**
  - The API's registry holds `isPrivate` and `privacy` (`apps/api/src/lobbies/lobbies.registry.ts:15`,
    `:28`, `:74`).
  - The client knows from the route (`?code=` means private, `LobbyRoute.tsx:28-29`).
  - `apps/server` has no reference to either *(re-checked by grep)*.

### 2.3 Deployment (ADR 0108)

- **nginx** proxies only `/api/`, with Upgrade headers and 1 h timeouts, on a single `:80` HTTP
  server with no `stream` block (`apps/web/nginx.conf:9-34`).
- **The API** takes the upgrade at `/match/<port>` for a port a live Lobby holds, replays the
  handshake to `127.0.0.1:<port>`, and pipes the raw bytes both ways
  (`apps/api/src/lobbies/matchSocketProxy.ts:17-41`; hooked at `apps/api/src/app.ts:134`).
- **Every Lobby's Match server runs inside the API's own process**
  (`apps/api/src/lobbies/lobbies.service.ts:70-83`). So every Lobby's tick loop, the proxy's byte
  copying and the API's HTTP share one Node event loop, in a Codespace that may have only 2 CPUs:
  `hostRequirements.cpus: 2` (`.devcontainer/devcontainer.json:15`) is a minimum machine size, not
  the machine's size.
- **docker-compose** publishes `8081` and `51000-51099`, both TCP, and `8088:80`. There is no UDP
  anywhere (`docker-compose.yml:35-42`, `:62-63`).
  - Brokered Match servers share the API's process environment. This is how `SERVICE_TOKEN` reaches
    them (`docker-compose.yml:46-50`), and voice's two credentials (§4) would reach them the same
    way.
- **Codespace.** `forwardPorts: [8088]` (`devcontainer.json:19-22`). `scripts/online.ts:71` makes it
  public with `gh codespace ports visibility`.
- **No header would block mic or WebRTC.**
  - nginx sets no `add_header`, no CSP and no `Permissions-Policy` (`nginx.conf`, whole file).
  - The API registers only `@fastify/cors` (`apps/api/src/app.ts:2`).

### 2.4 The client's audio engine (ADR 0087)

- **One `AudioContext` for the page** (`apps/client/src/audio/sharedContext.ts:8-15`), handed to
  three.js by the game (`audio/gameAudio.ts:11-15`). It is resumed on the first gesture
  (`audio/unlock.ts:7-31`; `audio/music.ts:246-270`, installed at `main.tsx:27`).
- **The Stage's engine** is `master → {effects, environment, music, ui}` (`audio/engine.ts:138`,
  `:160-168`).
  - It is rebuilt on every Track swap and faded out on dispose (`engine.ts:377-398`).
  - No Stage exists on the Lobby Screen.
  - Its `PlaybackContext` only knows buffers, gains and panners (`engine.ts:32-38`), so a
    `MediaStreamAudioSourceNode` does not fit `play`/`loop`.
- **Music is the precedent for voice.** It has its own chain on the shared context and applies
  MASTER × MUSIC itself (`music.ts:101-122`; `lib/audioSettings.ts:89`). It already routes a
  media element into Web Audio (`music.ts:69`, `createMediaElementSource`), and it has the only
  duck in the code (`music.ts:35-38`, `:50-51`).
- **Positions for a placed voice already exist every frame.**
  - `composeDraw` builds `frame.remote` from the interpolated world (`game/frameLoop.ts:269-288`).
    The Stage keeps `remoteNamed` (id, name, position; `render/scene.ts:558-565`).
  - three.js's `AudioListener` ramps `context.listener` to the camera every frame
    (`node_modules/three/src/audio/AudioListener.js:97-124`). A `PannerNode` built on the shared
    context outside the Stage is therefore panned relative to the camera while a Stage lives. With
    no Stage, the listener keeps its last pose.
  - The engine's panner recipe is `equalpower` with `linear` distance and `.value` writes
    (`engine.ts:183-198`). `linear` reaches silence at `maxDistance`.
- **Settings.**
  - AUDIO channels are `["master","effects","environment","music"]`, stored per device as
    `dontfall.audio.v1` (`lib/audioSettings.ts:7`, `:17`).
  - `applyAudioVolumes` loops over every channel and calls `engine.setVolume`
    (`audioSettings.ts:92-98`). That dereferences `buses.get(bus)!` (`engine.ts:366-369`), so
    adding a `voice` channel would throw on the Stage engine unless the loop filters it.

### 2.5 Input and Key bindings

- **The actions.** `BINDING_ACTIONS` is `forward, back, left, right, jump, dash, hit, grab,
  spectateNext` (`packages/shared/src/bindings.ts:11-21`). The defaults are at `:55-65`.
  - **`KeyV` is unbound** and bindable (`isBindableControl`, `:45-49`).
  - CapsLock is deliberately not bindable (`:40-43`).
- **The reset trap (re-checked).**
  - `invalidBindingsReason` rejects any record that is missing an action (`bindings.ts:80-82`).
  - Both read paths run it *before* the forward-compatible `resolveBindings` (`:101-110`), and
    turn an invalid record into `null`, which means defaults:
    - the API's `toBindings` (`apps/api/src/auth/accounts.dao.ts:65-73`);
    - the client mirror's `readStoredBindings` (`apps/client/src/lib/bindingsStore.ts:15-24`).
  - So adding `talk` would silently reset **every saved custom layout**. See §14 for the researcher
    disagreement on this.
- **CONTROLS rows.** `Settings.tsx` throws if its CONTROLS rows drift from `BINDING_ACTIONS`
  (`screens/Settings.tsx:139`).
- **`PlayerInput` exists only inside a running game.**
  - Its `keydown` has no guard for a focused text field (`apps/client/src/input/input.ts:24-31`).
  - Mouse buttons count only while the pointer is locked (`:35-47`).
  - Held keys clear on window `blur` (`:51-54`).
  - In LOBBY no game module runs (`LobbyRoute.tsx:61-62`), so push-to-talk cannot live there.

### 2.6 The mocks and the live Screens

| Where | What the design shows | Live today |
|---|---|---|
| PAUSED sheet (`test_components/src/screens/SettingsModal.tsx:20`) | `VOICE CHAT`, sub "Party only, or everyone", `Toggle` OFF / PARTY / ALL, **initial PARTY**. The comment at `:17` reads "Only what you'd change mid-match." | `screens/PauseMenu.tsx` has screen shake and nameplates. Its comment says "Voice chat joins them when it exists (M15 ticket 17)" (`:17-23`). |
| Settings, **AUDIO** tab (`test_components/src/screens/Settings.tsx:74-81`, state `useState(true)` at `:32`) | `VOICE CHAT`, sub "Push to talk · V", an on/off `Switch` | Removed by M14 (ADR 0087 `:66-69`). `SettingsAudio.test.tsx:52` asserts `queryByText("VOICE CHAT")` is null. |
| PlaySelect Quick Match (`test_components/src/screens/PlaySelect.tsx:136-144`) | BRINGING, three Avatars, "2 friends in your party" | Hard-coded mock data (`screens/PlaySelect.tsx:187-195`) |

- **Not in the design:** a mic or speaker icon, a speaking indicator, a mute control, a voice
  volume slider.
- **Pieces available:**
  - `Avatar` with `ring` (`ui/Avatar.tsx:14-15`). The mocks use a go-coloured ring for a joinable
    friend (`test_components/src/screens/Friends.tsx:122`) and the accent ring for "you"
    (`screens/Lobby.tsx:232`).
  - `Chip` with a `dot`, in the tones `ready`/`waiting`/`race`/`survival`/`any`/`host`/`plate`/`glass`/`out`/`closing`
    (`ui/Chip.tsx:4-12`).
  - `Switch` (`ui/Switch.tsx`) and `Toggle`.
  - `Panel` + `Rows`/`Row` (as in `PauseMenu.tsx`).
- **The Lobby card's head** is `space-between`, with the Avatar and a HOST chip
  (`Lobby.tsx:229-237`; `Lobby.module.css:99-105`).
- **Nameplates** are plain DOM placed each frame. They are hidden past 40 m, behind the camera, for
  eliminated Characters, and when the setting is OFF (`render/nameplates.ts:4-60`).
- **The old kit** (`packages/ui`) has an `ActivityDot`, whose CSS comment calls it "an honest
  substitute for 'speaking'" (`ActivityDot.module.css:1-4`). The mocks supersede that kit.

### 2.7 Parties

- **Nothing models a party** in `apps/server`, `apps/api` or `packages/shared`. Ticket 16 is
  `planned — settle with the user first`, and its four questions are open
  (`16-parties.md:9-15`).
- **The glossary forbids the word.** `CONTEXT.md:24-28` says Friend is "Distinct from a Party —
  DON'T FALL has no matchmaking concept of a party (ADR 0040)… _Avoid_: party". ADR 0110 introduces
  Parties (`:108-110`).
- **The menu has no push channel.**
  - The only client↔API traffic outside a Lobby is HTTP: the 30 s presence heartbeat
    (`POST /friends/heartbeat`, `apps/api/src/friends/friends.controller.ts:64`;
    `apps/client/src/lib/api/friends.ts:36-40`).
  - Lobby invites reach the invitee on that heartbeat, so up to ~30 s late
    (`friends.service.ts:153-183`).
  - The API has no WebSocket of its own; its only upgrade handler is the Match proxy.
- **Ticket 14 (WT) adds `LobbyPrivacy` `friends` / `invite-only`** (`packages/shared/src/social/Friends.ts:25`).
  That is "who can join", not a party.

### 2.8 Voice itself

**Not found**: no `getUserMedia`, `mediaDevices`, `RTCPeerConnection`, `MediaStream`,
`iceServers`, WebCodecs, WebTransport, mute, block or report anywhere in `apps/` or `packages/`. No
age or date of birth is stored on an Account *(re-checked by grep)*.

## 3. What outside sources say

### 3.1 Opus and bandwidth

- **libwebrtc's Opus defaults** *(re-checked)*.
  - The config struct defaults to 20 ms frames, 32 kbps mono full-band, VoIP mode, and FEC and DTX
    off ([`audio_encoder_opus_config.h`](https://webrtc.googlesource.com/src/+/refs/heads/main/api/audio_codecs/opus/audio_encoder_opus_config.h),
    FEC and DTX at `:49`, `:64`).
  - But that is only the struct. libwebrtc's default SDP format for Opus advertises
    `useinbandfec=1`, and that is mapped into the config
    ([`audio_encoder_opus.cc`](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/codecs/opus/audio_encoder_opus.cc)
    `:225-228`, `:256`). **So Opus in a browser runs with in-band FEC on.**
  - DTX stays off unless `usedtx=1` is negotiated (`:257`).
- **RFC 7587** puts full-band speech's sweet spot at 28–40 kbps
  ([RFC 7587](https://www.rfc-editor.org/rfc/rfc7587.html)).
- **Opus is mandatory to implement** for WebRTC, and endpoints "SHOULD include an AEC"
  ([RFC 7874](https://www.rfc-editor.org/rfc/rfc7874.html)).
- **On the wire** *(inference)*: IP/UDP/RTP/SRTP headers add about 20 kbps at 50 packets/s, so
  roughly **52–55 kbps per stream**. That leaves out RTP header extensions, IPv6 (+20 B/packet,
  about +8 kbps) and TURN framing, so it is a floor, not an estimate *(inference)*.
- **A disabled track still sends, in libwebrtc** *(re-checked, 2026-09-19)*.
  - The spec says the opposite: if the track "is disabled and/or muted, the RTCRtpSender … MUST
    NOT send (audio)" ([webrtc-pc](https://w3c.github.io/webrtc-pc/), `RTCRtpSender.track`). See
    §14 for how this came up.
  - libwebrtc, which Chrome and Safari's WebRTC are built on, does send. `track.enabled` becomes
    `SetAudioSend(ssrc, track_enabled, …)`
    ([`rtp_sender.cc:1441-1459`](https://webrtc.googlesource.com/src/+/refs/heads/main/pc/rtp_sender.cc)),
    which mutes the send stream
    ([`webrtc_voice_engine.cc:1640`](https://webrtc.googlesource.com/src/+/refs/heads/main/media/engine/webrtc_voice_engine.cc)).
    A muted stream's frames are zeroed and still encoded and packetized
    ([`channel_send.cc:920-941`](https://webrtc.googlesource.com/src/+/refs/heads/main/audio/channel_send.cc)).
    So silence frames go out every 20 ms. Firefox was not checked *(unverified)*.
  - With DTX off, that is the ~20 kbps of headers plus a few bytes of payload, roughly 40% of a
    talking stream *(inference, to measure)*.
  - What the spec does guarantee: "If track is null then the RTCRtpSender does not send", and an
    encoding's `active: false` "causes this encoding to no longer be sent". `replaceTrack` works
    "without renegotiation", and `setParameters` "does not cause SDP renegotiation"
    ([webrtc-pc](https://w3c.github.io/webrtc-pc/)) *(re-checked)*. So `sender.replaceTrack(null)`
    or `active: false` stops the RTP stream by the spec's own terms, without renegotiating.
    Negotiating `usedtx=1` shrinks the idle stream instead of stopping it.

### 3.2 Transports

- **Mesh.**
  - Each peer sends N−1 streams. At 12 Players that is 11 up and 11 down per client, about
    0.6 Mbps each way if everyone talks at once *(inference)*, and 66 peer connections per Lobby.
  - The only estimate found of a practical ceiling is "roughly 10 or so users" for audio-only, and
    its author says he is unsure ([bloggeek, 2020](https://bloggeek.me/webrtc-p2p-mesh/)).
  - No CPU measurement for 11 audio peer connections was found *(unverified)*.
  - Signalling over any existing channel is MDN's "perfect negotiation"
    ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)).
- **Mesh exposes IP addresses.** ICE candidate addresses "are provided to the web application so
  that they can be communicated to the remote endpoint" ([RFC 8828](https://www.rfc-editor.org/rfc/rfc8828.html)).
  So in a mesh every Player learns every other Player's public IP. Only
  `iceTransportPolicy: "relay"` hides it, and that relays every pair through TURN
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/RTCPeerConnection)).
- **Cloudflare Realtime SFU** *(re-checked)*.
  - "Your backend stores the application secret and uses the Realtime SFU API to create the
    corresponding session." "Each client creates a WebRTC PeerConnection."
  - The SFU "does not define rooms, participants, roles, or presence". Signalling and permissions
    are the app's ([overview](https://developers.cloudflare.com/realtime/sfu/)).
  - Price: $0.05/GB of egress to clients, inbound free, and **one 1,000 GB free tier shared by the
    SFU and TURN**. TURN traffic to the SFU is not double-charged
    ([pricing](https://developers.cloudflare.com/realtime/sfu/pricing/)).
  - The page says only "a free tier of 1,000 GB before any charges start" and gives no period.
    "Per month" comes only from secondary sources *(unverified)*.
  - Per-session track limits were not found *(unverified)*.
- **Cloudflare RealtimeKit** is Cloudflare Realtime's third product, beside the SFU and TURN:
  meetings and participants, web SDKs, billed per minute with no free tier
  ([Realtime overview](https://developers.cloudflare.com/realtime/)). It brings its own model of who
  is in a call, where this game's Match server already owns the roster and the link rule (§5), so
  it is probably a poor fit *(inference)*. It was not evaluated further.
- **Self-hosted SFUs.**
  - **mediasoup** is a Node library plus a C++ worker. It has no signalling of its own, and its
    `WebRtcServer` shares one UDP/TCP port with an announced public address
    ([install](https://mediasoup.org/documentation/v3/mediasoup/installation/),
    [client-server](https://mediasoup.org/documentation/v3/communication-between-client-and-server/),
    [API](https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcServer)).
  - **LiveKit** is a Go server: 7880 HTTP/WS, 7881 TCP, UDP 7882 or 50000–60000, and embedded TURN
    on 3478/UDP and 5349/TLS ([ports](https://docs.livekit.io/home/self-hosting/ports-firewall/)).
  - Both need reachable UDP (or TCP) media ports and a public IP.
  - Janus and Pion were not researched.
- **LiveKit Cloud**, LiveKit's hosted service, was not evaluated either. Its price, its free tier,
  and whether its rooms can take a server-owned link rule are all open (§4).
- **Opus over WebSocket (WebCodecs).**
  - Browser support ([caniuse](https://caniuse.com/mdn-api_audioencoder),
    [WebKit, Safari 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/),
    [Firefox 130](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/130)):

    | Browser | `AudioEncoder`/`AudioDecoder` |
    |---|---|
    | Chrome/Edge | 94+ |
    | Firefox desktop | 130+ |
    | Safari | 26+ |
    | Firefox Android | none |

  - What you would have to build yourself:
    - a jitter buffer;
    - loss concealment: there is no packet-loss-concealment API
      ([w3c/webcodecs#558](https://github.com/w3c/webcodecs/issues/558), open since 2022);
    - an AudioWorklet capture path for Firefox, which lacks `MediaStreamTrackProcessor`
      ([caniuse](https://caniuse.com/mdn-api_mediastreamtrackprocessor)).
  - Safari's encoder rejects Ogg-framed Opus and ignores `usedtx`/`application`
    ([`AudioEncoderCocoa.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/AudioEncoderCocoa.cpp)).
- **TCP head-of-line blocking.** One lost segment stalls everything behind it for at least about one
  RTT ([RFC 5681](https://www.rfc-editor.org/rfc/rfc5681)).
  - A 1 s minimum RTO is RFC 6298 (2.4)'s SHOULD ([RFC 6298](https://www.rfc-editor.org/rfc/rfc6298)).
    Linux, which runs the server here, uses a 200 ms minimum: `TCP_RTO_MIN` is `HZ / 5`
    ([`include/net/tcp.h:162`](https://github.com/torvalds/linux/blob/master/include/net/tcp.h))
    *(re-checked)*.
  - A single lost segment usually recovers by fast retransmit in about one RTT, not by a timeout.
  - So the argument against voice over TCP still holds, just less strongly.
- **WebTransport datagrams** avoid head-of-line blocking, but they run over QUIC, which is UDP
  ([caniuse](https://caniuse.com/webtransport)).
- **Latency target.** Under 150 ms one-way is "essentially transparent"
  ([ITU-T G.114](https://www.itu.int/rec/T-REC-G.114-200305-I)).

### 3.3 NAT traversal, TURN, and the Codespace

- **How often TURN is needed.**
  - In callstats.io data, 22% of conferences "need some kind of TURN relay", and about 9% needed TCP
    ([webrtcHacks, 2016](https://webrtchacks.com/usage-stats/)) *(re-checked)*. That is counted per
    conference, not per pair, over Jan 2015 to Feb 2016, so it is about ten years old.
  - In a 66-pair mesh, the chance that some pair in a Lobby needs one is higher still
    *(inference)*.
- **TURN runs over UDP, TCP or TLS.** It exists over TCP/TLS because "some firewalls are configured
  to block UDP entirely" ([RFC 8656](https://www.rfc-editor.org/rfc/rfc8656.html)). Browsers have
  no TURN-over-WebSocket, and WebRTC media is never HTTP
  ([RFC 7065](https://datatracker.ietf.org/doc/html/rfc7065), [RFC 8835](https://www.rfc-editor.org/rfc/rfc8835.html)).
- **Codespaces** *(re-checked)*.
  - "By default, GitHub Codespaces forwards ports using HTTP", and a port can be switched to HTTPS.
    A public port is `https://CODESPACENAME-PORT.app.github.dev`. UDP and raw TCP are not mentioned
    ([GitHub Docs](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)).
  - A GitHub staff answer says raw TCP on public port URLs has "currently no way"
    ([community #28528, 2022](https://github.com/orgs/community/discussions/28528)).
  - **So STUN, TURN, an SFU and WebTransport running inside the Codespace are unreachable for
    players.** `turns:` cannot ride 8088 either, since the `app.github.dev` front end routes HTTP
    *(inference from the protocol definitions, not tested)*.
- **Cloudflare TURN** *(re-checked)*.
  - Transports: UDP 3478, TCP 3478/80, TLS 5349/443, plus free STUN at `stun.cloudflare.com:3478`
    ([TURN](https://developers.cloudflare.com/realtime/turn/)).
  - Credentials are generated by the backend at
    `…/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers` with a `ttl`, and "you should keep
    your TURN key on the server side". Drop the port-53 URLs, which browsers block
    ([credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/)).
  - **The TURN key is its own credential** *(re-checked)*: a TURN key ID with its own
    `TURN_KEY_API_TOKEN`, which the docs describe as separate from the SFU app secret. The SFU with
    its TURN therefore needs two credentials: the SFU app ID and token, and the TURN key ID and
    token.
- **coturn** (`coturn/coturn`) needs 3478/5349 plus a UDP relay range, with `--network=host`
  recommended ([README](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md)). Its
  time-limited credentials follow the expired but de facto
  [TURN REST draft](https://datatracker.ietf.org/doc/html/draft-uberti-behave-turn-rest-00).
- **Google's public STUN** is fine for development with "no SLA"
  ([discuss-webrtc, 2014](https://groups.google.com/g/discuss-webrtc/c/shcPIaPxwo8)).

### 3.4 Echo cancellation against audio the page plays itself

- **Chrome desktop: yes** *(re-checked in the Chromium source, `main`, 2026-09-19)*.
  - `kChromeWideEchoCancellation` is `FEATURE_ENABLED_BY_DEFAULT` (`:1161`), with the comment "If
    echo cancellation for a mic signal is requested, mix and cancel all audio playback going to a
    specific output device in the audio service"
    ([`media_switches.cc`](https://chromium.googlesource.com/chromium/src/+/main/media/base/media_switches.cc)).
  - It is built only for `is_win || is_mac || is_linux` (`:384`), "since it requires the audio
    service to run in a separate process" ([`media_options.gni`](https://chromium.googlesource.com/chromium/src/+/main/media/media_options.gni)).
  - It also turns off if `kEnforceSystemEchoCancellation` is on (`media_switches.cc:1841-1845`).
    That flag is disabled by default (`:1546`).
  - A Chromium engineer said in 2023 that it covers audio played inside Chrome but not other apps
    ([discuss-webrtc, 2023](https://groups.google.com/g/discuss-webrtc/c/v592nFc4cO4)). **On
    current `main` that is out of date for Windows and Mac.** `kSystemLoopbackAsAecReference` is
    `FEATURE_ENABLED_BY_DEFAULT` and uses system loopback "to cancel echo from all audio processes
    and not only audio from Chrome", where process loopback capture is supported
    (`media_switches.cc:1673-1677`, `:1919-1931`; `media_options.gni:388-389`).
  - This doesn't change the decision: the game's audio plays inside Chrome either way.
- **Chrome 141 modes.** It added `echoCancellation: "all"` / `"remote-only"`
  ([blink-dev](https://www.mail-archive.com/blink-dev@chromium.org/msg14454.html),
  [spec](https://w3c.github.io/mediacapture-main/),
  [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation)).
  - **Support** *(re-checked)*: the string modes are Chrome-only, from 141. MDN's browser-compat
    data lists `remote-only` for Chrome 141, and Firefox and Safari have none.
  - The blink-dev message is an Intent to Ship for 141 on desktop, Android, WebView and iOS.
- **Firefox: yes for its default graph**, `AudioContext` included. A caveat covers graphs at a
  different sample rate ([bug 1849108](https://bugzilla.mozilla.org/show_bug.cgi?id=1849108)).
- **Safari, Chrome Android, ChromeOS: not established** *(unverified)*.
- **Two secondary sources disagree** with the Chromium source:
  [dev.to, 2026](https://dev.to/orca_forge/browser-voice-interaction-ai-pitfall-guide-2026-16-common-traps-with-aec-getusermedia-and-40hd)
  and [focused.io, 2020](https://focused.io/lab/echo-cancellation-with-web-audio-api-and-chromium).
  For Chrome desktop the source wins. Every browser still needs a speakers-on test.

### 3.5 Remote WebRTC audio into Web Audio

- **Chrome may play it silent.** Routing a remote stream through `createMediaStreamSource` is
  reported silent in Chrome unless the stream is also playing in a muted `<audio>` element. This is
  Chromium issue 933677, cited in secondary sources. A 2022 Chromium comment is said to suggest the
  0-volume `<audio>` workaround. The old `bugs.chromium.org` link now redirects to
  [issues.chromium.org/40094084](https://issues.chromium.org/40094084), which needs sign-in, so
  the issue's status is still *(unverified; test it)*.
- **The same may apply to `getSynchronizationSources()`.** One report says its `audioLevel` works
  only while the track plays through an element
  ([discuss-webrtc](https://groups.google.com/g/discuss-webrtc/c/GqojKPUt0-s)) *(unverified)*.
- **`PannerNode`** offers `equalpower`/`HRTF` panning, and `linear`/`inverse`/`exponential`
  distance models with `refDistance`, `maxDistance` and `rolloffFactor`
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/PannerNode)).

### 3.6 getUserMedia

- **A secure context is required.** On an insecure one `navigator.mediaDevices` is `undefined`.
  `https`, `localhost`, `127.0.0.0/8` and `*.localhost` count as secure. `http://<LAN IP>` does not
  ([MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
  [Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)).
  - `http://localhost:8088` works, and so does the Codespace's HTTPS address.
  - A LAN guest on `http://192.168.x.x:8088` gets no microphone.
- **Errors** come back as `NotAllowedError` / `NotFoundError`. The Permissions-Policy directive is
  `microphone`.
- **`navigator.permissions.query({ name: "microphone" })`** is supported in Chrome 64+, Firefox 132+
  and Safari 16+ (MDN browser-compat data,
  [Permissions.query](https://developer.mozilla.org/en-US/docs/Web/API/Permissions/query))
  *(re-checked)*.
- **Constraints** include `echoCancellation`, `noiseSuppression`, `autoGainControl` and
  `channelCount` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints)).
- **Caps Lock can't be a hold key on macOS**: it dispatches only `keydown`
  ([MDN KeyboardEvent](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent)). It is
  already unbindable here.

### 3.7 What other games do

| Game | Voice |
|---|---|
| Fall Guys | Party voice only, off by default (a search snippet; the help page returned 403, *unverified*: the FAQ says nothing about either). Captures the last five minutes whenever voice reporting is on. It is always on for chats that include players under 18; adults choose "Always On" or "Off When Possible" ([FAQ](https://www.fallguys.com/en-US/voice-reporting-faqs), *re-checked*). |
| Stumble Guys | No in-game voice on any platform ([FAQ](https://stumbleguys.helpshift.com/hc/en/4-stumble-guys/faq/222-is-voice-chat-supported/)). |
| Among Us | No built-in voice. Proximity voice comes from mods ([AmongUs-Mumble](https://github.com/StarGate01/AmongUs-Mumble)). |
| Valorant | Team voice is push-to-talk only, default **V**. Party voice defaults to **U**, push-to-talk by default ([support](https://support.riotgames.com/valorant/gameplay/valorant-voice-chat-troubleshooting)). |
| Fortnite | Party and Game channels. Proximity chat has a "mandatory HUD element … that shows players who are active speakers", and mute, block and report still apply ([docs](https://dev.epicgames.com/documentation/en-us/fortnite/proximity-chat)). |
| Rocket League | Open mic by default, push-to-talk optional (search snippets only, *unverified*). |
| Lethal Company / Rust | Proximity voice, push-to-talk **T** / **V** (secondary sources only, *unverified*). |

### 3.8 Safety and law

- **FTC, 2022.** The settlement with Epic made voice and text chat "turned off by default" for
  children and teens ([FTC](https://www.ftc.gov/news-events/news/press-releases/2022/12/fortnite-video-game-maker-epic-games-pay-more-half-billion-dollars-over-ftc-allegations)).
- **UK Online Safety Act.** It treats in-game voice as user-to-user content
  ([Ofcom](https://www.ofcom.org.uk/online-safety/the-online-safety-act-and-gaming-know-the-risks-know-the-rules-know-how-to-comply);
  a search snippet, since the page returned 403, *unverified*).
- **Discord accounts.** That Discord accounts are 13+ is Discord's terms, and was not checked here
  *(unverified)*. Email/password Accounts (ADR 0053) have no age check at all.

## 4. Question 1: transport

Sized for 12 Players, over both hosting paths: `localhost:8088` and the Codespace, which is HTTPS
only.

| | Mesh + Cloudflare TURN | **Cloudflare Realtime SFU** | Opus over WebSocket | Self-hosted SFU + coturn |
|---|---|---|---|---|
| Media reaches players from the Codespace | yes (peer to peer) | **yes** (Cloudflare's edge) | yes (rides 8088) | **no**: needs a VPS with UDP, leaving ADR 0108's hosting |
| Strict-NAT players | yes, via TURN | yes, TURN included | yes, it is WSS | yes |
| Other players learn your IP | **yes**, unless relay-only | no | no | no |
| Upload per client at 12 | 11 streams, ~0.6 Mbps if all talk | **1 stream** | 1 stream | 1 stream |
| Load on the one API/Lobby Node process | signalling relay only | signalling + a few HTTPS calls per join/leave/scope change/mute | **all media fan-out**: up to 12×11×50 ≈ 6,600 sends/s *(inference)*, on the loop ADR 0109 just tuned | signalling only |
| Who enforces PARTY/ALL/mute | the server, at connect time | **the server**, per pulled track | the server, per frame | the server, per track |
| Jitter buffer, loss concealment, AEC | browser | browser | **yours to write** (no PLC API) | browser |
| Browsers | all WebRTC browsers | all WebRTC browsers | Chrome 94+, Firefox 130+ desktop, Safari 26+. Not Firefox Android. | all WebRTC browsers |
| New operational pieces | a Cloudflare account + a TURN key ID and its token | a Cloudflare account + two credentials: the SFU app ID and token, and a TURN key ID and its token | none | a VPS, 1–2 containers with UDP ports, a public IP, TLS |
| Money | $0.05/GB relayed, 1,000 GB free tier (no period stated) | $0.05/GB egress, 1,000 GB free tier shared with TURN (no period stated) | none | the VPS |

**Hosted options not in the table.** Cloudflare RealtimeKit (meetings and participants, billed per
minute, no free tier) is probably a poor fit, since the Match server already owns who is in a call
(§3.2) *(inference)*. LiveKit Cloud was not evaluated. Either would be a rewrite of the same
adapter (see "Swap cost later").

**Why the SFU, and not the mesh the ticket named first:**

- **The ticket's framing assumed TURN could be a container in the stack. It can't** (§3.3). Once an
  outside relay is needed anyway, the same account's SFU is the better use of it:
  - its TURN is free when used with it;
  - it removes the 11-stream upload;
  - it removes the IP exposure, which matters because ALL is voice with strangers (§11).
- **A mesh that hides IPs needs `iceTransportPolicy: "relay"` in ALL.** That sends every pair
  through TURN and keeps the 11 uploads, the worst of both.
- **The mesh's real advantage is no third-party SFU.** It still needs a third-party TURN, or some
  Players cannot connect: in 2015–16 data, 22% of conferences needed some TURN relay (§3.3;
  counted per conference, not per pair, and about ten years old).

**Why not Opus over the WebSocket, though it is the only self-contained path:**

- It adds the media fan-out to the one event loop that runs every Lobby's tick scheduler and the
  proxy (`lobbies.service.ts:70-83`), on a Codespace that may have only 2 cores (§2.3).
- On the existing socket it would also queue in front of the Snapshots that ADR 0109 just tuned to
  arrival jitter. A second, voice-only socket avoids that, but today a second connection is seated
  as a new Player and counted toward capacity (`connections.ts:189-195`). It would need its own
  non-seating branch and a seat-binding secret, and `sessionToken` is issued but never stored
  (§2.1).
- Frames would be binary, which means guarding the three unguarded `JSON.parse` listeners.
- The jitter buffer and the missing loss concealment would be ours to own, for a result worse than
  the browser's WebRTC stack.

It is the right answer only if no third party is acceptable at all.

**Where signalling travels (SFU design; the mesh variant is noted after):**

1. Client ↔ Match server, over the existing Lobby socket, as JSON (SDP is text):
   - a new `ClientMessage` (scope change, the local offer, answers to renegotiation);
   - a new *targeted* `ServerMessage` (the SFU's answer or offer, and which Players you are now
     linked with).

   No binary frame is needed, so the unguarded listeners stay safe. Signalling follows `?server=`
   and the `/api/match/<port>` proxy with no change.
2. Match server ↔ Cloudflare, over HTTPS, with the SFU app token from the process environment, the
   way `SERVICE_TOKEN` reaches brokered Match servers (`docker-compose.yml:46-50`). The Match server
   creates a session for each client, publishes its track, and pulls exactly the tracks the rule
   (§5) allows. The exact endpoints were not checked *(unverified)*.
3. Client ↔ Cloudflare, for media. One `RTCPeerConnection` per client, with Cloudflare's STUN/TURN
   in `iceServers`, so a UDP-blocked player can reach it over TLS on 443. The TURN entries are
   generated server side with the second credential, the TURN key's own token (§3.3). That the SFU
   reaches such a player through TURN this way is inferred from the TURN docs *(unverified)*.

With a mesh, step 2 disappears. Step 1 becomes a relay branch in `wireMessages` that:

- checks the target is in `rt.sockets` and in the sender's voice scope;
- stamps `from` with the connection's own id, never one the client supplied;
- forwards offer/answer/ICE (perfect negotiation).

TURN credentials would come from the API with a TTL.

**Load and cleanup on the shared event loop.** Every scope change or mute becomes HTTPS calls from
the Match server to Cloudflare plus a renegotiation, on the event loop that runs every Lobby
(`lobbies.service.ts:70-83`). So the `VoiceRoom` also needs:

- rate-limiting or debouncing of scope and mute changes, so a Player toggling fast cannot flood
  Cloudflare or the loop;
- closing a seat's Cloudflare session on socket close, on seat takeover (the 4004 close,
  `lobby.ts:66-71`) and on reconnect, since `playerId` changes (§2.1) and the old session would
  otherwise linger;
- re-evaluating links when `auth` binds late, since the bind is asynchronous (`lobby.ts:40-73`);
- a decision on what the UI shows for a seat that stays voiceless because it never bound an
  Account (§11).

**Operational weight, stated plainly:**

- a Cloudflare account and **two credentials** in the API's environment: the SFU app ID and token,
  and a TURN key ID with its own `TURN_KEY_API_TOKEN` (§3.3). Locally in `docker-compose.yml`'s
  env; in the Codespace as Codespaces secrets, a GitHub feature not checked here *(unverified)*;
- no new container and no UDP port;
- voice needs outbound internet, even at `localhost:8088`. The game itself does not.
- **Questions for the user, since the account is usage-billed:**
  - who owns the Cloudflare account and its payment method;
  - whether it has a spending cap;
  - whether voice gets an env kill switch, so it can be turned off without a code change (for
    example, voice off whenever the credentials are absent);
  - the privacy side of sending voice and IPs to a third party is in §11.

**Egress cost** *(inference)*: SFU egress is what clients receive.

- **Upper bound**, all 12 Players talking continuously: each receives 11 × ~52 kbps ≈ 0.57 Mbps. A
  Lobby is ≈ 6.9 Mbps ≈ 3.1 GB per hour, so the 1,000 GB free tier is ≈ 320 such Lobby-hours. The
  pricing page gives the tier no period; "a month" comes from secondary sources only (§3.2). The
  52 kbps is a floor that leaves out header extensions, IPv6 and TURN framing (§3.1).
- **With push-to-talk** the real figure is a small fraction of that **only if releasing the key
  stops the RTP stream**: `sender.replaceTrack(null)` or an encoding set `active: false`, or DTX
  negotiated. A track that is merely disabled keeps sending silence frames in libwebrtc, about 40%
  of a talking stream (§3.1, to measure). §6.2 recommends stopping the stream.

**Swap cost later.** If the stack moves to a VPS, LiveKit or mediasoup become possible. The
server-side adapter is rewritten, and the client probably changes too, since both usually come with
their own client SDKs. Keep the Match server's voice logic behind one module (a `VoiceRoom`: join,
leave, scope, mute, links), with the transport as an adapter.

## 5. Who hears whom

**The rule** (proposed; the server enforces it): Players A and B are *linked*, meaning each hears
the other, when **neither is OFF** and **either they are in the same Party, or both chose ALL**.

- **OFF:** you neither send nor hear. It is not "listen only".
- **PARTY:** you are linked only with your Party.
- **ALL:** you are linked with your Party and with everyone else in the Lobby who also chose ALL.
- The rule is symmetric, so nobody hears someone who can't hear them back. **Choosing ALL alone
  exposes you to nobody.** Both sides must opt in, which is the safety property §11 relies on.

**Scope in space and time.**

- A Lobby visit: the Lobby socket's life (§2.2), from LOBBY through every Round and every
  Standings. **It stops before the MatchOver podium**: when the Match ends the client navigates to
  `/match/:id`, which unmounts the canvas, physics and socket, and the Lobby closes with its Match
  (§2.2).
- **Open question for the user: should voice last through MatchOver?** It would mean keeping the
  socket (or a voice-only session) alive past the navigation, or carrying voice through a Party
  (ticket 16). Leaving it as is means the podium is silent.
- Spectators and eliminated Players are Lobby members, so they are linked by the same rule. No wire
  field distinguishes spectators anyway.
- A Playtest and free-roam practice have no voice.
- Voice ends when the socket closes.

**What a server needs to know.**

- Each seat's scope: sent by the client on connect and on every change. A client that lies harms
  only itself.
- Each seat's Party: from the API, never from the client.
- Each seat's Account: already bound by `auth` (§2.1).

**What PARTY can mean before ticket 16 exists:**

| Option | Meaning | Cost |
|---|---|---|
| **Build 16 first** (recommended) | PARTY is the Party, as ADR 0110 says (`:110`) | 17 ships after 16. Its other parts can be built before (§13). |
| Friends in this Lobby | the Friends you share this Lobby with | Real data (`areFriends`, `apps/api/src/friends/friends.dao.ts:180`), but the Match server has no friend lookup today. It becomes a second meaning to retire when Parties land. |
| Everyone in a private Lobby | a private Lobby as a Party | The Match server does not know whether it is private (§2.2). It conflates "who can join" with "who you talk to". |

Showing a PARTY option that links you to nobody would be a control with nothing behind it, which
ADR 0110's first rule rules out (`:23-29`).

**Party voice outside a Match** (in the menus, before a Quick Match) needs a push channel from the
API to the client, and there is none (§2.7). Whether ticket 16 gives a Party one decides whether
PARTY voice works in the menu. Until then, voice exists only inside a Lobby visit.

**Default for public and private Lobbies.**

- Recommended: **one per-device setting, default PARTY, everywhere.** It is the mock's own
  `initial` (`SettingsModal.tsx:20`). In a public Lobby no stranger is heard by default, which
  matches the genre (§3.7).
- A different default for private Lobbies (PARTY in public, ALL in private) would need a fourth,
  hidden state, or two stored values. The mock's three-way `Toggle` has no place for either, and
  the Match server doesn't know which kind it is.
- Friends in a private Lobby who aren't in a Party pick ALL, and so do their friends. Once Parties
  exist, a Party is the normal way to play with friends.
- **The trap in one per-device value: ALL carries into public Lobbies.** Someone who picks ALL to
  talk with friends in a private Lobby is still on ALL in their next public, matchmade one, where
  they hear, and are heard by, strangers who also chose ALL. The both-sides rule limits it to
  strangers who opted in too, but this Player never opted in for *this* Lobby. Options, for the
  user:
  - reset ALL to PARTY on joining a public Lobby. The client knows which kind it joined from its
    route (§2.2), so this needs no Match server change *(inference)*;
  - keep ALL, but say so on joining with a Flash message;
  - accept it, and state it in the ADR.

## 6. Question 2: open mic or push-to-talk

**Recommended: push-to-talk only, default V.**

- The design already says so: "Push to talk · V" (`test_components/src/screens/Settings.tsx:78`).
  Valorant's team voice does the same.
- It keeps echo and room noise out of a 12-Player Lobby.
- It keeps the egress bill small (§4), provided releasing the key stops the RTP stream rather than
  disabling the track (§6.2).

Open mic (voice activity) as a second mode would need a control the mocks do not show. The
alternatives are listed in the questions at the end.

### 6.1 The binding

1. **Fix the read paths first.** The API's `toBindings` and the client's `readStoredBindings` should
   stop rejecting a record for a *missing* action. They should drop only what is malformed, and let
   `resolveBindings` fill in the rest (§2.5). `PUT` validation can stay strict.
2. Add `talk: ["KeyV"]` to `BINDING_ACTIONS` / `DEFAULT_BINDINGS`, and a CONTROLS row.
   `Settings.tsx:139` fails loudly if the row is forgotten.
3. The Settings row's sub shows the live binding ("Push to talk · V"), not a constant.

### 6.2 The listener

- **Not in `PlayerInput`.** Talking is not a sim input, and must not touch `sampleInput`
  (`game/frameLoop.ts:61-72`).
- It is an app-level listener owned by the route's voice session, beside `useMatchMusic`
  (`LobbyRoute.tsx:42-43`), so it works on the Lobby Screen, in a Round and on Standings. It needs:
  - to ignore key events while an `<input>`/`<textarea>` has focus. The Lobby has none, but the
    Friends sheet opens over it (ADR 0110 `:78-81`);
  - to stop sending on window `blur`, like `input.ts:51-54`;
  - `repeat`-safe press/release, where release is on `keyup`.
- **How release stops sending: `sender.replaceTrack(null)`, or the encoding set `active: false`**
  (press puts the track back, or sets `active: true`). Not `track.enabled = false`: in libwebrtc a
  disabled track keeps sending silence frames every 20 ms, about 40% of a talking stream with DTX
  off (§3.1). Both recommended calls stop the RTP stream and neither renegotiates. Negotiating DTX
  would only shrink the idle stream. This is what makes the egress claim in §4 true.
- **Mouse buttons:** follow `PlayerInput`'s rule (they count only under pointer lock,
  `input.ts:35-47`). Otherwise a PTT bound to `Mouse0` would transmit on every click on a Screen. A
  PTT on a mouse side button therefore works only in a Round. That is worth one line in the CONTROLS
  row, and it is the user's call.
- **While the pause sheet is open:** keep push-to-talk working. The sheet is over live play
  (ADR 0110 `:127-132`), and talking while changing a setting is natural. Nothing in the code
  decides this today.

### 6.3 What a Player sees while talking

Their own cue (§8), shown only while the key is held **and** the mic is granted **and** the scope
is not OFF.

### 6.4 Mic permission UX

- **Hearing needs no microphone.** With an SFU, a client can subscribe without publishing; with a
  mesh, a `recvonly` transceiver does the same. So a Player who never talks is never asked.
- **Ask on the first push-to-talk press.** That press is a user gesture, and it is the moment the
  Player shows intent. That press itself sends nothing.
  - Before asking, a Flash message (the CONTEXT term) explains why the browser is asking.
  - After a refusal (`NotAllowedError`), a sticky failure flash says to allow the mic in the
    browser's site settings, and later presses repeat the hint instead of re-prompting.
  - `NotFoundError` means "no microphone found".
- **Insecure origin** (`http://<LAN IP>`, §3.6): `navigator.mediaDevices` is `undefined`. Hearing
  still works. Pressing V says voice needs https or localhost.
- **Pointer lock:** a browser permission prompt mid-Round may release it, and releasing it opens
  the pause sheet (ADR 0110 `:131-132`). That is harmless, but it is a reason to prefer the first
  press on the Lobby Screen *(unverified: not tested)*.
- `navigator.permissions.query({ name: "microphone" })` can pre-read the state, so the explaining
  Flash can be skipped when the mic is already granted. It is supported in Chrome 64+, Firefox 132+
  and Safari 16+ (§3.6).
- **How long the mic stays open, once granted.** Neither choice is free, and the user picks:
  - **Open for the whole visit after the first grant**, with release swapping the track out
    (§6.2). Presses are instant, but the browser's and OS's mic indicator stays lit for the whole
    visit. On Bluetooth headsets an open mic switches the headset to its hands-free profile, which
    drops *all* audio, the game's included, to low-quality mono *(widely reported, unverified
    here)*.
  - **Opened per press** (`getUserMedia` on press, the track stopped on release). The indicator is
    lit only while talking, but the first syllable is clipped while `getUserMedia` starts and, with
    the SFU, while it renegotiates. Keeping the sender across presses and swapping only the track
    would avoid the renegotiation, leaving `getUserMedia`'s start-up *(inference)*.

## 7. Echo cancellation with the game's own audio

- **Capture:** request `echoCancellation: true`, `noiseSuppression: true`, `autoGainControl: true`,
  mono.
- **What cancels the game's audio.**
  - On Chrome desktop, Chrome-wide echo cancellation already cancels *all* audio Chrome plays to
    that output device, which includes the game's shared `AudioContext` (music, effects, other
    voices) (§3.4, re-checked). On Windows and Mac, current Chromium also cancels other apps' audio
    through system loopback; that does not change anything here.
  - Firefox's reference is its default graph.
  - Safari, Chrome Android and ChromeOS are unknown.
  - Where supported, `echoCancellation: "all"` states the intent. Only Chrome 141+ has the string
    modes; Firefox and Safari have none (§3.4). So feature-detect it rather than pass it blind;
    whether an older browser would tolerate the string as an ideal constraint then never matters.
- **Keep the voice chain on the same `AudioContext`** as music and effects (§9). Firefox's caveat
  concerns graphs at a different sample rate, and a second context could create one. Playing remote
  voices through plain `<audio>` elements instead avoids the question on the platforms without
  Chrome-wide echo cancellation; §9 weighs it.
- **Push-to-talk shrinks the problem.** Leaks can only happen while the key is held, and a speaker
  holding the key is mostly the loudest thing in the room.
- **Test on each browser with speakers, not headphones, before shipping** (§15).

## 8. Question 3: per-Player mute and who is speaking

### 8.1 Detecting speaking

- One `AnalyserNode` per remote voice chain (§9). The chain exists anyway, and Web Audio's
  analyser works the same in every browser.
- `getSynchronizationSources().audioLevel` is the alternative, with the Chrome caveat in §3.5.
  That caveat is about a track that plays only through Web Audio. If remote voices play through
  plain `<audio>` elements instead (flat voice, §9), there is no analyser chain, and `audioLevel`
  becomes the natural source for the cue, since the track then plays through an element.
- **Hysteresis** (design numbers, not sourced): speaking starts above a level for ~100 ms and ends
  after ~300 ms below it.
- **Only the edges reach React**, which is the ADR 0088 rule: a per-frame level never goes through
  React.
- The Player's own cue comes from push-to-talk state (§6.3), not from an analyser.

### 8.2 The speaking cue, composed from the mocks' pieces (no new glyph)

- **Lobby card:** the Avatar's `ring` turns go-coloured while that Player speaks. The mocks use
  `var(--df-color-go)` as the "active" ring (`Friends.tsx:122`). Your own card's accent ring
  (`Lobby.tsx:232`) turns go-coloured while you talk.
- **The Lobby card's layout constrains both cues:**
  - Turning your own accent ring go-coloured while you talk removes the "you" marker for as long as
    you talk. The user decides whether that is acceptable, or whether your own card shows talking
    some other way built from the same pieces.
  - The head's top-right is not free on every card: on the host's card the HOST chip sits there
    (`Lobby.tsx:233`, after the Avatar in a `space-between` row, `Lobby.module.css:99-105`). A
    MUTED chip (§8.3) on a muted host's card would share that corner with HOST, or go elsewhere
    on the card, for example beside the READY/WAITING chip (`Lobby.tsx:236`).
- **In a Round:**
  - The nameplate carries the same cue. Nameplates are plain DOM placed per frame, never React
    (`render/nameplates.ts`).
  - Nameplates can be OFF, and are hidden past 40 m and behind the camera. So the HUD also needs a
    **speakers row**: the Avatars of whoever is speaking now, ringed, in the shape of the mock
    SurvivalHud's alive-avatars row (`test_components/src/screens/SurvivalHud.tsx:41-45`). Fortnite
    makes such a readout mandatory for proximity voice (§3.7).
  - SurvivalHud's live list is keyed by index and has no Player id (`screens/SurvivalHud.tsx:13`,
    `:57-58`). The speakers row keys on `LobbyPlayer.id`.
- **Standings / Spectator:** the same Avatar ring where rows carry a Player. `StandingRowView` has
  no id yet (`lib/matchView.ts:29-37`).

### 8.3 Per-Player mute

- **What it means:** hearing only, and local to the one muting. It is distinct from OFF, which
  silences you both ways.
- **Muting also unsubscribes**, so the SFU stops sending that stream to you. Each mute is therefore
  HTTPS calls and a renegotiation on the shared event loop, which is why §4 debounces them.
- **Stored on the Account, keyed by `accountId`.** `playerId` changes with every connection
  (`protocol.ts:24-25`). A Player you muted stays muted in the next Match and on another device.
  - The Match server learns your mutes when it resolves your Account, as it already does for
    cosmetics (`lobby.ts:40-73`).
  - A Match-only mute would be simpler, but it makes a harasser a problem again every Match.
- **Where the control lives (no new glyph):**
  - The pause sheet gets, under its VOICE CHAT row, one `Row` per Player you are linked with:
    `Avatar`, name, and a `Toggle` (for example HEAR ON / OFF). This is the sheet's own vocabulary.
  - A muted Player's Lobby card shows a `Chip` (tone `out`, reading MUTED) in the top-right of
    `playerHead` (`Lobby.module.css:99-105`). That corner is free except on the host's card, where
    the HOST chip sits (§8.2).
- **The Lobby Screen has no way to reach any of this** (§2.2). Two options, for the user:
  - the pause sheet also opens on the Lobby and Standings Screens (Esc, or a button in the Lobby
    header). This has precedent on both sides: the pause sheet's ALL SETTINGS already opens
    `<Settings>` in place over a Round (`GameCanvas.tsx:171-174`, `:760-774`), and the Lobby already
    opens the Friends sheet in place for INVITE FRIENDS (`Lobby.tsx:160-168`); or
  - clicking a Player's card toggles their mute. That is hidden, and invents an interaction the
    mock does not show.

  Either way, leaving to `/settings` must not be the path, because it closes the socket.

## 9. Question 4: spatial or flat

- **The ingredients exist** (§2.4): an interpolated position per Character every frame, a
  camera-ridden listener on the shared context, and an equal-power panner recipe.
- **The chain** lives *outside* the Stage, which is disposed on every Track swap and absent on
  Screens, the way music does. Per remote Player:
  1. the remote track, which in Chrome also plays in a muted `<audio>` element (§3.5; music
     already feeds an element into Web Audio, `music.ts:69`);
  2. `MediaStreamAudioSourceNode`;
  3. mute/volume gain;
  4. `AnalyserNode`;
  5. `PannerNode`;
  6. a voice gain at MASTER × VOICE;
  7. destination.
- **Positions reach it from the frame loop, never through React** (invariant 5). Pass a voice sink
  into the game through `GameConfig` (ADR 0008), called once a frame after `composeDraw`, as
  `stage.applyCharacterSounds` is (`game/frameLoop.ts:340`). Smooth position writes; the engine's
  are raw `.value` (`engine.ts:194-198`).

**Recommended: in a Round, a voice is placed at its Character and never silenced. On Screens, and
for anyone without a live Character, it is flat.**

- **Direction** is equal-power panning. It tells you who is shouting from where, which suits
  "physical chaos and player interaction": the bean who just grabbed you is heard from where it
  stands.
- **Distance** uses the `inverse` model with `rolloffFactor` below 1, or a clamp to a floor. A far
  voice is quieter, never gone. On a strung-out Race (~790 m on Slip Stream), true proximity would
  make ALL silent for most of the Round.
- **Flat** applies on the Lobby, Loading and Standings Screens, and to spectators, whose listener
  pose is stale or absent. The panner is bypassed, not left at an old pose.
- **The Player's own voice** is never played back to them.
- **Honest limits:**
  - The ring-down numbers are feel, and only live play can judge them.
  - The Chrome element workaround must be proven.
  - If placing turns out to be a problem, flat everywhere is the fallback, one flag away. But that
    flag still keeps the Web Audio chain, and with it both of the risks below.

**The weighed alternative: flat voice through plain `<audio>` elements.** The spatial chain is what
forces remote voices through Web Audio, and that chain carries two risks:

- it needs the unverified Chrome muted-element workaround (§3.5);
- on platforms without Chrome-wide echo cancellation (Chrome Android and ChromeOS per the gni;
  Safari unknown, §3.4), remote voices played through Web Audio may be left out of the echo
  canceller's reference. That is the setup the dev.to and focused.io sources warn about.

One plain `<audio>` element per remote voice, with `srcObject` set to its stream, avoids both, and
`getSynchronizationSources().audioLevel` then works for the speaking cue (§8.1). Per-voice mute and
MASTER × VOICE become the element's `volume`. What it costs:

- no placement in a Round: recommendation 6 becomes flat everywhere;
- no `AnalyserNode` (the cue polls `audioLevel` instead);
- the music duck is still possible, since it is driven by the speaking edges and music has its own
  chain *(inference)*.

It trades the feel of a placed voice for two fewer unknowns. Which one to build first is the user's
call; a speakers-on test on each browser (§15) is what would settle whether the risks are real.

**Ducking:** lower the music while any linked voice speaks. Music has a duck gain already
(`music.ts:101-122`). Leave effects alone, since the game's sounds are the game. This is a feel
number too.

## 10. Where the setting lives

**The facts disagree:**

- **Mock PAUSED sheet:** OFF/PARTY/ALL `Toggle` (`SettingsModal.tsx:20`).
- **Mock Settings:** **AUDIO**, on/off `Switch`, sub "Push to talk · V" (`Settings.tsx:74-81`).
  Screen shake sits beside it.
- **ADR 0110 (WT, `:130`, in the pause-menu paragraph `:127-132`):** "screen shake on AUDIO beside
  voice chat, nameplates on GAMEPLAY", which follows the mock.
- **Ticket 17 (`:3`) and ticket 13's header (WT, `:3-4`):** still say Settings → **GAMEPLAY**.
- **`SettingsAudio.test.tsx:52`** asserts no VOICE CHAT on AUDIO. It has to flip whatever is
  chosen.

**Recommended: one value, the scope, on AUDIO where the design and ADR 0110 put it.**

- The AUDIO row keeps the mock's label and sub, with the live `talk` key.
- It is drawn as the pause sheet's OFF/PARTY/ALL `Toggle` instead of the mock's `Switch`. Settings
  is the only place outside a Round, and a `Switch` cannot say PARTY or ALL.
- Settings is also already reachable *inside* a Round, in place: the pause sheet's ALL SETTINGS
  mounts `<Settings>` over the Round with the socket up (`GameCanvas.tsx:171-174`, `:760-774`). So
  the AUDIO row and the pause sheet's row are one value edited from two places in the same Round,
  and must read the same store. The same in-place Settings is the precedent for reaching it from
  the Lobby and Standings Screens (§8.3).
- Ticket 17's ADR corrects "GAMEPLAY".

**Alternatives (in the questions):**

- keep the `Switch` as a view of "scope ≠ OFF", leaving PARTY/ALL choosable only in a Round;
- read the `Switch` as push-to-talk on/off, which means an open-mic mode (§6).

**Storage:** per device, next to the pause sheet's other rows in `dontfall.gameplay.v1`
(`lib/gameplaySettings.ts:11-20`). Every pause-sheet row is "stored per device"
(`PauseMenu.tsx:17-23`).

**Voice volume.** The mocks show no VOICE slider. A `Slider` row is a mock piece, and the AUDIO
pane already composes four (`screens/Settings.tsx:53-59`). A voice slider would follow music's
MASTER × VOICE and must be kept out of the Stage engine's `setVolume` loop (§2.4). It is not in the
design, so the user decides.

## 11. Safety with strangers

This is what ALL means in a public, matchmade Lobby (ADR 0110 `:95-101`).

**Recommended floor, shipped with ALL:**

1. **ALL is opt-in on both sides** (§5). The default is PARTY.
2. **No stranger learns your IP**, because of the SFU (§4). A mesh cannot offer this without
   relaying everything.
3. **Per-Player mute, remembered on the Account** (§8.3).
4. **The speaking cue is always on**, independent of nameplates (§8.2). You can always tell who is
   talking.
5. **Voice only for a seat bound to an Account.** The server links a seat only once `auth` has
   resolved (`accountId !== null`, `lobby.ts:40-73`), so every voice traces to an Account and every
   mute keys on one. The bind is asynchronous, so links are re-evaluated when it lands, and a seat
   that never binds stays voiceless; what the UI shows for it is open (§4).

**Left out, and stated as the user's call:**

- **Report** (with or without Fall Guys' rolling 5-minute recording). A recording means
  server-side media capture, retention and review. It is its own ticket, and the mocks show no
  report control.
- **Block** beyond a remembered mute.
- **A host-wide mute.** It is not in the design.
- **ALL carrying into public Lobbies.** One per-device value means an ALL picked for friends in a
  private Lobby is still ALL in the next public, matchmade one. The options (reset to PARTY on
  joining a public Lobby, a Flash saying so, or accepting it) are in §5.
- **A privacy notice.** With the SFU, every Player's voice and IP address go to Cloudflare, a
  third-party processor. Strangers never learn your IP (point 2), but Cloudflare does. Whether the
  game tells Players so, and where, is the user's call; so are the billing questions in §4.
- **Age.** Accounts carry none (§2.8). Discord's 13+ floor covers Discord logins only
  *(unverified)*, and email/password Accounts have none. The FTC and Ofcom context in §3.8 is why
  ALL-with-strangers is not the default. It is a hobby game, but that is the user's risk to accept
  in the ADR.

## 12. Glossary (CONTEXT.md) changes needed

- **"voice" is already taken twice in code.** It means one playing sound under the "voice budget"
  (`audio/engine.ts:8-16`, ADR 0087) and "the Match's voice", the announcer
  (`audio/matchCalls.ts:64`). So the new terms avoid bare "voice".
- **Proposed:**
  - **Voice chat**: Players in the same Lobby talking to each other. _Avoid_: voice, VOIP, comms.
  - **Voice chat scope**: a Player's OFF / PARTY / ALL setting. _Avoid_: channel, mode.
  - **Push-to-talk**: the Control-bound action (`talk`) that sends your Voice chat while held.
    **Key bindings** must change: today it lists "move, jump, dash, hit, grab, spectate-next", which
    are gameplay actions, and push-to-talk is not a sim input. Say so in both entries.
  - **Speaking**: the on-screen cue that a linked Player's Voice chat is audible now.
  - **Mute**: one Player silencing another for themselves only, remembered on the Account.
    Distinct from Voice chat scope OFF. _Avoid_: block (reserved for something stronger, if ever
    built).
  - **Party**: defined by ticket 16. The **Friend** entry's "_Avoid_: party" and "no matchmaking
    concept of a party" (`CONTEXT.md:24-28`) must be amended there.
  - Optionally, **Voice link**: two Players who hear each other under the rule in §5. Useful in the
    ADR and the server code.

## 13. How tickets 13 and 16 block 17

- **13 (pause menu) blocks almost nothing now.**
  - In the working tree it reads "done on tests (2026-09-19) — the voice chat row waits for 17"
    (`13-…md:10`). `PauseMenu.tsx` exists with a comment reserving the row. The per-device settings
    pattern exists (`lib/gameplaySettings.ts`, `useGameplaySettings`).
  - What remains is coordination, not design:
    - 13's files are being edited by another session and are uncommitted (`PauseMenu.tsx`,
      `Settings.tsx`, `GameCanvas.tsx`). Land them before 17 touches them.
    - The AUDIO/GAMEPLAY contradiction (§10) needs fixing.
    - 13's sheet opens only in a Round (`GameCanvas.tsx:353`), so 17 still has to decide how the
      Lobby and Standings Screens reach voice and mutes (§8.3). The sheet's ALL SETTINGS, which
      already opens Settings in place over a Round, is the precedent (§2.2).
- **16 (Parties) truly blocks PARTY, and only PARTY.** It decides:
  - what a Party is, and the glossary entry;
  - where it lives: the API, per 16's own question (`16-parties.md:13`);
  - how the Match server learns each seat's Party. The natural path is the Account resolution it
    already makes at `auth`;
  - whether a Party has a push channel in the menus, which decides whether PARTY voice exists
    before a Match (§5).
- **What can be built before either, in order:**
  1. the bindings read-path fix, then `talk` on V with its CONTROLS row (§6.1);
  2. the transport: the Cloudflare adapter behind a `VoiceRoom` on the Match server, the signalling
     message pair on the Lobby socket, and the two credentials in env, with a kill switch if the
     user wants one (§4). With it, the `VoiceRoom`'s housekeeping: debounced scope and mute changes,
     and a seat's Cloudflare session closed on socket close, seat takeover and reconnect (§4);
  3. the linking rule as a pure, tested function, with OFF and ALL only, re-run when `auth` binds
     late (§4, §11);
  4. the client voice session: route-owned mic permission UX, the app-level push-to-talk listener
     (release stops the stream, §6.2), and the voice chains on the shared context, or plain
     `<audio>` elements if flat voice is chosen (§6, §9);
  5. speaking detection and cues, per-Player mute on the Account, and the HUD speakers row (§8);
  6. spatial placement through a `GameConfig` sink (§9);
  7. the Settings row and the pause-sheet row, with PARTY landing with 16 (§5, §10).

## 14. Where the findings disagreed

- **Bindings: does adding an action reset saved layouts?**
  - One researcher said older records "still load, because `resolveBindings` fills in missing
    actions". The other said every custom layout resets.
  - **The second is right** *(re-checked)*. `resolveBindings` would fill them in, but both read
    paths call `invalidBindingsReason` first and turn a record missing any action into `null`
    (`accounts.dao.ts:65-73`, `bindingsStore.ts:15-24`, `bindings.ts:80-82`).
- **12 Players or 10?**
  - The briefing says up to 12 (ADR 0011). The network findings used `MAX_PLAYERS = 10`.
  - **Both hold.** 12 is the architected ceiling, and 10 is today's operational default, which
    counts spectators and is configurable (`match.ts:82-89`, `config.ts:140`). Size voice for 12.
- **Settings tab.**
  - The audio findings placed the scope on GAMEPLAY, "per ADR 0110". The UI findings placed it on
    AUDIO.
  - **ADR 0110's current (WT) text says AUDIO** (`:130`), and so does the mock. GAMEPLAY survives
    only in ticket 17 and in ticket 13's header (§10).
- **Echo cancellation of Web Audio playback.**
  - Two secondary sources say it isn't reliable or doesn't happen. The Chromium source says it
    does, by default, on Chrome desktop.
  - **The source wins for Chrome desktop** *(re-checked)*. On Windows and Mac it now goes further,
    to other apps' audio through system loopback. Other platforms remain untested (§3.4).
- **Remote WebRTC audio silent in Web Audio on Chrome.**
  - The audio findings called it historical. The external findings could not confirm it.
  - A Chromium issue (933677, now issues.chromium.org/40094084, behind sign-in) is referenced by
    secondary sources, with a 2022 workaround comment. Its current status is **unverified**, so
    treat it as real until a test shows otherwise, or sidestep it with plain `<audio>` elements
    (§3.5, §9).
- **Does a push-to-talk release stop the upload?**
  - The review of this note said a disabled track sends silence frames "per webrtc-pc". The spec
    says a sender with a disabled audio track "MUST NOT send".
  - **libwebrtc sends anyway** *(re-checked in its source)*: a disabled track mutes the send
    stream, whose zeroed frames are still encoded and sent (§3.1). So the review's conclusion holds
    for Chrome and Safari, but not on the spec's authority. Stopping the stream with
    `replaceTrack(null)` or `active: false` is right either way (§6.2).

## 15. Not verified here, or to test live

1. Chrome-wide echo cancellation against the game's own music/effects with speakers on, per browser
   (Chrome desktop, Firefox, Safari).
2. Whether Chrome needs the muted `<audio>` element for a remote track in Web Audio, and whether
   `getSynchronizationSources` needs it too. Plain `<audio>` elements (§9) would make both moot.
3. Cloudflare Realtime SFU's session/track API in detail, per-session limits, the free tier's
   period, and reaching it over TURN/TLS 443 from a UDP-blocked network.
4. Whether a mic permission prompt mid-Round releases pointer lock.
5. The egress estimate (§4) against a real Match: what an idle push-to-talk stream costs with the
   chosen stop method (`replaceTrack(null)` or `active: false`, expected zero), and with a merely
   disabled track, for comparison. Whether Firefox also sends from a disabled track.
6. Codespaces secrets as the way the two credentials (SFU app, TURN key) reach the Codespace stack.
7. Discord's 13+ age floor.
8. Safari's behaviour for any of the above.
9. A mic left open for the whole visit on a Bluetooth headset: whether it drops the game's audio
   to hands-free mono. And, if the mic opens per press, how much of the first syllable is lost
   (§6.4).
10. Everything that is feel: the distance ring-down, ducking, the speaking hysteresis.
11. Not a test, a decision left open: whether voice should last through the MatchOver podium
    (§5).

## Sources

- GitHub Docs, forwarding ports in a codespace: https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace
- GitHub community discussion #28528: https://github.com/orgs/community/discussions/28528
- Cloudflare Realtime overview (SFU, TURN, RealtimeKit): https://developers.cloudflare.com/realtime/
- Cloudflare Realtime SFU: https://developers.cloudflare.com/realtime/sfu/
- Cloudflare Realtime SFU pricing: https://developers.cloudflare.com/realtime/sfu/pricing/
- Cloudflare Realtime TURN: https://developers.cloudflare.com/realtime/turn/
- Cloudflare TURN credentials: https://developers.cloudflare.com/realtime/turn/generate-credentials/
- LiveKit ports and firewall: https://docs.livekit.io/home/self-hosting/ports-firewall/
- mediasoup installation: https://mediasoup.org/documentation/v3/mediasoup/installation/
- mediasoup client–server communication: https://mediasoup.org/documentation/v3/communication-between-client-and-server/
- mediasoup `WebRtcServer`: https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcServer
- coturn Docker README: https://github.com/coturn/coturn/blob/master/docker/coturn/README.md
- coturn example config: https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf
- TURN REST API draft: https://datatracker.ietf.org/doc/html/draft-uberti-behave-turn-rest-00
- libwebrtc Opus config: https://webrtc.googlesource.com/src/+/refs/heads/main/api/audio_codecs/opus/audio_encoder_opus_config.h
- libwebrtc Opus encoder: https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_coding/codecs/opus/audio_encoder_opus.cc
- libwebrtc `rtp_sender.cc`: https://webrtc.googlesource.com/src/+/refs/heads/main/pc/rtp_sender.cc
- libwebrtc `webrtc_voice_engine.cc`: https://webrtc.googlesource.com/src/+/refs/heads/main/media/engine/webrtc_voice_engine.cc
- libwebrtc `channel_send.cc`: https://webrtc.googlesource.com/src/+/refs/heads/main/audio/channel_send.cc
- W3C, WebRTC 1.0 (webrtc-pc): https://w3c.github.io/webrtc-pc/
- RFC 7587 (Opus RTP): https://www.rfc-editor.org/rfc/rfc7587.html
- RFC 7874 (WebRTC audio): https://www.rfc-editor.org/rfc/rfc7874.html
- RFC 8828 (WebRTC IP handling): https://www.rfc-editor.org/rfc/rfc8828.html
- RFC 8835 (WebRTC transports): https://www.rfc-editor.org/rfc/rfc8835.html
- RFC 8656 (TURN): https://www.rfc-editor.org/rfc/rfc8656.html
- RFC 7065 (TURN URIs): https://datatracker.ietf.org/doc/html/rfc7065
- RFC 5681 (TCP congestion control): https://www.rfc-editor.org/rfc/rfc5681
- RFC 6298 (TCP RTO): https://www.rfc-editor.org/rfc/rfc6298
- Linux `include/net/tcp.h` (`TCP_RTO_MIN`): https://github.com/torvalds/linux/blob/master/include/net/tcp.h
- ITU-T G.114: https://www.itu.int/rec/T-REC-G.114-200305-I
- bloggeek, WebRTC P2P mesh: https://bloggeek.me/webrtc-p2p-mesh/
- webrtcHacks, usage stats: https://webrtchacks.com/usage-stats/
- Google STUN, discuss-webrtc: https://groups.google.com/g/discuss-webrtc/c/shcPIaPxwo8
- MDN, perfect negotiation: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
- MDN, `RTCPeerConnection()`: https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/RTCPeerConnection
- MDN, `getUserMedia`: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- MDN, `Permissions.query`: https://developer.mozilla.org/en-US/docs/Web/API/Permissions/query
- MDN, secure contexts: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
- MDN, `MediaTrackConstraints`: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints
- MDN, `echoCancellation`: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation
- MDN, `getSynchronizationSources`: https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/getSynchronizationSources
- MDN, `KeyboardEvent`: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent
- MDN, `PannerNode`: https://developer.mozilla.org/en-US/docs/Web/API/PannerNode
- MDN, `AudioEncoder`: https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder
- MDN, WebCodecs codec selection: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection
- MDN, Firefox 130 release notes: https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/130
- W3C, WebCodecs Opus registration: https://www.w3.org/TR/webcodecs-opus-codec-registration/
- W3C, Media Capture and Streams: https://w3c.github.io/mediacapture-main/
- w3c/webcodecs issue 558: https://github.com/w3c/webcodecs/issues/558
- caniuse, `AudioEncoder`: https://caniuse.com/mdn-api_audioencoder
- caniuse, `AudioDecoder`: https://caniuse.com/mdn-api_audiodecoder
- caniuse, `MediaStreamTrackProcessor`: https://caniuse.com/mdn-api_mediastreamtrackprocessor
- caniuse, WebTransport: https://caniuse.com/webtransport
- WebKit, Safari 26.0: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- WebKit `AudioEncoderCocoa.cpp`: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/AudioEncoderCocoa.cpp
- Chrome, WebTransport: https://developer.chrome.com/docs/capabilities/web-apis/webtransport
- Chrome, autoplay: https://developer.chrome.com/blog/autoplay
- Chromium `media_switches.cc`: https://chromium.googlesource.com/chromium/src/+/main/media/base/media_switches.cc
- Chromium `media_options.gni`: https://chromium.googlesource.com/chromium/src/+/main/media/media_options.gni
- discuss-webrtc, Chrome-wide AEC: https://groups.google.com/g/discuss-webrtc/c/v592nFc4cO4
- discuss-webrtc, `getSynchronizationSources` and elements: https://groups.google.com/g/discuss-webrtc/c/GqojKPUt0-s
- blink-dev, `echoCancellation` modes: https://www.mail-archive.com/blink-dev@chromium.org/msg14454.html
- Mozilla bug 1849108: https://bugzilla.mozilla.org/show_bug.cgi?id=1849108
- Chromium issue 933677, now 40094084 (behind sign-in): https://issues.chromium.org/40094084
- dev.to, AEC pitfalls (2026): https://dev.to/orca_forge/browser-voice-interaction-ai-pitfall-guide-2026-16-common-traps-with-aec-getusermedia-and-40hd
- focused.io, echo cancellation with Web Audio (2020): https://focused.io/lab/echo-cancellation-with-web-audio-api-and-chromium
- Fall Guys voice reporting FAQ: https://www.fallguys.com/en-US/voice-reporting-faqs
- Stumble Guys voice FAQ: https://stumbleguys.helpshift.com/hc/en/4-stumble-guys/faq/222-is-voice-chat-supported/
- AmongUs-Mumble: https://github.com/StarGate01/AmongUs-Mumble
- Valorant voice chat: https://support.riotgames.com/valorant/gameplay/valorant-voice-chat-troubleshooting
- Fortnite proximity chat: https://dev.epicgames.com/documentation/en-us/fortnite/proximity-chat
- FTC, Epic settlement: https://www.ftc.gov/news-events/news/press-releases/2022/12/fortnite-video-game-maker-epic-games-pay-more-half-billion-dollars-over-ftc-allegations
- Ofcom, the Online Safety Act and gaming: https://www.ofcom.org.uk/online-safety/the-online-safety-act-and-gaming-know-the-risks-know-the-rules-know-how-to-comply
- Lethal Company: https://en.wikipedia.org/wiki/Lethal_Company
