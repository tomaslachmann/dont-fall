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

**Bot**:
A Character's driver that is not a human: the authority produces its inputs each Tick. It takes
part in a Match like a Player and looks like one on every Screen, but has no Account, so it
keeps nothing after the Match.
_Avoid_: AI, NPC, CPU, computer player

**Friend**:
A mutual connection between two Accounts, formed by request/accept. Carries presence (Online / In
Match / Idle) between Friends. Distinct from a Party: a Friend is a standing connection, a Party is
who you play with right now.
_Avoid_: contact, buddy

**Party**:
Up to four Accounts who play together: they go into a Lobby as one, wherever their Party host takes
them, and are seated together (ADR 0112). Everyone signed in is in one; alone, it is a party of one.
Lasts while its members are online.
_Avoid_: group, squad, team (a Team Round's word)

**Party host**:
The member of a Party who moves it, invites and removes: the earliest to have joined. The others
follow.
_Avoid_: leader, owner (a Lobby's host is the Lobby's own)

**Party code**:
The six characters that let anyone join a Party for ten minutes, shown only to its Party host.
Distinct from a Join Code, which opens a Lobby, and a friend code, which finds an Account.
_Avoid_: invite code

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

**Elimination credit**:
Who put an Eliminated Player out, and how — the last other Character to Grab,
Hurl or Hit them shortly before the Fall that eliminated them. Nobody, when
their own Fall was theirs alone.
_Avoid_: knockout (a Knockdown is what a hard Hit does), kill

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

**Reservation**:
A seat a Lobby keeps for one Account for a few seconds after the broker sends it there, so a Party
walking in behind its host is never split or started without (ADR 0112).
_Avoid_: hold (a Grab's word), booking

**Loading**:
The phase between a Round being started and its Countdown: every Player's client
builds that Round's Track and says so, and the Round waits for all of them. Shown
as the Track's own screenshot and name (ADR 0089).
_Avoid_: preload, buffering, waiting room

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
A Track being composed — mutable, not yet published. It lives either in the
Track builder's own tab or stored in the API, where the builder and the MCP
server open the same one. Publishing a Draft creates a new Revision; the
Draft itself is never what a Round runs on.
_Avoid_: track (when you specifically mean the mutable, in-progress one)

**Revision**:
One immutable, numbered publish of a Track — the only form a Round ever runs
on. Publishing a Draft again creates a new Revision; an existing Revision is
never mutated.
_Avoid_: version, save

**Thumbnail**:
One Revision's screenshot — the JPEG its author framed in the Track builder
just before saving (for a code-authored Track, rendered from a camera written
beside it), shown in Discover, the Lobby, between Rounds and on the Round
loader. A Revision published without one simply has none.
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
Which group the Track builder and the MCP server list an Asset Module under, on
one axis — what the piece is to a runner: **Floor** (what you stand on),
**Structure** (what holds the route up or walls it in, and is not stood on),
**Sweeper** (what moves into you), **Launcher** (what throws you), **Gate**
(what you pass through), **Prop** (a loose shape to shove) and **Scenery** (the
dressing). A listing property: it gives a Module no behavior of its own, and a
mechanic never moves a piece between groups — a spiked or breaking deck is a
Floor wearing its own field. Two groups are the exception, named after a
mechanic every member carries in its def: a Gate its opening, a Launcher its
throw (a Spring's launch, a fan's updraft Volumes).
_Avoid_: type, kind, tag, platform / obstacle / spring / fan (the groups before ADR 0122)

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
on it. Some Surfaces can also take a Character's feet (see Slip). A property of
floor geometry, never a kind of Module — one Module may mix Surfaces across its
floor pieces.
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
An Asset that is a Launch pad — a coil or a spring pad you bounce off, listed
under the Launcher Asset category. Its author sets how high it throws, in metres, and aims it
by tilting the Segment. It fires when a Character is standing on it, never while
one is still falling toward it; it squashes as it fires, and the squash is drawn,
never simulated.
_Avoid_: bouncer, jump pad, trampoline, spring pad

**Segment**:
One concrete instance of a Module placed at a position in a Track. A Track is a
sequence of Segments.
_Avoid_: section, tile, chunk, piece

**Attachment**:
Something authored on one Segment on top of where it stands: its Motion (or one per
moving Part), a
Conveyor, ice, mud or bounce, a Spring's height, being a Prop, being Fragile, a
Shooter's numbers, the Start, a Checkpoint. Where the Segment stands — its position, orientation and size — is
not an Attachment.
_Avoid_: modifier, annotation, flag, option

**Motion**:
The authored, endlessly repeating movement of one Segment: a Spin (constant
rotation about an axis), a Swing (rotation back and forth) and/or a Slide
(movement back and forth), in that order. A pure function of the Tick, so every
Player sees the same pose without it being sent. A Segment with one is a
Moving Segment.
_Avoid_: animation, tween, mover

**Ramp**:
How a Motion speeds up over a Round: from its own pace to N times it, over T
seconds from when the Round starts running, then held.
_Avoid_: acceleration, easing (the curve of one Swing or Slide), speed-up

**Motion Clock**:
The Tick a Round runs from, which every Ramp counts from. Outside a Round there
is none, and a Ramp does nothing.
_Avoid_: round timer, start time

**Ride**:
What a Character standing on a Moving Segment does: it is carried along, turned
with it, and keeps its speed when it leaves.
_Avoid_: attach, parent, stick

**Part**:
One named piece of an Asset with a body of its own: still (it never moves),
moving (it moves on the Tick, like a sweeper's rotor) or gated (it is only
solid at rest, like a trap door's leaves). An Asset with Parts is still one
Segment to its author and to a stored Track — the split happens when the world
is built.
_Avoid_: sub-mesh, bone, child, group

**Punching Glove**:
An Asset whose glove shoots out of a wall box and pulls back on a clock. There
is no glove at all until it punches. (Firing when a Character comes within
reach is designed and not yet built — ADR 0121.)
_Avoid_: puncher, hammer, boxer

**Trap Door**:
An Asset whose two leaves fall open and shut on a clock. Its floor exists only
while they are closed: a Character over an opening door falls rather than
riding it down.
_Avoid_: hatch, pit

**Fragile**:
An Attachment that gives a Segment three states. Every new arrival of a
Character on it — a landing and a walk-on alike, standing still never — costs
one; on the third it stops being a floor, and it returns after the delay its
author set.
_Avoid_: breakable, crumbling, falling tile

**Shooter**:
An Asset that fires a Projectile along its barrel every so often, aiming on
two axes that sweep independently — the carriage side to side, the barrel up
and down. Its author sets how often, how fast, how long a ball lasts, and each
axis' own range and clock.
_Avoid_: cannon, turret, gun

**Spiked**:
An Asset whose every contact knocks a Character down, whatever the speed —
standing on it, running into it, or being moved into it.
_Avoid_: deadly, lethal (a knockdown is never a Fall)

**Obstacle**:
A Module (or part of one) that actively threatens the Character — a Spinner,
Pendulum, Falling Tiles. Contrast with connective Modules like Straight and Gap.
The general word, not an Asset category: an Obstacle is filed under whatever it
is to a runner, usually Sweeper.
_Avoid_: hazard, trap

**Sweeper**:
The Asset category of the bodies meant to be swept through a route on a Motion —
a bar, a disc, a hammer, a hanging ball, and the Assets that act by themselves
(a shooter, a punching glove). The piece is static geometry until its Segment
carries a Motion or its def a mechanic; the category says what it is for.
_Avoid_: obstacle (the general word), trap

**Floor**:
The Asset category of everything a Character stands on: decks, slopes, stairs,
curves, a belt, a trap door, a breaking block, a spiked plate. The route itself.
A newly inserted Floor continues the run off the last one; everything else
stands on the middle of its top.
_Avoid_: platform, ground, deck (a deck is one Floor's top face)

**Structure**:
The Asset category of what holds a route up or walls it in and is not stood on —
pillars, struts, bracing, barriers, pipes.
_Avoid_: support, scaffolding, prop (see Prop)

**Launcher**:
The Asset category of everything that throws a Character: the Springs and the
fan. Every member carries its throw in its own def.
_Avoid_: booster, pad

**Scenery**:
A Module that neither carries the route nor threatens the Character — a sign,
a flag, a railing, a fence. It may still block a Character that runs into it.
Contrast with Sweeper and with Floor-category pieces. Also the Asset category
that lists them.
_Avoid_: decoration, prop (see Prop)

**Prop**:
A dynamic physics body that reacts to being bumped (a box, a ball) but never
threatens the Character on its own. Contrast with Obstacle. Also the Asset
category of the loose shapes — balls, cones, Bombs — that a Segment turns into
one (ADR 0095); placed without that, such a shape just stands there. A Bomb
is always one. One light
enough can be picked up with Grab, carried, put down, Tossed or Hurled; a thrown
one hits by its weight and speed, one that is only rolling hits nobody.
_Avoid_: crate (see Item Box), object, decoration

**Projectile**:
A dynamic physics body spawned at runtime by a Shooter, with an initial
velocity, that threatens the Character on contact and despawns after its
lifetime — a ball, or a Bomb fired lit, whose lifetime is its fuse. Both sides derive its birth from the Tick, so no message announces
it; its flight replicates as a Prop's does. Contrast with Prop (permanent,
never threatens) and Obstacle (stationary, pre-placed).

**Bomb**:
A Prop with a fuse. Lying, it is a Prop like any other. Picking it up lights
it, and it stays lit however many hands it passes through. When the fuse runs
out it goes off wherever it is: every Character near it is knocked down or
Staggered and thrown away from it, Props near it are pushed, and the last one
to hold it is credited. Then it is gone for a while, and comes back where it
was placed.
_Avoid_: grenade, mine, explosive

**Blast**:
A Bomb going off, and the knockdown it causes: one push away from its
middle, strongest there and weakest at the edge of its reach.
_Avoid_: explosion (the drawn effect, not the event)
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

**Slip**:
A knockdown the floor causes: the Character's feet go out from under it on a
treacherous Surface — a hard landing on ice or in mud, or running or turning
sharply in mud. Always a chance, never a certainty. Not Sliding, which the
Character stays on its feet through.
_Avoid_: trip, stumble, fall (a Fall is leaving the play volume)

**Ragdoll**:
The Character state where the articulated body takes over full physics and the
Player has no movement control. Triggered by a hard Impact, dashing into a
wall, a Slip, a Hurl, or being let go of while Limp. (A Fall no longer triggers it: see Wobble.)

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
Latching onto a Character just ahead of you — upright or already knocked down —
and carrying it at arm's length in front of you. An upright one gets a Struggle
to break free; one that loses it, or was already down, goes Limp. While holding,
the grabber walks and turns slower and can do nothing else but Spin or let go
(Grab again). A hold ends on a Hurl, a let-go, the Struggle won, the Limp window
running out, or the grabber going down; cooldown after, and Grab immunity for
whoever was held. Connecting cancels an in-progress Dash for both Characters,
the same cancellation Hit causes. With no Character in reach, Grab picks up a
Prop light enough instead: carried until put down, Tossed, Hurled or dropped,
the carrier slower, turning slower and jumping lower the heavier it is, never
Dashing.
_Avoid_: grapple, catch

**Held**:
The Character state of being carried by a grabber: the Player's input does
nothing but the Struggle, and the body goes where the grabber takes it.

**Struggle**:
What a Held Character does to break free — wiggling, i.e. reversing its movement
input again and again, to fill an escape meter before a window runs out. Winning
it frees the Character on its feet; losing it leaves it Limp.
_Avoid_: mash, QTE, escape (as the name of the mechanic)

**Limp**:
The part of a hold after a lost Struggle, or when the Character was grabbed
already down: unconscious in the grabber's hands, with no input and no getting
up, for a short window of the grabber's. Released, a Limp Character goes into
Ragdoll for a whole knockdown. Not Ragdoll itself — nothing gets up while Limp.
_Avoid_: ragdoll (for the carried body), unconscious (as a state name)

**Spin**:
Holding Hit while holding someone: the grabber stands still and turns ever
faster, swinging the held body round. A swung body knocks down whoever it passes
through. Spin too long past full speed and the grabber gets dizzy and goes down,
flinging the held Character away weakly.
_Avoid_: wind-up (that is only its first half), twirl

**Hurl**:
Letting go of Hit to end a Spin: the held Character leaves along the circle —
pulled toward where the grabber is steering — as a knockdown, further the faster
the Spin was. A hurled body knocks down whoever it lands on. A carried Prop is
Hurled the same way.
_Avoid_: throw (what a knockdown does to the body)

**Lift**:
Bending down for a Prop that Grab reached for and standing up with it. The
carrier stands still throughout. The Prop is picked up only when the hands
reach it, partway through. One flying past is caught instead, with no Lift.
_Avoid_: pick-up animation, grab (a Grab at a Character)

**Toss**:
A tap of Hit while carrying a Prop: a short wind-up, standing still, and then
it leaves straight ahead, faster the lighter it is. Held longer, Hit is a Spin
instead.
_Avoid_: hurl (the Spin's release), drop (what a knockdown does to a carried Prop)

**Grab immunity**:
A short spell after a hold ends, lasting until shortly after the released
Character is back on its feet, during which nobody can grab it again.

**Hit**:
A short-range melee move, on its own cooldown like Dash, charged by holding the
button. Connecting lands an Impact on the target and cancels an in-progress
Dash for both Characters. A Hit that doesn't knock the target down still shoves
it; one that does throws it.
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

**Skin**:
Authored art painted over a Character's whole body through its UV map — at most one, unlocked by
the Account's XP like a Hat, and seen by every Player the same way. A Skin covers the body and
nothing else: the eyes keep their own look and a Hat keeps its own colours. Purely visual.
_Avoid_: texture, costume, outfit, pattern, character (when you mean the art it wears)

**Colour**:
The flat tint a Character's body wears when it has no Skin on — the plainer of the two ways a bean
can look, and never blended with one: a Skin wins outright. Every Account has a Colour and none are
locked.
_Avoid_: body skin (its old name), tint, palette, dye

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
The mapping from a Player's actions (move, jump, dash, hit, grab,
spectate-next, and Push-to-talk, the one that is not a gameplay action) to
the Controls that drive them. One record per Account, edited in Settings;
guests keep theirs on their own machine.
_Avoid_: shortcuts, hotkeys, keymap

### Voice chat

**Voice chat**:
Players talking to each other out loud, from joining a Lobby until they leave the podium at the end
of its Match (ADR 0111). Never part of the simulation.
_Avoid_: voice (already the audio engine's word for one playing sound, and the announcer's), VOIP,
comms

**Voice chat scope**:
Whom a Player's Voice chat reaches: OFF, PARTY or ALL. OFF neither sends nor hears.
_Avoid_: channel, mode

**Voice link**:
Two Players who hear each other: neither is OFF, and they share a Party or both chose ALL. Always
both ways.

**Push-to-talk**:
Sending Voice chat only while its Control is held. The other way to talk is open mic, which sends
whenever the Player's own voice is loud enough.
_Avoid_: PTT (except as a label), voice activation (for push-to-talk)

**Speaking**:
The cue that a Player's Voice chat is being heard right now.
_Avoid_: talking indicator, voice activity

**Mute**:
One Player silencing another for themselves only, remembered on their Account. Distinct from
OFF, which silences both ways.
_Avoid_: block (reserved for something stronger, if one is ever built), ignore

### Presentation

**Environment**:
The sky, clouds, fog and light a Round is drawn inside — a named preset
(`day`, `sunset`, `night`) its Track's author picks. Never collides, is never
simulated, and is never placed as a Segment. Contrast with Scenery, a placed
Module that may block a Character (ADR 0074).
_Avoid_: skybox, background, map theme, biome, weather

**HUD**:
The readout drawn on top of the game view *during* a Round — in a Race your
placement, the Round clock, Checkpoints reached, your Split and Personal Best;
in Survival how many are still standing. A React overlay over the live game that
never covers it (ADR 0088).
_Avoid_: overlay, interface, UI

**Split**:
Your gap, at the last Checkpoint you reached, to whoever reached it first — or,
when you were first, your lead over whoever reached it next.
_Avoid_: delta, gap time, interval

**Personal Best**:
An Account's fastest finished Race run on a Track, across all its Revisions.
_Avoid_: PB (except as the HUD's own label), record, best time

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

**Account socket**:
The one connection a signed-in client keeps to the API, outside any Lobby, over which the API tells
it what arrived unasked (its Party, Party and Lobby invites, "follow your Party host") and it says
where it is (ADR 0112). Distinct from the Lobby's socket to its Match server.
_Avoid_: presence socket, notification channel, heartbeat (what it replaced)

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
interpolate between (ADR 0017, 0020). Counted back from the Playout Floor.

**Playout Floor**:
How late the least-delayed recent Snapshot arrived, measured against its own
Tick — the point the Interpolation Delay is counted back from (ADR 0109).

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
