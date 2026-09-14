// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import FriendAlerts from "./FriendAlerts";

const REQUEST = {
  id: "r1",
  fromAccountId: "a5",
  fromDisplayName: "Goopy",
  fromAvatarUrl: null,
  sentAt: 1,
  matchesTogether: 4,
};

const INVITE = {
  id: "i1",
  fromAccountId: "a2",
  fromDisplayName: "Floppo",
  lobby: { kind: "public", lobbyId: "l1" } as const,
  sentAt: 1,
};

describe("FriendAlerts", () => {
  it("renders nothing with no requests and no invites", () => {
    const { container } = render(
      <FriendAlerts
        requests={[]}
        invites={[]}
        onAccept={() => {}}
        onDecline={() => {}}
        onJoinInvite={() => {}}
        onDismissInvite={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("answers requests in place and joins or dismisses invites", () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const onJoinInvite = vi.fn();
    const onDismissInvite = vi.fn();
    render(
      <FriendAlerts
        requests={[REQUEST]}
        invites={[INVITE]}
        onAccept={onAccept}
        onDecline={onDecline}
        onJoinInvite={onJoinInvite}
        onDismissInvite={onDismissInvite}
      />,
    );

    expect(screen.getByText("GOOPY WANTS IN")).toBeInTheDocument();
    expect(screen.getByText("FLOPPO INVITED YOU")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Accept Goopy" }));
    expect(onAccept).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByRole("button", { name: "Decline Goopy" }));
    expect(onDecline).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByRole("button", { name: "JOIN" }));
    expect(onJoinInvite).toHaveBeenCalledWith(INVITE);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss invite from Floppo" }));
    expect(onDismissInvite).toHaveBeenCalledWith("i1");
  });
});
