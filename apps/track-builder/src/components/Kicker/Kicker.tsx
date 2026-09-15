import type { ReactNode } from "react";
import css from "./Kicker.module.css";

/** The 9px all-caps section label used everywhere in the tool. */
export function Kicker({ children, tone = "quiet" }: { children: ReactNode; tone?: "quiet" | "ink" }) {
  return <span className={[css.kicker, css[tone]].join(" ")}>{children}</span>;
}
