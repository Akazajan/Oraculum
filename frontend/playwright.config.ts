import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration for the browser journeys in `frontend/e2e`.
 *
 * The suite boots the real Next.js app and answers every API call with a mocked
 * response, so the journeys exercise the client's own routing, state and
 * rendering rather than a stub server.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // The journeys drive one shared dev server and mock routes per page, so they
  // run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Same-origin API so `page.route` can answer every call deterministically.
      NEXT_PUBLIC_API_URL: `${BASE_URL}/api`,
    },
  },
});
