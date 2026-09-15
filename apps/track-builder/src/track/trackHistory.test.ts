import type { Track } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { TrackHistory } from "./trackHistory.js";

const trackOf = (moduleId: string): Track => [{ moduleId, position: { x: 0, y: 0, z: 0 }, rotation: 0 }];

describe("TrackHistory", () => {
  it("starts at the given initial Track with nothing to undo/redo", () => {
    const history = new TrackHistory(trackOf("a"));
    expect(history.track).toEqual(trackOf("a"));
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it("apply moves to the new state and makes it undoable", () => {
    const history = new TrackHistory(trackOf("a"));
    history.apply(trackOf("b"));
    expect(history.track).toEqual(trackOf("b"));
    expect(history.canUndo).toBe(true);
  });

  it("undo restores the previous state and enables redo", () => {
    const history = new TrackHistory(trackOf("a"));
    history.apply(trackOf("b"));
    history.undo();
    expect(history.track).toEqual(trackOf("a"));
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it("redo re-applies what was undone", () => {
    const history = new TrackHistory(trackOf("a"));
    history.apply(trackOf("b"));
    history.undo();
    history.redo();
    expect(history.track).toEqual(trackOf("b"));
    expect(history.canRedo).toBe(false);
  });

  it("a fresh apply after undo clears the redo stack", () => {
    const history = new TrackHistory(trackOf("a"));
    history.apply(trackOf("b"));
    history.undo();
    history.apply(trackOf("c"));
    expect(history.canRedo).toBe(false);
    history.undo();
    expect(history.track).toEqual(trackOf("a"));
  });

  it("undoes through several steps in order", () => {
    const history = new TrackHistory(trackOf("a"));
    history.apply(trackOf("b"));
    history.apply(trackOf("c"));
    history.apply(trackOf("d"));
    history.undo();
    history.undo();
    history.undo();
    expect(history.track).toEqual(trackOf("a"));
    expect(history.canUndo).toBe(false);
  });

  it("undo/redo past the ends are no-ops", () => {
    const history = new TrackHistory(trackOf("a"));
    history.undo();
    expect(history.track).toEqual(trackOf("a"));
    history.redo();
    expect(history.track).toEqual(trackOf("a"));
  });

  it("reset replaces the state without creating an undo step", () => {
    const history = new TrackHistory(trackOf("a"));
    history.apply(trackOf("b"));
    history.reset(trackOf("loaded"));
    expect(history.track).toEqual(trackOf("loaded"));
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});
