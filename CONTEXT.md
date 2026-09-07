# DON'T FALL

The glossary / ubiquitous language for DON'T FALL. These are the canonical terms
for code, comments, commits, and docs. This file is a glossary only — no
implementation detail, no decisions (those live in `docs/adr/`).

## Language
cz + en

### Participants

**Player**:
A human with an account who joins a Match. Persists across Matches.
_Avoid_: user, gamer

**Character**:
The in-world body a Player controls — a kinematic capsule with an attached
ragdoll. Exists only for the duration of a Match.
_Avoid_: avatar, player (when you mean the body), pawn

### Match structure

**Match**:
One full session from Lobby to a single winner, made of several Rounds.
_Avoid_: game, session

**Round**:
One run through a single obstacle course within a Match, played by one Round type.
Ends when that Round type's condition is met or the Time Limit expires; whoever
Qualified advances to the next Round.
_Avoid_: level, stage, kolo, heat

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
plain Race.

**Qualification**:
The condition for advancing out of a Round — reaching the Finish Zone, or being
among the survivors, before the Round ends.
_Avoid_: passing, promotion

**Elimination**:
A Player who did not Qualify before the Round ended. What eliminates you is the
Round type's rule: in a Race a Fall never eliminates, it only costs time through
Respawn with a penalty; in Survival it is exactly what does.
_Avoid_: death, KO

**Time Limit**:
The countdown for a Round. When it hits zero, every Player not yet Qualified is
eliminated. Preferred over a fixed "first N players" cutoff. Each Revision carries
its own default Time Limit — a longer Track allows more time; the lobby shows it and
the server enforces it.

**Finish Zone**:
The area at the end of a Race that grants Qualification on entry. Deliberately an
area, not a line, so the end of a Round stays chaotic and contested. A detection-only
trigger entity on a Module — like a Checkpoint's trigger region, never a Volume;
distinct from Checkpoint, which sets a Respawn point.
_Avoid_: finish line, goal

**Lobby**:
The gathering before a Round — nicknames, ready toggles, Track selection, host start.
Ends when the host starts the Countdown.
_Avoid_: waiting room

**Countdown**:
The short delay between Start and the live Round. Characters are already spawned but
their input is locked.
_Avoid_: warmup

**Results**:
The Screen after a Round ends — rank with Qualified ordered by finish time and the rest
by Track progress, and a way back to the Lobby.
_Avoid_: scoreboard, leaderboard

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

**Module**:
A reusable template for a piece of Track (e.g. "Spinner", "Ice", "Moving
Platforms", "Straight", "Gap"). Authored once.
_Avoid_: prefab, block, piece

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

**Speed pad** / **Slow pad**:
A floor trigger that fires once as a Character crosses it: an instant velocity write
plus a temporarily raised (speed pad) or lowered (slow pad) speed cap that fades back
to normal. One mechanism, cap raised or lowered — never two separate ones. Contrast
with Surface (a standing property of the floor itself, with no one-shot component) and
Volume (continuous, not latched).
_Avoid_: boost pad, zipper, jump pad (that's a bounce/launch pad, a different mechanic)

**Segment**:
One concrete instance of a Module placed at a position in a Track. A Track is a
sequence of Segments.
_Avoid_: section, tile, chunk, piece

**Obstacle**:
A Module (or part of one) that actively threatens the Character — a Spinner,
Pendulum, Falling Tiles. Contrast with connective Modules like Straight and Gap.
_Avoid_: hazard, trap

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
A point on the Track that a Character respawns at after a Fall.

**Spawn**:
Where Characters start a Round, or reappear after a Respawn.

### Character state & physics

**Controlled**:
The Character state where the Player has normal movement input over the kinematic
capsule.

**Stagger**:
A brief Character state after a minor Impact — movement input is dampened but the
Character stays upright. Recovers automatically to Controlled.

**Sliding**:
The Character state on a Surface too steep to walk on: the Character keeps
reduced movement input while gravity carries it down the slope. Held by the
condition (standing on such a Surface), not by a timer — unlike Stagger. An
Impact while Sliding knocks the Character straight into Ragdoll.
_Avoid_: slipping, skidding

**Ragdoll**:
The Character state where the articulated body takes over full physics and the
Player has no movement control. Triggered by a hard Impact, a Fall, or dashing
into a wall.

**GettingUp**:
The Character state that blends the ragdoll back into a standing pose and
re-activates the kinematic capsule. Recovers to Controlled.
_Avoid_: recovery (as a noun for the state — use GettingUp), standup

**Wobble**:
The procedural, non-simulated lean/sway of the Character's visual mesh while
Controlled. Cosmetic only; it never affects collision.

**Impact**:
A collision forceful enough to change Character state — into Stagger or Ragdoll
depending on magnitude.

**Impact Reaction**:
The visible response to an Impact (flinch, spin, knockdown).

**Fall**:
The core failure. A Character leaves the play volume (drops below the kill-plane).
What follows is the Round type's rule: a Race Respawns it at the last Checkpoint
with a time penalty, Survival eliminates it. "Don't fall" is this.
_Avoid_: death, out of bounds, KO

**Respawn**:
Returning a fallen Character to its last Checkpoint, with a short time penalty so
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
The camera state a Player enters after a Fall that eliminates them — they watch
the remaining Players.

**Bet**:
A prediction an eliminated Player makes in Spectator Mode about who wins the
Round, for XP / coins. Keeps eliminated Players engaged.
_Avoid_: wager, guess

**Skyfall**:
The signature Final Race concept — a tall vertical Track the last Players climb;
first to the top wins.

### Presentation

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
`ragdollEpoch`; a Respawn — `respawnCount`; a speed/slow pad firing —
`speedPadEpoch`) so a one-shot effect fires exactly once even if the Snapshot
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
