import { ENVIRONMENT_PRESETS, type EnvironmentPreset } from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  PUFF_CLEARANCE_ABOVE_FLOOR,
  PUFF_CLEARANCE_FADE,
  PUFF_EDGE_FADE,
  PUFF_FIELD_SIZE,
  PUFF_VARIANTS,
  createCloudPuffs,
  createPuffLook,
  puffPlacement,
  scatterPuffs,
  type Puff,
} from "./cloudPuffs.js";

const DAY = ENVIRONMENT_PRESETS.day;
const FLOOR_Y = -7.5;
const CALM = { x: 0, z: 0 };

const puff = (overrides: Partial<Puff> = {}): Puff => ({ x: 0, y: 10, z: 0, size: 8, yaw: 0, variant: 0, clearance: 0, ...overrides });

const withPuffs = (puffs: Partial<EnvironmentPreset["puffs"]>): EnvironmentPreset => ({ ...DAY, puffs: { ...DAY.puffs, ...puffs } });

const meshes = (group: THREE.Group): THREE.InstancedMesh[] => group.children as THREE.InstancedMesh[];

const instancePosition = (mesh: THREE.InstancedMesh, i: number): { position: THREE.Vector3; scale: THREE.Vector3 } => {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(i, matrix);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  matrix.decompose(position, new THREE.Quaternion(), scale);
  return { position, scale };
};

describe("puffPlacement", () => {
  it("drifts with the wind on the clock it is given, at its own height", () => {
    const placed = puffPlacement(puff({ x: 10, z: -5 }), { x: 2, z: -1 }, 3, 0, 0);
    expect([placed.x, placed.y, placed.z]).toEqual([16, 10, -8]);
  });

  it("wraps into the field around the camera, so the field never ends", () => {
    const cameraX = 1000;
    const placed = puffPlacement(puff({ x: 10 }), CALM, 0, cameraX, 0);

    expect(placed.x).toBeGreaterThanOrEqual(cameraX - PUFF_FIELD_SIZE / 2);
    expect(placed.x).toBeLessThan(cameraX + PUFF_FIELD_SIZE / 2);
    // Moved by whole fields only.
    expect(Number.isInteger((placed.x - 10) / PUFF_FIELD_SIZE)).toBe(true);
  });

  it("is full size well inside the field and shrinks to nothing at its edge, so a wrap never pops", () => {
    const half = PUFF_FIELD_SIZE / 2;
    expect(puffPlacement(puff({ x: half - PUFF_EDGE_FADE - 1 }), CALM, 0, 0, 0).scale).toBe(8);
    expect(puffPlacement(puff({ z: half - PUFF_EDGE_FADE / 2 }), CALM, 0, 0, 0).scale).toBeGreaterThan(0);
    expect(puffPlacement(puff({ z: half - PUFF_EDGE_FADE / 2 }), CALM, 0, 0, 0).scale).toBeLessThan(8);
    expect(puffPlacement(puff({ x: -half }), CALM, 0, 0, 0).scale).toBe(0);
  });

  it("keeps a puff with a clearance away from the camera, growing in past it", () => {
    const clear = puff({ clearance: PUFF_CLEARANCE_ABOVE_FLOOR });

    expect(puffPlacement({ ...clear, x: 20 }, CALM, 0, 0, 0).scale).toBe(0);
    expect(puffPlacement({ ...clear, x: PUFF_CLEARANCE_ABOVE_FLOOR + PUFF_CLEARANCE_FADE / 2 }, CALM, 0, 0, 0).scale).toBeCloseTo(4, 10);
    expect(puffPlacement({ ...clear, x: PUFF_CLEARANCE_ABOVE_FLOOR + PUFF_CLEARANCE_FADE }, CALM, 0, 0, 0).scale).toBe(8);
    // Without one, it may pass right by.
    expect(puffPlacement(puff({ x: 1 }), CALM, 0, 0, 0).scale).toBe(8);
  });
});

describe("scatterPuffs", () => {
  it("scatters the preset's count across its bands, relative to the cloud floor", () => {
    const puffs = scatterPuffs(DAY, FLOOR_Y);

    expect(puffs).toHaveLength(DAY.puffs.count);
    for (const [i, scattered] of puffs.entries()) {
      const band = DAY.puffs.bands[i % DAY.puffs.bands.length]!;
      expect(scattered.y).toBeGreaterThanOrEqual(FLOOR_Y + band.low);
      expect(scattered.y).toBeLessThanOrEqual(FLOOR_Y + band.high);
      expect(Math.abs(scattered.x)).toBeLessThanOrEqual(PUFF_FIELD_SIZE / 2);
      expect(Math.abs(scattered.z)).toBeLessThanOrEqual(PUFF_FIELD_SIZE / 2);
    }
  });

  it("keeps the band above the floor clear of the camera, and lets the one beneath it come close", () => {
    const preset = withPuffs({ count: 4, bands: [{ low: 12, high: 30 }, { low: -14, high: -4 }] });
    const [above, beneath] = scatterPuffs(preset, FLOOR_Y);

    expect(above!.clearance).toBe(PUFF_CLEARANCE_ABOVE_FLOOR);
    expect(beneath!.clearance).toBe(0);
  });

  it("scatters the same clouds every time", () => {
    expect(scatterPuffs(DAY, FLOOR_Y)).toEqual(scatterPuffs(DAY, FLOOR_Y));
  });

  it("scatters nothing without a band to put it in", () => {
    expect(scatterPuffs(withPuffs({ bands: [] }), FLOOR_Y)).toEqual([]);
  });
});

describe("createCloudPuffs", () => {
  it("draws each shape once, with every puff an instance of one of them", () => {
    const { group } = createCloudPuffs(DAY, FLOOR_Y);

    expect(meshes(group)).toHaveLength(PUFF_VARIANTS);
    expect(meshes(group).reduce((total, mesh) => total + mesh.count, 0)).toBe(DAY.puffs.count);
    for (const mesh of meshes(group)) {
      expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
      expect(mesh.frustumCulled).toBe(false);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
      expect(mesh.instanceColor).not.toBeNull();
    }
  });

  it("tints each puff between the preset's lit and shade colours", () => {
    const { group } = createCloudPuffs(DAY, FLOOR_Y);
    const lit = new THREE.Color(DAY.puffs.lit);
    const shade = new THREE.Color(DAY.puffs.shade);
    const tint = new THREE.Color();
    for (const mesh of meshes(group)) {
      for (let i = 0; i < mesh.count; i += 1) {
        mesh.getColorAt(i, tint);
        for (const channel of ["r", "g", "b"] as const) {
          expect(tint[channel]).toBeGreaterThanOrEqual(Math.min(lit[channel], shade[channel]) - 1e-6);
          expect(tint[channel]).toBeLessThanOrEqual(Math.max(lit[channel], shade[channel]) + 1e-6);
        }
      }
    }
  });

  it("is lit softly by default, taking the sky's environment map", () => {
    const material = meshes(createCloudPuffs(withPuffs({ style: "soft" }), FLOOR_Y).group)[0]!.material;
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((material as THREE.MeshStandardMaterial).fog).toBe(true);
  });

  it("is lit in three hard bands in the toon style", () => {
    const material = meshes(createCloudPuffs(withPuffs({ style: "toon" }), FLOOR_Y).group)[0]!.material as THREE.MeshToonMaterial;

    expect(material).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(material.gradientMap).not.toBeNull();
    expect(material.gradientMap!.image.width).toBe(3);
    expect(material.gradientMap!.minFilter).toBe(THREE.NearestFilter);
    expect(material.gradientMap!.magFilter).toBe(THREE.NearestFilter);
  });

  it("hides every puff until the first update places it", () => {
    const { group } = createCloudPuffs(DAY, FLOOR_Y);
    expect(instancePosition(meshes(group)[0]!, 0).scale.x).toBe(0);
  });

  it("places each instance where puffPlacement puts it, around the camera, on the clock", () => {
    const puffs = createCloudPuffs(DAY, FLOOR_Y);
    const camera = new THREE.Vector3(300, 5, -120);
    puffs.update(camera, 4200);

    const scattered = scatterPuffs(DAY, FLOOR_Y).filter((one) => one.variant === 1);
    const expected = puffPlacement(scattered[2]!, DAY.puffs.wind, 4.2, camera.x, camera.z);
    const { position, scale } = instancePosition(meshes(puffs.group)[1]!, 2);

    expect(position.x).toBeCloseTo(expected.x, 4);
    expect(position.y).toBeCloseTo(expected.y, 4);
    expect(position.z).toBeCloseTo(expected.z, 4);
    expect(scale.x).toBeCloseTo(expected.scale, 4);
    expect(meshes(puffs.group)[1]!.instanceMatrix.version).toBeGreaterThan(0);
  });

  it("frees every shape, the instances, the material and the toon bands", () => {
    const puffs = createCloudPuffs(withPuffs({ style: "toon" }), FLOOR_Y);
    const all = meshes(puffs.group);
    const material = all[0]!.material as THREE.MeshToonMaterial;
    const spies = [
      ...all.flatMap((mesh) => [vi.spyOn(mesh.geometry, "dispose"), vi.spyOn(mesh, "dispose")]),
      vi.spyOn(material, "dispose"),
      vi.spyOn(material.gradientMap!, "dispose"),
    ];

    puffs.dispose();

    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  });
});

describe("createPuffLook", () => {
  it("gives the shapes asked for, in the sky's own material for the preset's style", () => {
    const soft = createPuffLook(withPuffs({ style: "soft" }), 3, 11);
    expect(soft.geometries).toHaveLength(3);
    expect(soft.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((soft.material as THREE.MeshStandardMaterial).flatShading).toBe(true);

    const toon = createPuffLook(withPuffs({ style: "toon" }), 2, 11);
    expect(toon.geometries).toHaveLength(2);
    expect(toon.material).toBeInstanceOf(THREE.MeshToonMaterial);
    expect((toon.material as THREE.MeshToonMaterial).gradientMap).not.toBeNull();
  });

  it("draws the same shapes for the same seed", () => {
    const a = createPuffLook(DAY, 2, 11).geometries[1]!.getAttribute("position").array;
    const b = createPuffLook(DAY, 2, 11).geometries[1]!.getAttribute("position").array;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("tints from the preset's lit cloud colour toward its shade", () => {
    const look = createPuffLook(DAY, 1, 11);
    const out = new THREE.Color();
    expect(look.tint(0, out).getHex()).toBe(new THREE.Color(DAY.puffs.lit).getHex());
    expect(look.tint(1, out).getHex()).toBe(new THREE.Color(DAY.puffs.shade).getHex());
    expect(look.tint(0.5, out)).toBe(out);
  });

  it("frees its shapes, its material and the toon bands", () => {
    const look = createPuffLook(withPuffs({ style: "toon" }), 2, 11);
    const spies = [
      ...look.geometries.map((geometry) => vi.spyOn(geometry, "dispose")),
      vi.spyOn(look.material, "dispose"),
      vi.spyOn((look.material as THREE.MeshToonMaterial).gradientMap!, "dispose"),
    ];

    look.dispose();

    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  });
});
