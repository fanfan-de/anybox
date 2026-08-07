import { describe, expect, it } from "vitest"
import { resolveTerminalShellProfiles } from "./shell-profiles"

describe("terminal shell profiles", () => {
  it("offers PowerShell 7 on Windows without Windows PowerShell 5.1", () => {
    const profiles = resolveTerminalShellProfiles("win32")

    expect(profiles).toContainEqual({
      id: "pwsh",
      label: "PowerShell 7",
      shell: "pwsh.exe",
    })
    expect(profiles.some((profile) => profile.id === "powershell")).toBe(false)
    expect(profiles.some((profile) => profile.shell?.toLowerCase() === "powershell.exe")).toBe(false)
  })
})
