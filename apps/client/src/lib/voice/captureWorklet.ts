/**
 * The microphone's `AudioWorkletProcessor`, as source (ADR 0111).
 *
 * Web Audio hands a worklet 128 samples at a time and Opus wants 960, so
 * something has to do the gathering, and it has to happen on the audio thread
 * — the main thread cannot be trusted to drain a stream every 2.7 ms while a
 * Round is rendering. That is all this does: gather quanta into frames and
 * post each finished one.
 *
 * It is a worklet rather than a `MediaStreamTrackProcessor` because Firefox
 * has no `MediaStreamTrackProcessor`, and one capture path is simpler to keep
 * honest than two.
 *
 * ## Why it is a string
 *
 * `audioWorklet.addModule` takes a URL, not a module, so this file cannot
 * simply be imported: it has to become a URL at runtime. The two ways are an
 * asset URL from the bundler or a `Blob`. A `Blob` is used here because the
 * app is served from more than one base (ADR 0107/0108 — `/` locally,
 * `/builder/` beside it, and a Pages deployment under a repository path), and
 * an asset URL is one more thing that has to be right under every one of
 * them, while a `Blob` URL is the page's own origin by construction.
 *
 * The cost is that the processor is not type-checked. It is kept short enough
 * to read in one go for exactly that reason, and it has no dependency on
 * anything but its own frame size, which is passed in.
 */

/** The processor's registered name — the string `new AudioWorkletNode(...)` asks for. */
export const VOICE_CAPTURE_PROCESSOR = "dontfall-voice-capture";

/**
 * The processor's source. `frameSamples` is baked in rather than read from
 * `processorOptions`, so the worklet has one fewer thing to get wrong.
 *
 * Mono throughout: the first channel is the only one read, because the
 * microphone is asked for one channel and Opus is configured for one.
 */
export const voiceCaptureSource = (frameSamples: number): string => `
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(${frameSamples});
    this.filled = 0;
    // Set from the main thread: while false, nothing is gathered and nothing
    // posted. The microphone stays open (ADR 0111 — no first syllable is
    // clipped) but a Player who is not talking costs nothing.
    this.capturing = false;
    this.port.onmessage = (event) => {
      this.capturing = event.data === true;
      if (!this.capturing) this.filled = 0;
    };
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    // No channel at all means the track is muted or has gone away; the node
    // must still say "keep me alive", or the graph stops pulling it.
    if (!channel || !this.capturing) return true;
    for (let i = 0; i < channel.length; i += 1) {
      this.frame[this.filled++] = channel[i];
      if (this.filled === this.frame.length) {
        // A copy, because the buffer is reused for the next frame the moment
        // this returns — transferring it instead would leave nothing to fill.
        this.port.postMessage(this.frame.slice());
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor(${JSON.stringify(VOICE_CAPTURE_PROCESSOR)}, VoiceCaptureProcessor);
`;
