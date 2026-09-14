import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config.js";

describe("resolveConfig match port range", () => {
  it("parses LOBBY_PORT_MIN/MAX into matchPortRange", () => {
    expect(resolveConfig({ LOBBY_PORT_MIN: "51000", LOBBY_PORT_MAX: "51099" }).matchPortRange).toEqual({
      min: 51000,
      max: 51099,
    });
  });

  it("leaves the range off without env — local ephemeral behavior", () => {
    expect(resolveConfig({}).matchPortRange).toBeUndefined();
  });

  it("a half-set or insane range counts as absent, never half-applied", () => {
    expect(resolveConfig({ LOBBY_PORT_MIN: "51000" }).matchPortRange).toBeUndefined();
    expect(resolveConfig({ LOBBY_PORT_MIN: "nope", LOBBY_PORT_MAX: "51099" }).matchPortRange).toBeUndefined();
    expect(resolveConfig({ LOBBY_PORT_MIN: "52000", LOBBY_PORT_MAX: "51999" }).matchPortRange).toBeUndefined();
    expect(resolveConfig({ LOBBY_PORT_MIN: "0", LOBBY_PORT_MAX: "70000" }).matchPortRange).toBeUndefined();
  });
});
