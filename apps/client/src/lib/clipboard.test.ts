import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFlashes, getFlashesSnapshot } from "./flash.js";
import { copyText } from "./clipboard.js";

describe("copyText", () => {
  beforeEach(() => {
    clearFlashes();
  });

  afterEach(() => {
    clearFlashes();
    vi.unstubAllGlobals();
  });

  it("flashes the confirmation after a landed write", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    copyText("PLUMJA", "Invite code copied.", "Couldn't copy the code.");
    expect(writeText).toHaveBeenCalledWith("PLUMJA");
    await vi.waitFor(() =>
      expect(getFlashesSnapshot().map(({ title, tone }) => ({ title, tone }))).toEqual([
        { title: "Invite code copied.", tone: "success" },
      ]),
    );
  });

  it("a denied write flashes the failure instead of claiming success", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    copyText("PLUMJA", "Invite code copied.", "Couldn't copy the code.");
    await vi.waitFor(() =>
      expect(getFlashesSnapshot().map(({ title, tone }) => ({ title, tone }))).toEqual([
        { title: "Couldn't copy the code.", tone: "error" },
      ]),
    );
  });

  it("flashes honestly where no clipboard exists", () => {
    vi.stubGlobal("navigator", {});

    copyText("PLUMJA", "Invite code copied.", "Couldn't copy the code.");
    expect(getFlashesSnapshot().map(({ title, tone }) => ({ title, tone }))).toEqual([
      { title: "Clipboard isn't available here.", tone: "error" },
    ]);
  });
});
