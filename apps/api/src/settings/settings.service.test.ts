import { describe, expect, it, vi } from "vitest";
import { getGameSettings } from "./settings.service.js";

describe("getGameSettings", () => {
  it("returns the configured cap with the live online count", async () => {
    await expect(getGameSettings({ maxPlayers: 10, countOnlinePlayers: async () => 7 })).resolves.toEqual({
      maxPlayers: 10,
      onlinePlayers: 7,
    });
  });

  it("reports zero beans online when every Lobby is empty", async () => {
    const countOnlinePlayers = vi.fn(async () => 0);

    await expect(getGameSettings({ maxPlayers: 4, countOnlinePlayers })).resolves.toEqual({
      maxPlayers: 4,
      onlinePlayers: 0,
    });
    expect(countOnlinePlayers).toHaveBeenCalledOnce();
  });
});
