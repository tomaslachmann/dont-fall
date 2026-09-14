/**
 * THROWAWAY Phase-1 loop v3 (diagnosing-bugs skill) — DELETE before finishing.
 * The user's claim: modeled asset visuals don't render (in match).
 * Numeric audit per asset def, no browser needed:
 *  1. visual Box3 (parsed template, local space) vs footprint bounds;
 *  2. visual Box3 vs collision-trimesh Box3 (eye vs physics must overlap);
 *  3. material/node flags that render meshes invisible.
 * Red = a def whose eye disagrees with its physics, or that can't be seen.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  ASSET_MODULE_DEFS,
  MODULE_LIBRARY,
  RapierSimulation,
  initPhysics,
  loadAssetLibrary,
  loadAssetModule,
  resolveTrack,
  trackSpawn,
  type Track,
} from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { assetPlacements, buildAssetVisuals, loadAssetVisuals, parseAssetVisual } from "./render/assetVisuals.js";

const assetsRoot = path.resolve(import.meta.dirname, "../../../assets");
const readBytes = (fileName: string): Uint8Array => new Uint8Array(readFileSync(path.join(assetsRoot, fileName)));

const boxOf = (root: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(root);

describe("loop v3: eye vs physics per asset def", () => {
  it("every def's visual sits where its collision and footprint are, visibly", async () => {
    expect(ASSET_MODULE_DEFS.length).toBeGreaterThan(20);
    const bad: string[] = [];
    for (const def of ASSET_MODULE_DEFS) {
      const bytes = readBytes(`${def.id}.glb`);
      const template = await parseAssetVisual(def.id, bytes);
      const visualBox = boxOf(template);
      const visualSize = visualBox.getSize(new THREE.Vector3());
      const visualCenter = visualBox.getCenter(new THREE.Vector3());

      const validated = loadAssetModule(bytes, { footprint: def.footprint.bounds });
      const collider = new THREE.Group();
      for (const mesh of validated.collision) {
        const geo = new THREE.BufferGeometry();
        const flat: number[] = [];
        for (const p of mesh.positions) flat.push(p.x, p.y, p.z);
        geo.setAttribute("position", new THREE.Float32BufferAttribute(flat, 3));
        geo.setIndex(mesh.indices);
        collider.add(new THREE.Mesh(geo));
      }
      const collisionBox = collider.children.length > 0 ? boxOf(collider) : null;

      const fp = def.footprint.bounds;
      const fpSize = new THREE.Vector3(fp.halfExtents.x * 2, fp.halfExtents.y * 2, fp.halfExtents.z * 2);

      const problems: string[] = [];
      if (!Number.isFinite(visualSize.length()) || visualSize.length() < 1e-6) problems.push("visual Box3 degenerate");
      // Same order of magnitude as the footprint (generous 10x band either way).
      const ratio = visualSize.length() / Math.max(fpSize.length(), 1e-6);
      if (!(ratio > 0.1 && ratio < 10)) problems.push(`visual/footprint size ratio ${ratio.toFixed(2)}`);
      // Center within a footprint diagonal of the origin.
      if (visualCenter.length() > fpSize.length() + 1) problems.push(`visual center ${visualCenter.length().toFixed(2)} from origin`);
      // Eye must overlap physics.
      if (collisionBox && !visualBox.intersectsBox(collisionBox)) problems.push("visual disjoint from collision");
      // Invisible flags.
      template.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (!mesh.visible) problems.push("mesh visible=false");
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const mm = m as THREE.MeshStandardMaterial;
          if (mm.transparent && (mm.opacity ?? 1) < 0.05) problems.push(`opacity ${mm.opacity}`);
          if (mm.colorWrite === false) problems.push("colorWrite=false");
        }
      });
      if (problems.length > 0) bad.push(`${def.id}: ${problems.join("; ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("the real e9525610 rev-1 JSON resolves to one visual instance per segment", async () => {
    const stored = JSON.parse(readFileSync("/tmp/m9.json", "utf8")) as { track: Track };
    const track = stored.track;
    expect(track.length).toBe(12);
    const diskFetch = async (url: string): Promise<Uint8Array> => {
      const fileName = url.substring(url.lastIndexOf("/") + 1);
      try {
        return new Uint8Array(readFileSync(path.join(assetsRoot, fileName)));
      } catch {
        throw new Error(`GET ${url} answered 404`);
      }
    };
    const library = { ...MODULE_LIBRARY, ...(await loadAssetLibrary(diskFetch, "http://assets.test")) };
    const resolved = resolveTrack(library, track);
    const placements = assetPlacements(track, library);
    // Every non-procedural segment places exactly one visual.
    expect(placements.map((p) => p.moduleId).sort()).toEqual(
      track.filter((s) => s.moduleId !== "start").map((s) => s.moduleId).sort(),
    );
    const templates = await loadAssetVisuals(
      diskFetch,
      "http://assets.test",
      ASSET_MODULE_DEFS.map((d) => d.id),
    );
    const group = buildAssetVisuals(templates, placements);
    expect(group.children.length).toBe(placements.length);
    // Each instance stands within 1 unit of its segment's position.
    const byId = new Map(track.map((s) => [s.moduleId, s]));
    group.children.forEach((child, i) => {
      const seg = byId.get(placements[i]!.moduleId)!;
      const d = child.position.distanceTo(new THREE.Vector3(seg.position.x, seg.position.y, seg.position.z));
      expect(d).toBeLessThan(1);
    });
    // Collision exists for every segment: boxes for start, trimeshes for assets.
    expect(resolved.statics.length).toBeGreaterThan(0);
    expect(resolved.staticTrimeshes.length).toBeGreaterThan(0);
  });

  it("a spawn camera would actually draw the asset instances (frustum + raycast + finite)", async () => {
    const stored = JSON.parse(readFileSync("/tmp/m9.json", "utf8")) as { track: Track };
    const track = stored.track;
    const diskFetch = async (url: string): Promise<Uint8Array> => {
      const fileName = url.substring(url.lastIndexOf("/") + 1);
      return new Uint8Array(readFileSync(path.join(assetsRoot, fileName)));
    };
    const library = { ...MODULE_LIBRARY, ...(await loadAssetLibrary(diskFetch, "http://assets.test")) };
    const templates = await loadAssetVisuals(
      diskFetch,
      "http://assets.test",
      ASSET_MODULE_DEFS.map((d) => d.id),
    );
    const placements = assetPlacements(track, library);
    const group = buildAssetVisuals(templates, placements);

    // No NaN anywhere a renderer would choke on (NaN bounds => culled => invisible).
    const nanMeshes: string[] = [];
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 1) {
        if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
          nanMeshes.push("NaN vertex");
          break;
        }
      }
      mesh.geometry.computeBoundingSphere();
      if (!Number.isFinite(mesh.geometry.boundingSphere!.radius)) nanMeshes.push("NaN bounds");
    });
    expect(nanMeshes).toEqual([]);

    // Spawn-following camera (same shape as createStage's PerspectiveCamera).
    const first = track[0]!;
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 300);
    camera.position.set(first.position.x, first.position.y + 3, first.position.z + 6);
    camera.lookAt(first.position.x, first.position.y, first.position.z - 10);
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    group.updateMatrixWorld(true);
    const drawnIds = new Set<string>();
    group.children.forEach((child, i) => {
      let visible = false;
      child.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && frustum.intersectsObject(mesh)) visible = true;
      });
      if (visible) drawnIds.add(placements[i]!.moduleId);
    });
    // The two nearest asset pieces down-track must survive culling.
    expect([...drawnIds]).toContain("platform_straight");
    expect([...drawnIds]).toContain("ramp_45");

    // A ray down the track must strike an asset mesh, not fly through everything.
    const ray = new THREE.Raycaster(
      new THREE.Vector3(first.position.x, first.position.y + 1, first.position.z),
      new THREE.Vector3(0, -0.2, -1).normalize(),
    );
    const hits = ray.intersectObjects(group.children, true);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("the real track's trimeshes cook in Rapier (loadTrack's RapierSimulation step)", async () => {
    await initPhysics();
    const stored = JSON.parse(readFileSync("/tmp/m9.json", "utf8")) as { track: Track };
    const track = stored.track;
    const diskFetch = async (url: string): Promise<Uint8Array> => {
      const fileName = url.substring(url.lastIndexOf("/") + 1);
      return new Uint8Array(readFileSync(path.join(assetsRoot, fileName)));
    };
    const library = { ...MODULE_LIBRARY, ...(await loadAssetLibrary(diskFetch, "http://assets.test")) };
    const resolved = resolveTrack(library, track);
    const sim = new RapierSimulation({
      statics: resolved.statics,
      staticSurfaces: resolved.staticSurfaces,
      staticTrimeshes: resolved.staticTrimeshes,
      checkpoints: resolved.checkpoints,
      finishZones: resolved.finishZones,
      spinners: resolved.spinners,
      props: resolved.props,
      speedPads: resolved.speedPads,
      launchPads: resolved.launchPads,
      volumes: resolved.volumes,
      withDefaultCharacter: false,
      authoritative: false,
    });
    sim.addCharacter("loop", trackSpawn(track, 0));
    sim.tick(
      { loop: { moveDirection: { x: 0, y: 0, z: 0 }, jumpHeld: false, dashHeld: false, hitHeld: false, grabHeld: false, facing: 0 } },
      "RUNNING",
    );
    sim.dispose();
  }, 60000);
});
