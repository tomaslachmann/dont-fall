import {
  type ImpactOutcome,
  type MotionEasing,
  type MotionSlide,
  type MotionSpin,
  type MotionSwing,
  type Module,
  type SegmentMotion,
  type Box,
  type Vec3,
} from "@dont-fall/shared";
import {
  AXES,
  defaultSlide,
  defaultSpin,
  defaultSwing,
  GRID_STEPS,
  gridCellOf,
  gridPivot,
  matchShape,
  nearestAxis,
  SPIN_SHAPES,
  spinShape,
  SWING_SHAPES,
  swingShape,
  type GridStep,
  PIVOT_PRESETS,
  pivotPreset,
  readNumber,
  toDegrees,
  toRadians,
  type AxisName,
  type PivotPreset,
} from "./motionForm.js";
import {
  cycleFraction,
  describeSlide,
  describeSpin,
  describeSwing,
  EASING_HINTS,
  footprintCorners,
  sampleCycle,
  secondsForFraction,
  speedOutcome,
  topSpeedAt,
  type CycleSample,
} from "./motionPreview.js";
import { slideSummary, spinSummary, swingSummary } from "./motionSummary.js";
import { IMPACT } from "./lib/impact.js";
import type { ImpactKind } from "./types/builder.js";
import cardCss from "./components/MotionCard/MotionCard.module.css";
import chipCss from "./components/Chip/Chip.module.css";
import fieldCss from "./components/Field/Field.module.css";
import noteCss from "./components/ImpactNote/ImpactNote.module.css";
import padCss from "./components/PivotPad/PivotPad.module.css";
import panelCss from "./components/MotionPanel/MotionPanel.module.css";
import pickCss from "./components/PickButton/PickButton.module.css";
import stripCss from "./components/TimingStrip/TimingStrip.module.css";

export interface MotionPanel {
  /**
   * Show the selected Segment's Motion for editing, or hide the panel
   * (`module` undefined). `parts` are the Module's mesh bounds (`templateParts`),
   * which let shapes like Arm find a post. A group hides the cards with a
   * note — motion is single-select only.
   */
  show: (
    module: Module | undefined,
    motion: SegmentMotion | undefined,
    parts?: readonly Box[],
    scale?: number,
    selectedCount?: number,
  ) => void;
  /** Move the timing strips' playheads to transport time `seconds` — called every frame. */
  setClock: (seconds: number) => void;
}

type Kind = "spin" | "swing" | "slide";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * CSS-module classes type as `string | undefined` (`noUncheckedIndexedAccess`
 * over the `*.module.css` index signature) — join them into the `string` the
 * DOM APIs require. At runtime every key exists; this is purely the type gate.
 */
const cx = (...parts: (string | undefined)[]): string => parts.filter((part) => part !== undefined).join(" ");

/** Every editable field the panel creates, so each can emit a change — the panel's own registry, no DOM querying. */
type Field = HTMLInputElement | HTMLSelectElement;

/** The design's easing order and short labels — the data stays `MOTION_EASINGS` ids. */
const EASING_DISPLAY: { easing: MotionEasing; label: string; curve: string }[] = [
  { easing: "linear", label: "LINEAR", curve: "M1 15 25 1" },
  { easing: "easeInOut", label: "IN-OUT", curve: "M1 15C9 15 17 1 25 1" },
  { easing: "easeOut", label: "OUT", curve: "M1 15C15 15 19 1 25 1" },
  { easing: "easeIn", label: "IN", curve: "M1 15C7 15 11 1 25 1" },
];

const outcomeBand = (outcome: ImpactOutcome): ImpactKind =>
  outcome === "ragdoll" ? "knockdown" : outcome === "stagger" ? "stagger" : "carry";

/**
 * The inspector's Motion editor (M11 ticket 06, ADR 0061): Spin, Swing and
 * Slide, each switched on independently (they compose spin → swing → slide),
 * in degrees and seconds while the data stays radians. Every change emits the
 * whole resulting Motion — `undefined` once no kind is on — for one undoable
 * Track edit; switching a kind on starts from a default sized to the Module.
 *
 * An imperative island in the React shell (like the 3D viewport): dozens of
 * mutually-writing fields, canvas strips and scrub don't belong in a render
 * function. It reuses the design's own CSS modules directly.
 */
export const createMotionPanel = (
  container: HTMLElement,
  onChange: (motion: SegmentMotion | undefined) => void,
  /** Asks the builder for one click on the model; `apply` receives the picked part's centre. */
  onPickPivot: (apply: (pivot: Vec3) => void) => void,
  /** Set the transport clock to `seconds` (dragging a timing strip's playhead). */
  onScrub: (seconds: number) => void,
): MotionPanel => {
  let module: Module | undefined;
  let parts: readonly Box[] = [];
  let scale = 1;
  let clock = 0;
  let current: SegmentMotion = {};
  const f: Field[] = [];

  const head = el("header", panelCss.head);
  head.appendChild(el("h3", panelCss.title, "Motion"));
  const order = el("span", panelCss.order, "SPIN → SWING → SLIDE");
  head.appendChild(order);
  container.appendChild(head);

  const groupNote = el(
    "p",
    panelCss.groupNote,
    "Motion edits one segment at a time. Transform, dupe, delete and size stay live for the group.",
  );
  groupNote.hidden = true;
  container.appendChild(groupNote);

  /** A Field: label over a recessed trough holding a real input. */
  const textField = (
    parent: HTMLElement,
    label: string,
    step: number | string,
    opts?: { type?: string; width?: number },
  ): HTMLInputElement => {
    const wrap = el("label", fieldCss.wrap);
    if (opts?.width !== undefined) wrap.style.width = `${opts.width}px`;
    wrap.appendChild(el("span", fieldCss.label, label));
    const box = el("span", `${fieldCss.box} ${fieldCss.numeric}`);
    const input = el("input", fieldCss.input);
    input.type = opts?.type ?? "number";
    input.step = String(step);
    box.appendChild(input);
    wrap.appendChild(box);
    parent.appendChild(wrap);
    f.push(input);
    return input;
  };

  /** A Field trough holding a native select (plus the design's caret). */
  const selectField = (parent: HTMLElement, label: string, options: readonly string[]): HTMLSelectElement => {
    const wrap = el("label", fieldCss.wrap);
    wrap.appendChild(el("span", fieldCss.label, label));
    const box = el("span", `${fieldCss.box} ${fieldCss.select}`);
    const select = el("select", fieldCss.input);
    for (const option of options) {
      const node = el("option", undefined, option);
      node.value = option;
      select.appendChild(node);
    }
    box.appendChild(select);
    box.appendChild(el("span", fieldCss.caret, "⌄"));
    wrap.appendChild(box);
    parent.appendChild(wrap);
    f.push(select);
    return select;
  };

  const chip = (parent: HTMLElement, label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const button = el("button", `${chipCss.chip} ${chipCss.quiet}`, label);
    button.type = "button";
    button.title = title;
    button.addEventListener("click", onClick);
    parent.appendChild(button);
    return button;
  };

  const lightChips = <K>(chips: Map<K, HTMLButtonElement>, active: K | undefined): void => {
    for (const [key, button] of chips) {
      const on = key === active;
      button.classList.toggle(cx(chipCss.brand), on);
      button.classList.toggle(cx(chipCss.quiet), !on);
    }
  };

  type Vector = [HTMLInputElement, HTMLInputElement, HTMLInputElement];

  const readVec = ([x, y, z]: Vector, fallback: Vec3): Vec3 => ({
    x: readNumber(x.value, fallback.x),
    y: readNumber(y.value, fallback.y),
    z: readNumber(z.value, fallback.z),
  });

  const writeVec = (fields: Vector, v: Vec3): void => {
    fields[0].value = String(Math.round(v.x * 1000) / 1000);
    fields[1].value = String(Math.round(v.y * 1000) / 1000);
    fields[2].value = String(Math.round(v.z * 1000) / 1000);
  };

  const sameVec = (a: Vec3, b: Vec3): boolean => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) < 1e-6;

  const setAxisAndPivot = (
    kind: "spin" | "swing",
    toggle: () => void,
    axisSelect: HTMLSelectElement,
    pivot: Vector,
    shape: { axis: Vec3; pivot: Vec3 },
  ): void => {
    toggle();
    axisSelect.value = nearestAxis(shape.axis);
    writeVec(pivot, shape.pivot);
    emit();
  };

  /** One card: off collapses to head-only, on expands to presets → sentence → strip → fields → pivot → easing. */
  const sections = {} as Record<
    Kind,
    { card: HTMLElement; head: HTMLButtonElement; box: HTMLElement; summary: HTMLElement; body: HTMLElement; enabled: () => boolean; setEnabled: (on: boolean) => void }
  >;
  const addSection = (kind: Kind, title: string): HTMLElement => {
    const card = el("div", `${cardCss.card} ${cardCss.off}`);
    const headButton = el("button", cardCss.head);
    headButton.type = "button";
    const box = el("span", cardCss.box);
    const name = el("span", `${cardCss.name} ${cardCss.nameOff}`, title);
    const summary = el("span", cardCss.state, "OFF");
    headButton.append(box, name, summary);
    card.appendChild(headButton);
    const body = el("div", cardCss.body);
    body.hidden = true;
    card.appendChild(body);
    container.appendChild(card);
    let on = false;
    const paint = (): void => {
      card.classList.toggle(cx(cardCss.off), !on);
      box.classList.toggle(cx(cardCss.boxOn), on);
      box.textContent = on ? "✓" : "";
      name.classList.toggle(cx(cardCss.nameOff), !on);
      summary.className = on ? cx(cardCss.summary) : cx(cardCss.state);
      if (!on) summary.textContent = "OFF";
      body.hidden = !on;
    };
    headButton.addEventListener("click", () => {
      on = !on;
      paint();
      emit();
    });
    sections[kind] = {
      card,
      head: headButton,
      box,
      summary,
      body,
      enabled: () => on,
      setEnabled: (next) => {
        on = next;
        paint();
      },
    };
    return body;
  };

  /** The sentence: left stripe + glyph + the consequence in words (the Impact legend's own bands). */
  const says = (parent: HTMLElement): { line: HTMLElement; glyph: HTMLElement; text: HTMLElement } => {
    const line = el("p", `${noteCss.note} ${noteCss.carry}`);
    const glyph = el("span", noteCss.glyph, IMPACT.carry.glyph);
    const text = el("span", noteCss.text);
    line.append(glyph, text);
    parent.appendChild(line);
    return { line, glyph, text };
  };

  const colourNote = (
    note: { line: HTMLElement; glyph: HTMLElement; text: HTMLElement },
    text: string,
    outcome: ImpactOutcome,
  ): void => {
    const band = outcomeBand(outcome);
    note.line.className = cx(noteCss.note, band === "carry" ? noteCss.carry : band === "stagger" ? noteCss.stagger : noteCss.knockdown);
    note.glyph.textContent = IMPACT[band].glyph;
    note.text.textContent = text;
  };

  const context2d = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | undefined => {
    const ctx = canvas.getContext("2d");
    return ctx && typeof ctx.fillRect === "function" ? ctx : undefined;
  };

  /** One period of a Swing or Slide: its shape, its holds, its danger, and "now". Canvas-drawn from the sim's own sampling — the shape is data, never decoration. */
  const timingStrip = (parent: HTMLElement, kind: "swing" | "slide") => {
    const wrap = el("div", stripCss.wrap);
    const caption = el("span", stripCss.caption);
    const strip = el("div", cx(stripCss.strip, kind === "swing" ? stripCss.swing : stripCss.slide));
    strip.style.height = "38px";
    const canvas = el("canvas");
    canvas.width = 280;
    canvas.height = 38;
    canvas.className = cx(stripCss.curve);
    const playhead = el("span", stripCss.playhead);
    const knob = el("span", stripCss.knob);
    strip.append(canvas, playhead, knob);
    wrap.append(caption, strip);
    parent.appendChild(wrap);
    let dragging = false;
    const scrubTo = (clientX: number): void => {
      const timing = current[kind];
      if (!timing) return;
      const rect = strip.getBoundingClientRect();
      const u = Math.min(0.999, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
      onScrub(secondsForFraction(timing, u, clock));
    };
    strip.addEventListener("pointerdown", (e) => {
      dragging = true;
      scrubTo(e.clientX);
    });
    strip.addEventListener("pointermove", (e) => {
      if (dragging) scrubTo(e.clientX);
    });
    const stop = (): void => {
      dragging = false;
    };
    strip.addEventListener("pointerup", stop);
    strip.addEventListener("pointerleave", stop);
    return { canvas, playhead, knob, caption };
  };

  const drawStrip = (strip: ReturnType<typeof timingStrip>, samples: readonly CycleSample[], period: number): void => {
    strip.caption.textContent = `ONE CYCLE = ${Math.round(period * 10) / 10} S · UP = FAR END · DRAG TO SCRUB`;
    const ctx = context2d(strip.canvas);
    if (!ctx || samples.length === 0) return;
    const { width: w, height: h } = strip.canvas;
    ctx.clearRect(0, 0, w, h);
    const step = w / samples.length;
    ctx.lineWidth = 2.5;
    for (let i = 1; i <= samples.length; i += 1) {
      const a = samples[i - 1]!;
      const b = samples[i % samples.length]!;
      ctx.strokeStyle = a.holding ? "#8ba0b8" : "#2b1b4d";
      ctx.beginPath();
      ctx.moveTo((i - 1) * step, h - 4 - a.position * (h - 8));
      ctx.lineTo(i * step, h - 4 - b.position * (h - 8));
      ctx.stroke();
    }
  };

  const worst = (samples: readonly CycleSample[]) =>
    samples.some((s) => s.outcome === "ragdoll") ? "ragdoll" : samples.some((s) => s.outcome === "stagger") ? "stagger" : "none";

  const GRID_GLYPHS: Record<string, [string, string]> = {
    "-1,-1": ["◤", "front-left corner"],
    "0,-1": ["▲", "front side (where the Track runs to)"],
    "1,-1": ["◥", "front-right corner"],
    "-1,0": ["◀", "left side"],
    "0,0": ["●", "centre"],
    "1,0": ["▶", "right side"],
    "-1,1": ["◣", "back-left corner"],
    "0,1": ["▼", "back side"],
    "1,1": ["◢", "back-right corner"],
  };

  /** A 3×3 top-down pick of where the Segment turns about — corners, side middles, centre. Glyphs survive as tooltips; the pad itself stays clean. */
  const pivotPad = (parent: HTMLElement, label: string, pivotFields: () => Vector): Map<string, HTMLButtonElement> => {
    const root = el("div", padCss.root);
    root.appendChild(el("span", padCss.label, label));
    const grid = el("div", padCss.grid);
    grid.style.setProperty("--cell", "14px");
    const cells = new Map<string, HTMLButtonElement>();
    for (const r of GRID_STEPS) {
      for (const c of GRID_STEPS) {
        const key = `${c},${r}`;
        const cell = el("button", padCss.cell);
        cell.type = "button";
        cell.title = GRID_GLYPHS[key]![1];
        cell.setAttribute("aria-label", `pivot ${GRID_GLYPHS[key]![1]}`);
        cell.addEventListener("click", () => {
          if (!module) return;
          const pivot = pivotFields();
          const height = readNumber(pivot[1].value, module.footprint.bounds.center.y);
          writeVec(pivot, gridPivot(module, height, c as GridStep, r as GridStep));
          emit();
        });
        grid.appendChild(cell);
        cells.set(key, cell);
      }
    }
    root.appendChild(grid);
    parent.appendChild(root);
    return cells;
  };

  const pickButton = (parent: HTMLElement, pivotFields: () => Vector): void => {
    const button = el("button", pickCss.btn, "⌖ PICK");
    button.type = "button";
    button.title = "click the part of the model it should turn about";
    button.addEventListener("click", () =>
      onPickPivot((picked) => {
        writeVec(pivotFields(), picked);
        emit();
      }),
    );
    parent.appendChild(button);
  };

  /** Easing as curve buttons in the design's order, plus the select and the chosen one's sentence. */
  const easingBlock = (parent: HTMLElement): { chips: Map<MotionEasing, HTMLButtonElement>; hint: HTMLElement; select: HTMLSelectElement } => {
    const root = el("div", cardCss.easing);
    root.appendChild(el("span", cardCss.easingLabel, "EASING"));
    const curves = el("div", cardCss.curves);
    const chips = new Map<MotionEasing, HTMLButtonElement>();
    for (const { easing, label, curve } of EASING_DISPLAY) {
      const button = el("button", cardCss.curve);
      button.type = "button";
      button.title = label;
      button.innerHTML = `<svg width="26" height="16" viewBox="0 0 26 16" fill="none" aria-hidden><path d="${curve}" stroke="currentColor" stroke-width="2"/></svg>`;
      button.addEventListener("click", () => {
        select.value = easing;
        emit();
      });
      curves.appendChild(button);
      chips.set(easing, button);
    }
    root.appendChild(curves);
    const select = el("select", fieldCss.input);
    for (const { easing, label } of EASING_DISPLAY) {
      const node = el("option", undefined, label);
      node.value = easing;
      select.appendChild(node);
    }
    const box = el("span", `${fieldCss.box} ${fieldCss.select}`);
    box.append(select, el("span", fieldCss.caret, "⌄"));
    root.appendChild(box);
    f.push(select);
    const hint = el("p", cardCss.blurb);
    root.appendChild(hint);
    parent.appendChild(root);
    return { chips, hint, select };
  };

  const xyzFields = (parent: HTMLElement, labels: [string, string, string], step: number | string): Vector => {
    const row = el("div", cardCss.fields);
    row.style.gridTemplateColumns = "repeat(3, 1fr)";
    const vector: Vector = [
      textField(row, labels[0], step),
      textField(row, labels[1], step),
      textField(row, labels[2], step),
    ];
    parent.appendChild(row);
    return vector;
  };

  // Spin
  const spinBody = addSection("spin", "Spin");
  const spinSays = says(spinBody);
  const SPIN_LABELS: Record<(typeof SPIN_SHAPES)[number], [string, string]> = {
    carousel: ["CAROUSEL", "turn flat about the centre"],
    arm: ["ARM", "sweep flat about the front end"],
    "drum along": ["DRUM ↕", "roll about the Segment's length"],
    "drum across": ["DRUM ↔", "roll about the Segment's width"],
  };
  const spinPresets = el("div", cardCss.presets);
  spinBody.appendChild(spinPresets);
  const spinShapeChips = new Map(
    SPIN_SHAPES.map((shape) => [
      shape,
      chip(spinPresets, SPIN_LABELS[shape][0], SPIN_LABELS[shape][1], () => {
        if (module) setAxisAndPivot("spin", () => sections.spin.setEnabled(true), spinAxis, spinPivot, spinShape(module, shape, parts));
      }),
    ]),
  );
  const spinDirectionRow = el("div", cardCss.presets);
  spinBody.appendChild(spinDirectionRow);
  const spinDirection = (sign: 1 | -1) => () => {
    const magnitude = Math.abs(readNumber(spinSpeed.value, 90)) || 90;
    spinSpeed.value = String(sign * magnitude);
    emit();
  };
  const spinCcw = chip(spinDirectionRow, "⟲ CCW", "", spinDirection(1));
  const spinCw = chip(spinDirectionRow, "⟳ CW", "", spinDirection(-1));
  const spinFields = el("div", cardCss.fields);
  spinFields.style.gridTemplateColumns = "repeat(2, 1fr)";
  spinBody.appendChild(spinFields);
  const spinSpeed = textField(spinFields, "°/S", 15);
  const spinStart = textField(spinFields, "START°", 15);
  const spinPivotRow = el("div", cardCss.pivotRow);
  spinBody.appendChild(spinPivotRow);
  const spinGrid = pivotPad(spinPivotRow, "PIVOT ▲ FRONT", () => spinPivot);
  pickButton(spinPivotRow, () => spinPivot);
  const spinXyz = el("div", cardCss.pivotXyz);
  spinBody.appendChild(spinXyz);
  const spinAxis = selectField(spinPivotRow, "AXIS", Object.keys(AXES));
  const spinPreset = selectField(spinXyz, "PIVOT PRESET · XYZ", [...PIVOT_PRESETS, "custom"]);
  const spinPivot = xyzFields(spinXyz, ["X", "Y", "Z"], 0.25);

  // Swing
  const swingBody = addSection("swing", "Swing");
  const swingSays = says(swingBody);
  const SWING_LABELS: Record<(typeof SWING_SHAPES)[number], [string, string]> = {
    pendulum: ["PENDULUM", "hang from the top and swing"],
    hammer: ["HAMMER", "swing up and down from the front end"],
    seesaw: ["SEESAW", "rock on the middle of the base"],
  };
  const swingPresets = el("div", cardCss.presets);
  swingBody.appendChild(swingPresets);
  const swingShapeChips = new Map(
    SWING_SHAPES.map((shape) => [
      shape,
      chip(swingPresets, SWING_LABELS[shape][0], SWING_LABELS[shape][1], () => {
        if (module) setAxisAndPivot("swing", () => sections.swing.setEnabled(true), swingAxis, swingPivot, swingShape(module, shape));
      }),
    ]),
  );
  const swingStrip = timingStrip(swingBody, "swing");
  const swingFields = el("div", cardCss.fields);
  swingFields.style.gridTemplateColumns = "repeat(4, 1fr)";
  swingBody.appendChild(swingFields);
  const swingAmplitude = textField(swingFields, "±°", 5);
  const swingPeriod = textField(swingFields, "PERIOD", 0.25);
  const swingPause = textField(swingFields, "PAUSE", 0.1);
  const swingPhase = textField(swingFields, "PHASE", 0.05);
  const swingPivotRow = el("div", cardCss.pivotRow);
  swingBody.appendChild(swingPivotRow);
  const swingGrid = pivotPad(swingPivotRow, "PIVOT ▲ FRONT", () => swingPivot);
  pickButton(swingPivotRow, () => swingPivot);
  const swingXyz = el("div", cardCss.pivotXyz);
  swingBody.appendChild(swingXyz);
  const swingAxis = selectField(swingPivotRow, "AXIS", Object.keys(AXES));
  const swingPreset = selectField(swingXyz, "PIVOT PRESET · XYZ", [...PIVOT_PRESETS, "custom"]);
  const swingPivot = xyzFields(swingXyz, ["X", "Y", "Z"], 0.25);
  const swingEase = easingBlock(swingBody);

  // Slide
  const slideBody = addSection("slide", "Slide");
  const slideSays = says(slideBody);
  const slideStrip = timingStrip(slideBody, "slide");
  const slideOffset = xyzFields(slideBody, ["OFFSET X", "OFFSET Y", "OFFSET Z"], 0.5);
  const slideTiming = el("div", cardCss.fields);
  slideTiming.style.gridTemplateColumns = "repeat(3, 1fr)";
  slideBody.appendChild(slideTiming);
  const slidePeriod = textField(slideTiming, "PERIOD S", 0.25);
  const slidePause = textField(slideTiming, "PAUSE S", 0.1);
  const slidePhase = textField(slideTiming, "PHASE", 0.05);
  const slideEase = easingBlock(slideBody);

  const presetFor = (pivot: Vec3): string =>
    (module && PIVOT_PRESETS.find((preset) => sameVec(pivotPreset(module!, preset), pivot))) ?? "custom";

  const read = (): SegmentMotion | undefined => {
    if (!module) return undefined;
    const motion: SegmentMotion = {};
    if (sections.spin.enabled()) {
      const base = current.spin ?? defaultSpin(module);
      const spin: MotionSpin = {
        axis: { ...AXES[spinAxis.value as AxisName] },
        pivot: readVec(spinPivot, base.pivot),
        speed: toRadians(readNumber(spinSpeed.value, toDegrees(base.speed))),
      };
      const start = readNumber(spinStart.value, 0);
      if (start !== 0) spin.startAngle = toRadians(start);
      motion.spin = spin;
    }
    if (sections.swing.enabled()) {
      const base = current.swing ?? defaultSwing(module);
      const swing: MotionSwing = {
        axis: { ...AXES[swingAxis.value as AxisName] },
        pivot: readVec(swingPivot, base.pivot),
        amplitude: toRadians(readNumber(swingAmplitude.value, toDegrees(base.amplitude))),
        period: Math.max(0.1, readNumber(swingPeriod.value, base.period)),
        easing: swingEase.select.value as MotionEasing,
      };
      const pause = Math.min(Math.max(0, readNumber(swingPause.value, 0)), swing.period / 2 - 0.05);
      if (pause > 0) swing.pause = pause;
      const phase = readNumber(swingPhase.value, 0);
      if (phase !== 0) swing.phase = phase;
      motion.swing = swing;
    }
    if (sections.slide.enabled()) {
      const base = current.slide ?? defaultSlide(module);
      const slide: MotionSlide = {
        offset: readVec(slideOffset, base.offset),
        period: Math.max(0.1, readNumber(slidePeriod.value, base.period)),
        easing: slideEase.select.value as MotionEasing,
      };
      const pause = Math.min(Math.max(0, readNumber(slidePause.value, 0)), slide.period / 2 - 0.05);
      if (pause > 0) slide.pause = pause;
      const phase = readNumber(slidePhase.value, 0);
      if (phase !== 0) slide.phase = phase;
      motion.slide = slide;
    }
    return motion.spin || motion.swing || motion.slide ? motion : undefined;
  };

  const write = (motion: SegmentMotion): void => {
    current = motion;
    const spin = motion.spin ?? (module ? defaultSpin(module) : undefined);
    const swing = motion.swing ?? (module ? defaultSwing(module) : undefined);
    const slide = motion.slide ?? (module ? defaultSlide(module) : undefined);
    (["spin", "swing", "slide"] as const).forEach((kind) => sections[kind].setEnabled(motion[kind] !== undefined));
    const cellKey = (pivot: Vec3): string | undefined => {
      const cell = module && gridCellOf(module, pivot);
      return cell ? `${cell.col},${cell.row}` : undefined;
    };
    const lightPad = (cells: Map<string, HTMLButtonElement>, active: string | undefined): void => {
      for (const [key, cell] of cells) cell.classList.toggle(cx(padCss.on), key === active);
    };
    lightChips(spinShapeChips, module && motion.spin ? matchShape(SPIN_SHAPES, (s) => spinShape(module!, s, parts), motion.spin.axis, motion.spin.pivot) : undefined);
    lightChips(swingShapeChips, module && motion.swing ? matchShape(SWING_SHAPES, (s) => swingShape(module!, s), motion.swing.axis, motion.swing.pivot) : undefined);
    const corners = module ? footprintCorners(module) : [];
    if (module && spin) {
      lightPad(spinGrid, cellKey(spin.pivot));
      lightChips(new Map([[1, spinCcw]]), spin.speed > 0 ? 1 : undefined);
      lightChips(new Map([[-1, spinCw]]), spin.speed < 0 ? -1 : undefined);
      const seenFrom = nearestAxis(spin.axis) === "Y" ? "seen from above" : `seen from the +${nearestAxis(spin.axis)} end`;
      spinCcw.title = `counter-clockwise, ${seenFrom}`;
      spinCw.title = `clockwise, ${seenFrom}`;
      colourNote(spinSays, describeSpin(spin, corners, scale), speedOutcome(topSpeedAt({ spin }, 0, corners, scale)));
      if (motion.spin) sections.spin.summary.textContent = spinSummary(spin);
    }
    if (module && swing) {
      lightPad(swingGrid, cellKey(swing.pivot));
      const samples = sampleCycle({ swing }, corners, 120, scale);
      colourNote(swingSays, describeSwing(swing, corners, scale), worst(samples));
      drawStrip(swingStrip, samples, swing.period);
      for (const [easing, button] of swingEase.chips) button.classList.toggle(cx(cardCss.curveOn), easing === swing.easing);
      swingEase.hint.textContent = EASING_HINTS[swing.easing];
      if (motion.swing) sections.swing.summary.textContent = swingSummary(swing);
    }
    if (module && slide) {
      const samples = sampleCycle({ slide }, corners, 120, scale);
      colourNote(slideSays, describeSlide(slide, corners, scale), worst(samples));
      drawStrip(slideStrip, samples, slide.period);
      for (const [easing, button] of slideEase.chips) button.classList.toggle(cx(cardCss.curveOn), easing === slide.easing);
      slideEase.hint.textContent = EASING_HINTS[slide.easing];
      if (motion.slide) sections.slide.summary.textContent = slideSummary(slide);
    }
    if (spin) {
      spinAxis.value = nearestAxis(spin.axis);
      spinSpeed.value = String(toDegrees(spin.speed));
      spinStart.value = String(toDegrees(spin.startAngle ?? 0));
      writeVec(spinPivot, spin.pivot);
      spinPreset.value = presetFor(spin.pivot);
    }
    if (swing) {
      swingAxis.value = nearestAxis(swing.axis);
      swingAmplitude.value = String(toDegrees(swing.amplitude));
      swingPeriod.value = String(swing.period);
      swingPause.value = String(swing.pause ?? 0);
      swingPhase.value = String(swing.phase ?? 0);
      swingEase.select.value = swing.easing;
      writeVec(swingPivot, swing.pivot);
      swingPreset.value = presetFor(swing.pivot);
    }
    if (slide) {
      writeVec(slideOffset, slide.offset);
      slidePeriod.value = String(slide.period);
      slidePause.value = String(slide.pause ?? 0);
      slidePhase.value = String(slide.phase ?? 0);
      slideEase.select.value = slide.easing;
    }
  };

  const emit = (): void => onChange(read());

  for (const field of f) field.addEventListener("change", emit);
  // A pivot preset is not itself part of the Motion: it fills its x/y/z, then
  // the Motion is read once — one change, one undo step.
  const bindPreset = (preset: HTMLSelectElement, vector: Vector): void => {
    preset.addEventListener("change", () => {
      if (module && preset.value !== "custom") writeVec(vector, pivotPreset(module, preset.value as PivotPreset));
      emit();
    });
  };
  bindPreset(spinPreset, spinPivot);
  bindPreset(swingPreset, swingPivot);

  container.hidden = true;
  return {
    setClock(seconds) {
      clock = seconds;
      for (const [strip, timing] of [
        [swingStrip, current.swing],
        [slideStrip, current.slide],
      ] as const) {
        if (!timing) continue;
        const left = `${cycleFraction(timing, seconds) * 100}%`;
        strip.playhead.style.left = left;
        strip.knob.style.left = left;
      }
    },
    show(nextModule, motion, nextParts = [], nextScale = 1, selectedCount = 1) {
      module = nextModule;
      parts = nextParts;
      scale = nextScale;
      const group = selectedCount > 1;
      order.textContent = group ? "SINGLE SELECT ONLY" : "SPIN → SWING → SLIDE";
      groupNote.hidden = !group || module === undefined;
      container.hidden = module === undefined;
      for (const kind of ["spin", "swing", "slide"] as const) sections[kind].card.hidden = group;
      if (module && !group) write(motion ?? {});
    },
  };
};
