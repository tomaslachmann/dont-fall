import { describe, expect, it } from "vitest";
import { trackThumbnailUrl } from "./tracks.js";

describe("trackThumbnailUrl", () => {
  it("points at the Track's thumbnail endpoint on the API origin", () => {
    expect(trackThumbnailUrl("abc")).toBe("http://localhost:8081/tracks/abc/thumbnail");
  });

  it("escapes the id and pins a Revision when asked", () => {
    expect(trackThumbnailUrl("a/b", 2)).toBe("http://localhost:8081/tracks/a%2Fb/thumbnail?revision=2");
  });
});
