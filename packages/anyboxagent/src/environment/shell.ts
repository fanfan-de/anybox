import {
  buildPowerShell7Args,
  powerShell7Detector,
  requirePowerShell7Runtime,
  type PowerShell7Detector,
} from "@anybox/platform"

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

export async function resolveEnvironmentShellInvocation(
  script: string,
  platform = process.platform,
  detector: PowerShell7Detector = powerShell7Detector,
): Promise<EnvironmentShellInvocation> {
  if (platform === "win32") {
    const runtime = await requirePowerShell7Runtime(detector)
    return {
      executable: runtime.executable,
      args: buildPowerShell7Args(script),
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
