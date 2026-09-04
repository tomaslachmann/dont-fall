import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "@dont-fall/shared/design/tokens.css";
import "./app.css";
import { App } from "./App";

const mount = document.getElementById("game")!;

// StrictMode's dev-only double mount/unmount is a free, continuous check on
// M4 ticket 01's own guarantee — <GameCanvas> tearing down cleanly enough
// that starting again immediately leaks nothing.
createRoot(mount).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
