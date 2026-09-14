// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { getStoredToken } from "../lib/api/base.js";
import { AuthCallbackScreen } from "./AuthCallbackScreen.js";

beforeEach(() => {
  localStorage.clear();
});

// Reads the *router's* location, not the global `window.location` — MemoryRouter never touches the latter.
function AuthScreenStub() {
  const location = useLocation();
  return <div>Auth screen landed{location.search ? ` with ${location.search}` : ""}</div>;
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackScreen />} />
        <Route path="/" element={<div>Main Menu landed</div>} />
        <Route path="/auth" element={<AuthScreenStub />} />
      </Routes>
    </MemoryRouter>,
  );

describe("AuthCallbackScreen", () => {
  it("a #token= fragment stores the token and lands on the Main Menu", async () => {
    renderAt("/auth/callback#token=tok-1");

    expect(await screen.findByText("Main Menu landed")).toBeInTheDocument();
    expect(getStoredToken()).toBe("tok-1");
  });

  it("a #linked=discord fragment (no new token) lands back on /auth, nothing stored", async () => {
    renderAt("/auth/callback#linked=discord");

    expect(await screen.findByText(/Auth screen landed/)).toBeInTheDocument();
    expect(getStoredToken()).toBeNull();
  });

  it("an #error= fragment lands back on /auth carrying it as a query param", async () => {
    renderAt("/auth/callback#error=discord-already-linked");

    expect(await screen.findByText(/error=discord-already-linked/)).toBeInTheDocument();
    expect(getStoredToken()).toBeNull();
  });
});
