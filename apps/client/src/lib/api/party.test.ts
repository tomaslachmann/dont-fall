import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptPartyInvite,
  cancelPartyInvite,
  declinePartyInvite,
  getPartyCandidates,
  inviteToParty,
  joinPartyByCode,
  leaveParty,
  lookupPartyCode,
  removeFromParty,
} from "./party.js";

const API = "http://localhost:8081"; // the single API (ADR 0058)

const respond = (status: number, body?: unknown) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => (body === undefined ? Promise.reject(new SyntaxError("no body")) : Promise.resolve(body)),
  });

/** Method, path and JSON body of every call the mock saw. */
const calls = (fetchMock: ReturnType<typeof respond>) =>
  fetchMock.mock.calls.map(([url, init]) => {
    const { method = "GET", body } = (init ?? {}) as RequestInit;
    return [method, String(url).slice(API.length), body === undefined ? undefined : JSON.parse(String(body))];
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("party api (ADR 0112)", () => {
  it("reads the invite card's rows and looks a pasted code up, upper-cased", async () => {
    const fetchMock = respond(200, { candidates: [], friendCount: 0 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPartyCandidates()).resolves.toEqual({ candidates: [], friendCount: 0 });
    await lookupPartyCode(" 4k7nqx ");

    expect(calls(fetchMock)).toEqual([
      ["GET", "/party/candidates", undefined],
      ["GET", "/party/lookup/4K7NQX", undefined],
    ]);
  });

  it("invites, accepts and joins over their own routes", async () => {
    const fetchMock = respond(201, { inviteId: "pi1" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(inviteToParty("a2")).resolves.toEqual({ inviteId: "pi1" });
    await acceptPartyInvite("pi1");
    await joinPartyByCode("4k7nqx");

    expect(calls(fetchMock)).toEqual([
      ["POST", "/party/invites", { accountId: "a2" }],
      ["POST", "/party/invites/pi1/accept", undefined],
      ["POST", "/party/join", { code: "4K7NQX" }],
    ]);
  });

  it("takes a 204 as done for cancel, decline, leave and remove", async () => {
    const fetchMock = respond(204);
    vi.stubGlobal("fetch", fetchMock);

    await cancelPartyInvite("pi1");
    await declinePartyInvite("pi1");
    await leaveParty();
    await removeFromParty("a2");

    expect(calls(fetchMock)).toEqual([
      ["DELETE", "/party/invites/pi1", undefined],
      ["POST", "/party/invites/pi1/decline", undefined],
      ["POST", "/party/leave", undefined],
      ["DELETE", "/party/members/a2", undefined],
    ]);
  });

  it("surfaces the API's own reason for a refusal, with its status", async () => {
    vi.stubGlobal("fetch", respond(403, { error: "only the host can remove beans" }));

    await expect(removeFromParty("a2")).rejects.toMatchObject({ message: "only the host can remove beans", status: 403 });
  });
});
