import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import { lstat, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ApiError } from "#server/error.ts"

type HelperResponse<T> = { id: string; result?: T; error?: { code?: string; message?: string } }
type NativeHelperMode = "anybox" | "standalone"
type ArtifactRecord = { type?: unknown; path?: unknown; sha256?: unknown }
type ManifestExecutable = { platform?: unknown; architecture?: unknown; path?: unknown; sha256?: unknown }

let helperOverride: string | undefined
let callOverride: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | undefined
let configuredHelperPath: string | undefined

const HELPER_ARTIFACT_ID = "cinema-platform-helper"
const SHA256_PATTERN = /^[a-f0-9]{64}$/i

function configurationError(message: string) {
  return new ApiError(503, "NATIVE_HELPER_CONFIGURATION_INVALID", message)
}

function pluginRootPath() {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  return path.basename(moduleDirectory) === "runtime"
    ? path.resolve(moduleDirectory, "..")
    : path.resolve(moduleDirectory, "..", "..")
}

function managedHelper(raw: string | undefined) {
  if (!raw?.trim()) throw configurationError("Anybox did not provide the managed Cinema helper artifact map.")
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw configurationError("Anybox provided an invalid Cinema helper artifact map.")
  }
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, ArtifactRecord>)[HELPER_ARTIFACT_ID]
    : undefined
  const candidate = typeof record?.path === "string" ? record.path.trim() : ""
  const digest = typeof record?.sha256 === "string" ? record.sha256.trim().toLowerCase() : ""
  if (record?.type !== "app-runtime-helper" || !candidate || !path.isAbsolute(candidate) || !SHA256_PATTERN.test(digest)) {
    throw configurationError("Anybox did not provide complete managed Cinema helper metadata.")
  }
  return { path: path.resolve(candidate), sha256: digest }
}

async function bundledHelper() {
  const pluginRoot = pluginRootPath()
  const manifestPath = path.join(pluginRoot, ".anybox-plugin", "plugin.json")
  let manifest: {
    platformArtifacts?: Array<{ id?: unknown; type?: unknown; executables?: ManifestExecutable[] }>
  }
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  } catch {
    throw configurationError("The Cinema plugin manifest could not be read for standalone helper verification.")
  }
  const artifact = manifest.platformArtifacts?.find((entry) => entry.id === HELPER_ARTIFACT_ID)
  const executable = artifact?.executables?.find((entry) => (
    entry.platform === process.platform && entry.architecture === process.arch
  ))
  const relativePath = typeof executable?.path === "string" ? executable.path.trim() : ""
  const digest = typeof executable?.sha256 === "string" ? executable.sha256.trim().toLowerCase() : ""
  if (artifact?.type !== "app-runtime-helper" || !relativePath || !SHA256_PATTERN.test(digest)) {
    throw configurationError(`The Cinema plugin does not declare a helper for ${process.platform}-${process.arch}.`)
  }
  const candidate = path.resolve(pluginRoot, ...relativePath.replaceAll("\\", "/").split("/"))
  const relative = path.relative(pluginRoot, candidate)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw configurationError("The standalone Cinema helper path escapes the plugin package.")
  }
  return { path: candidate, sha256: digest }
}

async function sha256(filePath: string) {
  const hash = createHash("sha256")
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

async function verifyHelper(candidate: { path: string; sha256: string }) {
  const info = await lstat(candidate.path).catch(() => undefined)
  if (!info?.isFile() || info.isSymbolicLink()) {
    throw configurationError("The configured Cinema helper is missing or is not a regular file.")
  }
  if (await sha256(candidate.path) !== candidate.sha256) {
    throw configurationError("The configured Cinema helper failed SHA-256 verification.")
  }
  return candidate.path
}

export async function configureNativeHelper(input: {
  mode: NativeHelperMode
  artifactsJSON?: string
}) {
  configuredHelperPath = undefined
  const candidate = input.mode === "anybox"
    ? managedHelper(input.artifactsJSON)
    : await bundledHelper()
  configuredHelperPath = await verifyHelper(candidate)
  return configuredHelperPath
}

export function nativeHelperPath() {
  const configured = helperOverride ?? configuredHelperPath
  if (!configured) {
    throw new ApiError(503, "KEYCHAIN_UNAVAILABLE", "The Cinema helper was not configured before use.")
  }
  return configured
}

export async function callNativeHelper<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (callOverride) return await callOverride(method, params) as T
  const id = crypto.randomUUID()
  const executable = nativeHelperPath()
  return await new Promise<T>((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
    let stdout = ""
    const timeout = setTimeout(() => {
      child.kill()
      reject(new ApiError(503, "KEYCHAIN_UNAVAILABLE", "Cinema platform helper timed out."))
    }, 15_000)
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { stdout += chunk })
    // Helper stderr is intentionally discarded: platform APIs can include
    // account names or OS diagnostics that must never reach Runtime logs/API.
    child.stderr.resume()
    child.once("error", () => {
      clearTimeout(timeout)
      reject(new ApiError(503, "KEYCHAIN_UNAVAILABLE", "Cinema platform helper is unavailable."))
    })
    child.once("close", () => {
      clearTimeout(timeout)
      try {
        const response = JSON.parse(stdout.trim()) as HelperResponse<T>
        if (response.id !== id || response.error) {
          reject(new ApiError(503, response.error?.code || "KEYCHAIN_UNAVAILABLE", response.error?.message || "Cinema platform helper failed."))
          return
        }
        resolve(response.result as T)
      } catch {
        reject(new ApiError(503, "KEYCHAIN_UNAVAILABLE", "Cinema platform helper returned an invalid response."))
      }
    })
    child.stdin.end(`${JSON.stringify({ id, method, params })}\n`)
  })
}

export async function pickDirectory() {
  return await callNativeHelper<{ path: string | null }>("dialog.pickDirectory")
}

export async function pickFile(filters?: Array<{ name: string; extensions: string[] }>) {
  return await callNativeHelper<{ path: string | null }>("dialog.pickFile", { filters: filters ?? [] })
}

export function setNativeHelperPathForTest(value: string | undefined) {
  helperOverride = value
}

export function resetNativeHelperConfigurationForTest() {
  helperOverride = undefined
  configuredHelperPath = undefined
}

export function setNativeHelperCallForTest(
  value: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | undefined,
) {
  const previous = callOverride
  callOverride = value
  return () => { callOverride = previous }
}
