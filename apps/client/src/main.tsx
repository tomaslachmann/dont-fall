import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import "./styles/global.css";
import "./styles/tokens.css";
import "./styles/keyframes.css";
import "./app.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { createApiQueryClient } from "./lib/api/query.js";

const mount = document.getElementById("game")!;

// One client for the whole session — every query below shares its cache.
const queryClient = createApiQueryClient();

// StrictMode's dev-only double mount/unmount is a free, continuous check on
// M4 ticket 01's own guarantee — <GameCanvas> tearing down cleanly enough
// that starting again immediately leaks nothing.
createRoot(mount).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
