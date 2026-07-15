import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  testMatch: "thread-execution-disclosure.pw.ts",
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: "vite --config playwright.thread.vite.config.ts",
    port: 4179,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4179",
    channel: process.platform === "win32" ? "chrome" : undefined,
    viewport: { width: 900, height: 700 },
  },
})
