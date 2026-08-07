import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import {
  createPowerShell7Detector,
  getPowerShell7Runtime,
  isWindowsPowerShellExecutable,
  WINDOWS_POWERSHELL_UNSUPPORTED_MESSAGE,
  type PowerShell7Detector,
} from "./powershell"

export * from "./powershell"

export type SupportedDesktopPlatform = "win32" | "darwin"

export interface PlatformAdapter {
  platform: SupportedDesktopPlatform
  normalizeComparablePath(value: string): string
  getDefaultShell(): Promise<string>
  getBundledBunName(): "bun" | "bun.exe"
  getPythonExecutable(root: string): string
  openPath(targetPath: string): Promise<void>
  terminateProcessTree(pid: number): Promise<void>
}

export interface PlatformAdapterOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  openPath?: (targetPath: string) => Promise<string | void>
}

export function normalizeComparablePath(value: string, platform: NodeJS.Platform = process.platform) {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
  return platform === "win32" ? normalized.toLowerCase() : normalized
}

export function getBundledBunName(platform: NodeJS.Platform = process.platform): "bun" | "bun.exe" {
  return platform === "win32" ? "bun.exe" : "bun"
}

export function getPythonExecutable(root: string, platform: NodeJS.Platform = process.platform) {
  if (platform === "win32") return path.join(root, "python.exe")

  const python3 = path.join(root, "bin", "python3")
  if (fs.existsSync(python3)) return python3
  return path.join(root, "bin", "python")
}

function commandExists(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  const separator = platform === "win32" ? ";" : ":"
  const pathValue = env.PATH ?? env.Path ?? ""
  for (const directory of pathValue.split(separator)) {
    if (!directory) continue
    const candidate = path.join(directory, command)
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

export async function getDefaultShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  powerShellDetector?: PowerShell7Detector,
) {
  if (platform !== "win32" && env.SHELL?.trim()) return env.SHELL.trim()
  if (platform === "darwin") return "/bin/zsh"

  if (platform === "win32") {
    const bash = commandExists("bash.exe", platform, env) ?? commandExists("bash", platform, env)
    if (bash) return bash
    const powerShell = await (powerShellDetector
      ? powerShellDetector.detect()
      : platform === process.platform && env === process.env
        ? getPowerShell7Runtime()
        : createPowerShell7Detector({ platform, env }).detect())
    if (powerShell.available) return powerShell.executable
    const comSpec = env.ComSpec?.trim()
    if (comSpec && isWindowsPowerShellExecutable(comSpec)) {
      throw new Error(WINDOWS_POWERSHELL_UNSUPPORTED_MESSAGE)
    }
    return comSpec || "cmd.exe"
  }

  return commandExists("bash", platform, env) ?? "/bin/sh"
}

async function defaultOpenPath(targetPath: string, platform: NodeJS.Platform) {
  const command = platform === "win32" ? "cmd.exe" : "open"
  const args = platform === "win32" ? ["/d", "/s", "/c", "start", "\"\"", targetPath] : [targetPath]

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}

export async function terminateProcessTree(pid: number, platform: NodeJS.Platform = process.platform) {
  if (!Number.isInteger(pid) || pid <= 0) return

  if (platform === "win32") {
    await new Promise<void>((resolve) => {
      const child = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      })
      child.once("exit", () => resolve())
      child.once("error", () => resolve())
    })
    return
  }

  try {
    process.kill(pid, "SIGTERM")
  } catch {
    return
  }

  await delay(1500)
  try {
    process.kill(pid, 0)
    process.kill(pid, "SIGKILL")
  } catch {
    // Already exited.
  }
}

export function createPlatformAdapter(options: PlatformAdapterOptions = {}): PlatformAdapter {
  const platform = options.platform === "win32" ? "win32" : "darwin"

  return {
    platform,
    normalizeComparablePath: (value) => normalizeComparablePath(value, platform),
    getDefaultShell: () => getDefaultShell(platform, options.env),
    getBundledBunName: () => getBundledBunName(platform),
    getPythonExecutable: (root) => getPythonExecutable(root, platform),
    openPath: async (targetPath) => {
      const result = options.openPath
        ? await options.openPath(targetPath)
        : await defaultOpenPath(targetPath, platform)
      if (typeof result === "string" && result.trim()) {
        throw new Error(result)
      }
    },
    terminateProcessTree: (pid) => terminateProcessTree(pid, platform),
  }
}
