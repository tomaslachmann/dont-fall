import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button } from "./Button";
import styles from "./Button.module.css";

describe("Button", () => {
  it("renders its label and fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Play</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("applies the pressed class on pointerdown and drops it on pointerup", () => {
    render(<Button>Play</Button>);
    const button = screen.getByRole("button", { name: "Play" });

    fireEvent.pointerDown(button);
    expect(button.className).toContain(styles.pressed);

    fireEvent.pointerUp(button);
    expect(button.className).not.toContain(styles.pressed);
    expect(button.className).toContain(styles.releasing);
  });

  it("does not press when disabled", () => {
    render(<Button disabled>Play</Button>);
    const button = screen.getByRole("button", { name: "Play" });
    fireEvent.pointerDown(button);
    expect(button.className).not.toContain(styles.pressed);
  });

  it("defaults to the primary variant and switches to secondary", () => {
    const { rerender } = render(<Button>Play</Button>);
    expect(screen.getByRole("button").className).toContain(styles.primary);

    rerender(<Button variant="secondary">Play</Button>);
    expect(screen.getByRole("button").className).toContain(styles.secondary);
  });
});
