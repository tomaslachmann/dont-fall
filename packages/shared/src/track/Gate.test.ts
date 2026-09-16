import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_QUAT, yawQuat } from "../math/quat.js";
import { initPhysics } from "../simulation/RapierSimulation.js";
import { readAssetModel } from "./asset.js";
import { ASSET_MODULE_DEFS } from "./assetModules.js";
import {
  decodeGateMask,
  encodeGateMask,
  gateOpenAt,
  passesThroughGate,
  placeGate,
  type GateOpening,
  type PlacedGate,
} from "./Gate.js";
import { GATE_ASSET_DEFS } from "./gateAssetDefs.js";

beforeAll(async () => {
  await initPhysics();
});

/** A 2 × 2 opening in the z = 0 plane, x −1..1, y 0..2 — every cell open. */
const SQUARE: GateOpening = {
  tilt: 0,
  origin: { x: -1, y: 0, z: 0 },
  cell: 0.5,
  cols: 4,
  rows: 4,
  mask: encodeGateMask(new Array(16).fill(1)),
  center: { x: 0, y: 1, z: 0 },
};
const at = (opening: GateOpening = SQUARE): PlacedGate => placeGate(opening, { x: 0, y: 0, z: 0 }, IDENTITY_QUAT, 1);

describe("the gate mask", () => {
  it("round-trips through hex, one bit per cell", () => {
    const cells = [1, 0, 0, 1, 1, 1, 0, 0, 1];
    expect([...decodeGateMask(encodeGateMask(cells), cells.length)]).toEqual(cells);
  });
});

describe("passing through a Gate (ADR 0068)", () => {
  it("counts a crossing through the opening, either way", () => {
    expect(passesThroughGate({ x: 0, y: 1, z: 0.3 }, { x: 0, y: 1, z: -0.3 }, at())).toBe(true);
    expect(passesThroughGate({ x: 0.2, y: 1.5, z: -0.3 }, { x: 0.2, y: 1.5, z: 0.3 }, at())).toBe(true);
  });

  it("never counts going beside it, over it, or not crossing at all", () => {
    expect(passesThroughGate({ x: 1.5, y: 1, z: 0.3 }, { x: 1.5, y: 1, z: -0.3 }, at())).toBe(false); // beside
    expect(passesThroughGate({ x: 0, y: 2.6, z: 0.3 }, { x: 0, y: 2.6, z: -0.3 }, at())).toBe(false); // over
    expect(passesThroughGate({ x: 0, y: 1, z: 0.3 }, { x: 0, y: 1, z: 0.1 }, at())).toBe(false); // short of it
  });

  it("finds the crossing point on the plane, not at either end — a long diagonal step still lands where it crossed", () => {
    // From beside the opening to beside it on the other side, crossing inside it.
    expect(passesThroughGate({ x: -1.4, y: 1, z: 2 }, { x: 1.4, y: 1, z: -2 }, at())).toBe(true);
  });

  it("only counts open cells", () => {
    const open = new Array(16).fill(1);
    open[1 * 4 + 1] = 0; // x −0.5..0, y 0.5..1 closed
    const gate = at({ ...SQUARE, mask: encodeGateMask(open) });
    expect(gateOpenAt(gate, { x: -0.25, y: 0.75, z: 0 })).toBe(false);
    expect(gateOpenAt(gate, { x: 0.25, y: 0.75, z: 0 })).toBe(true);
  });

  it("follows the Segment's placement and scale", () => {
    const gate = placeGate(SQUARE, { x: 10, y: 0, z: 0 }, yawQuat(Math.PI / 2), 2);
    // A quarter turn: the plane now faces ±X, and at 2× the opening spans z −2..2, y 0..4.
    expect(passesThroughGate({ x: 10.5, y: 3.5, z: 1.5 }, { x: 9.5, y: 3.5, z: 1.5 }, gate)).toBe(true);
    expect(passesThroughGate({ x: 10.5, y: 3.5, z: 2.5 }, { x: 9.5, y: 3.5, z: 2.5 }, gate)).toBe(false); // beside, at 2×
    expect(gate.center).toEqual({ x: 10, y: 2, z: expect.closeTo(0, 9) });
  });
});

describe("every Gate Asset's fitted opening (pnpm fit:gates)", () => {
  const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
  const gateIds = ASSET_MODULE_DEFS.filter((def) => def.category === "gate").map((def) => def.id);

  it("covers exactly the Gate category, finish signs as finishes", () => {
    expect(Object.keys(GATE_ASSET_DEFS).sort()).toEqual([...gateIds].sort());
    for (const id of gateIds) {
      expect(GATE_ASSET_DEFS[id]!.role, id).toBe(/signage_finish/.test(id) ? "finish" : "checkpoint");
      expect(ASSET_MODULE_DEFS.find((def) => def.id === id)!.gate, id).toBe(GATE_ASSET_DEFS[id]);
    }
    expect(gateIds.filter((id) => /hoop/.test(id))).toHaveLength(8);
    expect(gateIds.filter((id) => /arch/.test(id))).toHaveLength(12);
  });

  it("stands upright except the leaning hoop, which it looks through along its lean", () => {
    for (const id of gateIds) {
      const { tilt } = GATE_ASSET_DEFS[id]!.opening;
      if (/hoop_angled/.test(id)) expect(Math.abs(tilt), id).toBeGreaterThan((25 * Math.PI) / 180);
      else expect(tilt, id).toBe(0);
    }
  });

  it.each(gateIds)("%s: open cells really are clear of its collision, and its centre is one of them", (id) => {
    const def = GATE_ASSET_DEFS[id]!;
    const gate = at(def.opening);
    expect(gateOpenAt(gate, gate.center)).toBe(true);

    const model = readAssetModel(new Uint8Array(readFileSync(join(assetsRoot, `${id}.glb`))));
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    for (const mesh of model.collision) {
      world.createCollider(
        RAPIER.ColliderDesc.trimesh(new Float32Array(mesh.positions.flatMap((p) => [p.x, p.y, p.z])), new Uint32Array(mesh.indices)),
      );
    }
    world.step();
    let open = 0;
    for (let row = 0; row < gate.rows; row += 1) {
      for (let col = 0; col < gate.cols; col += 1) {
        if (!gate.open[row * gate.cols + col]) continue;
        open += 1;
        const onPlane = {
          x: gate.origin.x + gate.u.x * (col + 0.5) * gate.cell + gate.v.x * (row + 0.5) * gate.cell,
          y: gate.origin.y + gate.u.y * (col + 0.5) * gate.cell + gate.v.y * (row + 0.5) * gate.cell,
          z: gate.origin.z + gate.u.z * (col + 0.5) * gate.cell + gate.v.z * (row + 0.5) * gate.cell,
        };
        const start = { x: onPlane.x - gate.n.x * 5, y: onPlane.y - gate.n.y * 5, z: onPlane.z - gate.n.z * 5 };
        expect(world.castRay(new RAPIER.Ray(start, gate.n), 10, false), `${id} cell ${col},${row}`).toBeNull();
      }
    }
    world.free();
    // Room for a Character: at least a capsule's silhouette (0.7 × 1.8).
    expect(open * gate.cell * gate.cell, id).toBeGreaterThan(1.26);
  });
});
