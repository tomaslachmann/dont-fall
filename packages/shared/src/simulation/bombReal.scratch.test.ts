import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, it } from "vitest";
import { loadAssetModule } from "../track/asset.js";
import { ASSET_MODULE_DEFS, attachAssetGeometry } from "../track/assetModules.js";
import { resolveTrack } from "../track/resolveTrack.js";
import { IDLE_INPUTS } from "./SimInputs.js";
import { initPhysics, RapierSimulation } from "./RapierSimulation.js";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
beforeAll(async () => { await initPhysics(); });
const mod = (id: string) => {
  const def = ASSET_MODULE_DEFS.find((d) => d.id === id)!;
  return attachAssetGeometry(def, loadAssetModule(new Uint8Array(readFileSync(join(assets, `${id}.glb`))), { footprint: def.footprint.bounds }));
};

it("scratch: real deck, bomb home crossed after a blast", () => {
  const deck = mod("kaykit_platform_6x6x1_blue");
  const top = deck.footprint.bounds.center.y + deck.footprint.bounds.halfExtents.y;
  const s = 2;
  const floorY = top * s;
  const library = { [deck.id]: deck, bomb_A: mod("bomb_A") };
  const run = (withBomb: boolean) => {
    const resolved = resolveTrack(library, [
      { moduleId: deck.id, position: { x: 0, y: 0, z: 0 }, rotation: 0, scale: s },
      ...(withBomb ? [{ moduleId: "bomb_A", position: { x: 0, y: floorY, z: -1.2 }, rotation: 0, bomb: { fuseSeconds: 1, returnSeconds: 30 } }] : []),
    ] as never);
    const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
    sim.addCharacter("me", { x: 0, y: floorY + 0.95, z: 0 });
    const go = (x: number, z: number, n: number, extra = {}) => { for (let i = 0; i < n; i += 1) sim.tick({ me: { ...IDLE_INPUTS, moveDirection: { x, y: 0, z }, ...extra } }); return sim.snapshot().characters.me!.position; };
    for (let i = 0; i < 10; i += 1) sim.tick({});
    if (withBomb) {
      sim.tick({ me: { ...IDLE_INPUTS, grabHeld: true } });
      sim.tick({});
      go(1, 0, 12, { facing: Math.PI / 2 });
      sim.tick({ me: { ...IDLE_INPUTS, grabHeld: true } });
      go(1, 0, 15);
      for (let i = 0; i < 150; i += 1) sim.tick({});
      console.log(withBomb ? "bomb" : "none", "bombs", JSON.stringify(sim.snapshot().bombs), sim.snapshot().characters.me!.motionState);
    } else {
      go(1, 0, 27);
    }
    for (let i = 0; i < 60; i += 1) { const q = sim.snapshot().characters.me!.position; const dx = -q.x, dz = 4 - q.z; const l = Math.hypot(dx, dz); if (l < 0.15) break; go(dx / l, dz / l, 1); }
    const from = sim.snapshot().characters.me!.position;
    const to = go(0, -1, 40);
    console.log(withBomb ? "bomb" : "none", "crossing from", from.z.toFixed(2), "to", to.z.toFixed(2), "x", to.x.toFixed(2), "y", to.y.toFixed(2), "floorY", floorY.toFixed(2));
  };
  run(false);
  run(true);
});

it("scratch: a client's prediction crossing the home after a blast", () => {
  const deck = mod("kaykit_platform_6x6x1_blue");
  const top = deck.footprint.bounds.center.y + deck.footprint.bounds.halfExtents.y;
  const floorY = top * 2;
  const library = { [deck.id]: deck, bomb_A: mod("bomb_A") };
  const resolved = resolveTrack(library, [
    { moduleId: deck.id, position: { x: 0, y: 0, z: 0 }, rotation: 0, scale: 2 },
    { moduleId: "bomb_A", position: { x: 0, y: floorY, z: -1.2 }, rotation: 0, bomb: { fuseSeconds: 1, returnSeconds: 30 } },
  ] as never);
  for (const predicted of [false, true]) {
    const server = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
    const client = new RapierSimulation({ ...resolved, withDefaultCharacter: false, authoritative: false });
    for (const sim of [server, client]) sim.addCharacter("me", { x: 0, y: floorY + 0.95, z: 0 });
    const step = (input = IDLE_INPUTS) => {
      server.tick({ me: input });
      client.syncPropsToSnapshot(server.snapshot().props);
      client.setPredictedProps(predicted ? [0] : []);
      client.tick({ me: input });
    };
    for (let i = 0; i < 10; i += 1) step();
    step({ ...IDLE_INPUTS, grabHeld: true });
    step();
    for (let i = 0; i < 12; i += 1) step({ ...IDLE_INPUTS, moveDirection: { x: 1, y: 0, z: 0 }, facing: Math.PI / 2 });
    step({ ...IDLE_INPUTS, grabHeld: true });
    for (let i = 0; i < 15; i += 1) step({ ...IDLE_INPUTS, moveDirection: { x: 1, y: 0, z: 0 } });
    for (let i = 0; i < 150; i += 1) step();
    client.reconcileCharacter("me", server.snapshot().characters.me!);
    for (let i = 0; i < 60; i += 1) { const q = client.snapshot().characters.me!.position; const dx = -q.x, dz = 4 - q.z; const l = Math.hypot(dx, dz); if (l < 0.15) break; step({ ...IDLE_INPUTS, moveDirection: { x: dx / l, y: 0, z: dz / l } }); }
    const from = client.snapshot().characters.me!.position.z;
    for (let i = 0; i < 40; i += 1) step({ ...IDLE_INPUTS, moveDirection: { x: 0, y: 0, z: -1 } });
    console.log("client predicted", predicted, "from", from.toFixed(2), "to", client.snapshot().characters.me!.position.z.toFixed(2), "server to", server.snapshot().characters.me!.position.z.toFixed(2), "prop live on client", client.snapshot().props[0]!.live, JSON.stringify(client.snapshot().props[0]!.position));
  }
});
