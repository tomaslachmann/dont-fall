/**
 * Runs the server for online play (ADR 0107) and prints the link to send.
 *
 * The game is on GitHub Pages; this is the other half. In a Codespace
 * everything is worked out: the public address of port 8081, the Pages URL of
 * this repo, and making the port public. `.devcontainer/` runs this on every
 * start, and running it again in a terminal just prints the link.
 *
 * It starts the API unless one already answers, publishes every authored Track
 * the database lacks (`publish:tracks --missing`), and stays in the foreground
 * for as long as the API it started runs.
 *
 * Usage:  pnpm online                                  (in a Codespace)
 *         pnpm online --public https://my.server.example --port 8081
 *         pnpm online --pages https://someone.github.io/dont-fall/
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

const argValue = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
};
const port = Number(argValue("port") ?? process.env.API_PORT ?? 8081);
const local = `http://localhost:${port}`;
const codespace = process.env.CODESPACE_NAME;

/** Where players reach this API: the flag, else the Codespace's forwarded address for the port. */
const publicOrigin = ((): string => {
  const flag = argValue("public");
  if (flag) return new URL(flag).origin;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (codespace && domain) return `https://${codespace}-${port}.${domain}`;
  console.error("Not in a Codespace: say where players reach this server with --public https://…");
  process.exit(1);
})();

/** This repo's Pages URL: the flag, else `https://<owner>.github.io/<repo>/` from the Codespace or the git remote. */
const pagesUrl = ((): string => {
  const flag = argValue("pages");
  if (flag) return flag.endsWith("/") ? flag : `${flag}/`;
  const slug =
    process.env.GITHUB_REPOSITORY ??
    execFileSync("git", ["remote", "get-url", "origin"], { cwd: repo, encoding: "utf8" })
      .trim()
      .replace(/\.git$/, "")
      .split(/[:/]/)
      .slice(-2)
      .join("/");
  const [owner, name] = slug.split("/");
  return `https://${owner!.toLowerCase()}.github.io/${name}/`;
})();

const healthy = async (): Promise<boolean> => {
  try {
    return (await fetch(`${local}/health`)).ok;
  } catch {
    return false;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let api: ReturnType<typeof spawn> | undefined;
if (await healthy()) {
  console.log(`API already answering on ${local}`);
} else {
  console.log(`starting the API on ${local}…`);
  api = spawn("pnpm", ["--filter", "@dont-fall/api", "start"], {
    cwd: repo,
    stdio: "inherit",
    env: {
      ...process.env,
      API_PORT: String(port),
      // After a Discord login the API sends the browser here — unused online
      // (email and password only, ADR 0107), but never localhost.
      PUBLIC_CLIENT_URL: pagesUrl.replace(/\/$/, ""),
      SERVICE_TOKEN: process.env.SERVICE_TOKEN ?? randomBytes(24).toString("hex"),
    },
  });
  api.on("exit", (code) => process.exit(code ?? 0));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => api?.kill(signal));
  let waited = 0;
  while (!(await healthy())) {
    if (waited > 120_000) {
      console.error("the API did not come up in two minutes");
      api.kill();
      process.exit(1);
    }
    await sleep(500);
    waited += 500;
  }
}

execFileSync("pnpm", ["-s", "publish:tracks", "--api", local, "--missing"], { cwd: repo, stdio: "inherit" });

if (codespace) {
  try {
    execFileSync("gh", ["codespace", "ports", "visibility", `${port}:public`, "-c", codespace], { stdio: "ignore" });
    console.log(`port ${port} is public`);
  } catch {
    console.log(`Could not make port ${port} public from here: open the PORTS tab, right-click ${port}, Port Visibility → Public.`);
  }
}

const rule = "─".repeat(72);
console.log(`\n${rule}\n DON'T FALL is online\n\n  play:    ${pagesUrl}?server=${publicOrigin}\n  builder: ${pagesUrl}builder/?server=${publicOrigin}\n\n Send the play link. Sign in with email and password.\n${rule}\n`);
