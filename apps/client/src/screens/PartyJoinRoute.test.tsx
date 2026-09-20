// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { clearFlashes, getFlashesSnapshot } from "../lib/flash.js";
import { PartyJoinRoute } from "./PartyJoinRoute";

const JOINED = {
  id: "p9",
  hostAccountId: "h1",
  members: [
    { accountId: "h1", displayName: "Floppo", color: 1, skin: null, hat: null, avatarUploadedAt: null, xp: 0, joinedAt: 1, place: "menu", online: true },
    { accountId: "me", displayName: "Noodle", color: 2, skin: null, hat: null, avatarUploadedAt: null, xp: 0, joinedAt: 2, place: "menu", online: true },
  ],
  pending: [],
  code: null,
  codeExpiresAt: null,
  lobby: null,
};

/** Moves the Player the way the alert stack's `follow` does, from outside the route. */
let navigateElsewhere: ((path: string) => void) | null = null;
function Navigator() {
  navigateElsewhere = useNavigate();
  return null;
}

const renderLink = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Navigator />
      <Routes>
        <Route path="/party/:code" element={<PartyJoinRoute />} />
        <Route path="/" element={<div>the menu</div>} />
        <Route path="/lobby" element={<div>the Lobby</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => localStorage.setItem("df_auth_token", "tok"));
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  clearFlashes();
});

describe("/party/:code — a Party's SHARE LINK (ADR 0112)", () => {
  it("joins the Party behind the code, then the menu, naming whose Party it is", async () => {
    const fetchMock = vi.fn(async () => Response.json(JOINED));
    vi.stubGlobal("fetch", fetchMock);
    renderLink("/party/zztop9");

    expect(await screen.findByText("the menu")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/party/join");
    expect(JSON.parse(init.body as string)).toEqual({ code: "ZZTOP9" });
    expect(getFlashesSnapshot().map((f) => [f.title, f.tone])).toEqual([["You joined Floppo's party.", "success"]]);
  });

  it("leaves a Player the Party's follow already took into its Lobby there, when the join answers after it", async () => {
    let answer: (res: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
    renderLink("/party/zztop9");

    // The API pushes the follow before it writes the join's answer.
    act(() => navigateElsewhere!("/lobby?port=51000&id=l1&reservation=r1"));
    expect(screen.getByText("the Lobby")).toBeInTheDocument();
    await act(async () => answer(Response.json({ ...JOINED, lobby: { id: "l1", port: 51000 } })));

    await waitFor(() => expect(getFlashesSnapshot().map((f) => f.title)).toEqual(["You joined Floppo's party."]));
    expect(screen.getByText("the Lobby")).toBeInTheDocument();
    expect(screen.queryByText("the menu")).not.toBeInTheDocument();
  });

  it("a code that no longer works still lands in the menu, saying why", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "that party code has expired" }, { status: 404 })));
    renderLink("/party/OLDONE");

    expect(await screen.findByText("the menu")).toBeInTheDocument();
    await waitFor(() =>
      expect(getFlashesSnapshot().map((f) => [f.title, f.tone])).toEqual([["that party code has expired", "error"]]),
    );
  });
});
