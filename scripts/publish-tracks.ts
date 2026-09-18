/**
 * Publishes the code-authored Tracks (`packages/shared/src/track/authoredTracks.ts`)
 * to a running API: Spin Cycle and Slip Stream (Races), Cog Arena and Sky
 * Rings (Survival arenas).
 *
 * They are content, not the boot seed — ADR 0078 leaves exactly one of those,
 * the base race — so they go up the normal builder path. Re-runnable:
 * publishing under the same id stores a new Revision (ADR 0032), never
 * rewrites one, so re-run after editing a Track's file.
 *
 * Each carries its Thumbnail from `assets/` (ADR 0105), rendered beforehand by
 * `pnpm render:thumbnails`.
 *
 * Usage:  pnpm publish:tracks
 *         pnpm publish:tracks --api http://localhost:8081
 *         pnpm publish:tracks --only spin-cycle
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTHORED_TRACKS, DEFAULT_API_PORT, TRACK_THUMBNAIL_DATA_URL_PREFIX } from "../packages/shared/src/index.js";

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

const argValue = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
};

const api = argValue("api") ?? `http://localhost:${DEFAULT_API_PORT}`;
const only = argValue("only");
const wanted = only === undefined ? AUTHORED_TRACKS : AUTHORED_TRACKS.filter((authored) => authored.id === only);
if (wanted.length === 0) {
  console.error(`no authored Track with id "${only}" — have ${AUTHORED_TRACKS.map((a) => a.id).join(", ")}`);
  process.exit(1);
}

let failed = 0;
for (const authored of wanted) {
  // Its picture rides with it (ADR 0105), as the base race's does; a Track
  // whose file was never rendered publishes without one.
  const { thumbnailFile, ...fields } = authored;
  const picture = join(assetsDir, thumbnailFile);
  const thumbnail = existsSync(picture) ? `${TRACK_THUMBNAIL_DATA_URL_PREFIX}${readFileSync(picture).toString("base64")}` : undefined;
  if (thumbnail === undefined) console.warn(`${authored.id}: no assets/${thumbnailFile} — run pnpm render:thumbnails`);
  const res = await fetch(`${api}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...fields, ...(thumbnail === undefined ? {} : { thumbnail }) }),
  });
  if (!res.ok) {
    console.error(`${authored.id}: publish failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
    failed += 1;
    continue;
  }
  const { id } = (await res.json()) as { id: string };
  const stored = (await (await fetch(`${api}/tracks/${encodeURIComponent(id)}`)).json()) as {
    revision: number;
    name: string | null;
    track: unknown[];
  };
  console.log(`published "${stored.name}" as ${id} (revision ${stored.revision}, ${stored.track.length} Segments)`);
}
if (failed > 0) process.exit(1);
