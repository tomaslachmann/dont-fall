// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NO_AVATAR } from "../lib/avatar.js";
import PartyStrip, { type PartyMember } from "./PartyStrip";

const you: PartyMember = { accountId: "me", name: "Noodle", look: NO_AVATAR, level: 42, you: true, host: true };

describe("PartyStrip on the live kit (ADR 0112)", () => {
  it("alone: your slot, the invite slot and empty ones, and nothing to leave", () => {
    const onInvite = vi.fn();
    render(<PartyStrip members={[you]} onlineCount={7} code="4K7NQX" onInvite={onInvite} leaveDisabled />);

    expect(screen.getByText("1/4")).toBeInTheDocument();
    expect(screen.getByText("HOST · YOU")).toBeInTheDocument();
    expect(screen.getByText("7 ONLINE")).toBeInTheDocument();
    expect(screen.getAllByText("EMPTY SLOT")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.getByRole("button", { name: "LEAVE PARTY" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "INVITE FRIENDS" }));
    fireEvent.click(screen.getByRole("button", { name: /INVITE FRIEND\b.*7 ONLINE/ }));
    expect(onInvite).toHaveBeenCalledTimes(2);
  });

  it("the host: × on every other bean by account id, a pending slot counting, and the code to copy", () => {
    const onKick = vi.fn();
    const onCopyCode = vi.fn();
    render(
      <PartyStrip
        members={[
          you,
          { accountId: "a2", name: "Floppo", look: NO_AVATAR, level: 31 },
          { accountId: "a3", name: "Goopy", look: NO_AVATAR, level: 12, away: "IN A MATCH" },
          { accountId: "a4", name: "Wiggly", look: NO_AVATAR, pending: true, waiting: "0:42" },
        ]}
        code="4K7NQX"
        onCopyCode={onCopyCode}
        onKick={onKick}
      />,
    );

    expect(screen.getByText("3/4 · 1 INVITED")).toBeInTheDocument();
    expect(screen.getByText("READY · LVL 31")).toBeInTheDocument();
    expect(screen.getByText("IN A MATCH")).toBeInTheDocument();
    expect(screen.getByText("INVITED · 0:42")).toBeInTheDocument();
    // Full with the invite: no invite slot, no INVITE FRIENDS, no code to share.
    expect(screen.queryByRole("button", { name: "INVITE FRIENDS" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy the party code/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove Floppo from the party" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel invite to Wiggly" }));
    expect(onKick.mock.calls).toEqual([["a2"], ["a4"]]);
  });

  it("the host's code chip copies while there is room", () => {
    const onCopyCode = vi.fn();
    render(<PartyStrip members={[you, { accountId: "a2", name: "Floppo", look: NO_AVATAR }]} code="4K7NQX" onCopyCode={onCopyCode} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy the party code 4K7NQX" }));
    expect(onCopyCode).toHaveBeenCalledTimes(1);
  });

  it("a member: the host's title and line, no ×, no invites, WAITING FOR HOST", () => {
    render(
      <PartyStrip
        isHost={false}
        title="FLOPPO'S PARTY"
        note="Only the host can invite or remove beans."
        members={[
          { accountId: "a2", name: "Floppo", look: NO_AVATAR, host: true, away: "IN THE LOBBY" },
          { accountId: "me", name: "Noodle", look: NO_AVATAR, level: 42, you: true },
        ]}
      />,
    );

    expect(screen.getByText("FLOPPO'S PARTY")).toBeInTheDocument();
    expect(screen.getByText("Only the host can invite or remove beans.")).toBeInTheDocument();
    expect(screen.getByText("HOST · IN THE LOBBY")).toBeInTheDocument();
    expect(screen.getByText("YOU · LVL 42")).toBeInTheDocument();
    expect(screen.getAllByText(/WAITING/)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Remove|Cancel invite/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "INVITE FRIENDS" })).toBeNull();
    expect(screen.getByRole("button", { name: "LEAVE PARTY" })).not.toBeDisabled();
  });
});
