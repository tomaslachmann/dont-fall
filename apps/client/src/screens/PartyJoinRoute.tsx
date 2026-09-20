import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { joinPartyByCode } from "../lib/api/party.js";
import { flash } from "../lib/flash.js";
import { joinedPartyMessage } from "../lib/social/partyView.js";
import { LoadingScreen } from "./LoadingScreen.js";

/**
 * `/party/:code` — a Party code's SHARE LINK (ADR 0112). Joins that Party
 * (leaving your own, as accepting any Party is), then the main menu, which
 * wears the Party you are now in, with a flash saying whose it is — or why
 * not, in the API's own words (an expired code, a full Party). A signed-out
 * visitor gets here after signing in (`useHeldPartyLink`).
 */
export function PartyJoinRoute() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  // One join per visit: StrictMode runs this effect twice, and a second
  // POST would answer "already in that party" over the first's welcome.
  const asked = useRef(false);
  // Whether the Player is still here when the join answers. A Party sitting
  // in a Lobby with its host sends the joiner a `follow` over the Account
  // socket before this POST's answer is written (ADR 0112), and the alert
  // stack has already taken them into that Lobby — the menu must not pull
  // them back out of it.
  const here = useRef(true);
  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    joinPartyByCode(code)
      .then(
        (joined) => flash(joinedPartyMessage(joined)),
        (err: unknown) => flash(err instanceof Error ? err.message : "Could not join that party.", "error"),
      )
      .finally(() => {
        if (here.current) navigate("/", { replace: true });
      });
  }, [code, navigate]);

  return <LoadingScreen label="JOINING THE PARTY…" />;
}
