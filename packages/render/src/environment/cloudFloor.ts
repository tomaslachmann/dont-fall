import type { EnvironmentPreset, EnvironmentWind } from "@dont-fall/shared";
import * as THREE from "three";
import { CLOUD_NOISE_SIZE, generateCloudNoise } from "./cloudNoise.js";
import { SKY_COLOUR_GLSL, skyUniforms } from "./skyDome.js";

/**
 * How far the floor reaches from the camera, in world units. Past
 * {@link CLOUD_FLOOR_FADE_START} of that it fades into the sky behind it, so
 * its edge never shows, fogged (the game) or not (the builder's preview).
 */
export const CLOUD_FLOOR_RADIUS = 250;
export const CLOUD_FLOOR_FADE_START = 0.6;
/**
 * How far short of the camera's far plane the floor has finished melting into
 * the sky, when the camera has one near enough to clip it (M13 ticket 04).
 * Measured from the camera, not across the plane, so it holds however high
 * the camera flies.
 */
export const CLOUD_FLOOR_FAR_PLANE_MARGIN = 5;

/** Where the floor's edge starts and finishes fading, and what the distance is measured from. */
export interface CloudFloorFade {
  start: number;
  end: number;
  /** From the camera (a clipping far plane), or across the plane from its centre (none). */
  fromCamera: boolean;
}

/**
 * The fade for a camera whose far plane is `farPlane`, or the plane's own
 * edge without one. The floor must be all sky before the far plane clips it,
 * or the clip would show against the dome behind it.
 */
export const cloudFloorFade = (farPlane?: number): CloudFloorFade => {
  if (farPlane === undefined || farPlane - CLOUD_FLOOR_FAR_PLANE_MARGIN >= CLOUD_FLOOR_RADIUS) {
    return { start: CLOUD_FLOOR_FADE_START * CLOUD_FLOOR_RADIUS, end: CLOUD_FLOOR_RADIUS, fromCamera: false };
  }
  const end = farPlane - CLOUD_FLOOR_FAR_PLANE_MARGIN;
  return { start: CLOUD_FLOOR_FADE_START * end, end, fromCamera: true };
};

/** Noise tiles per world unit for the broad layer: one tile every ~67 units. */
export const CLOUD_FLOOR_NOISE_SCALE = 0.015;
/** The detail layer is this much finer than the broad one… */
const DETAIL_SCALE = 2.7;
/** …and drifts at this share of the wind, so the pattern changes as it moves instead of sliding rigidly. */
const DETAIL_DRIFT = 0.5;

export interface Scroll {
  x: number;
  y: number;
}

export interface CloudFloorScroll {
  broad: Scroll;
  detail: Scroll;
}

const wrapUnit = (value: number): number => value - Math.floor(value);

/**
 * How far each noise layer has scrolled `seconds` into the wall clock, in
 * texture units wrapped to [0, 1). The tile repeats every unit, so wrapping
 * changes nothing on screen, and it keeps the offsets small however long a
 * page stays open: the shader never adds a huge number to a small one.
 */
export const cloudFloorScroll = (wind: EnvironmentWind, seconds: number): CloudFloorScroll => {
  const broad = seconds * CLOUD_FLOOR_NOISE_SCALE;
  const detail = seconds * DETAIL_DRIFT * CLOUD_FLOOR_NOISE_SCALE * DETAIL_SCALE;
  // Subtracted: the pattern moves with the wind, so what is under a world point comes from upwind.
  return {
    broad: { x: wrapUnit(-wind.x * broad), y: wrapUnit(-wind.z * broad) },
    detail: { x: wrapUnit(-wind.x * detail), y: wrapUnit(-wind.z * detail) },
  };
};

const VERTEX_SHADER = /* glsl */ `
#include <fog_pars_vertex>

varying vec3 vWorld;
varying vec2 vLocal;

void main() {
  vLocal = position.xy;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorld = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT_SHADER = /* glsl */ `
#include <fog_pars_fragment>
${SKY_COLOUR_GLSL}
uniform sampler2D noise;
uniform vec2 broadScroll;
uniform vec2 detailScroll;
uniform vec3 lit;
uniform vec3 shade;
uniform float openBelow;
uniform float fadeStart;
uniform float fadeEnd;

varying vec3 vWorld;
varying vec2 vLocal;

void main() {
  // World X/Z, never UVs: the plane follows the camera, and the clouds must
  // not follow it too. Two taps, no more — the floor fills most of a
  // downward-looking frame (research §3).
  vec2 p = vWorld.xz * ${CLOUD_FLOOR_NOISE_SCALE.toFixed(4)};
  float n = 0.65 * texture2D(noise, p + broadScroll).r
          + 0.35 * texture2D(noise, p * ${DETAIL_SCALE.toFixed(2)} + detailScroll).r;
  // A hole, where the puff band beneath shows through. Its rim is the shade
  // colour, which reads as depth.
  if (n < openBelow) discard;
  gl_FragColor = vec4(mix(shade, lit, smoothstep(0.35, 0.75, n)), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>

  // The edge melts into the sky drawn behind it. After the fog, and with the
  // sky taken through the same output steps the dome's own shader takes, so
  // the two meet on the same colour on both render paths.
  #ifdef FADE_FROM_CAMERA
    float fadeDistance = length(vWorld - cameraPosition);
  #else
    float fadeDistance = length(vLocal);
  #endif
  float edge = smoothstep(fadeStart, fadeEnd, fadeDistance);
  vec4 sky = vec4(skyColour(normalize(vWorld - cameraPosition)), 1.0);
  #ifdef TONE_MAPPING
    sky.rgb = toneMapping(sky.rgb);
  #endif
  sky = linearToOutputTexel(sky);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, sky.rgb, edge);
}
`;

export interface CloudFloor {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** Follows the camera across X/Z (Y stays put) and scrolls the clouds on the wall clock. */
  update(cameraPosition: THREE.Vector3, nowMs: number): void;
  dispose(): void;
}

/**
 * The sea of cloud under the Track (ADR 0074, research §3), replacing the
 * drawn kill plane: one camera-following plane at a fixed `y`, shaded from
 * a generated noise tile in world space and fogged like the Track, with holes
 * where the noise runs below the preset's `openBelow`. It never
 * casts or receives a shadow and never collides; the simulation's kill plane
 * does not move with it.
 */
export const createCloudFloor = (preset: EnvironmentPreset, y: number, fade: CloudFloorFade = cloudFloorFade()): CloudFloor => {
  const { cloudFloor } = preset;

  const noise = new THREE.DataTexture(
    generateCloudNoise(),
    CLOUD_NOISE_SIZE,
    CLOUD_NOISE_SIZE,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  noise.name = "environment-cloud-noise";
  noise.wrapS = THREE.RepeatWrapping;
  noise.wrapT = THREE.RepeatWrapping;
  noise.magFilter = THREE.LinearFilter;
  noise.minFilter = THREE.LinearMipmapLinearFilter;
  noise.generateMipmaps = true;
  noise.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    name: "environment-cloud-floor",
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      skyUniforms(preset),
      {
        broadScroll: { value: new THREE.Vector2() },
        detailScroll: { value: new THREE.Vector2() },
        lit: { value: new THREE.Color(cloudFloor.lit) },
        shade: { value: new THREE.Color(cloudFloor.shade) },
        openBelow: { value: cloudFloor.openBelow },
        fadeStart: { value: fade.start },
        fadeEnd: { value: fade.end },
      },
    ]),
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    ...(fade.fromCamera ? { defines: { FADE_FROM_CAMERA: "" } } : {}),
    fog: true,
  });
  // Assigned after the merge: `UniformsUtils.merge` clones textures, and the
  // clone would be the one uploaded while the original is the one disposed.
  material.uniforms.noise = { value: noise };

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CLOUD_FLOOR_RADIUS * 2, CLOUD_FLOOR_RADIUS * 2), material);
  mesh.name = "environment-cloud-floor";
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;

  const broadScroll = material.uniforms.broadScroll!.value as THREE.Vector2;
  const detailScroll = material.uniforms.detailScroll!.value as THREE.Vector2;

  return {
    mesh,
    update: (cameraPosition, nowMs) => {
      mesh.position.x = cameraPosition.x;
      mesh.position.z = cameraPosition.z;
      const scroll = cloudFloorScroll(cloudFloor.wind, nowMs / 1000);
      broadScroll.set(scroll.broad.x, scroll.broad.y);
      detailScroll.set(scroll.detail.x, scroll.detail.y);
    },
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
      noise.dispose();
    },
  };
};
