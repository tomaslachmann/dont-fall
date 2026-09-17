import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FLASH_TTL_MS,
  MAX_FLASHES,
  clearFlashes,
  dismissFlash,
  flash,
  getFlashesSnapshot,
  subscribeFlashes,
} from "./flash.js";

describe("flash store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearFlashes();
  });

  afterEach(() => {
    clearFlashes();
    vi.useRealTimers();
  });

  it("pushes a success flash subscribers observe", () => {
    const seen: string[] = [];
    const stop = subscribeFlashes(() => {
      seen.push(getFlashesSnapshot().map((f) => f.title).join("|"));
    });

    flash("Invite sent.");

    expect(getFlashesSnapshot()).toEqual([{ id: 1, title: "Invite sent.", tone: "success" }]);
    expect(seen).toEqual(["Invite sent."]);
    stop();
  });

  it("keeps the snapshot reference stable while nothing changes", () => {
    flash("Invite sent.");

    expect(getFlashesSnapshot()).toBe(getFlashesSnapshot());
  });

  it("auto-dismisses success and info flashes after the TTL", () => {
    flash("Invite sent.", "success");
    flash("Nobody online to invite.", "info");
    expect(getFlashesSnapshot()).toHaveLength(2);

    vi.advanceTimersByTime(FLASH_TTL_MS);

    expect(getFlashesSnapshot()).toEqual([]);
  });

  it("never auto-dismisses an error flash — failures wait for acknowledgement", () => {
    flash("Could not join that Lobby.", "error");

    vi.advanceTimersByTime(FLASH_TTL_MS * 10);

    expect(getFlashesSnapshot()).toHaveLength(1);
    dismissFlash(getFlashesSnapshot()[0]!.id);
    expect(getFlashesSnapshot()).toEqual([]);
  });

  it("a manual dismiss stops the pending auto-dismiss", () => {
    const listener = vi.fn();
    const stop = subscribeFlashes(listener);
    const id = flash("Invite sent.");
    listener.mockClear();

    dismissFlash(id);
    expect(getFlashesSnapshot()).toEqual([]);
    // The dismiss itself emitted; the stopped timer must add nothing more.
    listener.mockClear();
    vi.advanceTimersByTime(FLASH_TTL_MS * 2);
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it("caps the stack, dropping the oldest first", () => {
    for (let i = 0; i < MAX_FLASHES + 2; i++) flash(`flash ${i}`);

    const titles = getFlashesSnapshot().map((f) => f.title);
    expect(titles).toHaveLength(MAX_FLASHES);
    expect(titles[0]).toBe("flash 2");
  });

  it("clearFlashes empties the stack and stops every timer", () => {
    const listener = vi.fn();
    const stop = subscribeFlashes(listener);
    flash("Invite sent.");
    listener.mockClear();

    clearFlashes();
    expect(getFlashesSnapshot()).toEqual([]);
    // The clear itself emitted; the stopped timers must add nothing more.
    listener.mockClear();
    vi.advanceTimersByTime(FLASH_TTL_MS * 2);
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});
