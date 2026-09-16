import {
  decodeGateMask,
  gateAxes,
  gateCheckpointPlans,
  hasMotion,
  rotateVec3ByQuat,
  trackSpawn,
  yawQuat,
  type GateOpening,
  type Module,
  type Track,
  type Vec3,
} from "@dont-fall/shared";
import * as THREE from "three";
import { COURSE, courseOf } from "../lib/course.js";

/**
 * The course, drawn (ADR 0068): where a Track starts, the run order of its
 * Checkpoints and where it finishes — in the builder's own visual language.
 *
 * - **Start:** the spawn grid as go-green slots on the Start's deck, an arrow
 *   the way Players face, and a START pill.
 * - **Checkpoint:** the gate's opening filled in brand purple, a numbered
 *   badge above it, and a ring on the floor where a Respawn stands — just in
 *   front of the gate, looked for in the same places the game looks
 *   (`gateCheckpointPlans`) — or a pink NO FLOOR badge when there is nothing
 *   to stand on.
 * - **Finish:** the opening chequered in ink, and a FINISH pill.
 * - **A hoop or an arch that isn't a Checkpoint:** a faint outline, so the
 *   author sees what could become one.
 * - **Run order:** a dashed line Start → 1 → 2 → … → Finish.
 *
 * Everything that belongs to a Segment lives in that Segment's frame and
 * follows its group every frame (like the Motion guide, and for the same
 * reason: a child of the group would stretch its selection box and be
 * picked), so a drag carries its markers along before it commits.
 */
export interface CourseOverlay {
  rebuild: (track: Track, modules: Record<string, Module>, groups: ReadonlyMap<number, THREE.Object3D>) => void;
  /** Once per frame, before rendering: markers follow their Segments. */
  follow: () => void;
  /** Where Segment `index`'s Respawn stands (world), and whether it has anywhere to stand — `undefined` off a Checkpoint. */
  respawnOf: (index: number) => { floor: Vec3 | undefined } | undefined;
  /** The world point on a still Segment's surface under the cursor ray — a respawn spot being picked. */
  pickFloor: (raycaster: THREE.Raycaster) => { index: number; point: Vec3 } | undefined;
  dispose: () => void;
}

/** A disc or shape in the XY plane, laid flat facing up. */
const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
/** `FLAT` in a frame turned by `worldQuaternion` — flat on the world floor, whatever the Segment's tilt. */
const flatIn = (worldQuaternion: THREE.Quaternion): THREE.Quaternion => worldQuaternion.clone().invert().multiply(FLAT);

/** Screen-constant label height, as a fraction of the viewport's height. */
const LABEL_HEIGHT = 0.046;
const RENDER_ORDER = 950;

type LabelSpec =
  | { kind: "pill"; text: string; fill: string; ink: string; checker?: boolean }
  | { kind: "badge"; text: string; fill: string; ink: string };

/** A label drawn the way the kit draws a chip: a plastic fill over a zero-blur bevel, Nunito 900 or a Fredoka numeral. */
const drawLabel = (canvas: HTMLCanvasElement, spec: LabelSpec): void => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const scale = 2;
  const height = 64;
  const bevel = 5;
  ctx.font = spec.kind === "badge" ? "700 40px Fredoka, system-ui, sans-serif" : "900 26px Nunito, system-ui, sans-serif";
  const textWidth = ctx.measureText(spec.text).width;
  const width = spec.kind === "badge" ? height : Math.ceil(textWidth + 44 + (spec.checker ? 34 : 0));
  canvas.width = (width + 8) * scale;
  canvas.height = (height + bevel + 8) * scale;
  ctx.setTransform(scale, 0, 0, scale, 4 * scale, 4 * scale);
  const radius = height / 2;
  const shape = (y: number): void => {
    ctx.beginPath();
    ctx.roundRect(0, y, width, height, radius);
  };
  // Bevel: offset, never blurred, never upward.
  ctx.fillStyle = "rgba(43, 27, 77, 0.28)";
  shape(bevel);
  ctx.fill();
  ctx.fillStyle = spec.fill;
  shape(0);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  shape(0);
  ctx.stroke();
  let x = width / 2;
  if (spec.kind === "pill" && spec.checker) {
    const size = 7;
    const left = 20;
    const top = height / 2 - size * 1.5;
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        ctx.fillStyle = (row + col) % 2 === 0 ? "#ffffff" : "rgba(255,255,255,0.18)";
        ctx.fillRect(left + col * size, top + row * size, size, size);
      }
    }
    x = width / 2 + 16;
  }
  ctx.font = spec.kind === "badge" ? "700 40px Fredoka, system-ui, sans-serif" : "900 26px Nunito, system-ui, sans-serif";
  ctx.fillStyle = spec.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(spec.text, x, height / 2 + (spec.kind === "badge" ? 2 : 1));
};

/** The finish chequer, tiled across an opening. */
const checkerTexture = (): THREE.CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = COURSE.finish.hex;
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillRect(32, 32, 32, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};
/** World units one chequer tile (2 × 2 squares) spans. */
const CHECKER_TILE = 0.7;

/** An opening's open cells as merged row runs — its fill — and its boundary edges — its outline — in the Asset frame. */
const openingGeometry = (opening: GateOpening): { fill: THREE.BufferGeometry; outline: THREE.BufferGeometry } => {
  const { u, v } = gateAxes(opening.tilt);
  const open = decodeGateMask(opening.mask, opening.cols * opening.rows);
  const at = (col: number, row: number): Vec3 => ({
    x: opening.origin.x + u.x * col * opening.cell + v.x * row * opening.cell,
    y: opening.origin.y + u.y * col * opening.cell + v.y * row * opening.cell,
    z: opening.origin.z + u.z * col * opening.cell + v.z * row * opening.cell,
  });
  const isOpen = (col: number, row: number): boolean =>
    col >= 0 && row >= 0 && col < opening.cols && row < opening.rows && open[row * opening.cols + col] === 1;

  const positions: number[] = [];
  const uvs: number[] = [];
  const push = (p: Vec3, col: number, row: number): void => {
    positions.push(p.x, p.y, p.z);
    uvs.push((col * opening.cell) / CHECKER_TILE, (row * opening.cell) / CHECKER_TILE);
  };
  for (let row = 0; row < opening.rows; row += 1) {
    let col = 0;
    while (col < opening.cols) {
      if (!isOpen(col, row)) {
        col += 1;
        continue;
      }
      const from = col;
      while (isOpen(col, row)) col += 1;
      const [a, b, c, d] = [at(from, row), at(col, row), at(col, row + 1), at(from, row + 1)];
      for (const [p, pc, pr] of [[a, from, row], [b, col, row], [c, col, row + 1], [a, from, row], [c, col, row + 1], [d, from, row + 1]] as const) {
        push(p, pc, pr);
      }
    }
  }
  const fill = new THREE.BufferGeometry();
  fill.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  fill.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));

  const edges: number[] = [];
  const edge = (p: Vec3, q: Vec3): void => {
    edges.push(p.x, p.y, p.z, q.x, q.y, q.z);
  };
  for (let row = 0; row < opening.rows; row += 1) {
    for (let col = 0; col < opening.cols; col += 1) {
      if (!isOpen(col, row)) continue;
      if (!isOpen(col, row - 1)) edge(at(col, row), at(col + 1, row));
      if (!isOpen(col, row + 1)) edge(at(col, row + 1), at(col + 1, row + 1));
      if (!isOpen(col - 1, row)) edge(at(col, row), at(col, row + 1));
      if (!isOpen(col + 1, row)) edge(at(col + 1, row), at(col + 1, row + 1));
    }
  }
  const outline = new THREE.BufferGeometry();
  outline.setAttribute("position", new THREE.Float32BufferAttribute(edges, 3));

  return { fill, outline };
};

export const createCourseOverlay = (scene: THREE.Scene): CourseOverlay => {
  const root = new THREE.Group();
  root.name = "course";
  scene.add(root);

  /** Everything this overlay allocated since the last rebuild, freed on the next. */
  let owned: { dispose: () => void }[] = [];
  const own = <T extends { dispose: () => void }>(thing: T): T => {
    owned.push(thing);
    return thing;
  };
  const labels: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; spec: LabelSpec }[] = [];
  const checker = checkerTexture();

  /** Markers riding a Segment: its group's world matrix, its scale (labels stay screen-sized). */
  let followers: { group: THREE.Object3D; frame: THREE.Group; sprites: THREE.Sprite[] }[] = [];
  let route: { line: THREE.Line; anchors: { frame: THREE.Group; local: THREE.Vector3 }[] } | undefined;
  let respawns = new Map<number, { floor: Vec3 | undefined }>();
  let stillGroups: { index: number; group: THREE.Object3D }[] = [];

  const label = (spec: LabelSpec): THREE.Sprite => {
    const canvas = document.createElement("canvas");
    drawLabel(canvas, spec);
    const texture = own(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    labels.push({ canvas, texture, spec });
    const material = own(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = RENDER_ORDER + 2;
    sprite.userData.aspect = canvas.width / canvas.height;
    return sprite;
  };

  // Web fonts land after the first draw: redraw every label in its real face.
  void (typeof document !== "undefined" ? document.fonts?.ready : undefined)?.then(() => {
    for (const entry of labels) {
      drawLabel(entry.canvas, entry.spec);
      entry.texture.needsUpdate = true;
    }
  });

  const clear = (): void => {
    root.clear();
    for (const thing of owned) thing.dispose();
    owned = [];
    labels.length = 0;
    followers = [];
    route = undefined;
    respawns = new Map();
  };

  /** The floor straight below `from` (world), the gate's own collision and moving Segments aside. */
  const floorBelow = (from: Vec3, except: THREE.Object3D): Vec3 | undefined => {
    const ray = new THREE.Raycaster(new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(0, -1, 0), 0, 50);
    const candidates = stillGroups.filter((entry) => entry.group !== except).map((entry) => entry.group);
    const hit = ray.intersectObjects(candidates, true).find((h) => (h.object as THREE.Mesh).isMesh);
    return hit ? { x: hit.point.x, y: hit.point.y, z: hit.point.z } : undefined;
  };

  return {
    rebuild(track, modules, groups) {
      clear();
      const summary = courseOf(track, modules);
      const plans = new Map(gateCheckpointPlans(track, modules).map((plan) => [plan.segmentIndex, plan]));
      for (const group of groups.values()) group.updateWorldMatrix(true, true);
      stillGroups = [...groups.entries()]
        .filter(([index]) => track[index] && !hasMotion(track[index]!.motion))
        .map(([index, group]) => ({ index, group }));
      const routeAnchors: { frame: THREE.Group; local: THREE.Vector3 }[] = [];

      const frameFor = (group: THREE.Object3D): { frame: THREE.Group; sprites: THREE.Sprite[] } => {
        const existing = followers.find((f) => f.group === group);
        if (existing) return existing;
        const frame = new THREE.Group();
        frame.matrixAutoUpdate = false;
        root.add(frame);
        const follower = { group, frame, sprites: [] as THREE.Sprite[] };
        followers.push(follower);
        return follower;
      };

      // ---- Start ----
      if (summary.start !== undefined && groups.get(summary.start)) {
        const segment = track[summary.start]!;
        const group = groups.get(summary.start)!;
        const follower = frameFor(group);
        const top = new THREE.Box3().setFromObject(group).max.y;
        const slotGeometry = own(new THREE.CircleGeometry(0.26, 28));
        const slotMaterial = own(new THREE.MeshBasicMaterial({ color: COURSE.start.hex, transparent: true, opacity: 0.6, depthWrite: false }));
        const ringGeometry = own(new THREE.RingGeometry(0.26, 0.34, 28));
        const ringMaterial = own(new THREE.MeshBasicMaterial({ color: COURSE.start.inkHex, transparent: true, opacity: 0.55, depthWrite: false }));
        const local = (world: Vec3): THREE.Vector3 => group.worldToLocal(new THREE.Vector3(world.x, world.y, world.z));
        let centre = new THREE.Vector3();
        for (let slot = 0; slot < 12; slot += 1) {
          const spot = trackSpawn(track, slot, modules);
          const at = local({ x: spot.x, y: top + 0.03, z: spot.z });
          centre.add(at);
          for (const [geometry, material] of [[slotGeometry, slotMaterial], [ringGeometry, ringMaterial]] as const) {
            const disc = new THREE.Mesh(geometry, material);
            disc.position.copy(at);
            disc.quaternion.copy(flatIn(group.getWorldQuaternion(new THREE.Quaternion())));
            disc.renderOrder = RENDER_ORDER;
            follower.frame.add(disc);
          }
        }
        centre = centre.multiplyScalar(1 / 12);
        // The way Players face: a chevron ahead of the front row.
        const forward = rotateVec3ByQuat({ x: 0, y: 0, z: -1 }, yawQuat(segment.rotation));
        const [frontLeft, frontRight] = [trackSpawn(track, 0, modules), trackSpawn(track, 3, modules)];
        const arrowWorld = {
          x: (frontLeft.x + frontRight.x) / 2 + forward.x * 1.1,
          y: top + 0.04,
          z: (frontLeft.z + frontRight.z) / 2 + forward.z * 1.1,
        };
        const chevron = new THREE.Shape();
        chevron.moveTo(0, 0.55);
        chevron.lineTo(0.55, 0);
        chevron.lineTo(0.3, 0);
        chevron.lineTo(0, 0.3);
        chevron.lineTo(-0.3, 0);
        chevron.lineTo(-0.55, 0);
        chevron.closePath();
        const arrow = new THREE.Mesh(own(new THREE.ShapeGeometry(chevron)), slotMaterial);
        // Shape +Y laid flat points −Z; the Start's yaw turns it along the Start's forward.
        arrow.quaternion
          .copy(group.getWorldQuaternion(new THREE.Quaternion()).invert())
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), segment.rotation))
          .multiply(FLAT);
        arrow.position.copy(local(arrowWorld));
        arrow.renderOrder = RENDER_ORDER;
        follower.frame.add(arrow);

        const pill = label({ kind: "pill", text: `${COURSE.start.glyph}  ${COURSE.start.word}`, fill: COURSE.start.hex, ink: COURSE.start.inkHex });
        // Straight up from the grid's centre in world terms, whatever the Segment's tilt.
        const centreWorld = centre.clone().applyMatrix4(group.matrixWorld);
        pill.position.copy(group.worldToLocal(centreWorld.add(new THREE.Vector3(0, 1.9, 0))));
        follower.frame.add(pill);
        follower.sprites.push(pill);
        routeAnchors.push({ frame: follower.frame, local: centre.clone() });
      }

      // ---- Gates ----
      const gateMarkers = (index: number, kind: "checkpoint" | "finish" | "idle", order?: number): void => {
        const segment = track[index]!;
        const module = modules[segment.moduleId];
        const group = groups.get(index);
        if (!module?.gate || !group) return;
        const follower = frameFor(group);
        const { fill, outline } = openingGeometry(module.gate.opening);
        own(fill);
        own(outline);
        if (kind !== "idle") {
          const material = own(
            kind === "finish"
              ? new THREE.MeshBasicMaterial({ map: checker, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false })
              : new THREE.MeshBasicMaterial({ color: COURSE.checkpoint.hex, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
          );
          const mesh = new THREE.Mesh(fill, material);
          mesh.renderOrder = RENDER_ORDER;
          follower.frame.add(mesh);
        }
        const lines = new THREE.LineSegments(
          outline,
          own(
            new THREE.LineBasicMaterial({
              color: kind === "finish" ? COURSE.finish.hex : kind === "checkpoint" ? COURSE.checkpoint.hex : COURSE.idle.hex,
              transparent: true,
              opacity: kind === "idle" ? 0.28 : 0.95,
              depthWrite: false,
            }),
          ),
        );
        lines.renderOrder = RENDER_ORDER + 1;
        follower.frame.add(lines);
        const centre = new THREE.Vector3(module.gate.opening.center.x, module.gate.opening.center.y, module.gate.opening.center.z);
        if (kind === "idle") return;

        // Over the whole gate, not inside its beam: the footprint's top, above the opening's centre.
        const bounds = module.footprint.bounds;
        const anchor = new THREE.Vector3(centre.x, bounds.center.y + bounds.halfExtents.y + 0.35, centre.z);
        if (kind === "finish") {
          const pill = label({ kind: "pill", text: COURSE.finish.word, fill: COURSE.finish.hex, ink: COURSE.finish.inkHex, checker: true });
          pill.position.copy(anchor);
          follower.frame.add(pill);
          follower.sprites.push(pill);
          routeAnchors.push({ frame: follower.frame, local: centre });
          return;
        }

        routeAnchors.push({ frame: follower.frame, local: centre });
        const plan = plans.get(index);
        let floor = plan?.respawn;
        for (const probe of plan?.probes ?? []) floor ??= floorBelow(probe, group);
        respawns.set(index, { floor });

        const badge = label(
          floor
            ? { kind: "badge", text: String(order), fill: COURSE.checkpoint.hex, ink: COURSE.checkpoint.inkHex }
            : { kind: "pill", text: `${order} · NO FLOOR`, fill: COURSE.problem.hex, ink: COURSE.problem.inkHex },
        );
        badge.position.copy(anchor);
        follower.frame.add(badge);
        follower.sprites.push(badge);
        if (!floor) return;

        // The Respawn: a ring on the floor, tied to its gate by a dashed drop line.
        const local = group.worldToLocal(new THREE.Vector3(floor.x, floor.y + 0.04, floor.z));
        const flat = flatIn(group.getWorldQuaternion(new THREE.Quaternion()));
        const ring = new THREE.Mesh(
          own(new THREE.RingGeometry(0.34, 0.5, 36)),
          own(new THREE.MeshBasicMaterial({ color: COURSE.checkpoint.hex, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })),
        );
        ring.position.copy(local);
        ring.quaternion.copy(flat);
        ring.renderOrder = RENDER_ORDER;
        const dot = new THREE.Mesh(
          own(new THREE.CircleGeometry(0.34, 36)),
          own(new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide })),
        );
        dot.position.copy(local);
        dot.quaternion.copy(flat);
        dot.renderOrder = RENDER_ORDER;
        const drop = new THREE.Line(
          own(new THREE.BufferGeometry().setFromPoints([centre, local])),
          own(new THREE.LineDashedMaterial({ color: COURSE.checkpoint.hex, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.7, depthWrite: false })),
        );
        drop.computeLineDistances();
        drop.renderOrder = RENDER_ORDER;
        follower.frame.add(dot, ring, drop);
      };

      for (const { index, order } of summary.checkpoints) gateMarkers(index, "checkpoint", order);
      for (const index of summary.finishes) gateMarkers(index, "finish");
      track.forEach((segment, index) => {
        if (modules[segment.moduleId]?.gate?.role === "checkpoint" && !segment.checkpoint) gateMarkers(index, "idle");
      });

      // ---- Run order ----
      if (routeAnchors.length >= 2) {
        const geometry = own(new THREE.BufferGeometry());
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(routeAnchors.length * 3), 3));
        const line = new THREE.Line(
          geometry,
          own(new THREE.LineDashedMaterial({ color: COURSE.checkpoint.hex, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.55, depthWrite: false })),
        );
        line.renderOrder = RENDER_ORDER - 1;
        line.frustumCulled = false;
        root.add(line);
        route = { line, anchors: routeAnchors };
      }
      this.follow();
    },

    follow() {
      for (const { group, frame, sprites } of followers) {
        group.updateWorldMatrix(true, false);
        frame.matrix.copy(group.matrixWorld);
        frame.matrixWorldNeedsUpdate = true;
        const scale = group.matrixWorld.getMaxScaleOnAxis() || 1;
        for (const sprite of sprites) sprite.scale.set((LABEL_HEIGHT * (sprite.userData.aspect as number)) / scale, LABEL_HEIGHT / scale, 1);
      }
      if (route) {
        const attribute = route.line.geometry.getAttribute("position") as THREE.BufferAttribute;
        route.anchors.forEach(({ frame, local }, i) => {
          const world = local.clone().applyMatrix4(frame.matrix);
          attribute.setXYZ(i, world.x, world.y, world.z);
        });
        attribute.needsUpdate = true;
        route.line.computeLineDistances();
      }
    },

    respawnOf: (index) => respawns.get(index),

    pickFloor(raycaster) {
      const hit = raycaster
        .intersectObjects(stillGroups.map((entry) => entry.group), true)
        .find((h) => (h.object as THREE.Mesh).isMesh);
      if (!hit) return undefined;
      let node: THREE.Object3D | null = hit.object;
      while (node && typeof node.userData.segmentIndex !== "number") node = node.parent;
      if (!node) return undefined;
      return { index: node.userData.segmentIndex as number, point: { x: hit.point.x, y: hit.point.y, z: hit.point.z } };
    },

    dispose() {
      clear();
      checker.dispose();
      scene.remove(root);
    },
  };
};
