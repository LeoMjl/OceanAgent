import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["pi/**", "node_modules/**", "frontend/dist/**"],
    testTimeout: 10_000,
  },
});
