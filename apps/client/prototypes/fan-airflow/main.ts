// PROTOTYPE — the new fan, its air flow and the float animation, side by side with today's.
// Throwaway: see README.
import { createEnvironment, type Environment } from "@dont-fall/render";
import {
  CAPSULE_BOTTOM_OFFSET,
  ENVIRONMENT_IDS,
  ENVIRONMENT_PRESETS,
  GRAVITY_Y,
  JUMP_HOLD_GRAVITY_SCALE,
  JUMP_HOLD_MAX_MS,
  JUMP_VELOCITY,
  TICK_DT,
  type EnvironmentId,
  type VolumeConfig,
} from "@dont-fall/shared";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CHARACTER_VISUAL_HEIGHT,
  crossfadeLocomotion,
  loadCharacterActions,
  loadCharacterModel,
  pinClipPose,
} from "../../src/render/characterModel.js";
import { JUMP_CROSSFADE_SECONDS, JumpSequences, jumpPoseAt, jumpTimeline } from "../../src/render/jumpSequence.js";
import { setShadowRole } from "../../src/render/shadowRoles.js";
import {
  AIR_GROUPS,
  AIR_NAMES,
  AIR_RANGES,
  AIR_TUNING_GROUPS,
  AIR_VARIANTS,
  createAirFlow,
  type AirFlow,
  type AirVariant,
  type Column,
} from "./airflow.js";
import { loadFan } from "./fanModel.js";
import { FLOAT_KEYS, FLOAT_RANGES, FloatAnimator, floatTuning, type FloatMode } from "./hover.js";

type AnimVariant = "today" | FloatMode;
const ANIM_VARIANTS: readonly AnimVariant[] = ["today", "hold", "loop"];
const ANIM_NAMES: Record<AnimVariant, string> = { today: "TODAY", hold: "HOLD", loop: "LOOP" };
const TIME_SCALES = [1, 0.5, 0.25];

const params = new URLSearchParams(location.search);
const pick = <T extends string>(value: string | null, options: readonly T[], fallback: T): T =>
  (options as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
let airVariant: AirVariant = pick(params.get("air"), AIR_VARIANTS, "streaks+puffs");
let animVariant: AnimVariant = pick(params.get("anim"), ANIM_VARIANTS, "loop");
let environmentId: EnvironmentId = pick(params.get("env"), ENVIRONMENT_IDS, "day");
let stay = params.get("stay") === "1";
let timeScale = 1;
const writeParams = (): void => {
  history.replaceState(
    null,
    "",
    `?air=${encodeURIComponent(airVariant)}&anim=${animVariant}&env=${environmentId}${stay ? "&stay=1" : ""}`,
  );
};

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300);
camera.position.set(8, 5.5, 10);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 3.2, 0);
controls.enableDamping = true;

const deck = new THREE.Mesh(
  new THREE.BoxGeometry(16, 1, 8),
  new THREE.MeshStandardMaterial({ color: 0x5ab8e6, roughness: 0.35 }),
);
deck.position.y = -0.5;
deck.receiveShadow = true;
scene.add(deck);

let environment: Environment | null = null;
const setEnvironment = (): void => {
  environment?.dispose();
  environment = createEnvironment(scene, renderer, ENVIRONMENT_PRESETS[environmentId], {
    killPlaneY: -8,
    lowestSegmentY: -1,
    fog: true,
    detail: "full",
    shadows: true,
  });
};
setEnvironment();

const fan = await loadFan();
scene.add(fan.root);

// The fan def's own Volume (fanAssetDefs.ts), re-seated on this fan's top.
const COLUMN_HEIGHT = 6;
const volume: VolumeConfig = {
  bounds: { center: { x: 0, y: fan.top + COLUMN_HEIGHT / 2, z: 0 }, halfExtents: { x: 1.5, y: COLUMN_HEIGHT / 2, z: 1.5 } },
  force: { x: 0, y: 40, z: 0 },
  maxInducedSpeed: 10,
  priority: 1,
};
const column: Column = {
  base: fan.mouthY,
  height: fan.top + COLUMN_HEIGHT - fan.mouthY,
  mouthRadius: fan.mouthRadius,
  radius: volume.bounds.halfExtents.x,
};
let flow: AirFlow = createAirFlow(airVariant, column, volume, ENVIRONMENT_PRESETS[environmentId]);
scene.add(flow.object);
const rebuildFlow = (): void => {
  scene.remove(flow.object);
  flow.dispose();
  flow = createAirFlow(airVariant, column, volume, ENVIRONMENT_PRESETS[environmentId]);
  scene.add(flow.object);
};
const sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });

// ---------- BLIP ----------
const model = await loadCharacterModel();
const bounds = new THREE.Box3().setFromObject(model.scene);
const scale = CHARACTER_VISUAL_HEIGHT / bounds.getSize(new THREE.Vector3()).y;
model.scene.scale.setScalar(scale);
model.scene.position.y = -bounds.min.y * scale;
setShadowRole(model.scene, "caster");
const character = new THREE.Group();
character.add(model.scene);
character.rotation.y = Math.PI / 2;
scene.add(character);

let mixer = new THREE.AnimationMixer(model.scene);
let actions = loadCharacterActions(mixer, model.animations);
const timeline = jumpTimeline(actions);
if (!timeline) throw new Error("BLIP has no jump pieces");
let jumpSequences = new JumpSequences();
let activeAction: THREE.AnimationAction | null = null;
let floatAnimator: FloatAnimator | null = null;
const rebindAnimation = (): void => {
  mixer.stopAllAction();
  mixer.uncacheRoot(model.scene);
  mixer = new THREE.AnimationMixer(model.scene);
  actions = loadCharacterActions(mixer, model.animations);
  jumpSequences = new JumpSequences();
  activeAction = actions.idle;
  activeAction?.play();
  floatAnimator = animVariant === "today" ? null : new FloatAnimator(animVariant, model.scene, actions, timeline);
};
rebindAnimation();

// ---------- the scripted run: up to the fan, jump in, ride the updraft, drift out, land ----------
const START_X = -4.5;
const JUMP_AT_X = -2.2;
const RUN_SPEED = 5;
const HOVER_SECONDS = 6;
const LAND_X = 4;
type Phase = "wait" | "run-up" | "air" | "drift-out" | "rest";
const sim = { phase: "wait" as Phase, phaseTime: 0, x: START_X, y: 0, vx: 0, vy: 0, grounded: true, jumpHeldMs: 0, inVolume: false, hoverTime: 0 };
let previous = { x: sim.x, y: sim.y };

const floorBelow = (x: number): number => (Math.abs(x) < 0.95 ? fan.top : 0);
const setPhase = (phase: Phase): void => {
  sim.phase = phase;
  sim.phaseTime = 0;
};

const step = (): void => {
  sim.phaseTime += TICK_DT;
  switch (sim.phase) {
    case "wait":
      sim.vx = 0;
      if (sim.phaseTime > 1.2) setPhase("run-up");
      break;
    case "run-up":
      sim.vx = RUN_SPEED;
      if (sim.x >= JUMP_AT_X) {
        sim.vy = JUMP_VELOCITY;
        sim.grounded = false;
        sim.jumpHeldMs = 0;
        sim.hoverTime = 0;
        setPhase("air");
      }
      break;
    case "air":
      sim.vx = sim.x < 0 ? RUN_SPEED : 0;
      if (sim.x > 0 && sim.vx === 0) sim.x = 0;
      if (sim.inVolume) sim.hoverTime += TICK_DT;
      if (sim.hoverTime > HOVER_SECONDS && !stay) setPhase("drift-out");
      break;
    case "drift-out":
      sim.vx = sim.x < LAND_X ? 3.5 : 0;
      if (sim.grounded && sim.phaseTime > 0.3) setPhase("rest");
      break;
    case "rest":
      sim.vx = 0;
      if (sim.phaseTime > 1.6) {
        sim.x = START_X;
        previous = { x: sim.x, y: sim.y };
        setPhase("wait");
      }
      break;
  }

  const holding = !sim.grounded && sim.jumpHeldMs < JUMP_HOLD_MAX_MS && sim.vy > 0 && sim.phase === "air";
  sim.jumpHeldMs += TICK_DT * 1000;
  sim.vy += GRAVITY_Y * (holding ? JUMP_HOLD_GRAVITY_SCALE : 1) * TICK_DT;
  const centreY = sim.y + CAPSULE_BOTTOM_OFFSET;
  const b = volume.bounds;
  sim.inVolume =
    Math.abs(sim.x - b.center.x) <= b.halfExtents.x && Math.abs(centreY - b.center.y) <= b.halfExtents.y;
  if (sim.inVolume && sim.vy < volume.maxInducedSpeed) {
    sim.vy = Math.min(volume.maxInducedSpeed, sim.vy + volume.force.y * TICK_DT);
  }
  sim.x += sim.vx * TICK_DT;
  sim.y += sim.vy * TICK_DT;
  const floor = floorBelow(sim.x);
  if (sim.y <= floor && sim.vy <= 0) {
    sim.y = floor;
    sim.vy = 0;
    sim.grounded = true;
  } else if (sim.y > floor + 0.001) {
    sim.grounded = false;
  }
};

// ---------- UI ----------
const statePanel = document.getElementById("state")!;
const tuningPanel = document.getElementById("tuning")!;
const bar = document.getElementById("bar")!;

let rotorSpeed = 14;
const slider = (group: string, key: string, value: number, [min, max]: [number, number]): string =>
  `<label>${key}<input type="range" data-group="${group}" data-key="${key}" min="${min}" max="${max}" step="${(max - min) / 200}" value="${value}"><span>${value.toFixed(3)}</span></label>`;
const renderTuning = (): void => {
  let html = "";
  for (const group of AIR_GROUPS[airVariant]) {
    const values = AIR_TUNING_GROUPS[group] as Record<string, number>;
    html += `<h3>AIR — ${group.toUpperCase()}</h3>`;
    html += Object.keys(values)
      .map((key) => slider(group, key, values[key]!, AIR_RANGES[`${group}.${key}`]!))
      .join("");
  }
  if (animVariant !== "today") {
    html += `<h3>FLOAT — ${ANIM_NAMES[animVariant]}</h3>`;
    html += FLOAT_KEYS[animVariant].map((key) => slider("float", key, floatTuning[key], FLOAT_RANGES[key])).join("");
  }
  html += `<h3>ROTOR</h3>${slider("rotor", "spin rad/s", rotorSpeed, [0, 45])}`;
  html += `<p class="hint">Above ~47 rad/s the 4 blades strobe at 60 fps (45° per frame).</p>`;
  html += `<button id="copy">copy settings</button>`;
  tuningPanel.innerHTML = html;
};
tuningPanel.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  const value = Number(input.value);
  (input.nextElementSibling as HTMLElement).textContent = value.toFixed(3);
  const { group, key } = input.dataset;
  if (!group || !key) return;
  if (group === "rotor") rotorSpeed = value;
  else if (group === "float") (floatTuning as Record<string, number>)[key] = value;
  else (AIR_TUNING_GROUPS[group as keyof typeof AIR_TUNING_GROUPS] as Record<string, number>)[key] = value;
});
tuningPanel.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).id !== "copy") return;
  const settings = JSON.stringify(
    {
      air: airVariant,
      anim: animVariant,
      env: environmentId,
      airTuning: Object.fromEntries(AIR_GROUPS[airVariant].map((g) => [g, AIR_TUNING_GROUPS[g]])),
      floatTuning: animVariant === "today" ? undefined : floatTuning,
      rotorSpeed,
    },
    null,
    2,
  );
  console.log(settings);
  void navigator.clipboard?.writeText(settings);
});

const renderBar = (): void => {
  const i = AIR_VARIANTS.indexOf(airVariant);
  bar.innerHTML =
    `<button data-act="prev">←</button><span class="label">AIR ${i + 1}/${AIR_VARIANTS.length}: ${AIR_NAMES[airVariant]}</span><button data-act="next">→</button>` +
    `<span>|</span>` +
    ANIM_VARIANTS.map((v) => `<button data-act="anim:${v}" class="${animVariant === v ? "on" : ""}">${ANIM_NAMES[v]}</button>`).join("") +
    `<span>|</span><button data-act="stay" class="${stay ? "on" : ""}">STAY</button>` +
    `<button data-act="slow" class="${timeScale < 1 ? "on" : ""}">${timeScale}×</button>` +
    `<button data-act="env">ENV ${environmentId}</button>`;
};
const cycleAir = (by: number): void => {
  const i = (AIR_VARIANTS.indexOf(airVariant) + by + AIR_VARIANTS.length) % AIR_VARIANTS.length;
  airVariant = AIR_VARIANTS[i]!;
  rebuildFlow();
  writeParams();
  renderBar();
  renderTuning();
};
const setAnim = (next: AnimVariant): void => {
  animVariant = next;
  rebindAnimation();
  writeParams();
  renderBar();
  renderTuning();
};
const toggleStay = (): void => {
  stay = !stay;
  writeParams();
  renderBar();
};
const cycleSlow = (): void => {
  timeScale = TIME_SCALES[(TIME_SCALES.indexOf(timeScale) + 1) % TIME_SCALES.length]!;
  renderBar();
};
const cycleEnvironment = (): void => {
  environmentId = ENVIRONMENT_IDS[(ENVIRONMENT_IDS.indexOf(environmentId) + 1) % ENVIRONMENT_IDS.length]!;
  setEnvironment();
  // The puffs take the Environment's cloud colours.
  rebuildFlow();
  writeParams();
  renderBar();
};
bar.addEventListener("click", (event) => {
  const act = (event.target as HTMLElement).dataset.act;
  if (!act) return;
  if (act === "prev") cycleAir(-1);
  if (act === "next") cycleAir(1);
  if (act.startsWith("anim:")) setAnim(act.slice(5) as AnimVariant);
  if (act === "stay") toggleStay();
  if (act === "slow") cycleSlow();
  if (act === "env") cycleEnvironment();
});
addEventListener("keydown", (event) => {
  if ((event.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return;
  const key = event.key.toLowerCase();
  if (event.key === "ArrowLeft") cycleAir(-1);
  if (event.key === "ArrowRight") cycleAir(1);
  if (key === "a") setAnim(ANIM_VARIANTS[(ANIM_VARIANTS.indexOf(animVariant) + 1) % ANIM_VARIANTS.length]!);
  if (key === "h") toggleStay();
  if (key === "s") cycleSlow();
  if (key === "e") cycleEnvironment();
});
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
writeParams();
renderBar();
renderTuning();

// ---------- loop ----------
let last = performance.now();
/** The prototype's own clock (ms), slowed with the rest of the scene. */
let clock = 0;
let accumulator = 0;
const resolution = new THREE.Vector2();
renderer.setAnimationLoop((now) => {
  const delta = Math.min(0.1, (now - last) / 1000) * timeScale;
  last = now;
  clock += delta * 1000;
  accumulator += delta;
  while (accumulator >= TICK_DT) {
    previous = { x: sim.x, y: sim.y };
    step();
    accumulator -= TICK_DT;
  }
  const alpha = accumulator / TICK_DT;
  character.position.set(THREE.MathUtils.lerp(previous.x, sim.x, alpha), THREE.MathUtils.lerp(previous.y, sim.y, alpha), 0);

  const moving = sim.vx !== 0 && sim.grounded;
  let animationState: string;
  if (floatAnimator) {
    animationState = floatAnimator.frame(
      {
        grounded: sim.grounded,
        verticalVelocity: sim.vy,
        heightAboveFloor: character.position.y - floorBelow(sim.x),
        inUpdraft: sim.inVolume,
        moving,
        deltaSeconds: delta,
        nowMs: clock,
      },
      mixer,
    );
    const missing = floatAnimator.missingBones;
    if (missing.length > 0) animationState += `\nmissing bones: ${missing.join(", ")}`;
  } else {
    // Exactly the Stage's path (scene.ts updateCharacterAnimation), minus Grab/Hit.
    const playhead = jumpSequences.advance(
      "local",
      { grounded: sim.grounded, verticalVelocity: sim.vy, height: character.position.y, moving, deltaSeconds: delta, nowMs: clock },
      timeline,
    );
    const pose = playhead === null ? null : jumpPoseAt(playhead, actions);
    const next = pose?.action ?? (moving ? actions.walk : actions.idle);
    activeAction = crossfadeLocomotion(next, activeAction, pose ? JUMP_CROSSFADE_SECONDS : 0.15);
    if (pose) pinClipPose(pose);
    mixer.update(delta);
    animationState = `playhead ${playhead === null ? "—" : playhead.toFixed(3)} (${pose ? pose.action.getClip().name : "locomotion"})`;
  }

  fan.rotor.rotation.y -= rotorSpeed * delta;
  controls.update();
  environment?.update(camera, now, { x: 0, y: 2, z: 0 });

  renderer.getDrawingBufferSize(resolution);
  if (flow.needsSceneTexture) {
    if (sceneTarget.width !== resolution.x || sceneTarget.height !== resolution.y) sceneTarget.setSize(resolution.x, resolution.y);
    flow.object.visible = false;
    renderer.setRenderTarget(sceneTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    flow.object.visible = true;
  }
  flow.update(clock, flow.needsSceneTexture ? sceneTarget.texture : null, resolution, camera.position);
  renderer.render(scene, camera);

  statePanel.textContent =
    `phase ${sim.phase}${stay ? " (stay)" : ""}  time ${timeScale}×\n` +
    `grounded ${sim.grounded}  in updraft ${sim.inVolume}\n` +
    `vy ${sim.vy.toFixed(2)}  feet y ${sim.y.toFixed(2)}\n` +
    `anim ${ANIM_NAMES[animVariant]}\n${animationState}\n` +
    `air ${airVariant}  env ${environmentId}`;
});
