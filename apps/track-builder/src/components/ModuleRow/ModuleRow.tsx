import { useEffect, useRef } from "react";
import css from "./ModuleRow.module.css";
import type { BuilderEngine } from "../../engine.js";

interface Props {
  engine: BuilderEngine;
  moduleId: string;
  name: string;
  meta: string;
  visible: boolean;
}

/** One procedural Module: a live 3D still, its name, and its socket/footprint facts. Click places it. */
export function ModuleRow({ engine, moduleId, name, meta, visible }: Props) {
  const entryRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const entry = entryRef.current;
    const canvas = canvasRef.current;
    if (!entry || !canvas) return;
    return engine.attachPreview(entry, canvas, moduleId);
  }, [engine, moduleId]);

  return (
    <button type="button" ref={entryRef} hidden={!visible}
      className={css.row}
      onClick={() => engine.placeModule(moduleId)}
      onPointerEnter={() => canvasRef.current && engine.setPreviewHovered(canvasRef.current, true)}
      onPointerLeave={() => canvasRef.current && engine.setPreviewHovered(canvasRef.current, false)}>
      <span className={css.swatchBox}>
        <canvas ref={canvasRef} width={96} height={96} />
      </span>
      <span className={css.meta}>
        <span className={css.name}>{name}</span>
        <span className={css.sub}>{meta}</span>
      </span>
    </button>
  );
}
