// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { avatarLook } from "../lib/avatar.js";
import Avatar from "./Avatar";

describe("Avatar (ADR 0110)", () => {
  it("draws the Account's picture over its bean-coloured disc, and the disc alone when the picture fails", () => {
    const { container } = render(<Avatar look={avatarLook("acc-7", 2)} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toMatch(/\/avatars\/acc-7$/);
    const disc = container.firstElementChild as HTMLElement;
    expect(disc.style.getPropertyValue("--df-skin-a")).toBe("#B6F5A0");

    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
  });

  it("an anonymous seat is the disc alone", () => {
    const { container } = render(<Avatar look={avatarLook(null, null)} />);
    expect(container.querySelector("img")).toBeNull();
  });
});
