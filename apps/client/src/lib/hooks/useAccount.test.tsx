// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type Account } from "../api/auth.js";
import { setStoredToken } from "../api/base.js";
import { useAccount } from "./useAccount.js";
import { WithQuery } from "../../test/query.js";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

const ACCOUNT: Account = { id: "a1", discordId: "d1", email: null, displayName: "Wobbleton", avatarUrl: null, avatarUploadedAt: null, role: "player", xp: 0, coins: 0, color: 0, skin: null, hat: null, emote: "wobble", victoryPose: "win", bindings: null };

function Harness() {
  const { status, account, recheck } = useAccount();
  return (
    <>
      <div data-testid="status">{status}:{account?.displayName ?? "none"}</div>
      <button type="button" onClick={recheck}>recheck</button>
    </>
  );
}

const renderHarness = () => render(<WithQuery><Harness /></WithQuery>);

describe("useAccount", () => {
  it("with no stored token, resolves straight to unauthed — no network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderHarness();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthed:none"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with a stored token that resolves, ends up authed with the Account", async () => {
    setStoredToken("tok-1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(ACCOUNT), { status: 200 })));

    renderHarness();

    expect(screen.getByTestId("status")).toHaveTextContent("checking:none");
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authed:Wobbleton"));
  });

  it("a stored but expired/invalid token (401) ends up unauthed, and clears the stale token", async () => {
    setStoredToken("stale-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not logged in" }), { status: 401 })));

    renderHarness();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthed:none"));
    expect(localStorage.getItem("df_auth_token")).toBeNull();
  });

  it("recheck refetches the Account — a changed name arrives without a remount", async () => {
    setStoredToken("tok-1");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ACCOUNT), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    renderHarness();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authed:Wobbleton"));

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...ACCOUNT, displayName: "Wobbleton II" }), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "recheck" }));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authed:Wobbleton II"));
  });

  it("a network failure fails closed to unauthed without clearing the token (transient, not a real logout)", async () => {
    setStoredToken("tok-1");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));

    renderHarness();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthed:none"));
    expect(localStorage.getItem("df_auth_token")).toBe("tok-1");
  });
});
