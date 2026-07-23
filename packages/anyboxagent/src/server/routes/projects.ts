import { Hono } from "hono"
import { ok, parseJsonBody, parseQuery } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"
import type { PtyRegistry } from "#pty/registry.ts"
import * as ProjectUseCase from "#server/usecases/projects.ts"

export function ProjectRoutes(options: { ptyRegistry: PtyRegistry }) {
  const app = new Hono<AppEnv>()

  app.get("/", async (c) => ok(c, await ProjectUseCase.listProjects()))

  app.post("/", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.CreateProjectBody,
      "Body must include a non-empty 'directory'",
    )
    return ok(c, await ProjectUseCase.createProject(payload), 201)
  })

  app.get("/:id/sessions", (c) => ok(c, ProjectUseCase.listProjectSessions(c.req.param("id"))))

  app.get("/:id/worktrees", async (c) => ok(c, await ProjectUseCase.listProjectWorktrees(c.req.param("id"))))

  app.post("/:id/worktrees", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.CreateProjectWorktreeBody,
      "Body must include optional non-empty 'baseRef', 'branchName', owner fields, and cleanupPolicy",
      {},
    )
    return ok(c, await ProjectUseCase.createProjectWorktree(c.req.param("id"), payload), 201)
  })

  app.post("/:id/worktrees/:worktreeID/refresh", async (c) =>
    ok(c, await ProjectUseCase.refreshProjectWorktree(c.req.param("id"), c.req.param("worktreeID"))),
  )

  app.delete("/:id/worktrees/:worktreeID", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.DeleteProjectWorktreeBody,
      "Body must include optional boolean 'force' and owner fields",
      {},
    )
    return ok(c, await ProjectUseCase.deleteProjectWorktree(
      c.req.param("id"),
      c.req.param("worktreeID"),
      payload,
      options,
    ))
  })

  app.post("/:id/sessions", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.CreateProjectSessionBody,
      "Body must include optional non-empty 'title' or 'directory'",
      {},
    )
    return ok(c, await ProjectUseCase.createProjectSession(c.req.param("id"), payload), 201)
  })

  app.get("/:id/providers/catalog", async (c) =>
    ok(c, await ProjectUseCase.listProjectProviderCatalog(c.req.param("id"))),
  )

  app.get("/:id/providers", async (c) =>
    ok(c, await ProjectUseCase.listProjectProviders(c.req.param("id"))),
  )

  app.get("/:id/models", async (c) =>
    ok(c, await ProjectUseCase.listProjectModels(c.req.param("id"))),
  )

  app.get("/:id/model-catalog", async (c) =>
    ok(c, await ProjectUseCase.listProjectModelCatalog(c.req.param("id"))),
  )

  app.put("/:id/providers/:providerID", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.UpdateProjectProviderBody,
      "Body must be a valid provider configuration",
    )
    return ok(
      c,
      await ProjectUseCase.updateProjectProvider(c.req.param("id"), c.req.param("providerID"), payload),
    )
  })

  app.delete("/:id/providers/:providerID", async (c) =>
    ok(c, await ProjectUseCase.removeProjectProvider(c.req.param("id"), c.req.param("providerID"))),
  )

  app.patch("/:id/model-selection", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.UpdateProjectModelSelectionBody,
      "Body must contain nullable 'model' and 'small_model' fields",
    )
    return ok(c, await ProjectUseCase.updateProjectModelSelection(c.req.param("id"), payload))
  })

  app.get("/:id/git/capabilities", async (c) => {
    const payload = parseQuery(
      c.req.query(),
      ProjectUseCase.GitDirectoryQuery,
      "INVALID_QUERY",
      "Query parameter 'directory' must be a non-empty string",
    )
    return ok(c, await ProjectUseCase.getProjectGitCapabilities(c.req.param("id"), payload))
  })

  app.post("/:id/git/commit", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.GitCommitBody,
      "Body must include non-empty 'directory' and 'message' fields",
    )
    return ok(c, await ProjectUseCase.commitProjectGitChanges(c.req.param("id"), payload))
  })

  app.post("/:id/git/commit-message", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.GitCommitMessageBody,
      "Body must include a non-empty 'directory'",
    )
    return ok(c, await ProjectUseCase.generateProjectGitCommitMessage(c.req.param("id"), payload))
  })

  app.post("/:id/providers/catalog/refresh", async (c) =>
    ok(c, await ProjectUseCase.refreshProjectProviderCatalog(c.req.param("id"))),
  )

  app.post("/:id/git/push", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.GitDirectoryBody,
      "Body must include a non-empty 'directory'",
    )
    return ok(c, await ProjectUseCase.pushProjectGitChanges(c.req.param("id"), payload))
  })

  app.post("/:id/git/branches", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.GitCreateBranchBody,
      "Body must include non-empty 'directory' and 'name' fields",
    )
    return ok(c, await ProjectUseCase.createProjectGitBranch(c.req.param("id"), payload))
  })

  app.get("/:id/git/branches", async (c) => {
    const payload = parseQuery(
      c.req.query(),
      ProjectUseCase.GitDirectoryQuery,
      "INVALID_QUERY",
      "Query parameter 'directory' must be a non-empty string",
    )
    return ok(c, await ProjectUseCase.listProjectGitBranches(c.req.param("id"), payload))
  })

  app.post("/:id/git/checkout", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.GitCheckoutBranchBody,
      "Body must include non-empty 'directory' and 'name' fields",
    )
    return ok(c, await ProjectUseCase.checkoutProjectGitBranch(c.req.param("id"), payload))
  })

  app.post("/:id/git/pull-requests", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.GitDirectoryBody,
      "Body must include a non-empty 'directory'",
    )
    return ok(c, await ProjectUseCase.createProjectGitPullRequest(c.req.param("id"), payload))
  })

  app.get("/:id/skills", async (c) => ok(c, await ProjectUseCase.listProjectSkills(c.req.param("id"))))

  app.get("/:id/skills/selection", async (c) =>
    ok(c, await ProjectUseCase.getProjectSkillSelection(c.req.param("id"))),
  )

  app.put("/:id/skills/selection", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.UpdateProjectSkillSelectionBody,
      "Body must contain a 'skillIDs' string array",
    )
    return ok(c, await ProjectUseCase.updateProjectSkillSelection(c.req.param("id"), payload))
  })

  app.get("/:id/plugins", async (c) => ok(c, await ProjectUseCase.listProjectPlugins(c.req.param("id"))))

  app.get("/:id/plugins/selection", async (c) =>
    ok(c, await ProjectUseCase.getProjectPluginSelection(c.req.param("id"))),
  )

  app.put("/:id/plugins/selection", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.UpdateProjectPluginSelectionBody,
      "Body must contain a 'pluginIDs' string array",
    )
    return ok(c, await ProjectUseCase.updateProjectPluginSelection(c.req.param("id"), payload))
  })

  app.get("/:id/mcp/selection", async (c) =>
    ok(c, await ProjectUseCase.getProjectMcpSelection(c.req.param("id"))),
  )

  app.put("/:id/mcp/selection", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.UpdateProjectMcpSelectionBody,
      "Body must contain a 'serverIDs' string array",
    )
    return ok(c, await ProjectUseCase.updateProjectMcpSelection(c.req.param("id"), payload))
  })

  app.get("/:id/mcp/servers", async (c) =>
    ok(c, await ProjectUseCase.listProjectMcpServers(c.req.param("id"))),
  )

  app.get("/:id/mcp/servers/:serverID/diagnostic", async (c) =>
    ok(
      c,
      await ProjectUseCase.getProjectMcpServerDiagnostic(c.req.param("id"), c.req.param("serverID")),
    ),
  )

  app.put("/:id/mcp/servers/:serverID", async (c) => {
    const payload = await parseJsonBody(
      c,
      ProjectUseCase.UpdateMcpServerBody,
      "Body must be a valid MCP server configuration",
    )
    return ok(
      c,
      await ProjectUseCase.updateProjectMcpServer(c.req.param("id"), c.req.param("serverID"), payload),
    )
  })

  app.delete("/:id/mcp/servers/:serverID", async (c) =>
    ok(c, await ProjectUseCase.removeProjectMcpServer(c.req.param("id"), c.req.param("serverID"))),
  )

  app.delete("/:id", async (c) => ok(c, await ProjectUseCase.deleteProject(c.req.param("id"), options)))

  app.get("/:id", (c) => ok(c, ProjectUseCase.getProject(c.req.param("id"))))

  return app
}
