# 18 — Drafts (design open)

**What to build:** A Track has an owning Account and may be a draft. The main menu's BUILD tile
counts your drafts ("N DRAFT TRACKS"). The user's choice, ADR 0110.

**Blocked by:** —

**Status:** planned — **settle with the user first**, then write its ADR

Open questions:
- Does the builder sign in with the same Account (today every Track's author is
  `DEFAULT_AUTHOR_ID`)?
- What makes a Track a draft: never published, or an explicit state, and who can see and play one?
- Do the authored and seeded Tracks keep a system owner?
