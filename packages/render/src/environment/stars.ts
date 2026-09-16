import type { EnvironmentStars } from "@dont-fall/shared";
import * as THREE from "three";
import { seededRandom } from "./random.js";

/** Stars start this far above the horizon, where the fogged Track and the cloud floor never cover them. */
export const STARS_LOWEST_Y = 0.08;
/** The same sky on every load. */
const STARS_SEED = 11;

const VERTEX_SHADER = /* glsl */ `
uniform float size;

void main() {
  // Like the dome: a unit direction around the camera, drawn at the far
  // plane, so anything in front of the sky hides the stars behind it.
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clip.xyww;
  gl_PointSize = size;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 color;

void main() {
  // A soft round dot rather than the square a point draws as.
  float alpha = 1.0 - smoothstep(0.2, 0.5, length(gl_PointCoord - 0.5));
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(color, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * `count` unit directions scattered evenly over the sky above
 * {@link STARS_LOWEST_Y}, seeded: even in area, so they never bunch at the
 * zenith the way an even spread of angles would.
 */
export const starDirections = (count: number, seed = STARS_SEED): Float32Array => {
  const next = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    // Uniform in height is uniform in area on a sphere (Archimedes).
    const y = STARS_LOWEST_Y + next() * (1 - STARS_LOWEST_Y);
    const around = next() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    positions.set([r * Math.cos(around), y, r * Math.sin(around)], i * 3);
  }
  return positions;
};

/**
 * A night sky's stars (ADR 0074, ticket 11): one `Points` of fixed directions
 * that follows the camera like the dome, drawn after it in the transparent
 * pass and never fogged. It never casts or receives a shadow.
 */
export const createStars = (stars: EnvironmentStars): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(starDirections(stars.count), 3));
  const material = new THREE.ShaderMaterial({
    name: "environment-stars",
    uniforms: {
      color: { value: new THREE.Color(stars.color) },
      size: { value: stars.size },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "environment-stars";
  // Always around the camera, so always in view.
  points.frustumCulled = false;
  return points;
};
