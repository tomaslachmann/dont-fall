import { beforeAll, it } from "vitest";
import type { Module } from "../track/Module.js";
import { resolveTrack } from "../track/resolveTrack.js";
import { CAPSULE_BOTTOM_OFFSET } from "../tuning/character.js";
import { IDLE_INPUTS } from "./SimInputs.js";
import { initPhysics, RapierSimulation } from "./RapierSimulation.js";

beforeAll(async () => { await initPhysics(); });

it("scratch: back across the spawn spot, no bomb", () => {
  const GROUND: Module = { id: "ground", statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } }], sockets: [], footprint: { bounds: { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } }, clearance: 0.5 } };
  const resolved = resolveTrack({ ground: GROUND }, [{ moduleId: "ground", position: { x: 0, y: 0, z: 0 }, rotation: 0 }]);
  const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
  sim.addCharacter("me", { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 });
  const go = (x: number, z: number, n: number) => { for (let i = 0; i < n; i += 1) sim.tick({ me: { ...IDLE_INPUTS, moveDirection: { x, y: 0, z } } }); return sim.snapshot().characters.me!.position; };
  for (let i = 0; i < 10; i += 1) sim.tick({});
  go(1, 0, 20);
  go(0, 1, 20);
  const p = sim.snapshot().characters.me!.position;
  // back to x=0
  for (let i = 0; i < 40; i += 1) { const q = sim.snapshot().characters.me!.position; if (Math.abs(q.x) < 0.1) break; go(-Math.sign(q.x), 0, 1); }
  console.log("before", JSON.stringify(sim.snapshot().characters.me!.position), JSON.stringify(p));
  console.log("after north", JSON.stringify(go(0, -1, 60)));
  const w = (sim as any).world;
  const cap = (sim as any).characters.get("me").capsule.collider;
  const bones: any[] = [];
  w.forEachCollider((c: any) => { if (c.handle !== 0 && c.handle !== cap.handle) bones.push(c); });
  console.log("others", bones.map((c) => [c.isEnabled(), JSON.stringify(c.translation()), c.parent()?.bodyType()]).slice(0, 4));
  for (const c of bones) w.removeCollider(c, false);
  console.log("after removing them", JSON.stringify(go(0, -1, 30)));
});
