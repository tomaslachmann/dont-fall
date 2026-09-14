import { describe, expect, it, vi, afterEach } from "vitest";
import { formatBeansOnline, getGameSettings } from "./settings.js";

const API = "http://localhost:8081"; // apiBaseUrl() under jsdom

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getGameSettings", () => {
  it("reads the live values off /game-settings", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ maxPlayers: 10, onlinePlayers: 3244 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGameSettings()).resolves.toEqual({ maxPlayers: 10, onlinePlayers: 3244 });
    expect(fetchMock).toHaveBeenCalledWith(`${API}/game-settings`, expect.anything());
  });
});

describe("formatBeansOnline", () => {
  it("groups thousands with plain spaces, the design's own style", () => {
    expect(formatBeansOnline(3244)).toBe("3 244");
    expect(formatBeansOnline(7)).toBe("7");
    expect(formatBeansOnline(1200000)).toBe("1 200 000");
  });

  it("never shows a negative or a fraction", () => {
    expect(formatBeansOnline(-3)).toBe("0");
    expect(formatBeansOnline(7.9)).toBe("7");
  });
});
