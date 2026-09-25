import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { loadAssetModule } from "../track/asset.js";
import { attachAssetGeometry } from "../track/assetModules.js";
import { BOMB_MODULE_DEFS } from "../track/bombAssetDefs.js";
import type { Module } from "../track/Module.js";
import { resolveTrack } from "../track/resolveTrack.js";
import { CAPSULE_BOTTOM_OFFSET } from "../tuning/character.js";
import { IDLE_INPUTS } from "./SimInputs.js";
import { CHARACTER_GROUPS } from "./collisionGroups.js";
import { initPhysics, RapierSimulation } from "./RapierSimulation.js";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
beforeAll(async () => { await initPhysics(); });

it("scratch: walking through a spent bomb's home", () => {
  const def = BOMB_MODULE_DEFS[0]!;
  const bomb = attachAssetGeometry(def, loadAssetModule(new Uint8Array(readFileSync(join(assets, "bomb_A.glb"))), { footprint: def.footprint.bounds }));
  const GROUND: Module = { id: "ground", statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } }], sockets: [], footprint: { bounds: { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } }, clearance: 0.5 } };
  const resolved = resolveTrack({ ground: GROUND, bomb_A: bomb }, [
    { moduleId: "ground", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    { moduleId: "bomb_A", position: { x: 0, y: 0, z: -1.2 }, rotation: 0, bomb: { fuseSeconds: 1, returnSeconds: 30 } },
  ]);
  console.log("statics", resolved.statics.length, "trimeshes", resolved.staticTrimeshes.length, "props", resolved.props.length, "moving", resolved.movingSegments.length);
  const server = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
  const client = new RapierSimulation({ ...resolved, withDefaultCharacter: false, authoritative: false });
  for (const sim of [server, client]) sim.addCharacter("me", { x: 0, y: CAPSULE_BOTTOM_OFFSET + 0.1, z: 0 });
  const step = (input = IDLE_INPUTS) => {
    server.tick({ me: input });
    client.syncPropsToSnapshot(server.snapshot().props);
    client.reconcileCharacter("me", server.snapshot().characters.me!);
    client.tick({ me: input });
  };
  for (let n = 0; n < 10; n += 1) step();
  step({ ...IDLE_INPUTS, grabHeld: true });
  step();
  // carry it 6 m east, put it down, walk back west of home
  for (let n = 0; n < 40; n += 1) step({ ...IDLE_INPUTS, moveDirection: { x: 1, y: 0, z: 0 }, facing: Math.PI / 2 });
  step({ ...IDLE_INPUTS, grabHeld: true });
  for (let n = 0; n < 45; n += 1) step();
  console.log("bombs", JSON.stringify(server.snapshot().bombs), "me", JSON.stringify(server.snapshot().characters.me!.motionState));
  for (let n = 0; n < 120; n += 1) step();
  // now stand at x=0,z=+2 and walk north across the home spot (z=-1.2)
  for (const sim of [server, client]) sim.snapshot();
  const at = (sim: RapierSimulation) => sim.snapshot().characters.me!.position;
  console.log("before walk server", JSON.stringify(at(server)), "state", server.snapshot().characters.me!.motionState);
  // walk to x=0 first
  for (let n = 0; n < 80; n += 1) {
    const p = at(server);
    const dx = -p.x, dz = 3 - p.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) break;
    step({ ...IDLE_INPUTS, moveDirection: { x: dx / len, y: 0, z: dz / len } });
  }
  console.log("start of crossing", JSON.stringify(at(server)), JSON.stringify(at(client)));
  {
    const ctl = (server as any).characters.get("me").capsule.controller;
    const orig = ctl.computeColliderMovement.bind(ctl);
    ctl.computeColliderMovement = (col: any, mv: any, flags: any, groups: any, pred: any) => {
      const mm = (server as any).characters.get("me").movement;
      if ((server as any).snapshot().tick > 0) console.log("wanted", JSON.stringify(mv), "vel", JSON.stringify(mm.velocity), "keptRide", JSON.stringify(mm.keptRideVelocity), "z", (server as any).characters.get("me").position.z.toFixed(2));
      return orig(col, mv, flags, groups, (c: any) => {
        if (c.handle !== 0 && (server as any).snapshot().tick % 1 === 0 && Math.abs(mv.z) > 0.01) console.log("considers", c.handle, c.isEnabled(), JSON.stringify(c.translation()), c.parent()?.bodyType(), "prop", (server as any).propIndexByHandle.get(c.handle), "at z", (server as any).characters.get("me").position.z.toFixed(2));
        return pred ? pred(c) : true;
      });
    };
  }
  for (let n = 0; n < 60; n += 1) {
    step({ ...IDLE_INPUTS, moveDirection: { x: 0, y: 0, z: -1 }, facing: 0 });
    const c = server.snapshot().characters.me!;
    if (n >= 12 && n <= 17) { const ch = (server as any).characters.get("me"); const cm = ch.capsule.controller.computedMovement(); console.log("cross", n, c.position.z.toFixed(3), "computed", JSON.stringify(cm), "colls", ch.capsule.controller.numComputedCollisions(), [...Array(ch.capsule.controller.numComputedCollisions()).keys()].map((i: number) => { const k = ch.capsule.controller.computedCollision(i); return [k.collider?.handle, k.collider?.isEnabled(), JSON.stringify(k.collider?.translation()), JSON.stringify(k.normal1)]; })); }
  }
  console.log("after crossing server", JSON.stringify(at(server)), "client", JSON.stringify(at(client)), "bombs", JSON.stringify(server.snapshot().bombs), "prop", JSON.stringify(server.snapshot().props[0]));
  {
    const here = at(server);
    server.addCharacter("fresh", { x: here.x + 0.02, y: here.y + 0.05, z: 3 });
    for (let n = 0; n < 10; n += 1) server.tick({});
    for (let n = 0; n < 40; n += 1) server.tick({ me: { ...IDLE_INPUTS, moveDirection: { x: -1, y: 0, z: 0 } }, fresh: { ...IDLE_INPUTS, moveDirection: { x: 0, y: 0, z: -1 } } });
    console.log("fresh walked to", JSON.stringify(server.snapshot().characters.fresh!.position));
    const me0 = at(server);
    for (let n = 0; n < 20; n += 1) server.tick({ me: { ...IDLE_INPUTS, moveDirection: { x: 1, y: 0, z: 0 } } });
    for (const id of ["me", "fresh"]) {
      const k = (server as any).characters.get(id).capsule.controller;
      const out: Record<string, unknown> = {};
      for (const name of ["offset", "slideEnabled", "autostepMaxHeight", "autostepMinWidth", "autostepIncludesDynamicBodies", "snapToGroundDistance", "maxSlopeClimbAngle", "minSlopeSlideAngle", "characterMass", "applyImpulsesToDynamicBodies", "normalNudgeFactor"]) {
        try { out[name] = typeof k[name] === "function" ? k[name]() : "n/a"; } catch (e) { out[name] = "err"; }
      }
      try { out.up = k.up(); } catch {}
      console.log("ctl", id, JSON.stringify(out));
    }
    console.log("me east from", JSON.stringify(me0), "to", JSON.stringify(at(server)));
  }
  const RAPIER = (server as any).world.constructor;
  const w = (server as any).world;
  const R = require("@dimforge/rapier3d-compat");
  {
    const ch = (server as any).characters.get("me");
    const ctl = ch.capsule.controller;
    const probe = (label: string) => {
      ctl.computeColliderMovement(ch.capsule.collider, { x: 0, y: -0.09, z: -0.18 }, undefined, CHARACTER_GROUPS);
      console.log("bisect", label, JSON.stringify(ctl.computedMovement()));
    };
    probe("as is");
    {
      const w1 = (server as any).world;
      const cap = ch.capsule.collider;
      for (const dz of [0, -0.2, -0.4, -0.6, -0.8]) {
        const pos = cap.translation(); pos.z += dz; pos.y -= 0.02;
        const hits: unknown[] = [];
        w1.intersectionsWithShape(pos, cap.rotation(), cap.shape, (c: any) => { hits.push([c.handle, c.isEnabled(), c.parent()?.bodyType(), JSON.stringify(c.translation())]); return true; }, undefined, undefined, cap);
        console.log("scan dz", dz, JSON.stringify(hits));
      }
    }
    const w0 = (server as any).world;
    const bombCol = (server as any).props[0].colliders[0];
    const body = bombCol.parent();
    console.log("bomb body", body.bodyType(), JSON.stringify(body.translation()), "enabled body", body.isEnabled?.(), "col enabled", bombCol.isEnabled(), "sleeping", body.isSleeping());
    w0.removeCollider(bombCol, false);
    w0.propagateModifiedBodyPositionsToColliders?.();
    probe("bomb collider removed");
    const cc = ch.capsule.collider;
    console.log("capsule rot", JSON.stringify(cc.rotation()), "pos", JSON.stringify(cc.translation()), "halfH", cc.halfHeight?.(), "r", cc.radius?.(), "body", cc.parent()?.bodyType(), JSON.stringify(cc.parent()?.translation()));
    for (const mv of [{ x: 0, y: 0, z: -0.18 }, { x: 0, y: -0.09, z: -0.18 }, { x: 0.18, y: -0.09, z: 0 }, { x: 0, y: -0.09, z: 0.18 }]) {
      ctl.computeColliderMovement(ch.capsule.collider, mv, undefined, CHARACTER_GROUPS);
      console.log("probe", JSON.stringify(mv), "->", JSON.stringify(ctl.computedMovement()));
    }
    ctl.computeColliderMovement(ch.capsule.collider, { x: 0, y: 0, z: -0.2 }, undefined, CHARACTER_GROUPS);
    const m = ctl.computedMovement();
    console.log("probe move", JSON.stringify(m), "collisions", ctl.numComputedCollisions());
    for (let i = 0; i < ctl.numComputedCollisions(); i += 1) {
      const c = ctl.computedCollision(i);
      console.log("  coll", c.collider?.handle, c.collider?.isEnabled(), JSON.stringify(c.collider?.translation()), c.collider?.parent()?.bodyType(), JSON.stringify(c.normal1), (server as any).propIndexByHandle.get(c.collider?.handle));
    }
  }
  const meHandle = (server as any).characters.get("me").colliderHandle;
  const meCol = w.getCollider(meHandle);
  const up = meCol.translation(); up.y += 0.15;
  const sh = w.castShape(up, meCol.rotation(), { x: 0, y: 0, z: -1 }, meCol.shape, 0, 3, true, undefined, undefined, meCol);
  console.log("shapecast", sh ? JSON.stringify({ h: sh.collider.handle, toi: sh.time_of_impact ?? sh.toi, en: sh.collider.isEnabled(), t: sh.collider.translation(), bt: sh.collider.parent()?.bodyType(), g: sh.collider.collisionGroups(), prop: (server as any).propIndexByHandle.get(sh.collider.handle) }) : "none");
  const clientW = (client as any).world;
  const cMe = clientW.getCollider((client as any).characters.get("me").colliderHandle);
  const up2 = cMe.translation(); up2.y += 0.15;
  const sh2 = clientW.castShape(up2, cMe.rotation(), { x: 0, y: 0, z: -1 }, cMe.shape, 0, 3, true, undefined, undefined, cMe);
  console.log("client shapecast", sh2 ? JSON.stringify({ h: sh2.collider.handle, en: sh2.collider.isEnabled(), t: sh2.collider.translation() }) : "none");
  const hit = w.castRay(new R.Ray({ x: 0, y: 0.8, z: 0.2 }, { x: 0, y: 0, z: -1 }), 5, true, undefined, undefined, undefined, (server as any).characters.get("me").body ?? undefined);
  if (hit) {
    const c = hit.collider;
    const h = c.handle;
    const s = server as any;
    console.log("hit toi", hit.timeOfImpact ?? hit.toi, "handle", h, "enabled", c.isEnabled(), "prop?", s.propIndexByHandle.get(h), "char?", s.characterIdByHandle.get(h), "static surf?", s.staticSurfaceByHandle.has(h), "parent body type", c.parent()?.bodyType(), "translation", JSON.stringify(c.translation()), "groups", c.collisionGroups());
  } else console.log("no hit");
  const all: unknown[] = [];
  w.forEachCollider((c: any) => all.push([c.handle, c.isEnabled(), JSON.stringify(c.translation()), c.parent()?.bodyType(), c.collisionGroups()]));
  console.log("colliders", JSON.stringify(all));
  expect(at(server).z).toBeLessThan(-3);
});
