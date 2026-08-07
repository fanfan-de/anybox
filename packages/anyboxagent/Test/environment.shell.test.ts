import { describe, expect, test } from "bun:test"
import {
  POWERSHELL_7_INSTALL_MESSAGE,
  type PowerShell7Detector,
} from "@anybox/platform"
import { resolveEnvironmentShellInvocation } from "#environment/shell.ts"

describe("environment shell", () => {
  test("uses the shared PowerShell 7 runtime for Windows scripts", async () => {
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

    const invocation = await resolveEnvironmentShellInvocation("Write-Output '你好'", "win32", detector)
    expect(invocation.executable).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
    expect(invocation.args.slice(0, -1)).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
    ])
    expect(invocation.args.at(-1)).toContain("[Console]::OutputEncoding")
    expect(invocation.args.at(-1)).toEndWith("Write-Output '你好'")
  })

  test("fails only the Windows environment operation when PowerShell 7 is missing", async () => {
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

    await expect(
      resolveEnvironmentShellInvocation("Write-Output ok", "win32", detector),
    ).rejects.toThrow(POWERSHELL_7_INSTALL_MESSAGE)
  })
})
