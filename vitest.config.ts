import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the science and data code (pure functions, no browser or network).
// Kept separate from vite.config.ts so tests don't load the app's build plugins.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], environment: "node", setupFiles: ["tests/setup.ts"] },
});
