"use strict"

const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const POWERSHELL_7_INSTALL_MESSAGE = [
  "PowerShell 7 is required but pwsh.exe was not found.",
  "Install it with:",
  "winget install --id Microsoft.PowerShell --source winget",
  "Then restart Anybox.",
  "Windows PowerShell 5.1 is not supported.",
].join("\n")

const PROBE_ARGS = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  [
    "$value = [ordered]@{ version = $PSVersionTable.PSVersion.ToString(); edition = $PSVersionTable.PSEdition }",
    "$value | ConvertTo-Json -Compress",
  ].join("; "),
]

function envValue(env, name) {
  const direct = env[name]
  if (direct !== undefined) return direct
  const matched = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase())
  return matched ? env[matched] : undefined
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

function findOnPath(command, env, platform) {
  const value = envValue(env, "PATH") ?? ""
  const separator = platform === "win32" ? ";" : ":"
  const pathApi = platform === "win32" ? path.win32 : path.posix

  for (const directory of value.split(separator)) {
    const normalizedDirectory = directory.trim().replace(/^"|"$/gu, "")
    if (!normalizedDirectory) continue
    const candidate = pathApi.join(normalizedDirectory, command)
    if (isFile(candidate)) return candidate
  }

  return null
}

function unavailable(detail) {
  return {
    available: false,
    message: POWERSHELL_7_INSTALL_MESSAGE,
    detail,
  }
}

function parseProbe(executable, result) {
  if (result.error || result.status !== 0) {
    return unavailable(
      `Failed to validate PowerShell at '${executable}': ${result.error?.message ?? `exit ${result.status ?? "unknown"}`}`,
    )
  }
  if (String(result.stderr ?? "").trim()) {
    return unavailable(`PowerShell probe wrote unexpected stderr output for '${executable}'.`)
  }

  let parsed
  try {
    parsed = JSON.parse(String(result.stdout ?? "").trim())
  } catch {
    return unavailable(`PowerShell probe returned invalid JSON from '${executable}'.`)
  }

  const version = parsed?.version
  const edition = parsed?.edition
  const versionMatch = typeof version === "string"
    ? /^(\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?$/u.exec(version)
    : null
  if (!versionMatch || edition !== "Core" || Number(versionMatch[1]) !== 7) {
    return unavailable(
      `Unsupported PowerShell runtime '${String(version)}' (${String(edition)}) at '${executable}'. Only PowerShell 7.x (Core) is supported.`,
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

function createPowerShell7Detector(options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const run = options.spawnSync ?? spawnSync
  const whichCommand = options.whichCommand
    ?? ((command) => findOnPath(command, env, platform))
  const fileExists = options.isFile ?? isFile
  let cached

  return {
    detect() {
      if (cached) return cached

      let executable = whichCommand("pwsh.exe") ?? whichCommand("pwsh")
      if (!executable && platform === "win32") {
        const programFiles = envValue(env, "ProgramFiles")
        const localAppData = envValue(env, "LOCALAPPDATA")
        const candidates = [
          programFiles ? path.win32.join(programFiles, "PowerShell", "7", "pwsh.exe") : null,
          localAppData ? path.win32.join(localAppData, "Microsoft", "WindowsApps", "pwsh.exe") : null,
        ]
        executable = candidates.find((candidate) => candidate && fileExists(candidate)) ?? null
      }

      if (!executable) {
        cached = unavailable("PowerShell 7 executable 'pwsh.exe' was not found.")
        return cached
      }

      cached = parseProbe(executable, run(executable, PROBE_ARGS, {
        encoding: "utf8",
        env,
        maxBuffer: 64 * 1024,
        timeout: 5_000,
        windowsHide: true,
      }))
      return cached
    },
  }
}

module.exports = {
  createPowerShell7Detector,
  POWERSHELL_7_INSTALL_MESSAGE,
}
