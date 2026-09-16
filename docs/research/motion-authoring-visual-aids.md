# Research: visual aids for authoring moving obstacles

Date: 2026-09-15. Primary sources only; anything else is marked unverified.

## Question

How do editors aimed at non-experts let people author and *understand* moving/rotating obstacles
and their timing (speed, easing, pauses at ends, phase offset) visually, and how do they show
"what happens at this moment" and when/where it is dangerous?

## Our context

The Track builder's Motion panel, per selected Segment, already exposes:

- **Spin** — constant °/s, axis, pivot; one-click shapes (Carousel / Arm / Drum); a 3×3 pivot grid;
  ⟲/⟳ direction; pick-pivot-on-model.
- **Swing** — ±amplitude, period (s), easing (linear / easeIn / easeOut / easeInOut), pause at each
  end (s), phase 0–1, pivot.
- **Slide** — offset x/y/z, period, easing, pause, phase.

The viewport already has a global transport (Pause/Play, a 0–60 s time scrubber, restart), a guide
(pivot dot + axis line, slide arrow) and an **Impact tint** that colours moving surfaces green
(push/carry), yellow (Stagger, closing speed ≥ ~6.7 m/s) or red (Ragdoll, ≥ 15 m/s); spiked
surfaces are always red.

Back-and-forth math: travel out over `(period − 2·pause) / 2` with the easing, hold `pause`, travel
back mirrored, hold `pause`; `phase` shifts the cycle. Goal: "as idiot-proof as possible" while
keeping every existing field.

## Sources

### 1. easings.net

Source: https://easings.net/ (fetched 2026-09-15; the page is script-rendered, so only the static
text and asset references were readable).

- **Index = a grid of curve thumbnails**, one card per function, grouped by family (Sine, Quad,
  Cubic, Quart, Quint, Expo, Circ, Back, Elastic, Bounce) × three directions (easeIn / easeOut /
  easeInOut). The name is the label, the *curve* is the primary affordance — you pick by shape,
  not by reading. https://easings.net/
- **Per-function detail** (e.g. https://easings.net/#easeInOutCubic): a larger curve graph,
  "This function" vs "Linear function" side by side, the math as code with the note that `x` is
  progress from 0 (start) to 1 (end), the CSS `cubic-bezier` value, and **motion demos labelled
  "Size", "Position" and "Transparency"** — the same easing applied to three concrete properties so
  the reader sees what the curve *feels* like. https://easings.net/
- A "Check easing for changes" comparison toggles between Sizes / Positions / Transparencies.
  https://easings.net/
- Unverified from the static text: whether a dot animates *along* the curve in sync with the demo
  (the page's JS did not render in the fetch).

Patterns: **curve thumbnail as the picker**; **side-by-side against linear**; **the same easing
shown on a moving object**. Novice-oriented (web designers, no math needed). No timeline, pause,
phase or danger concept — it covers a single 0→1 transition only.

### 2. Godot: Tween, EaseType, TransitionType, the easing property widget

Sources: https://docs.godotengine.org/en/stable/classes/class_tween.html;
https://docs.godotengine.org/en/3.6/tutorials/scripting/gdscript/gdscript_exports.html (via search
snippet). The `@GlobalScope` page (`ease()`, `PROPERTY_HINT_EXP_EASING`) was truncated in the fetch —
**not verified**.

- Easing is split into two orthogonal enums: **TransitionType** (the curve family: LINEAR, SINE,
  QUAD, CUBIC, QUART, QUINT, EXPO, CIRC, ELASTIC, BOUNCE, BACK, SPRING) and **EaseType** (which end
  is slow). Each has a one-line plain-English description, e.g. EASE_IN "starts slowly and speeds up
  towards the end", EASE_IN_OUT "slowest at both ends", EASE_OUT_IN "fastest at both ends".
  https://docs.godotengine.org/en/stable/classes/class_tween.html
- The class reference links a **"Tween easing and transition types cheatsheet"** image — a static
  grid of curves, the same idea as easings.net's thumbnails, but as documentation rather than in the
  editor UI. https://docs.godotengine.org/en/stable/classes/class_tween.html
- Timing primitives map one-to-one onto our fields: `tween_interval()` is a pause ("an alternative
  to using the delay in other Tweeners"), `set_loops()` with no argument loops forever,
  `chain()`/`parallel()` sequence steps, `set_speed_scale()` "affects all Tweeners and their
  delays". https://docs.godotengine.org/en/stable/classes/class_tween.html
- Editor widget: in Godot 3.x, `export(float, EASE)` makes the Inspector "display a visual
  representation of the `ease()` function when editing" — a small curve you drag, instead of a
  number. Godot 4's equivalent is `@export_exp_easing`.
  https://docs.godotengine.org/en/3.6/tutorials/scripting/gdscript/gdscript_exports.html (exact
  Godot 4 wording unverified).

Patterns: **plain-language one-liner per easing** ("slowest at both ends"); **inline curve drawn in
the property row** in place of a number. Programmer-oriented overall; the Tween API itself has no
preview. Its descriptions show that our four easing names only need a single sentence each.

### 3. Unity: AnimationCurve / Curve Editor presets

Sources: https://docs.unity3d.com/Manual/EditingCurves.html (fetched);
https://docs.unity3d.com/6000.0/Documentation/Manual/InspectorCurves.html and
https://docs.unity3d.com/420/Documentation/Manual/EditingValueProperties40.html and
https://docs.unity3d.com/ScriptReference/WrapMode.PingPong.html (search snippets only — wording
**not verified** against the full pages).

- **Small curve preview in the Inspector row**: an AnimationCurve property is drawn as a thumbnail of
  its curve; clicking it opens the Curve Editor. (InspectorCurves, via snippet)
- **Preset row**: the Curve Editor lets you "edit a curve or choose from one of the presets", and
  you can save the current curve as a preset and organise presets into libraries. (Unity 4.2
  EditingValueProperties / 6000.0 InspectorCurves, via snippet)
- **Wrapping mode Ping Pong / Clamp / Loop** decides what happens past the last key; Ping Pong plays
  back and forth — the exact back-and-forth semantics of our Swing and Slide.
  https://docs.unity3d.com/ScriptReference/WrapMode.PingPong.html (via snippet)
- **Tangent modes** (right-click a key): "Clamped Auto" (default, avoids overshooting), "Auto",
  "Free Smooth", "Flat", "Broken - Free / Linear / Constant" ("retains a constant value between two
  keys", i.e. a hold). https://docs.unity3d.com/Manual/EditingCurves.html

Patterns: **curve thumbnail in the property row**; **preset shapes one click away**; a **named
wrap mode** for loop vs ping-pong. Pro-leaning (free tangents), but thumbnail + presets are the
novice layer on top.

### 4. Blender: Graph Editor interpolation and easing

Sources: https://docs.blender.org/manual/en/latest/editors/graph_editor/fcurves/properties.html and
`.../fcurves/editing.html` both returned **HTTP 403** to the fetcher. What follows is from search
snippets of the properties page and of
https://docs.blender.org/api/current/bpy_types_enum_items/beztriple_interpolation_easing_items.html
— **unverified** against the full text.

- Keyframe interpolation is grouped into categories: plain modes (Constant / Linear / Bezier),
  **Easing** (Sine, Quadratic, Cubic, …) and **Dynamic Effects** (Back, Bounce, Elastic). (properties
  page, via snippet)
- A separate **Easing** setting (Automatic / Ease In / Ease Out / Ease In and Out) applies to the
  Easing and Dynamic Effects categories; "automatic" picks Ease In for Easing types and Ease Out for
  Dynamic Effects. Ease In and Out is described as moving slowly at the start, faster in the middle,
  slowly again at the end. (properties page, via snippet)
- Direction is described in terms of *motion*, not math: for Back, Ease In "first moves away from
  the target and then shoots towards it", Ease Out "overshoots it, and then returns". (via snippet)
- Unverified: whether the interpolation popup shows a curve icon beside each entry.

Patterns: **category → shape → direction** as separate choices; **direction described as what the
object does**. Pro-oriented; the takeaway for us is the wording, not the widget.

### 5. Fortnite Creative / UEFN: Prop Mover

Source: https://dev.epicgames.com/documentation/en-us/fortnite/using-prop-mover-devices-in-fortnite-creative
(fetched).

- **Speed is a number with a unit, not a period**: Distance default "20 Meters" / "4.0 Tiles",
  Speed default "5.0 meters/second" / "1.0 tile/second" — the author sets how *far* and how *fast*,
  and the time falls out.
- **End behaviour is a named dropdown**: "Path Complete Action" (and "Rotation Complete") with
  "None" (stop), "Ping Pong" (reverse), "Repeat" (restart), "Reset" (return to start). The docs'
  own gloss for Ping Pong is concrete — objects "that oscillate back and forth, like the bar on a
  metronome or a bridge that raises and lowers" (search-result snippet of the same page).
- **Timing offset = "Delay From Start"** (default 0.0, hidden when "Should Move From Start" is Off)
  — a start delay in seconds, not a 0–1 phase.
- **Danger is an explicit, per-target setting, not a derived tint**: "On Player Collision
  Behavior" = Continue / Stop / Reverse / Push (default Stop), plus "Player Damage On Collision"
  (default 10.0); the same pair exists for AI and props (props get no Push).
- No pause-at-end duration, easing, or in-editor path preview appeared in the fetched page
  (absence not independently verified).

Patterns: **speed as distance + m/s**; **named end behaviour**; **delay instead of phase**;
**collision consequence chosen, not computed**. Novice-oriented: a flat settings list, no curves.

### 6. Fall Guys Creative: movement / rotator modules

Sources: https://www.fallguys.com/en-US/news/fall-forever-update (fetched);
https://dev.epicgames.com/documentation/en-us/fortnite/working-with-fall-guys-islands-in-fortnite-creative
(fetched). **No first-party page documenting the settings of Fall Guys Creative's movement or
rotation modules was found.**

- The only first-party statement on the Fall Forever update page: Rotation Controllers let you
  "set a selection of objects to rotate". No settings described.
  https://www.fallguys.com/en-US/news/fall-forever-update
- Fall Guys islands inside Fortnite Creative reuse the **Prop Mover** (§5) for moving obstacles and
  point to Verse ("Animating Prop Movement") for rotating fans and other rotating obstacles — so in
  UEFN the novice path *is* §5's settings list and the advanced path is code.
  https://dev.epicgames.com/documentation/en-us/fortnite/working-with-fall-guys-islands-in-fortnite-creative
- **Unverified (fan wiki, not primary)**: Fandom's "Rotation Controller" / "Movement Controller"
  pages say creators set **speed and start delay** and whether linked objects keep their
  orientation. https://fallguysultimateknockout.fandom.com/wiki/Rotation_Controller
- Easing, pause-at-end or path preview: nothing primary found.

Takeaway (weak evidence): the closest reference game gives novices **speed + start delay** and no
curves at all.

### 7. Roblox: TweenService, EasingStyle / EasingDirection

Sources: https://create.roblox.com/docs/reference/engine/enums/EasingStyle (fetched);
https://create.roblox.com/docs/ui/animation (fetched).

- **The API reference has no pictures**: the EasingStyle enum page is a table of names and numeric
  values only (Linear, Sine, Back, Quad, Quart, Quint, Bounce, Elastic, Exponential, Circular,
  Cubic). https://create.roblox.com/docs/reference/engine/enums/EasingStyle
- **The how-to guide does**: it carries a figure captioned "Graphs of EasingStyle variations with an
  'In' EasingDirection" and one-line *comparative* descriptions — Linear "Moves at a constant
  speed", Sine "a gentle easing motion", Quad "slightly sharper" than Sine, …, Back "Slightly
  overshoots the target, then backs into place". https://create.roblox.com/docs/ui/animation
- Direction wording is abstract: In "applies in a forward direction", Out "in a reverse direction",
  InOut "forward for the first half and in reverse for the second half" — noticeably harder to read
  than Godot's "starts slowly and speeds up" (§2). https://create.roblox.com/docs/ui/animation
- Unverified (TweenInfo reference not fetched): `TweenInfo` bundles time, style, direction, repeat
  count, a `reverses` flag and a delay — our Swing/Slide field set minus phase.

Patterns: **a curve figure next to the choice** (in learning material only); **names ordered by
"sharpness"**. Programmer-oriented. Lesson: describe easing by what the object does, not direction.

### 8. Optional: Dreams / LittleBigPlanet, Super Mario Maker 2

**Dreams** — source: https://docs.indreams.me/en-US/create/resources/edit-mode-guide/assembly/animate
(fetched).

- **Animation path drawn on hover**: after recording a move, "Notice the dotted line when you hover
  the platform. This is the *animation path*." The path is shown on demand, on the object itself.
- **Record, don't type**: the Action Recorder records you moving the object ("stop recording" /
  "retake"); Record Possession adds a 3-second "count-in". Timing is authored by *doing* it.
- **Ping-pong is a playback mode** of the recording ("set *playback mode* to *ping-pong*").
- **Timeline with a playhead**: "If you run it with the *timeline* open you can see the *playhead*
  pass over the *gadgets*"; keyframes sit on the timeline and you "cycle through" blend types between
  them. A search snippet also names "Blend Type, Ease Strength, Smoothing and Springiness" controls
  (unverified). Mover/Rotator speed presentation: not read.

Patterns: **path line on the object**; **timeline + playhead synced to the running scene**;
**record-by-demonstration**. Novice-oriented, console-controller-first.

**LittleBigPlanet** — not researched (budget). **Super Mario Maker 2** — a search of Nintendo's
official sites returned only ON/OFF-switch marketing text, no manual page for Tracks; **not found**.

## Cross-source summary

| Pattern | Seen in | Novice value for us |
|---|---|---|
| Easing picked from curve thumbnails, not names | easings.net, Unity Inspector, Godot `EASE` hint, Roblox guide figure | High — our easing is a text dropdown today |
| One plain sentence per easing ("slows down before it stops") | Godot EaseType, Roblox guide, Blender Easing | High, near-free |
| Path line on the object | Dreams (dotted animation path on hover) | High for Swing/Slide |
| Timeline + playhead in sync with the running scene | Dreams timeline | High — we already own the global clock |
| Named end behaviour (Ping Pong / Repeat / Reset) | Prop Mover, Unity wrap mode, Dreams playback mode | Medium — ours is fixed back-and-forth |
| Speed as distance + m/s instead of period | Prop Mover | Medium — a derived readout, not a new field |
| Start delay instead of 0–1 phase | Prop Mover "Delay From Start", Fall Guys (fan wiki, unverified) | Medium — explains phase in seconds |
| Collision consequence as an explicit setting | Prop Mover "On Player Collision Behavior" | Low — our Impact tint derives it, which is better |
| Ghost/onion-skin of end positions | **not found in any primary source read** | Our own idea; not backed by research |
| Per-moment danger / hitbox preview | **not found** (Prop Mover sets damage, shows nothing) | Our Impact tint is already ahead of every source |

## Recommendation

What the research says overall: every novice-facing tool reviewed hides the *math* (curves, phase)
and shows either a **shape** (curve thumbnail) or the **motion itself** (path line, playhead over the
running scene). None of them shows danger over time — our Impact tint is already ahead there, so the
aids below should *reuse* it rather than invent a second danger language. All four can sample the
existing pure functions in `packages/shared/src/track/Motion.ts` (`easeMotion`, `backAndForth`,
`motionPose`, `motionPointVelocity`), so each picture is the simulation's own output, not a copy.
No existing field is removed.

### 1. One-cycle timing strip with a live playhead (Swing / Slide)

- **Looks like**: a ~100 px tall strip under the timing fields. X = one period (0 … period s),
  Y = position from start end to far end. The eased travel out, the flat hold (shaded, labelled
  "wait 0.5 s"), the mirrored travel back and the second hold are all visible as shapes. A vertical
  playhead moves in sync with the viewport transport (`(time + phase·period) mod period`), and
  dragging it scrubs the global clock. The curve line is coloured by the Impact band of the
  Segment's fastest point at that moment (green / yellow / red), so "it's dangerous in the middle of
  the swing, safe at the ends" is read straight off the strip.
- **Follows**: easings.net's curve-as-picture and "this function vs linear" graph
  (https://easings.net/); Unity's curve preview in the property row
  (https://docs.unity3d.com/6000.0/Documentation/Manual/InspectorCurves.html, snippet-verified only);
  Dreams' timeline with a playhead that passes over the gadgets while the scene runs
  (https://docs.indreams.me/en-US/create/resources/edit-mode-guide/assembly/animate). The danger
  colouring has no precedent in any source read — it is ours.
- **Build**: one `<canvas>` or inline SVG in `motionPanel.ts`; sample `backAndForth` ~120 times on
  field change; per sample, speed from `motionPointVelocity` at the Segment's farthest point mapped
  through the same shared constants the shader tint in `impactTint.ts` uses
  (`MOVING_SEGMENT_STAGGER_SPEED`, `MOVING_SEGMENT_RAGDOLL_SPEED`); playhead redrawn per frame from the transport clock.
  A pure `sampleCycle(timing) → {t, position, band}[]` is unit-testable. Roughly one ticket.

### 2. Ghost end poses + path line in the viewport (Swing / Slide, trail for Spin)

- **Looks like**: while a moving Segment is selected, two translucent copies at its extremes
  (Swing at −amplitude and +amplitude, Slide at start and at `offset`), joined by a dashed line
  traced by the Segment's farthest point — an arc for Swing, a straight line for Slide, a circle for
  Spin. The line can reuse the strip's band colours so the dangerous part of the arc is red *in
  place*. Answers "where will it be, and where does it hit?" without pressing Play.
- **Follows**: Dreams' "dotted line when you hover the platform … the *animation path*"
  (https://docs.indreams.me/en-US/create/resources/edit-mode-guide/assembly/animate). Ghost end poses
  were **not found in any primary source** — keep them if play-testing shows they help, drop them if
  the path line alone reads.
- **Build**: extend the existing `showMotionGuide` in `apps/track-builder/src/viewport.ts` (already
  scene-level, already per selected index). Clone the Segment's meshes with a shared transparent
  material and apply `motionPose` at the extreme times; sample `applyMotionPose` on the far point
  into a `THREE.Line` with `LineDashedMaterial` and vertex colours. Small, mostly Three.js plumbing.

### 3. Plain-language readout line under the fields (all three motion kinds)

- **Looks like**: one generated sentence, recomputed on every edit, e.g. *"Moves out in 1.5 s, waits
  0.5 s, moves back in 1.5 s, waits 0.5 s. Top speed 11 m/s at the tip — Stagger. Starts 1.0 s into
  its cycle."* For Spin: *"One turn every 4 s. Tip speed 16 m/s — Ragdoll."* The danger word uses the
  tint colour.
- **Follows**: Prop Mover's speed as metres per second and a start delay in seconds rather than a
  0–1 phase ("5.0 meters/second", "Delay From Start",
  https://dev.epicgames.com/documentation/en-us/fortnite/using-prop-mover-devices-in-fortnite-creative);
  Godot's plain one-liners per easing
  (https://docs.godotengine.org/en/stable/classes/class_tween.html).
- **Build**: a pure `describeMotion(motion, farPointDistance) → string` in the builder (testable
  without a DOM), rendered as a `<p>`. The cheapest of the four; do it first even though it ranks
  third.

### 4. Easing as four curve buttons with a one-sentence hint

- **Looks like**: the easing dropdown becomes four small buttons, each a 32×20 curve drawn from
  `easeMotion` (flat line / slow start / slow stop / slow both ends), the selected one highlighted,
  with a caption: "Same speed all the way", "Starts slow, speeds up", "Slows down before it stops",
  "Slow at both ends". The stored value stays `MotionEasing`.
- **Follows**: easings.net's thumbnail grid (https://easings.net/); Unity's preset curves
  (https://docs.unity3d.com/420/Documentation/Manual/EditingValueProperties40.html, snippet-verified
  only); Godot's EaseType sentences (https://docs.godotengine.org/en/stable/classes/class_tween.html);
  Roblox's guide pairs its easing names with a curve figure
  (https://create.roblox.com/docs/ui/animation).
- **Build**: four inline SVG `<path>`s from 20 samples each; a radio-group swap in `motionPanel.ts`.
  Ranked last only because aid 1 already shows the chosen easing's shape in context.

Not recommended: exposing a free curve editor (Unity / Blender tangents are pro-oriented and our
four easings don't need one), or a Prop-Mover-style explicit "collision behaviour" field (the
Impact tint derives the consequence from real closing speed, which is both simpler and truer).
Open question the sources don't answer: how to show *several* Segments' phases against each other
(e.g. a row of strips for every moving Segment, one shared playhead) — no reviewed tool does this.
