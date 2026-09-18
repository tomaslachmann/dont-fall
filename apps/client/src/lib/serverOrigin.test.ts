// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { serverOrigin } from "./serverOrigin";

afterEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
});

describe("serverOrigin (ADR 0107)", () => {
  it("is nothing locally: the page's own host decides", () => {
    expect(serverOrigin()).toBeUndefined();
  });

  it("takes a ?server= and keeps it through navigation that drops the query, until an empty one forgets it", () => {
    history.replaceState(null, "", "/?server=https://x-8081.app.github.dev");
    expect(serverOrigin()).toBe("https://x-8081.app.github.dev");

    history.replaceState(null, "", "/lobby?port=51003");
    expect(serverOrigin()).toBe("https://x-8081.app.github.dev");

    history.replaceState(null, "", "/?server=");
    expect(serverOrigin()).toBeUndefined();
    history.replaceState(null, "", "/");
    expect(serverOrigin()).toBeUndefined();
  });
});
