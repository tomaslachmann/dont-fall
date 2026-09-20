import { DEFAULT_BINDINGS, type KeyBindings } from "@dont-fall/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  bindingsStorageKey,
  loadBootBindings,
  readStoredBindings,
  resolveEffectiveBindings,
  writeStoredBindings,
} from "./bindingsStore.js";
import { setStoredToken } from "./api/base.js";

const custom = (): KeyBindings => ({ ...DEFAULT_BINDINGS, hit: ["Mouse0"] });

beforeEach(() => localStorage.clear());

describe("bindingsStorageKey", () => {
  it("scopes the mirror per Account, with a guest lane", () => {
    expect(bindingsStorageKey(null)).toBe("dontfall.bindings.v1:guest");
    expect(bindingsStorageKey("abc")).toBe("dontfall.bindings.v1:abc");
  });
});

describe("readStoredBindings / writeStoredBindings", () => {
  it("round-trips a record and scopes it per Account", () => {
    expect(readStoredBindings(null)).toBeNull();

    writeStoredBindings(null, custom());
    expect(readStoredBindings(null)).toEqual(custom());
    expect(readStoredBindings("abc")).toBeNull();

    writeStoredBindings("abc", DEFAULT_BINDINGS);
    expect(readStoredBindings("abc")).toEqual(DEFAULT_BINDINGS);
    expect(readStoredBindings(null)).toEqual(custom());
  });

  it("reads corrupt or foreign stored JSON as null, never throws", () => {
    localStorage.setItem(bindingsStorageKey(null), "not-json{");
    expect(readStoredBindings(null)).toBeNull();

    localStorage.setItem(bindingsStorageKey(null), JSON.stringify({ favouriteHat: "top" }));
    expect(readStoredBindings(null)).toBeNull();
  });

  it("keeps a mirror written before an action existed, rather than resetting the layout", () => {
    // Exactly what a Player who customised anything before `talk` arrived
    // has in their browser (ADR 0111): every action but the new one. It used
    // to read as nothing at all, so the upgrade that added `talk` would have
    // silently thrown their layout away.
    const { talk: _added, ...beforeTalk } = custom();
    localStorage.setItem(bindingsStorageKey(null), JSON.stringify(beforeTalk));

    expect(readStoredBindings(null)).toEqual(custom());
  });

  it("drops an unbindable control from a stored record instead of rejecting the record", () => {
    localStorage.setItem(bindingsStorageKey(null), JSON.stringify({ ...DEFAULT_BINDINGS, hit: ["Escape"] }));

    expect(readStoredBindings(null)).toEqual({ ...DEFAULT_BINDINGS, hit: [] });
  });
});

describe("resolveEffectiveBindings", () => {
  it("prefers the Account record, then the local mirror, then defaults", () => {
    writeStoredBindings("abc", DEFAULT_BINDINGS);
    writeStoredBindings(null, custom());

    // The Account record wins over every mirror.
    expect(resolveEffectiveBindings({ id: "abc", bindings: custom() })).toEqual(custom());
    // No record: the Account's own mirror — never the guest's.
    expect(resolveEffectiveBindings({ id: "abc", bindings: null })).toEqual(DEFAULT_BINDINGS);
    expect(resolveEffectiveBindings({ id: "xyz", bindings: null })).toEqual(DEFAULT_BINDINGS);
    // Guests read the guest mirror.
    expect(resolveEffectiveBindings(null)).toEqual(custom());
  });
});

describe("loadBootBindings", () => {
  it("boots guests on their mirror and logins on defaults, never another lane's customs", () => {
    writeStoredBindings(null, custom());
    expect(loadBootBindings()).toEqual(custom());

    setStoredToken("tok");
    expect(loadBootBindings()).toEqual(DEFAULT_BINDINGS);
  });
});
