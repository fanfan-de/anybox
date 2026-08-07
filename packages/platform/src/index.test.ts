import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  createPlatformAdapter,
  getBundledBunName,
  getDefaultShell,
  getPythonExecutable,
  normalizeComparablePath,
  POWERSHELL_7_INSTALL_MESSAGE,
  type PowerShell7Detector,
} from "./index"

describe("platform adapter", () => {
  it("normalizes comparable paths by platform", () => {
    expect(normalizeComparablePath("C:\\Projects\\App\\", "win32")).toBe("c:/projects/app")
    expect(normalizeComparablePath("/Users/Fan/App/", "darwin")).toBe("/Users/Fan/App")
  })

  it("resolves platform executable names", () => {
    expect(getBundledBunName("win32")).toBe("bun.exe")
    expect(getBundledBunName("darwin")).toBe("bun")
    expect(getPythonExecutable("runtime", "win32")).toBe(path.join("runtime", "python.exe"))
  })

  it("supports semantic openPath injection", async () => {
    const opened: string[] = []
    const adapter = createPlatformAdapter({
      platform: "darwin",
      openPath: async (targetPath) => {
        opened.push(targetPath)
      },
    })

    await adapter.openPath("/tmp/project")
    expect(opened).toEqual(["/tmp/project"])
  })

  it("uses a validated PowerShell 7 runtime as the Windows default", async () => {
    const detector: PowerShell7Detector = {
      async detect() {
        return {
          available: true,
          executable: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
          version: "7.6.4",
          edition: "Core",
          major: 7,
        }
      },
      async validate() {
        throw new Error("validate should not be called")
      },
    }

    await expect(getDefaultShell("win32", { PATH: "" }, detector)).resolves.toBe(
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    )
  })

  it("never falls back to powershell.exe when PowerShell 7 is unavailable", async () => {
    const detector: PowerShell7Detector = {
      async detect() {
        return {
          available: false,
          message: POWERSHELL_7_INSTALL_MESSAGE,
          detail: "missing",
        }
      },
      async validate() {
        throw new Error("validate should not be called")
      },
    }

    await expect(getDefaultShell("win32", {
      PATH: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    }, detector)).resolves.toBe("C:\\Windows\\System32\\cmd.exe")

    await expect(getDefaultShell("win32", {
      PATH: "",
      ComSpec: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    }, detector)).rejects.toThrow("Windows PowerShell 5.1 (powershell.exe) is not supported")
  })
})
