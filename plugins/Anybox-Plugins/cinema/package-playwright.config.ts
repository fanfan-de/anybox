import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: "package-playwright-smoke.pw.ts",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
})
