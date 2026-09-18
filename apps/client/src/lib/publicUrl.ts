/**
 * A file from `public/` at the path the page is served under (ADR 0107):
 * `/` locally, `/<repo>/` on GitHub Pages. Everything the client fetches from
 * its own `public/` goes through this, never through a bare `/models/…`.
 */
export const publicUrl = (path: string): string => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;

/** The Track builder, beside the game: its own dev server locally, `/<repo>/builder/` on Pages (`VITE_BUILDER_URL`). */
export const builderUrl = (): string => import.meta.env.VITE_BUILDER_URL ?? "http://localhost:5174";

/** What React Router strips off every path — the page's base without its trailing slash. */
export const routerBasename = (): string => import.meta.env.BASE_URL.replace(/\/+$/, "") || "/";
