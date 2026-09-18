import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { IDENTITY_QUAT, type DeckFrame } from "@dont-fall/shared";
import { ICE_DEPTH, ICE_DETAIL_SIZE, ICE_DETAIL_TILE, ICE_GLINT_INSET } from "./iceLook.js";
import { buildIceSlab, iceDetailTexture } from "./iceMesh.js";
import { iceCrack, iceColor, iceGlintPose, iceGlintSites, iceSpecks } from "./iceShape.js";
import { mudOutline, nearestFreeEdge } from "../mud/mudShape.js";

const deckAt = (x: number, z: number, halfX = 3, halfZ = 2): DeckFrame => ({
  center: { x, y: 1, z },
  yaw: 0,
  orientation: IDENTITY_QUAT,
  halfX,
  halfZ,
});

const meshOf = (object: THREE.Object3D, name: string): THREE.Mesh => object.getObjectByName(name) as THREE.Mesh;

describe("buildIceSlab (ADR 0107)", () => {
  it("stands a flat slab at ICE_DEPTH, cut square: a side wall on every free edge, nothing past the footprint", () => {
    const { object } = buildIceSlab({ deck: deckAt(0, 0) }, []);
    const body = meshOf(object, "ice-body");
    const position = body.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i += 1) {
      expect(position.getY(i)).toBeCloseTo(ICE_DEPTH, 6);
      expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(3 + 1e-6);
      expect(Math.abs(position.getZ(i))).toBeLessThanOrEqual(2 + 1e-6);
    }
    const side = meshOf(object, "ice-sides");
    expect(side).toBeDefined();
    const sideY = side.geometry.getAttribute("position");
    let top = -Infinity;
    let foot = Infinity;
    for (let i = 0; i < sideY.count; i += 1) {
      top = Math.max(top, sideY.getY(i));
      foot = Math.min(foot, sideY.getY(i));
    }
    expect(top).toBeCloseTo(ICE_DEPTH, 6);
    expect(foot).toBeCloseTo(0, 6); // a plan-less deck has no bevel to run down over
  });

  it("builds the same slab twice — colours, positions and glint sites are pure functions of where the deck is", () => {
    const first = buildIceSlab({ deck: deckAt(4, -2) }, []);
    const second = buildIceSlab({ deck: deckAt(4, -2) }, []);
    const a = meshOf(first.object, "ice-body").geometry.getAttribute("color") as THREE.BufferAttribute;
    const b = meshOf(second.object, "ice-body").geometry.getAttribute("color") as THREE.BufferAttribute;
    expect(Array.from(a.array)).toEqual(Array.from(b.array));
  });

  it("runs on across a seam into a neighbouring ice deck — a seam skirt instead of a cut side there", () => {
    const left = { deck: deckAt(-3, 0) }; // spans x [-6, 0]
    const right = { deck: deckAt(3, 0) }; // spans x [0, 6]
    const alone = buildIceSlab(left, [left]);
    expect(alone.object.getObjectByName("ice-seams")).toBeUndefined();
    const joined = buildIceSlab(left, [left, right]);
    expect(joined.object.getObjectByName("ice-seams")).toBeDefined();
  });
});

describe("the detail texture (ADR 0107)", () => {
  it("is one shared, deterministic tile with veins in it and clear ice between them", () => {
    const texture = iceDetailTexture();
    expect(iceDetailTexture()).toBe(texture);
    expect(texture.image.width).toBe(ICE_DETAIL_SIZE);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    const data = texture.image.data as Uint8Array;
    let clear = 0;
    let drawn = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! === 0) clear += 1;
      else drawn += 1;
    }
    expect(drawn).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(drawn); // most of the ice is clear
  });

  it("wraps: the crack and speck fields repeat exactly on the tile", () => {
    for (const [x, z] of [
      [0.31, 0.77],
      [1.9, 2.6],
    ] as const) {
      expect(iceCrack(x, z, ICE_DETAIL_TILE)).toEqual(iceCrack(x + ICE_DETAIL_TILE, z + ICE_DETAIL_TILE, ICE_DETAIL_TILE));
      expect(iceSpecks(x, z, ICE_DETAIL_TILE)).toEqual(iceSpecks(x + ICE_DETAIL_TILE, z + ICE_DETAIL_TILE, ICE_DETAIL_TILE));
    }
  });
});

describe("the colour and the glints (ADR 0107)", () => {
  it("frosts the rim: the same world point reads whiter at a free edge than deep inside", () => {
    const inside = iceColor(2, 3, 0);
    const rimmed = iceColor(2, 3, 1);
    expect(rimmed[0]).toBeGreaterThan(inside[0]);
    expect(rimmed[2]).toBeGreaterThanOrEqual(inside[2]);
  });

  it("places glint sites deterministically, on the deck, never hard against a free edge", () => {
    const placement = { deck: deckAt(7, 7, 4, 4) };
    const edges = mudOutline(placement, [placement]);
    const sites = iceGlintSites(placement.deck, edges);
    expect(sites.length).toBeGreaterThan(0);
    expect(iceGlintSites(placement.deck, edges)).toEqual(sites);
    for (const site of sites) {
      expect(nearestFreeEdge(site, edges).distance).toBeGreaterThanOrEqual(ICE_GLINT_INSET);
    }
  });

  it("sparkles as a pure function of time: a brief pop once a period, nothing between", () => {
    const site = { x: 0, z: 0, size: 0.1, period: 5, phase: 0, tilt: 1 };
    expect(iceGlintPose(site, 0.01).scale).toBeGreaterThan(0);
    expect(iceGlintPose(site, 2.5).scale).toBe(0);
    // The same instant next period sparkles the same way.
    expect(iceGlintPose(site, 0.2)).toEqual(iceGlintPose(site, 5.2));
  });
});
