import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getAppPath: vi.fn(() => process.cwd()),
    isPackaged: false,
  },
  BrowserWindow: vi.fn(),
}))

vi.mock("./managed-agent", () => ({
  ensureManagedAgentRunning: vi.fn(),
}))

import { isMonitorDevServerAvailable } from "./monitor-window"

describe("monitor window dev server detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("accepts the monitor dev server when the monitor marker is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue('<meta name="anybox-app" content="monitor" />'),
      }),
    )

    await expect(isMonitorDevServerAvailable("http://127.0.0.1:4174/")).resolves.toBe(true)
  })

  it("rejects another app that happens to be running on the monitor port", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue("<title>Anybox homepage</title>"),
      }),
    )

    await expect(isMonitorDevServerAvailable("http://127.0.0.1:4174/")).resolves.toBe(false)
  })
})
