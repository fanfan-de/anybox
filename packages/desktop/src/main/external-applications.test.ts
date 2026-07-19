import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import { describe, expect, it, vi } from "vitest"
import {
  ExternalApplicationLaunchError,
  launchExternalApplication,
  resolveExternalApplicationExecutable,
} from "./external-applications"

describe("external application launcher", () => {
  it("prefers an explicitly configured Chrome executable", async () => {
    const attempted: string[] = []
    const executablePath = await resolveExternalApplicationExecutable(
      "chrome",
      {
        platform: "win32",
        homeDir: "C:\\Users\\demo",
        env: {
          ANYBOX_CHROME_EXECUTABLE: "D:\\Portable\\Chrome\\chrome.exe",
          LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
        },
        accessFile: async (candidate) => {
          attempted.push(candidate)
          if (candidate !== "D:\\Portable\\Chrome\\chrome.exe") {
            throw new Error("missing")
          }
        },
      },
    )

    expect(executablePath).toBe("D:\\Portable\\Chrome\\chrome.exe")
    expect(attempted).toEqual(["D:\\Portable\\Chrome\\chrome.exe"])
  })

  it("reports a stable not-found error after checking supported locations", async () => {
    await expect(resolveExternalApplicationExecutable("chrome", {
      platform: "linux",
      homeDir: "/home/demo",
      env: { PATH: "/usr/local/bin:/usr/bin" },
      accessFile: async () => {
        throw new Error("missing")
      },
    })).rejects.toMatchObject({
      name: "ExternalApplicationLaunchError",
      code: "APPLICATION_NOT_FOUND",
    })
  })

  it("launches Chrome detached without shell expansion", async () => {
    const unref = vi.fn()
    const spawnProcess = vi.fn((_command, _args, _options) => {
      const child = new EventEmitter() as ChildProcess
      child.unref = unref
      queueMicrotask(() => child.emit("spawn"))
      return child
    })

    const result = await launchExternalApplication("chrome", {
      platform: "linux",
      homeDir: "/home/demo",
      env: { CHROME_PATH: "/opt/chrome/google-chrome" },
      accessFile: async () => undefined,
      spawnProcess,
    })

    expect(result).toEqual({
      application: "chrome",
      executablePath: "/opt/chrome/google-chrome",
    })
    expect(spawnProcess).toHaveBeenCalledWith(
      "/opt/chrome/google-chrome",
      [],
      expect.objectContaining({
        detached: true,
        shell: false,
        stdio: "ignore",
      }),
    )
    expect(unref).toHaveBeenCalledOnce()
  })

  it("normalizes synchronous spawn failures", async () => {
    await expect(launchExternalApplication("chrome", {
      platform: "linux",
      homeDir: "/home/demo",
      env: { CHROME_PATH: "/opt/chrome/google-chrome" },
      accessFile: async () => undefined,
      spawnProcess: () => {
        throw new Error("spawn failed")
      },
    })).rejects.toEqual(expect.objectContaining({
      name: "ExternalApplicationLaunchError",
      code: "APPLICATION_LAUNCH_FAILED",
    } satisfies Partial<ExternalApplicationLaunchError>))
  })
})
