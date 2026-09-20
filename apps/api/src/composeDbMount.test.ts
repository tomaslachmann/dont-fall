import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Local and Docker API modes share one SQLite database (`dev.sh`
// `--api=local`): the compose `api` and `db-gui` services bind-mount the
// repo's own `apps/api/data` dir at `/data` — the same file the local
// `tsx watch` process opens via its default `./data/track-service.sqlite`.
// A named volume would hide the database from the host and split dev data
// in two again, so there is none.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The `  <name>:` service block of a compose file: following lines indented past it, up to the next top-level key. */
const serviceBlock = (compose: string, service: string): string => {
  const match = compose.match(new RegExp(`^  ${service}:$((?:\\n(?:  .*|))*)`, "m"));
  if (!match) throw new Error(`service "${service}" not found in docker-compose.yml`);
  return match[1]!;
};

const SHARED_DB_MOUNT = "- ./apps/api/data:/data";

const composeFile = (): string => readFileSync(join(repoRoot, "docker-compose.yml"), "utf8");

describe("compose shares one SQLite file with local dev", () => {
  it.each(["api", "db-gui"])("mounts ./apps/api/data at /data in %s", (service) => {
    expect(serviceBlock(composeFile(), service)).toContain(SHARED_DB_MOUNT);
  });

  it("keeps no named volume for the database (comments aside, where the retired one is named)", () => {
    const live = composeFile()
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    expect(live).not.toContain("track-service-data");
  });

  it("recognises what it is looking for", () => {
    const fixture = ["services:", "  api:", "    volumes:", `      ${SHARED_DB_MOUNT}`, "volumes:"].join("\n");
    expect(serviceBlock(fixture, "api")).toContain(SHARED_DB_MOUNT);
    expect(composeFile()).toContain("services:");
    expect(() => serviceBlock(fixture, "missing")).toThrow();
  });
});
