import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Same split as apps/client: Vitest resolves this file instead of
  // vite.config.ts when both exist, so the React plugin (JSX transform)
  // has to be declared here too — vite.config.ts's own `plugins` are
  // not inherited.
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    clearMocks: true,
    // The engine tests drive real DOM (canvases, observers); only the
    // React component tests actually need the full jsdom document.
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
