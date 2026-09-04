import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Row } from "./Row";
import styles from "./Row.module.css";

describe("Row", () => {
  it("renders its label", () => {
    render(<Row label="jr_wobbles" />);
    expect(screen.getByText("jr_wobbles")).toBeInTheDocument();
  });

  it("renders leading and trailing content", () => {
    render(<Row leading={<span>JR</span>} label="jr_wobbles" trailing={<span>0:47.8</span>} />);
    expect(screen.getByText("JR")).toBeInTheDocument();
    expect(screen.getByText("0:47.8")).toBeInTheDocument();
  });

  it("renders as a div by default and a button when interactive", () => {
    const { rerender, container } = render(<Row label="Wobble Canyon" />);
    expect(container.querySelector("div")?.className).toContain(styles.row);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    const onClick = vi.fn();
    rerender(<Row label="Wobble Canyon" interactive onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("applies host/own-row/dnf modifier classes", () => {
    const { container, rerender } = render(<Row label="You" isHost />);
    expect(container.firstElementChild?.className).toContain(styles.isHost);

    rerender(<Row label="You" isOwnRow />);
    expect(container.firstElementChild?.className).toContain(styles.isOwnRow);

    rerender(<Row label="Falling_Star" variant="dnf" />);
    expect(container.firstElementChild?.className).toContain(styles.dnf);
  });

  it("defaults to the flat surface and can render as a card", () => {
    const { container, rerender } = render(<Row label="Wobble Canyon" />);
    expect(container.firstElementChild?.className).toContain(styles.flat);

    rerender(<Row label="jr_wobbles" surface="card" />);
    expect(container.firstElementChild?.className).toContain(styles.card);
  });
});
