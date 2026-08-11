import { afterEach, describe, expect, test } from "bun:test"
import { access, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const runtimePath = path.join(pluginRoot, "runtime", "server.js")
const pluginManifest = JSON.parse(await readFile(path.join(pluginRoot, ".anybox-plugin", "plugin.json"), "utf8"))
const expectedVersion = String(pluginManifest.version)
const roots: string[] = []
const children: Array<ReturnType<typeof Bun.spawn>> = []

function lineReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  return async (predicate: (line: string) => boolean, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const newline = buffer.indexOf("\n")
      if (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (predicate(line)) return line
        continue
      }
      const remaining = Math.max(1, deadline - Date.now())
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out reading Cinema Runtime output.")), remaining)),
      ])
      if (result.done) throw new Error("Cinema Runtime exited before it became ready.")
      buffer += result.value
    }
    throw new Error("Timed out waiting for Cinema Runtime output.")
  }
}

async function temporaryRoot(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    child.kill()
    await child.exited.catch(() => undefined)
  }))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Cinema Runtime process modes", () => {
  test("exchanges a one-time standalone bootstrap token for a strict session and CSRF cookie", async () => {
    const root = await temporaryRoot("cinema-standalone-")
    const data = path.join(root, "data")
    const cache = path.join(root, "cache")
    const log = path.join(root, "log")
    const child = Bun.spawn([
      process.execPath,
      runtimePath,
      "--standalone",
      "--port=0",
      `--data-dir=${data}`,
      `--cache-dir=${cache}`,
      `--log-dir=${log}`,
    ], {
      cwd: pluginRoot,
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env },
    })
    children.push(child)
    const readLine = lineReader(child.stdout)
    const bootstrapLine = await readLine((line) => line.startsWith("[cinema-runtime] open "))
    const bootstrapURL = bootstrapLine.slice("[cinema-runtime] open ".length)
    const origin = new URL(bootstrapURL).origin

    const bootstrap = await fetch(bootstrapURL, { redirect: "manual" })
    expect(bootstrap.status).toBe(302)
    expect(bootstrap.headers.get("location")).toBe("/")
    expect(bootstrap.headers.get("referrer-policy")).toBe("no-referrer")
    const setCookie = typeof bootstrap.headers.getSetCookie === "function"
      ? bootstrap.headers.getSetCookie().join(",")
      : bootstrap.headers.get("set-cookie") ?? ""
    const session = /cinema_session=([^;,]+)/.exec(setCookie)?.[1]
    const csrf = /cinema_csrf=([^;,]+)/.exec(setCookie)?.[1]
    expect(session).toBeString()
    expect(csrf).toBeString()
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("SameSite=Strict")
    const cookie = `cinema_session=${session}; cinema_csrf=${csrf}`

    const page = await fetch(`${origin}/`, { headers: { cookie } })
    expect(page.status).toBe(200)
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'")
    expect(page.headers.get("x-content-type-options")).toBe("nosniff")

    const status = await fetch(`${origin}/api/cinema/runtime/status`, { headers: { cookie } })
    expect(status.status).toBe(200)
    expect((await status.json()).data).toMatchObject({
      mode: "standalone",
      version: expectedVersion,
      providers: ["klingai-cn", "google-ai-sdk", "comfyui-local", "openai-compatible"],
    })

    const settingsURL = `${origin}/api/cinema/providers/openai-compatible/settings`
    const rejected = await fetch(settingsURL, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ models: [{ id: "standalone-model" }] }),
    })
    expect(rejected.status).toBe(403)
    const accepted = await fetch(settingsURL, {
      method: "PUT",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "x-cinema-csrf": decodeURIComponent(csrf!),
      },
      body: JSON.stringify({ models: [{ id: "standalone-model" }] }),
    })
    expect(accepted.status).toBe(200)
    await expect(access(path.join(data, "settings.json"))).resolves.toBeNull()

    const reused = await fetch(bootstrapURL, { redirect: "manual" })
    expect(reused.status).toBe(401)
    expect(await reused.text()).not.toContain(new URL(bootstrapURL).searchParams.get("token")!)
  }, 30_000)

  test("accepts only the Runtime Gateway token in Anybox mode", async () => {
    const root = await temporaryRoot("cinema-anybox-runtime-")
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reserved") })
    const port = reservation.port
    reservation.stop(true)
    const token = crypto.randomUUID()
    const executable = pluginManifest.platformArtifacts
      ?.find((artifact: any) => artifact.id === "cinema-platform-helper")
      ?.executables?.find((entry: any) => entry.platform === process.platform && entry.architecture === process.arch)
    expect(executable?.path).toBeString()
    expect(executable?.sha256).toBeString()
    const child = Bun.spawn([process.execPath, runtimePath], {
      cwd: pluginRoot,
      stdout: "pipe",
      stderr: "inherit",
      env: {
        ...process.env,
        ANYBOX_APP_ID: "cinema",
        ANYBOX_APP_VERSION: expectedVersion,
        ANYBOX_APP_PORT: String(port),
        ANYBOX_APP_TOKEN: token,
        ANYBOX_APP_DATA_DIR: path.join(root, "data"),
        ANYBOX_APP_CACHE_DIR: path.join(root, "cache"),
        ANYBOX_APP_LOG_DIR: path.join(root, "log"),
        ANYBOX_APP_ARTIFACTS_JSON: JSON.stringify({
          "cinema-platform-helper": {
            type: "app-runtime-helper",
            path: path.resolve(pluginRoot, ...String(executable.path).split("/")),
            sha256: executable.sha256,
          },
        }),
      },
    })
    children.push(child)
    await lineReader(child.stdout)((line) => line.startsWith("[cinema-runtime] ready "))
    const origin = `http://127.0.0.1:${port}`

    expect((await fetch(`${origin}/health`)).status).toBe(401)
    expect((await fetch(`${origin}/health`, {
      headers: { "x-anybox-app-runtime-token": "wrong" },
    })).status).toBe(401)
    const health = await fetch(`${origin}/health`, {
      headers: { "x-anybox-app-runtime-token": token },
    })
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ ready: true, appID: "cinema", mode: "anybox" })
  }, 30_000)
})
