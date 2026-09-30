import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const MOCK_BACKEND_PORT = Number(process.env.MOCK_BACKEND_PORT ?? 8799);

/**
 * E2E suite: BFF session storage (#118), security headers / CSP (#117),
 * and per-locale smoke runs (#116). Runs against a production build so the
 * middleware and headers match what is deployed.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `node tests/e2e/mock-backend.mjs`,
      port: MOCK_BACKEND_PORT,
      reuseExistingServer: !process.env.CI,
      env: { MOCK_BACKEND_PORT: String(MOCK_BACKEND_PORT) },
    },
    {
      command: `npm run build && npx next start -p ${PORT}`,
      port: PORT,
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
      env: {
        BFF_UPSTREAM_URL: `http://localhost:${MOCK_BACKEND_PORT}`,
        BFF_SESSION_SECRET: "e2e-session-secret-e2e-session-secret-0123",
        // next start over plain http: allow non-Secure cookies for the test only.
        BFF_INSECURE_COOKIES: "1",
        CSP_MODE: process.env.CSP_MODE ?? "enforce",
        NEXT_PUBLIC_API_URL: `http://localhost:${MOCK_BACKEND_PORT}`,
        NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
      },
    },
  ],
});
