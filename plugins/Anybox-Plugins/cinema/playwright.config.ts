import { defineConfig } from "@playwright/test"

const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const usesExternalProject = Boolean(process.env.CINEMA_E2E_URL)
const browserChannel = process.env.CINEMA_E2E_CHANNEL || (process.platform === "win32" ? "chrome" : undefined)

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  timeout: 30_000,
  fullyParallel: false,
  workers: usesExternalProject ? undefined : 1,
  use: {
    viewport: { width: 1440, height: 900 },
    channel: browserChannel,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: usesExternalProject ? undefined : {
    command: "corepack pnpm@10.28.0 --filter @anybox/cinema-plugin build && corepack pnpm@10.28.0 --filter @anybox/cinema-plugin exec bun Test/fixtures/cinema-e2e-server.ts",
    url: `http://127.0.0.1:${managedAgentPort}/healthz`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      CINEMA_E2E_AGENT_PORT: managedAgentPort,
    },
  },
})
