import type { Box } from "../math/box.js";
import type { Quat, Vec3 } from "../math/vec3.js";
import { ASSET_FOOTPRINT_EPSILON, ASSET_VISUAL_WARN } from "../tuning.js";
import { SURFACES, type SurfaceId } from "./Surface.js";

/**
 * One authored Asset read through (M8 ticket 01, ADR 0050) — the single
 * function the server and the predicting client both turn a Module's bytes
 * into geometry with, so two Players never simulate different Tracks.
 *
 * GLB only (what Blender exports, what `assets/` holds) — never three.js,
 * which must not leak into shared. Only what collision and validation need
 * is read: node roles and transforms, POSITION vertices, indices. Normals,
 * UVs and materials are the visual loader's own business (ticket 03).
 */

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;

const FLOAT = 5126;
const UBYTE = 5121;
const USHORT = 5123;
const UINT = 5125;

/** One role-marked node's baked triangles, exactly as authored (transforms applied). */
export interface AssetMeshData {
  positions: Vec3[];
  indices: number[];
  /** Raw `surface` extra, unresolved — `validateAssetModule` owns the `node ?? Module ?? "default"` chain (ADR 0036). */
  surface?: string;
}

/**
 * A solid collision shape (ADR 0065): what a Moving Segment collides as,
 * instead of its hollow collision trimesh. Primitives are centred on their
 * part's position and turned by its rotation — a capsule or cylinder runs
 * along its local Y; a hull's points are already in the Asset's frame.
 */
export type SolidShape =
  | { type: "ball"; radius: number }
  | { type: "capsule"; halfHeight: number; radius: number }
  | { type: "cylinder"; halfHeight: number; radius: number }
  | { type: "box"; halfExtents: Vec3 }
  | { type: "hull"; points: Vec3[] };

export interface SolidPart {
  shape: SolidShape;
  position: Vec3;
  rotation: Quat;
  /** Raw `surface` extra, unresolved — like {@link AssetMeshData.surface}. */
  surface?: string;
}

export interface AssetModel {
  collision: AssetMeshData[];
  visual: AssetMeshData[];
  /** Mesh-less `role: "solid"` nodes (ADR 0065) — empty for an Asset converted before them. */
  solid: SolidPart[];
}

type GltfJson = {
  scenes?: { nodes?: number[] }[];
  scene?: number;
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  images?: { uri?: string; mimeType?: string; bufferView?: number }[];
};

/** The JSON-chunk fields the twin tests probe without parsing triangles. */
export interface GlbJsonProbe {
  images?: { uri?: string; mimeType?: string; bufferView?: number }[];
  nodes?: { mesh?: number; extras?: { role?: unknown } }[];
}

type GltfNode = {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  matrix?: number[];
  extras?: { role?: unknown; surface?: unknown; shape?: unknown };
};

type GltfMesh = {
  primitives?: { attributes?: { POSITION?: number }; indices?: number }[];
};

type GltfAccessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
  count?: number;
  type?: string;
  sparse?: unknown;
};

type GltfBufferView = {
  buffer?: number;
  byteOffset?: number;
  byteLength?: number;
  byteStride?: number;
};

// A function declaration, not an arrow const: only the former's
// never-return terminates control flow at the guard sites below (the arrow
// form compiles but narrows nothing under this toolchain — verified).
function fail(detail: string): never {
  throw new Error(`asset: ${detail}`);
}

/** Column-major 4x4 multiply: out = a * b. */
const mulMat4 = (a: number[], b: number[]): number[] => {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        a[row]! * b[col * 4]! + a[4 + row]! * b[col * 4 + 1]! + a[8 + row]! * b[col * 4 + 2]! + a[12 + row]! * b[col * 4 + 3]!;
    }
  }
  return out;
};

/** TRS compose (glTF order: M = T * R * S), column-major. */
const trsMatrix = (translation: [number, number, number], rotation: [number, number, number, number], scale: [number, number, number]): number[] => {
  const [x, y, z, w] = rotation;
  const [sx, sy, sz] = scale;
  // Rotation submatrix from the quaternion, columns scaled — the standard
  // quat-to-matrix with each column multiplied by its axis scale.
  const r00 = (1 - 2 * (y * y + z * z)) * sx;
  const r10 = 2 * (x * y + z * w) * sx;
  const r20 = 2 * (x * z - y * w) * sx;
  const r01 = 2 * (x * y - z * w) * sy;
  const r11 = (1 - 2 * (x * x + z * z)) * sy;
  const r21 = 2 * (y * z + x * w) * sy;
  const r02 = 2 * (x * z + y * w) * sz;
  const r12 = 2 * (y * z - x * w) * sz;
  const r22 = (1 - 2 * (x * x + y * y)) * sz;
  const [tx, ty, tz] = translation;
  return [r00, r10, r20, 0, r01, r11, r21, 0, r02, r12, r22, 0, tx, ty, tz, 1];
};

const IDENTITY_MAT4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Which half of the Asset a meshed node is (M9 asset drop): `extras.role` is
 * the authoritative marker (ADR 0050, and what M8's four files carry), with
 * the **node name** read as a fallback when the extra is absent entirely.
 *
 * The fallback exists because a Blender custom property is easy to lose — it
 * doesn't survive a duplicate-and-rename, an object join, or a library
 * override — while the name is right there in the outliner. It matches on
 * whole words, not substrings, so every spelling one authoring pass to the
 * next has produced reads the same: `Track_Straight_1x1_Collision`,
 * `CollisionMesh`, `collision_mesh`, `Mesh-Visual`. Separators and camelCase
 * both split.
 *
 * Deliberately narrow in three ways: `extras.role` always wins where it is
 * present (so no existing file changes meaning), an *explicit but
 * unrecognized* role fails rather than falling through to the name (a typo
 * is an authoring error, not a reason to guess), and a name carrying **both**
 * words — or neither — fails too. A mesh is in or out of the world; it is
 * never included on a coin flip.
 */
const nodeRole = (extrasRole: unknown, name: string): "collision" | "visual" | null => {
  if (extrasRole === "collision" || extrasRole === "visual") return extrasRole;
  if (extrasRole !== undefined) return null;
  const words = new Set(
    name
      // camelCase/PascalCase boundaries first, then every non-alphanumeric run.
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/[^A-Za-z0-9]+/)
      .map((word) => word.toLowerCase()),
  );
  const isCollision = words.has("collision");
  const isVisual = words.has("visual");
  if (isCollision === isVisual) return null; // both, or neither — ambiguous either way
  return isCollision ? "collision" : "visual";
};

const applyMat4 = (m: number[], p: Vec3): Vec3 => ({
  x: m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!,
  y: m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!,
  z: m[2]! * p.x + m[6]! * p.y + m[10]! * p.z + m[14]!,
});

const indexByteSize = (componentType: number): number => {
  if (componentType === UBYTE) return 1;
  if (componentType === USHORT) return 2;
  if (componentType === UINT) return 4;
  fail(`unsupported index componentType ${componentType}`);
};

const readIndex = (view: DataView, offset: number, componentType: number): number => {
  if (componentType === UBYTE) return view.getUint8(offset);
  if (componentType === USHORT) return view.getUint16(offset, true);
  return view.getUint32(offset, true);
};

/**
 * Parse one Asset's bytes into per-role baked triangles (M8 ticket 01).
 * Throws a readable error on anything malformed — non-GLB input, a meshed
 * node with no recognized `role`, missing POSITION data — so a bad file
 * fails the load identically on every caller instead of simulating wrong
 * somewhere. The stray `collision` extra some exporters set is ignored;
 * only `role` decides.
 */
const splitGlb = (bytes: Uint8Array): { json: GltfJson; bin: Uint8Array | null } => {
  if (bytes.length < 12) fail("not a GLB file (too short for a header)");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  if (header.getUint32(0, true) !== GLB_MAGIC) fail("not a GLB file (bad magic — separate .gltf + .bin is not supported)");
  if (header.getUint32(4, true) !== GLB_VERSION) fail(`unsupported GLB version ${header.getUint32(4, true)} (expected 2)`);

  let cursor = 12;
  if (cursor + 8 > bytes.length) fail("truncated GLB chunk header");
  const jsonLength = header.getUint32(cursor, true);
  if (header.getUint32(cursor + 4, true) !== JSON_CHUNK_TYPE) fail("GLB JSON chunk must come first");
  cursor += 8;
  if (cursor + jsonLength > bytes.length) fail("truncated GLB JSON chunk");
  let json: GltfJson;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(cursor, cursor + jsonLength))) as GltfJson;
  } catch {
    fail("GLB JSON chunk is not valid JSON");
  }
  cursor += jsonLength;

  // The BIN chunk is optional in general but every POSITION/index accessor
  // below reads buffer 0 through it — a file whose accessors reference a
  // missing BIN fails there, naming the accessor.
  let bin: Uint8Array | null = null;
  if (cursor + 8 <= bytes.length) {
    const binLength = header.getUint32(cursor, true);
    if (header.getUint32(cursor + 4, true) !== BIN_CHUNK_TYPE) fail("unsupported GLB chunk type");
    cursor += 8;
    if (cursor + binLength > bytes.length) fail("truncated GLB BIN chunk");
    bin = bytes.subarray(cursor, cursor + binLength);
  }
  return { json, bin };
};

/**
 * The GLB's raw JSON chunk, for checks the triangle reader doesn't cover:
 * the twin role-filter tests split textured from untextured files on
 * `images`, because `GLTFLoader` decodes images through browser-only
 * globals and can never parse those in Node. Same chunk walk as the
 * reader — one implementation, two callers.
 */
export const readGlbJson = (bytes: Uint8Array): GlbJsonProbe => splitGlb(bytes).json;

export const readAssetModel = (bytes: Uint8Array): AssetModel => {
  const { json, bin } = splitGlb(bytes);

  const scenes = json.scenes;
  if (!scenes || scenes.length === 0) fail("no scenes to read nodes from");
  const scene = scenes[json.scene ?? 0];
  if (!scene) fail(`scene ${json.scene ?? 0} does not exist`);
  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const accessors = json.accessors ?? [];
  const bufferViews = json.bufferViews ?? [];

  const readBytes = (bufferViewIndex: number, accessorIndex: number): DataView => {
    const bufferView = bufferViews[bufferViewIndex];
    if (!bufferView) fail(`accessor ${accessorIndex} references missing bufferView ${bufferViewIndex}`);
    if ((bufferView.buffer ?? 0) !== 0) fail(`accessor ${accessorIndex} reads a non-BIN buffer (only GLB-embedded data is supported)`);
    if (!bin) fail(`accessor ${accessorIndex} needs the GLB BIN chunk, which is absent`);
    const base = bufferView.byteOffset ?? 0;
    const length = bufferView.byteLength ?? 0;
    if (base + length > bin.length) fail(`accessor ${accessorIndex} reads past the end of the BIN chunk`);
    return new DataView(bin.buffer, bin.byteOffset + base, length);
  };

  const readPositions = (accessorIndex: number, nodeName: string): Vec3[] => {
    const accessor = accessors[accessorIndex];
    if (!accessor) fail(`node "${nodeName}" references missing accessor ${accessorIndex}`);
    if (accessor.sparse !== undefined) fail(`node "${nodeName}" uses a sparse accessor (not supported)`);
    if (accessor.componentType !== FLOAT || accessor.type !== "VEC3") {
      fail(`node "${nodeName}" POSITION must be float VEC3 (got ${accessor.componentType}/${accessor.type})`);
    }
    const count = accessor.count ?? 0;
    const bufferViewIndex = accessor.bufferView;
    if (bufferViewIndex === undefined) fail(`node "${nodeName}" POSITION accessor has no bufferView`);
    const bufferView = bufferViews[bufferViewIndex];
    if (!bufferView) fail(`node "${nodeName}" POSITION references missing bufferView ${bufferViewIndex}`);
    const view = readBytes(bufferViewIndex, accessorIndex);
    const stride = bufferView.byteStride ?? 12;
    if (stride < 12) fail(`node "${nodeName}" POSITION stride ${stride} is narrower than a float vec3`);
    const needed = (accessor.byteOffset ?? 0) + (count === 0 ? 0 : (count - 1) * stride + 12);
    if (needed > view.byteLength) fail(`node "${nodeName}" POSITION reads past its bufferView`);
    const positions: Vec3[] = [];
    for (let i = 0; i < count; i += 1) {
      const at = (accessor.byteOffset ?? 0) + i * stride;
      positions.push({ x: view.getFloat32(at, true), y: view.getFloat32(at + 4, true), z: view.getFloat32(at + 8, true) });
    }
    return positions;
  };

  const readIndices = (accessorIndex: number, nodeName: string, vertexCount: number): number[] => {
    const accessor = accessors[accessorIndex];
    if (!accessor) fail(`node "${nodeName}" references missing accessor ${accessorIndex}`);
    if (accessor.sparse !== undefined) fail(`node "${nodeName}" uses a sparse accessor (not supported)`);
    if (accessor.type !== "SCALAR") fail(`node "${nodeName}" indices must be SCALAR (got ${accessor.type})`);
    const componentType = accessor.componentType ?? 0;
    const size = indexByteSize(componentType);
    const count = accessor.count ?? 0;
    const bufferViewIndex = accessor.bufferView;
    if (bufferViewIndex === undefined) fail(`node "${nodeName}" indices accessor has no bufferView`);
    const view = readBytes(bufferViewIndex, accessorIndex);
    const needed = (accessor.byteOffset ?? 0) + count * size;
    if (needed > view.byteLength) fail(`node "${nodeName}" indices read past their bufferView`);
    const indices: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const index = readIndex(view, (accessor.byteOffset ?? 0) + i * size, componentType);
      if (index >= vertexCount) fail(`node "${nodeName}" index ${index} exceeds ${vertexCount} vertices`);
      indices.push(index);
    }
    return indices;
  };

  const model: AssetModel = { collision: [], visual: [], solid: [] };
  const visit = (nodeIndex: number, parentMatrix: number[]): void => {
    const node = nodes[nodeIndex];
    if (!node) fail(`node ${nodeIndex} does not exist`);
    const name = node.name ?? `node${nodeIndex}`;
    const local = node.matrix ?? trsMatrix(node.translation ?? [0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1]);
    const world = mulMat4(parentMatrix, local);
    if (node.extras?.role === "solid") {
      if (node.mesh !== undefined) fail(`node "${name}" is role "solid" but carries a mesh — a solid part is its shape extra alone`);
      const surfaceRaw = node.extras.surface;
      if (surfaceRaw !== undefined && typeof surfaceRaw !== "string") fail(`node "${name}" surface extra must be a string`);
      model.solid.push({
        shape: parseSolidShape(node.extras.shape, name),
        position: { x: world[12]!, y: world[13]!, z: world[14]! },
        rotation: rotationOf(world),
        ...(surfaceRaw !== undefined ? { surface: surfaceRaw } : {}),
      });
    } else if (node.mesh !== undefined) {
      const role = nodeRole(node.extras?.role, name);
      const target = role === "collision" ? model.collision : role === "visual" ? model.visual : null;
      if (!target) {
        fail(`node "${name}" has a mesh but no recognized role — set extras.role to "collision"/"visual", or suffix the node name "_Collision"/"_Visual"`);
      }
      const mesh = meshes[node.mesh];
      if (!mesh) fail(`node "${name}" references missing mesh ${node.mesh}`);
      const surfaceRaw = node.extras?.surface;
      if (surfaceRaw !== undefined && typeof surfaceRaw !== "string") {
        fail(`node "${name}" surface extra must be a string (got ${typeof surfaceRaw})`);
      }
      const positions: Vec3[] = [];
      const indices: number[] = [];
      for (const prim of mesh.primitives ?? []) {
        if (prim.attributes?.POSITION === undefined) fail(`node "${name}" has a primitive without POSITION data`);
        const base = positions.length;
        for (const p of readPositions(prim.attributes.POSITION, name)) positions.push(applyMat4(world, p));
        if (prim.indices === undefined) {
          for (let i = 0; i < positions.length - base; i += 1) indices.push(base + i);
        } else {
          for (const index of readIndices(prim.indices, name, positions.length)) indices.push(index);
        }
      }
      target.push({ positions, indices, ...(surfaceRaw !== undefined ? { surface: surfaceRaw } : {}) });
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of scene.nodes ?? []) visit(root, IDENTITY_MAT4);
  return model;
};

const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A `role: "solid"` node's `shape` extra, checked field by field — a bad one fails the load on every side alike. */
const parseSolidShape = (raw: unknown, name: string): SolidShape => {
  if (typeof raw !== "object" || raw === null) fail(`solid node "${name}" has no shape extra`);
  const shape = raw as Record<string, unknown>;
  const positive = (key: string): number => {
    const value = shape[key];
    if (!finiteNumber(value) || value <= 0) fail(`solid node "${name}" ${String(shape.type)} needs a positive ${key}`);
    return value;
  };
  switch (shape.type) {
    case "ball":
      return { type: "ball", radius: positive("radius") };
    case "capsule":
      return { type: "capsule", halfHeight: positive("halfHeight"), radius: positive("radius") };
    case "cylinder":
      return { type: "cylinder", halfHeight: positive("halfHeight"), radius: positive("radius") };
    case "box": {
      const h = shape.halfExtents;
      if (!Array.isArray(h) || h.length !== 3 || !h.every((v) => finiteNumber(v) && v > 0)) {
        fail(`solid node "${name}" box needs three positive halfExtents`);
      }
      return { type: "box", halfExtents: { x: h[0] as number, y: h[1] as number, z: h[2] as number } };
    }
    case "hull": {
      const flat = shape.points;
      if (!Array.isArray(flat) || flat.length < 12 || flat.length % 3 !== 0 || !flat.every(finiteNumber)) {
        fail(`solid node "${name}" hull needs at least four finite x,y,z points`);
      }
      const points: Vec3[] = [];
      for (let i = 0; i < flat.length; i += 3) points.push({ x: flat[i] as number, y: flat[i + 1] as number, z: flat[i + 2] as number });
      return { type: "hull", points };
    }
    default:
      fail(`solid node "${name}" has unknown shape type ${JSON.stringify(shape.type)}`);
  }
};

/** The rotation of a rigid (unscaled) column-major transform, as a quaternion. */
const rotationOf = (m: number[]): Quat => {
  const [m00, m10, m20, , m01, m11, m21, , m02, m12, m22] = m as [number, number, number, number, number, number, number, number, number, number, number];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return { w: 0.25 / s, x: (m21 - m12) * s, y: (m02 - m20) * s, z: (m10 - m01) * s };
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return { w: (m21 - m12) / s, x: 0.25 * s, y: (m10 + m01) / s, z: (m02 + m20) / s };
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 - m00 + m11 - m22);
    return { w: (m02 - m20) / s, x: (m10 + m01) / s, y: 0.25 * s, z: (m21 + m12) / s };
  }
  const s = 2 * Math.sqrt(1 - m00 - m11 + m22);
  return { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m21 + m12) / s, z: 0.25 * s };
};

export interface ValidateAssetOptions {
  /** The Module's footprint, in the same local frame the Asset is authored in (origin = Module origin). */
  footprint: Box;
  /** This Module's own Surface id — the middle of the `node ?? Module ?? "default"` chain (ADR 0036). */
  surface?: SurfaceId;
}

export interface ValidatedAssetMesh {
  positions: Vec3[];
  indices: number[];
  surface: SurfaceId;
}

export interface ValidatedSolidPart extends Omit<SolidPart, "surface"> {
  surface: SurfaceId;
}

export interface ValidatedAsset {
  collision: ValidatedAssetMesh[];
  /** Solid parts (ADR 0065) with resolved Surfaces — what a Moving Segment collides as; empty for an older file. */
  solid: ValidatedSolidPart[];
  visual: { positions: Vec3[]; indices: number[] }[];
  /** Dev warnings (visual escaping collision) — returned, never thrown or logged: the caller decides where they surface. */
  warnings: string[];
}

type Bounds = { min: Vec3; max: Vec3 };

const unionBounds = (meshes: { positions: Vec3[] }[]): Bounds => {
  const bounds: Bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  for (const mesh of meshes) {
    if (mesh.positions.length === 0) fail("an asset mesh carries no vertices");
    for (const p of mesh.positions) {
      bounds.min.x = Math.min(bounds.min.x, p.x);
      bounds.min.y = Math.min(bounds.min.y, p.y);
      bounds.min.z = Math.min(bounds.min.z, p.z);
      bounds.max.x = Math.max(bounds.max.x, p.x);
      bounds.max.y = Math.max(bounds.max.y, p.y);
      bounds.max.z = Math.max(bounds.max.z, p.z);
    }
  }
  return bounds;
};

const AXES = ["x", "y", "z"] as const;

/**
 * Validate one parsed Asset for a Module slot (M8 ticket 01): resolve every
 * collision mesh's Surface (unknown ids fail — `SurfaceId` is an open
 * string, so only this loader can catch a typo before it silently plays as
 * default), prove collision fits the footprint past `ASSET_FOOTPRINT_EPSILON`,
 * and report (never throw) visuals escaping collision past
 * `ASSET_VISUAL_WARN`. Deterministic and side-effect-free, so both sides
 * reach the identical verdict — a bad file fails the load everywhere,
 * never simulates differently per side.
 */
export const validateAssetModule = (model: AssetModel, { footprint, surface: moduleSurface }: ValidateAssetOptions): ValidatedAsset => {
  if (model.collision.length === 0) fail("no collision mesh (no node with extras.role \"collision\")");
  if (model.visual.length === 0) fail("no visual mesh (no node with extras.role \"visual\")");

  const collision: ValidatedAssetMesh[] = model.collision.map((mesh, i) => {
    const surface = mesh.surface ?? moduleSurface ?? "default";
    if (!(surface in SURFACES)) fail(`collision mesh ${i} names unknown surface "${surface}"`);
    return { positions: mesh.positions, indices: mesh.indices, surface };
  });

  const collisionBounds = unionBounds(collision);
  const fMin = {
    x: footprint.center.x - footprint.halfExtents.x,
    y: footprint.center.y - footprint.halfExtents.y,
    z: footprint.center.z - footprint.halfExtents.z,
  };
  const fMax = {
    x: footprint.center.x + footprint.halfExtents.x,
    y: footprint.center.y + footprint.halfExtents.y,
    z: footprint.center.z + footprint.halfExtents.z,
  };
  for (const axis of AXES) {
    const overhang = Math.max(fMin[axis] - collisionBounds.min[axis], collisionBounds.max[axis] - fMax[axis]);
    if (overhang > ASSET_FOOTPRINT_EPSILON) {
      fail(`collision escapes the footprint on ${axis} by ${overhang.toFixed(3)} (past epsilon ${ASSET_FOOTPRINT_EPSILON})`);
    }
  }

  const visualBounds = unionBounds(model.visual.map((mesh) => ({ positions: mesh.positions })));
  const warnings: string[] = [];
  for (const axis of AXES) {
    const escape = Math.max(collisionBounds.min[axis] - visualBounds.min[axis], visualBounds.max[axis] - collisionBounds.max[axis]);
    if (escape > ASSET_VISUAL_WARN) {
      warnings.push(`visual escapes collision on ${axis} by ${escape.toFixed(3)} (past tolerance ${ASSET_VISUAL_WARN})`);
    }
  }

  const solid: ValidatedSolidPart[] = model.solid.map((part, i) => {
    const surface = part.surface ?? moduleSurface ?? "default";
    if (!(surface in SURFACES)) fail(`solid part ${i} names unknown surface "${surface}"`);
    return { shape: part.shape, position: part.position, rotation: part.rotation, surface };
  });

  return { collision, solid, visual: model.visual, warnings };
};

/** Parse and validate in one call — the entry everything reads assets through. */
export const loadAssetModule = (bytes: Uint8Array, options: ValidateAssetOptions): ValidatedAsset =>
  validateAssetModule(readAssetModel(bytes), options);
