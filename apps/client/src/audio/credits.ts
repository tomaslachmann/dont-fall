/**
 * The rows of `public/sounds/CREDITS.md` (M14, ADR 0087), which
 * `pnpm build:sounds` generates from `scripts/sound-library.ts`. Read by the
 * library's completeness test (ticket 01) and by the Credits screen (ticket 14).
 */

export const SOUND_LICENCES = ["CC0", "CC-BY 3.0", "CC-BY 4.0", "Generated"] as const;
export type SoundLicence = (typeof SOUND_LICENCES)[number];

export interface SoundCredit {
  /** Path under `public/sounds/`, e.g. `character/land_0.ogg`. */
  file: string;
  title: string;
  author: string;
  licence: SoundLicence;
  /** Where the original lives, if it has a page (generated music has none). */
  url: string | undefined;
}

/** Whether a licence obliges the game to name the author (CC-BY, ADR 0087 amendment). */
export const requiresAttribution = (licence: SoundLicence): boolean => licence.startsWith("CC-BY");

/**
 * Every file row of the credits table. Throws on a row it can't read, or with
 * a licence outside {@link SOUND_LICENCES}, so a bad row fails loudly rather
 * than silently dropping a credit.
 */
export const parseSoundCredits = (markdown: string): SoundCredit[] =>
  markdown
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      const [file, title, author, licence, source] = cells;
      if (cells.length !== 5 || !file || !title || !author || !licence || !source) {
        throw new Error(`sound credits: unreadable row: ${line}`);
      }
      if (!(SOUND_LICENCES as readonly string[]).includes(licence)) {
        throw new Error(`sound credits: unknown licence "${licence}" in: ${line}`);
      }
      const url = /^<(.+)>$/.exec(source)?.[1];
      if (requiresAttribution(licence as SoundLicence) && !url) {
        throw new Error(`sound credits: a ${licence} row needs its source link: ${line}`);
      }
      return { file: file.replace(/^`|`$/g, ""), title, author, licence: licence as SoundLicence, url };
    });

/** One work to name on the Credits Screen: every file cut from it shares the line. */
export interface CreditLine {
  title: string;
  author: string;
  licence: SoundLicence;
  url: string | undefined;
}

/** What the Credits Screen shows (M14 ticket 14). */
export interface CreditsView {
  /** Every CC-BY work, by title and author, with its licence and source: the credit its licence requires. */
  attribution: CreditLine[];
  /** CC0 authors, thanked though no credit is owed, each with the works used. */
  thanks: { author: string; works: { title: string; url: string | undefined }[] }[];
  /** The tools the game's author generated the music with. */
  musicTools: string[];
}

const byText = (a: string, b: string): number => a.localeCompare(b);

/** The credits, grouped for reading: one line per work, one entry per CC0 author. */
export const creditsView = (credits: readonly SoundCredit[]): CreditsView => {
  const attribution = new Map<string, CreditLine>();
  const thanks = new Map<string, Map<string, string | undefined>>();
  const musicTools = new Set<string>();
  for (const { title, author, licence, url } of credits) {
    if (requiresAttribution(licence)) {
      attribution.set(`${title}\n${author}\n${url ?? ""}`, { title, author, licence, url });
    } else if (licence === "CC0") {
      const works = thanks.get(author) ?? new Map<string, string | undefined>();
      works.set(title, url);
      thanks.set(author, works);
    } else {
      const tool = /generated with (.+)$/.exec(author)?.[1];
      if (tool) musicTools.add(tool);
    }
  }
  return {
    attribution: [...attribution.values()].sort((a, b) => byText(a.author, b.author) || byText(a.title, b.title)),
    thanks: [...thanks]
      .map(([author, works]) => ({ author, works: [...works].map(([title, url]) => ({ title, url })).sort((a, b) => byText(a.title, b.title)) }))
      .sort((a, b) => byText(a.author, b.author)),
    musicTools: [...musicTools].sort(byText),
  };
};
