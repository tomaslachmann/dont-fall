import { SOUND_SLOTS, type SoundSlot } from "./slots.js";
import { publicUrl } from "../lib/publicUrl.js";

/** What decoding needs from an `AudioContext` — a structural slice, so tests can stand one in. */
export interface DecodingContext {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
}

/** The decoded sounds a Stage can play (ADR 0087): decoded before a Round runs, never on first play. */
export interface SoundBank {
  /** The slot's decoded variants. Empty when none loaded, and the slot stays silent. */
  buffers(slot: SoundSlot): readonly AudioBuffer[];
}

export const SOUNDS_BASE_URL = publicUrl("sounds/");

const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.arrayBuffer();
};

/**
 * One decode per file per context, shared by every Stage built on it: a live
 * Track swap (M5) rebuilds the Stage, and must not fetch and decode it all again.
 */
const decoded = new WeakMap<DecodingContext, Map<string, Promise<AudioBuffer | null>>>();
/** The same files once decoded, for {@link decodedBytes}. */
const ready = new WeakMap<DecodingContext, Map<string, AudioBuffer>>();

/**
 * How much memory the decoded sounds on `context` hold (M14 ticket 13): 32-bit
 * float PCM, every channel, every file decoded so far by any bank.
 */
export const decodedBytes = (context: DecodingContext): number => {
  let bytes = 0;
  for (const buffer of ready.get(context)?.values() ?? []) bytes += buffer.length * buffer.numberOfChannels * 4;
  return bytes;
};

const decodeFile = (
  context: DecodingContext,
  file: string,
  fetchFile: (url: string) => Promise<ArrayBuffer>,
): Promise<AudioBuffer | null> => {
  let files = decoded.get(context);
  if (!files) {
    files = new Map();
    decoded.set(context, files);
  }
  let pending = files.get(file);
  if (!pending) {
    pending = fetchFile(`${SOUNDS_BASE_URL}${file}`)
      .then((bytes) => context.decodeAudioData(bytes))
      .then((buffer) => {
        let files = ready.get(context);
        if (!files) {
          files = new Map();
          ready.set(context, files);
        }
        files.set(file, buffer);
        return buffer;
      })
      .catch((error: unknown) => {
        // A sound is never worth failing a boot over: warn once, stay silent.
        console.warn(`sound: ${file} could not be loaded, it stays silent`, error);
        return null;
      });
    files.set(file, pending);
  }
  return pending;
};

/**
 * Fetches and decodes every file of `slots`. Resolves once all of them have
 * either decoded or failed; it never rejects.
 */
export const loadSoundBank = async (
  context: DecodingContext,
  slots: readonly SoundSlot[],
  fetchFile: (url: string) => Promise<ArrayBuffer> = fetchBytes,
): Promise<SoundBank> => {
  const bySlot = new Map<SoundSlot, AudioBuffer[]>();
  await Promise.all(
    slots.map(async (slot) => {
      const buffers = await Promise.all(SOUND_SLOTS[slot].files.map((file) => decodeFile(context, file, fetchFile)));
      bySlot.set(slot, buffers.filter((buffer): buffer is AudioBuffer => buffer !== null));
    }),
  );
  return { buffers: (slot) => bySlot.get(slot) ?? [] };
};

