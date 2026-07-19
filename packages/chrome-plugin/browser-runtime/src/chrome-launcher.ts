import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process"
import { access as nodeAccess } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type ChromeLaunchErrorCode =
  | "CHROME_NOT_FOUND"
  | "CHROME_LAUNCH_FAILED"

export class ChromeLaunchError extends Error {
  constructor(
    readonly code: ChromeLaunchErrorCode,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = "ChromeLaunchError"
  }
}

export interface ChromeLauncher {
  launch(): Promise<void>
}

type AccessFile = (filePath: string) => Promise<void>
type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess

export interface ChromeLauncherOptions {
  accessFile?: AccessFile
  env?: NodeJS.ProcessEnv
  homeDir?: string
  platform?: NodeJS.Platform
  spawnProcess?: SpawnProcess
}

function envValue(env: NodeJS.ProcessEnv, name: string) {
  const expected = name.toUpperCase()
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === expected && value?.trim()) return value.trim()
  }
  return undefined
}

function platformPath(platform: NodeJS.Platform) {
  return platform === "win32" ? path.win32 : path.posix
}

function pathCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  executableNames: readonly string[],
) {
  const value = envValue(env, "PATH")
  if (!value) return []
  const pathApi = platformPath(platform)
  const delimiter = platform === "win32" ? ";" : ":"
  return value
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/u, "$1"))
    .filter(Boolean)
    .flatMap((directory) =>
      executableNames.map((executable) => pathApi.join(directory, executable))
    )
}

function chromeExecutableCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  homeDir: string,
) {
  const pathApi = platformPath(platform)
  const configured = [
    envValue(env, "ANYBOX_CHROME_EXECUTABLE"),
    envValue(env, "CHROME_PATH"),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/^"(.*)"$/u, "$1"))

  if (platform === "win32") {
    const localAppData = envValue(env, "LOCALAPPDATA")
    const programFiles = envValue(env, "PROGRAMFILES")
    const programFilesX86 = envValue(env, "PROGRAMFILES(X86)")
    return [
      ...configured,
      ...(localAppData
        ? [pathApi.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")]
        : []),
      ...(programFiles
        ? [pathApi.join(programFiles, "Google", "Chrome", "Application", "chrome.exe")]
        : []),
      ...(programFilesX86
        ? [pathApi.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe")]
        : []),
      ...pathCandidates(env, platform, ["chrome.exe"]),
    ]
  }

  if (platform === "darwin") {
    return [
      ...configured,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      pathApi.join(
        homeDir,
        "Applications",
        "Google Chrome.app",
        "Contents",
        "MacOS",
        "Google Chrome",
      ),
      ...pathCandidates(env, platform, ["google-chrome"]),
    ]
  }

  if (platform === "linux") {
    return [
      ...configured,
      ...pathCandidates(env, platform, [
        "google-chrome-stable",
        "google-chrome",
      ]),
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/opt/google/chrome/google-chrome",
    ]
  }

  return configured
}

export async function resolveChromeExecutable(
  options: ChromeLauncherOptions = {},
) {
  const accessFile = options.accessFile ?? nodeAccess
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const homeDir = options.homeDir ?? os.homedir()
  const candidates = chromeExecutableCandidates(env, platform, homeDir)
  const pathApi = platformPath(platform)
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const normalized = pathApi.resolve(candidate)
    const key = platform === "win32" ? normalized.toLowerCase() : normalized
    if (seen.has(key)) continue
    seen.add(key)
    try {
      await accessFile(normalized)
      return normalized
    } catch {
      // Try the next supported Chrome installation location.
    }
  }

  throw new ChromeLaunchError(
    "CHROME_NOT_FOUND",
    "Google Chrome is not installed or its executable could not be found.",
  )
}

function spawnChrome(
  executablePath: string,
  spawnProcess: SpawnProcess,
) {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let child: ChildProcess
    try {
      child = spawnProcess(executablePath, [], {
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      })
    } catch (cause) {
      reject(new ChromeLaunchError(
        "CHROME_LAUNCH_FAILED",
        "Google Chrome could not be opened.",
        { cause },
      ))
      return
    }

    child.once("error", (cause) => {
      if (settled) return
      settled = true
      reject(new ChromeLaunchError(
        "CHROME_LAUNCH_FAILED",
        "Google Chrome could not be opened.",
        { cause },
      ))
    })
    child.once("spawn", () => {
      if (settled) return
      settled = true
      child.unref()
      resolve()
    })
  })
}

export function createChromeLauncher(
  options: ChromeLauncherOptions = {},
): ChromeLauncher {
  return {
    async launch() {
      const executablePath = await resolveChromeExecutable(options)
      await spawnChrome(
        executablePath,
        options.spawnProcess ?? nodeSpawn,
      )
    },
  }
}
