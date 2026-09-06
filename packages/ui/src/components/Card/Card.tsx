import type { ButtonHTMLAttributes } from "react";
import styles from "./Card.module.css";

export type CardProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** A clickable card primitive — Track cards, Module previews, etc. */
export function Card({ className, type = "button", ...rest }: CardProps) {
  return <button type={type} className={[styles.card, className].filter(Boolean).join(" ")} {...rest} />;
}
