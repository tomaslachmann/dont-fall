/** One triangle as a valid GLB — asset-loading tests never touch the disk. */
export const triangleGlb = (): Uint8Array => {
  const json = JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: 44 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
  });
  const jsonBytes = new TextEncoder().encode(json);
  const jsonPadded = new Uint8Array(Math.ceil(jsonBytes.length / 4) * 4).fill(0x20);
  jsonPadded.set(jsonBytes);
  const out = new Uint8Array(12 + 8 + jsonPadded.length + 8 + 44);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonPadded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonPadded, 20);
  const binAt = 20 + jsonPadded.length;
  view.setUint32(binAt, 44, true);
  view.setUint32(binAt + 4, 0x004e4942, true);
  const floats = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  out.set(new Uint8Array(floats.buffer), binAt + 8);
  out.set(new Uint8Array(new Uint16Array([0, 1, 2]).buffer), binAt + 8 + 36);
  return out;
};
