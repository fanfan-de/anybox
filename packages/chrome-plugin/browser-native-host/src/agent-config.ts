import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const DEFAULT_AGENT_BASE_URL = "http://127.0.0.1:4096"
export const HOST_NAME = "com.anybox.browser"

const RUNTIME_CONFIG_ENV = "ANYBOX_BROWSER_NATIVE_CONFIG"
const RUNTIME_CONFIG_FILENAME = `${HOST_NAME}.runtime.json`
const APP_DATA_DIRECTORY_NAMES = ["anybox-desktop-agent", "Anybox"] as const

type Environment = Record<string, string | undefined>

function unique(values: string[]) {
  return [...new Set(values)]
}

export function normalizeAgentBaseURL(value: unknown) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  try {
    const url = new URL(trimmed)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return url.toString().replace(/\/+$/, "")
  } catch {
    return undefined
  }
}

export function runtimeConfigPathCandidates(env: Environment = process.env) {
  const candidates: string[] = []
  const explicitPath = env[RUNTIME_CONFIG_ENV]?.trim()
  if (explicitPath) candidates.push(explicitPath)

  const appData = env.APPDATA?.trim()
  if (appData) {
    for (const directoryName of APP_DATA_DIRECTORY_NAMES) {
      candidates.push(join(appData, directoryName, "native-messaging", RUNTIME_CONFIG_FILENAME))
    }
  }

  const homeDirectory = env.USERPROFILE?.trim() || env.HOME?.trim() || homedir()
  if (homeDirectory) {
    for (const directoryName of APP_DATA_DIRECTORY_NAMES) {
      candidates.push(join(homeDirectory, "Library", "Application Support", directoryName, "native-messaging", RUNTIME_CONFIG_FILENAME))
      candidates.push(join(env.XDG_CONFIG_HOME?.trim() || join(homeDirectory, ".config"), directoryName, "native-messaging", RUNTIME_CONFIG_FILENAME))
    }
  }

  return unique(candidates)
}

export function readRuntimeConfigAgentBaseURL(env: Environment = process.env) {
  for (const configPath of runtimeConfigPathCandidates(env)) {
    if (!existsSync(configPath)) continue

    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8")) as { agentBaseURL?: unknown }
      const normalized = normalizeAgentBaseURL(parsed.agentBaseURL)
      if (normalized) return normalized
    } catch {
      // Ignore stale or malformed discovery files and keep trying fallbacks.
    }
  }

  return undefined
}

export function agentBaseURL(env: Environment = process.env) {
  return normalizeAgentBaseURL(env.ANYBOX_AGENT_BASE_URL) ||
    readRuntimeConfigAgentBaseURL(env) ||
    DEFAULT_AGENT_BASE_URL
}
