import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/db.js";
import { countOnlineAccounts, recordBeat } from "./friends.dao.js";
import { ONLINE_WINDOW_MS } from "./presence.js";

describe("countOnlineAccounts (ADR 0110)", () => {
  it("counts a fresh beat and not a stale one", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-online-test-"));
    try {
      const db = openDb(join(dir, "test.sqlite"));
      const now = 1_000_000;
      recordBeat(db, "fresh", now - 1_000);
      recordBeat(db, "stale", now - ONLINE_WINDOW_MS - 1);
      expect(countOnlineAccounts(db, now)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
