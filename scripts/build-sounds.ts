/**
 * Builds `apps/client/public/sounds/` and its `CREDITS.md` from
 * `scripts/sound-library.ts` (M14 ticket 01, ADR 0087). Needs `ffmpeg` with
 * `libopus` on the PATH. Deterministic: it wipes the output first, so a row
 * removed from the table is a file removed from the game.
 *
 * Usage:  pnpm build:sounds
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MUSIC_LUFS, SOUND_LIBRARY, type Job } from "./sound-library.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "assets", "audio");
const OUT = join(root, "apps", "client", "public", "sounds");

const ffmpeg = (args: string[]): void => {
  execFileSync("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "inherit"] });
};

/** Runs an analysis pass (no output file) and returns ffmpeg's stderr, where filters report. */
const analyse = (args: string[]): string => {
  const run = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", ...args, "-f", "null", "-"], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`ffmpeg analysis failed: ${run.stderr}`);
  return run.stderr;
};

/** Integrated loudness (LUFS) of `input` after `filter`. */
const loudness = (inputArgs: string[], filter: string): number => {
  const stderr = analyse([...inputArgs, "-af", `${filter}${filter ? "," : ""}loudnorm=print_format=json`]);
  const json = stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1);
  const value = Number((JSON.parse(json) as { input_i: string }).input_i);
  if (!Number.isFinite(value)) throw new Error(`no loudness measured for ${inputArgs.join(" ")}`);
  return value;
};

/** Peak level (dBFS) of `input` after `filter`. */
const peak = (inputArgs: string[], filter: string): number => {
  const stderr = analyse([...inputArgs, "-af", `${filter}${filter ? "," : ""}volumedetect`]);
  const match = /max_volume: (-?[\d.]+) dB/.exec(stderr);
  if (!match) throw new Error(`no peak measured for ${inputArgs.join(" ")}`);
  return Number(match[1]);
};

/** The gain that brings `input` to `lufs`, lowered if it would push a peak past −1 dBFS. */
const cappedGain = (inputArgs: string[], lufs: number): number =>
  Math.min(lufs - loudness(inputArgs, ""), -1 - peak(inputArgs, ""));

const OPUS = (stereo: boolean, bitrate: number): string[] => [
  "-c:a",
  "libopus",
  "-b:a",
  `${bitrate}k`,
  "-ar",
  "48000",
  "-ac",
  stereo ? "2" : "1",
  "-map_metadata",
  "-1",
];

const build = (job: Job): void => {
  const src = join(SRC, job.src);
  const out = join(OUT, job.out);
  mkdirSync(dirname(out), { recursive: true });

  switch (job.kind) {
    case "copy":
      copyFileSync(src, out);
      return;

    case "oneshot": {
      const input = [...(job.start !== undefined ? ["-ss", String(job.start)] : []), ...(job.end !== undefined ? ["-to", String(job.end)] : []), "-i", src];
      // Trim silence at both ends, then a 5 ms fade in and a 30 ms fade out so a cut never clicks.
      const shape =
        "silenceremove=start_periods=1:start_threshold=-50dB,areverse," +
        "silenceremove=start_periods=1:start_threshold=-50dB,afade=t=in:d=0.03,areverse,afade=t=in:d=0.005";
      const gain = -1 - peak(input, shape);
      ffmpeg(["-y", ...input, "-af", `${shape},volume=${gain.toFixed(2)}dB`, ...OPUS(job.stereo ?? false, 64), out]);
      return;
    }

    case "loop": {
      const { seconds: L, crossfade: X } = job;
      const input = ["-ss", String(job.start ?? 0), "-t", String(L + X), "-i", src];
      const pre = job.filter ?? "anull";
      // body = [X, L]; the join = tail [L, L+X] fading out mixed over head [0, X] fading in.
      // The loop's last sample is the head's end, which is the body's first: seamless.
      const graph =
        `[0:a]${pre},asplit=3[a][b][c];` +
        `[a]atrim=start=${X}:end=${L},asetpts=PTS-STARTPTS[body];` +
        `[b]atrim=start=${L}:end=${L + X},asetpts=PTS-STARTPTS,afade=t=out:st=0:d=${X}:curve=qsin[tail];` +
        `[c]atrim=start=0:end=${X},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${X}:curve=qsin[head];` +
        `[tail][head]amix=inputs=2:normalize=0[join];` +
        `[body][join]concat=n=2:v=0:a=1`;
      const tmp = `${out}.wav`;
      ffmpeg(["-y", ...input, "-filter_complex", graph, "-c:a", "pcm_s16le", tmp]);
      // A static gain only: a limiter's look-ahead delays the signal and breaks the seam.
      const gain = cappedGain(["-i", tmp], job.lufs);
      ffmpeg(["-y", "-i", tmp, "-af", `volume=${gain.toFixed(2)}dB`, ...OPUS(job.stereo ?? false, job.stereo ? 96 : 64), out]);
      rmSync(tmp);
      return;
    }

    case "music": {
      const input = ["-i", src];
      const gain = cappedGain(input, MUSIC_LUFS);
      ffmpeg(["-y", ...input, "-map", "0:a:0", "-af", `volume=${gain.toFixed(2)}dB`, ...OPUS(true, 96), out]);
      return;
    }
  }
};

const credits = (): string => {
  const rows = SOUND_LIBRARY.map(({ out, origin }) => {
    const source = origin.url ? `<${origin.url}>` : "—";
    return `| \`${out}\` | ${origin.title} | ${origin.author} | ${origin.licence} | ${source} |`;
  });
  return [
    "# Sound credits",
    "",
    "Generated by `pnpm build:sounds` from `scripts/sound-library.ts` (M14, ADR 0087). Do not edit by",
    "hand. Every file under this folder has exactly one row; a test holds it.",
    "",
    "Licences: **CC0** needs no credit (given anyway). **CC-BY** needs the author credited, which the",
    "in-game Credits screen does from this file. **Generated** is music made by the game's author;",
    "its rights follow the author's plan with that service. Non-commercial licences are never used.",
    "",
    "| File | Title | Author | Licence | Source |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
};

const main = (): void => {
  const outs = new Set<string>();
  for (const job of SOUND_LIBRARY) {
    if (outs.has(job.out)) throw new Error(`two rows write ${job.out}`);
    outs.add(job.out);
  }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const job of SOUND_LIBRARY) {
    process.stdout.write(`${job.kind.padEnd(7)} ${job.out}\n`);
    build(job);
  }
  writeFileSync(join(OUT, "CREDITS.md"), credits());
  process.stdout.write(`\n${SOUND_LIBRARY.length} files, CREDITS.md written to ${OUT}\n`);
};

main();
