export interface EnvironmentShellInvocation {
  executable: string
  args: string[]
}

function resolveExecutable(candidates: string[]) {
  for (const candidate of candidates) {
    const resolved = Bun.which(candidate)
    if (resolved) return resolved
  }
  return undefined
}

export function resolveEnvironmentShellInvocation(
  script: string,
  platform = process.platform,
): EnvironmentShellInvocation {
  if (platform === "win32") {
    const executable = resolveExecutable(["pwsh.exe", "pwsh", "powershell.exe", "powershell"])
    if (!executable) {
      throw new Error("PowerShell is required to run environment scripts on Windows.")
    }
    return {
      executable,
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    }
  }

  const bash = resolveExecutable(["bash"])
  if (bash) {
    return {
      executable: bash,
      args: ["-lc", script],
    }
  }
  return {
    executable: "/bin/sh",
    args: ["-lc", script],
  }
}
