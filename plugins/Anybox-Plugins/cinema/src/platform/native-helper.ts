import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ApiError } from "#server/error.ts"

type HelperResponse<T> = { id: string; result?: T; error?: { code?: string; message?: string } }

let helperOverride: string | undefined
let callOverride: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | undefined

function artifactHelperPath() {
  const raw = process.env.ANYBOX_APP_ARTIFACTS_JSON?.trim()
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw) as Record<string, { path?: unknown }>
    const candidate = value["cinema-platform-helper"]?.path
    return typeof candidate === "string" && candidate.trim() ? candidate : undefined
  } catch {
    return undefined
  }
}

function bundledHelperPath() {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  const target = `${process.platform}-${process.arch}`
  const executable = process.platform === "win32" ? "cinema-platform-helper.exe" : "cinema-platform-helper"
  const pluginRoot = path.basename(moduleDirectory) === "runtime"
    ? path.resolve(moduleDirectory, "..")
    : path.resolve(moduleDirectory, "..", "..")
  return path.join(pluginRoot, "native", "artifacts", target, executable)
}

export function nativeHelperPath() {
  return helperOverride ?? artifactHelperPath() ?? bundledHelperPath()
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

export function setNativeHelperCallForTest(
  value: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | undefined,
) {
  const previous = callOverride
  callOverride = value
  return () => { callOverride = previous }
}
