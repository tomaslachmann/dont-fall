/**
 * A stand-in for the slice of Web Audio the sound engine uses (M14 ticket 02),
 * recording what was created, connected, started and stopped. jsdom has no
 * Web Audio, and the engine's rules are what the tests are about.
 */

export class FakeParam {
  targets: number[] = [];
  /** The time constant of each `setTargetAtTime`, in order. */
  timeConstants: number[] = [];
  constructor(public value = 0) {}
  setTargetAtTime(value: number, _startTime = 0, timeConstant = 0): this {
    this.value = value;
    this.targets.push(value);
    this.timeConstants.push(timeConstant);
    return this;
  }
  setValueAtTime(value: number): this {
    this.value = value;
    return this;
  }
}

export class FakeNode {
  connections: FakeNode[] = [];
  disconnected = false;
  connect<T extends FakeNode>(node: T): T {
    this.connections.push(node);
    return node;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export class FakePanner extends FakeNode {
  panningModel = "HRTF";
  distanceModel = "inverse";
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
  positionX = new FakeParam();
  positionY = new FakeParam();
  positionZ = new FakeParam();
}

export class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  started: { when: number | undefined; offset: number | undefined } | null = null;
  stoppedAt: number | undefined | null = null;
  start(when?: number, offset?: number): void {
    this.started = { when, offset };
  }
  stop(when?: number): void {
    this.stoppedAt = when;
  }
  /** What the browser does when a source finishes. */
  end(): void {
    this.onended?.();
  }
}

export class FakeAudioContext {
  currentTime = 0;
  state = "running";
  destination = new FakeNode();
  /** Media element sources, with the element each plays. */
  elementSources: { node: FakeNode; element: unknown }[] = [];
  gains: FakeGain[] = [];
  panners: FakePanner[] = [];
  sources: FakeBufferSource[] = [];
  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createPanner(): FakePanner {
    const node = new FakePanner();
    this.panners.push(node);
    return node;
  }
  createMediaElementSource(element: unknown): FakeNode {
    const node = new FakeNode();
    this.elementSources.push({ node, element });
    return node;
  }
  createBufferSource(): FakeBufferSource {
    const node = new FakeBufferSource();
    this.sources.push(node);
    return node;
  }
}

/** A decoded buffer, as far as the engine looks at one. */
export const fakeBuffer = (duration = 1, numberOfChannels = 1, sampleRate = 48_000): AudioBuffer =>
  ({ duration, numberOfChannels, sampleRate, length: Math.round(duration * sampleRate) }) as AudioBuffer;
