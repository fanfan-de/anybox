import { execFile } from "node:child_process"
import { statSync } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"

export const POWERSHELL_7_PROBE_TIMEOUT_MS = 5_000

export const POWERSHELL_7_INSTALL_MESSAGE = [
  "PowerShell 7 is required but pwsh.exe was not found.",
  "Install it with:",
  "winget install --id Microsoft.PowerShell --source winget",
  "Then restart Anybox.",
  "Windows PowerShell 5.1 is not supported.",
].join("\n")

export const WINDOWS_POWERSHELL_UNSUPPORTED_MESSAGE =
  "Windows PowerShell 5.1 (powershell.exe) is not supported. Use PowerShell 7 (pwsh.exe) instead."

const POWERSHELL_7_PROBE_SCRIPT = [
  "$value = [ordered]@{ version = $PSVersionTable.PSVersion.ToString(); edition = $PSVersionTable.PSEdition }",
  "$value | ConvertTo-Json -Compress",
].join("; ")

const POWERSHELL_7_PROBE_ARGS = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  POWERSHELL_7_PROBE_SCRIPT,
] as const

export const POWERSHELL_7_UTF8_PREAMBLE = [
  "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "$OutputEncoding = [Console]::OutputEncoding",
].join("; ")

export function preparePowerShell7Command(command: string) {
  return `${POWERSHELL_7_UTF8_PREAMBLE}; ${command}`
}

export function buildPowerShell7Args(command: string, tty = false) {
  return [
    "-NoLogo",
    "-NoProfile",
    ...(tty ? [] : ["-NonInteractive"]),
    "-Command",
    preparePowerShell7Command(command),
  ]
}

export interface PowerShell7Runtime {
  available: true
  executable: string
  version: string
  edition: "Core"
  major: 7
}

export interface PowerShell7Unavailable {
  available: false
  message: string
  detail: string
}

export type PowerShell7DetectionResult = PowerShell7Runtime | PowerShell7Unavailable

export interface PowerShellProbeInput {
  executable: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

export type PowerShellProbe = (
  input: PowerShellProbeInput,
) => Promise<{ stdout: string; stderr: string }>

export type PowerShellWhichCommand = (
  command: string,
  env: NodeJS.ProcessEnv,
) => string | null

export interface PowerShell7DetectionOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  timeoutMs?: number
  whichCommand?: PowerShellWhichCommand
  isFile?: (candidate: string) => Promise<boolean>
  probe?: PowerShellProbe
}

export interface PowerShell7Detector {
  detect(): Promise<PowerShell7DetectionResult>
  validate(executable: string): Promise<PowerShell7DetectionResult>
}

function envValue(env: NodeJS.ProcessEnv, name: string) {
  const direct = env[name]
  if (direct !== undefined) return direct
  const matched = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase())
  return matched ? env[matched] : undefined
}

function commandExtensions(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  if (platform !== "win32" || path.win32.extname(command)) return [""]
  const configured = envValue(env, "PATHEXT")
  const extensions = (configured || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean)
  return ["", ...extensions]
}

function findCommandOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
) {
  const pathValue = envValue(env, "PATH") ?? ""
  const separator = platform === "win32" ? ";" : ":"
  const pathApi = platform === "win32" ? path.win32 : path.posix

  for (const directory of pathValue.split(separator)) {
    const normalizedDirectory = directory.trim().replace(/^"|"$/g, "")
    if (!normalizedDirectory) continue
    for (const extension of commandExtensions(command, env, platform)) {
      const candidate = pathApi.join(normalizedDirectory, `${command}${extension}`)
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {
        // Continue through PATH candidates.
      }
    }
  }

  return null
}

async function isExistingFile(candidate: string) {
  return stat(candidate).then((entry) => entry.isFile()).catch(() => false)
}

function runPowerShellProbe(input: PowerShellProbeInput) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      input.executable,
      [...input.args],
      {
        encoding: "utf8",
        env: input.env,
        maxBuffer: 64 * 1024,
        timeout: input.timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error)
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

function unavailable(detail: string): PowerShell7Unavailable {
  return {
    available: false,
    message: POWERSHELL_7_INSTALL_MESSAGE,
    detail,
  }
}

function parseProbeOutput(
  executable: string,
  stdout: string,
  stderr: string,
): PowerShell7DetectionResult {
  if (stderr.trim()) {
    return unavailable(`PowerShell probe wrote unexpected stderr output: ${stderr.trim()}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    return unavailable(`PowerShell probe returned invalid JSON from '${executable}'.`)
  }

  if (!parsed || typeof parsed !== "object") {
    return unavailable(`PowerShell probe returned an invalid payload from '${executable}'.`)
  }

  const version = Reflect.get(parsed, "version")
  const edition = Reflect.get(parsed, "edition")
  if (typeof version !== "string" || typeof edition !== "string") {
    return unavailable(`PowerShell probe did not report a version and edition for '${executable}'.`)
  }

  const versionMatch = /^(\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?$/.exec(version)
  if (!versionMatch) {
    return unavailable(`PowerShell reported an unreadable version '${version}' from '${executable}'.`)
  }

  const major = Number(versionMatch[1])
  if (major !== 7 || edition !== "Core") {
    return unavailable(
      `Unsupported PowerShell runtime '${version}' (${edition}) at '${executable}'. Only PowerShell 7.x (Core) is supported.`,
    )
  }

  return {
    available: true,
    executable,
    version,
    edition: "Core",
    major: 7,
  }
}

function normalizeExecutableCacheKey(executable: string, platform: NodeJS.Platform) {
  const normalized = platform === "win32"
    ? path.win32.normalize(executable).toLowerCase()
    : path.posix.normalize(executable)
  return normalized
}

function executableName(value: string) {
  const trimmed = value.trim().replace(/^(["'])(.*)\1$/, "$2")
  return path.win32.basename(trimmed).toLowerCase()
}

export function isWindowsPowerShellExecutable(value: string) {
  const name = executableName(value)
  return name === "powershell" || name === "powershell.exe"
}

export function isPowerShell7Executable(value: string) {
  const name = executableName(value)
  return name === "pwsh" || name === "pwsh.exe"
}

export function createPowerShell7Detector(
  options: PowerShell7DetectionOptions = {},
): PowerShell7Detector {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const timeoutMs = options.timeoutMs ?? POWERSHELL_7_PROBE_TIMEOUT_MS
  const whichCommand = options.whichCommand
    ?? ((command, candidateEnv) => findCommandOnPath(command, candidateEnv, platform))
  const isFile = options.isFile ?? isExistingFile
  const probe = options.probe ?? runPowerShellProbe
  const validationCache = new Map<string, Promise<PowerShell7DetectionResult>>()
  let detectionPromise: Promise<PowerShell7DetectionResult> | null = null

  const validate = (executable: string) => {
    const cacheKey = normalizeExecutableCacheKey(executable, platform)
    const cached = validationCache.get(cacheKey)
    if (cached) return cached

    const pending = probe({
      executable,
      args: POWERSHELL_7_PROBE_ARGS,
      env,
      timeoutMs,
    })
      .then(({ stdout, stderr }) => parseProbeOutput(executable, stdout, stderr))
      .catch((error) => unavailable(
        `Failed to validate PowerShell at '${executable}': ${error instanceof Error ? error.message : String(error)}`,
      ))
    validationCache.set(cacheKey, pending)
    return pending
  }

  const detect = () => {
    if (detectionPromise) return detectionPromise

    detectionPromise = (async () => {
      const fromPath = whichCommand("pwsh.exe", env) ?? whichCommand("pwsh", env)
      if (fromPath) return validate(fromPath)

      if (platform === "win32") {
        const candidates = [
          envValue(env, "ProgramFiles")
            ? path.win32.join(envValue(env, "ProgramFiles")!, "PowerShell", "7", "pwsh.exe")
            : null,
          envValue(env, "LOCALAPPDATA")
            ? path.win32.join(envValue(env, "LOCALAPPDATA")!, "Microsoft", "WindowsApps", "pwsh.exe")
            : null,
        ]

        for (const candidate of candidates) {
          if (candidate && await isFile(candidate)) return validate(candidate)
        }
      }

      return unavailable("PowerShell 7 executable 'pwsh.exe' was not found.")
    })()

    return detectionPromise
  }

  return { detect, validate }
}

export const powerShell7Detector = createPowerShell7Detector()

export function getPowerShell7Runtime() {
  return powerShell7Detector.detect()
}

export async function requirePowerShell7Runtime(
  detector: PowerShell7Detector = powerShell7Detector,
) {
  const runtime = await detector.detect()
  if (!runtime.available) throw new Error(runtime.message)
  return runtime
}
