import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import "./styles/global.css";
import "./styles/tokens.css";
import "./styles/keyframes.css";
import "./app.css";
import { App } from "./App";
import { startAppMusic } from "./audio/music.js";
import { createUiSoundPlayer, installUiSounds } from "./audio/uiSounds.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { createApiQueryClient } from "./lib/api/query.js";
import { routerBasename } from "./lib/publicUrl.js";

const mount = document.getElementById("game")!;

// Every Screen's buttons, switches and sliders are heard (M14 ticket 12), from one listener.
installUiSounds(document, createUiSoundPlayer());
// The Lobby's playlist is the app's music, on every Screen and in free roam (M14 ticket 11).
startAppMusic(window);

// One client for the whole session — every query below shares its cache.
const queryClient = createApiQueryClient();

// StrictMode's dev-only double mount/unmount is a free, continuous check on
// M4 ticket 01's own guarantee — <GameCanvas> tearing down cleanly enough
// that starting again immediately leaks nothing.
createRoot(mount).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={routerBasename()}>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
