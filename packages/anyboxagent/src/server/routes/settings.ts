import { Hono } from "hono"
import { ok, parseJsonBody, parseQuery } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"
import * as SettingsUseCase from "#server/usecases/settings.ts"

function resolveServerBaseURL(url: string) {
  const requestURL = new URL(url)
  return `${requestURL.protocol}//${requestURL.host}`
}

export function SettingsRoutes() {
  const app = new Hono<AppEnv>()

  app.get("/providers/catalog", async (c) => ok(c, await SettingsUseCase.listProviderCatalog()))

  app.post("/providers/catalog/refresh", async (c) =>
    ok(c, await SettingsUseCase.refreshProviderCatalog()),
  )

  app.get("/providers", async (c) => ok(c, await SettingsUseCase.listProviders()))

  app.get("/models", async (c) => ok(c, await SettingsUseCase.listModels()))

  app.get("/model-catalog", async (c) => ok(c, await SettingsUseCase.listModelCatalog()))

  app.post("/providers/custom", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.UpsertCustomProviderBody,
      "Body must contain custom provider fields.",
    )
    return ok(c, await SettingsUseCase.upsertCustomProvider(payload))
  })

  app.post("/providers/custom/test", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.TestCustomProviderConnectionBody,
      "Body must contain custom provider connection test fields.",
    )
    return ok(c, await SettingsUseCase.testCustomProviderConnection(payload))
  })

  app.put("/providers/:providerID", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.UpdateGlobalProviderBody,
      "Body must be a valid provider configuration",
    )
    return ok(c, await SettingsUseCase.updateProvider(c.req.param("providerID"), payload))
  })

  app.delete("/providers/:providerID", async (c) =>
    ok(c, await SettingsUseCase.removeProvider(c.req.param("providerID"))),
  )

  app.patch("/model-selection", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.UpdateGlobalModelSelectionBody,
      "Body must contain nullable model selection fields",
    )
    return ok(c, await SettingsUseCase.updateModelSelection(payload))
  })

  app.get("/providers/anybox/auth/relay-session", async (c) =>
    ok(c, await SettingsUseCase.getAnyboxProviderRelaySession()),
  )

  app.get("/providers/:providerID/auth", async (c) =>
    ok(c, await SettingsUseCase.getProviderAuth(c.req.param("providerID"))),
  )

  app.post("/providers/:providerID/auth/flows", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.ProviderAuthFlowBody,
      "Body must contain a non-empty 'method' field.",
    )
    return ok(
      c,
      await SettingsUseCase.startProviderAuthFlow({
        providerID: c.req.param("providerID"),
        method: payload.method,
        serverBaseURL: resolveServerBaseURL(c.req.url),
        baseURL: payload.baseURL,
        prompt: payload.prompt,
      }),
    )
  })

  app.get("/providers/:providerID/auth/flows/:flowID", async (c) =>
    ok(
      c,
      await SettingsUseCase.getProviderAuthFlow(c.req.param("providerID"), c.req.param("flowID")),
    ),
  )

  app.delete("/providers/:providerID/auth/flows/:flowID", async (c) =>
    ok(
      c,
      await SettingsUseCase.cancelProviderAuthFlow(c.req.param("providerID"), c.req.param("flowID")),
    ),
  )

  app.get("/providers/:providerID/auth/callback", async (c) => {
    const result = await SettingsUseCase.completeProviderAuthCallback(c.req.param("providerID"), new URL(c.req.url))
    return c.html(result.html, result.status as 200 | 400 | 500)
  })

  app.put("/providers/:providerID/auth/api-key", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.ProviderAuthApiKeyBody,
      "Body must contain an optional nullable 'apiKey' field.",
    )
    return ok(c, await SettingsUseCase.saveProviderApiKey(c.req.param("providerID"), payload))
  })

  app.delete("/providers/:providerID/auth/session", async (c) =>
    ok(c, await SettingsUseCase.deleteProviderSession(c.req.param("providerID"))),
  )

  app.post("/providers/:providerID/auth/test", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.ProviderConnectionTestBody,
      "Body must contain optional connection test fields.",
    )
    return ok(c, await SettingsUseCase.testProviderConnection(c.req.param("providerID"), payload))
  })

  app.get("/mcp/servers", async (c) => ok(c, await SettingsUseCase.listMcpServers()))

  app.get("/mcp/servers/:serverID/diagnostic", async (c) =>
    ok(c, await SettingsUseCase.getMcpServerDiagnostic(c.req.param("serverID"))),
  )

  app.put("/mcp/servers/:serverID", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.UpdateMcpServerBody,
      "Body must be a valid MCP server configuration",
    )
    return ok(c, await SettingsUseCase.updateMcpServer(c.req.param("serverID"), payload))
  })

  app.delete("/mcp/servers/:serverID", async (c) =>
    ok(c, await SettingsUseCase.removeMcpServer(c.req.param("serverID"))),
  )

  app.get("/plugins/catalog", async (c) => {
    const payload = parseQuery(
      { freshness: c.req.query("freshness") },
      SettingsUseCase.PluginCatalogQuery,
      "INVALID_QUERY",
      "Query parameter 'freshness' must be 'cached' or 'fresh'.",
    )
    return ok(c, await SettingsUseCase.listPluginCatalog(payload))
  })

  app.get("/plugins/installed", async (c) => ok(c, SettingsUseCase.listInstalledPlugins()))

  app.post("/plugins/import-url", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.ImportPluginURLBody,
      "Body must contain a plugin manifest URL.",
    )
    return ok(c, await SettingsUseCase.importPluginFromURL(payload))
  })

  app.put("/plugins/installed/:pluginID", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.InstallPluginBody,
      "Body must contain optional plugin configuration and enabled state.",
    )
    return ok(c, await SettingsUseCase.installPlugin(c.req.param("pluginID"), payload))
  })

  app.patch("/plugins/installed/:pluginID", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.UpdateInstalledPluginBody,
      "Body must contain optional plugin configuration and enabled state.",
    )
    return ok(c, await SettingsUseCase.updateInstalledPlugin(c.req.param("pluginID"), payload))
  })

  app.delete("/plugins/installed/:pluginID", async (c) =>
    ok(c, await SettingsUseCase.removeInstalledPlugin(c.req.param("pluginID"))),
  )

  app.get("/plugins/installed/:pluginID/diagnostic", async (c) =>
    ok(c, await SettingsUseCase.getInstalledPluginDiagnostic(c.req.param("pluginID"))),
  )

  app.get("/connectors/catalog", async (c) => ok(c, SettingsUseCase.listConnectorCatalog()))

  app.get("/connectors", async (c) => ok(c, await SettingsUseCase.listConnectors()))

  app.get("/connectors/:connectorID", async (c) =>
    ok(c, await SettingsUseCase.getConnector(c.req.param("connectorID"))),
  )

  app.put("/connectors/:connectorID/api-key", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.SaveConnectorApiKeyBody,
      "Body must contain an optional nullable 'apiKey' field.",
    )
    return ok(c, await SettingsUseCase.saveConnectorApiKey(c.req.param("connectorID"), payload))
  })

  app.delete("/connectors/:connectorID/api-key", async (c) =>
    ok(c, await SettingsUseCase.deleteConnectorApiKey(c.req.param("connectorID"))),
  )

  app.put("/connectors/:connectorID/config", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.SaveConnectorConfigBody,
      "Body must contain connector configuration fields.",
    )
    return ok(c, await SettingsUseCase.saveConnectorConfig(c.req.param("connectorID"), payload))
  })

  app.delete("/connectors/:connectorID/config", async (c) =>
    ok(c, await SettingsUseCase.deleteConnectorConfig(c.req.param("connectorID"))),
  )

  app.post("/connectors/:connectorID/auth/flows", async (c) => {
    await parseJsonBody(
      c,
      SettingsUseCase.ConnectorAuthFlowBody,
      "Body must be empty or a valid connector auth flow payload.",
      {},
    )
    return ok(
      c,
      await SettingsUseCase.startConnectorAuthFlow(
        c.req.param("connectorID"),
        { serverBaseURL: resolveServerBaseURL(c.req.url) },
      ),
    )
  })

  app.get("/connectors/:connectorID/auth/flows/:flowID", async (c) =>
    ok(
      c,
      await SettingsUseCase.getConnectorAuthFlow(
        c.req.param("connectorID"),
        c.req.param("flowID"),
      ),
    ),
  )

  app.delete("/connectors/:connectorID/auth/flows/:flowID", async (c) =>
    ok(
      c,
      await SettingsUseCase.cancelConnectorAuthFlow(
        c.req.param("connectorID"),
        c.req.param("flowID"),
      ),
    ),
  )

  app.delete("/connectors/:connectorID/auth/session", async (c) =>
    ok(c, await SettingsUseCase.deleteConnectorAuthSession(c.req.param("connectorID"))),
  )

  app.get("/connectors/:connectorID/diagnostic", async (c) =>
    ok(c, await SettingsUseCase.getConnectorDiagnostic(c.req.param("connectorID"))),
  )

  app.get("/plugins/installed/:pluginID/connectors", async (c) =>
    ok(c, await SettingsUseCase.listInstalledPluginConnectors(c.req.param("pluginID"))),
  )

  app.put("/plugins/installed/:pluginID/connectors/:appID/api-key", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.SavePluginConnectorApiKeyBody,
      "Body must contain an optional nullable 'apiKey' field.",
    )
    return ok(
      c,
      await SettingsUseCase.saveInstalledPluginConnectorApiKey(
        c.req.param("pluginID"),
        c.req.param("appID"),
        payload,
      ),
    )
  })

  app.delete("/plugins/installed/:pluginID/connectors/:appID/api-key", async (c) =>
    ok(
      c,
      await SettingsUseCase.deleteInstalledPluginConnectorApiKey(
        c.req.param("pluginID"),
        c.req.param("appID"),
      ),
    ),
  )

  app.post("/plugins/installed/:pluginID/connectors/:appID/auth/flows", async (c) => {
    await parseJsonBody(
      c,
      SettingsUseCase.PluginConnectorAuthFlowBody,
      "Body must be empty or a valid connector auth flow payload.",
      {},
    )
    return ok(
      c,
      await SettingsUseCase.startInstalledPluginConnectorAuthFlow(
        c.req.param("pluginID"),
        c.req.param("appID"),
        { serverBaseURL: resolveServerBaseURL(c.req.url) },
      ),
    )
  })

  app.get("/plugins/installed/:pluginID/connectors/:appID/auth/flows/:flowID", async (c) =>
    ok(
      c,
      await SettingsUseCase.getInstalledPluginConnectorAuthFlow(
        c.req.param("pluginID"),
        c.req.param("appID"),
        c.req.param("flowID"),
      ),
    ),
  )

  app.delete("/plugins/installed/:pluginID/connectors/:appID/auth/flows/:flowID", async (c) =>
    ok(
      c,
      await SettingsUseCase.cancelInstalledPluginConnectorAuthFlow(
        c.req.param("pluginID"),
        c.req.param("appID"),
        c.req.param("flowID"),
      ),
    ),
  )

  app.delete("/plugins/installed/:pluginID/connectors/:appID/auth/session", async (c) =>
    ok(
      c,
      await SettingsUseCase.deleteInstalledPluginConnectorAuthSession(
        c.req.param("pluginID"),
        c.req.param("appID"),
      ),
    ),
  )

  app.get("/plugins/installed/:pluginID/connectors/:appID/diagnostic", async (c) =>
    ok(
      c,
      await SettingsUseCase.getInstalledPluginConnectorDiagnostic(
        c.req.param("pluginID"),
        c.req.param("appID"),
      ),
    ),
  )

  app.get("/tools/builtins", async (c) => ok(c, await SettingsUseCase.listBuiltinTools()))

  app.put("/tools/builtins/selection", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.UpdateBuiltinToolSelectionBody,
      "Body must contain a tools object keyed by built-in tool id.",
    )
    return ok(c, await SettingsUseCase.updateBuiltinToolSelection(payload))
  })

  app.get("/tools/permission-mode", async (c) => ok(c, await SettingsUseCase.getToolPermissionMode()))

  app.put("/tools/permission-mode", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.UpdateToolPermissionModeBody,
      "Body must contain mode 'default' or 'full_access'.",
    )
    return ok(c, await SettingsUseCase.updateToolPermissionMode(payload))
  })

  app.get("/prompts", async (c) => ok(c, await SettingsUseCase.listPromptPresets()))

  app.get("/prompts/selection", async (c) => ok(c, await SettingsUseCase.getPromptPresetSelection()))

  app.put("/prompts/selection", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.PromptPresetSelectionBody,
      "Body must contain non-empty 'systemPromptPresetID', 'planModePromptPresetID', 'sideChatPromptPresetID', and 'gitCommitPromptPresetID' fields.",
    )
    return ok(c, await SettingsUseCase.updatePromptPresetSelection(payload))
  })

  app.post("/prompts", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.PromptPresetCreateBody,
      "Body must be a valid prompt preset input.",
    )
    return ok(c, await SettingsUseCase.createPromptPreset(payload))
  })

  app.post("/prompts/translate", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.PromptPresetTranslationBody,
      "Body must contain a valid prompt translation request.",
    )
    return ok(c, await SettingsUseCase.translatePromptPreset(payload))
  })

  app.post("/prompts/url/preview", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.PreviewPromptUrlInstallBody,
      "Body must contain a non-empty 'source'.",
    )
    return ok(c, await SettingsUseCase.previewPromptUrlInstall(payload))
  })

  app.post("/prompts/url/install", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.InstallPromptUrlPreviewBody,
      "Body must contain a non-empty 'previewID' and a 'promptIDs' string array.",
    )
    return ok(c, await SettingsUseCase.installPromptUrlPreview(payload))
  })

  app.get("/prompts/:presetID", async (c) =>
    ok(c, await SettingsUseCase.readPromptPreset(c.req.param("presetID"))),
  )

  app.put("/prompts/:presetID", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.PromptPresetBody,
      "Body must contain a string 'content' field.",
    )
    return ok(c, await SettingsUseCase.updatePromptPreset(c.req.param("presetID"), payload))
  })

  app.delete("/prompts/:presetID", async (c) =>
    ok(c, await SettingsUseCase.resetPromptPreset(c.req.param("presetID"))),
  )

  app.delete("/prompts/:presetID/custom", async (c) =>
    ok(c, await SettingsUseCase.deletePromptPreset(c.req.param("presetID"))),
  )

  app.get("/skills", async (c) => ok(c, await SettingsUseCase.listSkills()))

  app.get("/skills/tree", async (c) => ok(c, await SettingsUseCase.getSkillTree()))

  app.post("/skills/git/preview", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.PreviewSkillGitInstallBody,
      "Body must contain a non-empty 'source'.",
    )
    return ok(c, await SettingsUseCase.previewSkillGitInstall(payload))
  })

  app.post("/skills/git/install", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.InstallSkillGitPreviewBody,
      "Body must contain a non-empty 'previewID' and a 'skillIDs' string array.",
    )
    return ok(c, await SettingsUseCase.installSkillGitPreview(payload))
  })

  app.post("/skills/local/install", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.InstallSkillLocalFileBody,
      "Body must contain a non-empty 'sourcePath'.",
    )
    return ok(c, await SettingsUseCase.installSkillLocalFile(payload))
  })

  app.post("/skills/folders", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.CreateSkillFolderBody,
      "Body must contain a non-empty 'name'.",
    )
    return ok(c, await SettingsUseCase.createSkillFolder(payload), 201)
  })

  app.patch("/skills/folders", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.RenameSkillFolderBody,
      "Body must contain non-empty 'directory' and 'name' fields.",
    )
    return ok(c, await SettingsUseCase.renameSkillFolder(payload))
  })

  app.delete("/skills/folders", async (c) => {
    const payload = parseQuery(
      { directory: c.req.query("directory") },
      SettingsUseCase.DeleteSkillFolderQuery,
      "INVALID_QUERY",
      "Query parameter 'directory' must be a non-empty string.",
    )
    return ok(c, await SettingsUseCase.deleteSkillFolder(payload))
  })

  app.patch("/skills/move", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.MoveSkillDirectoryBody,
      "Body must contain a non-empty 'directory' field.",
    )
    return ok(c, await SettingsUseCase.moveSkillDirectory(payload))
  })

  app.get("/skills/file", async (c) => {
    const payload = parseQuery(
      { path: c.req.query("path") },
      SettingsUseCase.SkillFileQuery,
      "INVALID_QUERY",
      "Query parameter 'path' must be a non-empty string.",
    )
    return ok(c, await SettingsUseCase.readSkillFile(payload))
  })

  app.put("/skills/file", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.SkillFileBody,
      "Body must contain a non-empty 'path' and string 'content'.",
    )
    return ok(c, await SettingsUseCase.writeSkillFile(payload))
  })

  app.post("/skills", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.CreateSkillBody,
      "Body must contain a non-empty 'name'.",
    )
    return ok(c, await SettingsUseCase.createSkill(payload), 201)
  })

  app.patch("/skills", async (c) => {
    const payload = await parseJsonBody(
      c,
      SettingsUseCase.RenameSkillBody,
      "Body must contain non-empty 'directory' and 'name' fields.",
    )
    return ok(c, await SettingsUseCase.renameSkill(payload))
  })

  app.delete("/skills", async (c) => {
    const payload = parseQuery(
      { directory: c.req.query("directory") },
      SettingsUseCase.DeleteSkillQuery,
      "INVALID_QUERY",
      "Query parameter 'directory' must be a non-empty string.",
    )
    return ok(c, await SettingsUseCase.deleteSkill(payload))
  })

  return app
}
