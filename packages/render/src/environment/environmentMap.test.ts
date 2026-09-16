import { ENVIRONMENT_PRESETS } from "@dont-fall/shared";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bakeEnvironmentMap } from "./environmentMap.js";

const DAY = ENVIRONMENT_PRESETS.day;

interface FakeGenerator {
  readonly renderer: unknown;
  readonly bakedScenes: THREE.Scene[];
  readonly targets: THREE.WebGLRenderTarget[];
  disposed: boolean;
}

const fake = vi.hoisted(() => ({
  generators: [] as FakeGenerator[],
  freedTargets: [] as THREE.WebGLRenderTarget[],
  /** Runs inside `fromScene`, while the bake is under way. */
  onBake: null as ((scene: THREE.Scene) => void) | null,
}));

// ---- PMREMGenerator stand-in (real three otherwise): jsdom and node have no WebGL ----
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class RecordingPMREMGenerator implements FakeGenerator {
    readonly bakedScenes: THREE.Scene[] = [];
    readonly targets: THREE.WebGLRenderTarget[] = [];
    disposed = false;
    constructor(readonly renderer: unknown) {
      fake.generators.push(this);
    }
    fromScene(scene: THREE.Scene): THREE.WebGLRenderTarget {
      if (this.disposed) throw new Error("baked with a disposed generator");
      this.bakedScenes.push(scene);
      fake.onBake?.(scene);
      const target = new actual.WebGLRenderTarget(1, 1);
      target.addEventListener("dispose", () => fake.freedTargets.push(target));
      this.targets.push(target);
      return target;
    }
    dispose(): void {
      this.disposed = true;
    }
  }
  return { ...actual, PMREMGenerator: RecordingPMREMGenerator };
});

const renderer = {} as THREE.WebGLRenderer;

type Dome = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

/** Every geometry and material freed while the returned spies are live, whichever instance. */
const spyOnFrees = (): { freed: (object: object) => boolean } => {
  const geometries = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
  const materials = vi.spyOn(THREE.Material.prototype, "dispose");
  return {
    freed: (object) => geometries.mock.contexts.includes(object) || materials.mock.contexts.includes(object),
  };
};

const onlyDome = (scene: THREE.Scene): Dome => {
  expect(scene.children).toHaveLength(1);
  return scene.children[0] as Dome;
};

afterEach(() => {
  fake.generators.length = 0;
  fake.freedTargets.length = 0;
  fake.onBake = null;
  vi.restoreAllMocks();
});

describe("bakeEnvironmentMap", () => {
  it("bakes once, with a generator of its own on the given renderer, disposed before it returns", () => {
    bakeEnvironmentMap(renderer, DAY);

    expect(fake.generators).toHaveLength(1);
    const [generator] = fake.generators;
    expect(generator!.renderer).toBe(renderer);
    expect(generator!.bakedScenes).toHaveLength(1);
    expect(generator!.disposed).toBe(true);
  });

  it("never shares a generator between bakes", () => {
    bakeEnvironmentMap(renderer, DAY);
    bakeEnvironmentMap(renderer, DAY);

    expect(fake.generators).toHaveLength(2);
    expect(fake.generators[0]).not.toBe(fake.generators[1]);
    expect(fake.generators.every((generator) => generator.disposed)).toBe(true);
  });

  it("hands the caller the baked target, still alive", () => {
    const target = bakeEnvironmentMap(renderer, DAY);
    const [generator] = fake.generators;

    expect(target).toBe(generator!.targets[0]);
    expect(fake.freedTargets).toEqual([]);
  });

  it("bakes a scene of its own that holds only the preset's sky, with no depth test", () => {
    bakeEnvironmentMap(renderer, DAY);
    const scene = fake.generators[0]!.bakedScenes[0]!;
    const dome = onlyDome(scene);

    expect(dome.name).toBe("environment-sky");
    expect(dome.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect((dome.material.uniforms.horizon!.value as THREE.Color).getHex()).toBe(DAY.sky.horizon);
    expect(dome.material.depthTest).toBe(false);
    expect(scene.background).toBeNull();
  });

  it("frees the baked dome once the bake is done, not before", () => {
    const { freed } = spyOnFrees();
    let dome: Dome | undefined;
    let freedDuringBake = true;
    fake.onBake = (scene) => {
      dome = onlyDome(scene);
      freedDuringBake = freed(dome.geometry) || freed(dome.material);
    };

    bakeEnvironmentMap(renderer, DAY);

    expect(freedDuringBake).toBe(false);
    expect(freed(dome!.geometry)).toBe(true);
    expect(freed(dome!.material)).toBe(true);
  });

  it("frees the generator and the dome even when the bake throws", () => {
    const { freed } = spyOnFrees();
    let dome: Dome | undefined;
    fake.onBake = (scene) => {
      dome = onlyDome(scene);
      throw new Error("context lost");
    };

    expect(() => bakeEnvironmentMap(renderer, DAY)).toThrow("context lost");
    expect(fake.generators[0]!.disposed).toBe(true);
    expect(freed(dome!.geometry)).toBe(true);
    expect(freed(dome!.material)).toBe(true);
  });
});
