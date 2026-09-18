import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { addVec3, rotateVec3ByQuat, scaleVec3 } from "../math/vec3.js";
import { ASSET_MODULE_DEFS, loadAssetLibrary } from "./assetModules.js";
import { disc, spin } from "./authoring.js";
import { applyMotionPose, motionPose } from "./Motion.js";
import { segmentOrientation, segmentScale } from "./Track.js";

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");

describe("disc", () => {
  it("lays a round deck about its centre, and a spin turns all eight pieces about that centre as one", async () => {
    const segments = disc(3, 4, 5, 6, { motion: spin(1.3) });
    const ids = new Set(segments.map((segment) => segment.moduleId));
    const library = await loadAssetLibrary(
      async (url) => new Uint8Array(readFileSync(join(assetsRoot, url.slice(url.lastIndexOf("/") + 1)))),
      "",
      ASSET_MODULE_DEFS.filter((def) => ids.has(def.id)),
    );
    // Each piece is centred on its own square now, so this is the offset and
    // the moved pivot doing the work the arc-centred files used to: at rest
    // and part-way round, every point stays inside the circle, and the ring
    // still reaches its full radius on every side.
    for (const tick of [0, 23]) {
      const points = segments.flatMap((segment) =>
        library[segment.moduleId]!.asset!.meshes.flatMap((mesh) =>
          mesh.positions.map((p) =>
            addVec3(
              segment.position,
              rotateVec3ByQuat(scaleVec3(applyMotionPose(motionPose(segment.motion!, tick), p), segmentScale(segment)), segmentOrientation(segment)),
            ),
          ),
        ),
      );
      const radii = points.map((p) => Math.hypot(p.x - 3, p.z + 5));
      expect(Math.max(...radii)).toBeCloseTo(6, 2);
      expect(Math.max(...points.map((p) => p.y))).toBeCloseTo(4, 6);
      for (const [axis, sign] of [["x", 1], ["x", -1], ["z", 1], ["z", -1]] as const) {
        const reach = Math.max(...points.map((p) => sign * (axis === "x" ? p.x - 3 : p.z + 5)));
        expect(reach, `${axis}${sign > 0 ? "+" : "-"} at tick ${tick}`).toBeGreaterThan(5.9);
      }
    }
  });
});
