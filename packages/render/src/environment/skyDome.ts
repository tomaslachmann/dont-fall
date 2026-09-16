import { sunDirection, type EnvironmentPreset } from "@dont-fall/shared";
import * as THREE from "three";

/**
 * Opaque objects are sorted by `renderOrder` first (`WebGLRenderLists`), so
 * this draws the dome after every other opaque object: with its depth at the
 * far plane, each pixel geometry already covers fails the depth test and is
 * never shaded. Transparent objects still draw after it.
 */
export const SKY_DOME_RENDER_ORDER = 1_000_000;

/** How much of the disc's radius is solid before its edge fades out. */
const SUN_DISC_CORE = 0.75;

const VERTEX_SHADER = /* glsl */ `
varying vec3 vDirection;

void main() {
  // The dome is a unit sphere that only ever moves with the camera, never
  // turns, so a vertex's local position is the view direction through it.
  vDirection = position;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Depth at the far plane, whatever camera.far is (three.js's own background
  // does the same).
  gl_Position = clip.xyww;
}
`;

/**
 * The sky's colour along a unit view direction, and the uniforms it reads
 * ({@link skyUniforms}). Shared with the cloud floor, whose far edge fades
 * into exactly the sky behind it.
 */
export const SKY_COLOUR_GLSL = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 nadir;
uniform float horizonSoftness;
uniform vec3 sunDirection;
uniform vec3 sunColor;
uniform float sunCosOuter;
uniform float sunCosInner;
uniform float sunVisible;

vec3 skyColour(vec3 d) {
  vec3 colour = d.y >= 0.0
    ? mix(horizon, zenith, pow(smoothstep(0.0, 1.0, d.y), horizonSoftness))
    : mix(horizon, nadir, smoothstep(0.0, 0.25, -d.y));

  // Guarded rather than multiplied by zero: with no disc the two edges meet,
  // and smoothstep with equal edges is undefined in GLSL.
  if (sunVisible > 0.5) {
    float s = max(dot(d, sunDirection), 0.0);
    colour += sunColor * (smoothstep(sunCosOuter, sunCosInner, s) + 0.15 * pow(s, 24.0));
  }
  return colour;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
${SKY_COLOUR_GLSL}
varying vec3 vDirection;

void main() {
  gl_FragColor = vec4(skyColour(normalize(vDirection)), 1.0);

  // Both kept, so one shader is right on both paths: inside the game's
  // composer target they compile to nothing and OutputPass converts the whole
  // frame; on the builder's direct-to-canvas path they tone-map and convert
  // the dome here.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const DEG_TO_RAD = Math.PI / 180;

/** Fresh values for every uniform {@link SKY_COLOUR_GLSL} declares, from `preset`. */
export const skyUniforms = (preset: EnvironmentPreset): Record<string, THREE.IUniform> => {
  const { sky } = preset;
  const sun = sunDirection(preset);
  const discRadius = sky.sun.discRadiusDeg * DEG_TO_RAD;
  return {
    zenith: { value: new THREE.Color(sky.zenith) },
    horizon: { value: new THREE.Color(sky.horizon) },
    nadir: { value: new THREE.Color(sky.nadir) },
    horizonSoftness: { value: sky.horizonSoftness },
    sunDirection: { value: new THREE.Vector3(sun.x, sun.y, sun.z) },
    sunColor: { value: new THREE.Color(sky.sun.color) },
    sunCosOuter: { value: Math.cos(discRadius) },
    sunCosInner: { value: Math.cos(discRadius * SUN_DISC_CORE) },
    sunVisible: { value: discRadius > 0 ? 1 : 0 },
  };
};

/**
 * The gradient sky (ADR 0074, research §2): a camera-following unit sphere
 * seen from inside, three colour stops and an optional sun disc. Never fogged,
 * never written to depth, never a shadow caster or receiver.
 */
export const createSkyDome = (preset: EnvironmentPreset): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> => {
  const material = new THREE.ShaderMaterial({
    name: "environment-sky",
    uniforms: skyUniforms(preset),
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  dome.name = "environment-sky";
  dome.renderOrder = SKY_DOME_RENDER_ORDER;
  // It sits on the camera, so it is always in view; its bounds would only be
  // re-checked for nothing.
  dome.frustumCulled = false;
  return dome;
};
