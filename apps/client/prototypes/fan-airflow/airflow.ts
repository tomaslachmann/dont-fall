// PROTOTYPE — what the air over a fan looks like. Round two: today's box + rings "look terrible and
// don't fit the game" (user, 2026-09-16), and round one's realistic haze/dust was the wrong
// direction for a cartoon game. So the lead candidates are stylized, in the game's own language:
//
// - streaks: cartoon wind swooshes (Wind Waker's), thin tapered ribbons spiralling up the column
//   and curling out at the top. Pure vertex-shader maths, no per-frame CPU work.
// - puffs:   chunky low-poly cloud puffs popping out of the fan's mouth, built and lit exactly like
//   the Environment's own cloud puffs (packages/render cloudPuffs.ts), so they belong to the sky.
//
// - wisps:   round one's smoke shells, made louder on request (2026-09-16): denser, shaded toward
//   the Environment's cloud colours, with an optional hard-banded cartoon look.
//
// All of them are authored in the column's own frame (+Y = the Volume's force), so a sideways
// wind is just a rotated group. Round one's haze/dust stay for comparison, and "game" draws what
// shipped from the pick (the old box + rings are gone from the game).
import type { EnvironmentPreset, VolumeConfig } from "@dont-fall/shared";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildAirColumns } from "../../src/render/airColumns.js";

export const AIR_VARIANTS = [
  "streaks+puffs",
  "streaks",
  "puffs",
  "wisps",
  "game",
  "haze+dust",
  "dust",
  "none",
] as const;
export type AirVariant = (typeof AIR_VARIANTS)[number];

export const AIR_NAMES: Record<AirVariant, string> = {
  "streaks+puffs": "cartoon — swooshes + puffs",
  streaks: "cartoon — swooshes only",
  puffs: "cartoon — puffs only",
  game: "the game — as shipped (swooshes + puffs)",
  "haze+dust": "round 1 — heat haze + dust",
  wisps: "smoke wisps — louder",
  dust: "round 1 — dust",
  none: "nothing (fan only)",
};

/** Which slider groups a variant uses, so the panel shows only those. */
export const AIR_GROUPS: Record<AirVariant, readonly (keyof typeof AIR_TUNING_GROUPS)[]> = {
  "streaks+puffs": ["streaks", "puffs"],
  streaks: ["streaks"],
  puffs: ["puffs"],
  game: [],
  "haze+dust": ["realistic"],
  wisps: ["wisps"],
  dust: ["realistic"],
  none: [],
};

export const streakTuning = {
  count: 9,
  speed: 5,
  turns: 0.55,
  width: 0.09,
  length: 0.32,
  curl: 0.55,
  opacity: 0.85,
  topFade: 0.86,
};
export const puffTuning = {
  count: 16,
  speed: 1.6,
  rise: 0.42,
  size: 0.34,
  swirl: 0.35,
};
/**
 * Smoke wisps, round two: round one's shells were barely there (a 0.35 opacity, a narrow noise
 * band, white on a pale sky, and the front of each shell nearly clear). Every one of those is now a
 * slider, and the thick of the smoke is shaded toward the Environment's cloud shade so it holds
 * against the sky as well as the deck.
 */
export const wispTuning = {
  opacity: 0.85,
  speed: 1.6,
  /** Noise threshold: lower = more of the shell is smoke. */
  coverage: 0.4,
  /** How soft a wisp's edge is. */
  softness: 0.2,
  /** Wisp size: bigger = fewer, larger blobs, which read from further away. */
  scale: 1.2,
  twist: 1,
  /** How much of a shell's face-on side is kept (edge-on always shows fully). */
  facing: 0.65,
  /** How far the thick of the smoke goes toward the cloud shade. */
  shade: 0.6,
  /** 0 = soft smoke, 1 = hard cartoon bands. */
  cel: 0,
  bands: 3,
  /** Where the fade out at the column's top begins (share of its height). */
  topFade: 0.7,
  /** Shell width multiplier. */
  width: 1,
};
export const realisticTuning = {
  hazeStrength: 0.012,
  hazeSpeed: 1.6,
  dustCount: 420,
  dustSpeed: 4.5,
  dustSize: 3,
  dustOpacity: 0.8,
  swirl: 0.9,
};

export const AIR_TUNING_GROUPS = {
  streaks: streakTuning,
  puffs: puffTuning,
  wisps: wispTuning,
  realistic: realisticTuning,
};

export const AIR_RANGES: Record<string, [number, number]> = {
  "streaks.count": [0, 24],
  "streaks.speed": [0.5, 14],
  "streaks.turns": [-2, 2],
  "streaks.width": [0.01, 0.3],
  "streaks.length": [0.05, 0.8],
  "streaks.curl": [0, 1.5],
  "streaks.opacity": [0, 1],
  "streaks.topFade": [0.3, 1],
  "puffs.count": [0, 40],
  "puffs.speed": [0.2, 6],
  "puffs.rise": [0.1, 1],
  "puffs.size": [0.05, 0.9],
  "puffs.swirl": [-2, 2],
  "wisps.opacity": [0, 1],
  "wisps.speed": [0.1, 5],
  "wisps.coverage": [0.1, 0.8],
  "wisps.softness": [0.01, 0.5],
  "wisps.scale": [0.3, 3],
  "wisps.twist": [-3, 3],
  "wisps.facing": [0, 1],
  "wisps.shade": [0, 1],
  "wisps.cel": [0, 1],
  "wisps.bands": [1, 6],
  "wisps.topFade": [0.2, 1],
  "wisps.width": [0.3, 2],
  "realistic.hazeStrength": [0, 0.05],
  "realistic.hazeSpeed": [0.1, 5],
  "realistic.dustCount": [0, 1200],
  "realistic.dustSpeed": [0.5, 12],
  "realistic.dustSize": [0.5, 10],
  "realistic.dustOpacity": [0, 1],
  "realistic.swirl": [0, 3],
};

/** Where the column stands: the fan's updraft, in world space. */
export interface Column {
  /** Where the air leaves the fan (the rotor's top). */
  base: number;
  height: number;
  /** How wide the air is as it leaves the fan. */
  mouthRadius: number;
  /** How wide the Volume is — the air spreads out to this, so what you see is where it pushes. */
  radius: number;
}

export interface AirFlow {
  object: THREE.Group;
  /** The haze needs the frame drawn without it first; everything else ignores this. */
  needsSceneTexture: boolean;
  update(nowMs: number, sceneTexture: THREE.Texture | null, resolution: THREE.Vector2, camera: THREE.Vector3): void;
  dispose(): void;
}

const seeded = (seed: number) => (x: number): number => {
  const s = Math.sin((seed + 1) * 12.9898 + x * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// ---------------------------------------------------------------------------------------------
// Streaks — cartoon wind swooshes
// ---------------------------------------------------------------------------------------------

const STREAK_MAX = 24;
const STREAK_SEGMENTS = 28;

const createStreaks = (column: Column): AirFlow => {
  const perStreak = (STREAK_SEGMENTS + 1) * 2;
  const vertices = STREAK_MAX * perStreak;
  const along = new Float32Array(vertices);
  const side = new Float32Array(vertices);
  const seed = new Float32Array(vertices * 4);
  const length = new Float32Array(vertices);
  const slot = new Float32Array(vertices);
  const indices: number[] = [];
  for (let i = 0; i < STREAK_MAX; i += 1) {
    const r = seeded(i);
    // Spread evenly around the column, then jittered, so no two streaks bunch up.
    const angle = ((i * 0.618034) % 1) * Math.PI * 2 + (r(1) - 0.5) * 0.4;
    const radiusShare = 0.45 + 0.55 * r(2);
    const phase = r(3);
    const pace = 0.8 + 0.45 * r(4);
    const lengthShare = 0.75 + 0.5 * r(5);
    for (let j = 0; j <= STREAK_SEGMENTS; j += 1) {
      for (let k = 0; k < 2; k += 1) {
        const v = i * perStreak + j * 2 + k;
        along[v] = j / STREAK_SEGMENTS;
        side[v] = k === 0 ? -1 : 1;
        seed.set([angle, radiusShare, phase, pace], v * 4);
        length[v] = lengthShare;
        slot[v] = i;
      }
      if (j < STREAK_SEGMENTS) {
        const a = i * perStreak + j * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  // Every position comes from the shader; this only gives three.js an attribute to count.
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
  geometry.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
  geometry.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
  geometry.setAttribute("aLength", new THREE.BufferAttribute(length, 1));
  geometry.setAttribute("aSlot", new THREE.BufferAttribute(slot, 1));
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHeight: { value: column.height },
      uMouth: { value: column.mouthRadius },
      uSpread: { value: column.radius },
      uTurns: { value: streakTuning.turns },
      uWidth: { value: streakTuning.width },
      uLength: { value: streakTuning.length },
      uCurl: { value: streakTuning.curl },
      uSpeed: { value: streakTuning.speed },
      uCount: { value: streakTuning.count },
      uTopFade: { value: streakTuning.topFade },
      uOpacity: { value: streakTuning.opacity },
      uColor: { value: new THREE.Color(0xf4fbff) },
    },
    vertexShader: /* glsl */ `
      attribute float aAlong;
      attribute float aSide;
      attribute vec4 aSeed;
      attribute float aLength;
      attribute float aSlot;
      uniform float uTime;
      uniform float uHeight;
      uniform float uMouth;
      uniform float uSpread;
      uniform float uTurns;
      uniform float uWidth;
      uniform float uLength;
      uniform float uCurl;
      uniform float uSpeed;
      uniform float uCount;
      uniform float uTopFade;
      varying float vSide;
      varying float vAlpha;

      // A point on streak aSeed's path, t = 0 at the fan's mouth, 1 at the column's top.
      // Past 70% of the way up it flares out and droops: the cartoon curl.
      vec3 pathAt(float t) {
        float k = clamp(t, 0.0, 1.0);
        float over = max(0.0, t - 0.7) / 0.3;
        float radius = aSeed.y * mix(uMouth, uSpread, pow(k, 0.7)) + uCurl * over * over;
        float y = t * uHeight - uCurl * 0.6 * over * over * over;
        float angle = aSeed.x + uTurns * 6.2831853 * t;
        return vec3(cos(angle) * radius, y, sin(angle) * radius);
      }

      void main() {
        float span = uLength * aLength;
        float cycle = (1.0 + span) * uHeight / max(0.01, uSpeed * aSeed.w);
        float life = fract(uTime / cycle + aSeed.z);
        float head = life * (1.0 + span);
        float t = head - aAlong * span;
        vec3 here = pathAt(t);
        vec3 ahead = pathAt(t + 0.01);
        vec4 world = modelMatrix * vec4(here, 1.0);
        vec3 tangent = mat3(modelMatrix) * (ahead - here);
        vec3 across = cross(tangent, cameraPosition - world.xyz);
        across /= max(length(across), 1e-5);
        // A pointed head, widest just behind it, thinning to nothing at the tail.
        float width = uWidth * pow(1.0 - aAlong, 0.8) * smoothstep(0.0, 0.08, aAlong);
        world.xyz += across * aSide * width * 0.5;
        vSide = aSide;
        float visible = step(aSlot + 0.5, uCount);
        vAlpha = visible * smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(uTopFade, 1.0, t));
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vSide;
      varying float vAlpha;
      void main() {
        // A crisp cel edge, with just enough of a ramp not to crawl.
        float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
        float alpha = edge * vAlpha * uOpacity;
        if (alpha <= 0.003) discard;
        gl_FragColor = vec4(uColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  const object = new THREE.Group();
  object.add(mesh);
  return {
    object,
    needsSceneTexture: false,
    update: (nowMs) => {
      const u = material.uniforms;
      u.uTime!.value = nowMs / 1000;
      u.uTurns!.value = streakTuning.turns;
      u.uWidth!.value = streakTuning.width;
      u.uLength!.value = streakTuning.length;
      u.uCurl!.value = streakTuning.curl;
      u.uSpeed!.value = streakTuning.speed;
      u.uCount!.value = streakTuning.count;
      u.uTopFade!.value = streakTuning.topFade;
      u.uOpacity!.value = streakTuning.opacity;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Puffs — the Environment's own cloud puffs, small, popping out of the fan
// ---------------------------------------------------------------------------------------------

const PUFF_MAX = 40;
const PUFF_VARIANTS = 3;
const PUFF_EMISSIVE = 0.25;
const TOON_BANDS = [96, 176, 255];

/** cloudPuffs.ts's shape recipe, one unit across: a few icospheres along a wide, low body. */
const puffGeometry = (r: (x: number) => number): THREE.BufferGeometry => {
  const spheres = 3 + Math.floor(r(0) * 3);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < spheres; i += 1) {
    const radius = i === 0 ? 0.32 : 0.16 + r(i + 1) * 0.12;
    const part = new THREE.IcosahedronGeometry(radius, 1);
    if (i > 0) part.translate((r(i + 11) - 0.5) * 0.55, (r(i + 21) - 0.3) * 0.14, (r(i + 31) - 0.5) * 0.35);
    parts.push(part);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  merged.scale(1, 0.8, 1);
  return merged;
};

const createPuffs = (column: Column, preset: EnvironmentPreset): AirFlow => {
  const shade = new THREE.Color(preset.puffs.shade);
  const lit = new THREE.Color(preset.puffs.lit);
  let gradientMap: THREE.DataTexture | null = null;
  let material: THREE.Material;
  if (preset.puffs.style === "toon") {
    gradientMap = new THREE.DataTexture(Uint8Array.from(TOON_BANDS), TOON_BANDS.length, 1, THREE.RedFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.generateMipmaps = false;
    gradientMap.needsUpdate = true;
    material = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap, emissive: shade, emissiveIntensity: PUFF_EMISSIVE });
  } else {
    material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      flatShading: true,
      emissive: shade,
      emissiveIntensity: PUFF_EMISSIVE,
    });
  }

  const puffs = Array.from({ length: PUFF_MAX }, (_, i) => {
    const r = seeded(100 + i);
    return {
      variant: i % PUFF_VARIANTS,
      angle: r(1) * Math.PI * 2,
      radiusShare: 0.25 + 0.75 * Math.sqrt(r(2)),
      phase: r(3),
      pace: 0.75 + 0.5 * r(4),
      size: 0.7 + 0.6 * r(5),
      spin: (r(6) - 0.5) * 2,
      tint: r(7) * 0.35,
    };
  });

  const object = new THREE.Group();
  const meshes = Array.from({ length: PUFF_VARIANTS }, (_, variant) => {
    const members = puffs.map((p, i) => ({ ...p, slot: i })).filter((p) => p.variant === variant);
    const mesh = new THREE.InstancedMesh(puffGeometry(seeded(500 + variant)), material, members.length);
    mesh.frustumCulled = false;
    const tint = new THREE.Color();
    members.forEach((p, i) => mesh.setColorAt(i, tint.copy(lit).lerp(shade, p.tint)));
    object.add(mesh);
    return { mesh, members };
  });

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const smooth = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  return {
    object,
    needsSceneTexture: false,
    update: (nowMs) => {
      const seconds = nowMs / 1000;
      const riseHeight = column.height * puffTuning.rise;
      const cycle = riseHeight / Math.max(0.01, puffTuning.speed);
      for (const { mesh, members } of meshes) {
        members.forEach((p, i) => {
          const u = (((seconds * p.pace) / cycle + p.phase) % 1 + 1) % 1;
          // Shot out of the mouth, slowing as it rises; it pops in, grows, and shrinks away — a
          // cartoon puff never fades, it's gone by scale.
          const rise = 1 - (1 - u) * (1 - u);
          const radius = p.radiusShare * (column.mouthRadius * (1 - u) + column.radius * 0.8 * u);
          const angle = p.angle + puffTuning.swirl * rise * Math.PI * 2;
          position.set(Math.cos(angle) * radius, rise * riseHeight, Math.sin(angle) * radius);
          const size =
            p.slot < puffTuning.count
              ? puffTuning.size * p.size * (0.55 + 0.9 * u) * smooth(0, 0.12, u) * (1 - smooth(0.55, 1, u))
              : 0;
          scale.setScalar(size);
          rotation.setFromEuler(euler.set(0, p.angle + p.spin * seconds, 0));
          mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
        });
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose: () => {
      meshes.forEach(({ mesh }) => {
        mesh.geometry.dispose();
        mesh.dispose();
      });
      material.dispose();
      gradientMap?.dispose();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Smoke wisps (round two), and round one's realistic haze and dust
// ---------------------------------------------------------------------------------------------

const NOISE_GLSL = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
`;

const heightFadeGlsl = /* glsl */ `
float heightFade(float h) { return smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.65, 1.0, h)); }
`;

const createHaze = (column: Column): AirFlow => {
  const geometry = new THREE.CylinderGeometry(column.radius, column.radius * 1.15, column.height, 48, 1, true);
  geometry.translate(0, column.height / 2, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      sceneTexture: { value: null },
      resolution: { value: new THREE.Vector2(1, 1) },
      time: { value: 0 },
      strength: { value: realisticTuning.hazeStrength },
      base: { value: column.base },
      height: { value: column.height },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D sceneTexture;
      uniform vec2 resolution;
      uniform float time;
      uniform float strength;
      uniform float base;
      uniform float height;
      varying vec3 vWorld;
      varying vec3 vNormal;
      ${NOISE_GLSL}
      ${heightFadeGlsl}
      void main() {
        vec2 uv = gl_FragCoord.xy / resolution;
        float h = clamp((vWorld.y - base) / height, 0.0, 1.0);
        vec3 view = normalize(cameraPosition - vWorld);
        float through = pow(abs(dot(normalize(vNormal), view)), 1.5);
        float angle = atan(vWorld.z, vWorld.x);
        vec2 p = vec2(angle * 2.0 + h * 3.0, vWorld.y * 1.7 - time);
        vec2 wobble = vec2(fbm(p) - 0.5, fbm(p + vec2(5.2, 1.3)) - 0.5);
        vec2 offset = wobble * strength * through * heightFade(h);
        gl_FragColor = texture2D(sceneTexture, uv + offset);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 10;
  const object = new THREE.Group();
  object.add(mesh);
  return {
    object,
    needsSceneTexture: true,
    update: (nowMs, sceneTexture, resolution) => {
      material.uniforms.sceneTexture!.value = sceneTexture;
      material.uniforms.resolution!.value.copy(resolution);
      material.uniforms.time!.value = (nowMs / 1000) * realisticTuning.hazeSpeed;
      material.uniforms.strength!.value = realisticTuning.hazeStrength;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
};

const WISP_SHELLS = [
  // Radii as shares of the mouth (bottom) and of the Volume's half-width (top).
  { mouth: 0.55, top: 0.55, speed: 1.0, twist: 2.2, seed: 0.0 },
  { mouth: 0.85, top: 0.8, speed: 0.85, twist: -1.6, seed: 3.7 },
  { mouth: 1.1, top: 1.0, speed: 0.7, twist: 1.1, seed: 8.1 },
  { mouth: 1.35, top: 1.2, speed: 0.6, twist: -0.8, seed: 12.9 },
];

const createWisps = (column: Column, preset: EnvironmentPreset): AirFlow => {
  const object = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const materials: THREE.ShaderMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const litColor = new THREE.Color(preset.puffs.lit);
  const shadeColor = new THREE.Color(preset.puffs.shade);
  WISP_SHELLS.forEach((shell) => {
    const geometry = new THREE.CylinderGeometry(
      column.radius * shell.top,
      column.mouthRadius * shell.mouth,
      column.height,
      64,
      24,
      true,
    );
    geometry.translate(0, column.height / 2, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        height: { value: column.height },
        twist: { value: shell.twist },
        seed: { value: shell.seed },
        opacity: { value: wispTuning.opacity },
        coverage: { value: wispTuning.coverage },
        softness: { value: wispTuning.softness },
        scale: { value: wispTuning.scale },
        facing: { value: wispTuning.facing },
        shade: { value: wispTuning.shade },
        cel: { value: wispTuning.cel },
        bands: { value: wispTuning.bands },
        topFade: { value: wispTuning.topFade },
        litColor: { value: litColor },
        shadeColor: { value: shadeColor },
      },
      vertexShader: /* glsl */ `
        varying vec3 vLocal;
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          // The shell's own frame is the column's: y up from the mouth, the axis at x = z = 0.
          vLocal = position;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float time;
        uniform float height;
        uniform float twist;
        uniform float seed;
        uniform float opacity;
        uniform float coverage;
        uniform float softness;
        uniform float scale;
        uniform float facing;
        uniform float shade;
        uniform float cel;
        uniform float bands;
        uniform float topFade;
        uniform vec3 litColor;
        uniform vec3 shadeColor;
        varying vec3 vLocal;
        varying vec3 vWorld;
        varying vec3 vNormal;
        ${NOISE_GLSL}
        void main() {
          float h = clamp(vLocal.y / height, 0.0, 1.0);
          float angle = atan(vLocal.z, vLocal.x);
          // Sampled on a circle so the seam at ±π never shows.
          vec2 around = vec2(cos(angle + twist * h), sin(angle + twist * h)) * 1.6 / scale;
          float rise = (vLocal.y * 0.9 - time) / scale;
          float n = fbm(around + vec2(seed, rise)) * 0.65 + fbm(around * 2.3 + vec2(rise * 1.7, seed)) * 0.35;
          float density = smoothstep(coverage, coverage + softness, n);
          float fade = smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(topFade, 1.0, h));
          vec3 view = normalize(cameraPosition - vWorld);
          // Smoke seen edge-on piles up; face-on it is thinner.
          float edge = 1.0 - abs(dot(normalize(vNormal), view));
          float alpha = density * fade * mix(facing, 1.0, edge);
          alpha = mix(alpha, floor(alpha * bands + 0.5) / bands, cel) * opacity;
          if (alpha <= 0.003) discard;
          float thick = smoothstep(coverage + softness, coverage + softness + 0.25, n);
          gl_FragColor = vec4(mix(litColor, shadeColor, thick * shade), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 5;
    object.add(mesh);
    meshes.push(mesh);
    materials.push(material);
    geometries.push(geometry);
  });
  return {
    object,
    needsSceneTexture: false,
    update: (nowMs) => {
      const seconds = nowMs / 1000;
      materials.forEach((material, i) => {
        const shell = WISP_SHELLS[i]!;
        const u = material.uniforms;
        u.time!.value = seconds * wispTuning.speed * shell.speed;
        u.twist!.value = shell.twist * wispTuning.twist;
        u.opacity!.value = wispTuning.opacity;
        u.coverage!.value = wispTuning.coverage;
        u.softness!.value = wispTuning.softness;
        u.scale!.value = wispTuning.scale;
        u.facing!.value = wispTuning.facing;
        u.shade!.value = wispTuning.shade;
        u.cel!.value = wispTuning.cel;
        u.bands!.value = Math.max(1, Math.round(wispTuning.bands));
        u.topFade!.value = wispTuning.topFade;
      });
      for (const mesh of meshes) mesh.scale.set(wispTuning.width, 1, wispTuning.width);
    },
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
};

const createDust = (column: Column): AirFlow => {
  const max = 1200;
  const seeds = Array.from({ length: max }, (_, i) => {
    const r = seeded(i);
    return { angle: r(1) * Math.PI * 2, radius: Math.sqrt(r(2)) * column.radius * 0.85, phase: r(3), pace: 0.7 + r(4) * 0.6, wobble: r(5) * 10 };
  });
  const points = new Float32Array(max * 3);
  const pointAlpha = new Float32Array(max);
  const lines = new Float32Array(max * 6);
  const lineColors = new Float32Array(max * 8);

  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  pointGeometry.setAttribute("alpha", new THREE.BufferAttribute(pointAlpha, 1));
  const pointMaterial = new THREE.ShaderMaterial({
    uniforms: { size: { value: realisticTuning.dustSize }, color: { value: new THREE.Color(0xfff6e8) } },
    vertexShader: /* glsl */ `
      attribute float alpha;
      uniform float size;
      varying float vAlpha;
      void main() {
        vAlpha = alpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size * (10.0 / -mv.z);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = (1.0 - smoothstep(0.15, 0.5, d)) * vAlpha;
        if (a <= 0.0) discard;
        gl_FragColor = vec4(color, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const pointMesh = new THREE.Points(pointGeometry, pointMaterial);
  pointMesh.frustumCulled = false;

  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(lines, 3));
  lineGeometry.setAttribute("color", new THREE.BufferAttribute(lineColors, 4));
  const lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  const lineMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
  lineMesh.frustumCulled = false;

  const object = new THREE.Group();
  object.add(lineMesh, pointMesh);

  const at = (seed: (typeof seeds)[number], u: number, seconds: number, out: THREE.Vector3): void => {
    const rise = 1 - Math.pow(1 - u, 1.7);
    const y = rise * column.height;
    const radius = seed.radius * (0.45 + 0.9 * u) + 0.08 * Math.sin(seconds * 2.1 + seed.wobble);
    const angle = seed.angle + realisticTuning.swirl * rise * 4 + 0.25 * Math.sin(seconds * 1.3 + seed.wobble);
    out.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  };
  const head = new THREE.Vector3();
  const tail = new THREE.Vector3();

  return {
    object,
    needsSceneTexture: false,
    update: (nowMs) => {
      const seconds = nowMs / 1000;
      const count = Math.min(max, Math.round(realisticTuning.dustCount));
      const cycle = column.height / realisticTuning.dustSpeed;
      for (let i = 0; i < max; i += 1) {
        const seed = seeds[i]!;
        if (i >= count) {
          pointAlpha[i] = 0;
          lineColors.fill(0, i * 8, i * 8 + 8);
          continue;
        }
        const u = (((seconds * seed.pace) / cycle + seed.phase) % 1 + 1) % 1;
        const fade = Math.min(u / 0.1, (1 - u) / 0.35, 1);
        const alpha = Math.max(0, fade) * realisticTuning.dustOpacity;
        at(seed, u, seconds, head);
        at(seed, Math.max(0, u - 0.035 * seed.pace), seconds, tail);
        head.toArray(points, i * 3);
        pointAlpha[i] = alpha;
        head.toArray(lines, i * 6);
        tail.toArray(lines, i * 6 + 3);
        lineColors.set([1, 0.97, 0.92, alpha * 0.55, 1, 0.97, 0.92, 0], i * 8);
      }
      pointGeometry.attributes.position!.needsUpdate = true;
      pointGeometry.attributes.alpha!.needsUpdate = true;
      lineGeometry.attributes.position!.needsUpdate = true;
      lineGeometry.attributes.color!.needsUpdate = true;
      pointMaterial.uniforms.size!.value = realisticTuning.dustSize;
    },
    dispose: () => {
      pointGeometry.dispose();
      pointMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// The game — what ships since the user's pick (apps/client/src/render/airColumns.ts)
// ---------------------------------------------------------------------------------------------

const createShipped = (volume: VolumeConfig, preset: EnvironmentPreset): AirFlow => {
  const built = buildAirColumns([volume], preset);
  const object = new THREE.Group();
  built.columns.forEach((column) => object.add(column));
  return {
    object,
    needsSceneTexture: false,
    update: (nowMs, _texture, _resolution, camera) => built.update(nowMs, camera),
    dispose: () => built.dispose(),
  };
};

const combine = (parts: AirFlow[]): AirFlow => {
  const object = new THREE.Group();
  parts.forEach((p) => object.add(p.object));
  return {
    object,
    needsSceneTexture: parts.some((p) => p.needsSceneTexture),
    update: (nowMs, texture, resolution, camera) => parts.forEach((p) => p.update(nowMs, texture, resolution, camera)),
    dispose: () => parts.forEach((p) => p.dispose()),
  };
};

/**
 * Everything but the rings is built in the column's own frame — origin at the fan's mouth, +Y along
 * the force — and placed by one group transform, the way the game would place a rotated Volume.
 */
const inColumnFrame = (flow: AirFlow, column: Column): AirFlow => {
  const frame = new THREE.Group();
  frame.position.set(0, column.base, 0);
  frame.add(flow.object);
  return { ...flow, object: frame };
};

export const createAirFlow = (
  variant: AirVariant,
  column: Column,
  volume: VolumeConfig,
  preset: EnvironmentPreset,
): AirFlow => {
  switch (variant) {
    case "streaks+puffs":
      return inColumnFrame(combine([createStreaks(column), createPuffs(column, preset)]), column);
    case "streaks":
      return inColumnFrame(createStreaks(column), column);
    case "puffs":
      return inColumnFrame(createPuffs(column, preset), column);
    case "game":
      return createShipped(volume, preset);
    case "haze+dust":
      return inColumnFrame(combine([createHaze(column), createDust(column)]), column);
    case "wisps":
      return inColumnFrame(createWisps(column, preset), column);
    case "dust":
      return inColumnFrame(createDust(column), column);
    case "none":
      return combine([]);
  }
};
