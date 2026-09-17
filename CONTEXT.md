# DON'T FALL

The glossary / ubiquitous language for DON'T FALL. These are the canonical terms
for code, comments, commits, and docs. This file is a glossary only — no
implementation detail, no decisions (those live in `docs/adr/`).

## Language
cz + en

### Participants

**Account**:
A Player's persistent identity, required to reach any Screen (ADR 0052) — nothing in the app is
reachable anonymously. Reached by Discord login or by this game's own email/password credentials,
either or both at once (ADR 0053: an Account may link both, in either order). Distinct from a
Character, which exists only for a Match, and from the connection-scoped session id a socket
carries.
_Avoid_: profile, login, user

**Player**:
A human with an Account who joins a Match. Persists across Matches.
_Avoid_: user, gamer

**Friend**:
A mutual connection between two Accounts, formed by request/accept. Carries presence (Online / In
Match / Idle) between Friends. Distinct from a Party — DON'T FALL has no matchmaking concept of a
party (ADR 0040); Friends is purely social.
_Avoid_: party, contact, buddy

**Character**:
The in-world body a Player controls — a kinematic capsule with an attached
ragdoll. Exists only for the duration of a Match.
_Avoid_: avatar, player (when you mean the body), pawn

### Match structure

**Match**:
One full session from Lobby to a single winner, made of several Rounds. The winner
is whoever holds the highest Score when the last Round ends — nobody is knocked out
of a Match along the way (ADR 0049).
_Avoid_: game, session

**Match length**:
How many Rounds a Match runs. Set in the Lobby before it starts, and fixed for its
duration — a Match never ends early because someone reached a Score.

**Round**:
One run through a single obstacle course within a Match, played by one Round type.
Ends when that Round type's condition is met or the Time Limit expires. Every Player
plays every Round; what a Round decides is Score, not who continues.
_Avoid_: level, stage, kolo, heat

**Score**:
What a Player has earned across the Rounds of a Match so far. Match-scoped: it is
built from the Rounds already played and ceases to exist when the Match ends.
Distinct from XP and Coins, which persist across Matches.
_Avoid_: points, score total, rating

**Round type**:
The rules a Round runs by: what Qualifies you, what eliminates you, and what ends
it. Race and Survival are Round types. A Round type is chosen independently of the
Track it runs on.
_Avoid_: game mode, minigame, mini-game

**Race**:
A Round type. Get to the Finish Zone before the Time Limit. The primary Round type.

**Survival**:
A Round type. Stay on the course while others are shoved off it; a Fall eliminates.
Ends when the Survivor Target is reached or the Time Limit expires, and everyone
still standing Qualifies. The Final Race form runs down to a single Survivor.

**Survivor Target**:
How many Players a Survival Round leaves standing before it ends.

**Collect Round**:
A Round type. Gather objects scattered on the course; a threshold advances you.

**Team Round**:
A Round type where Players are split into teams and advance by team result.

**Final Race**:
The last Round of a Match. May be a special mode (see Skyfall) rather than a
plain Race. _Intended, not built_: since ADR 0049 the last Round is an ordinary
Round that pays ordinary Score, and making it decisive needs an answer to "what if
someone is already uncatchable" that scoring alone does not give.

**Qualification**:
The condition for finishing a Round well — reaching the Finish Zone, or being among
the survivors, before the Round ends. It is the top scoring tier, not a gate: since
ADR 0049 everyone plays the next Round regardless, and Qualifying pays a bonus.
_Avoid_: passing, promotion

**Elimination**:
A Player who did not Qualify before the Round ended. Applies to that Round only —
they play the next one. What eliminates you is the Round type's rule: in a Race a
Fall never eliminates, it only costs time through Respawn with a penalty; in
Survival it is exactly what does.
_Avoid_: death, KO

**Time Limit**:
The countdown for a Round. When it hits zero, every Player not yet Qualified is
eliminated. Preferred over a fixed "first N players" cutoff. Each Revision carries
its own default Time Limit — a longer Track allows more time; the lobby shows it and
the server enforces it.

**Finish Zone**:
The area at the end of a Race that grants Qualification on entry. Deliberately an
area, not a line, so the end of a Round stays chaotic and contested. A finish sign
Gate's opening, or on older Tracks a detection-only trigger region on a retired
block — never a Volume; distinct from Checkpoint, which sets a Respawn point.
_Avoid_: finish line, goal

**Lobby**:
The gathering before a Round — nicknames, ready toggles, Track selection, host start.
Ends when the host starts the Countdown. Public by default; a Private Lobby is found only
by its Join Code, never listed for Quick Match (ADR 0054).
_Avoid_: waiting room

**Join Code**:
The 6-character code a Private Lobby's host shares to let others in — generated by the
Lobby broker, not chosen by the host. The only access control a Private Lobby has.
_Avoid_: password, invite code

**Quick Match**:
Joining whatever open, joinable public Lobby is available, or a freshly created one if
none is — never a queue with an open-ended wait (ADR 0054).
_Avoid_: matchmaking (implies skill-based pairing, which this isn't)

**Countdown**:
The short delay between Start and the live Round. Characters are already spawned but
their input is locked.
_Avoid_: warmup

**Results**:
The rank a single Round produced — Qualified ordered by finish time and the rest by
how far they got. What the Standings shows for the Round just played.
_Avoid_: scoreboard, leaderboard

**Standings**:
The Screen between Rounds and at the end of a Match — the Results of the Round just
played, next to every Player's running Score. Between Rounds it advances into the
next Countdown on its own; at the end of a Match it names the winner and waits for
the host to return everyone to the Lobby.
_Avoid_: scoreboard, leaderboard, table

### Track

**Track**:
The full obstacle course a Round runs on, assembled from Segments. What a Round
actually runs is always one immutable Revision of a Track — see Draft, Revision.
_Avoid_: map, course, level

**Draft**:
A Track being composed in the Track builder — mutable, not yet published.
Publishing a Draft creates a new Revision; the Draft itself is never what a
Round runs on.
_Avoid_: track (when you specifically mean the mutable, in-progress one)

**Revision**:
One immutable, numbered publish of a Track — the only form a Round ever runs
on. Publishing a Draft again creates a new Revision; an existing Revision is
never mutated.
_Avoid_: version, save

**Thumbnail**:
One Revision's screenshot — the JPEG its author framed in the Track builder
just before saving, shown in Discover and on the Round loader. A Revision
published without one simply has none.
_Avoid_: preview (in the builder that means a live 3D vignette), screenshot,
map image

**Module**:
A reusable template for a piece of Track (e.g. "Spinner", "Bounce", "Moving
Platforms", "Straight", "Gap"). Authored once.
_Avoid_: prefab, block, piece

**Asset**:
One per-Module GLB file in `assets/`, named `<moduleId>.glb`, carrying that
Module's Visual and Collision meshes. Authored once, like the Module itself.
_Avoid_: model, mesh file

**Collision mesh**:
The authored `role: collision` node of an Asset. Baked verbatim into the
Module's colliders — the one geometry every Player simulates, identical for
all. Never rendered.
_Avoid_: UCX, hitbox

**Asset pivot**:
The origin every Asset is seated on: centred on X and Z, with its lowest point
resting on y = 0. A Segment's position is this point, so it is where the Track
builder's handle sits and what the Segment turns about.
_Avoid_: anchor (see Socket), origin offset

**Asset category**:
Which group the Track builder lists an Asset Module under: Platform (what a route
is built out of, including what holds it up), Obstacle, Spring, Gate or Scenery.
A listing property: it gives a Module no behavior of its own. Two of the groups
are named after a mechanic their members all carry in their own defs — a Gate its
opening, a Spring its launch — and nothing outside those groups carries it.
_Avoid_: type, kind, tag

**Visual mesh**:
The authored `role: visual` node of an Asset. Rendered, never simulated — it
may differ from the Collision mesh (detail, LOD, compression) without
changing gameplay.
_Avoid_: render mesh, skin

**Socket**:
A Module's named local connection point (a position and rotation) that another
Module can be placed against, so a Track builder can snap pieces together
instead of only chaining a single uniform step.
_Avoid_: connector, port, anchor

**Footprint**:
A Module's declared occupied space and clearance, used to validate placement
and overlap — independent of its visual geometry or collider.
_Avoid_: bounding box

**Surface**:
A property of a piece of Track floor: how well a Character grips it (how fast it
can accelerate and how fast it slows down) and how fast it may ultimately travel
on it. A property of floor geometry, never a kind of Module — one Module may mix
Surfaces across its floor pieces.
_Avoid_: material, terrain, ice block, ground type

**Volume**:
A region of space that applies a force to any Character inside it — an updraft, a
wind tunnel. Contrast with Surface, which acts on a Character standing on it, and
with a Checkpoint's trigger region, which only detects and never pushes.
_Avoid_: zone, field, trigger, area

**Floating**:
A Character held up in the air by a Volume that pushes upward harder than gravity
pulls: an updraft over a fan. The Character is still Controlled. Floating is how it
is drawn (drifting, flailing), never a state of its own.
_Avoid_: flying, hovering, levitating

**Conveyor**:
A belt attached to a Segment that carries any Character standing on it toward its
direction at its preset speed — with the belt you run faster, against it slower
or backwards, stepping off ends it. A standing property of the Segment, never a
one-shot: contrast with Surface (grip and speed cap, no direction of its own) and
Launch pad (a one-shot throw, a different mechanic).
_Avoid_: speed pad, slow pad (both retired), boost pad, zipper, treadmill

**Bounce**:
A Surface that returns the speed you landed with — the harder the fall, the higher
you go, and a walk-on still bounces a little. Attached to a Segment like ice and
mud, and one of the same choice: a deck is made of one thing. Its deck wears an
inflatable sheet that stands convex at rest, dents under whoever is on it and
rings after a landing; the sheet is drawn, never simulated — the deck underneath
stays flat. Contrast with a Launch pad, whose throw is the same however you arrive.
_Avoid_: trampoline, bouncy, rubber, jump pad

**Launch pad**:
A floor region that throws a Character the instant it steps in — vertical speed is
set outright, so the height is the same however you arrived, and any sideways shove
is added to the run you brought. Fires once per crossing and re-arms when you leave.
Contrast with Conveyor (a standing carry with no launch) and with a bounce Surface,
whose throw depends on how hard you landed.
_Avoid_: jump pad, booster, catapult, trampoline

**Spring**:
An Asset that is a Launch pad — a coil or a spring pad you bounce off, listed in
its own Asset category. Its author sets how high it throws, in metres, and aims it
by tilting the Segment. It fires when a Character is standing on it, never while
one is still falling toward it; it squashes as it fires, and the squash is drawn,
never simulated.
_Avoid_: bouncer, jump pad, trampoline, spring pad

**Segment**:
One concrete instance of a Module placed at a position in a Track. A Track is a
sequence of Segments.
_Avoid_: section, tile, chunk, piece

**Motion**:
The authored, endlessly repeating movement of one Segment: a Spin (constant
rotation about an axis), a Swing (rotation back and forth) and/or a Slide
(movement back and forth), in that order. A pure function of the Tick, so every
Player sees the same pose without it being sent. A Segment with one is a
Moving Segment.
_Avoid_: animation, tween, mover

**Ride**:
What a Character standing on a Moving Segment does: it is carried along, turned
with it, and keeps its speed when it leaves.
_Avoid_: attach, parent, stick

**Spiked**:
An Asset whose every contact knocks a Character down, whatever the speed —
standing on it, running into it, or being moved into it.
_Avoid_: deadly, lethal (a knockdown is never a Fall)

**Obstacle**:
A Module (or part of one) that actively threatens the Character — a Spinner,
Pendulum, Falling Tiles. Contrast with connective Modules like Straight and Gap.
_Avoid_: hazard, trap

**Scenery**:
A Module that neither carries the route nor threatens the Character — a sign,
a flag, a railing, a fence. It may still block a Character that runs into it.
Contrast with Obstacle and with Platform-category pieces.
_Avoid_: decoration, prop (see Prop)

**Prop**:
A dynamic physics body that reacts to being bumped (a box, a ball) but never
threatens the Character on its own. Contrast with Obstacle.
_Avoid_: crate (see Item Box), object, decoration

**Projectile**:
A dynamic physics body spawned at runtime by an Obstacle (e.g. a cannon), with
an initial velocity, that threatens the Character on contact and despawns
after its lifetime. Contrast with Prop (permanent, never threatens) and
Obstacle (stationary, pre-placed). Full spawn/replication design deferred
(post-M3).
_Avoid_: bullet, shot

**Checkpoint**:
A point on the Track that a Character respawns at after a Fall. Set by passing
through a Gate switched on as a Checkpoint (numbered — only a higher number moves
it), or, on older Tracks, by entering a retired checkpoint block's region.

**Gate**:
An Asset a Character passes through — a hoop, an arch or a finish sign. Passing
means going through its opening, either way; around or over it never counts. A
hoop or an arch is a Checkpoint only when switched on; a finish sign is always a
Finish Zone. Also the Asset category that lists them.
_Avoid_: ring, portal, trigger

**Start**:
The one Segment of a Track its Characters spawn on — any Segment can be it. A
Track without one starts on its first Segment.

**Spawn**:
Where Characters start a Round, or reappear after a Respawn.

### Character state & physics

**Controlled**:
The Character state where the Player has normal movement input over the kinematic
capsule.

**Stagger**:
The Character state for being unsteady on your feet — movement input is dampened
but the Character stays upright, and it recovers automatically to Controlled. How
long it lasts depends on what caused it: a light Impact is short, coming back from
a Respawn is longer (ADR 0072). Drawn with the Wobble animation, which is the only
reason anyone can tell it is happening.

**Sliding**:
The Character state on a Surface too steep to walk on: the Character keeps
reduced movement input while gravity carries it down the slope. Held by the
condition (standing on such a Surface), not by a timer — unlike Stagger. An
Impact while Sliding knocks the Character straight into Ragdoll.
_Avoid_: slipping, skidding

**Ragdoll**:
The Character state where the articulated body takes over full physics and the
Player has no movement control. Triggered by a hard Impact or dashing into a
wall. (A Fall no longer triggers it: see Wobble.)

**GettingUp**:
The Character state after a Ragdoll: the Character gets back on its feet, still
without movement control, and the kinematic capsule comes back. Recovers to
Controlled once the feet are planted.
_Avoid_: recovery (as a noun for the state — use GettingUp), standup

**Knockdown**:
What a hard Impact does, as the Player sees it from start to finish: the
Character goes down the way it was pushed, lies there through Ragdoll, and gets
up the same way through GettingUp. A knockdown always ends on the Character's
feet.
_Avoid_: death, KO (as the name of the whole event — `KO` is the rig's name for
the falling clip alone)

**Wobble**:
What a Staggering Character looks like — the unsteady animation it plays while
slowed, after a light Impact or a Respawn. (An earlier, unrelated Wobble was a
procedural lean of the visual mesh while Controlled, cosmetic only; it is switched
off — see ADR 0010.)

**Impact**:
A collision forceful enough to change Character state — into Stagger or Ragdoll
depending on magnitude.

**Impact Reaction**:
The visible response to an Impact (flinch, spin, knockdown).

**Fall**:
The core failure. A Character leaves the play volume (drops below the kill-plane).
What follows is the Round type's rule: a Race Respawns it at the last Checkpoint,
Survival eliminates it. "Don't fall" is this. A Fall never knocks a Character down
— it comes back on its feet, Staggering (ADR 0072).
_Avoid_: death, out of bounds, KO

**Respawn**:
Returning a fallen Character to its last Checkpoint — on its feet and Staggering,
never as a knockdown — with a short time penalty so
a Fall always costs something. Not every Round type has one — where a Fall
eliminates, nothing comes back.

**Knockback**:
Momentum transferred to a Character by another Character or an Obstacle. Allowed
and encouraged. Never directly lethal — only the resulting Fall is.

**Bump**:
Character-to-Character contact that produces Knockback without any input beyond
running into someone.

**Dash**:
A short fixed-impulse burst in the direction of movement, on a cooldown.
Ground-only — it cannot be started in mid-air, though a burst already underway
keeps going if it carries the Character off an edge. Dashing into a wall or
edge sends the Character to Ragdoll.

**Grab**:
Briefly latching onto a Character just ahead of you. Both Characters move at a
greatly reduced pace for the duration; the held Character struggles free by
moving away from the grabber, or is released once the grabber's own hold limit
runs out; cooldown after. Connecting cancels an in-progress Dash for both
Characters, the same cancellation Hit causes.
_Avoid_: grapple, catch

**Hit**:
A short-range melee move, on its own cooldown like Dash. Connecting lands an
Impact on the target and cancels an in-progress Dash for both Characters.
_Avoid_: punch (that's the unrelated Power-up of the same name), attack, strike

### Items

**Item Box**:
A pickup on the Track that grants a random Power-up.
_Avoid_: crate, loot box

**Power-up**:
A single-use ability from an Item Box (e.g. Punch, Boomerang, Shield, Jump,
Rocket, Magnet, Bubble, Slow).
_Avoid_: item, ability, buff

### Meta

**Spectator Mode**:
The camera state a Player enters after a Fall that eliminates them — they follow a
Player still in the Round, and may switch between them. Lasts until the Round ends,
never longer: since ADR 0049 elimination is a Round's business, so the next Round
starts them playing again.

**XP**:
An Account's persistent progression number. Only ever increases; never spent, never staked.
Distinct from Score, which is Match-scoped and resets every Match.
_Avoid_: level, points, experience points (spell it XP)

**Coin**:
An Account's persistent, spendable currency — the only one. Spent on cosmetics and staked in a
Bet; never earned back by a Bet's own losers (the pot redistributes to winners, not the house).
_Avoid_: gem, gold, credits, currency (when you mean this specific one)

**Hat**:
A cosmetic an Account's Character wears on its head — at most one, seen by every Player, in every
Match and on every Screen that shows the Character. Unlocked by the Account's XP, never bought.
Purely visual: it changes nothing about how the Character moves, collides or is hit.
_Avoid_: headwear, accessory, helmet, cap (unless naming one hat)

**Bet**:
A wager an eliminated Player makes in Spectator Mode, staking Coins on which still-active Player
wins the Round. Odds move dynamically with how many Coins are staked on each Player (more staked
on a Player, shorter their odds); the pot is redistributed among winners with no cut taken (ADR
0052). Keeps eliminated Players engaged.
_Avoid_: wager, guess

**Skyfall**:
The signature Final Race concept — a tall vertical Track the last Players climb;
first to the top wins.

### Controls

**Control**:
One physical input a Player presses — a keyboard key or a mouse button. The
atoms gameplay actions bind to; UI chrome (Esc-back, form keys) is never one.
_Avoid_: key, button (when you mean the bindable concept)

**Key bindings**:
The mapping from gameplay actions (move, jump, dash, hit, grab,
spectate-next) to the Controls that drive them. One record per Account,
edited in Settings; guests keep theirs on their own machine.
_Avoid_: shortcuts, hotkeys, keymap

### Presentation

**Environment**:
The sky, clouds, fog and light a Round is drawn inside — a named preset
(`day`, `sunset`, `night`) its Track's author picks. Never collides, is never
simulated, and is never placed as a Segment. Contrast with Scenery, a placed
Module that may block a Character (ADR 0074).
_Avoid_: skybox, background, map theme, biome, weather

**HUD**:
The overlay drawn on top of the game view *during* a Round — Round timer, Dash
cooldown, Power-up held, Checkpoint splits. Rendered by the game itself as plain
DOM, never by the Screen framework (ADR 0008).
_Avoid_: overlay, interface, UI

**Screen**:
A full-viewport view shown *outside* a running Round — main menu, lobby,
settings, account/registration, results, the Bet screen. Screens are React
(ADR 0008).
_Avoid_: menu, page, view, route

**Flash message**:
A transient confirmation or failure note on the global overlay stack — visible on every Screen
until it fades or is dismissed. A failure flash is sticky until dismissed; actionable social
traffic (friend requests, Lobby invites) is not flashes — those stay as sticky alerts.
_Avoid_: notice, success message, popup. The style internals (`.toast` classes, the
`df-toast-*` keyframes) deliberately keep the design mock's own `toast` name so the live
styles diff 1:1 against `FriendRequestAlert` — that is the mock's visual vocabulary, not
this game's concept word.

## Networking

Its own subdomain. These terms mean this exact thing in code, commits, and ADRs;
concrete numbers (30 Hz, delays, window sizes) live in `docs/networking-model.md`,
not here.

**Tick**:
One step of the fixed-rate authoritative simulation. The unit of game time. The
server advances one Tick at a fixed rate; the client predicts at the same rate.
_Avoid_: frame (that is a render concept), step, update

**Snapshot**:
The authoritative world state at one Tick, as sent to clients — the wire form of
the simulation state. A Character's slice of a Snapshot is a `CharacterSnapshot`.
Note: **"state" alone is ambiguous** — say *motion state* for a Character's
Controlled/Stagger/Ragdoll/GettingUp, and *Snapshot* (or *sim state* for the
in-memory `SimState` object) for the networked world state. Never just "state".
_Avoid_: packet, update, world state

**Command** (**Input**):
One Tick's worth of a Player's intent, sent client → server. "Input" is the
existing code term (`SimInputs`); "Command" is the same thing in netcode prose.

**Prediction**:
The client running the shared simulation for its *own* Character immediately,
without waiting for the server, so movement feels instant. Only the local
Character, only input-driven state (ADR 0003).

**Reconciliation**:
Correcting the client's Prediction when a Snapshot disagrees: reset to the
server's state for the last acknowledged Tick, replay the unacknowledged
Commands (ADR 0013).

**Interpolation Delay**:
How far in the past the client renders everything it does *not* predict —
remote Characters, Props, ragdoll bones — so it always has two Snapshots to
interpolate between (ADR 0017, 0020).

**Authority**:
Who decides the true value of something. The server has Authority over all
game state; a client never asserts its own position, only sends Commands.

**Epoch**:
A monotonic counter identifying a discrete episode (a knockdown —
`ragdollEpoch`; a Respawn — `respawnCount`; a launch pad firing —
`launchPadEpoch`) so a one-shot effect fires exactly once even if the Snapshot
carrying it is seen across many frames. Never a one-Tick boolean.

**Contacted Prop**:
The one Prop the local Character is currently touching (plus a short grace after
last contact). It is the *only* Prop the client predicts — simulated locally,
its rendered pose eased toward the Snapshot by a decaying error offset. Every
other Prop is Interpolation-only (ADR 0022).

**Error Offset**:
The gap between where the client *renders* a predicted body and where its
physics body actually is. The body always holds the authoritative state; the
offset is what decays to zero over several frames so a Reconciliation eases in
instead of popping (Fiedler). One mechanism, two users: the Contacted Prop
(ADR 0022) and the local Character's own correction (ADR 0026).
