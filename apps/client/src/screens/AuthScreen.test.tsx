// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { getStoredToken } from "../lib/api/base.js";
import { AuthScreen } from "./AuthScreen.js";
import { WithQuery } from "../test/query.js";

beforeEach(() => {
  localStorage.clear();
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth" element={<WithQuery><AuthScreen /></WithQuery>} />
        <Route path="/" element={<div>Main Menu landed</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe("AuthScreen", () => {
  it("shows a Discord login button that sends the browser to the API's authorize route", () => {
    // jsdom doesn't implement real navigation — spy on the setter instead of asserting a real redirect happened.
    const originalHref = window.location.href;
    let assignedHref = "";
    Object.defineProperty(window, "location", {
      value: { ...window.location, set href(v: string) { assignedHref = v; }, get href() { return assignedHref || originalHref; } },
      writable: true,
    });

    renderAt("/auth");
    fireEvent.click(screen.getByRole("button", { name: "DISCORD" }));

    expect(assignedHref).toMatch(/\/auth\/discord\/authorize$/);
  });

  it("FORGOT says inline that reset isn't available — never a window.alert", () => {
    renderAt("/auth");

    fireEvent.click(screen.getByRole("button", { name: "FORGOT?" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Password reset isn't available yet.");
  });

  it("logs in with email/password, stores the token, and lands on the Main Menu", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ account: { id: "a1", discordId: null, email: "a@b.com", displayName: "Wobbleton", avatarUrl: null, xp: 0, coins: 0 }, token: "tok-1" }), { status: 200 })),
    );

    renderAt("/auth");
    fireEvent.change(screen.getByLabelText("EMAIL"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("PASSWORD"), { target: { value: "correct horse battery staple" } });
    fireEvent.click(screen.getByRole("button", { name: "JUMP IN" }));

    await waitFor(() => expect(screen.getByText("Main Menu landed")).toBeInTheDocument());
    expect(getStoredToken()).toBe("tok-1");
  });

  it("shows the server's error message on a failed login, without storing a token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid email or password" }), { status: 401 })));

    renderAt("/auth");
    fireEvent.change(screen.getByLabelText("EMAIL"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("PASSWORD"), { target: { value: "wrong password" } });
    fireEvent.click(screen.getByRole("button", { name: "JUMP IN" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("invalid email or password");
    expect(getStoredToken()).toBeNull();
  });

  it("switches to signup mode, which asks for a display name and posts /auth/signup", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ account: { id: "a1", discordId: null, email: "a@b.com", displayName: "Wobbleton", avatarUrl: null, xp: 0, coins: 0 }, token: "tok-1" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/auth");
    fireEvent.click(screen.getByRole("tab", { name: "SIGN UP" }));
    expect(screen.getByLabelText("BEAN NAME")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("BEAN NAME"), { target: { value: "Wobbleton" } });
    fireEvent.change(screen.getByLabelText("EMAIL"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("PASSWORD"), { target: { value: "correct horse battery staple" } });
    fireEvent.click(screen.getByRole("button", { name: "CREATE BEAN" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/signup$/), expect.anything()));
  });

  it("renders a known ?error= from a failed Discord-link callback with a readable message", () => {
    render(
      <MemoryRouter initialEntries={["/auth?error=discord-already-linked"]}>
        <Routes>
          <Route path="/auth" element={<WithQuery><AuthScreen /></WithQuery>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("already linked to a different Account");
  });
});
