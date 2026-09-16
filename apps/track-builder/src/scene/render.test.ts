import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  chevronPose,
  CONVEYOR_SPEEDS,
  ICE_OVERLAY_OPACITY,
  MUD_OVERLAY_LIFT,
  MUD_SIDE_COLOR,
  MUD_SLOSH_PHASE_STEP,
  mudSloshOffset,
  stripLayout,
  TICK_DT,
  type Module,
  type Segment,
} from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { loadAssetVisuals } from "../assets/assets.js";
import { addConveyorBelt, addIceOverlay, addMudOverlay, applySegmentTransform, buildSegmentGroup, disposeGroup, templateParts } from "./render.js";

const assetsRoot = path.resolve(import.meta.dirname, "../../../../assets");
const realFetch = async (url: string): Promise<Uint8Array> => {
  const fileName = url.substring(url.lastIndexOf("/") + 1);
  return new Uint8Array(readFileSync(path.join(assetsRoot, fileName)));
};

const meshCount = (root: THREE.Object3D): number => {
  let count = 0;
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) count += 1;
  });
  return count;
};

/**
 * A synthetic 8×6-footprint deck whose visual top sits at y = +0.3 — the
 * overlays below read layout (footprint, template top), never an Asset's
 * art, so no real file is needed. `surface` makes the Module-authored ice
 * and mud cases.
 */
const deckModule = (surface?: "ice" | "mud"): Module => ({
  id: "deck",
  statics: [],
  sockets: [],
  footprint: { bounds: { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 4, y: 2, z: 3 } }, clearance: 0.5 },
  ...(surface === undefined ? {} : { asset: { meshes: [{ positions: [], indices: [], surface }] } }),
});
const deckTemplate = (): THREE.Group => {
  const template = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshStandardMaterial());
  board.position.y = -0.2;
  template.add(board);
  return template;
};
const DECKS = { deck: deckModule() };

const rolesPresent = (root: THREE.Object3D): unknown[] => {
  const roles: unknown[] = [];
  root.traverse((object) => {
    if (object.userData.role !== undefined) roles.push(object.userData.role);
  });
  return roles;
};

describe("buildSegmentGroup", () => {
  it("draws an asset Segment from its template, placed", () => {
    const segment: Segment = { moduleId: "deck", position: { x: 1, y: 2, z: 3 }, rotation: 0 };

    const group = buildSegmentGroup(DECKS, segment, { deck: deckTemplate() })!;

    expect(meshCount(group)).toBe(1);
    expect(group.position.toArray()).toEqual([1, 2, 3]);
  });

  it("draws nothing until the template lands — no procedural stand-in (ADR 0078)", () => {
    const segment: Segment = { moduleId: "deck", position: { x: 0, y: 0, z: 0 }, rotation: 0 };

    expect(meshCount(buildSegmentGroup(DECKS, segment)!)).toBe(0);
  });

  it("returns undefined for an unknown Module — the viewport skips it as before", () => {
    const segment: Segment = { moduleId: "ghost", position: { x: 0, y: 0, z: 0 }, rotation: 0 };

    expect(buildSegmentGroup(DECKS, segment)).toBeUndefined();
  });
});

describe("removing a Segment (the builder's allocate-then-free discipline)", () => {
  const spyOnMeshResources = (root: THREE.Object3D) => {
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      spies.push(vi.spyOn(mesh.geometry, "dispose"), vi.spyOn(mesh.material as THREE.Material, "dispose"));
    });
    return spies;
  };

  it("keeps an asset Segment's template resources — the cached template still owns them", () => {
    // A synthetic template: what's under test is ownership, not GLB parsing.
    const template = new THREE.Group();
    template.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    const segment: Segment = { moduleId: "deck", position: { x: 0, y: 0, z: 0 }, rotation: 0 };
    const parent = new THREE.Group();
    const group = buildSegmentGroup(DECKS, segment, { deck: template })!;
    parent.add(group);
    const spies = spyOnMeshResources(template);
    expect(spies.length).toBeGreaterThan(0);

    // What `setTrack` does on every rebuild: dispose, then detach.
    disposeGroup(parent);
    parent.remove(group);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(parent.children).toHaveLength(0);
  });

  it("still frees an overlay's own meshes in the same rebuild", () => {
    const parent = new THREE.Group();
    const segment: Segment = { moduleId: "deck", position: { x: 0, y: 0, z: 0 }, rotation: 0, ice: true };
    const group = buildSegmentGroup(DECKS, segment)!;
    addIceOverlay(group, segment, DECKS.deck, undefined, new THREE.Texture());
    parent.add(group);
    const spies = spyOnMeshResources(group);
    expect(spies.length).toBeGreaterThan(0);

    disposeGroup(parent);

    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});

describe("addConveyorBelt (ADR 0064)", () => {
  const deck = () => deckModule();
  const belted = (angle = 0): Segment => ({
    moduleId: "deck",
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    conveyor: { preset: "medium", angle },
  });

  it("builds nothing when the Segment runs no belt", () => {
    const node = new THREE.Group();
    const plain: Segment = { moduleId: "deck", position: { x: 0, y: 0, z: 0 }, rotation: 0 };
    expect(addConveyorBelt(node, plain, deck(), deckTemplate())).toBeUndefined();
    expect(node.children).toHaveLength(0);
  });

  it("frames the strip on the deck top facing the local flow — chevrons point where the belt carries", () => {
    const node = new THREE.Group();
    const update = addConveyorBelt(node, belted(), deck(), deckTemplate())!;
    expect(update).toBeDefined();

    const strip = node.children[0]!;
    // The deck top: board centre y −0.2 + half-height 0.5 = +0.3, plus the decal's lift.
    expect(strip.position.y).toBeCloseTo(0.315, 10);
    // Angle 0 is module forward (−Z): the strip's own −Z lands on it exactly.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(strip.quaternion);
    expect(forward.x).toBeCloseTo(0, 10);
    expect(forward.z).toBeCloseTo(-1, 10);

    // A real grid of chevrons, nothing else — more than a token arrow, and
    // no dark plate: the deck's own top shows through.
    const meshes: THREE.Mesh[] = [];
    strip.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes.length).toBeGreaterThan(4);
    expect(meshes.every((m) => (m.geometry as THREE.BufferGeometry).type === "ShapeGeometry")).toBe(true);
  });

  it("a sideways angle yaws the strip with it, still over its own deck", () => {
    const node = new THREE.Group();
    addConveyorBelt(node, belted(Math.PI / 2), deck(), deckTemplate())!;

    const strip = node.children[0]!;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(strip.quaternion);
    expect(forward.x).toBeCloseTo(-1, 10);
    expect(forward.z).toBeCloseTo(0, 10);
  });

  it("marches the chevrons along the flow as the motion clock advances", () => {
    const node = new THREE.Group();
    const update = addConveyorBelt(node, belted(), deck(), deckTemplate())!;
    const chevrons: THREE.Mesh[] = [];
    node.children[0]!.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === "ShapeGeometry") {
        chevrons.push(o as THREE.Mesh);
      }
    });

    update(0);
    const before = chevrons.map((c) => c.position.z);
    update(3); // 3 ticks × (1/30)s × 4 u/s = 0.4 units of march
    const travelled = before.map((z, i) => z - chevrons[i]!.position.z);
    // Every chevron marched 0.4 toward −Z, modulo the ones that wrapped.
    expect(travelled.some((d) => Math.abs(d - 0.4) < 1e-9)).toBe(true);
    expect(travelled.every((d) => d > -1e-9)).toBe(true);
  });

  it("folds chevrons over the deck edge at the travel ends — half on top, half bending down", () => {
    const node = new THREE.Group();
    const update = addConveyorBelt(node, belted(), deck(), deckTemplate())!;
    // The deck footprint (halfX 4, halfZ 3) at local flow −Z: halfL 3, halfW 4.
    const layout = stripLayout(3, 4);
    const chevrons: THREE.Mesh[] = [];
    node.children[0]!.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === "ShapeGeometry") {
        chevrons.push(o as THREE.Mesh);
      }
    });

    update(6); // 6 ticks × (1/30)s × 4 u/s = 0.8 units of march
    const phase = 6 * TICK_DT * CONVEYOR_SPEEDS.medium;
    for (const chevron of chevrons) {
      const expected = chevronPose(layout, chevron.userData.marchIndex as number, phase);
      expect(chevron.position.z).toBeCloseTo(expected.z, 10);
      expect(chevron.position.y).toBeCloseTo(expected.y, 10);
      expect(chevron.rotation.x).toBeCloseTo(expected.pitch, 10);
    }
    // Mid-march the grid straddles the fold: one chevron visibly bending
    // over the edge — sunk and pitched together…
    expect(chevrons.some((c) => c.position.y < -0.05 && c.rotation.x < -0.3)).toBe(true);
    // …while the rest still ride flat on the deck.
    expect(chevrons.some((c) => c.position.y === 0 && c.rotation.x === 0)).toBe(true);
  });
});

describe("addIceOverlay (ADR 0066)", () => {
  const ice = () => deckModule("ice");
  const deck = () => deckModule();
  const texture = (): THREE.Texture => new THREE.Texture();
  const plain: Segment = { moduleId: "deck", position: { x: 0, y: 0, z: 0 }, rotation: 0 };

  it("sheets nothing when the Segment runs no ice and the Module isn't icy, or the texture hasn't loaded", () => {
    const node = new THREE.Group();
    expect(addIceOverlay(node, plain, deck(), deckTemplate(), texture())).toBeUndefined();
    expect(addIceOverlay(node, plain, ice(), deckTemplate(), undefined)).toBeUndefined();
    expect(node.children).toHaveLength(0);
  });

  it("sheets attached ice on any Module — the attachment, not the Module, is the mechanism", () => {
    const node = new THREE.Group();
    const mesh = addIceOverlay(node, { ...plain, ice: true }, deck(), deckTemplate(), texture())!;
    expect(mesh).toBeDefined();
    expect(node.children).toHaveLength(1);
    expect(mesh.position.y).toBeCloseTo(0.31, 10);
  });

  it("sheets the icy deck top in local space — flat, footprint-sized, a decal's lift", () => {
    const node = new THREE.Group();
    const mesh = addIceOverlay(node, plain, ice(), deckTemplate(), texture())!;
    expect(mesh).toBeDefined();
    expect(node.children).toHaveLength(1);

    // The ice deck top: board centre y −0.2 + half-height 0.5 = +0.3, plus the sheet's lift.
    expect(mesh.position.x).toBeCloseTo(0, 10);
    expect(mesh.position.y).toBeCloseTo(0.31, 10);
    expect(mesh.position.z).toBeCloseTo(0, 10);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(8, 10); // footprint halfX 4
    expect(box.max.z - box.min.z).toBeCloseTo(6, 10); // footprint halfZ 3
    expect(box.max.y - box.min.y).toBeCloseTo(0, 10); // flat
  });

  it("lays the shared texture translucent — tiled by deck size, never stretched to fit", () => {
    const node = new THREE.Group();
    const master = texture();
    const mesh = addIceOverlay(node, plain, ice(), deckTemplate(), master)!;
    const material = mesh.material as THREE.MeshStandardMaterial;

    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(ICE_OVERLAY_OPACITY, 10);
    expect(material.polygonOffset).toBe(true);
    expect(material.map).not.toBe(master);
    expect(material.map!.wrapS).toBe(THREE.RepeatWrapping);
    expect(material.map!.wrapT).toBe(THREE.RepeatWrapping);
    // 8×6 deck on a 2-unit tile: 4×3 repeats.
    expect(material.map!.repeat.x).toBeCloseTo(4, 10);
    expect(material.map!.repeat.y).toBeCloseTo(3, 10);
  });
});

describe("addMudOverlay (ADR 0067)", () => {
  const mud = () => deckModule("mud");
  const deck = () => deckModule();
  const texture = (): THREE.Texture => new THREE.Texture();
  const plain: Segment = { moduleId: "deck", position: { x: 0, y: 0, z: 0 }, rotation: 0 };

  it("builds nothing when the Segment runs no mud and the Module isn't muddy, or the texture hasn't loaded", () => {
    const node = new THREE.Group();
    expect(addMudOverlay(node, plain, 0, deck(), deckTemplate(), texture())).toBeUndefined();
    expect(addMudOverlay(node, plain, 0, mud(), deckTemplate(), undefined)).toBeUndefined();
    expect(node.children).toHaveLength(0);
  });

  it("blocks attached mud on any Module — the attachment, not the Module, is the mechanism", () => {
    const node = new THREE.Group();
    const built = addMudOverlay(node, { ...plain, mud: true }, 0, deck(), deckTemplate(), texture())!;
    expect(built).toBeDefined();
    expect(node.children).toHaveLength(1);
    // The 0.3 deck top plus half the lift (centred block) — feet at deck level sink below the mud.
    expect(built.mesh.position.y).toBeCloseTo(0.34, 10);
  });

  it("fills the muddy deck top ankle-deep and footprint-sized — a block, opaque, a mass to stand in", () => {
    const node = new THREE.Group();
    const built = addMudOverlay(node, plain, 0, mud(), deckTemplate(), texture())!;
    expect(built).toBeDefined();
    expect(node.children).toHaveLength(1);
    const mesh = built.mesh;

    expect(mesh.position.x).toBeCloseTo(0, 10);
    expect(mesh.position.y).toBeCloseTo(0.34, 10);
    expect(mesh.position.z).toBeCloseTo(0, 10);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(8, 10); // footprint halfX 4
    expect(box.max.z - box.min.z).toBeCloseTo(6, 10); // footprint halfZ 3
    // The filled gap: the block runs the whole lift down to the deck top (f32 geometry, looser precision).
    expect(box.max.y - box.min.y).toBeCloseTo(MUD_OVERLAY_LIFT, 6);
    expect(mesh.position.y + box.max.y).toBeCloseTo(0.3 + MUD_OVERLAY_LIFT, 6);
    expect(mesh.position.y + box.min.y).toBeCloseTo(0.3, 6);
    const materials = mesh.material as THREE.MeshStandardMaterial[];
    expect(materials).toHaveLength(6);
    expect(materials[2]!.transparent).toBe(false);
    for (const i of [0, 1, 3, 4, 5]) {
      expect(materials[i]!.map).toBeNull();
      expect(materials[i]!.color.getHex()).toBe(MUD_SIDE_COLOR);
    }
  });

  it("lays the shared texture opaque on top — tiled by deck size, never stretched to fit", () => {
    const node = new THREE.Group();
    const master = texture();
    const built = addMudOverlay(node, plain, 0, mud(), deckTemplate(), master)!;
    const top = (built.mesh.material as THREE.MeshStandardMaterial[])[2]!;

    expect(top.transparent).toBe(false);
    expect(top.polygonOffset).toBe(true);
    expect(top.map).not.toBe(master);
    expect(top.map!.wrapS).toBe(THREE.RepeatWrapping);
    expect(top.map!.wrapT).toBe(THREE.RepeatWrapping);
    // 8×6 deck on a 2-unit tile: 4×3 repeats.
    expect(top.map!.repeat.x).toBeCloseTo(4, 10);
    expect(top.map!.repeat.y).toBeCloseTo(3, 10);
  });

  it("breathes the texture offset off the motion clock — the preview never sits still", () => {
    const node = new THREE.Group();
    const built = addMudOverlay(node, plain, 2, mud(), deckTemplate(), texture())!;
    built.update(39); // 1.3 s in ticks
    const top = (built.mesh.material as THREE.MeshStandardMaterial[])[2]!;
    const slosh = mudSloshOffset(39 * TICK_DT, 2 * MUD_SLOSH_PHASE_STEP);
    expect(top.map!.offset.x).toBeCloseTo(slosh.u, 10);
    expect(top.map!.offset.y).toBeCloseTo(slosh.v, 10);
  });
});

describe("templateParts", () => {
  it("gives one box per mesh in the template's own frame, nested transforms included", () => {
    const template = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.4));
    post.position.set(0, 0.4, 0.65);
    const holder = new THREE.Group();
    holder.position.set(0, 0.45, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.6));
    holder.add(arm);
    template.add(post, holder);

    const [postBox, armBox] = templateParts(template);

    expect(postBox!.center.z).toBeCloseTo(0.65);
    expect(postBox!.halfExtents.y).toBeCloseTo(0.4);
    expect(armBox!.center.y).toBeCloseTo(0.45);
    expect(armBox!.halfExtents.z).toBeCloseTo(0.8);
  });
});
