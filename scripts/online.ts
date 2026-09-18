/**
 * The whole game on one address (ADR 0108), and the link to send.
 *
 * Starts the Docker stack — the API and the `web` image in front of it (the
 * game at /, the builder at /builder/, the API at /api) — waits for it,
 * publishes every authored Track the database lacks, and prints the link. In a
 * Codespace the link is port 8088's forwarded address, made public;
 * locally it is http://localhost:8088. The containers keep running after this
 * exits; running it again rebuilds what changed and prints the link again.
 *
 * `.devcontainer/` runs it on every Codespace start. Always `pnpm run online`:
 * a bare `pnpm online` can be taken for `pnpm exec`.
 *
 * Usage:  pnpm run online
 *         pnpm run online --port 8088
 *         pnpm run online --public https://my.server.example   (only changes the printed link)
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

const argValue = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
};
const port = Number(argValue("port") ?? process.env.DONTFALL_WEB_PORT ?? 8088);
const local = `http://localhost:${port}`;
const codespace = process.env.CODESPACE_NAME;

/** Where players open the game: the flag, else the Codespace's forwarded address for the port, else this machine. */
const publicUrl = ((): string => {
  const flag = argValue("public");
  if (flag) return new URL(flag).origin;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (codespace && domain) return `https://${codespace}-${port}.${domain}`;
  return local;
})();

const run = (command: string, args: string[]): void => {
  execFileSync(command, args, { cwd: repo, stdio: "inherit", env: { ...process.env, DONTFALL_WEB_PORT: String(port) } });
};

const healthy = async (): Promise<boolean> => {
  try {
    return (await fetch(`${local}/api/health`)).ok;
  } catch {
    return false;
  }
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

console.log("starting the game in Docker (the first build takes a few minutes)…");
run("docker", ["compose", "up", "-d", "--build", "api", "web"]);

let waited = 0;
while (!(await healthy())) {
  if (waited > 600_000) {
    console.error(`nothing answered on ${local}/api/health in ten minutes — see: docker compose logs api web`);
    process.exit(1);
  }
  await sleep(1000);
  waited += 1000;
}

run("pnpm", ["-s", "run", "publish:tracks", "--api", `${local}/api`, "--missing"]);

if (codespace) {
  try {
    execFileSync("gh", ["codespace", "ports", "visibility", `${port}:public`, "-c", codespace], { stdio: "ignore" });
    console.log(`port ${port} is public`);
  } catch {
    console.log(`Could not make port ${port} public from here: open the PORTS tab, right-click ${port}, Port Visibility → Public.`);
  }
}

const rule = "─".repeat(72);
console.log(`\n${rule}\n DON'T FALL is online\n\n  play:    ${publicUrl}/\n  builder: ${publicUrl}/builder/\n\n Send the play link. Sign in with email and password.\n${rule}\n`);
