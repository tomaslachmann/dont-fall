import { describe, expect, it } from "vitest";
import { matchSocketPath, parseMatchSocketPath, parseServerOrigin, pickServerOrigin } from "./serverOrigin.js";

describe("the Match socket path (ADR 0107)", () => {
  it("names a Lobby's port, and reads it back with the query it carries", () => {
    expect(matchSocketPath(51003)).toBe("/match/51003");
    expect(parseMatchSocketPath("/match/51003")).toEqual({ port: 51003, search: "" });
    expect(parseMatchSocketPath("/match/51003?track=abc")).toEqual({ port: 51003, search: "?track=abc" });
  });

  it("refuses anything else", () => {
    expect(parseMatchSocketPath("/tracks")).toBeUndefined();
    expect(parseMatchSocketPath("/match/")).toBeUndefined();
    expect(parseMatchSocketPath("/match/99999")).toBeUndefined();
    expect(parseMatchSocketPath("/match/80/../etc")).toBeUndefined();
  });
});

describe("pickServerOrigin (ADR 0107)", () => {
  it("takes a ?server= and remembers its origin", () => {
    expect(pickServerOrigin({ query: "https://x-8081.app.github.dev/some/path", stored: null, buildDefault: undefined })).toEqual({
      origin: "https://x-8081.app.github.dev",
      store: "https://x-8081.app.github.dev",
    });
  });

  it("falls back to what was remembered, then the build's default, then nothing", () => {
    expect(pickServerOrigin({ query: null, stored: "https://kept.example", buildDefault: "https://built.example" }).origin).toBe("https://kept.example");
    expect(pickServerOrigin({ query: null, stored: null, buildDefault: "https://built.example" }).origin).toBe("https://built.example");
    expect(pickServerOrigin({ query: null, stored: null, buildDefault: undefined })).toEqual({ origin: undefined });
  });

  it("clears what was remembered on an empty or unusable ?server=", () => {
    expect(pickServerOrigin({ query: "", stored: "https://kept.example", buildDefault: undefined })).toEqual({ origin: undefined, store: null });
    expect(pickServerOrigin({ query: "javascript:alert(1)", stored: null, buildDefault: undefined })).toEqual({ origin: undefined, store: null });
    expect(parseServerOrigin("ftp://nope")).toBeUndefined();
  });
});
