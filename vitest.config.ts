// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    isolate: true,
    //threads: false,
    // Increase timeout for DB operations if needed
    testTimeout: 60_000,
  },
});
