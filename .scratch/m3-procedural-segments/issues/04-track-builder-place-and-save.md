# 04 — Track builder: standalone tool, place & save Modules with visual previews

**What to build:** A new standalone, dev-only visual tool (separate from the live multiplayer
client) that renders the Module library and lets a developer place/position/rotate Modules
end-to-end into a linear Track. It shows a **visual preview/palette of every Module** in the
library (pickable, not just a name list) and a **visual overview preview of the whole assembled
Track** being built (not only a first-person walk-around). Saves the result to track-service
(ticket 02's save API).

**Blocked by:** 01 (Module library to render/place), 02 (save API to persist to).

**Status:** ready-for-agent

- [ ] Standalone entry point, no networking, no auth, no dependency on the live game client's
      HUD/netcode
- [ ] A Module palette shows a real visual preview (rendered thumbnail or live 3D) of every Module
      in the library, not just an identifier
- [ ] Modules can be placed, positioned, and rotated into an ordered linear sequence, respecting
      the uniform footprint (ADR 0030) — no compatibility errors possible by construction
- [ ] A whole-Track overview view (e.g. free/orbit camera) lets a developer see the assembled
      Track as a whole, distinct from first-person placement
- [ ] Save persists to track-service; loading an existing Track (e.g. the M1 seed) round-trips
      correctly
- [ ] Manually verified: build a new, non-M1 Track, save it, and confirm via track-service's fetch
      API that it is retrievable and distinct from the M1 seed
