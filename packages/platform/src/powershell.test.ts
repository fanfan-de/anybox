import { describe, expect, it } from "vitest"
import {
  createPowerShell7Detector,
  isPowerShell7Executable,
  isWindowsPowerShellExecutable,
  POWERSHELL_7_INSTALL_MESSAGE,
  POWERSHELL_7_PROBE_TIMEOUT_MS,
  type PowerShellProbe,
} from "./powershell"

function successfulProbe(version = "7.6.4", edition = "Core") {
  return async () => ({
    stdout: JSON.stringify({ version, edition }),
    stderr: "",
  })
}

describe("PowerShell 7 detector", () => {
  it("uses the PATH pwsh candidate first and caches the full result", async () => {
    const commands: string[] = []
    let probes = 0
    const detector = createPowerShell7Detector({
      platform: "win32",
      env: {
        PATH: "C:\\Tools",
        ProgramFiles: "C:\\Program Files",
        LOCALAPPDATA: "C:\\Users\\Fan\\AppData\\Local",
      },
      whichCommand(command) {
        commands.push(command)
        return command === "pwsh.exe" ? "C:\\Tools\\pwsh.exe" : null
      },
      isFile: async () => {
        throw new Error("standard install paths should not be checked")
      },
      probe: async (input) => {
        probes += 1
        expect(input.executable).toBe("C:\\Tools\\pwsh.exe")
        expect(input.timeoutMs).toBe(POWERSHELL_7_PROBE_TIMEOUT_MS)
        expect(input.args).toEqual([
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          expect.stringContaining("$PSVersionTable.PSVersion"),
        ])
        return {
          stdout: JSON.stringify({ version: "7.6.4", edition: "Core" }),
          stderr: "",
        }
      },
    })

    const first = await detector.detect()
    const second = await detector.detect()

    expect(first).toEqual({
      available: true,
      executable: "C:\\Tools\\pwsh.exe",
      version: "7.6.4",
      edition: "Core",
      major: 7,
    })
    expect(second).toBe(first)
    expect(commands).toEqual(["pwsh.exe"])
    expect(probes).toBe(1)
  })

  it("falls back to Program Files and then the WindowsApps alias", async () => {
    const checked: string[] = []
    const programFilesDetector = createPowerShell7Detector({
      platform: "win32",
      env: {
        ProgramFiles: "D:\\Programs",
        LOCALAPPDATA: "C:\\Users\\Fan\\AppData\\Local",
      },
      whichCommand: () => null,
      isFile: async (candidate) => {
        checked.push(candidate)
        return candidate === "D:\\Programs\\PowerShell\\7\\pwsh.exe"
      },
      probe: successfulProbe("7.4.7"),
    })

    expect(await programFilesDetector.detect()).toMatchObject({
      available: true,
      executable: "D:\\Programs\\PowerShell\\7\\pwsh.exe",
      version: "7.4.7",
    })
    expect(checked).toEqual(["D:\\Programs\\PowerShell\\7\\pwsh.exe"])

    checked.length = 0
    const windowsAppsDetector = createPowerShell7Detector({
      platform: "win32",
      env: {
        ProgramFiles: "D:\\Programs",
        LOCALAPPDATA: "C:\\Users\\Fan\\AppData\\Local",
      },
      whichCommand: () => null,
      isFile: async (candidate) => {
        checked.push(candidate)
        return candidate.endsWith("\\Microsoft\\WindowsApps\\pwsh.exe")
      },
      probe: successfulProbe("7.0.13"),
    })

    expect(await windowsAppsDetector.detect()).toMatchObject({
      available: true,
      executable: "C:\\Users\\Fan\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe",
      version: "7.0.13",
    })
    expect(checked).toEqual([
      "D:\\Programs\\PowerShell\\7\\pwsh.exe",
      "C:\\Users\\Fan\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe",
    ])
  })

  it("accepts the pwsh command name from PATH when pwsh.exe is not resolved", async () => {
    const commands: string[] = []
    const detector = createPowerShell7Detector({
      whichCommand(command) {
        commands.push(command)
        return command === "pwsh" ? "C:\\Portable PowerShell\\pwsh.exe" : null
      },
      probe: successfulProbe(),
    })

    expect(await detector.detect()).toMatchObject({
      available: true,
      executable: "C:\\Portable PowerShell\\pwsh.exe",
    })
    expect(commands).toEqual(["pwsh.exe", "pwsh"])
  })

  it.each(["7.0", "7.4", "7.6.4", "7.7.0-preview.1"])("accepts PowerShell %s Core", async (version) => {
    const detector = createPowerShell7Detector({
      whichCommand: () => "C:\\Tools\\pwsh.exe",
      probe: successfulProbe(version),
    })

    expect(await detector.detect()).toMatchObject({
      available: true,
      version,
      edition: "Core",
      major: 7,
    })
  })

  it.each([
    ["6.2.7", "Core"],
    ["8.0.0", "Core"],
    ["7.6.4", "Desktop"],
  ])("rejects unsupported PowerShell %s (%s)", async (version, edition) => {
    const detector = createPowerShell7Detector({
      whichCommand: () => "C:\\Tools\\pwsh.exe",
      probe: successfulProbe(version, edition),
    })

    const result = await detector.detect()
    expect(result.available).toBe(false)
    if (!result.available) {
      expect(result.message).toBe(POWERSHELL_7_INSTALL_MESSAGE)
      expect(result.detail).toContain("Only PowerShell 7.x (Core) is supported")
    }
  })

  it.each([
    ["malformed output", async () => ({ stdout: "not-json", stderr: "" })],
    ["unexpected stderr", async () => ({ stdout: "{}", stderr: "probe warning" })],
    ["probe failure", async () => { throw new Error("timed out") }],
  ] satisfies Array<[string, PowerShellProbe]>)("treats %s as unavailable", async (_name, probe) => {
    const detector = createPowerShell7Detector({
      whichCommand: () => "C:\\Tools\\pwsh.exe",
      probe,
    })

    const result = await detector.detect()
    expect(result.available).toBe(false)
    if (!result.available) expect(result.message).toBe(POWERSHELL_7_INSTALL_MESSAGE)
  })

  it("never searches for Windows PowerShell and returns the install guidance when pwsh is absent", async () => {
    const commands: string[] = []
    const detector = createPowerShell7Detector({
      platform: "win32",
      env: {},
      whichCommand(command) {
        commands.push(command)
        return null
      },
      isFile: async () => false,
      probe: async () => {
        throw new Error("probe should not run")
      },
    })

    const result = await detector.detect()
    expect(commands).toEqual(["pwsh.exe", "pwsh"])
    expect(commands.every((command) => !command.startsWith("powershell"))).toBe(true)
    expect(result).toMatchObject({
      available: false,
      message: POWERSHELL_7_INSTALL_MESSAGE,
    })
  })

  it("recognizes explicit PowerShell executable names and absolute paths", () => {
    expect(isPowerShell7Executable("pwsh.exe")).toBe(true)
    expect(isPowerShell7Executable("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe(true)
    expect(isWindowsPowerShellExecutable("powershell")).toBe(true)
    expect(isWindowsPowerShellExecutable("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe(true)
    expect(isWindowsPowerShellExecutable("pwsh.exe")).toBe(false)
  })
})
