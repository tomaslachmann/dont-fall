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

const make = (withBomb: boolean) => {
  const def = BOMB_MODULE_DEFS[0]!;
  const bomb = attachAssetGeometry(def, loadAssetModule(new Uint8Array(readFileSync(join(assets, "bomb_A.glb"))), { footprint: def.footprint.bounds }));
  const GROUND: Module = { id: "ground", statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } }], sockets: [], footprint: { bounds: { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } }, clearance: 0.5 } };
  const resolved = resolveTrack({ ground: GROUND, bomb_A: bomb }, [
    { moduleId: "ground", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    ...(withBomb ? [{ moduleId: "bomb_A", position: { x: 0, y: 0, z: -1.2 }, rotation: 0, bomb: { fuseSeconds: 1, returnSeconds: 30 } }] : []),
  ]);
  const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
  sim.addCharacter("me", { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 3 });
  return sim;
};
const walk = (sim: RapierSimulation, dir: { x: number; z: number }, n: number) => {
  for (let i = 0; i < n; i += 1) sim.tick({ me: { ...IDLE_INPUTS, moveDirection: { x: dir.x, y: 0, z: dir.z } } });
  return sim.snapshot().characters.me!.position;
};

it("scratch controls", () => {
  const plain = make(false);
  for (let i = 0; i < 10; i += 1) plain.tick({});
  console.log("no bomb, walk north", JSON.stringify(walk(plain, { x: 0, z: -1 }, 60)));
  const lying = make(true);
  for (let i = 0; i < 10; i += 1) lying.tick({});
  console.log("bomb lying at home, walk north from x=0 z=3", JSON.stringify(walk(lying, { x: 0, z: -1 }, 60)), JSON.stringify(lying.snapshot().props[0]!.position));
});
