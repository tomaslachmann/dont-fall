// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { PARTY_CODE_TTL_MS } from "@dont-fall/shared";
import type { AuthStatus } from "../hooks/useAccount.js";
import { holdPartyLink, partyShareUrl, takeHeldPartyLink, useHeldPartyLink } from "./partyLink.js";

afterEach(() => sessionStorage.clear());

describe("a Party's SHARE LINK (ADR 0112)", () => {
  it("is this app's own /party/<code>, absolute, under the page's base", () => {
    expect(partyShareUrl("4K7NQX", "https://example.test/lobby?port=1")).toBe("https://example.test/party/4K7NQX");
  });

  it("holds a link's code across signing in, once, and only while a Party code still works", () => {
    holdPartyLink("/friends", 0);
    expect(takeHeldPartyLink(0)).toBeNull();

    holdPartyLink("/party/4K7NQX", 1_000);
    expect(takeHeldPartyLink(2_000)).toBe("4K7NQX");
    expect(takeHeldPartyLink(2_000)).toBeNull();

    holdPartyLink("/party/4K7NQX", 1_000);
    expect(takeHeldPartyLink(1_000 + PARTY_CODE_TTL_MS)).toBeNull();
  });

  it("<AuthGate>'s half: signed out on the link holds it; signed in, it goes back to it", () => {
    const Gate = ({ status, ready }: { status: AuthStatus; ready: boolean }) => {
      useHeldPartyLink(status, ready);
      return <div>at:{useLocation().pathname}</div>;
    };
    const tree = (status: AuthStatus, ready: boolean, path: string) => (
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<Gate status={status} ready={ready} />} />
        </Routes>
      </MemoryRouter>
    );

    const signedOut = render(tree("unauthed", false, "/party/4K7NQX"));
    signedOut.unmount();

    // Back from signing in, on the menu: held until the app is past its loading hold, then taken there.
    const { rerender } = render(tree("authed", false, "/"));
    expect(screen.getByText("at:/")).toBeInTheDocument();
    rerender(tree("authed", true, "/"));
    expect(screen.getByText("at:/party/4K7NQX")).toBeInTheDocument();
    expect(takeHeldPartyLink()).toBeNull();
  });
});
