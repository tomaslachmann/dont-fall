# 06 — Screenshot the draft

**What to build:** `screenshot_draft` (D10): headless-render the draft with
the thumbnail pipeline's machinery (`thumbnail.html` + render script path)
and return the image to the LLM as the second validation backstop beside
`validate`. Render failures are tool errors, never silent — a missing image
must not read as a clean bill. ADR 0114.

**Blocked by:** 03

**Status:** planned

- [ ] Headless draft render reusing the thumbnail machinery (no forked copy)
- [ ] `screenshot_draft` returns image bytes (+ revision-free draft id echoed)
- [ ] Tests: screenshot of a small draft returns a real image; render failure surfaces as a tool error
