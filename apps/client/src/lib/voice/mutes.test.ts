// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFlashes, getFlashesSnapshot } from "../flash.js";
import { clearMutes, getMutesSnapshot, loadMutes, setMute, subscribeMutes } from "./mutes.js";

let bodies: Map<string, { status: number; body: unknown }>;
let requests: { url: string; method: string; body: unknown }[];

const answer = (path: string, body: unknown, status = 200): void => void bodies.set(path, { status, body });

beforeEach(() => {
  clearFlashes();
  clearMutes();
  localStorage.setItem("df_auth_token", "tok");
  bodies = new Map();
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url, "http://api.test").pathname;
      requests.push({
        url: path,
        method: init?.method ?? "GET",
        body: init?.body === undefined ? undefined : JSON.parse(init.body as string),
      });
      const answered = bodies.get(path);
      if (answered === undefined) return new Response("{}", { status: 200 });
      return new Response(JSON.stringify(answered.body), { status: answered.status });
    }),
  );
});

afterEach(() => {
  clearMutes();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("loading the Mutes (ADR 0111)", () => {
  it("reads the list once per session, however many Screens ask", async () => {
    answer("/voice/mutes", { muted: ["acc-a"] });

    await Promise.all([loadMutes(), loadMutes()]);
    await loadMutes();

    expect(getMutesSnapshot()).toEqual(["acc-a"]);
    expect(requests.filter((r) => r.url === "/voice/mutes")).toHaveLength(1);
  });

  it("holds an empty list rather than `undefined` when the answer is not the shape it claims", async () => {
    // A body without `muted` at all — a proxy's error page, an older API, a
    // stray 200. Every reader of this store would crash on `undefined`.
    answer("/voice/mutes", []);

    await loadMutes();

    expect(getMutesSnapshot()).toEqual([]);
  });

  it("keeps only the strings out of a list that has other things in it", async () => {
    answer("/voice/mutes", { muted: ["acc-a", 7, null, "acc-b"] });

    await loadMutes();

    expect(getMutesSnapshot()).toEqual(["acc-a", "acc-b"]);
  });

  it("is quiet about a failure, and tries again next time a sheet opens", async () => {
    answer("/voice/mutes", { message: "nope" }, 500);
    await loadMutes();

    expect(getMutesSnapshot()).toEqual([]);
    expect(getFlashesSnapshot()).toHaveLength(0);

    answer("/voice/mutes", { muted: ["acc-a"] });
    await loadMutes();

    expect(getMutesSnapshot()).toEqual(["acc-a"]);
  });
});

describe("setting a Mute", () => {
  it("shows at once, then settles on the API's own whole list", async () => {
    answer("/voice/mutes/acc-a", { muted: ["acc-a"] });
    const seen: readonly string[][] = [];
    subscribeMutes(() => (seen as string[][]).push([...getMutesSnapshot()]));

    const done = setMute("acc-a", true);
    // Before the request has answered: the row is already muted.
    expect(getMutesSnapshot()).toEqual(["acc-a"]);
    await done;

    expect(getMutesSnapshot()).toEqual(["acc-a"]);
    expect(requests.at(-1)).toEqual({ url: "/voice/mutes/acc-a", method: "PUT", body: { muted: true } });
  });

  it("replaces rather than merges — the API's list is the list", async () => {
    answer("/voice/mutes", { muted: ["acc-a", "acc-b"] });
    await loadMutes();
    // The API dropped one elsewhere (another tab) while this tab muted a third.
    answer("/voice/mutes/acc-c", { muted: ["acc-b", "acc-c"] });

    await setMute("acc-c", true);

    expect(getMutesSnapshot()).toEqual(["acc-b", "acc-c"]);
  });

  it("unmutes", async () => {
    answer("/voice/mutes", { muted: ["acc-a"] });
    await loadMutes();
    answer("/voice/mutes/acc-a", { muted: [] });

    await setMute("acc-a", false);

    expect(getMutesSnapshot()).toEqual([]);
    expect(requests.at(-1)?.body).toEqual({ muted: false });
  });

  it("puts the list back and says so when the write fails — a Mute that did not take must not look like one that did", async () => {
    answer("/voice/mutes", { muted: [] });
    await loadMutes();
    answer("/voice/mutes/acc-a", { message: "boom" }, 500);

    await setMute("acc-a", true);

    expect(getMutesSnapshot()).toEqual([]);
    expect(getFlashesSnapshot().map((f) => f.tone)).toEqual(["error"]);
    expect(getFlashesSnapshot()[0]!.title).toMatch(/couldn't mute/i);
  });

  it("escapes an Account id into the path rather than pasting it in", async () => {
    await setMute("acc/../a", true);

    expect(requests.at(-1)?.url).toBe("/voice/mutes/acc%2F..%2Fa");
  });
});

describe("signing out", () => {
  it("forgets the list, so the next Account does not inherit it", async () => {
    answer("/voice/mutes", { muted: ["acc-a"] });
    await loadMutes();

    clearMutes();

    expect(getMutesSnapshot()).toEqual([]);
    // And the next Account's own list is read rather than assumed empty.
    answer("/voice/mutes", { muted: ["acc-z"] });
    await loadMutes();
    expect(getMutesSnapshot()).toEqual(["acc-z"]);
  });
});
