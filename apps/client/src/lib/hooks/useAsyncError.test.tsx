// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../../components/ErrorBoundary.js";
import { ConnectionError } from "../errors.js";
import { useAsyncError } from "./useAsyncError.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const ThrowOnClick = ({ failure }: { failure: unknown }) => {
  const throwAsync = useAsyncError();
  return (
    <button type="button" onClick={() => throwAsync(failure)}>
      doomed
    </button>
  );
};

describe("useAsyncError", () => {
  it("routes an event-handler failure to the boundary's crash screen", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowOnClick failure={new Error("async kaboom")} />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: "doomed" }));

    expect(screen.getByText("SOMETHING BROKE")).toBeInTheDocument();
    expect(screen.getByText("async kaboom")).toBeInTheDocument();
  });

  it("a ConnectionError becomes the connection screen, not a crash", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowOnClick failure={new ConnectionError("server unreachable")} />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: "doomed" }));

    expect(screen.getByText("CONNECTION LOST")).toBeInTheDocument();
    expect(screen.getByText("server unreachable")).toBeInTheDocument();
  });

  it("wraps a non-Error into one rather than throwing a string", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <ThrowOnClick failure="just a string" />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: "doomed" }));

    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(screen.getByText("just a string")).toBeInTheDocument();
  });
});
