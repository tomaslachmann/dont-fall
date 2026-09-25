// HAND-AUTHORED (ADR 0126), from `pnpm convert:bomb`'s printed footprints.
// The game's only bombs: `BLIP_Bombs_v1`'s two animated drops, recoloured
// black. Two files are not a pack, so, like `dfAssetDefs.ts`, the converter
// prints these numbers and never writes here.
import { BOMB_FUSE_SECONDS, BOMB_RETURN_SECONDS, BOMB_WARN_SECONDS } from "../tuning/fight.js";
import type { AssetModuleDef } from "./assetModules.js";
import type { BombDef } from "./Bomb.js";

/** What every bomb Asset does unless its placed Segment says otherwise. */
const BOMB: BombDef = {
  fuseSeconds: BOMB_FUSE_SECONDS,
  warnSeconds: BOMB_WARN_SECONDS,
  returnSeconds: BOMB_RETURN_SECONDS,
};

const footprint = {
  bounds: { center: { x: 0, y: 0.504, z: 0 }, halfExtents: { x: 0.4, y: 0.504, z: 0.4 } },
  clearance: 0.5,
};

export const BOMB_MODULE_DEFS: AssetModuleDef[] = [
  { id: "bomb_A", category: "prop", footprint, sockets: [], bomb: BOMB },
  { id: "bomb_B", category: "prop", footprint, sockets: [], bomb: BOMB },
];
