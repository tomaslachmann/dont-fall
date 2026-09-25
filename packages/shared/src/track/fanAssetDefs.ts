// HAND-AUTHORED (ADR 0075, amended 2026-09-16): the Meshy fan
// (`assets/Meshy_fan/fan_lower_poly.glb`) as `scripts/convert-fan.ts` converts
// it. The rotor is split out to spin, the mesh simplified to about 32k tris,
// with a box collision proxy, seated on the pivot. The converter prints the
// footprint below; it never writes this file. `convert-kaykit` and
// `convert-imagetostl` only ever write their own prefixed stems, so neither
// emits or skips this id.
import type { AssetModuleDef } from "./assetModules.js";

export const FAN_MODULE_DEFS: AssetModuleDef[] = [
  {
    id: "fan",
    category: "launcher",
    footprint: {
      bounds: { center: { x: 0, y: 0.5899, z: 0 }, halfExtents: { x: 0.9494, y: 0.5899, z: 0.9497 } },
      clearance: 0.5,
    },
    sockets: [],
    volumes: [
      {
        // The procedural deck's proven field, re-seated: its foot is the
        // head's own top (1.1798), and it stands wider than the 1.9-wide box.
        // Brushing the fan catches air, exactly like the old deck's field
        // stood wider than its 2×4 boards.
        bounds: { center: { x: 0, y: 4.1798, z: 0 }, halfExtents: { x: 1.5, y: 3, z: 1.5 } },
        force: { x: 0, y: 40, z: 0 },
        maxInducedSpeed: 10,
        priority: 1,
      },
    ],
  },
];
