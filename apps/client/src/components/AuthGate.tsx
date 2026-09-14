import { Navigate, Outlet } from "react-router";
import { Screen } from "@dont-fall/ui";
import { useAccount } from "../lib/hooks/useAccount.js";
import styles from "./AuthGate.module.css";

/**
 * Wraps every route that requires a logged-in Account (ADR 0052: mandatory,
 * app-wide, no guest path — this explicitly includes `/play?freeroam=1`
 * Practice). A React Router layout route: mounted once for the whole authed
 * subtree, so the session check runs once per app load, not per navigation.
 */
export function AuthGate() {
  const { status } = useAccount();

  if (status === "checking") {
    return (
      <Screen>
        <div className={styles.checking} role="status">
          Checking your session…
        </div>
      </Screen>
    );
  }

  if (status === "unauthed") return <Navigate to="/auth" replace />;

  return <Outlet />;
}
