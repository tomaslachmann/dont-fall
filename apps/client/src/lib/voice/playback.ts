/**
 * Hearing other people (ADR 0111): one Opus decoder and one chain per
 * speaker, on the page's own `AudioContext` (ADR 0087) rather than inside a
 * Stage.
 *
 * Outside the Stage because voice outlives every Stage it is heard over — a
 * Track swap between Rounds builds a new one, and the conversation does not
 * stop for it. So the chain hangs off the shared context beside the music,
 * applies MASTER × VOICE itself, and never touches the Stage engine's buses.
 *
 * A speaker's chain is `source → distance → pan → voice`, and the middle two
 * are what places a voice at its Character in a Round. Left where they are
 * (gain 1, centred) a voice is flat, which is what a Screen, a spectator and
 * an eliminated Player get.
 */
import { VOICE_FRAME_MS, VOICE_SAMPLE_RATE } from "@dont-fall/shared";
import { SpeakerPlayout } from "./playout.js";

/** Where a speaker is heard from, as the caller works it out. Flat is `{ gain: 1, pan: 0 }`. */
export interface VoicePlacement {
  /** How loud, a share of full — the distance falloff, floored so a far voice is quiet and never lost. */
  gain: number;
  /** Left to right, −1 to 1 — equal-power, which is what a `StereoPannerNode` does. */
  pan: number;
}

export const FLAT: VoicePlacement = { gain: 1, pan: 0 };

/** How fast a placement follows the Character it belongs to (s, a `setTargetAtTime` constant) — a step would click. */
const PLACEMENT_FOLLOW_SECONDS = 0.05;

/** One frame's length in seconds, which is also how much audio each decode yields. */
const FRAME_SECONDS = VOICE_FRAME_MS / 1000;

/**
 * The Opus identification header, as WebCodecs' Opus registration describes
 * it. Optional in Chrome, and cheap insurance everywhere else: without it a
 * decoder has to infer the stream's shape from the first packet.
 *
 * Pre-skip is zero on purpose — declaring the encoder's own would have the
 * decoder trim the first few milliseconds of every burst, and there is
 * nothing here to trim.
 */
const opusHead = (): Uint8Array => {
  const head = new Uint8Array(19);
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]); // "OpusHead"
  head[8] = 1; // version
  head[9] = 1; // channels
  // 10–11 pre-skip, left at zero
  new DataView(head.buffer).setUint32(12, VOICE_SAMPLE_RATE, true);
  // 16–17 output gain, 18 channel mapping family — all zero
  return head;
};

/** What playback needs of an `AudioContext` — a structural slice, as `engine.ts` takes. */
export interface VoicePlaybackContext {
  readonly currentTime: number;
  readonly destination: AudioNode;
  createGain(): GainNode;
  createStereoPanner(): StereoPannerNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
}

export interface VoicePlaybackConfig {
  context: VoicePlaybackContext;
  /** MASTER × VOICE, as a linear gain. Applied here because voice is outside the Stage's bus loop. */
  gain: number;
}

interface Speaker {
  decoder: AudioDecoder;
  playout: SpeakerPlayout;
  distance: GainNode;
  pan: StereoPannerNode;
  /** Sources scheduled but not yet finished — what a catch-up throws away. */
  pending: Set<AudioBufferSourceNode>;
  placement: VoicePlacement;
  /** The decoder's clock, in microseconds. It never decides when a frame is heard; it only has to keep going up. */
  timestamp: number;
}

export interface VoicePlayback {
  /** Plays one frame from this speaker, opening their chain the first time they are heard. */
  play: (accountId: string, payload: Uint8Array) => void;
  /**
   * Where every speaker is heard from, once a frame. Asked per open chain
   * rather than handed a map, so a scene never has to name people this client
   * has not heard from — and anyone the scene has no Character for comes back
   * flat, which is a spectator, an eliminated Player, or anyone on a Screen.
   *
   * Followed smoothly, so a Character running past does not step.
   */
  applyPlacements: (placementFor: (accountId: string) => VoicePlacement) => void;
  /** Everyone is flat again — the Round ended, or there is no Stage to place anyone in. */
  flatten: () => void;
  /** This speaker stopped talking, or left: their scheduled audio is let go and their chain closed. */
  drop: (accountId: string) => void;
  /** MASTER × VOICE changed. */
  setGain: (gain: number) => void;
  /** Closes every chain. */
  close: () => void;
}

/**
 * Builds the playback side. Returns a no-op playback where the browser has no
 * `AudioDecoder`: hearing nothing is the right failure, and it must not be one
 * every call site has to check for.
 */
export const createVoicePlayback = (config: VoicePlaybackConfig): VoicePlayback => {
  const { context } = config;
  const speakers = new Map<string, Speaker>();
  const description = opusHead();
  let closed = false;

  // One node the whole room passes through, so a volume change is one
  // assignment rather than one per speaker.
  const out = context.createGain();
  out.gain.value = config.gain;
  out.connect(context.destination);

  const chainFor = (accountId: string): Speaker | null => {
    const existing = speakers.get(accountId);
    if (existing) return existing;
    if (closed || typeof AudioDecoder !== "function") return null;

    const distance = context.createGain();
    const pan = context.createStereoPanner();
    distance.connect(pan);
    pan.connect(out);

    // The callbacks find their speaker in the map rather than closing over
    // the record they belong to: a decoder that answers after its speaker was
    // dropped then finds nothing, instead of writing into a dead chain.
    const decoder = new AudioDecoder({
      output: (data) => {
        try {
          const speaker = speakers.get(accountId);
          if (speaker) schedule(speaker, data);
        } finally {
          data.close();
        }
      },
      // A decoder that has failed stays failed, so the chain goes with it and
      // the speaker's next frame opens a fresh one.
      error: (err) => {
        console.error("voice decoder:", err);
        drop(accountId);
      },
    });
    decoder.configure({ codec: "opus", sampleRate: VOICE_SAMPLE_RATE, numberOfChannels: 1, description });

    const speaker: Speaker = {
      decoder,
      playout: new SpeakerPlayout(),
      distance,
      pan,
      pending: new Set(),
      placement: FLAT,
      timestamp: 0,
    };
    speakers.set(accountId, speaker);
    return speaker;
  };

  /** Puts one decoded frame on the clock, dropping a backlog that has become a delay. */
  const schedule = (speaker: Speaker, data: AudioData): void => {
    if (closed) return;
    const frames = data.numberOfFrames;
    if (frames === 0) return;
    const samples = new Float32Array(frames);
    data.copyTo(samples, { planeIndex: 0, format: "f32" });

    const now = context.currentTime;
    const { startAt, dropScheduled } = speaker.playout.place(now, frames / VOICE_SAMPLE_RATE);
    if (dropScheduled) stopPending(speaker);

    const buffer = context.createBuffer(1, frames, VOICE_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(speaker.distance);
    source.onended = () => {
      speaker.pending.delete(source);
      source.disconnect();
    };
    speaker.pending.add(source);
    source.start(startAt);
  };

  const stopPending = (speaker: Speaker): void => {
    for (const source of speaker.pending) {
      try {
        source.stop();
      } catch {
        // One that never started, or already ended: `onended` clears it.
      }
      source.disconnect();
    }
    speaker.pending.clear();
  };

  const drop = (accountId: string): void => {
    const speaker = speakers.get(accountId);
    if (!speaker) return;
    speakers.delete(accountId);
    stopPending(speaker);
    speaker.playout.reset();
    try {
      if (speaker.decoder.state !== "closed") speaker.decoder.close();
    } catch {
      // Already torn down by its own error handler.
    }
    speaker.distance.disconnect();
    speaker.pan.disconnect();
  };

  const applyPlacement = (speaker: Speaker, placement: VoicePlacement): void => {
    speaker.placement = placement;
    const at = context.currentTime;
    speaker.distance.gain.setTargetAtTime(placement.gain, at, PLACEMENT_FOLLOW_SECONDS);
    speaker.pan.pan.setTargetAtTime(placement.pan, at, PLACEMENT_FOLLOW_SECONDS);
  };

  return {
    play: (accountId, payload) => {
      const speaker = chainFor(accountId);
      if (speaker === null || speaker.decoder.state !== "configured") return;
      speaker.decoder.decode(
        new EncodedAudioChunk({
          // Every Opus frame stands alone; there are no delta frames to key off.
          type: "key",
          // The decoder needs a clock that goes up and nothing more: what
          // actually decides when a frame is heard is `SpeakerPlayout`, on
          // the context's own clock, where the audio really happens.
          timestamp: speaker.timestamp,
          duration: FRAME_SECONDS * 1_000_000,
          data: payload,
        }),
      );
      speaker.timestamp += FRAME_SECONDS * 1_000_000;
    },
    applyPlacements: (placementFor) => {
      for (const [accountId, speaker] of speakers) {
        const placement = placementFor(accountId);
        // An unmoved speaker costs nothing: a bean standing still would
        // otherwise re-arm two `setTargetAtTime` ramps every frame.
        if (speaker.placement.gain === placement.gain && speaker.placement.pan === placement.pan) continue;
        applyPlacement(speaker, placement);
      }
    },
    flatten: () => {
      for (const speaker of speakers.values()) {
        if (speaker.placement !== FLAT) applyPlacement(speaker, FLAT);
      }
    },
    drop,
    setGain: (gain) => {
      out.gain.value = gain;
    },
    close: () => {
      closed = true;
      for (const accountId of [...speakers.keys()]) drop(accountId);
      out.disconnect();
    },
  };
};
