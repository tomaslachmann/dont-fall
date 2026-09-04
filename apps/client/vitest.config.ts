import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Vitest resolves this file instead of vite.config.ts when both exist, so
  // the React plugin (JSX transform) has to be declared here too, not just
  // there — vite.config.ts's own `plugins` are not inherited.
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    clearMocks: true,
    // Existing non-React tests run fine under jsdom too; only the new React
    // component tests actually need it.
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
