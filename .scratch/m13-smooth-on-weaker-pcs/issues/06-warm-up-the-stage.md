# 06 — Warm up the Stage before the Round runs

**What to build:** no hitch the first time a material or texture comes into
view. Once the Stage is built, the game compiles its shader programs and
uploads its textures ahead of time, instead of on the first frame that draws
them.

**Decided (user, 2026-09-17):** next, together with memory-footprint/02. The before numbers show
start-of-Round frames of 183–292 ms (felt as "400 ms, very slow"), four of five over 50 ms in the
first 100 m, and a 93 ms hitch where the belt climb first comes into view.

**Blocked by:** — (built alongside memory-footprint/02, which cuts what there is to upload)

**Status:** done on tests (2026-09-17). Whether the start hitches are gone is the user's browser run (the overlay's before/after).

## How it behaves after

- Entering a Round, and a live Lobby Track pick that rebuilds the Stage, both
  end with every Track material compiled and every texture on the GPU.
- The first look down the course, or reaching a new section, does not stall.
  The cost moves to the load, where the Lobby or the Countdown already hides
  it.
- Nothing waits on it: the server's phases and the Countdown are unchanged.
  If the warm-up is still running when the Round starts, the Round starts
  anyway.

## What to change

- [x] After `createStage` (and the Track swap in `game/index.ts` and
      `practice.ts`): `renderer.compileAsync(scene, camera)` and
      `renderer.initTexture` for every texture the Stage's materials use
- [x] Check the shadow pass. Its depth materials compile separately from the
      scene's, so render one shadow update during warm-up if `compileAsync`
      does not cover them (at quality levels with shadows).
- [x] Objects out of view: `compileAsync` walks the scene graph, not the
      frustum. Check that the far Track pieces and the Moving Segments are
      included, and that hidden objects are made visible for it if needed.
- [x] Tests: the warm-up is called with the Stage's scene, and a Track swap
      warms the new Stage, not the disposed one
- [ ] 01's overlay confirms: `info.programs` does not grow after the first
      frame of a Round (the user's run)

## Notes

- Research: "Findings §1 → First-sight hitches", recommendation #5.
- three r171 docs: `WebGLRenderer.compileAsync`, `WebGLRenderer.initTexture`.

## As built

- **`render/warmUp.ts` `warmUpStage(renderer, scene, camera, renderFrame)`:**
  1. `renderer.compile(scene, camera)`. This walks the whole scene graph, hidden objects included,
     with the scene's lights and shadows.
  2. One `renderFrame()` with every `frustumCulled` object switched off and then put back, even if
     the frame throws. It draws everything once: every geometry and texture uploads, and the shadow
     pass's depth programs and the composer's passes compile. Visibility is untouched.
  3. `setRenderTarget(null)` and `clear()`, so that frame, taken from wherever the camera stands,
     never shows.
- **Why synchronous, not `compileAsync`.** In three r171, `compileAsync` polls
  `properties.get(material).currentProgram.isReady()` on a timer, and that throws once the renderer
  is disposed; a Stage torn down mid-warm-up would hit it. With `KHR_parallel_shader_compile`,
  `compile()` still starts the programs in parallel, and the frame waits for them.
- **`Stage.warmUp()`** wraps it with the Stage's own `render`. It is called:
  - at Match boot and practice boot, right after `createStage` and before the frame loop starts,
    so it counts in `bootMs`;
  - at the end of a live Track swap, in the same synchronous run that installs the new Stage, so
    the loop never draws it cold. The swap's `lastTrackLoadMs` includes it.
- **Remote rigs** are cloned later, from the local model. Their tinted materials reuse the same
  programs, so they need no compile.
- **Tests** pin the order (compile → frame → clear), the culling flags during and after the frame,
  visibility left alone, and culling restored when the frame throws. Nothing here can be rendered
  in this environment; the overlay's cells and the over-50 ms counts are the check.
