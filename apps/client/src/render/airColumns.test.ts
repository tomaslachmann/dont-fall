import {
  AIR_PUFF_COUNT,
  AIR_PUFF_VARIANTS,
  AIR_SWOOSH_COUNT,
  AIR_SWOOSH_SEGMENTS,
  ENVIRONMENT_PRESETS,
  airColumnFrame,
  airPuffPlacement,
  airPuffSeed,
  airSwooshAlpha,
  airSwooshHead,
  airSwooshPoint,
  airSwooshSeed,
  airSwooshSpan,
  type VolumeConfig,
} from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { buildAirColumns } from "./airColumns.js";

// The procedural `updraft` Module's own field: a 3×6×4 column lifting at 40.
const UPDRAFT: VolumeConfig = {
  bounds: { center: { x: 0, y: 3, z: 0 }, halfExtents: { x: 1.5, y: 3, z: 2 } },
  force: { x: 0, y: 40, z: 0 },
  maxInducedSpeed: 10,
  priority: 1,
};
const DAY = ENVIRONMENT_PRESETS.day;
const CAMERA = new THREE.Vector3(8, 4, 10);
const PER_RIBBON = (AIR_SWOOSH_SEGMENTS + 1) * 2;

const swooshesOf = (group: THREE.Group): THREE.Mesh => group.getObjectByName("air-swooshes") as THREE.Mesh;
const puffsOf = (group: THREE.Group): THREE.InstancedMesh[] =>
  group.children.filter((child): child is THREE.InstancedMesh => (child as THREE.InstancedMesh).isInstancedMesh);
const vertex = (mesh: THREE.Mesh, v: number): THREE.Vector3 =>
  new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position") as THREE.BufferAttribute, v);

describe("buildAirColumns", () => {
  it("builds one column per flowing Volume: a swoosh ribbon set and one puff mesh per shape", () => {
    const { columns } = buildAirColumns([UPDRAFT, UPDRAFT], DAY);
    expect(columns).toHaveLength(2);
    const [column] = columns;
    expect(swooshesOf(column!).geometry.getAttribute("position").count).toBe(AIR_SWOOSH_COUNT * PER_RIBBON);
    const puffs = puffsOf(column!);
    expect(puffs).toHaveLength(AIR_PUFF_VARIANTS);
    expect(puffs.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(AIR_PUFF_COUNT);
  });

  it("draws nothing for a zero-force volume, and allocates nothing without a column", () => {
    const built = buildAirColumns([{ ...UPDRAFT, force: { x: 0, y: 0, z: 0 } }], DAY);
    expect(built.columns).toHaveLength(0);
    expect(() => built.update(1000, CAMERA)).not.toThrow();
  });

  it("stands the column on the entry face and turns it along the force — a sideways wind reads sideways", () => {
    const wind: VolumeConfig = {
      ...UPDRAFT,
      bounds: { center: { x: 5, y: 1, z: 0 }, halfExtents: { x: 4, y: 1, z: 2 } },
      force: { x: -20, y: 0, z: 0 },
    };
    const [column] = buildAirColumns([wind], DAY).columns;
    expect(column!.position.toArray()).toEqual([9, 1, 0]);
    const along = new THREE.Vector3(0, 1, 0).applyQuaternion(column!.quaternion);
    expect(along.x).toBeCloseTo(-1, 10);
    expect(along.y).toBeCloseTo(0, 10);
  });

  it("lays each swoosh along the shared spiral, fading as the shared maths says", () => {
    const built = buildAirColumns([UPDRAFT], DAY);
    const [column] = built.columns;
    const nowMs = 1234;
    built.update(nowMs, CAMERA);

    const frame = airColumnFrame(UPDRAFT)!;
    const seed = airSwooshSeed(2);
    const head = airSwooshHead(nowMs, seed, frame);
    const j = 10;
    const t = head - (j / AIR_SWOOSH_SEGMENTS) * airSwooshSpan(seed);
    const centre = airSwooshPoint(t, seed, frame);
    const swooshes = swooshesOf(column!);
    const v = 2 * PER_RIBBON + j * 2;
    const middle = vertex(swooshes, v).add(vertex(swooshes, v + 1)).multiplyScalar(0.5);
    expect(middle.x).toBeCloseTo(centre.x, 5);
    expect(middle.y).toBeCloseTo(centre.y, 5);
    expect(middle.z).toBeCloseTo(centre.z, 5);
    const colors = swooshes.geometry.getAttribute("color") as THREE.BufferAttribute;
    expect(colors.getW(v)).toBeCloseTo(airSwooshAlpha(t), 5);
    expect(colors.getW(v + 1)).toBeCloseTo(airSwooshAlpha(t), 5);
  });

  it("turns each ribbon's width face-on to the camera", () => {
    const built = buildAirColumns([UPDRAFT], DAY);
    const swooshes = swooshesOf(built.columns[0]!);
    built.update(2000, CAMERA);
    const v = 4 * PER_RIBBON + 12 * 2;
    const left = vertex(swooshes, v);
    const right = vertex(swooshes, v + 1);
    const width = right.clone().sub(left);
    expect(width.length()).toBeGreaterThan(0);
    const toCamera = CAMERA.clone().sub(left.clone().add(right).multiplyScalar(0.5));
    expect(Math.abs(width.normalize().dot(toCamera.normalize()))).toBeLessThan(1e-6);
  });

  it("streams over time", () => {
    const built = buildAirColumns([UPDRAFT], DAY);
    const swooshes = swooshesOf(built.columns[0]!);
    built.update(0, CAMERA);
    const before = vertex(swooshes, 10);
    built.update(300, CAMERA);
    expect(vertex(swooshes, 10).distanceTo(before)).toBeGreaterThan(0.01);
  });

  it("places each puff where the shared maths puts it, tinted in the sky's cloud colours", () => {
    const built = buildAirColumns([UPDRAFT], DAY);
    built.update(1800, CAMERA);
    const mesh = puffsOf(built.columns[0]!)[1]!;
    // The second puff wearing shape 1 is puff 4 (shapes are taken in turn).
    const seed = airPuffSeed(4);
    const expected = airPuffPlacement(1800, seed, airColumnFrame(UPDRAFT)!);
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(1, matrix);
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    matrix.decompose(position, new THREE.Quaternion(), scale);
    expect(position.x).toBeCloseTo(expected.x, 5);
    expect(position.y).toBeCloseTo(expected.y, 5);
    expect(position.z).toBeCloseTo(expected.z, 5);
    expect(scale.x).toBeCloseTo(expected.scale, 5);

    const tint = new THREE.Color();
    mesh.getColorAt(1, tint);
    const lit = new THREE.Color(DAY.puffs.lit);
    const shade = new THREE.Color(DAY.puffs.shade);
    expect(tint.r).toBeCloseTo(lit.r + (shade.r - lit.r) * seed.tint, 5);
  });

  it("frees what the columns share", () => {
    const built = buildAirColumns([UPDRAFT], DAY);
    const swooshes = swooshesOf(built.columns[0]!);
    const material = swooshes.material as THREE.MeshBasicMaterial;
    const puffMaterial = puffsOf(built.columns[0]!)[0]!.material as THREE.Material;
    const spies = [
      vi.spyOn(swooshes.geometry, "dispose"),
      vi.spyOn(material, "dispose"),
      vi.spyOn(material.alphaMap!, "dispose"),
      vi.spyOn(puffMaterial, "dispose"),
    ];
    built.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});
