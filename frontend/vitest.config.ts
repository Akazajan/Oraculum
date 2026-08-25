import { defineConfig } from "vitest/config";

export default defineConfig({
  // Bypass the project's Tailwind PostCSS config (which Vitest cannot load)
  // for these pure JS unit tests.
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    css: false,
    environment: "jsdom",
    include: ["lib/**/*.test.ts"],
  },
});
