import * as THREE from "three";
import {
  accelerateVelocity,
  DASH_SPEED,
  movementDirection,
  MOVE_ACCEL_FACTOR,
  MOVE_FRICTION_FACTOR,
  TICK_DT,
  WALK_SPEED,
  type MovementKeys,
  type Vec3,
} from "@dont-fall/shared";
import {
  actionFor,
  type CharacterActions,
  crossfadeLocomotion,
  loadCharacterActions,
  loadCharacterModel,
  LOCOMOTION_CROSSFADE_SECONDS,
} from "../render/characterModel.js";
import { selectLocomotion } from "../render/locomotionAnimation.js";
import { nextModelYaw } from "../render/modelFacing.js";
import { RubberBody } from "../render/rubberBody.js";
import { advanceBodyLean, BODY_LEAN, restBodyLean, type BodyLeanTuning } from "../render/bodyLean.js";

/**
 * BLIP on an open floor, driven with the keys, so the lean can be found by
 * steering it (the user's ask, 2026-09-21). A second dev page beside
 * `rubber.html` rather than a mode inside it: that bench is a rig on a stand
 * playing clips, and a lean only exists while something is actually turning.
 *
 * What it runs is the real thing, not a sketch of it. The movement is
 * `accelerateVelocity` from `packages/shared` at the real {@link TICK_DT},
 * the body is turned by `nextModelYaw` at the real rate, and the lean is
 * `bodyLean.ts` — so a number that feels right here is a number that can be
 * copied into the game. The two sliders that are *not* in the shipped code
 * are deliberate: GRIP multiplies the accelerate/friction pair exactly as a
 * Surface's own `grip` does, and TURN is `nextModelYaw`'s own `turnScale`.
 * At GRIP 1 the movement is today's, which reaches top speed in one tick.
 *
 * Dev-only, and no test looks at it: it exists precisely because no test in
 * this repo can rasterise a rig.
 */

// --- what the sliders drive -------------------------------------------------

const lean: BodyLeanTuning & { on: boolean } = { ...BODY_LEAN, on: true };
const drive = {
  /** Multiplies `MOVE_ACCEL_FACTOR`/`MOVE_FRICTION_FACTOR` together, as a Surface's `grip` does. 1 is today. */
  grip: 1,
  /** `nextModelYaw`'s `turnScale` — 1 is the shipped `FACING_TURN_RATE`. */
  turn: 1,
  /** The wish speed the keys ask for (units/s). */
  topSpeed: WALK_SPEED,
  squash: true,
  /**
   * Drives a steady circle instead of reading the keys. Camera-relative input
   * means a held turn is a mouse being swung, not a key being held — which is
   * exactly the wrong thing to be doing while judging a slider. The camera is
   * deliberately left wherever it was dragged, so the body circles *past* a
   * fixed viewpoint and the bank can be read against a world that is holding
   * still.
   */
  circle: false,
  /** How fast the circle turns (rad/s). */
  circleRate: 2,
};

// --- page -------------------------------------------------------------------

const view = document.getElementById("view")!;
const panel = document.getElementById("panel")!;
const status = document.getElementById("status")!;
const hint = document.getElementById("hint")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14130f);
scene.fog = new THREE.Fog(0x14130f, 22, 60);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x544d3e, 2.2));
const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.top = sun.shadow.camera.right = 8;
sun.shadow.camera.bottom = sun.shadow.camera.left = -8;
scene.add(sun, sun.target);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x3a362c, roughness: 1 }),
);
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(120, 120, 0x4a463a, 0x322f27);
grid.position.y = 0.002;
scene.add(grid);

// Posts, because a bank is only legible against something standing still —
// on a bare floor the whole world tips with the body and reads as nothing.
const postGeometry = new THREE.CylinderGeometry(0.16, 0.16, 2.4, 10);
const postMaterial = new THREE.MeshStandardMaterial({ color: 0x6a6252, roughness: 0.9 });
for (let ring = 1; ring <= 3; ring += 1) {
  const radius = ring * 7;
  const count = ring * 8;
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + ring * 0.4;
    const post = new THREE.Mesh(postGeometry, postMaterial);
    post.position.set(Math.sin(angle) * radius, 1.2, Math.cos(angle) * radius);
    post.castShadow = true;
    scene.add(post);
  }
}

const resize = (): void => {
  const { clientWidth: w, clientHeight: h } = view;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
new ResizeObserver(resize).observe(view);

// --- keys and look ----------------------------------------------------------

const keys: MovementKeys = { forward: false, back: false, left: false, right: false };
const KEY_MAP: Record<string, keyof MovementKeys> = {
  KeyW: "forward",
  KeyS: "back",
  KeyA: "left",
  KeyD: "right",
  ArrowUp: "forward",
  ArrowDown: "back",
  ArrowLeft: "left",
  ArrowRight: "right",
};
let sprinting = false;
addEventListener("keydown", (event) => {
  const key = KEY_MAP[event.code];
  if (key) {
    keys[key] = true;
    event.preventDefault();
  }
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") sprinting = true;
});
addEventListener("keyup", (event) => {
  const key = KEY_MAP[event.code];
  if (key) keys[key] = false;
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") sprinting = false;
});
addEventListener("blur", () => {
  for (const key of Object.keys(keys) as (keyof MovementKeys)[]) keys[key] = false;
  sprinting = false;
});

/** Camera yaw in the convention `movementDirection` reads: 0 looks toward −Z. */
let lookYaw = 0;
let lookPitch = 0.3;
let cameraDistance = 9;
let dragging = false;
renderer.domElement.addEventListener("pointerdown", (event) => {
  dragging = true;
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener("pointerup", (event) => {
  dragging = false;
  renderer.domElement.releasePointerCapture(event.pointerId);
});
renderer.domElement.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  lookYaw -= event.movementX * 0.005;
  lookPitch = Math.max(-0.35, Math.min(1.1, lookPitch + event.movementY * 0.004));
});
renderer.domElement.addEventListener(
  "wheel",
  (event) => {
    cameraDistance = Math.max(2.5, Math.min(16, cameraDistance + event.deltaY * 0.004));
    event.preventDefault();
  },
  { passive: false },
);

// --- the simulation, at the real tick rate ----------------------------------

let position: Vec3 = { x: 0, y: 0, z: 0 };
let previousPosition: Vec3 = { ...position };
let velocity: Vec3 = { x: 0, y: 0, z: 0 };
/** Speed along the way the body is turned, and its rate of change — the pitch driver. */
let forwardSpeed = 0;
let forwardAccel = 0;
let accumulator = 0;

const step = (wish: Vec3, bodyYaw: number): void => {
  previousPosition = { ...position };
  velocity = accelerateVelocity(
    velocity,
    wish,
    MOVE_ACCEL_FACTOR * drive.grip,
    MOVE_FRICTION_FACTOR * drive.grip,
  );
  position = {
    x: position.x + velocity.x * TICK_DT,
    y: 0,
    z: position.z + velocity.z * TICK_DT,
  };
  // Measured per tick, not per frame: velocity is a step function between
  // ticks, so a per-frame difference is zero on most frames and a spike on
  // the rest — which the spring would faithfully reproduce as a twitch.
  const forward = { x: Math.sin(bodyYaw), z: Math.cos(bodyYaw) };
  const nextForwardSpeed = velocity.x * forward.x + velocity.z * forward.z;
  forwardAccel = (nextForwardSpeed - forwardSpeed) / TICK_DT;
  forwardSpeed = nextForwardSpeed;
};

const wrapAngle = (angle: number): number =>
  ((((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;

// --- panel ------------------------------------------------------------------

const el = <T extends HTMLElement>(html: string): T => {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild as T;
};

const section = (title: string, node: HTMLElement): void => {
  panel.append(el(`<h2>${title}</h2>`), node);
};

interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (value: number) => string;
  onInput: (value: number) => void;
}

const sliders = (specs: readonly SliderSpec[]): HTMLElement => {
  const wrap = el("<div></div>");
  for (const spec of specs) {
    const row = el<HTMLElement>(
      `<div class=row><label>${spec.label}</label><input type=range><output></output></div>`,
    );
    const input = row.querySelector("input")!;
    const out = row.querySelector("output")!;
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(spec.value);
    const show = (value: number): void => {
      out.textContent = spec.format ? spec.format(value) : value.toFixed(2);
    };
    show(spec.value);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      show(value);
      spec.onInput(value);
    });
    wrap.append(row);
  }
  return wrap;
};

const toggle = (label: string, on: boolean, onChange: (on: boolean) => void): HTMLButtonElement => {
  const button = el<HTMLButtonElement>(`<button>${label}</button>`);
  button.classList.toggle("on", on);
  button.addEventListener("click", () => {
    const next = !button.classList.contains("on");
    button.classList.toggle("on", next);
    onChange(next);
  });
  return button;
};

const meters = el("<div id=meters></div>");
const meter = (label: string): HTMLElement => {
  const row = el<HTMLElement>(`<div class=m><span>${label}</span><b>—</b></div>`);
  meters.append(row);
  return row.querySelector("b")!;
};

panel.append(
  el("<h1>Body lean</h1>"),
  el("<p class=sub>WASD to run, drag to look, wheel to zoom, shift for dash speed. dev-only.</p>"),
);

const leanButton = toggle("LEAN", lean.on, (on) => {
  lean.on = on;
});
const squashButton = toggle("SQUASH", drive.squash, (on) => {
  drive.squash = on;
});
const circleButton = toggle("CIRCLE", drive.circle, (on) => {
  drive.circle = on;
});
const buttons = el("<div class='grid g2'></div>");
buttons.append(leanButton, squashButton);
const circleRow = el("<div class=grid></div>");
circleRow.append(circleButton);
section("layers", buttons);
section("hands off", circleRow);
circleRow.append(
  sliders([
    {
      label: "circle rate",
      min: 0.2,
      max: 6,
      step: 0.1,
      value: drive.circleRate,
      format: (v) => `${v.toFixed(1)}/s`,
      onInput: (v) => (drive.circleRate = v),
    },
  ]),
);

section(
  "bank — into the turn",
  sliders([
    { label: "share", min: 0, max: 1.2, step: 0.01, value: lean.bankShare, onInput: (v) => (lean.bankShare = v) },
    {
      label: "max",
      min: 0,
      max: 0.9,
      step: 0.01,
      value: lean.bankMax,
      format: (v) => `${((v * 180) / Math.PI).toFixed(0)}°`,
      onInput: (v) => (lean.bankMax = v),
    },
  ]),
);

section(
  "pitch — into the speed",
  sliders([
    { label: "share", min: 0, max: 1.2, step: 0.01, value: lean.pitchShare, onInput: (v) => (lean.pitchShare = v) },
    {
      label: "max",
      min: 0,
      max: 0.9,
      step: 0.01,
      value: lean.pitchMax,
      format: (v) => `${((v * 180) / Math.PI).toFixed(0)}°`,
      onInput: (v) => (lean.pitchMax = v),
    },
  ]),
);

section(
  "the spring",
  sliders([
    { label: "stiffness", min: 1, max: 20, step: 0.1, value: lean.hz, onInput: (v) => (lean.hz = v) },
    { label: "damping", min: 0.1, max: 1, step: 0.01, value: lean.zeta, onInput: (v) => (lean.zeta = v) },
    { label: "in the air", min: 0, max: 1, step: 0.01, value: lean.airShare, onInput: (v) => (lean.airShare = v) },
  ]),
);

section(
  "movement",
  sliders([
    {
      // Logarithmic, because everything interesting is in the first 2% of the
      // range: at grip 1 the accelerate saturates and top speed arrives in one
      // tick, and ice already ships at 0.001.
      label: "grip",
      min: 0,
      max: 100,
      step: 1,
      value: 100,
      format: () => (drive.grip >= 1 ? "1 (now)" : drive.grip.toFixed(3)),
      onInput: (v) => {
        drive.grip = 10 ** ((v / 100) * 3 - 3);
      },
    },
    { label: "turn rate", min: 0.2, max: 2.5, step: 0.05, value: drive.turn, onInput: (v) => (drive.turn = v) },
    {
      label: "top speed",
      min: 1,
      max: DASH_SPEED,
      step: 0.1,
      value: drive.topSpeed,
      onInput: (v) => (drive.topSpeed = v),
    },
  ]),
);

section("what it is doing", meters);
const speedMeter = meter("speed");
const yawRateMeter = meter("turning");
const lateralMeter = meter("sideways");
const bankMeter = meter("bank");
const pitchMeter = meter("pitch");

const copyButton = el<HTMLButtonElement>("<button>COPY THESE NUMBERS</button>");
copyButton.addEventListener("click", () => {
  const rounded = (value: number): string => value.toFixed(3).replace(/\.?0+$/, "");
  const text = [
    "BODY_LEAN (bodyLean.ts)",
    `  bankShare: ${rounded(lean.bankShare)},`,
    `  bankMax: ${rounded(lean.bankMax)},   // ${((lean.bankMax * 180) / Math.PI).toFixed(0)}°`,
    `  pitchShare: ${rounded(lean.pitchShare)},`,
    `  pitchMax: ${rounded(lean.pitchMax)},  // ${((lean.pitchMax * 180) / Math.PI).toFixed(0)}°`,
    `  hz: ${rounded(lean.hz)},`,
    `  zeta: ${rounded(lean.zeta)},`,
    `  airShare: ${rounded(lean.airShare)},`,
    "",
    `movement: grip ${drive.grip.toFixed(4)} (×MOVE_ACCEL_FACTOR/MOVE_FRICTION_FACTOR),` +
      ` turnScale ${drive.turn.toFixed(2)} (×FACING_TURN_RATE), top speed ${drive.topSpeed.toFixed(1)} u/s`,
  ].join("\n");
  void navigator.clipboard.writeText(text).then(
    () => (copyButton.textContent = "COPIED"),
    () => (copyButton.textContent = "CLIPBOARD REFUSED"),
  );
  setTimeout(() => (copyButton.textContent = "COPY THESE NUMBERS"), 1400);
});
section("", copyButton);

// --- the loop ---------------------------------------------------------------

const MAX_FRAME_SECONDS = 0.25;

const main = async (): Promise<void> => {
  const model = await loadCharacterModel();
  status.remove();

  model.scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  // The rig hangs in a group of its own, exactly as the game's local
  // Character does: the group carries the yaw and the lean, the loader's own
  // scene carries the squash, and no clip addresses either.
  const rig = new THREE.Group();
  rig.rotation.order = "YXZ";
  rig.add(model.scene);
  scene.add(rig);

  const mixer = new THREE.AnimationMixer(model.scene);
  const actions: CharacterActions = loadCharacterActions(mixer, model.animations);
  let activeAction: THREE.AnimationAction | null = null;
  let walking = false;

  const softBody = new RubberBody(model.scene);
  const pelvis = model.scene.getObjectByName("pelvis");
  const pelvisLocal = new THREE.Vector3();
  const bodyHeight = (): number => model.scene.worldToLocal(pelvis!.getWorldPosition(pelvisLocal)).y;

  const leanState = restBodyLean();
  let bodyYaw = 0;
  let yawRate = 0;
  let circleAngle = 0;

  const drawn = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3(0, 1, 0);
  const cameraWanted = new THREE.Vector3();

  let lastMs: number | null = null;
  let showMs = 0;

  renderer.setAnimationLoop((nowMs) => {
    const delta = lastMs === null ? 0 : Math.min((nowMs - lastMs) / 1000, MAX_FRAME_SECONDS);
    lastMs = nowMs;
    showMs += delta * 1000;

    if (drive.circle) circleAngle += drive.circleRate * delta;
    const moveDirection = drive.circle
      ? { x: Math.sin(circleAngle), y: 0, z: Math.cos(circleAngle) }
      : movementDirection(keys, lookYaw);
    const moving = moveDirection.x !== 0 || moveDirection.z !== 0;
    const topSpeed = sprinting ? DASH_SPEED : drive.topSpeed;

    // The body turns every frame, as the game's does — `nextModelYaw` is a
    // render-rate ease, not a tick one.
    const previousYaw = bodyYaw;
    bodyYaw = nextModelYaw({ currentYaw: bodyYaw, moveDirection, deltaSeconds: delta, turnScale: drive.turn });
    yawRate = delta > 0 ? wrapAngle(bodyYaw - previousYaw) / delta : 0;

    accumulator += delta;
    let steps = 0;
    while (accumulator >= TICK_DT && steps < 8) {
      step({ x: moveDirection.x * topSpeed, y: 0, z: moveDirection.z * topSpeed }, bodyYaw);
      accumulator -= TICK_DT;
      steps += 1;
    }
    if (steps === 8) accumulator = 0;

    const alpha = Math.min(1, accumulator / TICK_DT);
    drawn.set(
      previousPosition.x + (position.x - previousPosition.x) * alpha,
      0,
      previousPosition.z + (position.z - previousPosition.z) * alpha,
    );
    rig.position.copy(drawn);

    const speed = Math.hypot(velocity.x, velocity.z);
    const { pitch, roll } = advanceBodyLean(
      leanState,
      { speed, yawRate, forwardAccel, grounded: true, deltaSeconds: delta },
      lean,
    );
    rig.rotation.set(lean.on ? pitch : 0, bodyYaw, lean.on ? roll : 0);

    const state = selectLocomotion({ moving, grounded: true, dashing: sprinting, speed, walking });
    walking = state === "walk";
    activeAction = crossfadeLocomotion(actionFor(state, actions), activeAction, LOCOMOTION_CROSSFADE_SECONDS, actions);
    mixer.update(delta);
    if (pelvis) softBody.follow(bodyHeight(), delta, drive.squash ? 1 : 0);
    softBody.apply(showMs, drive.squash ? 1 : 0);

    // The camera is a plain arm on the look angles — deliberately not a spring:
    // a camera with its own lag would be indistinguishable, from the driver's
    // seat, from the lean this page exists to judge.
    cameraTarget.lerp(drawn.clone().setY(1), 1 - Math.exp(-14 * Math.max(delta, 1 / 240)));
    const horizontal = Math.cos(lookPitch) * cameraDistance;
    cameraWanted.set(
      cameraTarget.x + Math.sin(lookYaw) * horizontal,
      cameraTarget.y + Math.sin(lookPitch) * cameraDistance,
      cameraTarget.z + Math.cos(lookYaw) * horizontal,
    );
    camera.position.copy(cameraWanted);
    camera.lookAt(cameraTarget);
    sun.position.set(drawn.x + 4, 9, drawn.z + 5);
    sun.target.position.copy(drawn);

    const lateral = speed * yawRate;
    speedMeter.textContent = `${speed.toFixed(2)} u/s`;
    yawRateMeter.textContent = `${yawRate.toFixed(2)} rad/s`;
    lateralMeter.textContent = `${lateral.toFixed(2)} u/s²  ·  ${(lateral / 9.81).toFixed(2)} g`;
    bankMeter.textContent = `${((roll * 180) / Math.PI).toFixed(1)}°`;
    pitchMeter.textContent = `${((pitch * 180) / Math.PI).toFixed(1)}°  ·  ${forwardAccel.toFixed(1)} u/s²`;

    // At grip 1 the shipped model reaches top speed inside one tick; said out
    // loud because it is the single thing most likely to be mistaken for the
    // page not working.
    const reach = drive.grip >= 1 ? "one tick (today)" : `${(1000 / (MOVE_ACCEL_FACTOR * drive.grip)).toFixed(0)} ms-ish`;
    hint.textContent =
      `grip ${drive.grip.toFixed(3)} — top speed in ${reach}   ·   turn ×${drive.turn.toFixed(2)}` +
      (drive.circle ? "   ·   CIRCLE — drag to watch it from anywhere" : "");

    renderer.render(scene, camera);
  });
};

void main().catch((error: unknown) => {
  status.textContent = `BLIP failed to load: ${String(error)}`;
});
