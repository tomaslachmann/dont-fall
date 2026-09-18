/**
 * Builds the game and the Track builder for GitHub Pages (ADR 0107) into
 * `site/`: the game at the Pages root of this repo (`/<repo>/`), the builder
 * beside it at `/<repo>/builder/`. `.github/workflows/pages.yml` runs this on
 * every push to `main` and deploys `site/`.
 *
 * Neither build knows where the server is. A player's link carries it
 * (`?server=https://…`), which is what `pnpm online` prints. Set
 * `PAGES_SERVER_URL` to bake a default in for a server with a fixed address.
 *
 * Usage:  pnpm build:pages
 *         PAGES_BASE=/dont-fall/ PAGES_SERVER_URL=https://… pnpm build:pages
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(repo, "site");

/** `/<repo>/` — from the Actions environment, else from this checkout's own remote. */
const repoName = (): string => {
  const fromActions = process.env.GITHUB_REPOSITORY?.split("/")[1];
  if (fromActions) return fromActions;
  const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: repo, encoding: "utf8" }).trim();
  return remote.replace(/\.git$/, "").split(/[/:]/).pop()!;
};
const base = process.env.PAGES_BASE ?? `/${repoName()}/`;
const server = process.env.PAGES_SERVER_URL ? { VITE_SERVER_URL: process.env.PAGES_SERVER_URL } : {};

const viteBuild = (pkg: string, args: string[], env: Record<string, string>): void => {
  console.log(`building ${pkg} under ${args[1]}`);
  execFileSync("pnpm", ["--filter", pkg, "exec", "vite", "build", ...args, "--emptyOutDir"], {
    cwd: repo,
    stdio: "inherit",
    env: { ...process.env, ...server, ...env },
  });
};

viteBuild("@dont-fall/client", ["--base", base, "--outDir", site], { VITE_BUILDER_URL: `${base}builder/` });
viteBuild("@dont-fall/track-builder", ["--base", `${base}builder/`, "--outDir", join(site, "builder")], { VITE_CLIENT_URL: base });

// Pages answers an unknown path with 404.html: the game's own page, so a deep
// link (`/<repo>/lobby?port=…`) still boots the app and its router takes over.
copyFileSync(join(site, "index.html"), join(site, "404.html"));
// Serve the files as they are; nothing here is a Jekyll site.
writeFileSync(join(site, ".nojekyll"), "");
console.log(`site/ ready for ${base}`);
