import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, it } from "vitest";
import { loadAssetModule } from "../track/asset.js";
import { attachAssetGeometry } from "../track/assetModules.js";
import { BOMB_MODULE_DEFS } from "../track/bombAssetDefs.js";
import type { Module } from "../track/Module.js";
import { resolveTrack } from "../track/resolveTrack.js";
import { CAPSULE_BOTTOM_OFFSET } from "../tuning/character.js";
import { IDLE_INPUTS } from "./SimInputs.js";
import { initPhysics, RapierSimulation } from "./RapierSimulation.js";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
beforeAll(async () => { await initPhysics(); });

const make = () => {
  const def = BOMB_MODULE_DEFS[0]!;
  const bomb = attachAssetGeometry(def, loadAssetModule(new Uint8Array(readFileSync(join(assets, "bomb_A.glb"))), { footprint: def.footprint.bounds }));
  const GROUND: Module = { id: "ground", statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } }], sockets: [], footprint: { bounds: { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } }, clearance: 0.5 } };
  const resolved = resolveTrack({ ground: GROUND, bomb_A: bomb }, [
    { moduleId: "ground", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    { moduleId: "bomb_A", position: { x: 0, y: 0, z: -1.2 }, rotation: 0, bomb: { fuseSeconds: 1, returnSeconds: 30 } },
  ]);
  const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
  sim.addCharacter("me", { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 });
  return sim;
};
const go = (sim: RapierSimulation, id: string, dir: { x: number; z: number }, n: number) => {
  for (let i = 0; i < n; i += 1) sim.tick({ [id]: { ...IDLE_INPUTS, moveDirection: { x: dir.x, y: 0, z: dir.z } } });
  return sim.snapshot().characters[id]!.position;
};
const idle = (sim: RapierSimulation, n: number) => { for (let i = 0; i < n; i += 1) sim.tick({}); };
const moves = (sim: RapierSimulation, id: string) => {
  const a = sim.snapshot().characters[id]!.position;
  const b = go(sim, id, { x: 1, z: 0 }, 15);
  const c = go(sim, id, { x: 0, z: 1 }, 15);
  return `${id} from ${a.x.toFixed(2)},${a.z.toFixed(2)} east→${b.x.toFixed(2)},${b.z.toFixed(2)} south→${c.x.toFixed(2)},${c.z.toFixed(2)} state ${sim.snapshot().characters[id]!.motionState}`;
};

it("A: carry and put down, no blast", () => {
  const sim = make();
  idle(sim, 10);
  sim.tick({ me: { ...IDLE_INPUTS, grabHeld: true } });
  sim.tick({});
  go(sim, "me", { x: 1, z: 0 }, 10);
  sim.tick({ me: { ...IDLE_INPUTS, grabHeld: true } });
  idle(sim, 2);
  console.log("A", moves(sim, "me"), JSON.stringify(sim.snapshot().bombs));
});

it("B: blasted, never held", () => {
  const sim = make();
  sim.addCharacter("other", { x: 1.5, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: -1.2 });
  idle(sim, 10);
  sim.tick({ me: { ...IDLE_INPUTS, grabHeld: true } });
  sim.tick({});
  sim.tick({ me: { ...IDLE_INPUTS, grabHeld: true } }); // put down right away
  go(sim, "me", { x: -1, z: 0 }, 25); // get clear
  idle(sim, 150);
  console.log("B bombs", JSON.stringify(sim.snapshot().bombs), sim.snapshot().characters.other!.ragdollEpoch);
  for (let k = 0; k < 10; k += 1) { idle(sim, 30); const o = sim.snapshot().characters.other!; console.log("B t", sim.snapshot().tick, o.motionState, o.position.x.toFixed(2), o.position.y.toFixed(2), o.position.z.toFixed(2)); }
  console.log("B", moves(sim, "other"));
  console.log("B", moves(sim, "me"));
});
