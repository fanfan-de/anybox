import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "#server/types.ts"
import { ApiError } from "#server/error.ts"
import { ok, parseJsonBody } from "#server/http.ts"
import * as Projects from "#project/project.ts"
import * as Settings from "#config/config.ts"
import * as ProviderAuth from "#auth/provider-auth.ts"
import * as Providers from "#cinema/provider-runtime.ts"
import { pickDirectory, pickFile } from "#platform/native-helper.ts"
import * as Lock from "#util/lock.ts"
import { assertSafeProviderURL, sameOriginFetch } from "../providers/network-policy.ts"
import { cancelToolchainInstall, getToolchainStatus, importToolchainArchive, installToolchain } from "#platform/toolchain.ts"
import cinemaVersion from "../version.json"

const PROVIDERS = ["klingai-cn", "google-ai-sdk", "comfyui-local", "openai-compatible"] as const
const ProviderID = z.enum(PROVIDERS)
const OpenProjectBody = z.object({ initialize: z.boolean().default(false) }).strict()
const CredentialBody = z.object({
  apiKey: z.string().min(1),
  persistence: z.enum(["system-keychain", "session"]).default("system-keychain"),
}).strict()
const SettingsBody = z.object({
  baseURL: z.string().nullable().optional(),
  userID: z.string().nullable().optional(),
  defaultModel: z.string().nullable().optional(),
  models: z.array(z.object({
    id: z.string().min(1),
    label: z.string().optional(),
    supportsImageInput: z.boolean().optional(),
  }).strict()).optional(),
  textGenerationPrompt: z.string().nullable().optional(),
}).strict()
const ProviderConnectionBody = SettingsBody.pick({ baseURL: true, userID: true })
const PROVIDER_CONFIGURATION_LOCK_KEY = "cinema-provider-configuration"
const ProviderConfigurationBody = z.object({
  settings: SettingsBody.optional(),
  credential: CredentialBody.optional(),
}).strict().refine(
  (input) => input.settings !== undefined || input.credential !== undefined,
  { message: "Provider configuration must include settings or a credential." },
)

type ProviderID = typeof PROVIDERS[number]
type ProviderSettingsInput = z.infer<typeof SettingsBody>

function parseProviderID(value: string) {
  const parsed = ProviderID.safeParse(value)
  if (!parsed.success) throw new ApiError(404, "CINEMA_PROVIDER_NOT_FOUND", `Cinema provider '${value}' was not found.`)
  return parsed.data
}

function credentialProviderID(providerID: ProviderID) {
  if (providerID === "klingai-cn") return "cinema-klingai-cn"
  if (providerID === "google-ai-sdk") return "google"
  return providerID
}

async function readProviderSettings(providerID: ProviderID) {
  if (providerID === "openai-compatible") {
    const settings = await Settings.getSettings()
    return { ...settings.openAICompatible, textGenerationPrompt: settings.prompts.textGeneration ?? null }
  }
  const settings = await Settings.getCinemaVideoProviderSettings(providerID)
  if (providerID !== "comfyui-local") return settings
  const provider = await Providers.getCinemaVideoProvider(providerID)
  return {
    ...settings,
    ...(provider.runtime?.baseURL ? { baseURL: provider.runtime.baseURL } : {}),
    ...(provider.runtime?.userID ? { userID: provider.runtime.userID } : {}),
    ...(provider.runtime?.baseURLSource ? { baseURLSource: provider.runtime.baseURLSource } : {}),
  }
}

async function persistProviderSettings(providerID: ProviderID, input: ProviderSettingsInput) {
  if (providerID === "openai-compatible") {
    await Settings.updateSettings((current) => ({
      ...current,
      openAICompatible: {
        baseURL: input.baseURL === null ? "https://api.openai.com/v1" : input.baseURL ?? current.openAICompatible.baseURL,
        ...(input.defaultModel === null ? {} : { defaultModel: input.defaultModel ?? current.openAICompatible.defaultModel }),
        models: input.models ?? current.openAICompatible.models,
      },
      prompts: {
        ...(input.textGenerationPrompt === null ? {} : { textGeneration: input.textGenerationPrompt ?? current.prompts.textGeneration }),
      },
    }))
    return await readProviderSettings(providerID)
  }
  await Providers.saveCinemaVideoProviderSettings(providerID, { baseURL: input.baseURL, userID: input.userID })
  return await readProviderSettings(providerID)
}

async function readCredentialState(providerID: ProviderID) {
  const auth = await ProviderAuth.resolveProviderRuntimeAuth(credentialProviderID(providerID))
  return { configured: Boolean(auth.apiKey), persistence: auth.credentialSource }
}

async function openAIModels() {
  const settings = await Settings.getSettings()
  const credential = await ProviderAuth.readProviderApiKey("openai-compatible")
  if (!credential) throw new ApiError(400, "CINEMA_PROVIDER_NOT_CONNECTED", "OpenAI Compatible API key is not configured.")
  const baseURL = await assertSafeProviderURL(settings.openAICompatible.baseURL)
  const url = new URL(`${baseURL.toString().replace(/\/$/, "")}/models`)
  const response = await sameOriginFetch(url, { headers: { Authorization: `Bearer ${credential.value}` } })
  if (!response.ok) throw new ApiError(502, "CINEMA_PROVIDER_TEST_FAILED", `Model discovery failed with HTTP ${response.status}.`)
  const payload = await response.json() as { data?: Array<{ id?: unknown }> }
  return (payload.data ?? []).flatMap((item) => typeof item.id === "string" && item.id.trim() ? [{ id: item.id.trim() }] : [])
}

export function CinemaManagementRoutes() {
  const app = new Hono<AppEnv>()

  app.get("/runtime/status", async (c) => ok(c, {
    version: process.env.ANYBOX_APP_VERSION?.trim() || cinemaVersion.version,
    mode: c.get("runtimeMode"),
    providers: [...PROVIDERS],
    projects: (await Projects.listRecentProjects()).length,
    toolchain: await getToolchainStatus().catch((error) => ({ status: "error", message: error instanceof Error ? error.message : String(error) })),
  }))

  app.get("/projects", async (c) => ok(c, await Projects.listRecentProjects()))
  app.post("/projects/pick", async (c) => {
    const input = await parseJsonBody(c, OpenProjectBody, "Project picker request is invalid.", {})
    const selected = await pickDirectory()
    if (!selected.path) return ok(c, { cancelled: true })
    const project = input.initialize
      ? await Projects.initializeCinemaProject(selected.path)
      : await Projects.openProjectRoot(selected.path)
    return ok(c, { cancelled: false, project })
  })
  app.post("/projects/:projectID/open", async (c) => ok(c, await Projects.openRecentProject(c.req.param("projectID"))))
  app.delete("/projects/:projectID/recent", async (c) => ok(c, await Projects.removeRecentProject(c.req.param("projectID"))))
  app.get("/projects/:projectID/migration", async (c) => ok(c, await Projects.getProjectMigration(c.req.param("projectID"))))
  app.post("/projects/:projectID/migration", async (c) => ok(c, await Projects.runProjectMigration(c.req.param("projectID"))))

  app.get("/providers/:providerID/settings", async (c) => {
    const providerID = parseProviderID(c.req.param("providerID"))
    return ok(c, await readProviderSettings(providerID))
  })
  app.put("/providers/:providerID/settings", async (c) => {
    const providerID = parseProviderID(c.req.param("providerID"))
    const input = await parseJsonBody(c, SettingsBody, "Provider settings are invalid.")
    if (input.baseURL) await assertSafeProviderURL(input.baseURL)
    using _configurationLock = await Lock.write(PROVIDER_CONFIGURATION_LOCK_KEY)
    return ok(c, await persistProviderSettings(providerID, input))
  })

  app.get("/providers/:providerID/credential", async (c) => {
    const providerID = parseProviderID(c.req.param("providerID"))
    return ok(c, await readCredentialState(providerID))
  })
  app.put("/providers/:providerID/credential", async (c) => {
    const providerID = parseProviderID(c.req.param("providerID"))
    const input = await parseJsonBody(c, CredentialBody, "Provider credential is invalid.")
    using _configurationLock = await Lock.write(PROVIDER_CONFIGURATION_LOCK_KEY)
    const result = await ProviderAuth.saveProviderApiKey(
      credentialProviderID(providerID),
      input.apiKey,
      { allowSession: input.persistence === "session" },
    )
    return ok(c, { configured: true, ...result })
  })
  app.put("/providers/:providerID/configuration", async (c) => {
    const providerID = parseProviderID(c.req.param("providerID"))
    const input = await parseJsonBody(c, ProviderConfigurationBody, "Provider configuration is invalid.")
    if (input.settings?.baseURL) await assertSafeProviderURL(input.settings.baseURL)

    using _configurationLock = await Lock.write(PROVIDER_CONFIGURATION_LOCK_KEY)
    const previousSettings = input.settings ? structuredClone(await Settings.getSettings()) : undefined
    let settingsChanged = false
    try {
      if (input.settings) {
        await persistProviderSettings(providerID, input.settings)
        settingsChanged = true
      }
      const credential = input.credential
        ? {
            configured: true,
            ...await ProviderAuth.saveProviderApiKey(
              credentialProviderID(providerID),
              input.credential.apiKey,
              { allowSession: input.credential.persistence === "session" },
            ),
          }
        : await readCredentialState(providerID)
      return ok(c, {
        settings: await readProviderSettings(providerID),
        credential,
      })
    } catch (error) {
      if (settingsChanged && previousSettings) {
        try {
          await Settings.saveSettings(previousSettings)
        } catch (rollbackError) {
          throw new ApiError(
            500,
            "CINEMA_PROVIDER_CONFIGURATION_RECOVERY_REQUIRED",
            "Provider settings could not be restored after credential persistence failed.",
            {
              cause: error instanceof Error ? error.message : String(error),
              rollback: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
            },
          )
        }
      }
      throw error
    }
  })
  app.delete("/providers/:providerID/credential", async (c) => {
    const providerID = parseProviderID(c.req.param("providerID"))
    using _configurationLock = await Lock.write(PROVIDER_CONFIGURATION_LOCK_KEY)
    await ProviderAuth.saveProviderApiKey(credentialProviderID(providerID), null)
    return ok(c, { configured: false, persistence: "none" })
  })
  app.post("/providers/:providerID/test", async (c) => {
    const providerID = parseProviderID(c.req.param("providerID"))
    if (providerID === "openai-compatible") return ok(c, { ok: true, models: await openAIModels() })
    return ok(c, await Providers.testCinemaVideoProviderConnection(providerID, {}))
  })
  app.post("/providers/:providerID/connect", async (c) => {
    const providerID = parseProviderID(c.req.param("providerID"))
    const input = await parseJsonBody(c, ProviderConnectionBody, "Provider connection settings are invalid.")
    return ok(c, await Providers.connectCinemaVideoProvider(providerID, input))
  })
  app.post("/providers/openai-compatible/models/discover", async (c) => ok(c, { items: await openAIModels() }))

  app.get("/toolchain/status", async (c) => ok(c, await getToolchainStatus()))
  app.post("/toolchain/install", async (c) => ok(c, await installToolchain(), 201))
  app.post("/toolchain/import", async (c) => {
    const selected = await pickFile([{ name: "Cinema media tool archive", extensions: ["tar.gz", "tgz"] }])
    if (!selected.path) return ok(c, { cancelled: true })
    return ok(c, { cancelled: false, toolchain: await importToolchainArchive(selected.path) })
  })
  app.post("/toolchain/cancel", (c) => ok(c, cancelToolchainInstall()))

  return app
}
