// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { ConnectionError } from "../lib/errors.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const Boom = (): never => {
  throw new Error("render kaboom");
};

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>fine</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText("fine")).toBeInTheDocument();
  });

  it("a render crash becomes the crash ErrorScreen, and retry recovers", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let explode = true;
    const MaybeBoom = () => {
      if (explode) throw new Error("render kaboom");
      return <div>recovered</div>;
    };

    render(
      <ErrorBoundary>
        <MaybeBoom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("SOMETHING BROKE")).toBeInTheDocument();

    explode = false;
    const retry = screen.getByRole("button", { name: /RETRY|TRY AGAIN/i });
    fireEvent.click(retry);
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("a ConnectionError renders the connection screen with the real reason", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ConnBoom = (): never => {
      throw new ConnectionError("server unreachable");
    };

    render(
      <ErrorBoundary>
        <ConnBoom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("CONNECTION LOST")).toBeInTheDocument();
    expect(screen.getByText("server unreachable")).toBeInTheDocument();
  });

  it("reports the crash to onError", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it("files the crash under the support code it shows (ADR 0110)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports: { code: string; kind: string; message: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        reports.push(JSON.parse(String(init?.body)));
        return Response.json({ code: "x" }, { status: 201 });
      }),
    );

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    const shown = screen.getByText(/^DF-[A-Z0-9]{4}-[A-Z0-9]{2}$/).textContent;
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toMatchObject({ code: shown, kind: "crash" });
    expect(reports[0]!.message).toContain("render kaboom");
  });
});
