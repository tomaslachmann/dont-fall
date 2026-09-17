import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

/**
 * A racing-game/Fortnite-glider style speed-lines effect: a full-screen
 * post-processing pass, not 3D geometry. Individual world-space streak meshes
 * read as a handful of hard-edged shapes stuck to the lens; this instead
 * converts each screen pixel to polar coordinates around the frame's centre,
 * feeds the angle into a 2D value-noise function (which naturally reads as
 * soft streaks radiating outward, since the noise repeats around the circle),
 * and masks out a soft-edged empty centre so the Character stays clear.
 * Purely presentational — reads only a 0..1 intensity driven from the
 * Character's current speed; never touches simulation state.
 */

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uAspect;
  varying vec2 vUv;

  float random(vec2 st) {
    return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  // Standard 2D value noise (smooth-interpolated lattice of random corners).
  float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    if (uIntensity <= 0.001) {
      gl_FragColor = color;
      return;
    }

    // Aspect-correct so streaks read as radial from a circular centre, not an
    // ellipse stretched to the viewport's aspect ratio.
    vec2 centered = (vUv - 0.5) * vec2(uAspect, 1.0);
    float angle = atan(centered.y, centered.x);
    float dist = length(centered);

    // Sample noise at a point orbiting a circle of radius 28 at this angle
    // (rather than feeding the raw angle straight into noise) so the pattern
    // is exactly periodic — no seam where atan2 wraps from -PI to PI. Adding
    // uTime to the angle before taking cos/sin keeps that periodicity for any
    // point in time while still slowly rotating the whole pattern for a live feel.
    vec2 ring = vec2(cos(angle + uTime * 0.6), sin(angle + uTime * 0.6)) * 28.0;
    float n = noise(ring);

    float centerMaskStart = 0.32;
    float centerMaskEdge = 0.4;
    float mask = smoothstep(centerMaskStart, centerMaskStart + centerMaskEdge, dist);

    // Higher intensity both reveals more of the noise as lines and brightens them.
    float threshold = 1.0 - uIntensity * 0.55;
    float lines = smoothstep(threshold, threshold + 0.06, n) * mask * uIntensity;

    gl_FragColor = vec4(color.rgb + lines, color.a);
  }
`;

export interface SpeedLines {
  /** Renders the scene through the effect (replaces a plain renderer.render call). */
  render: () => void;
  /** 0 (invisible) to 1 (full intensity) — drive from current speed each frame. */
  setIntensity: (t: number) => void;
  resize: (width: number, height: number) => void;
  /**
   * Release the composer's two full-screen render targets and each pass's
   * material/geometry (M4 ticket 01). These are GPU allocations, not JS
   * objects — nothing reclaims them when the last reference drops, so a game
   * started and stopped repeatedly (ADR 0008) would accumulate a screen-sized
   * pair of buffers per run.
   */
  dispose: () => void;
}

/**
 * Samples per pixel in the composer's render targets (ADR 0074), at the
 * `high` graphics quality level; a level may ask for fewer (ADR 0079). The
 * scene is drawn into them, not into the canvas, so a renderer's own
 * `antialias` never reaches it; without samples here nothing in a Round is
 * antialiased.
 */
export const COMPOSER_SAMPLES = 4;

/**
 * An `EffectComposer` whose targets are multisampled half-float buffers the
 * size of the renderer's drawing buffer. Sized through `setSize` right away,
 * before any pass is added: a composer given its own target otherwise takes
 * the target's pixel size as its CSS size, and applies the pixel ratio twice
 * on its next resize.
 */
export const createSceneComposer = (renderer: THREE.WebGLRenderer, samples = COMPOSER_SAMPLES): EffectComposer => {
  const size = renderer.getSize(new THREE.Vector2());
  const pixelRatio = renderer.getPixelRatio();
  const target = new THREE.WebGLRenderTarget(size.x * pixelRatio, size.y * pixelRatio, {
    type: THREE.HalfFloatType,
    samples,
  });
  target.texture.name = "EffectComposer.rt1";
  // The composer clones it for its second buffer, samples and all, and frees both in `dispose`.
  const composer = new EffectComposer(renderer, target);
  composer.setSize(size.x, size.y);
  return composer;
};

export const createSpeedLines = (
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  samples = COMPOSER_SAMPLES,
): SpeedLines => {
  const composer = createSceneComposer(renderer, samples);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uAspect: { value: window.innerWidth / window.innerHeight },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });
  composer.addPass(pass);
  // Required last: EffectComposer's intermediate passes render in linear
  // space — without this, the renderer's sRGB/tone-mapping output conversion
  // never happens and the whole frame comes out too dark.
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const clock = new THREE.Clock();

  return {
    render: () => {
      pass.uniforms.uTime!.value = clock.getElapsedTime();
      composer.render();
    },
    setIntensity: (t) => {
      pass.uniforms.uIntensity!.value = THREE.MathUtils.clamp(t, 0, 1);
    },
    resize: (width, height) => {
      composer.setSize(width, height);
      pass.uniforms.uAspect!.value = width / height;
    },
    dispose: () => {
      // `EffectComposer.dispose` releases its own render targets and internal
      // copy pass but not the passes added to it, so each is released here too.
      composer.dispose();
      renderPass.dispose();
      pass.dispose();
      outputPass.dispose();
    },
  };
};
