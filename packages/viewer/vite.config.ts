import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset paths, so the built viewer can be hosted under any prefix (e.g. /s/<sessionId>).
  base: "./",
  server: { host: "localhost" },
  // three.js alone is ~600 kB minified; one chunk is fine for a single-page viewer.
  build: { chunkSizeWarningLimit: 800 },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
