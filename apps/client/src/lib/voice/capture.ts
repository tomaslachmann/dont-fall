/**
 * The microphone (ADR 0111): opened once, kept open for the visit, and
 * encoded to Opus only while the Player is actually talking.
 *
 * Opened on the first press rather than on joining, because a browser's
 * microphone indicator lighting up the moment you enter a Lobby is not what
 * anyone agreed to. Kept open afterwards, because asking per press costs the
 * first syllable of every sentence — the user accepted the lit indicator and
 * a Bluetooth headset dropping to its hands-free profile as the price.
 *
 * Nothing is encoded or sent while the Player is quiet: the worklet gathers
 * frames only while it has been told to, so a held-open microphone is idle,
 * not merely ignored.
 *
 * This module is loaded on demand, so a Player who never talks never pulls
 * the encoder or the worklet into their session at all.
 */
import {
  VOICE_BITRATE,
  VOICE_FRAME_SAMPLES,
  VOICE_MAX_FRAME_BYTES,
  VOICE_SAMPLE_RATE,
} from "@dont-fall/shared";
import { VOICE_CAPTURE_PROCESSOR, voiceCaptureSource } from "./captureWorklet.js";
import { frameLevel } from "./gate.js";

export interface VoiceCaptureConfig {
  /**
   * One encoded Opus frame, with how loud the samples behind it were (RMS,
   * 0–1) so open mic's gate can read it without measuring twice.
   */
  onFrame: (payload: Uint8Array, level: number) => void;
}

export interface VoiceCapture {
  /**
   * Starts or stops gathering. Cheap either way — the microphone and the
   * encoder stay as they are, so this is what push-to-talk toggles fifty
   * times a minute.
   */
  setCapturing: (capturing: boolean) => void;
  /** Lets the microphone go and tears the graph down. The browser's indicator goes out here, and nowhere else. */
  close: () => Promise<void>;
}

/** What `getUserMedia` is asked for: one channel, cleaned up by the browser before we ever see it. */
export const VOICE_MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
  video: false,
};

/**
 * Opens the microphone and returns a capture that is idle until told
 * otherwise. Rejects with whatever `getUserMedia` rejected with, so the
 * caller can tell a refusal from a missing microphone (`support.ts`).
 */
export const openVoiceCapture = async (config: VoiceCaptureConfig): Promise<VoiceCapture> => {
  const stream = await navigator.mediaDevices.getUserMedia(VOICE_MEDIA_CONSTRAINTS);

  // A capture context of its own, at the codec's own rate. The page's shared
  // context (ADR 0087) runs at whatever the hardware gives it, which is often
  // but not always 48 kHz — and a mismatch there would mean resampling every
  // frame by hand on the main thread. Asking for the rate up front makes the
  // browser do it, in the place built for it.
  //
  // It is a second `AudioContext`, which is a real cost; it is created on the
  // first talk press, which is a user gesture, so it starts running rather
  // than suspended.
  const context = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
  let closed = false;
  let node: AudioWorkletNode | null = null;
  let encoder: AudioEncoder | null = null;
  let sink: GainNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  /** The encoder's own clock, in microseconds — monotonic across pauses, as WebCodecs requires. */
  let timestamp = 0;

  /**
   * How loud the frame behind an encoded chunk was. The encoder answers a
   * frame or two after it was handed one, so the level travels by its
   * timestamp rather than by being the most recent thing measured — open
   * mic's gate would stutter on a level belonging to a different frame.
   */
  const levels = new Map<number, number>();
  function levelOf(at: number): number {
    const level = levels.get(at) ?? 0;
    levels.delete(at);
    // Anything older than this chunk is an answer that never came; the
    // encoder is in order, so there is nothing left to match them to.
    for (const key of levels.keys()) {
      if (key < at) levels.delete(key);
    }
    return level;
  }


  const release = async (): Promise<void> => {
    node?.port.postMessage(false);
    node?.disconnect();
    source?.disconnect();
    sink?.disconnect();
    for (const track of stream.getTracks()) track.stop();
    try {
      if (encoder !== null && encoder.state !== "closed") encoder.close();
    } catch {
      // An encoder already torn down by an error is nothing to report.
    }
    try {
      await context.close();
    } catch {
      // Likewise a context the browser has already closed.
    }
  };

  try {
    const moduleUrl = URL.createObjectURL(new Blob([voiceCaptureSource(VOICE_FRAME_SAMPLES)], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    if (closed) {
      await release();
      throw new Error("voice capture closed while opening");
    }

    encoder = new AudioEncoder({
      output: (chunk) => {
        // Past the relay's cap the frame would be dropped there anyway, and
        // a transient loud enough to produce one is better lost than sent.
        if (chunk.byteLength > VOICE_MAX_FRAME_BYTES) return;
        const payload = new Uint8Array(chunk.byteLength);
        chunk.copyTo(payload);
        config.onFrame(payload, levelOf(chunk.timestamp));
      },
      error: (err) => console.error("voice encoder:", err),
    });
    encoder.configure({
      codec: "opus",
      sampleRate: VOICE_SAMPLE_RATE,
      numberOfChannels: 1,
      bitrate: VOICE_BITRATE,
      // Raw Opus packets. Ogg framing is the other choice the registration
      // offers, and Safari's encoder rejects it (ADR 0111).
      opus: { format: "opus" },
    });

    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, VOICE_CAPTURE_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    // A worklet is only pulled while something downstream wants its output,
    // so it ends in a muted gain rather than nothing at all. At gain 0 the
    // Player never hears themselves, which is the whole point of the node.
    sink = context.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(context.destination);

    // The buffer behind a posted frame is a plain `ArrayBuffer` — spelling
    // that out is what lets it be handed to `AudioData`, which will not take
    // a view that might be backed by shared memory.
    node.port.onmessage = (event: MessageEvent<Float32Array<ArrayBuffer>>) => {
      const samples = event.data;
      if (encoder === null || encoder.state !== "configured") return;
      const level = frameLevel(samples);
      levels.set(timestamp, level);
      encoder.encode(
        new AudioData({
          format: "f32",
          sampleRate: VOICE_SAMPLE_RATE,
          numberOfFrames: samples.length,
          numberOfChannels: 1,
          timestamp,
          data: samples,
        }),
      );
      timestamp += Math.round((samples.length * 1_000_000) / VOICE_SAMPLE_RATE);
    };
  } catch (err) {
    await release();
    throw err;
  }

  return {
    setCapturing: (capturing) => {
      if (closed) return;
      node?.port.postMessage(capturing);
      if (!capturing) levels.clear();
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await release();
    },
  };
};
