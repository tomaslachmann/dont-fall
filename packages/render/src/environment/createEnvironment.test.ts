import {
  cloudFloorY,
  DEFAULT_KILL_PLANE_Y,
  ENVIRONMENT_PRESETS,
  sunLightDirection,
  type EnvironmentPreset,
} from "@dont-fall/shared";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENVIRONMENT_ROOT_NAME, createEnvironment, type EnvironmentOptions } from "./createEnvironment.js";
import { SHADOW_LIGHT_DISTANCE, SHADOW_MAP_TYPE, SHADOW_TEXEL_SIZE, snapToShadowTexels } from "./shadows.js";

const DAY = ENVIRONMENT_PRESETS.day;

const baked = vi.hoisted(() => ({ targets: [] as THREE.WebGLRenderTarget[] }));

// ---- PMREMGenerator stand-in (real three otherwise): jsdom and node have no
// WebGL, so a bake is an empty target. `environmentMap.test.ts` covers the
// generator's own lifecycle. ----
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class EmptyPMREMGenerator {
    fromScene(): THREE.WebGLRenderTarget {
      const target = new actual.WebGLRenderTarget(1, 1);
      baked.targets.push(target);
      return target;
    }
    dispose(): void {}
  }
  return { ...actual, PMREMGenerator: EmptyPMREMGenerator };
});

afterEach(() => {
  baked.targets.length = 0;
});

/** The target the most recent Environment baked. */
const lastBake = (): THREE.WebGLRenderTarget => {
  const target = baked.targets.at(-1);
  if (!target) throw new Error("nothing was baked");
  return target;
};

// Beyond the stand-in generator, the Environment only reads and writes the
// renderer's exposure and shadow-map settings.
const fakeRenderer = (toneMappingExposure = 1): THREE.WebGLRenderer =>
  ({ toneMappingExposure, shadowMap: { enabled: false, type: THREE.PCFShadowMap } }) as unknown as THREE.WebGLRenderer;

const OPTIONS: EnvironmentOptions = {
  killPlaneY: DEFAULT_KILL_PLANE_Y,
  lowestSegmentY: 0,
  fog: true,
  detail: "full",
  shadows: true,
};

const roots = (scene: THREE.Scene): THREE.Object3D[] =>
  scene.children.filter((child) => child.name === ENVIRONMENT_ROOT_NAME);

const find = <T extends THREE.Object3D>(scene: THREE.Scene, name: string): T => {
  const found = scene.getObjectByName(name);
  if (!found) throw new Error(`no ${name} in the scene`);
  return found as T;
};

describe("createEnvironment", () => {
  it("adds exactly one root Group to the scene, holding the sky, the cloud floor, the puffs and both lights", () => {
    const scene = new THREE.Scene();
    createEnvironment(scene, fakeRenderer(), DAY, OPTIONS);

    expect(scene.children).toHaveLength(1);
    const root = roots(scene)[0]!;
    expect(root).toBeInstanceOf(THREE.Group);
    expect(root.children.map((child) => child.name).sort()).toEqual(
      [
        "environment-cloud-floor",
        "environment-hemisphere",
        "environment-puffs",
        "environment-sky",
        "environment-sun",
        "environment-sun-target",
      ].sort(),
    );
  });

  it("lays the cloud floor at the preset's offset above the kill height, under a Track well above it", () => {
    const scene = new THREE.Scene();
    createEnvironment(scene, fakeRenderer(), DAY, { ...OPTIONS, lowestSegmentY: 0 });

    expect(find(scene, "environment-cloud-floor").position.y).toBe(DEFAULT_KILL_PLANE_Y + DAY.cloudFloor.offsetAboveKillPlane);
  });

  it("keeps the cloud floor under a Segment only 2.8 above the kill height (research §1d)", () => {
    const scene = new THREE.Scene();
    const lowestSegmentY = DEFAULT_KILL_PLANE_Y + 2.8;
    createEnvironment(scene, fakeRenderer(), { ...DAY, cloudFloor: { ...DAY.cloudFloor, offsetAboveKillPlane: 4 } }, {
      ...OPTIONS,
      lowestSegmentY,
    });
    const floorY = find(scene, "environment-cloud-floor").position.y;

    expect(floorY).toBeLessThan(lowestSegmentY);
    expect(floorY).toBe(cloudFloorY({ ...DAY, cloudFloor: { ...DAY.cloudFloor, offsetAboveKillPlane: 4 } }, DEFAULT_KILL_PLANE_Y, lowestSegmentY));
  });

  it("carries the cloud floor with the camera across X/Z, at its own height", () => {
    const scene = new THREE.Scene();
    const environment = createEnvironment(scene, fakeRenderer(), DAY, OPTIONS);
    const floor = find(scene, "environment-cloud-floor");
    const floorY = floor.position.y;
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(9, 4, -30);

    environment.update(camera, 1000);

    expect(floor.position.toArray()).toEqual([9, floorY, -30]);
  });

  it("draws stars only for a preset that has them, keeps them on the camera, and frees them", () => {
    const starless = new THREE.Scene();
    createEnvironment(starless, fakeRenderer(), DAY, OPTIONS);
    expect(starless.getObjectByName("environment-stars")).toBeUndefined();

    const scene = new THREE.Scene();
    const environment = createEnvironment(scene, fakeRenderer(), ENVIRONMENT_PRESETS.night, { ...OPTIONS, detail: "low" });
    const stars = find<THREE.Points<THREE.BufferGeometry, THREE.Material>>(scene, "environment-stars");
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(3, 40, -9);
    environment.update(camera, 0);
    expect(stars.position.toArray()).toEqual([3, 40, -9]);

    const freed = [vi.spyOn(stars.geometry, "dispose"), vi.spyOn(stars.material, "dispose")];
    environment.dispose();
    for (const spy of freed) expect(spy).toHaveBeenCalledOnce();
  });

  it("leaves the puffs out at low detail, and when the preset has none", () => {
    const low = new THREE.Scene();
    createEnvironment(low, fakeRenderer(), DAY, { ...OPTIONS, detail: "low" });
    const none = new THREE.Scene();
    createEnvironment(none, fakeRenderer(), { ...DAY, puffs: { ...DAY.puffs, count: 0 } }, OPTIONS);

    for (const scene of [low, none]) {
      expect(scene.getObjectByName("environment-puffs")).toBeUndefined();
      expect(scene.getObjectByName("environment-cloud-floor")).toBeDefined();
    }
  });

  it("scatters the puffs around the cloud floor and drifts them with the camera's updates", () => {
    const scene = new THREE.Scene();
    const environment = createEnvironment(scene, fakeRenderer(), DAY, OPTIONS);
    const first = find<THREE.InstancedMesh>(scene, "environment-puffs-0");
    const camera = new THREE.PerspectiveCamera();
    const placed = new THREE.Matrix4();

    environment.update(camera, 0);
    first.getMatrixAt(0, placed);
    const before = new THREE.Vector3().setFromMatrixPosition(placed);
    environment.update(camera, 10_000);
    first.getMatrixAt(0, placed);
    const after = new THREE.Vector3().setFromMatrixPosition(placed);

    expect(after.x - before.x).toBeCloseTo(DAY.puffs.wind.x * 10, 6);
    expect(after.y).toBe(before.y);
  });

  it("casts real shadows from its sun, and turns the renderer's shadow maps on", () => {
    const scene = new THREE.Scene();
    const renderer = fakeRenderer();
    createEnvironment(scene, renderer, DAY, OPTIONS);

    expect(find<THREE.DirectionalLight>(scene, "environment-sun").castShadow).toBe(true);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(SHADOW_MAP_TYPE);
  });

  it("casts nothing when asked for no shadows, and leaves the renderer's shadow maps alone", () => {
    const scene = new THREE.Scene();
    const renderer = fakeRenderer();
    createEnvironment(scene, renderer, DAY, { ...OPTIONS, shadows: false });

    expect(find<THREE.DirectionalLight>(scene, "environment-sun").castShadow).toBe(false);
    expect(renderer.shadowMap.enabled).toBe(false);
  });

  it("puts the renderer's shadow maps back and frees the sun's shadow map on dispose", () => {
    const scene = new THREE.Scene();
    const renderer = fakeRenderer();
    const environment = createEnvironment(scene, renderer, DAY, OPTIONS);
    const freedShadow = vi.spyOn(find<THREE.DirectionalLight>(scene, "environment-sun").shadow, "dispose");

    environment.dispose();

    expect(renderer.shadowMap.enabled).toBe(false);
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
    expect(freedShadow).toHaveBeenCalledOnce();
  });

  it("never lets its own meshes cast or receive a shadow", () => {
    const scene = new THREE.Scene();
    createEnvironment(scene, fakeRenderer(), DAY, OPTIONS);

    roots(scene)[0]!.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      expect(object.castShadow, object.name).toBe(false);
      expect(object.receiveShadow, object.name).toBe(false);
    });
  });

  it("centres the shadow box on the focus it is given, snapped to texels, with the sun along its light", () => {
    const scene = new THREE.Scene();
    const environment = createEnvironment(scene, fakeRenderer(), DAY, OPTIONS);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 5, 10);
    const focus = { x: 4.123, y: 1.5, z: -7.77 };

    environment.update(camera, 0, focus);

    const expected = snapToShadowTexels(focus, sunLightDirection(DAY), SHADOW_TEXEL_SIZE);
    const sun = find<THREE.DirectionalLight>(scene, "environment-sun");
    expect(sun.target.position.x).toBeCloseTo(expected.x, 10);
    expect(sun.target.position.y).toBeCloseTo(expected.y, 10);
    expect(sun.target.position.z).toBeCloseTo(expected.z, 10);
    const toLight = sun.position.clone().sub(sun.target.position);
    expect(toLight.length()).toBeCloseTo(SHADOW_LIGHT_DISTANCE, 10);
    const direction = sunLightDirection(DAY);
    expect(toLight.normalize().dot(new THREE.Vector3(direction.x, direction.y, direction.z))).toBeCloseTo(1, 10);
  });

  it("centres the shadow box on the camera without a focus", () => {
    const scene = new THREE.Scene();
    const environment = createEnvironment(scene, fakeRenderer(), DAY, OPTIONS);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(20, 8, -3);

    environment.update(camera, 0);

    expect(find<THREE.DirectionalLight>(scene, "environment-sun").target.position.distanceTo(camera.position)).toBeLessThan(
      SHADOW_TEXEL_SIZE,
    );
  });

  it("fogs in the horizon colour at the preset's distances", () => {
    const scene = new THREE.Scene();
    createEnvironment(scene, fakeRenderer(), DAY, OPTIONS);

    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    const fog = scene.fog as THREE.Fog;
    expect(fog.color.getHex()).toBe(DAY.sky.horizon);
    expect(fog.near).toBe(DAY.fog.near);
    expect(fog.far).toBe(DAY.fog.far);
  });

  it("leaves the scene unfogged when asked for no fog (the builder's orbit view)", () => {
    const scene = new THREE.Scene();
    createEnvironment(scene, fakeRenderer(), DAY, { ...OPTIONS, fog: false });

    expect(scene.fog).toBeNull();
  });

  it("reflects the baked sky, at the preset's environment intensity", () => {
    const scene = new THREE.Scene();
    const dim: EnvironmentPreset = { ...DAY, light: { ...DAY.light, environmentIntensity: 0.45 } };
    createEnvironment(scene, fakeRenderer(), dim, OPTIONS);

    expect(baked.targets).toHaveLength(1);
    expect(scene.environment).toBe(lastBake().texture);
    expect(scene.environmentIntensity).toBe(0.45);
  });

  it("bakes once per Environment, never sharing a map between two", () => {
    const first = new THREE.Scene();
    const second = new THREE.Scene();
    createEnvironment(first, fakeRenderer(), DAY, OPTIONS);
    createEnvironment(second, fakeRenderer(), DAY, OPTIONS);

    expect(baked.targets).toHaveLength(2);
    expect(first.environment).not.toBe(second.environment);
  });

  it("frees the baked map and takes it off the scene on dispose, which the scene-graph sweep never would", () => {
    const scene = new THREE.Scene();
    const dim: EnvironmentPreset = { ...DAY, light: { ...DAY.light, environmentIntensity: 0.45 } };
    const environment = createEnvironment(scene, fakeRenderer(), dim, OPTIONS);
    const freed = vi.spyOn(lastBake(), "dispose");

    environment.dispose();

    expect(freed).toHaveBeenCalledOnce();
    expect(scene.environment).toBeNull();
    expect(scene.environmentIntensity).toBe(1);
  });

  it("puts back the environment map the scene had before, at its intensity", () => {
    const scene = new THREE.Scene();
    const authoring = new THREE.Texture();
    scene.environment = authoring;
    scene.environmentIntensity = 0.7;

    createEnvironment(scene, fakeRenderer(), DAY, OPTIONS).dispose();

    expect(scene.environment).toBe(authoring);
    expect(scene.environmentIntensity).toBe(0.7);
  });

  it("sets the preset's exposure and puts the old one back on dispose", () => {
    const bright: EnvironmentPreset = { ...DAY, exposure: 1.4 };
    const renderer = fakeRenderer(0.8);
    const environment = createEnvironment(new THREE.Scene(), renderer, bright, OPTIONS);

    expect(renderer.toneMappingExposure).toBe(1.4);
    environment.dispose();
    expect(renderer.toneMappingExposure).toBe(0.8);
  });

  it("keeps the sky on the camera's world position, however the camera is parented", () => {
    const scene = new THREE.Scene();
    const environment = createEnvironment(scene, fakeRenderer(), DAY, OPTIONS);
    const rig = new THREE.Group();
    rig.position.set(100, 0, -40);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(1, 12, 3);
    rig.add(camera);

    environment.update(camera, 0);

    expect(find(scene, "environment-sky").position.toArray()).toEqual([101, 12, -37]);
  });

  it("never turns the sky with the camera", () => {
    const scene = new THREE.Scene();
    const environment = createEnvironment(scene, fakeRenderer(), DAY, OPTIONS);
    const camera = new THREE.PerspectiveCamera();
    camera.rotation.set(0.4, 2, 0);

    environment.update(camera, 0);

    expect(find(scene, "environment-sky").quaternion.equals(new THREE.Quaternion())).toBe(true);
  });

  it("removes its root, frees what it made and unfogs the scene on dispose", () => {
    const scene = new THREE.Scene();
    const environment = createEnvironment(scene, fakeRenderer(), DAY, OPTIONS);
    const puffs = find<THREE.InstancedMesh>(scene, "environment-puffs-0");
    const freedPuffs = vi.spyOn(puffs, "dispose");
    const meshes = ["environment-sky", "environment-cloud-floor"].map((name) =>
      find<THREE.Mesh<THREE.BufferGeometry, THREE.Material>>(scene, name),
    );
    const freed = meshes.flatMap((mesh) => [vi.spyOn(mesh.geometry, "dispose"), vi.spyOn(mesh.material, "dispose")]);

    environment.dispose();

    expect(roots(scene)).toHaveLength(0);
    for (const spy of freed) expect(spy).toHaveBeenCalledOnce();
    expect(freedPuffs).toHaveBeenCalledOnce();
    expect(scene.fog).toBeNull();
  });

  it("puts back the fog the scene had before", () => {
    const scene = new THREE.Scene();
    const authoring = new THREE.Fog(0xffffff, 1, 2);
    scene.fog = authoring;

    createEnvironment(scene, fakeRenderer(), DAY, OPTIONS).dispose();

    expect(scene.fog).toBe(authoring);
  });

  it("leaves fog, environment map and exposure alone on dispose when something else has replaced them since", () => {
    const scene = new THREE.Scene();
    const renderer = fakeRenderer();
    const environment = createEnvironment(scene, renderer, { ...DAY, exposure: 1.2 }, OPTIONS);
    const freedMap = vi.spyOn(lastBake(), "dispose");
    const later = new THREE.Fog(0x000000, 5, 6);
    scene.fog = later;
    const laterMap = new THREE.Texture();
    scene.environment = laterMap;
    scene.environmentIntensity = 3;
    renderer.toneMappingExposure = 2;

    environment.dispose();

    expect(scene.fog).toBe(later);
    expect(scene.environment).toBe(laterMap);
    expect(scene.environmentIntensity).toBe(3);
    expect(renderer.toneMappingExposure).toBe(2);
    // Its own map is still freed: nothing else holds it any more.
    expect(freedMap).toHaveBeenCalledOnce();
  });

  it("is idempotent: a second dispose frees nothing twice", () => {
    const scene = new THREE.Scene();
    const environment = createEnvironment(scene, fakeRenderer(), DAY, OPTIONS);
    const sky = find<THREE.Mesh<THREE.BufferGeometry, THREE.Material>>(scene, "environment-sky");
    const freedGeometry = vi.spyOn(sky.geometry, "dispose");
    const freedMap = vi.spyOn(lastBake(), "dispose");

    environment.dispose();
    expect(() => environment.dispose()).not.toThrow();
    expect(freedGeometry).toHaveBeenCalledOnce();
    expect(freedMap).toHaveBeenCalledOnce();
  });

  it("leaves what the scene already held alone", () => {
    const scene = new THREE.Scene();
    const track = new THREE.Group();
    scene.add(track);

    createEnvironment(scene, fakeRenderer(), DAY, OPTIONS).dispose();

    expect(scene.children).toEqual([track]);
  });

  it("gives each Environment its own root, so disposing one keeps the other", () => {
    const scene = new THREE.Scene();
    const first = createEnvironment(scene, fakeRenderer(), DAY, OPTIONS);
    createEnvironment(scene, fakeRenderer(), DAY, { ...OPTIONS, fog: false, detail: "low" });

    first.dispose();
    expect(roots(scene)).toHaveLength(1);
  });

  it("ignores updates after dispose", () => {
    const scene = new THREE.Scene();
    const environment = createEnvironment(scene, fakeRenderer(), DAY, OPTIONS);
    const sky = find(scene, "environment-sky");
    environment.dispose();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(5, 5, 5);

    expect(() => environment.update(camera, 16)).not.toThrow();
    expect(sky.position.toArray()).toEqual([0, 0, 0]);
  });
});
