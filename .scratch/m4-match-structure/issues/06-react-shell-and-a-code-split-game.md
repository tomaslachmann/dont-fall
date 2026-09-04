# 06 — A React shell you arrive in, with the game behind a click

**What to build:** The client stops opening straight into a running game. It opens on a main menu,
and starting a Match loads the game module on demand and hands it the canvas. The game loop still
never runs through React (ADR 0008): React owns the shell and routing, the game owns the frame.

**Blocked by:** 01 — the bootstrap boundary this mounts.

**Status:** done

- [x] The client entry becomes a React app with routing; the game module stays code-split behind a
      dynamic import so the menu does not pay for the renderer, the physics WASM, or the model
- [x] A game-canvas boundary component takes its config in and reports match-end and exit out —
      exactly the shape ticket 01 prepared
- [x] A main menu Screen leads into a Match, and leaving the game returns to the shell with the game
      fully torn down
- [x] The design tokens and component primitives from the design-system research land here, used by
      this Screen — not as an unused layer ahead of its first consumer
- [x] The in-Match HUD stays plain DOM (ADR 0008) and is untouched by this ticket
- [x] Manually verified live: menu → game → back to menu → game again, with no leaked context,
      duplicated listeners or console errors
