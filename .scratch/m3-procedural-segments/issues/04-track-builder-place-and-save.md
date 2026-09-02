# 04 — Track builder: standalone tool, place & save Modules with visual previews

**What to build:** A new standalone, dev-only visual tool (separate from the live multiplayer
client) that renders the Module library and lets a developer place/position/rotate Modules
end-to-end into a linear Track. It shows a **visual preview/palette of every Module** in the
library (pickable, not just a name list) and a **visual overview preview of the whole assembled
Track** being built (not only a first-person walk-around). Saves the result to track-service
(ticket 02's save API).

**Blocked by:** 01 (Module library to render/place), 02 (save API to persist to).

**Status:** done

- [x] Standalone entry point (`apps/track-builder`, its own Vite app on port 5174/5175), no
      networking beyond track-service's HTTP API, no auth, no dependency on the live game client's
      HUD/netcode
- [x] A Module palette shows a real live 3D preview (its own small Three.js renderer, auto-framed
      + slowly auto-rotating) of every Module in `MODULE_LIBRARY`, not just an identifier
- [x] Modules are placed into an ordered linear sequence purely by clicking a palette entry —
      auto-chained `MODULE_STEP` after the last Segment (`trackState.ts`'s `appendModule`), so no
      gap/overlap/compatibility error is possible by construction (ADR 0030). Manual free-form
      repositioning and rotation were **not** built: rotation is always 0 (Tracks are linear-only,
      ADR 0030) so a rotate control would be a no-op, and the uniform-footprint auto-chaining this
      ticket leans on makes manual positioning redundant for M3 — a documented scope call, not an
      oversight
- [x] A whole-Track overview (orbit camera via `three/examples/jsm/controls/OrbitControls.js`,
      `viewport.ts`) shows every placed Segment translated to its resolved world position —
      distinct from the palette's per-Module first-person-style preview
- [x] Save persists to track-service (`POST /tracks`); Load (`GET /tracks/:id`) round-trips the M1
      seed Track correctly
- [x] Manually verified live in a real browser (Playwright + Chromium, not just vitest): loaded the
      page, clicked 3 different palette entries (Segment count 0→1→3, confirmed in the status
      line and visually in a screenshot — start platform + bridge + checkpoint-spinner with its
      Spinner bar and Checkpoint wireframe all rendered correctly), dragged to orbit the overview
      camera (confirmed via a before/after screenshot), saved a new Track (got back a real id),
      removed the last Segment (count 3→2), and loaded `m1-playground` fresh (correctly restored
      to 6 Segments, name "M1 playground"). Zero console/page errors on the final run
- [x] **Found and fixed a real bug via this browser verification, not just unit tests**: the first
      save attempt failed with a CORS error (track-service sent no
      `Access-Control-Allow-Origin` header, so the browser blocked the builder's cross-origin
      fetch) — a class of bug vitest's Node-based tests structurally cannot catch. Fixed in
      track-service (`CORS_HEADERS` + an `OPTIONS` preflight handler) with 2 new regression tests
