// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useFriends } from "./useFriends.js";
import { WithQuery } from "../../test/query.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const OVERVIEW = {
  friends: [
    {
      accountId: "a2",
      displayName: "Floppo",
      avatarUrl: null,
      friendsSince: 1,
      presence: { status: "online" },
    },
  ],
  online: 1,
  total: 1,
  requests: [
    {
      id: "r1",
      fromAccountId: "a3",
      fromDisplayName: "Goopy",
      fromAvatarUrl: null,
      sentAt: 1,
      matchesTogether: 4,
    },
  ],
};

const route = (handlers: Record<string, unknown>) =>
  vi.fn(async (url: string) => {
    const path = new URL(String(url)).pathname;
    const body = handlers[path] ?? {};
    return new Response(JSON.stringify(body), { status: 200 });
  });

function Harness() {
  const friends = useFriends();
  return (
    <>
      <div data-testid="counts">
        {friends.online}/{friends.total}/{friends.requests.length}/{friends.recent.length}/{friends.code ?? "nocode"}
      </div>
      <div data-testid="invites">{friends.invites.map((i) => i.fromDisplayName).join(",")}</div>
      <div data-testid="requested">{friends.requestedIds.join(",")}</div>
      <button type="button" onClick={() => void friends.acceptRequest("r1")}>accept</button>
      <button type="button" onClick={() => void friends.sendRequest({ accountId: "a9" })}>add</button>
      <button type="button" onClick={() => friends.dismissInvite("i1")}>dismiss</button>
    </>
  );
}

describe("useFriends", () => {
  it("loads overview, recent, and code — and heartbeats on mount", async () => {
    const fetchMock = route({
      "/friends": OVERVIEW,
      "/friends/recent": { recent: [] },
      "/friends/code": { code: "BEAN42" },
      "/friends/heartbeat": { ok: true, invites: [] },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WithQuery>
        <Harness />
      </WithQuery>,
    );

    await waitFor(() => expect(screen.getByTestId("counts")).toHaveTextContent("1/1/1/0/BEAN42"));
    const paths = fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths).toContain("/friends/heartbeat");
  });

  it("surfaces heartbeat invites until dismissed", async () => {
    const invite = {
      id: "i1",
      fromAccountId: "a2",
      fromDisplayName: "Floppo",
      lobby: { kind: "public", lobbyId: "l1" },
      sentAt: 1,
    };
    vi.stubGlobal(
      "fetch",
      route({
        "/friends": OVERVIEW,
        "/friends/recent": { recent: [] },
        "/friends/code": { code: "BEAN42" },
        "/friends/heartbeat": { ok: true, invites: [invite] },
      }),
    );

    render(
      <WithQuery>
        <Harness />
      </WithQuery>,
    );

    await waitFor(() => expect(screen.getByTestId("invites")).toHaveTextContent("Floppo"));
    act(() => screen.getByText("dismiss").click());
    expect(screen.getByTestId("invites")).toHaveTextContent("");
  });

  it("accept refetches the roster; ADD from RECENT marks the row requested", async () => {
    let accepted = false;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path === "/friends/requests/r1/accept") {
        accepted = true;
        return new Response(JSON.stringify({ friend: { accountId: "a3", displayName: "Goopy", avatarUrl: null } }), {
          status: 200,
        });
      }
      if (path === "/friends/requests" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "r9" }), { status: 201 });
      }
      const body =
        path === "/friends"
          ? { ...OVERVIEW, requests: accepted ? [] : OVERVIEW.requests }
          : path === "/friends/recent"
            ? { recent: [] }
            : path === "/friends/code"
              ? { code: "BEAN42" }
              : { ok: true, invites: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WithQuery>
        <Harness />
      </WithQuery>,
    );
    await waitFor(() => expect(screen.getByTestId("counts")).toHaveTextContent("1/1/1/0/BEAN42"));

    act(() => screen.getByText("accept").click());
    await waitFor(() => expect(screen.getByTestId("counts")).toHaveTextContent("1/1/0/"));
    expect(fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === "/friends").length).toBeGreaterThan(1);

    act(() => screen.getByText("add").click());
    await waitFor(() => expect(screen.getByTestId("requested")).toHaveTextContent("a9"));
  });
});
