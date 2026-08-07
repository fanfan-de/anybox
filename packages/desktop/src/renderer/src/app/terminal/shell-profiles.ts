import type { TerminalShellProfile } from "./types"

export const DEFAULT_TERMINAL_SHELL_PROFILE_ID = "default"

function windowsProfiles(): TerminalShellProfile[] {
  return [
    { id: DEFAULT_TERMINAL_SHELL_PROFILE_ID, label: "Default", shell: null },
    { id: "pwsh", label: "PowerShell 7", shell: "pwsh.exe" },
    { id: "cmd", label: "Command Prompt", shell: "cmd.exe" },
    { id: "wsl", label: "WSL", shell: "wsl.exe" },
    { id: "bash", label: "Bash", shell: "bash" },
  ]
}

function unixProfiles(): TerminalShellProfile[] {
  return [
    { id: DEFAULT_TERMINAL_SHELL_PROFILE_ID, label: "Default", shell: null },
    { id: "zsh", label: "zsh", shell: "zsh" },
    { id: "bash", label: "bash", shell: "bash" },
    { id: "fish", label: "fish", shell: "fish" },
    { id: "sh", label: "sh", shell: "sh" },
  ]
}

export function resolveTerminalShellProfiles(platform: string | undefined): TerminalShellProfile[] {
  if (platform === "win32") return windowsProfiles()
  if (platform === "darwin" || platform === "linux") return unixProfiles()
  return [{ id: DEFAULT_TERMINAL_SHELL_PROFILE_ID, label: "Default", shell: null }]
}

export function resolveShellFromProfile(
  profiles: TerminalShellProfile[],
  profileID: string | null | undefined,
): string | null {
  if (!profileID || profileID === DEFAULT_TERMINAL_SHELL_PROFILE_ID) return null
  const matched = profiles.find((profile) => profile.id === profileID)
  return matched?.shell ?? null
}
