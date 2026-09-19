import { Component, Fragment, type ReactNode } from "react";
import ErrorScreen from "../screens/ErrorScreen.js";
import { ConnectionError } from "../lib/errors.js";
import { newSupportCode, reportClientError } from "../lib/errorReport.js";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Test/dev seam — observed, never rendered. Production just logs. */
  onError?: (error: unknown) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** The support code this failure is filed under (ADR 0110) — what the screen shows. */
  code: string;
  /** Bumped on every retry so the tree remounts from scratch below. */
  attempt: number;
}

/**
 * The app-wide failure net (`main.tsx`, around everything): any render
 * crash — or any async failure routed here via `useAsyncError` (boundaries
 * can't catch those on their own) — becomes the one designed `ErrorScreen`
 * instead of a white page or a per-component error banner. Components
 * `throw`; nobody wires an error UI twice.
 *
 * A `ConnectionError` (refused lobby welcome, dropped socket, dead API)
 * renders the connection kind with the real reason in the detail line;
 * everything else is a crash. Retry remounts the whole tree below (the
 * `key`, not just a re-render — a crashed tree re-rendered in place just
 * throws again, and a redial needs a fresh mount anyway). Home
 * hard-navigates to `/`: after a crash the render tree proved itself
 * untrustworthy, so this is a fresh boot, not a router push.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, code: newSupportCode(), attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)), code: newSupportCode() };
  }

  override componentDidCatch(error: unknown): void {
    console.error("DON'T FALL: render crash caught by ErrorBoundary", error);
    // ADR 0110: filed under the code the screen shows, so support can find it.
    reportClientError({
      code: this.state.code,
      kind: error instanceof ConnectionError ? "connection" : "crash",
      message: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
    });
    this.props.onError?.(error);
  }

  private readonly retry = (): void => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  private readonly goHome = (): void => {
    window.location.assign(import.meta.env.BASE_URL);
  };

  override render(): ReactNode {
    const { error, attempt } = this.state;
    if (error !== null) {
      return (
        <ErrorScreen
          kind={error instanceof ConnectionError ? "connection" : "crash"}
          code={this.state.code}
          retryIn={0}
          detail={error.message}
          onRetry={this.retry}
          onHome={this.goHome}
        />
      );
    }
    return <Fragment key={attempt}>{this.props.children}</Fragment>;
  }
}
