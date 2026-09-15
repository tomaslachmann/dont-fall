import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { TrackBuilderScreen } from "./screens/TrackBuilder/TrackBuilderScreen.js";
import { createBuilderEngine } from "./engine.js";

// One engine for the session — created once, StrictMode only re-runs the
// island/loop effects around it, never the state itself.
const engine = createBuilderEngine();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TrackBuilderScreen engine={engine} />
  </StrictMode>,
);
