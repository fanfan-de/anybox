import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createServerApp } from "#server/server.ts"
import { ApiError } from "#server/error.ts"
import * as Global from "#global/global.ts"
import { clearSessionCredentials } from "#auth/provider-auth.ts"
import { clearSettingsCacheForTest } from "#config/config.ts"
import { resetProjectsForTest } from "#project/project.ts"
import { setNativeHelperCallForTest } from "../src/platform/native-helper.ts"

const originalPaths = { ...Global.Path }
const roots: string[] = []
const restores: Array<() => void> = []
const servers: Array<ReturnType<typeof Bun.serve>> = []

async function isolatedRuntime() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cinema-management-api-"))
  roots.push(root)
  const data = path.join(root, "runtime-data")
  Global.configureRuntimePaths({ data, cache: path.join(root, "cache"), log: path.join(root, "log") })
  resetProjectsForTest()
  clearSettingsCacheForTest()
  clearSessionCredentials()
  return { root, data }
}

async function json(response: Response) {
  return await response.json() as {
    success: boolean
    data?: any
    error?: { code: string; message: string; data?: unknown }
    requestId: string
  }
}

afterEach(async () => {
  servers.splice(0).forEach((server) => server.stop(true))
  while (restores.length) restores.pop()?.()
  clearSessionCredentials()
  clearSettingsCacheForTest()
  resetProjectsForTest()
  Global.configureRuntimePaths({ data: originalPaths.data, cache: originalPaths.cache, log: originalPaths.log })
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Cinema Runtime management API", () => {
  test("keeps the public project/provider/toolchain routes and response envelope stable", async () => {
    const { root } = await isolatedRuntime()
    const projectRoot = path.join(root, "project")
    await mkdir(projectRoot)
    await Bun.write(path.join(projectRoot, ".keep"), "")
    restores.push(setNativeHelperCallForTest(async (method) => {
      if (method === "dialog.pickDirectory") return { path: projectRoot }
      if (method === "credential.get") return { value: null }
      throw new ApiError(503, "KEYCHAIN_UNAVAILABLE", "Unavailable in the test runtime.")
    }))
    const app = createServerApp({ mode: "test" })

    const statusResponse = await app.request("http://localhost/api/cinema/runtime/status")
    const status = await json(statusResponse)
    expect(statusResponse.status).toBe(200)
    expect(status).toMatchObject({
      success: true,
      data: {
        version: "1.0.0",
        mode: "test",
        providers: ["klingai-cn", "google-ai-sdk", "comfyui-local", "openai-compatible"],
        projects: 0,
      },
    })
    expect(status.requestId).toBeString()

    const pickedResponse = await app.request("http://localhost/api/cinema/projects/pick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initialize: true }),
    })
    const picked = await json(pickedResponse)
    expect(pickedResponse.status).toBe(200)
    expect(picked.data.cancelled).toBe(false)
    expect(picked.data.project.id).toMatch(/^cin_[0-9a-f-]{36}$/)
    const projectID = picked.data.project.id as string

    expect((await json(await app.request("http://localhost/api/cinema/projects"))).data)
      .toEqual([expect.objectContaining({ id: projectID })])
    expect((await json(await app.request(`http://localhost/api/cinema/projects/${projectID}/open`, { method: "POST" }))).data.id)
      .toBe(projectID)
    expect((await json(await app.request(`http://localhost/api/cinema/projects/${projectID}/migration`))).data.state)
      .toBe("ready")

    const invalidProviderResponse = await app.request("http://localhost/api/cinema/providers/removed-provider/settings")
    expect(invalidProviderResponse.status).toBe(404)
    expect((await json(invalidProviderResponse)).error?.code).toBe("CINEMA_PROVIDER_NOT_FOUND")

    const credentialResponse = await app.request("http://localhost/api/cinema/providers/openai-compatible/credential")
    const credentialText = await credentialResponse.text()
    expect(credentialText).not.toContain("apiKey")
    expect(JSON.parse(credentialText).data).toEqual({ configured: false, persistence: "none" })

    const keychainUnavailable = await app.request("http://localhost/api/cinema/providers/openai-compatible/credential", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "must-not-leak" }),
    })
    expect(keychainUnavailable.status).toBe(503)
    expect((await json(keychainUnavailable)).error?.code).toBe("KEYCHAIN_UNAVAILABLE")

    const toolchain = await json(await app.request("http://localhost/api/cinema/toolchain/status"))
    expect(toolchain.success).toBe(true)
    expect(toolchain.data).toHaveProperty("status")

    const removed = await json(await app.request(`http://localhost/api/cinema/projects/${projectID}/recent`, { method: "DELETE" }))
    expect(removed.data).toEqual({ projectID, removed: true })
    expect((await json(await app.request("http://localhost/api/cinema/projects"))).data).toEqual([])
    expect(await readFile(path.join(projectRoot, ".anybox-cinema", "project.json"), "utf8")).toContain(projectID)
  })

  test("supports manual OpenAI-compatible models and safe loopback model discovery", async () => {
    const { data } = await isolatedRuntime()
    let authorization = ""
    const provider = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        authorization = request.headers.get("authorization") ?? ""
        if (new URL(request.url).pathname !== "/v1/models") return new Response("missing", { status: 404 })
        return Response.json({ data: [{ id: "model-b" }, { id: "model-a" }, { id: "" }, {}] })
      },
    })
    servers.push(provider)
    restores.push(setNativeHelperCallForTest(async () => {
      throw new ApiError(503, "KEYCHAIN_UNAVAILABLE", "No keychain in the test runtime.")
    }))
    const app = createServerApp()
    const settingsURL = "http://localhost/api/cinema/providers/openai-compatible/settings"
    const baseURL = `http://127.0.0.1:${provider.port}/v1`

    const updated = await app.request(settingsURL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseURL,
        defaultModel: "manual-model",
        models: [{ id: "manual-model", label: "Manual model", supportsImageInput: true }],
        textGenerationPrompt: "Cinema-owned prompt override",
      }),
    })
    expect(updated.status).toBe(200)
    const settings = (await json(await app.request(settingsURL))).data
    expect(settings).toMatchObject({
      baseURL,
      defaultModel: "manual-model",
      models: [{ id: "manual-model", label: "Manual model", supportsImageInput: true }],
      textGenerationPrompt: "Cinema-owned prompt override",
    })

    const credential = await app.request("http://localhost/api/cinema/providers/openai-compatible/credential", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "session-discovery-secret", persistence: "session" }),
    })
    expect(credential.status).toBe(200)
    expect(await credential.text()).not.toContain("session-discovery-secret")

    const discovered = await json(await app.request(
      "http://localhost/api/cinema/providers/openai-compatible/models/discover",
      { method: "POST" },
    ))
    expect(discovered.data.items).toEqual([{ id: "model-b" }, { id: "model-a" }])
    expect(authorization).toBe("Bearer session-discovery-secret")

    const persisted = await readFile(path.join(data, "settings.json"), "utf8")
    expect(persisted).toContain("manual-model")
    expect(persisted).toContain("Cinema-owned prompt override")
    expect(persisted).not.toContain("session-discovery-secret")
  })
})
