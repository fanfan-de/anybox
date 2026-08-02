 import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { $ } from "bun"
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { createServerApp } from "#server/server.ts"
import { createSessionExecutionStream } from "#server/routes/session.ts"
import * as Identifier from "#id/id.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as Message from "#session/core/message.ts"
import * as Orchestrator from "#session/runtime/orchestrator.ts"
import * as RunningState from "#session/runtime/running-state.ts"
import * as SessionRunner from "#session/runtime/session-runner.ts"
import * as Session from "#session/core/session.ts"
import * as Subtask from "#session/tasks/subtask.ts"
import * as LiveStreamHub from "#session/runtime/live-stream-hub.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import * as Env from "#env/env.ts"
import * as Config from "#config/config.ts"
import * as GitCommitMessage from "#git/commit-message.ts"
import { Instance } from "#project/instance.ts"
import * as Provider from "#provider/provider.ts"
import * as PromptPresets from "#session/support/prompt-presets.ts"
import * as SystemPrompt from "#session/core/system.ts"
import * as SettingsUseCase from "#server/usecases/settings.ts"
import * as Skill from "#skill/skill.ts"
import * as Log from "#util/log.ts"
import * as db from "#database/Sqlite.ts"
import {
  createShellTaskRegistry,
  type ShellTaskOutputEvent,
  type ShellTaskRuntimeHandle,
} from "#shell/task-registry.ts"

interface JsonEnvelope<T = Record<string, unknown>> {
  success: boolean
  requestId?: string
  data?: T
  error?: {
    code: string
    message: string
  }
}

class ApiShellTaskHandle implements ShellTaskRuntimeHandle {
  readonly pid = 42
  killed = 0
  private readonly outputListeners = new Set<(event: ShellTaskOutputEvent) => void>()
  private readonly exitListeners = new Set<(
    event: { exitCode: number | null; signal: NodeJS.Signals | null },
  ) => void>()
  private finished = false

  write() {}

  interrupt() {}

  kill() {
    this.killed += 1
    queueMicrotask(() => this.exit(null, "SIGTERM"))
  }

  onOutput(listener: (event: ShellTaskOutputEvent) => void) {
    this.outputListeners.add(listener)
    return () => this.outputListeners.delete(listener)
  }

  onExit(listener: (event: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  exit(exitCode: number | null, signal: NodeJS.Signals | null = null) {
    if (this.finished) return
    this.finished = true
    for (const listener of this.exitListeners) listener({ exitCode, signal })
  }
}

type SessionResponseEnvelope = JsonEnvelope<{
  id: string
  projectID: string
  worktreeID?: string
  directory: string
  title: string
}>

interface ProjectRecord {
  id: string
  repositoryRoot: string
  workspaceRoots: string[]
  worktree: string
  name?: string
  created: number
  updated: number
  sandboxes: string[]
}

interface WorktreeRecord {
  id: string
  projectID: string
  path: string
  branch?: string | null
  baseRef?: string | null
  baseSha?: string | null
  kind: "primary" | "external" | "managed"
  managed: boolean
  status: "active" | "missing" | "dirty" | "archived" | "removing" | "removed" | "failed"
  cleanupPolicy: "never" | "on-session-archive" | "on-success-if-clean" | "manual"
  createdAt: number
  updatedAt: number
  lastSeenAt?: number
}

type ProjectsResponseEnvelope = JsonEnvelope<ProjectRecord[]>
type WorktreesResponseEnvelope = JsonEnvelope<WorktreeRecord[]>
type WorktreeResponseEnvelope = JsonEnvelope<WorktreeRecord>
type PreparedWorktreeResponseEnvelope = JsonEnvelope<{
  worktree: WorktreeRecord
}>

type ProjectSessionsResponseEnvelope = JsonEnvelope<
  Array<{
    id: string
    projectID: string
    worktreeID?: string
    directory: string
    title: string
    modelSelection?: {
      model?: string
      small_model?: string
    }
    time: {
      created: number
      updated: number
    }
  }>
>

type ProjectResponseEnvelope = JsonEnvelope<ProjectRecord>

type DeleteSessionResponseEnvelope = JsonEnvelope<{
  sessionID: string
  projectID: string
}>

type CancelSessionResponseEnvelope = JsonEnvelope<{
  sessionID: string
  cancelled: boolean
  activeCancelled: boolean
  queuedCancelled: number
}>

type DeleteProjectResponseEnvelope = JsonEnvelope<{
  projectID: string
  deletedSessionIDs: string[]
}>

type GitCapabilitiesEnvelope = JsonEnvelope<{
  directory: string
  root: string | null
  branch: string | null
  defaultBranch: string | null
  isGitRepo: boolean
  canCommit: {
    enabled: boolean
    reason?: string
  }
  canStageAllCommit: {
    enabled: boolean
    reason?: string
  }
  canPush: {
    enabled: boolean
    reason?: string
  }
  canCreatePullRequest: {
    enabled: boolean
    reason?: string
  }
  canCreateBranch: {
    enabled: boolean
    reason?: string
  }
}>

type GitActionEnvelope = JsonEnvelope<{
  directory: string
  root: string
  branch: string | null
  stdout: string
  stderr: string
  summary: string
  url?: string
}>

type GitCommitMessageEnvelope = JsonEnvelope<{
  message: string
}>

async function createTempDirectory(prefix: string) {
  return realpath(await mkdtemp(join(tmpdir(), prefix)))
}

async function createTempPath(prefix: string) {
  const root = await realpath(tmpdir()).catch(() => tmpdir())
  return join(root, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
}

type GitBranchesEnvelope = JsonEnvelope<
  Array<{
    name: string
    kind: "local" | "remote"
    current: boolean
  }>
>

type SessionMessagesResponseEnvelope = JsonEnvelope<
  Array<{
    info: {
      id: string
      sessionID: string
      role: "user" | "assistant"
    }
    parts: Array<{
      id: string
      type: string
      text?: string
    }>
  }>
>

type ProviderCatalogEnvelope = JsonEnvelope<
  Array<{
    id: string
    name: string
    configured: boolean
    available: boolean
    apiKeyConfigured: boolean
    modelCount: number
    authScope?: "global"
    activeAuthMethod?: string
    authState?: {
      activeMethod?: string
      status: string
      connectionLabel?: string
    }
  }>
>

type ProviderAuthStateEnvelope = JsonEnvelope<{
  providerID: string
  scope: "global"
  activeMethod?: string
  status: string
  connectionLabel?: string
  account?: {
    email?: string
    planType?: string
    workspaceName?: string
  }
  credentials: Array<{
    method: string
    kind: "api_key" | "oauth_session"
    source: "credential_store" | "legacy_config" | "environment" | "external_cache"
    configured: boolean
  }>
}>

type ProviderAuthFlowEnvelope = JsonEnvelope<{
  id: string
  providerID: string
  method: string
  kind: "browser_oauth" | "device_code" | "api_key"
  status: string
  authorizationURL?: string
  verificationURI?: string
  userCode?: string
  errorMessage?: string
  account?: {
    email?: string
    planType?: string
    workspaceName?: string
  }
}>

type ProviderConnectionTestEnvelope = JsonEnvelope<{
  providerID: string
  ok: boolean
  status: "working" | "not_connected" | "unsupported" | "auth_error" | "network_error" | "config_error"
  checkedAt: number
  message: string
}>

type ProviderListEnvelope = JsonEnvelope<{
  items: Array<{
    id: string
    name: string
    configured: boolean
    available: boolean
    apiKeyConfigured: boolean
    modelCount: number
    models: Array<{
      id: string
      providerID: string
      available: boolean
    }>
  }>
  selection: {
    model?: string
    small_model?: string
  }
}>

type ProviderUpdateEnvelope = JsonEnvelope<{
  provider: {
    id: string
    name: string
    available: boolean
    apiKeyConfigured: boolean
    models: Array<{
      id: string
      providerID: string
    }>
  }
  selection: {
    model?: string
    small_model?: string
  }
}>

type ProjectModelsEnvelope = JsonEnvelope<{
  effectiveModel?: {
    id: string
    providerID: string
    available: boolean
  } | null
  items: Array<{
    id: string
    providerID: string
    available: boolean
  }>
  selection: {
    model?: string
    small_model?: string
  }
}>

type SkillListEnvelope = JsonEnvelope<
  Array<{
    id: string
    name: string
    description: string
    path: string
    scope: "project" | "user" | "plugin"
  }>
>

type ProjectSkillSelectionEnvelope = JsonEnvelope<{
  skillIDs: string[]
}>

type ProjectPluginSelectionEnvelope = JsonEnvelope<{
  pluginIDs: string[]
}>

type ProjectPluginListEnvelope = JsonEnvelope<
  Array<{
    pluginID: string
    enabled: boolean
    skillIDs: string[]
    mcpServerIDs: string[]
  }>
>

type McpAllowedTools =
  | string[]
  | {
      readOnly?: boolean
      toolNames?: string[]
    }

type McpRequireApproval =
  | "always"
  | "never"
  | {
      never?: {
        toolNames?: string[]
      }
    }

type StdioMcpServerSummary = {
  id: string
  name?: string
  transport: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  enabled: boolean
  timeoutMs?: number
}

type RemoteMcpServerSummary = {
  id: string
  name?: string
  transport: "remote"
  provider?: "openai"
  serverUrl: string
  connectorId?: string
  authorization?: string
  headers?: Record<string, string>
  serverDescription?: string
  allowedTools?: McpAllowedTools
  requireApproval?: McpRequireApproval
  enabled: boolean
  timeoutMs?: number
}

type McpServerListEnvelope = JsonEnvelope<
  Array<StdioMcpServerSummary | RemoteMcpServerSummary>
>

type McpServerEnvelope = JsonEnvelope<StdioMcpServerSummary | RemoteMcpServerSummary>

type McpDeleteEnvelope = JsonEnvelope<{
  serverID: string
  removed: boolean
}>

type BuiltinToolListEnvelope = JsonEnvelope<{
  modules: Array<{
    id: string
    title: string
    description: string
    provider: {
      kind: "builtin"
      id: string
      name?: string
    }
    activation: {
      mode: "always"
      scope: "global"
      discovery: "none"
    }
    toolIDs: string[]
  }>
  items: Array<{
    id: string
    title: string
    description: string
    inputSchema?: unknown
    aliases: string[]
    capabilities: {
      kind?: "read" | "write" | "search" | "exec" | "workflow" | "interaction" | "delegation" | "other"
      readOnly?: boolean
      destructive?: boolean
      concurrency?: "safe" | "exclusive"
      needsShell?: boolean
    }
    moduleID: string
    enabled: boolean
  }>
  selection: {
    tools: Record<string, boolean>
  }
}>

type BuiltinToolSelectionEnvelope = JsonEnvelope<{
  tools: Record<string, boolean>
}>

type PromptPresetSummaryEnvelope = JsonEnvelope<
  Array<{
    id: string
    label: string
    description: string
    source: "bundled" | "custom"
    hasOverride: boolean
    editable: boolean
    sourcePath?: string
    filePath?: string
    root?: string
  }>
>

type PromptPresetDocumentEnvelope = JsonEnvelope<{
  id: string
  label: string
  description: string
  source: "bundled" | "custom"
  hasOverride: boolean
  editable: boolean
  sourcePath?: string
  filePath?: string
  root?: string
  content: string
}>

type PromptPresetSelectionEnvelope = JsonEnvelope<{
  systemPromptPresetID: string
  planModePromptPresetID: string
  gitCommitPromptPresetID: string
  cinemaTextGenerationPromptPresetID: string
}>

function createPromptTranslationTestModel(input?: {
  inputText?: boolean
  outputText?: boolean
}): Provider.Model {
  return {
    ...Provider.testDeepSeekModel,
    id: "prompt-translator",
    providerID: "test-provider",
    api: {
      ...Provider.testDeepSeekModel.api,
      id: "prompt-translator",
      url: "https://example.test/v1",
    },
    name: "Prompt Translator",
    capabilities: {
      ...Provider.testDeepSeekModel.capabilities,
      input: {
        ...Provider.testDeepSeekModel.capabilities.input,
        text: input?.inputText ?? true,
      },
      output: {
        ...Provider.testDeepSeekModel.capabilities.output,
        text: input?.outputText ?? true,
      },
    },
  }
}

function toPromptTranslationPublicModel(model: Provider.Model, available = true): Provider.PublicModel {
  const { headers: _headers, ...publicModel } = model
  return {
    ...publicModel,
    available,
    providerName: "Test Provider",
  }
}

async function withTempPromptRoot<T>(fn: (root: string) => Promise<T>) {
  const previousPromptRoot = process.env.ANYBOX_PROMPTS_ROOT
  const root = await createTempDirectory("anybox-prompts-")
  process.env.ANYBOX_PROMPTS_ROOT = root

  try {
    return await fn(root)
  } finally {
    if (previousPromptRoot === undefined) {
      delete process.env.ANYBOX_PROMPTS_ROOT
    } else {
      process.env.ANYBOX_PROMPTS_ROOT = previousPromptRoot
    }
    await rm(root, { recursive: true, force: true })
  }
}

const modelsDevFixture = {
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    env: ["DEEPSEEK_API_KEY"],
    api: "https://api.deepseek.com",
    npm: "@ai-sdk/deepseek",
    models: {
      "deepseek-reasoner": {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        family: "deepseek",
        release_date: "2024-01-01",
        attachment: false,
        reasoning: true,
        temperature: true,
        tool_call: true,
        limit: {
          context: 128000,
          output: 8192,
        },
        modalities: {
          input: ["text"],
          output: ["text"],
        },
        options: {},
        headers: {},
      },
    },
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    env: ["OPENAI_API_KEY"],
    api: "https://api.openai.com/v1",
    npm: "@ai-sdk/openai",
    models: {
      "gpt-4o-mini": {
        id: "gpt-4o-mini",
        name: "GPT-4o mini",
        family: "gpt-4o",
        release_date: "2024-07-18",
        attachment: true,
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: {
          context: 128000,
          output: 8192,
        },
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
        options: {},
        headers: {},
      },
    },
  },
}

async function createGitRepo(root: string, seed: string) {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, "README.md"), `# ${seed}\n`)
  await $`git init`.cwd(root).quiet()
  await $`git config user.email test@example.com`.cwd(root).quiet()
  await $`git config user.name anybox-test`.cwd(root).quiet()
  await $`git add README.md`.cwd(root).quiet()
  await $`git commit -m init`.cwd(root).quiet()
}

async function writeProjectSelectionPluginPackage(installRoot: string) {
  const packageRoot = join(installRoot, "project-lab", "0.1.0")
  const manifestRoot = join(packageRoot, ".anybox-plugin")
  const skillRoot = join(packageRoot, "skills", "project-helper")
  await mkdir(manifestRoot, { recursive: true })
  await mkdir(skillRoot, { recursive: true })

  await writeFile(join(skillRoot, "SKILL.md"), [
    "---",
    "name: Project Helper",
    "description: Fixture plugin skill for project selection tests.",
    "---",
    "",
    "# Project Helper",
    "",
    "Use this skill in project selection route tests.",
    "",
  ].join("\n"))

  await writeFile(join(manifestRoot, "plugin.json"), JSON.stringify({
    name: "project-lab",
    version: "0.1.0",
    description: "Fixture plugin package for project selection tests.",
    author: "Anybox Tests",
    interface: {
      displayName: "Project Lab",
      shortDescription: "Project selection fixture package.",
      developerName: "Anybox Tests",
      category: "Docs",
    },
    mcpServers: [
      {
        id: "notes",
        name: "Project Notes",
        risk: "low",
        tools: [
          {
            name: "list_notes",
            description: "List project notes.",
            readOnly: true,
          },
        ],
        runtime: {
          transport: "stdio",
          command: "node",
          args: ["server.js"],
        },
      },
    ],
    skills: "skills",
  }, null, 2))
}

async function createBareGitRemote(root: string) {
  await mkdir(root, { recursive: true })
  await $`git init --bare`.cwd(root).quiet()
}

async function attachTrackedRemote(root: string, branch: string, remoteRoot: string) {
  await $`git branch -M ${branch}`.cwd(root).quiet()
  await $`git remote add origin ${remoteRoot}`.cwd(root).quiet()
  await $`git push -u origin ${branch}`.cwd(root).quiet()
}

async function createDirectoryLink(linkPath: string, target: string) {
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir")
}

async function removeDirectoryLink(linkPath: string) {
  try {
    await rm(linkPath, { force: true })
  } catch (error) {
    if (process.platform !== "win32") {
      throw error
    }

    await $`cmd /c rmdir ${linkPath}`.quiet()
  }
}

function mockModelsDevFetch(
  validationHandler?: (input: {
    url: string
    headers: Headers
    method?: string
    body?: unknown
  }) => Response | Promise<Response> | undefined,
) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = new Proxy(originalFetch, {
    apply(target, thisArg, args: Parameters<typeof fetch>) {
      const [input, init] = args
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      if (url === "https://models.dev/api.json") {
        return Promise.resolve(Response.json(modelsDevFixture))
      }

      const customResponse = validationHandler?.({ url, headers, method: init?.method, body: init?.body })
      if (customResponse) {
        return Promise.resolve(customResponse)
      }

      if (url === "https://api.deepseek.com/models" || url === "https://proxy.deepseek.test/v1/models") {
        return Promise.resolve(
          Response.json({
            object: "list",
            data: [{ id: "deepseek-reasoner" }],
          }),
        )
      }

      if (url === "https://api.openai.com/v1/models") {
        return Promise.resolve(
          Response.json({
            object: "list",
            data: [{ id: "gpt-4o-mini" }],
          }),
        )
      }

      return Reflect.apply(target, thisArg, [input, init])
    },
  }) as typeof fetch

  return () => {
    globalThis.fetch = originalFetch
  }
}

async function resetGlobalProviderState(app: ReturnType<typeof createServerApp>) {
  await app.request("http://localhost/api/providers/deepseek", {
    method: "DELETE",
  })
  await app.request("http://localhost/api/providers/openai", {
    method: "DELETE",
  })
  await app.request("http://localhost/api/model-selection", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: null,
      small_model: null,
    }),
  })
  await app.request("http://localhost/api/providers/deepseek/auth/api-key", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apiKey: null,
    }),
  })
  await app.request("http://localhost/api/providers/openai/auth/api-key", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apiKey: null,
    }),
  })
  await app.request("http://localhost/api/providers/deepseek/auth/session", {
    method: "DELETE",
  })
  await app.request("http://localhost/api/providers/openai/auth/session", {
    method: "DELETE",
  })
}

async function withTemporaryEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const backup = new Map<string, string | undefined>()

  for (const [key, value] of Object.entries(overrides)) {
    backup.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
      Env.remove(key)
    } else {
      process.env[key] = value
      Env.set(key, value)
    }
  }

  try {
    return await fn()
  } finally {
    for (const [key, value] of backup.entries()) {
      if (value === undefined) {
        delete process.env[key]
        Env.remove(key)
      } else {
        process.env[key] = value
        Env.set(key, value)
      }
    }
  }
}

function encodeJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.signature`
}

async function readStreamUntil(
  response: Response,
  contains: string[],
  maxReads = 12,
) {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error("Expected streaming response body")
  }

  const decoder = new TextDecoder()
  let raw = ""

  try {
    for (let index = 0; index < maxReads; index += 1) {
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Timed out while reading stream")), 2000)
        }),
      ])

      if (next.done) {
        break
      }

      raw += decoder.decode(next.value, { stream: true })
      if (contains.every((pattern) => raw.includes(pattern))) {
        break
      }
    }

    raw += decoder.decode()
    return raw
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

async function readStreamUntilOccurrences(
  response: Response,
  pattern: string,
  count: number,
  maxReads = 12,
) {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error("Expected streaming response body")
  }

  const decoder = new TextDecoder()
  let raw = ""

  try {
    for (let index = 0; index < maxReads; index += 1) {
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Timed out while reading stream")), 2000)
        }),
      ])

      if (next.done) {
        break
      }

      raw += decoder.decode(next.value, { stream: true })
      if (raw.split(pattern).length - 1 >= count) {
        break
      }
    }

    raw += decoder.decode()
    return raw
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

describe("server api", () => {
  test("GET /healthz should return request id header", async () => {
    const app = createServerApp()
    const response = await app.request("http://localhost/healthz")
    const body = (await response.json()) as JsonEnvelope

    expect(response.status).toBe(200)
    expect(response.headers.get("x-request-id")).toBeString()
    expect(body.success).toBe(true)
    expect(body.data?.ok).toBe(true)
    expect(body.requestId).toBeString()
  })

  test("session background process routes list and terminate only owned running tasks", async () => {
    const handles: ApiShellTaskHandle[] = []
    let now = 1_000
    const registry = createShellTaskRegistry({
      now: () => now++,
      runtime: {
        spawn() {
          const handle = new ApiShellTaskHandle()
          handles.push(handle)
          return handle
        },
      },
    })
    const app = createServerApp({ shellTaskRegistry: registry })
    const session = await Session.createSession({
      directory: process.cwd(),
      projectID: "project_background_processes",
      title: "Background process owner",
    })
    const otherSession = await Session.createSession({
      directory: process.cwd(),
      projectID: "project_background_processes",
      title: "Other background process owner",
    })
    const start = (ownerSessionID: string, command: string) => registry.start({
      ownerSessionID,
      command,
      cwd: process.cwd(),
      shell: "PowerShell",
      executable: "powershell.exe",
      args: ["-Command", command],
      maxOutputChars: 100,
    })

    try {
      const first = await start(session.id, "first")
      const exited = await start(session.id, "already-finished")
      const other = await start(otherSession.id, "other-session")
      handles[1]!.exit(0)
      const newest = await start(session.id, "newest")

      const listResponse = await app.request(
        `http://localhost/api/sessions/${session.id}/background-processes`,
      )
      const listBody = (await listResponse.json()) as JsonEnvelope<{
        sessionID: string
        generatedAt: number
        items: Array<{ id: string; command: string; status: string; cursor?: number }>
      }>
      expect(listResponse.status).toBe(200)
      expect(listBody.data?.sessionID).toBe(session.id)
      expect(listBody.data?.items.map((item) => item.id)).toEqual([newest.id, first.id])
      expect(listBody.data?.items.every((item) => item.status === "running")).toBe(true)
      expect(listBody.data?.items.some((item) => "cursor" in item)).toBe(false)
      expect(listBody.data?.items[0]).toMatchObject({
        id: newest.id,
        title: "newest",
        command: "newest",
        cwd: process.cwd(),
        shell: "PowerShell",
        tty: false,
        status: "running",
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      })
      expect(Object.keys(listBody.data?.items[0] ?? {}).sort()).toEqual([
        "command",
        "createdAt",
        "cwd",
        "id",
        "shell",
        "status",
        "title",
        "tty",
        "updatedAt",
      ])

      const exitedResponse = await app.request(
        `http://localhost/api/sessions/${session.id}/background-processes/${exited.id}/terminate`,
        { method: "POST" },
      )
      expect(exitedResponse.status).toBe(200)
      expect((await exitedResponse.json() as JsonEnvelope<{ terminated: boolean }>).data?.terminated).toBe(false)

      const crossSessionResponse = await app.request(
        `http://localhost/api/sessions/${session.id}/background-processes/${other.id}/terminate`,
        { method: "POST" },
      )
      const crossSessionBody = await crossSessionResponse.json() as JsonEnvelope
      expect(crossSessionResponse.status).toBe(404)
      expect(crossSessionBody.error?.code).toBe("BACKGROUND_PROCESS_NOT_FOUND")

      const terminateResponse = await app.request(
        `http://localhost/api/sessions/${session.id}/background-processes/${first.id}/terminate`,
        { method: "POST" },
      )
      expect(terminateResponse.status).toBe(200)
      expect((await terminateResponse.json() as JsonEnvelope<{ terminated: boolean }>).data?.terminated).toBe(true)
      expect(handles[0]!.killed).toBe(1)

      const terminateAllResponse = await app.request(
        `http://localhost/api/sessions/${session.id}/background-processes/terminate-all`,
        { method: "POST" },
      )
      const terminateAllBody = await terminateAllResponse.json() as JsonEnvelope<{
        terminatedProcessIDs: string[]
      }>
      expect(terminateAllResponse.status).toBe(200)
      expect(terminateAllBody.data?.terminatedProcessIDs).toEqual([newest.id])
      expect(handles[3]!.killed).toBe(1)
      expect(handles[2]!.killed).toBe(0)
    } finally {
      await registry.disposeAll()
    }
  })

  test("built-in tool settings routes list, persist, reset, and validate selections", async () => {
    const app = createServerApp()
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {})

    try {
      const listResponse = await app.request("http://localhost/api/tools/builtins")
      const listBody = (await listResponse.json()) as BuiltinToolListEnvelope

      expect(listResponse.status).toBe(200)
      expect(listBody.success).toBe(true)
      expect(listBody.data?.selection.tools).toEqual({})
      expect(listBody.data?.modules.length).toBeGreaterThan(1)
      expect(listBody.data?.modules.find((module) => module.id === "workspace.shell")).toMatchObject({
        title: "Shell",
        provider: {
          kind: "builtin",
          id: "anybox",
        },
        activation: {
          mode: "always",
          scope: "global",
          discovery: "none",
        },
      })
      expect(listBody.data?.modules.find((module) => module.id === "workspace.shell")?.toolIDs).toContain(
        "git_bash_command",
      )
      expect(listBody.data?.items.some((tool) => tool.id === "ask_user_question")).toBe(true)
      expect(listBody.data?.items.find((tool) => tool.id === "tool_search")).toMatchObject({
        title: "Tool Search",
        moduleID: "runtime.progressive-disclosure",
        enabled: true,
        inputSchema: {
          type: "object",
        },
        capabilities: {
          kind: "search",
          readOnly: true,
          destructive: false,
        },
      })
      expect(JSON.stringify(listBody.data?.items.find((tool) => tool.id === "tool_search")?.inputSchema)).toContain("query")
      expect(listBody.data?.items.find((tool) => tool.id === "load_workspace_dependencies")).toMatchObject({
        enabled: true,
        aliases: ["load-workspace-dependencies"],
        capabilities: {
          kind: "read",
          readOnly: true,
          destructive: false,
          concurrency: "safe",
        },
      })
      expect(listBody.data?.items.find((tool) => tool.id === "git_bash_command")).toMatchObject({
        enabled: true,
        moduleID: "workspace.shell",
        inputSchema: {
          type: "object",
        },
        capabilities: {
          kind: "exec",
          needsShell: true,
        },
      })
      const gitBashInputSchema = JSON.stringify(
        listBody.data?.items.find((tool) => tool.id === "git_bash_command")?.inputSchema,
      )
      expect(gitBashInputSchema).toContain("command")
      expect(gitBashInputSchema).toContain("tty")
      expect(listBody.data?.items.find((tool) => tool.id === "powershell_command")).toMatchObject({
        enabled: true,
        capabilities: {
          kind: "exec",
          needsShell: true,
        },
      })
      expect(listBody.data?.items.find((tool) => tool.id === "cmd_command")).toMatchObject({
        enabled: true,
        capabilities: {
          kind: "exec",
          needsShell: true,
        },
      })
      expect(listBody.data?.items.find((tool) => tool.id === "wsl_bash_command")).toMatchObject({
        enabled: true,
        capabilities: {
          kind: "exec",
          needsShell: true,
        },
      })
      expect(listBody.data?.items.find((tool) => tool.id === "exec_command")).toBeUndefined()
      expect(listBody.data?.items.find((tool) => tool.id === "bash")).toBeUndefined()

      const updateResponse = await app.request("http://localhost/api/tools/builtins/selection", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tools: {
            git_bash_command: false,
            tool_search: false,
          },
        }),
      })
      const updateBody = (await updateResponse.json()) as BuiltinToolSelectionEnvelope

      expect(updateResponse.status).toBe(200)
      expect(updateBody.data).toEqual({
        tools: {
          git_bash_command: false,
          tool_search: false,
        },
      })

      const disabledListResponse = await app.request("http://localhost/api/tools/builtins")
      const disabledListBody = (await disabledListResponse.json()) as BuiltinToolListEnvelope
      expect(disabledListBody.data?.items.find((tool) => tool.id === "git_bash_command")?.enabled).toBe(false)
      expect(disabledListBody.data?.items.find((tool) => tool.id === "tool_search")?.enabled).toBe(false)

      const resetResponse = await app.request("http://localhost/api/tools/builtins/selection", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tools: {},
        }),
      })
      const resetBody = (await resetResponse.json()) as BuiltinToolSelectionEnvelope
      expect(resetResponse.status).toBe(200)
      expect(resetBody.data?.tools).toEqual({})

      const legacyAliasResponse = await app.request("http://localhost/api/tools/builtins/selection", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tools: {
            "replace-text": false,
          },
        }),
      })
      const legacyAliasBody = (await legacyAliasResponse.json()) as BuiltinToolSelectionEnvelope
      expect(legacyAliasResponse.status).toBe(200)
      expect(legacyAliasBody.data?.tools).toEqual({
        replace_text: false,
      })

      const invalidResponse = await app.request("http://localhost/api/tools/builtins/selection", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tools: {
            "not-a-built-in-tool": false,
          },
        }),
      })
      const invalidBody = (await invalidResponse.json()) as JsonEnvelope

      expect(invalidResponse.status).toBe(400)
      expect(invalidBody.error?.code).toBe("UNKNOWN_BUILTIN_TOOL")
    } finally {
      await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {})
    }
  })

  test("built-in tool catalog filters removed tool selections without rewriting stored config", async () => {
    const app = createServerApp()
    const storedTools = {
      read_background_task: false,
      "read-background-task": false,
      stop_background_task: false,
      "stop-background-task": false,
      "replace-text": false,
    }
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, storedTools)

    try {
      const response = await app.request("http://localhost/api/tools/builtins")
      const body = (await response.json()) as BuiltinToolListEnvelope

      expect(response.status).toBe(200)
      expect(body.data?.selection.tools).toEqual({ replace_text: false })
      expect(body.data?.items.some((tool) => tool.id === "read_background_task")).toBe(false)
      expect(body.data?.items.some((tool) => tool.id === "stop_background_task")).toBe(false)
      expect(body.data?.items.find((tool) => tool.id === "replace_text")?.enabled).toBe(false)
      expect(await Config.getToolSelection(Config.GLOBAL_CONFIG_ID)).toEqual({ tools: storedTools })
    } finally {
      await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {})
    }
  })

  test("GET /api/debug/status should expose process health and recent errors", async () => {
    const app = createServerApp()
    const message = `monitor status error ${Date.now()}`
    Log.create({ service: "monitor-test-status" }).error(message, {
      requestId: "req_monitor_status",
      token: "secret-token",
    })

    const response = await app.request("http://localhost/api/debug/status")
    const body = (await response.json()) as JsonEnvelope<{
      ok: boolean
      generatedAt: number
      process: {
        pid: number
        uptimeMs: number
        memory: {
          heapUsed: number
        }
      }
      logging: {
        level: string
        print: boolean
        file: boolean
        services: string[]
      }
      runningSessions: {
        count: number
      }
      streams: {
        activeSubscriptions: number
        totals: {
          maxQueueLength: number
        }
      }
      recentErrors: Log.LogEntry[]
    }>

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data?.ok).toBe(true)
    expect(body.data?.generatedAt).toBeNumber()
    expect(body.data?.process.pid).toBeNumber()
    expect(body.data?.process.uptimeMs).toBeNumber()
    expect(body.data?.process.memory.heapUsed).toBeNumber()
    expect(body.data?.logging.level).toBeString()
    expect(body.data?.logging.services).toContain("monitor-test-status")
    expect(body.data?.logging.services).toContain("server.debug")
    expect(body.data?.runningSessions.count).toBeNumber()
    expect(body.data?.streams.activeSubscriptions).toBeNumber()
    expect(body.data?.streams.totals.maxQueueLength).toBeNumber()
    const statusLog = body.data?.recentErrors.find((entry) => entry.message === message)
    expect(statusLog?.requestId).toBe("req_monitor_status")
    expect(statusLog?.extra?.token).toBe("[REDACTED]")
  })

  test("GET /api/debug/logs should filter in-memory log entries", async () => {
    const app = createServerApp()
    const message = `monitor log query ${Date.now()}`
    Log.create({ service: "monitor-test-logs" }).warn(message, {
      sessionID: "ses_monitor_logs",
      password: "secret-password",
    })

    const response = await app.request(
      `http://localhost/api/debug/logs?service=monitor-test-logs&q=${encodeURIComponent(message)}&limit=5`,
    )
    const body = (await response.json()) as JsonEnvelope<{
      logs: Log.LogEntry[]
    }>

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data?.logs.length).toBeGreaterThanOrEqual(1)
    const entry = body.data?.logs.find((item) => item.message === message)
    expect(entry?.level).toBe("WARN")
    expect(entry?.service).toBe("monitor-test-logs")
    expect(entry?.sessionID).toBe("ses_monitor_logs")
    expect(entry?.extra?.password).toBe("[REDACTED]")
  })

  test("GET /api/debug/logs should exclude selected services", async () => {
    const app = createServerApp()
    const prefix = `monitor exclude query ${Date.now()}`
    Log.create({ service: "monitor-test-keep" }).info(`${prefix} keep`)
    Log.create({ service: "monitor-test-drop" }).info(`${prefix} drop`)

    const response = await app.request(
      `http://localhost/api/debug/logs?excludeService=monitor-test-drop&q=${encodeURIComponent(prefix)}&limit=10`,
    )
    const body = (await response.json()) as JsonEnvelope<{
      logs: Log.LogEntry[]
    }>

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data?.logs.some((entry) => entry.service === "monitor-test-keep")).toBe(true)
    expect(body.data?.logs.some((entry) => entry.service === "monitor-test-drop")).toBe(false)
  })

  test("GET /api/debug/logs/stream should emit matching log events", async () => {
    const app = createServerApp()
    const message = `monitor stream log ${Date.now()}`
    const response = await app.request("http://localhost/api/debug/logs/stream?service=monitor-test-stream")
    const rawPromise = readStreamUntil(response, ["event: log", message])

    Log.create({ service: "monitor-test-stream" }).info(message, {
      projectID: "project_monitor_stream",
    })

    const raw = await rawPromise

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(raw).toContain("event: log")
    expect(raw).toContain(message)
    expect(raw).toContain(`"projectID":"project_monitor_stream"`)
  })

  test("GET /api/debug/status/stream should push status snapshots", async () => {
    const app = createServerApp()
    const message = `monitor status stream ${Date.now()}`
    const response = await app.request("http://localhost/api/debug/status/stream")
    const rawPromise = readStreamUntil(response, ["event: status", "\"runtime\"", message])

    Log.create({ service: "monitor-test-status-stream" }).error(message)

    const raw = await rawPromise

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(raw).toContain("event: status")
    expect(raw).toContain("\"status\"")
    expect(raw).toContain("\"runtime\"")
    expect(raw).toContain(message)
  })

  test("GET /api/debug/status/stream should omit runtime snapshots when disabled", async () => {
    const app = createServerApp()
    const response = await app.request("http://localhost/api/debug/status/stream?runtime=0")
    const raw = await readStreamUntil(response, ["event: status", "\"status\""])

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(raw).toContain("event: status")
    expect(raw).toContain("\"status\"")
    expect(raw).not.toContain("\"runtime\"")
  })

  test("GET /api/debug/status/stream should keep pushing snapshots while idle", async () => {
    const app = createServerApp()
    const response = await app.request("http://localhost/api/debug/status/stream")
    const raw = await readStreamUntilOccurrences(response, "event: status", 2)

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(raw.split("event: status").length - 1).toBeGreaterThanOrEqual(2)
  })

  test("GET /api/debug runtime routes should expose running session state and recent events", async () => {
    const app = createServerApp()
    const session = await Session.createSession({
      directory: process.cwd(),
      projectID: "project_debug_runtime",
      title: "Debug runtime",
    })
    const controller = new AbortController()
    const assistantMessageID = Identifier.ascending("message")
    const toolPart: Message.ToolPart = {
      id: Identifier.ascending("part"),
      sessionID: session.id,
      messageID: assistantMessageID,
      type: "tool",
      callID: "toolcall_debug_runtime",
      tool: "read_file",
      state: {
        status: "waiting-approval",
        approvalID: "approval_debug_runtime",
        input: {
          path: "README.md",
        },
        title: "Read File",
        time: {
          start: Date.now(),
        },
      },
    }

    RunningState.register(session.id, controller, {
      startedAt: 123,
      reason: "prompt",
    })

    const turn = Orchestrator.startTurn({
      sessionID: session.id,
      userMessageID: Identifier.ascending("message"),
      agent: "default",
      model: {
        providerID: "test-provider",
        modelID: "test-model",
      },
    })

    try {
      turn.emit("tool.call.waiting_approval", {
        part: toolPart,
      })

      const globalResponse = await app.request("http://localhost/api/debug/runtime?limit=3")
      const globalBody = (await globalResponse.json()) as JsonEnvelope<{
        logging: {
          print: boolean
          file: boolean
          path: string | null
        }
        runningSessions: Array<{
          session: {
            id: string
            title: string
          }
          running: {
            sessionID: string
            activeForMs: number
            reason?: string
          }
          turn: {
            id: string
          } | null
          recentEvents: Array<{
            type: string
          }>
        }>
      }>

      expect(globalResponse.status).toBe(200)
      expect(globalBody.success).toBe(true)
      expect(typeof globalBody.data?.logging.print).toBe("boolean")
      expect(globalBody.data?.runningSessions).toHaveLength(1)
      expect(globalBody.data?.runningSessions[0]?.session.id).toBe(session.id)
      expect(globalBody.data?.runningSessions[0]?.session.title).toBe("Debug runtime")
      expect(globalBody.data?.runningSessions[0]?.running.sessionID).toBe(session.id)
      expect(globalBody.data?.runningSessions[0]?.running.reason).toBe("prompt")
      expect(globalBody.data?.runningSessions[0]?.turn?.id).toBe(turn.turnID)
      expect(globalBody.data?.runningSessions[0]?.recentEvents.some((event) => event.type === "turn.started")).toBe(true)
      expect(
        globalBody.data?.runningSessions[0]?.recentEvents.some((event) => event.type === "tool.call.waiting_approval"),
      ).toBe(true)

      const detailResponse = await app.request(`http://localhost/api/debug/sessions/${session.id}/runtime?limit=5`)
      const detailBody = (await detailResponse.json()) as JsonEnvelope<{
        session: {
          id: string
          directory: string
        }
        running: {
          sessionID: string
          activeForMs: number
          reason?: string
        }
        turn: {
          id: string
        } | null
        recentEvents: Array<{
          type: string
          summary?: Record<string, unknown>
        }>
      }>

      expect(detailResponse.status).toBe(200)
      expect(detailBody.success).toBe(true)
      expect(detailBody.data?.session.id).toBe(session.id)
      expect(detailBody.data?.session.directory).toBe(process.cwd())
      expect(detailBody.data?.running.sessionID).toBe(session.id)
      expect(detailBody.data?.turn?.id).toBe(turn.turnID)
      const detailEvents = detailBody.data?.recentEvents ?? []
      const latestEvent = detailEvents[detailEvents.length - 1]
      expect(latestEvent?.type).toBe("tool.call.waiting_approval")
      expect(latestEvent?.summary?.["toolName"]).toBe("read_file")
      expect(latestEvent?.summary?.["status"]).toBe("waiting-approval")
    } finally {
      Orchestrator.finishTurn(turn)
      RunningState.finish(session.id, controller)
      Session.removeSession(session.id)
    }
  })

  test("GET /api/debug/sessions/:id/trace-export should export a safe raw session trace", async () => {
    const app = createServerApp()
    const session = await Session.createSession({
      directory: process.cwd(),
      projectID: "project_debug_trace_export",
      title: "Debug trace export",
    })
    const now = Date.now()
    const userMessageID = Identifier.ascending("message")
    const assistantMessageID = Identifier.ascending("message")
    const longOutput = "x".repeat(20_050)
    const toolPart: Message.ToolPart = {
      id: Identifier.ascending("part"),
      sessionID: session.id,
      messageID: assistantMessageID,
      type: "tool",
      callID: "toolcall_debug_trace_export",
      tool: "grep",
      state: {
        status: "error",
        input: {
          apiKey: "direct-api-key-value",
          path: "README.md",
          nested: {
            authorization: "Bearer auth-token-value",
          },
        },
        raw: JSON.stringify({
          apiKey: "raw-api-key-value",
          path: "README.md",
        }),
        error: "grep failed because the pattern was invalid",
        metadata: {
          stdout: longOutput,
          cookie: "cookie-value",
          screenshot: "data:image/png;base64,AAAA",
        },
        time: {
          start: now,
          end: now + 7,
        },
      },
    }
    const assistantMessage: Message.Assistant = {
      id: assistantMessageID,
      sessionID: session.id,
      turnID: Identifier.ascending("turn"),
      parentMessageID: userMessageID,
      role: "assistant",
      created: now,
      completed: now + 8,
      parentID: userMessageID,
      modelID: "test-model",
      providerID: "test-provider",
      agent: "default",
      path: {
        cwd: process.cwd(),
        root: process.cwd(),
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      finishReason: "tool-calls",
    }
    const turn = Orchestrator.startTurn({
      sessionID: session.id,
      turnID: assistantMessage.turnID,
      userMessageID,
      agent: "default",
      model: {
        providerID: "test-provider",
        modelID: "test-model",
      },
    })

    try {
      Session.upsertMessage(assistantMessage)
      turn.emit("tool.call.failed", {
        part: toolPart,
      })

      const response = await app.request(`http://localhost/api/debug/sessions/${session.id}/trace-export`)
      const body = (await response.json()) as JsonEnvelope<{
        schemaVersion: 2
        messages: unknown[]
        events: Array<{
          type: string
          payload: unknown
        }>
        runtime: {
          turns: unknown[]
        }
        stats: {
          messageCount: number
          eventCount: number
          toolCallCount: number
          redactedCount: number
          truncatedCount: number
        }
        toolCalls: Array<{
          callID: string
          tool: string
          status: string
          input?: Record<string, unknown>
          rawInput?: string
          error?: string
          durationMs?: number
          eventIDs: string[]
        }>
      }>

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data?.schemaVersion).toBe(2)
      expect(body.data?.messages).toHaveLength(1)
      expect(body.data?.events.some((event) => event.type === "turn.started")).toBe(true)
      expect(body.data?.events.some((event) => event.type === "tool.call.failed")).toBe(true)
      expect(body.data?.runtime.turns.length).toBeGreaterThanOrEqual(1)
      expect(body.data?.stats.messageCount).toBe(1)
      expect(body.data?.stats.eventCount).toBeGreaterThanOrEqual(2)
      expect(body.data?.stats.toolCallCount).toBe(1)
      expect(body.data?.stats.redactedCount).toBeGreaterThanOrEqual(4)
      expect(body.data?.stats.truncatedCount).toBeGreaterThanOrEqual(1)

      const toolCall = body.data?.toolCalls[0]
      expect(toolCall?.callID).toBe(toolPart.callID)
      expect(toolCall?.tool).toBe("grep")
      expect(toolCall?.status).toBe("error")
      expect(toolCall?.input?.path).toBe("README.md")
      expect(toolCall?.input?.apiKey).toBe("[REDACTED]")
      expect(toolCall?.rawInput).toContain("[REDACTED]")
      expect(toolCall?.error).toBe("grep failed because the pattern was invalid")
      expect(toolCall?.durationMs).toBe(7)
      expect(toolCall?.eventIDs.length).toBeGreaterThanOrEqual(1)

      const serialized = JSON.stringify(body.data)
      expect(serialized).toContain("grep failed because the pattern was invalid")
      expect(serialized).toContain("[DATA_URL:image/png;redacted]")
      expect(serialized).toContain("[TRUNCATED originalLength=20050 maxLength=20000]")
      expect(serialized).not.toContain("direct-api-key-value")
      expect(serialized).not.toContain("raw-api-key-value")
      expect(serialized).not.toContain("auth-token-value")
      expect(serialized).not.toContain("cookie-value")
    } finally {
      Orchestrator.finishTurn(turn)
      Session.removeSession(session.id)
    }
  })

  test("GET /api/debug/sessions/:id/trace-export should return 404 for a missing session", async () => {
    const app = createServerApp()
    const response = await app.request("http://localhost/api/debug/sessions/session_missing_trace_export/trace-export")
    const body = (await response.json()) as JsonEnvelope

    expect(response.status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("SESSION_NOT_FOUND")
  })

  test("POST /api/sessions should validate payload", async () => {
    const app = createServerApp()
    const response = await app.request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    const body = (await response.json()) as JsonEnvelope

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("INVALID_PAYLOAD")
  })

  test("POST /api/sessions/:id/cancel should return 404 for missing session", async () => {
    const app = createServerApp()
    const response = await app.request("http://localhost/api/sessions/session_missing/cancel", {
      method: "POST",
    })
    const body = (await response.json()) as JsonEnvelope

    expect(response.status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("SESSION_NOT_FOUND")
  })

  test("POST /api/sessions/:id/cancel should return false for an idle session", async () => {
    const app = createServerApp()
    const directory = await createTempDirectory("anybox-cancel-idle-")
    let sessionID: string | null = null

    try {
      const createResponse = await app.request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory }),
      })
      const createBody = (await createResponse.json()) as SessionResponseEnvelope
      sessionID = createBody.data?.id ?? null

      expect(createResponse.status).toBe(201)
      expect(sessionID).toBeString()
      if (!sessionID) throw new Error("Expected session id")

      const response = await app.request(`http://localhost/api/sessions/${sessionID}/cancel`, {
        method: "POST",
      })
      const body = (await response.json()) as CancelSessionResponseEnvelope

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data).toEqual({
        sessionID,
        cancelled: false,
        activeCancelled: false,
        queuedCancelled: 0,
      })
    } finally {
      if (sessionID) {
        Session.removeSession(sessionID)
      }
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("POST /api/sessions/:id/cancel should stop a running session", async () => {
    const app = createServerApp()
    const directory = await createTempDirectory("anybox-cancel-running-")
    const controller = new AbortController()
    let sessionID: string | null = null

    try {
      const createResponse = await app.request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory }),
      })
      const createBody = (await createResponse.json()) as SessionResponseEnvelope
      sessionID = createBody.data?.id ?? null

      expect(createResponse.status).toBe(201)
      expect(sessionID).toBeString()
      if (!sessionID) throw new Error("Expected session id")
      expect(RunningState.register(sessionID, controller, { reason: "prompt" })).toBe(true)

      const response = await app.request(`http://localhost/api/sessions/${sessionID}/cancel`, {
        method: "POST",
      })
      const body = (await response.json()) as CancelSessionResponseEnvelope

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data).toEqual({
        sessionID,
        cancelled: true,
        activeCancelled: true,
        queuedCancelled: 0,
      })
      expect(controller.signal.aborted).toBe(true)
      expect(RunningState.isRunning(sessionID)).toBe(false)
    } finally {
      if (sessionID) {
        RunningState.finish(sessionID, controller)
        Session.removeSession(sessionID)
      }
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("POST /api/sessions/:id/cancel should stop running child subagents", async () => {
    const app = createServerApp()
    const directory = await createTempDirectory("anybox-cancel-subagents-")
    const childController = new AbortController()
    const grandchildController = new AbortController()
    let parentSessionID: string | null = null
    let childSessionID: string | null = null
    let grandchildSessionID: string | null = null
    let taskID: string | null = null
    let grandchildTaskID: string | null = null

    try {
      const createResponse = await app.request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory }),
      })
      const createBody = (await createResponse.json()) as SessionResponseEnvelope
      parentSessionID = createBody.data?.id ?? null
      const projectID = createBody.data?.projectID

      expect(createResponse.status).toBe(201)
      expect(parentSessionID).toBeString()
      expect(projectID).toBeString()
      if (!parentSessionID || !projectID) throw new Error("Expected parent session")

      const child = await Session.createSession({
        directory,
        projectID,
        title: "child subagent",
      })
      childSessionID = child.id
      taskID = Identifier.ascending("task")
      const grandchild = await Session.createSession({
        directory,
        projectID,
        title: "nested child subagent",
      })
      grandchildSessionID = grandchild.id
      grandchildTaskID = Identifier.ascending("task")
      const now = Date.now()

      Subtask.readSubtask(Identifier.ascending("task"))
      db.insertOneWithSchema("subtasks", Subtask.SubtaskRecord.parse({
        id: taskID,
        parentSessionID,
        parentMessageID: Identifier.ascending("message"),
        childSessionID,
        title: "child subagent",
        prompt: "Wait until the parent session is cancelled.",
        agent: "default",
        model: {
          providerID: "test-provider",
          modelID: "test-model",
        },
        runInBackground: true,
        permissionMode: "default",
        status: "running",
        startedAt: now,
        updatedAt: now,
      }), Subtask.SubtaskRecord)
      db.insertOneWithSchema("subtasks", Subtask.SubtaskRecord.parse({
        id: grandchildTaskID,
        parentSessionID: childSessionID,
        parentMessageID: Identifier.ascending("message"),
        childSessionID: grandchildSessionID,
        title: "nested child subagent",
        prompt: "Wait until the root parent session is cancelled.",
        agent: "default",
        model: {
          providerID: "test-provider",
          modelID: "test-model",
        },
        runInBackground: true,
        permissionMode: "default",
        status: "running",
        startedAt: now,
        updatedAt: now,
      }), Subtask.SubtaskRecord)
      expect(RunningState.register(childSessionID, childController, { reason: "subagent" })).toBe(true)
      expect(RunningState.register(grandchildSessionID, grandchildController, { reason: "subagent" })).toBe(true)

      const response = await app.request(`http://localhost/api/sessions/${parentSessionID}/cancel`, {
        method: "POST",
      })
      const body = (await response.json()) as CancelSessionResponseEnvelope

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data).toEqual({
        sessionID: parentSessionID,
        cancelled: true,
        activeCancelled: false,
        queuedCancelled: 0,
      })
      expect(childController.signal.aborted).toBe(true)
      expect(RunningState.isRunning(childSessionID)).toBe(false)
      expect(Subtask.readSubtask(taskID)?.status).toBe("cancelled")
      expect(grandchildController.signal.aborted).toBe(true)
      expect(RunningState.isRunning(grandchildSessionID)).toBe(false)
      expect(Subtask.readSubtask(grandchildTaskID)?.status).toBe("cancelled")
    } finally {
      if (grandchildSessionID) {
        RunningState.finish(grandchildSessionID, grandchildController)
        Session.removeSession(grandchildSessionID)
      }
      if (childSessionID) {
        RunningState.finish(childSessionID, childController)
        Session.removeSession(childSessionID)
      }
      if (parentSessionID) {
        Session.removeSession(parentSessionID)
      }
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("POST /api/sessions/:id/cancel should cancel queued work when requested", async () => {
    const app = createServerApp()
    const directory = await createTempDirectory("anybox-cancel-queued-")
    let sessionID: string | null = null
    let releaseFirst!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let finishFirst!: () => void
    const firstFinished = new Promise<void>((resolve) => {
      finishFirst = resolve
    })
    const observedEvents: RuntimeEvent.RuntimeEvent[] = []
    const unsubscribe = EventStore.subscribe((event) => {
      if (event.sessionID === sessionID) {
        observedEvents.push(event)
      }
    })

    try {
      const createResponse = await app.request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory }),
      })
      const createBody = (await createResponse.json()) as SessionResponseEnvelope
      sessionID = createBody.data?.id ?? null

      expect(createResponse.status).toBe(201)
      expect(sessionID).toBeString()
      if (!sessionID) throw new Error("Expected session id")

      const first = SessionRunner.enqueuePrompt({
        sessionID,
        directory,
        type: "prompt",
        execute: async () => {
          releaseFirst()
          await firstFinished
          return "first"
        },
      })

      await firstStarted

      const second = SessionRunner.enqueuePrompt({
        sessionID,
        directory,
        type: "prompt",
        execute: async () => "second",
      })

      expect(second.mode).toBe("queued")
      const response = await app.request(`http://localhost/api/sessions/${sessionID}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancelQueued: true }),
      })
      const body = (await response.json()) as CancelSessionResponseEnvelope

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data).toEqual({
        sessionID,
        cancelled: true,
        activeCancelled: true,
        queuedCancelled: 1,
      })
      await expect(second.promise).rejects.toThrow("cancelled before it started")
      expect(observedEvents.some((event) => event.turnID === second.turnID && event.type === "turn.cancelled")).toBe(true)

      finishFirst()
      await expect(first.promise).resolves.toBe("first")
      await SessionRunner.waitForIdle(sessionID)
    } finally {
      unsubscribe()
      finishFirst()
      if (sessionID) {
        SessionRunner.cancelSession(sessionID, { cancelQueued: true })
        Session.removeSession(sessionID)
      }
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("POST /api/projects should validate payload", async () => {
    const app = createServerApp()
    const response = await app.request("http://localhost/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    const body = (await response.json()) as JsonEnvelope

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("INVALID_PAYLOAD")
  })

  test("GET unknown route should return 404 json envelope", async () => {
    const app = createServerApp()
    const response = await app.request("http://localhost/unknown-route")
    const body = (await response.json()) as JsonEnvelope

    expect(response.status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("NOT_FOUND")
  })

  test("removed legacy auxiliary-conversation routes return 404", async () => {
    const app = createServerApp()
    const legacyPrefix = ["side", "chat"].join("-")
    const routes = [
      { method: "POST", suffix: `${legacyPrefix}s` },
      { method: "GET", suffix: `${legacyPrefix}s` },
      { method: "GET", suffix: `${legacyPrefix}-link` },
      { method: "GET", suffix: `${legacyPrefix}-context` },
    ]

    for (const route of routes) {
      const response = await app.request(
        `http://localhost/api/sessions/session_removed_feature/${route.suffix}`,
        {
          method: route.method,
          headers: { "content-type": "application/json" },
          body: route.method === "POST" ? "{}" : undefined,
        },
      )
      const body = (await response.json()) as JsonEnvelope

      expect(response.status).toBe(404)
      expect(body.success).toBe(false)
      expect(body.error?.code).toBe("NOT_FOUND")
    }
  })

  test("POST /api/sessions/:id/messages/stream should validate payload", async () => {
    const app = createServerApp()
    const response = await app.request("http://localhost/api/sessions/session_1/messages/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    const body = (await response.json()) as JsonEnvelope

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("INVALID_PAYLOAD")
  })

  test("POST /api/sessions/:id/messages/stream should return 404 for missing session", async () => {
    const app = createServerApp()
    const response = await app.request("http://localhost/api/sessions/session_missing/messages/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    })
    const body = (await response.json()) as JsonEnvelope

    expect(response.status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("SESSION_NOT_FOUND")
  })

  test("GET /api/sessions/:id/messages should return 404 for missing session", async () => {
    const app = createServerApp()
    const response = await app.request("http://localhost/api/sessions/session_missing/messages")
    const body = (await response.json()) as JsonEnvelope

    expect(response.status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("SESSION_NOT_FOUND")
  })

  test("GET /api/projects should include the project after creating a session", async () => {
    const app = createServerApp()
    const directory = process.cwd()

    const createResponse = await app.request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directory }),
    })
    const createBody = (await createResponse.json()) as SessionResponseEnvelope

    expect(createResponse.status).toBe(201)
    expect(createBody.success).toBe(true)
    expect(createBody.data?.projectID).toBeString()

    const response = await app.request("http://localhost/api/projects")
    const body = (await response.json()) as ProjectsResponseEnvelope

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data?.some((project) => project.id === createBody.data?.projectID)).toBe(true)
  })

  test("GET /api/projects should keep the same project id when a directory becomes a git repo", async () => {
    const app = createServerApp()
    const directory = await createTempDirectory("anybox-directory-to-git-")

    try {
      const createResponse = await app.request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory }),
      })
      const createBody = (await createResponse.json()) as SessionResponseEnvelope

      expect(createResponse.status).toBe(201)
      expect(createBody.success).toBe(true)
      expect(createBody.data?.projectID).toMatch(/^prj_/)

      await createGitRepo(directory, "migrated-repo")

      const response = await app.request("http://localhost/api/projects")
      const body = (await response.json()) as ProjectsResponseEnvelope

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)

      const migratedProject = body.data?.find((project) => project.id === createBody.data?.projectID)
      expect(migratedProject).toBeDefined()
      expect(migratedProject?.worktree).toBe(directory)

      const sessionsResponse = await app.request(`http://localhost/api/projects/${migratedProject!.id}/sessions`)
      const sessionsBody = (await sessionsResponse.json()) as ProjectSessionsResponseEnvelope

      expect(sessionsResponse.status).toBe(200)
      expect(sessionsBody.success).toBe(true)
      expect(
        sessionsBody.data?.some(
          (session) => session.id === createBody.data?.id && session.projectID === migratedProject!.id,
        ),
      ).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("project git routes should keep working with the original project id after git init", async () => {
    const app = createServerApp()
    const directory = await createTempDirectory("anybox-stable-project-git-")
    let sessionID: string | undefined

    try {
      const createResponse = await app.request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory }),
      })
      const createBody = (await createResponse.json()) as SessionResponseEnvelope

      expect(createResponse.status).toBe(201)
      expect(createBody.success).toBe(true)
      expect(createBody.data?.projectID).toMatch(/^prj_/)
      sessionID = createBody.data?.id

      await createGitRepo(directory, "stable-project")

      const capabilitiesResponse = await app.request(
        `http://localhost/api/projects/${createBody.data!.projectID}/git/capabilities?directory=${encodeURIComponent(directory)}`,
      )
      const capabilitiesBody = (await capabilitiesResponse.json()) as GitCapabilitiesEnvelope

      expect(capabilitiesResponse.status).toBe(200)
      expect(capabilitiesBody.success).toBe(true)
      expect(capabilitiesBody.data?.isGitRepo).toBe(true)

      const branchResponse = await app.request(
        `http://localhost/api/projects/${createBody.data!.projectID}/git/branches`,
        {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory,
          name: "feature/stable-project-id",
        }),
      },
      )
      const branchBody = (await branchResponse.json()) as GitActionEnvelope

      expect(branchResponse.status).toBe(200)
      expect(branchBody.success).toBe(true)
      expect(branchBody.data?.branch).toBe("feature/stable-project-id")
    } finally {
      if (sessionID) {
        await app.request(`http://localhost/api/sessions/${sessionID}`, {
          method: "DELETE",
        })
      }
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("POST /api/projects should create a project and expose its session list", async () => {
    const app = createServerApp()
    const directory = process.cwd()

    const createResponse = await app.request("http://localhost/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directory }),
    })
    const createBody = (await createResponse.json()) as ProjectResponseEnvelope

    expect(createResponse.status).toBe(201)
    expect(createBody.success).toBe(true)
    expect(createBody.data?.id).toBeString()
    expect(createBody.data?.worktree).toBeString()

    const sessionsResponse = await app.request(`http://localhost/api/projects/${createBody.data!.id}/sessions`)
    const sessionsBody = (await sessionsResponse.json()) as ProjectSessionsResponseEnvelope

    expect(sessionsResponse.status).toBe(200)
    expect(sessionsBody.success).toBe(true)
    expect(Array.isArray(sessionsBody.data)).toBe(true)
    expect(sessionsBody.data?.every((session) => session.projectID === createBody.data?.id)).toBe(true)
  })

  test("POST /api/projects should not rewrite a stable git project marker", async () => {
    const app = createServerApp()
    const directory = await createTempDirectory("anybox-stable-project-marker-")

    try {
      await createGitRepo(directory, "stable-project-marker")

      const firstResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory }),
      })
      const firstBody = (await firstResponse.json()) as ProjectResponseEnvelope

      expect(firstResponse.status).toBe(201)
      expect(firstBody.success).toBe(true)
      expect(firstBody.data?.id).toMatch(/^prj_/)

      const markerPath = join(directory, ".git", "anybox")
      await utimes(markerPath, new Date("2001-01-01T00:00:00.000Z"), new Date("2001-01-01T00:00:00.000Z"))
      const markerBefore = await stat(markerPath)

      const secondResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory }),
      })
      const secondBody = (await secondResponse.json()) as ProjectResponseEnvelope
      const markerAfter = await stat(markerPath)

      expect(secondResponse.status).toBe(201)
      expect(secondBody.success).toBe(true)
      expect(secondBody.data?.id).toBe(firstBody.data?.id)
      expect((await readFile(markerPath, "utf8")).trim()).toBe(firstBody.data!.id)
      expect(markerAfter.mtimeMs).toBe(markerBefore.mtimeMs)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("global and project provider routes should stay isolated", async () => {
    const restoreFetch = mockModelsDevFetch()
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-provider-project-")

    try {
      await withTemporaryEnv(
        {
          OPENAI_API_KEY: undefined,
          DEEPSEEK_API_KEY: undefined,
        },
        async () => {
          await createGitRepo(repositoryRoot, "provider-project")
          await resetGlobalProviderState(app)

          const catalogResponse = await app.request("http://localhost/api/providers/catalog")
          const catalogBody = (await catalogResponse.json()) as ProviderCatalogEnvelope

          expect(catalogResponse.status).toBe(200)
          expect(catalogBody.success).toBe(true)
          expect(catalogBody.data?.some((provider) => provider.id === "deepseek" && provider.modelCount > 0)).toBe(true)
          expect(catalogBody.data?.some((provider) => provider.id === "openai" && provider.configured === false)).toBe(true)

          const refreshedCatalogResponse = await app.request("http://localhost/api/providers/catalog/refresh", {
            method: "POST",
          })
          const refreshedCatalogBody = (await refreshedCatalogResponse.json()) as ProviderCatalogEnvelope

          expect(refreshedCatalogResponse.status).toBe(200)
          expect(refreshedCatalogBody.success).toBe(true)
          expect(refreshedCatalogBody.data?.some((provider) => provider.id === "deepseek" && provider.modelCount > 0)).toBe(
            true,
          )

          const saveDeepSeekKeyResponse = await app.request("http://localhost/api/providers/deepseek/auth/api-key", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              apiKey: "test-deepseek-key",
            }),
          })
          const saveDeepSeekKeyBody = (await saveDeepSeekKeyResponse.json()) as ProviderAuthStateEnvelope

          expect(saveDeepSeekKeyResponse.status).toBe(200)
          expect(saveDeepSeekKeyBody.success).toBe(true)

          const configureResponse = await app.request("http://localhost/api/providers/deepseek", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: "DeepSeek",
              whitelist: ["deepseek-reasoner"],
              options: {
                baseURL: "https://api.deepseek.com",
              },
            }),
          })
          const configureBody = (await configureResponse.json()) as ProviderUpdateEnvelope

          expect(configureResponse.status).toBe(200)
          expect(configureBody.success).toBe(true)
          expect(configureBody.data?.provider.id).toBe("deepseek")
          expect(configureBody.data?.provider.apiKeyConfigured).toBe(true)
          expect(configureBody.data?.provider.available).toBe(true)
          expect(configureBody.data?.provider.models).toHaveLength(1)
          expect((configureBody.data?.provider as Record<string, unknown> | undefined)?.key).toBeUndefined()

          const reconfigureResponse = await app.request("http://localhost/api/providers/deepseek", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              options: {
                baseURL: "https://proxy.deepseek.test/v1",
              },
            }),
          })
          const reconfigureBody = (await reconfigureResponse.json()) as ProviderUpdateEnvelope

          expect(reconfigureResponse.status).toBe(200)
          expect(reconfigureBody.success).toBe(true)
          expect(reconfigureBody.data?.provider.apiKeyConfigured).toBe(true)
          expect((reconfigureBody.data?.provider as Record<string, unknown> | undefined)?.baseURL).toBe("https://proxy.deepseek.test/v1")

          const providersResponse = await app.request("http://localhost/api/providers")
          const providersBody = (await providersResponse.json()) as ProviderListEnvelope

          expect(providersResponse.status).toBe(200)
          expect(providersBody.data?.items).toHaveLength(1)
          expect(providersBody.data?.items[0]?.id).toBe("deepseek")
          expect(providersBody.data?.items[0]?.models[0]?.id).toBe("deepseek-reasoner")

          const modelsResponse = await app.request("http://localhost/api/models")
          const modelsBody = (await modelsResponse.json()) as ProjectModelsEnvelope

          expect(modelsResponse.status).toBe(200)
          expect(modelsBody.data?.items).toHaveLength(1)
          expect(modelsBody.data?.items[0]).toMatchObject({
            providerID: "deepseek",
            id: "deepseek-reasoner",
            available: true,
          })

          const invalidSelectionResponse = await app.request("http://localhost/api/model-selection", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "deepseek/deepseek-reasoner",
              small_model: "anybox/deepseek-v4-flash",
            }),
          })
          const invalidSelectionBody = (await invalidSelectionResponse.json()) as JsonEnvelope

          expect(invalidSelectionResponse.status).toBe(400)
          expect(invalidSelectionBody.success).toBe(false)
          expect(invalidSelectionBody.error?.code).toBe("MODEL_NOT_FOUND")
          expect(invalidSelectionBody.error?.message).toBe("Model 'anybox/deepseek-v4-flash' is not available")

          const selectionResponse = await app.request("http://localhost/api/model-selection", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "deepseek/deepseek-reasoner",
            }),
          })
          const selectionBody = (await selectionResponse.json()) as JsonEnvelope<{
            model?: string
            small_model?: string
          }>

          expect(selectionResponse.status).toBe(200)
          expect(selectionBody.data?.model).toBe("deepseek/deepseek-reasoner")

          const projectResponse = await app.request("http://localhost/api/projects", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ directory: repositoryRoot }),
          })
          const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
          const projectID = projectBody.data?.id

          expect(projectResponse.status).toBe(201)
          expect(projectID).toBeString()

          const projectCatalogRefreshResponse = await app.request(
            `http://localhost/api/projects/${projectID}/providers/catalog/refresh`,
            {
              method: "POST",
            },
          )
          const projectCatalogRefreshBody = (await projectCatalogRefreshResponse.json()) as ProviderCatalogEnvelope

          expect(projectCatalogRefreshResponse.status).toBe(200)
          expect(projectCatalogRefreshBody.success).toBe(true)
          expect(projectCatalogRefreshBody.data?.some((provider) => provider.id === "openai")).toBe(true)

          const compatibilityResponse = await app.request(`http://localhost/api/projects/${projectID}/models`)
          const compatibilityBody = (await compatibilityResponse.json()) as ProjectModelsEnvelope

          expect(compatibilityResponse.status).toBe(200)
          expect(compatibilityBody.data?.selection.model).toBe("deepseek/deepseek-reasoner")
          expect(compatibilityBody.data?.effectiveModel?.id).toBe("deepseek-reasoner")
          expect(compatibilityBody.data?.items).toHaveLength(1)
          expect(compatibilityBody.data?.items[0]).toMatchObject({
            providerID: "deepseek",
            id: "deepseek-reasoner",
            available: true,
          })

          const projectConfigureResponse = await app.request(`http://localhost/api/projects/${projectID}/providers/openai`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: "OpenAI",
              whitelist: ["gpt-4o-mini"],
              options: {
                apiKey: "test-openai-key",
                baseURL: "https://api.openai.com/v1",
              },
            }),
          })
          const projectConfigureBody = (await projectConfigureResponse.json()) as ProviderUpdateEnvelope

          expect(projectConfigureResponse.status).toBe(200)
          expect(projectConfigureBody.data?.provider.id).toBe("openai")
          expect(projectConfigureBody.data?.provider.apiKeyConfigured).toBe(true)

          const projectModelsResponse = await app.request(`http://localhost/api/projects/${projectID}/models`)
          const projectModelsBody = (await projectModelsResponse.json()) as ProjectModelsEnvelope

          expect(projectModelsResponse.status).toBe(200)
          expect(projectModelsBody.data?.items).toHaveLength(2)
          expect(projectModelsBody.data?.items).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                providerID: "deepseek",
                id: "deepseek-reasoner",
                available: true,
              }),
              expect.objectContaining({
                providerID: "openai",
                id: "gpt-4o-mini",
                available: true,
              }),
            ]),
          )
          expect(projectModelsBody.data?.selection.model).toBe("deepseek/deepseek-reasoner")
          expect(projectModelsBody.data?.effectiveModel?.id).toBe("deepseek-reasoner")

          const createProjectSessionResponse = await app.request(`http://localhost/api/projects/${projectID}/sessions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Session scoped model" }),
          })
          const createProjectSessionBody = (await createProjectSessionResponse.json()) as SessionResponseEnvelope
          const sessionID = createProjectSessionBody.data?.id

          expect(createProjectSessionResponse.status).toBe(201)
          expect(sessionID).toBeString()

          const sessionModelsBeforeResponse = await app.request(`http://localhost/api/sessions/${sessionID}/models`)
          const sessionModelsBeforeBody = (await sessionModelsBeforeResponse.json()) as ProjectModelsEnvelope

          expect(sessionModelsBeforeResponse.status).toBe(200)
          expect(sessionModelsBeforeBody.data?.selection.model).toBeUndefined()
          expect(sessionModelsBeforeBody.data?.effectiveModel?.id).toBe("deepseek-reasoner")

          const sessionSelectionResponse = await app.request(`http://localhost/api/sessions/${sessionID}/model-selection`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "openai/gpt-4o-mini",
            }),
          })
          const sessionSelectionBody = (await sessionSelectionResponse.json()) as JsonEnvelope<{
            model?: string
            small_model?: string
          }>

          expect(sessionSelectionResponse.status).toBe(200)
          expect(sessionSelectionBody.data?.model).toBe("openai/gpt-4o-mini")

          const sessionModelsAfterResponse = await app.request(`http://localhost/api/sessions/${sessionID}/models`)
          const sessionModelsAfterBody = (await sessionModelsAfterResponse.json()) as ProjectModelsEnvelope

          expect(sessionModelsAfterResponse.status).toBe(200)
          expect(sessionModelsAfterBody.data?.selection.model).toBe("openai/gpt-4o-mini")
          expect(sessionModelsAfterBody.data?.effectiveModel?.id).toBe("gpt-4o-mini")

          const createOtherProjectSessionResponse = await app.request(`http://localhost/api/projects/${projectID}/sessions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Independent session scoped model" }),
          })
          const createOtherProjectSessionBody = (await createOtherProjectSessionResponse.json()) as SessionResponseEnvelope
          const otherSessionID = createOtherProjectSessionBody.data?.id

          expect(createOtherProjectSessionResponse.status).toBe(201)
          expect(otherSessionID).toBeString()

          const otherSessionModelsResponse = await app.request(`http://localhost/api/sessions/${otherSessionID}/models`)
          const otherSessionModelsBody = (await otherSessionModelsResponse.json()) as ProjectModelsEnvelope

          expect(otherSessionModelsResponse.status).toBe(200)
          expect(otherSessionModelsBody.data?.selection.model).toBeUndefined()
          expect(otherSessionModelsBody.data?.effectiveModel?.id).toBe("deepseek-reasoner")

          const projectModelsAfterSessionResponse = await app.request(`http://localhost/api/projects/${projectID}/models`)
          const projectModelsAfterSessionBody = (await projectModelsAfterSessionResponse.json()) as ProjectModelsEnvelope

          expect(projectModelsAfterSessionResponse.status).toBe(200)
          expect(projectModelsAfterSessionBody.data?.selection.model).toBe("deepseek/deepseek-reasoner")

          const sessionsAfterSelectionResponse = await app.request(`http://localhost/api/projects/${projectID}/sessions`)
          const sessionsAfterSelectionBody = (await sessionsAfterSelectionResponse.json()) as ProjectSessionsResponseEnvelope

          expect(sessionsAfterSelectionResponse.status).toBe(200)
          expect(
            sessionsAfterSelectionBody.data?.find((session) => session.id === sessionID)?.modelSelection?.model,
          ).toBe("openai/gpt-4o-mini")

          const globalModelsAfterProjectResponse = await app.request("http://localhost/api/models")
          const globalModelsAfterProjectBody = (await globalModelsAfterProjectResponse.json()) as ProjectModelsEnvelope

          expect(globalModelsAfterProjectResponse.status).toBe(200)
          expect(globalModelsAfterProjectBody.data?.items).toHaveLength(1)
          expect(globalModelsAfterProjectBody.data?.items[0]).toMatchObject({
            providerID: "deepseek",
            id: "deepseek-reasoner",
          })

          const removeResponse = await app.request("http://localhost/api/providers/deepseek", {
            method: "DELETE",
          })
          const removeBody = (await removeResponse.json()) as JsonEnvelope<{
            providerID: string
            selection: {
              model?: string
              small_model?: string
            }
          }>

          expect(removeResponse.status).toBe(200)
          expect(removeBody.data?.providerID).toBe("deepseek")
          expect(removeBody.data?.selection.model).toBeUndefined()
        },
      )
    } finally {
      await resetGlobalProviderState(app)
      restoreFetch()
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("custom provider routes should save a single OpenAI-compatible model without /models validation", async () => {
    const customRequests: Array<{ url: string; headers: Headers; method?: string; body?: unknown }> = []
    const restoreFetch = mockModelsDevFetch(({ url, headers, method, body }) => {
      if (url.startsWith("https://custom-gateway.test/v1")) {
        customRequests.push({ url, headers, method, body })
        return Response.json({
          id: "chatcmpl-test",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "pong" },
              finish_reason: "stop",
            },
          ],
        })
      }
      return undefined
    })
    const app = createServerApp()
    const providerID = "custom-custom-gateway-test"
    const repositoryRoot = await createTempDirectory("anybox-custom-provider-project-")

    try {
      await withTemporaryEnv(
        {
          OPENAI_API_KEY: undefined,
          DEEPSEEK_API_KEY: undefined,
        },
        async () => {
          await app.request(`http://localhost/api/providers/${providerID}`, {
            method: "DELETE",
          })

          const saveResponse = await app.request("http://localhost/api/providers/custom", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              providerID,
              apiBaseURL: "https://custom-gateway.test/v1",
              apiKey: "sk-custom",
              defaultModel: "deepseek-chat",
              chatEndpoint: "/chat/completions",
            }),
          })
          const saveBody = (await saveResponse.json()) as ProviderUpdateEnvelope

          expect(saveResponse.status).toBe(200)
          expect(saveBody.success).toBe(true)
          expect(saveBody.data?.provider).toMatchObject({
            id: providerID,
            name: "Custom · custom-gateway.test",
            apiKeyConfigured: true,
            available: true,
            baseURL: "https://custom-gateway.test/v1",
          })
          expect(saveBody.data?.selection.model).toBe(`${providerID}/deepseek-chat`)
          expect(customRequests).toHaveLength(0)

          const catalogResponse = await app.request("http://localhost/api/providers/catalog")
          const catalogBody = (await catalogResponse.json()) as ProviderCatalogEnvelope

          expect(catalogResponse.status).toBe(200)
          expect(catalogBody.data).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id: providerID,
                name: "Custom · custom-gateway.test",
                configured: true,
                available: true,
                apiKeyConfigured: true,
                customChatEndpoint: "/chat/completions",
                customDefaultModel: "deepseek-chat",
                modelCount: 1,
              }),
            ]),
          )

          const modelsResponse = await app.request("http://localhost/api/models")
          const modelsBody = (await modelsResponse.json()) as ProjectModelsEnvelope

          expect(modelsResponse.status).toBe(200)
          expect(modelsBody.data?.items).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                providerID,
                id: "deepseek-chat",
                name: "deepseek-chat",
                available: true,
              }),
            ]),
          )

          const projectResponse = await app.request("http://localhost/api/projects", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ directory: repositoryRoot }),
          })
          const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
          const projectID = projectBody.data?.id

          expect(projectResponse.status).toBe(201)
          expect(projectID).toBeString()

          const projectModelsResponse = await app.request(`http://localhost/api/projects/${projectID}/models`)
          const projectModelsBody = (await projectModelsResponse.json()) as ProjectModelsEnvelope

          expect(projectModelsResponse.status).toBe(200)
          expect(projectModelsBody.data?.items).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                providerID,
                id: "deepseek-chat",
                available: true,
              }),
            ]),
          )
          expect(projectModelsBody.data?.selection.model).toBe(`${providerID}/deepseek-chat`)
          expect(projectModelsBody.data?.effectiveModel?.id).toBe("deepseek-chat")

          const testResponse = await app.request("http://localhost/api/providers/custom/test", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              apiBaseURL: "https://custom-gateway.test/v1",
              apiKey: "sk-custom",
              defaultModel: "deepseek-chat",
              chatEndpoint: "/chat/completions",
            }),
          })
          const testBody = (await testResponse.json()) as JsonEnvelope<{ ok: boolean; status: string }>

          expect(testResponse.status).toBe(200)
          expect(testBody.data?.ok).toBe(true)
          expect(customRequests).toHaveLength(1)
          expect(customRequests[0]?.url).toBe("https://custom-gateway.test/v1/chat/completions")
          expect(customRequests[0]?.method).toBe("POST")
          expect(customRequests[0]?.headers.get("authorization")).toBe("Bearer sk-custom")
          expect(JSON.parse(String(customRequests[0]?.body))).toMatchObject({
            model: "deepseek-chat",
            stream: false,
          })
          expect(customRequests.some((request) => request.url.endsWith("/models"))).toBe(false)

          const editResponse = await app.request("http://localhost/api/providers/custom", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              providerID,
              apiBaseURL: "https://custom-gateway.test/v1",
              apiKey: "",
              defaultModel: "deepseek-chat-edited",
              chatEndpoint: "/compatible/chat",
            }),
          })
          const editBody = (await editResponse.json()) as ProviderUpdateEnvelope

          expect(editResponse.status).toBe(200)
          expect(editBody.data?.selection.model).toBe(`${providerID}/deepseek-chat-edited`)
          expect(customRequests).toHaveLength(1)

          const editedCatalogResponse = await app.request("http://localhost/api/providers/catalog")
          const editedCatalogBody = (await editedCatalogResponse.json()) as ProviderCatalogEnvelope

          expect(editedCatalogBody.data).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id: providerID,
                customChatEndpoint: "/compatible/chat",
                customDefaultModel: "deepseek-chat-edited",
              }),
            ]),
          )

          const preservedKeyTestResponse = await app.request("http://localhost/api/providers/custom/test", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              providerID,
              apiBaseURL: "https://custom-gateway.test/v1",
              apiKey: "",
              defaultModel: "deepseek-chat-edited",
              chatEndpoint: "/compatible/chat",
            }),
          })
          const preservedKeyTestBody = (await preservedKeyTestResponse.json()) as JsonEnvelope<{ ok: boolean; status: string }>

          expect(preservedKeyTestResponse.status).toBe(200)
          expect(preservedKeyTestBody.data?.ok).toBe(true)
          expect(customRequests).toHaveLength(2)
          expect(customRequests[1]?.url).toBe("https://custom-gateway.test/v1/compatible/chat")
          expect(customRequests[1]?.headers.get("authorization")).toBe("Bearer sk-custom")

          const removeResponse = await app.request(`http://localhost/api/providers/${providerID}`, {
            method: "DELETE",
          })
          const removeBody = (await removeResponse.json()) as JsonEnvelope<{ providerID: string; selection: { model?: string } }>

          expect(removeResponse.status).toBe(200)
          expect(removeBody.data?.providerID).toBe(providerID)
          expect(removeBody.data?.selection.model).toBeUndefined()
        },
      )
    } finally {
      await app.request(`http://localhost/api/providers/${providerID}`, {
        method: "DELETE",
      })
      restoreFetch()
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("GET /api/projects/:id/skills should list project skills with metadata fallback", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-skills-project-")

    try {
      await createGitRepo(repositoryRoot, "skills-project")
      await mkdir(join(repositoryRoot, ".anybox", "skills", "reviewer"), { recursive: true })
      await writeFile(
        join(repositoryRoot, ".anybox", "skills", "reviewer", "SKILL.md"),
        [
          "---",
          "name: Reviewer",
          "description: Review code changes before merge",
          "---",
          "",
          "# Reviewer",
          "",
          "Always review carefully.",
          "",
        ].join("\n"),
      )

      await mkdir(join(repositoryRoot, ".anybox", "skills", "writer"), { recursive: true })
      await writeFile(
        join(repositoryRoot, ".anybox", "skills", "writer", "SKILL.md"),
        [
          "# Writer",
          "",
          "Draft concise release notes from the latest change set.",
          "",
          "Include user-facing impact first.",
          "",
        ].join("\n"),
      )

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()

      const response = await app.request(`http://localhost/api/projects/${projectID}/skills`)
      const body = (await response.json()) as SkillListEnvelope

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      const projectSkills = body.data?.filter((skill) => skill.scope === "project") ?? []
      expect(projectSkills).toHaveLength(2)
      expect(projectSkills.find((skill) => skill.id === "project:reviewer")).toMatchObject({
        name: "Reviewer",
        description: "Review code changes before merge",
        scope: "project",
      })
      expect(projectSkills.find((skill) => skill.id === "project:writer")).toMatchObject({
        name: "writer",
        description: "Writer",
        scope: "project",
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("project skill selection routes should persist project-scoped skill ids", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-skill-selection-project-")

    try {
      await createGitRepo(repositoryRoot, "skill-selection-project")
      await mkdir(join(repositoryRoot, ".anybox", "skills", "reviewer"), { recursive: true })
      await writeFile(
        join(repositoryRoot, ".anybox", "skills", "reviewer", "SKILL.md"),
        [
          "---",
          "name: Reviewer",
          "description: Review code changes before merge",
          "---",
          "",
          "# Reviewer",
          "",
          "Always review carefully.",
          "",
        ].join("\n"),
      )

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()

      const updateResponse = await app.request(`http://localhost/api/projects/${projectID}/skills/selection`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          skillIDs: ["project:reviewer", "project:missing", "project:reviewer"],
        }),
      })
      const updateBody = (await updateResponse.json()) as ProjectSkillSelectionEnvelope

      expect(updateResponse.status).toBe(200)
      expect(updateBody.data).toEqual({
        skillIDs: ["project:reviewer"],
      })

      const readResponse = await app.request(`http://localhost/api/projects/${projectID}/skills/selection`)
      const readBody = (await readResponse.json()) as ProjectSkillSelectionEnvelope

      expect(readResponse.status).toBe(200)
      expect(readBody.data).toEqual({
        skillIDs: ["project:reviewer"],
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("project plugin selection routes should persist project-scoped installed plugin ids", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-plugin-selection-project-")
    const pluginInstallRoot = await createTempDirectory("anybox-plugin-selection-install-")
    const previousPluginInstallDir = process.env.ANYBOX_PLUGIN_INSTALL_DIR

    try {
      process.env.ANYBOX_PLUGIN_INSTALL_DIR = pluginInstallRoot
      await writeProjectSelectionPluginPackage(pluginInstallRoot)
      await createGitRepo(repositoryRoot, "plugin-selection-project")
      await mkdir(join(repositoryRoot, ".anybox", "skills", "reviewer"), { recursive: true })
      await writeFile(
        join(repositoryRoot, ".anybox", "skills", "reviewer", "SKILL.md"),
        [
          "---",
          "name: Reviewer",
          "description: Review project changes.",
          "---",
          "",
          "# Reviewer",
          "",
          "Review carefully.",
          "",
        ].join("\n"),
      )

      const installResponse = await app.request("http://localhost/api/plugins/installed/project-lab", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })
      expect(installResponse.status).toBe(200)

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()

      const listResponse = await app.request(`http://localhost/api/projects/${projectID}/plugins`)
      const listBody = (await listResponse.json()) as ProjectPluginListEnvelope

      expect(listResponse.status).toBe(200)
      expect(listBody.data?.map((plugin) => plugin.pluginID)).toContain("project-lab")

      const beforeSkillsResponse = await app.request(`http://localhost/api/projects/${projectID}/skills`)
      const beforeSkillsBody = (await beforeSkillsResponse.json()) as SkillListEnvelope
      expect(beforeSkillsBody.data?.some((skill) => skill.scope === "plugin")).toBe(false)

      const updateResponse = await app.request(`http://localhost/api/projects/${projectID}/plugins/selection`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pluginIDs: ["project-lab", "missing-plugin", "project-lab"],
        }),
      })
      const updateBody = (await updateResponse.json()) as ProjectPluginSelectionEnvelope

      expect(updateResponse.status).toBe(200)
      expect(updateBody.data).toEqual({
        pluginIDs: ["project-lab"],
      })

      const readResponse = await app.request(`http://localhost/api/projects/${projectID}/plugins/selection`)
      const readBody = (await readResponse.json()) as ProjectPluginSelectionEnvelope

      expect(readResponse.status).toBe(200)
      expect(readBody.data).toEqual({
        pluginIDs: ["project-lab"],
      })

      const afterSkillsResponse = await app.request(`http://localhost/api/projects/${projectID}/skills`)
      const afterSkillsBody = (await afterSkillsResponse.json()) as SkillListEnvelope

      expect(afterSkillsResponse.status).toBe(200)
      expect(afterSkillsBody.data?.some((skill) => skill.scope === "plugin")).toBe(false)
      expect(afterSkillsBody.data?.some((skill) => skill.id === "project:reviewer")).toBe(true)

      const skillSelectionResponse = await app.request(
        `http://localhost/api/projects/${projectID}/skills/selection`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            skillIDs: [
              "project:reviewer",
              "plugin:project-lab:project-helper",
            ],
          }),
        },
      )
      const skillSelectionBody = (await skillSelectionResponse.json()) as ProjectSkillSelectionEnvelope
      expect(skillSelectionBody.data?.skillIDs).toEqual(["project:reviewer"])
      expect(await Skill.resolveTurnSkillIDs({
        projectID: projectID!,
        projectRoot: repositoryRoot,
      })).toEqual([
        "project:reviewer",
        "plugin:project-lab:project-helper",
      ])
      expect(await Skill.resolveTurnSkillIDs({
        projectID: projectID!,
        projectRoot: repositoryRoot,
        requestedSkillIDs: ["plugin:project-lab:project-helper"],
      })).toEqual([
        "plugin:project-lab:project-helper",
      ])

      const projectMcpResponse = await app.request(
        `http://localhost/api/projects/${projectID}/mcp/servers`,
      )
      const projectMcpBody = (await projectMcpResponse.json()) as McpServerListEnvelope
      expect(projectMcpBody.data?.map((server) => server.id)).toContain("plugin.project-lab.notes")

      await Config.setMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.user-looking", {
        name: "User-owned prefix fixture",
        transport: "stdio",
        command: "node",
        enabled: true,
      })
      const mcpSelectionResponse = await app.request(
        `http://localhost/api/projects/${projectID}/mcp/selection`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            serverIDs: [
              "plugin.project-lab.notes",
              "plugin.user-looking",
            ],
          }),
        },
      )
      const mcpSelectionBody = (await mcpSelectionResponse.json()) as JsonEnvelope<{
        serverIDs: string[]
      }>
      expect(mcpSelectionBody.data?.serverIDs).toEqual(["plugin.user-looking"])

      const disablePluginMcpResponse = await app.request(
        "http://localhost/api/plugins/installed/project-lab/mcp/plugin.project-lab.notes",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled: false,
          }),
        },
      )
      expect(disablePluginMcpResponse.status).toBe(200)
      const disabledProjectMcpResponse = await app.request(
        `http://localhost/api/projects/${projectID}/mcp/servers`,
      )
      const disabledProjectMcpBody = (await disabledProjectMcpResponse.json()) as McpServerListEnvelope
      expect(disabledProjectMcpBody.data?.map((server) => server.id)).not.toContain("plugin.project-lab.notes")
      expect(disabledProjectMcpBody.data?.map((server) => server.id)).toContain("plugin.user-looking")
    } finally {
      await app.request("http://localhost/api/plugins/installed/project-lab", {
        method: "DELETE",
      })
      if (previousPluginInstallDir === undefined) {
        delete process.env.ANYBOX_PLUGIN_INSTALL_DIR
      } else {
        process.env.ANYBOX_PLUGIN_INSTALL_DIR = previousPluginInstallDir
      }
      await rm(repositoryRoot, { recursive: true, force: true })
      await rm(pluginInstallRoot, { recursive: true, force: true })
    }
  })

  test("project MCP routes should persist project-scoped server configs", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-mcp-project-")

    try {
      await createGitRepo(repositoryRoot, "mcp-project")

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()

      const createResponse = await app.request(`http://localhost/api/projects/${projectID}/mcp/servers/filesystem`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Filesystem",
          command: "node",
          args: ["server.js"],
          env: {
            MCP_MODE: "test",
          },
          cwd: ".",
          enabled: true,
          timeoutMs: 45000,
        }),
      })
      const createBody = (await createResponse.json()) as McpServerEnvelope

      expect(createResponse.status).toBe(200)
      expect(createBody.data).toMatchObject({
        id: "filesystem",
        name: "Filesystem",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        cwd: ".",
        enabled: true,
        timeoutMs: 45000,
      })

      const listResponse = await app.request(`http://localhost/api/projects/${projectID}/mcp/servers`)
      const listBody = (await listResponse.json()) as McpServerListEnvelope

      expect(listResponse.status).toBe(200)
      expect(listBody.data).toHaveLength(1)
      expect(listBody.data?.[0]).toMatchObject({
        id: "filesystem",
        env: {
          MCP_MODE: "test",
        },
      })

      const deleteResponse = await app.request(`http://localhost/api/projects/${projectID}/mcp/servers/filesystem`, {
        method: "DELETE",
      })
      const deleteBody = (await deleteResponse.json()) as McpDeleteEnvelope

      expect(deleteResponse.status).toBe(200)
      expect(deleteBody.data).toEqual({
        serverID: "filesystem",
        removed: true,
      })

      const emptyResponse = await app.request(`http://localhost/api/projects/${projectID}/mcp/servers`)
      const emptyBody = (await emptyResponse.json()) as McpServerListEnvelope

      expect(emptyResponse.status).toBe(200)
      expect(emptyBody.data).toHaveLength(0)
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("project MCP routes should persist remote MCP server configs", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-remote-mcp-project-")

    try {
      await createGitRepo(repositoryRoot, "remote-mcp-project")

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()

      const createResponse = await app.request(`http://localhost/api/projects/${projectID}/mcp/servers/remote-search`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Remote Search",
          transport: "remote",
          serverUrl: "https://mcp.example.test/server",
          headers: {
            "x-api-key": "secret",
          },
          allowedTools: {
            readOnly: true,
            toolNames: ["search"],
          },
          enabled: true,
          timeoutMs: 30000,
        }),
      })
      const createBody = (await createResponse.json()) as McpServerEnvelope

      expect(createResponse.status).toBe(200)
      expect(createBody.data).toMatchObject({
        id: "remote-search",
        name: "Remote Search",
        transport: "remote",
        serverUrl: "https://mcp.example.test/server",
        headers: {
          "x-api-key": "secret",
        },
        allowedTools: {
          readOnly: true,
          toolNames: ["search"],
        },
        enabled: true,
        timeoutMs: 30000,
      })

      const listResponse = await app.request(`http://localhost/api/projects/${projectID}/mcp/servers`)
      const listBody = (await listResponse.json()) as McpServerListEnvelope

      expect(listResponse.status).toBe(200)
      expect(listBody.data).toHaveLength(1)
      expect(listBody.data?.[0]).toMatchObject({
        id: "remote-search",
        transport: "remote",
        serverUrl: "https://mcp.example.test/server",
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("provider settings should reject config-stored API keys and invalid manual test keys before saving", async () => {
    const restoreFetch = mockModelsDevFetch(({ url, headers }) => {
      if (url !== "https://api.deepseek.com/models") return undefined

      if (headers.get("authorization") === "Bearer invalid-deepseek-key") {
        return new Response(JSON.stringify({ error: { message: "Invalid API key" } }), {
          status: 401,
          headers: {
            "content-type": "application/json",
          },
        })
      }

      return Response.json({
        object: "list",
        data: [{ id: "deepseek-reasoner" }],
      })
    })
    const app = createServerApp()

    try {
      await withTemporaryEnv(
        {
          OPENAI_API_KEY: undefined,
          DEEPSEEK_API_KEY: undefined,
        },
        async () => {
          await resetGlobalProviderState(app)

          const configResponse = await app.request("http://localhost/api/providers/deepseek", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: "DeepSeek",
              options: {
                apiKey: "invalid-deepseek-key",
                baseURL: "https://api.deepseek.com",
              },
            }),
          })
          const configBody = (await configResponse.json()) as JsonEnvelope

          expect(configResponse.status).toBe(400)
          expect(configBody.success).toBe(false)
          expect(configBody.error?.code).toBe("PROVIDER_API_KEY_NOT_ALLOWED")

          const response = await app.request("http://localhost/api/providers/deepseek/auth/test", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              method: "api-key",
              credentialMode: "manual",
              apiKey: "invalid-deepseek-key",
              baseURL: "https://api.deepseek.com",
            }),
          })
          const body = (await response.json()) as ProviderConnectionTestEnvelope

          expect(response.status).toBe(200)
          expect(body.success).toBe(true)
          expect(body.data?.ok).toBe(false)
          expect(body.data?.status).toBe("auth_error")
          expect(body.data?.message).toContain("Invalid API key")

          const providersResponse = await app.request("http://localhost/api/providers")
          const providersBody = (await providersResponse.json()) as ProviderListEnvelope

          expect(providersResponse.status).toBe(200)
          expect(providersBody.data?.items).toHaveLength(0)
        },
      )
    } finally {
      await resetGlobalProviderState(app)
      restoreFetch()
    }
  })

  test("provider auth API key routes should persist shared credentials without writing provider config", async () => {
    const app = createServerApp()

    try {
      await withTemporaryEnv(
        {
          OPENAI_API_KEY: undefined,
          DEEPSEEK_API_KEY: undefined,
        },
        async () => {
          await resetGlobalProviderState(app)

          const saveResponse = await app.request("http://localhost/api/providers/openai/auth/api-key", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              apiKey: "sk-openai-auth-test",
            }),
          })
          const saveBody = (await saveResponse.json()) as ProviderAuthStateEnvelope

          expect(saveResponse.status).toBe(200)
          expect(saveBody.success).toBe(true)
          expect(saveBody.data).toMatchObject({
            providerID: "openai",
            scope: "global",
            activeMethod: "api-key",
            status: "connected",
            connectionLabel: "Connected via API key",
          })
          expect(saveBody.data?.credentials).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                method: "api-key",
                kind: "api_key",
                source: "credential_store",
                configured: true,
              }),
            ]),
          )

          const authResponse = await app.request("http://localhost/api/providers/openai/auth")
          const authBody = (await authResponse.json()) as ProviderAuthStateEnvelope

          expect(authResponse.status).toBe(200)
          expect(authBody.success).toBe(true)
          expect(authBody.data).toMatchObject({
            providerID: "openai",
            activeMethod: "api-key",
            status: "connected",
          })

          const catalogResponse = await app.request("http://localhost/api/providers/catalog")
          const catalogBody = (await catalogResponse.json()) as ProviderCatalogEnvelope
          const openAIProvider = catalogBody.data?.find((provider) => provider.id === "openai")

          expect(catalogResponse.status).toBe(200)
          expect(openAIProvider).toMatchObject({
            id: "openai",
            authScope: "global",
            activeAuthMethod: "api-key",
            authState: {
              activeMethod: "api-key",
              status: "connected",
              connectionLabel: "Connected via API key",
            },
          })

          const globalConfig = await Config.get(Config.GLOBAL_CONFIG_ID)
          expect(globalConfig.provider?.openai?.options?.apiKey).toBeUndefined()
        },
      )
    } finally {
      await resetGlobalProviderState(app)
    }
  })

  test("global provider auth changes should invalidate project model caches", async () => {
    const restoreFetch = mockModelsDevFetch()
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-provider-cache-")

    try {
      await withTemporaryEnv(
        {
          OPENAI_API_KEY: undefined,
          DEEPSEEK_API_KEY: undefined,
        },
        async () => {
          await createGitRepo(repositoryRoot, "provider-cache")
          await resetGlobalProviderState(app)

          const projectResponse = await app.request("http://localhost/api/projects", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ directory: repositoryRoot }),
          })
          const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
          const projectID = projectBody.data?.id

          expect(projectResponse.status).toBe(201)
          expect(projectID).toBeString()

          const beforeResponse = await app.request(`http://localhost/api/projects/${projectID}/models`)
          const beforeBody = (await beforeResponse.json()) as ProjectModelsEnvelope

          expect(beforeResponse.status).toBe(200)
          expect(beforeBody.data?.items).not.toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                providerID: "openai",
                id: "gpt-4o-mini",
              }),
            ]),
          )

          const saveResponse = await app.request("http://localhost/api/providers/openai/auth/api-key", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              apiKey: "sk-openai-cache-test",
            }),
          })

          expect(saveResponse.status).toBe(200)

          const afterResponse = await app.request(`http://localhost/api/projects/${projectID}/models`)
          const afterBody = (await afterResponse.json()) as ProjectModelsEnvelope

          expect(afterResponse.status).toBe(200)
          expect(afterBody.data?.items).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                providerID: "openai",
                id: "gpt-4o-mini",
                available: true,
              }),
            ]),
          )
        },
      )
    } finally {
      await resetGlobalProviderState(app)
      restoreFetch()
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("GET /api/providers/:providerID/auth should surface shared Codex ChatGPT cache for OpenAI", async () => {
    const app = createServerApp()
    const codexHome = await createTempDirectory("anybox-codex-home-")
    const idToken = encodeJwt({
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
      email: "codex-cache@example.test",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_codex_cache",
        chatgpt_user_id: "user_codex_cache",
        chatgpt_plan_type: "pro",
        chatgpt_workspace_id: "ws_codex_cache",
        chatgpt_workspace_name: "Codex Workspace",
      },
    })

    try {
      await writeFile(
        join(codexHome, "auth.json"),
        JSON.stringify({
          auth_mode: "chatgpt",
          OPENAI_API_KEY: null,
          tokens: {
            access_token: "codex-cache-access-token",
            refresh_token: "codex-cache-refresh-token",
            id_token: idToken,
            account_id: "acct_codex_cache",
          },
          last_refresh: Date.now(),
        }),
      )

      await withTemporaryEnv(
        {
          CODEX_HOME: codexHome,
          OPENAI_API_KEY: undefined,
        },
        async () => {
          await resetGlobalProviderState(app)

          const response = await app.request("http://localhost/api/providers/openai/auth")
          const body = (await response.json()) as ProviderAuthStateEnvelope

          expect(response.status).toBe(200)
          expect(body.success).toBe(true)
          expect(body.data).toMatchObject({
            providerID: "openai",
            scope: "global",
            activeMethod: "chatgpt-browser",
            status: "connected",
            account: {
              email: "codex-cache@example.test",
              planType: "pro",
              workspaceName: "Codex Workspace",
            },
          })
          expect(body.data?.connectionLabel).toContain("Codex cache")
          expect(body.data?.credentials).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                method: "chatgpt-browser",
                kind: "oauth_session",
                source: "external_cache",
                configured: true,
                email: "codex-cache@example.test",
              }),
            ]),
          )
        },
      )
    } finally {
      await rm(codexHome, { recursive: true, force: true })
      await resetGlobalProviderState(app)
    }
  })

  test("POST /api/providers/:providerID/auth/flows should complete OpenAI browser auth through a localhost callback", async () => {
    const app = createServerApp()
    const restoreFetch = mockModelsDevFetch(({ url }) => {
      if (url === "https://auth.openai.com/oauth/token") {
        return Response.json({
          access_token: "browser-access-token",
          refresh_token: "browser-refresh-token",
          id_token: encodeJwt({
            exp: Math.floor(Date.now() / 1000) + 60 * 60,
            email: "browser-auth@example.test",
            "https://api.openai.com/auth": {
              chatgpt_account_id: "acct_browser_auth",
              chatgpt_user_id: "user_browser_auth",
              chatgpt_plan_type: "plus",
              chatgpt_workspace_id: "ws_browser_auth",
              chatgpt_workspace_name: "Browser Workspace",
            },
          }),
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid profile email offline_access",
        })
      }
    })

    try {
      await withTemporaryEnv(
        {
          ANYBOX_OPENAI_CODEX_CALLBACK_PORT: "0",
          OPENAI_API_KEY: undefined,
        },
        async () => {
          await resetGlobalProviderState(app)

          const startResponse = await app.request("http://localhost/api/providers/openai/auth/flows", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              method: "chatgpt-browser",
            }),
          })
          const startBody = (await startResponse.json()) as ProviderAuthFlowEnvelope

          expect(startResponse.status).toBe(200)
          expect(startBody.success).toBe(true)
          expect(startBody.data).toMatchObject({
            providerID: "openai",
            method: "chatgpt-browser",
            kind: "browser_oauth",
            status: "waiting_user",
          })

          const authorizationURL = new URL(startBody.data?.authorizationURL ?? "")
          expect(authorizationURL.origin).toBe("https://auth.openai.com")
          expect(authorizationURL.searchParams.get("scope")).toBe("openid profile email offline_access")

          const redirectURI = authorizationURL.searchParams.get("redirect_uri")
          expect(redirectURI).toBeString()

          const redirectURL = new URL(redirectURI ?? "")
          expect(redirectURL.hostname).toBe("localhost")
          expect(redirectURL.pathname).toBe("/auth/callback")
          expect(redirectURL.port).not.toBe("")

          const state = authorizationURL.searchParams.get("state")
          expect(state).toBeString()

          const callbackResponse = await fetch(
            `${redirectURI}?code=browser-auth-code&state=${encodeURIComponent(state ?? "")}`,
          )
          const callbackHtml = await callbackResponse.text()

          expect(callbackResponse.status).toBe(200)
          expect(callbackHtml).toContain("Sign-in complete")

          const flowResponse = await app.request(
            `http://localhost/api/providers/openai/auth/flows/${encodeURIComponent(startBody.data?.id ?? "")}`,
          )
          const flowBody = (await flowResponse.json()) as ProviderAuthFlowEnvelope

          expect(flowResponse.status).toBe(200)
          expect(flowBody.data).toMatchObject({
            id: startBody.data?.id,
            providerID: "openai",
            method: "chatgpt-browser",
            status: "connected",
            account: {
              email: "browser-auth@example.test",
              planType: "plus",
              workspaceName: "Browser Workspace",
            },
          })

          const authResponse = await app.request("http://localhost/api/providers/openai/auth")
          const authBody = (await authResponse.json()) as ProviderAuthStateEnvelope

          expect(authResponse.status).toBe(200)
          expect(authBody.data).toMatchObject({
            providerID: "openai",
            scope: "global",
            activeMethod: "chatgpt-browser",
            status: "connected",
            account: {
              email: "browser-auth@example.test",
              planType: "plus",
              workspaceName: "Browser Workspace",
            },
          })
          expect(authBody.data?.credentials).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                method: "chatgpt-browser",
                kind: "oauth_session",
                source: "credential_store",
                configured: true,
              }),
            ]),
          )
        },
      )
    } finally {
      restoreFetch()
      await resetGlobalProviderState(app)
    }
  })

  test("POST /api/projects should keep folders in the same git repo under one project", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-repo-")
    const firstDirectory = join(repositoryRoot, "client")
    const secondDirectory = join(repositoryRoot, "server")

    try {
      await createGitRepo(repositoryRoot, "shared-repo")
      await mkdir(firstDirectory, { recursive: true })
      await mkdir(secondDirectory, { recursive: true })

      const firstResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: firstDirectory }),
      })
      const firstBody = (await firstResponse.json()) as ProjectResponseEnvelope

      const secondResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: secondDirectory }),
      })
      const secondBody = (await secondResponse.json()) as ProjectResponseEnvelope

      expect(firstResponse.status).toBe(201)
      expect(secondResponse.status).toBe(201)
      expect(firstBody.data?.id).toBeString()
      expect(secondBody.data?.id).toBeString()
      expect(firstBody.data?.id).toBe(secondBody.data?.id)
      expect(firstBody.data?.worktree).toBe(repositoryRoot)
      expect(secondBody.data?.worktree).toBe(repositoryRoot)
      expect(firstBody.data?.repositoryRoot).toBe(repositoryRoot)
      expect(secondBody.data?.repositoryRoot).toBe(repositoryRoot)
      expect(firstBody.data?.workspaceRoots).toContain(repositoryRoot)
      expect(secondBody.data?.workspaceRoots).toContain(repositoryRoot)
      expect(secondBody.data?.name).toBe(repositoryRoot.split(/[\\/]/).filter(Boolean).pop())

      const listResponse = await app.request("http://localhost/api/projects")
      const listBody = (await listResponse.json()) as ProjectsResponseEnvelope

      expect(listResponse.status).toBe(200)
      expect(
        listBody.data?.some(
          (project) =>
            project.id === firstBody.data?.id &&
            project.worktree === repositoryRoot &&
            project.repositoryRoot === repositoryRoot &&
            project.workspaceRoots.includes(repositoryRoot) &&
            project.sandboxes.length === 0,
        ),
      ).toBe(true)
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("prompt preset routes should lazily migrate legacy prompt config into files", async () => {
    await withTempPromptRoot(async (promptRoot) => {
      const app = createServerApp()
      const legacyCustomPresetID = "custom-legacy-prompt"
      const legacyPlanPrompt = "Legacy plan prompt migrated from config."
      const legacyCustomPrompt = "Legacy custom prompt migrated from config."

      try {
        await Config.setPromptOverride(Config.GLOBAL_CONFIG_ID, "plan-mode", legacyPlanPrompt)
        await Config.setCustomPromptPreset(Config.GLOBAL_CONFIG_ID, legacyCustomPresetID, {
          label: "Legacy prompt",
          content: legacyCustomPrompt,
          description: "Migrated legacy custom prompt.",
        })

        const listResponse = await app.request("http://localhost/api/prompts")
        const listBody = (await listResponse.json()) as PromptPresetSummaryEnvelope

        expect(listResponse.status).toBe(200)
        expect(listBody.success).toBe(true)
        const planPreset = listBody.data?.find((preset) => preset.id === "plan-mode")
        const customPreset = listBody.data?.find((preset) => preset.id === legacyCustomPresetID)
        expect(planPreset).toMatchObject({
          id: "plan-mode",
          source: "bundled",
          hasOverride: true,
          root: promptRoot,
          filePath: join(promptRoot, "bundled", "plan-mode.md"),
        })
        expect(customPreset).toMatchObject({
          id: legacyCustomPresetID,
          label: "Legacy prompt",
          source: "custom",
          root: promptRoot,
        })
        expect(customPreset?.filePath).toContain(join("custom", "custom-legacy-prompt.md"))

        expect(await readFile(planPreset!.filePath!, "utf8")).toContain(legacyPlanPrompt)
        expect(await readFile(customPreset!.filePath!, "utf8")).toContain(legacyCustomPrompt)
        expect(await Config.getPromptOverrides(Config.GLOBAL_CONFIG_ID)).toEqual({})
        expect(await Config.getCustomPromptPresets(Config.GLOBAL_CONFIG_ID)).toEqual({})
      } finally {
        await Config.clearPromptOverride(Config.GLOBAL_CONFIG_ID, "plan-mode")
        await Config.removeCustomPromptPreset(Config.GLOBAL_CONFIG_ID, legacyCustomPresetID)
      }
    })
  })

  test("prompt preset routes should expose codexsystem prompts as bundled defaults", async () => {
    await withTempPromptRoot(async (promptRoot) => {
      const app = createServerApp()

      try {
        await Config.setSelectedPromptPresetIDs(Config.GLOBAL_CONFIG_ID, {
          systemPromptPresetID: null,
          planModePromptPresetID: null,
          gitCommitPromptPresetID: null,
          cinemaTextGenerationPromptPresetID: null,
        })

        const listResponse = await app.request("http://localhost/api/prompts")
        const listBody = (await listResponse.json()) as PromptPresetSummaryEnvelope

        expect(listResponse.status).toBe(200)
        expect(listBody.success).toBe(true)
        expect(listBody.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "system-codex",
              label: "codexsystem prompt",
              source: "bundled",
              hasOverride: false,
              root: promptRoot,
              filePath: join(promptRoot, "bundled", "system-codex.md"),
            }),
            expect.objectContaining({
              id: "system-codex-zh-hans",
              label: "codexsystem prompt - 简体中文",
              source: "bundled",
              hasOverride: false,
              root: promptRoot,
              filePath: join(promptRoot, "bundled", "system-codex-zh-hans.md"),
            }),
            expect.objectContaining({
              id: "cinema-text-generation",
              label: "Cinema text generation prompt",
              source: "bundled",
              hasOverride: false,
              root: promptRoot,
              filePath: join(promptRoot, "bundled", "cinema-text-generation.md"),
            }),
          ]),
        )
        expect(await readFile(join(promptRoot, "bundled", "system-codex.md"), "utf8")).toContain("# SYSTEM INSTRUCTIONS")
        const cinemaTextGenerationPrompt = await readFile(join(promptRoot, "bundled", "cinema-text-generation.md"), "utf8")
        expect(cinemaTextGenerationPrompt).toContain(
          "You are helping write text for an AI film project.",
        )
        expect(cinemaTextGenerationPrompt).toContain("You may use simple Markdown")
        expect(cinemaTextGenerationPrompt).toContain("Do not use raw HTML or wrap the response in a code fence.")

        const selectionResponse = await app.request("http://localhost/api/prompts/selection")
        const selectionBody = (await selectionResponse.json()) as PromptPresetSelectionEnvelope

        expect(selectionResponse.status).toBe(200)
        expect(selectionBody.success).toBe(true)
        expect(selectionBody.data).toEqual({
          systemPromptPresetID: "system-codex",
          planModePromptPresetID: "plan-mode",
          gitCommitPromptPresetID: "git-commit-message",
          cinemaTextGenerationPromptPresetID: "cinema-text-generation",
        })
      } finally {
        await Config.setSelectedPromptPresetIDs(Config.GLOBAL_CONFIG_ID, {
          systemPromptPresetID: "system-default",
          planModePromptPresetID: "plan-mode",
          gitCommitPromptPresetID: "git-commit-message",
        })
      }
    })
  })

  test("prompt preset translation should create a new custom prompt without changing assignments", async () => {
    await withTempPromptRoot(async (promptRoot) => {
      const app = createServerApp()
      const testModel = createPromptTranslationTestModel()
      let capturedGenerateInput: Record<string, unknown> | null = null
      const restoreProvider = Provider.setProviderFunctionOverridesForTesting({
        listModels: async () => [toPromptTranslationPublicModel(testModel)],
        getModel: async () => testModel,
        getLanguage: async (model) => model as never,
      })
      const restoreSettings = SettingsUseCase.setRuntimeDependenciesForTesting({
        getGenerateText: async () => async (input: Record<string, unknown>) => {
          capturedGenerateInput = input
          return {
            text: "你是一个精准的编码助手。",
          } as never
        },
      })

      try {
        await Config.setSelectedPromptPresetIDs(Config.GLOBAL_CONFIG_ID, {
          systemPromptPresetID: "system-default",
          planModePromptPresetID: "plan-mode",
          gitCommitPromptPresetID: "git-commit-message",
        })
        await app.request("http://localhost/api/prompts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            label: "System prompt - 简体中文",
            content: "existing translated prompt",
          }),
        })

        const translateResponse = await app.request("http://localhost/api/prompts/translate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourcePresetID: "system-default",
            sourceLabel: "System prompt",
            content: "You are a precise coding assistant.",
            languageID: "zh-Hans",
            model: "test-provider/prompt-translator",
          }),
        })
        const translateBody = (await translateResponse.json()) as PromptPresetDocumentEnvelope

        expect(translateResponse.status).toBe(200)
        expect(translateBody.success).toBe(true)
        expect(translateBody.data).toMatchObject({
          label: "System prompt - 简体中文 2",
          source: "custom",
          content: "你是一个精准的编码助手。",
          root: promptRoot,
        })
        expect(translateBody.data?.filePath).toContain(join("custom", "custom-system-prompt-2.md"))
        expect(capturedGenerateInput).toMatchObject({
          temperature: 0,
          model: testModel,
        })
        const generateInput = capturedGenerateInput as unknown as Record<string, unknown>
        expect(String(generateInput.system)).toContain("Return only the translated prompt.")
        expect(String(generateInput.prompt)).toContain("Target language: Simplified Chinese")
        expect(String(generateInput.prompt)).toContain("You are a precise coding assistant.")

        const selectionResponse = await app.request("http://localhost/api/prompts/selection")
        const selectionBody = (await selectionResponse.json()) as PromptPresetSelectionEnvelope
        expect(selectionBody.data).toEqual({
          systemPromptPresetID: "system-default",
          planModePromptPresetID: "plan-mode",
          gitCommitPromptPresetID: "git-commit-message",
          cinemaTextGenerationPromptPresetID: "cinema-text-generation",
        })
      } finally {
        restoreSettings()
        restoreProvider()
        await Config.setSelectedPromptPresetIDs(Config.GLOBAL_CONFIG_ID, {
          systemPromptPresetID: "system-default",
          planModePromptPresetID: "plan-mode",
          gitCommitPromptPresetID: "git-commit-message",
        })
      }
    })
  })

  test("prompt preset translation should resolve global provider runtime outside an instance context", async () => {
    await withTempPromptRoot(async () => {
      const app = createServerApp()
      const languageModel = {
        id: "deepseek-language-model",
      }
      const capturedFactoryInputs: Array<Record<string, unknown>> = []
      let capturedGenerateInput: Record<string, unknown> | null = null
      const restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
        getModelsDev: async () => ({
          deepseek: {
            id: "deepseek",
            name: "DeepSeek",
            env: ["DEEPSEEK_API_KEY"],
            api: "https://api.deepseek.test/v1",
            npm: "@ai-sdk/openai-compatible",
            models: {
              "deepseek-v4-pro": {
                id: "deepseek-v4-pro",
                name: "DeepSeek V4 Pro",
                family: "deepseek",
                release_date: "2026-01-01",
                attachment: false,
                reasoning: true,
                temperature: true,
                tool_call: true,
                limit: {
                  context: 128000,
                  output: 8192,
                },
                modalities: {
                  input: ["text"],
                  output: ["text"],
                },
                options: {},
                headers: {},
              },
            },
          },
        }) as never,
        getEnvAll: () => ({
          DEEPSEEK_API_KEY: "test-deepseek-key",
        }),
        importPackage: async (pkg: string) => {
          expect(pkg).toBe("@ai-sdk/deepseek")
          return {
            module: {
              createDeepSeek(options: Record<string, unknown>) {
                capturedFactoryInputs.push(options)
                return {
                  languageModel(modelID: string) {
                    return {
                      ...languageModel,
                      modelID,
                    }
                  },
                }
              },
            },
            version: "test-version",
          }
        },
      })
      const restoreSettings = SettingsUseCase.setRuntimeDependenciesForTesting({
        getGenerateText: async () => async (input: Record<string, unknown>) => {
          capturedGenerateInput = input
          return {
            text: "Translated prompt.",
          } as never
        },
      })

      try {
        const translateResponse = await app.request("http://localhost/api/prompts/translate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourcePresetID: "system-default",
            sourceLabel: "System prompt",
            content: "You are a precise coding assistant.",
            languageID: "fr",
            model: "deepseek/deepseek-v4-pro",
          }),
        })
        const translateBody = (await translateResponse.json()) as PromptPresetDocumentEnvelope

        expect(translateResponse.status).toBe(200)
        expect(translateBody.success).toBe(true)
        expect(translateBody.data?.label).toBe("System prompt - French")
        expect(capturedFactoryInputs).toEqual([
          {
            apiKey: "test-deepseek-key",
            baseURL: "https://api.deepseek.test/v1",
            headers: undefined,
          },
        ])
        const generateInput = capturedGenerateInput as unknown as Record<string, unknown>
        expect(generateInput.model).toMatchObject({
          id: "deepseek-language-model",
          modelID: "deepseek-v4-pro",
        })
        expect(capturedGenerateInput).not.toHaveProperty("temperature")
      } finally {
        restoreSettings()
        restoreProvider()
      }
    })
  })

  test("prompt preset translation should reject non-text models and empty model output", async () => {
    await withTempPromptRoot(async () => {
      const app = createServerApp()
      const nonTextModel = createPromptTranslationTestModel({ outputText: false })
      const restoreProvider = Provider.setProviderFunctionOverridesForTesting({
        listModels: async () => [toPromptTranslationPublicModel(nonTextModel)],
        getModel: async () => nonTextModel,
        getLanguage: async (model) => model as never,
      })
      const restoreSettings = SettingsUseCase.setRuntimeDependenciesForTesting({
        getGenerateText: async () => async () => ({ text: "" }) as never,
      })

      try {
        const nonTextResponse = await app.request("http://localhost/api/prompts/translate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceLabel: "System prompt",
            content: "Translate me.",
            languageID: "fr",
            model: "test-provider/prompt-translator",
          }),
        })
        const nonTextBody = (await nonTextResponse.json()) as JsonEnvelope

        expect(nonTextResponse.status).toBe(400)
        expect(nonTextBody.success).toBe(false)
        expect(nonTextBody.error?.code).toBe("MODEL_NOT_TEXT_CAPABLE")

        restoreProvider()
        const textModel = createPromptTranslationTestModel()
        const restoreTextProvider = Provider.setProviderFunctionOverridesForTesting({
          listModels: async () => [toPromptTranslationPublicModel(textModel)],
          getModel: async () => textModel,
          getLanguage: async (model) => model as never,
        })

        try {
          const emptyOutputResponse = await app.request("http://localhost/api/prompts/translate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sourceLabel: "System prompt",
              content: "Translate me.",
              languageID: "fr",
              model: "test-provider/prompt-translator",
            }),
          })
          const emptyOutputBody = (await emptyOutputResponse.json()) as JsonEnvelope

          expect(emptyOutputResponse.status).toBe(502)
          expect(emptyOutputBody.success).toBe(false)
          expect(emptyOutputBody.error?.code).toBe("PROMPT_TRANSLATION_EMPTY")
        } finally {
          restoreTextProvider()
        }
      } finally {
        restoreSettings()
        restoreProvider()
      }
    })
  })

  test("prompt preset routes should keep bundled presets read-only and manage custom presets", async () => {
    await withTempPromptRoot(async (promptRoot) => {
    const app = createServerApp()
    const customPlanPrompt = "Custom plan-mode prompt for runtime verification."
    const customSystemPrompt = "Custom system prompt selected from the preset library."
    let customPresetID: string | null = null

    try {
      await Config.clearPromptOverride(Config.GLOBAL_CONFIG_ID, "plan-mode")
      await Config.clearPromptOverride(Config.GLOBAL_CONFIG_ID, "provider-gpt")
      await Config.setSelectedPromptPresetIDs(Config.GLOBAL_CONFIG_ID, {
        systemPromptPresetID: "system-default",
        planModePromptPresetID: "plan-mode",
        gitCommitPromptPresetID: "git-commit-message",
      })

      const listResponse = await app.request("http://localhost/api/prompts")
      const listBody = (await listResponse.json()) as PromptPresetSummaryEnvelope

      expect(listResponse.status).toBe(200)
      expect(listBody.success).toBe(true)
      expect(listBody.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "system-default",
            source: "bundled",
            editable: false,
            hasOverride: false,
            root: promptRoot,
            filePath: join(promptRoot, "bundled", "system-default.md"),
          }),
          expect.objectContaining({
            id: "plan-mode",
            source: "bundled",
            editable: false,
            hasOverride: false,
          }),
          expect.objectContaining({
            id: "git-commit-message",
            source: "bundled",
            editable: false,
            hasOverride: false,
          }),
          expect.objectContaining({
            id: "provider-gpt",
            source: "bundled",
            editable: false,
            hasOverride: false,
          }),
        ]),
      )
      const systemPreset = listBody.data?.find((preset) => preset.id === "system-default")
      expect(systemPreset?.sourcePath).toBe(systemPreset?.filePath)
      expect(await readFile(systemPreset!.filePath!, "utf8")).toContain("id: system-default")

      const selectionResponse = await app.request("http://localhost/api/prompts/selection")
      const selectionBody = (await selectionResponse.json()) as PromptPresetSelectionEnvelope

      expect(selectionResponse.status).toBe(200)
      expect(selectionBody.success).toBe(true)
      expect(selectionBody.data).toEqual({
        systemPromptPresetID: "system-default",
        planModePromptPresetID: "plan-mode",
        gitCommitPromptPresetID: "git-commit-message",
        cinemaTextGenerationPromptPresetID: "cinema-text-generation",
      })

      const createResponse = await app.request("http://localhost/api/prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "Focus preset",
          content: customSystemPrompt,
        }),
      })
      const createBody = (await createResponse.json()) as PromptPresetDocumentEnvelope

      expect(createResponse.status).toBe(200)
      expect(createBody.success).toBe(true)
      expect(createBody.data).toMatchObject({
        label: "Focus preset",
        source: "custom",
        editable: true,
        content: customSystemPrompt,
        root: promptRoot,
      })
      expect(createBody.data?.filePath).toContain(join("custom", "custom-focus-preset.md"))
      customPresetID = createBody.data?.id ?? null
      expect(customPresetID).toBeTruthy()
      const customPresetIDValue = customPresetID!

      const updateSelectionResponse = await app.request("http://localhost/api/prompts/selection", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemPromptPresetID: customPresetIDValue,
          planModePromptPresetID: "plan-mode",
          gitCommitPromptPresetID: customPresetIDValue,
          cinemaTextGenerationPromptPresetID: customPresetIDValue,
        }),
      })
      const updateSelectionBody = (await updateSelectionResponse.json()) as PromptPresetSelectionEnvelope

      expect(updateSelectionResponse.status).toBe(200)
      expect(updateSelectionBody.success).toBe(true)
      expect(updateSelectionBody.data).toEqual({
        systemPromptPresetID: customPresetIDValue,
        planModePromptPresetID: "plan-mode",
        gitCommitPromptPresetID: customPresetIDValue,
        cinemaTextGenerationPromptPresetID: customPresetIDValue,
      })

      const runtimeWithCustomSystemPrompt = await SystemPrompt.defaultPrompt()
      expect(runtimeWithCustomSystemPrompt.some((section) => section?.includes(customSystemPrompt) === true)).toBe(true)

      const readResponse = await app.request(`http://localhost/api/prompts/${encodeURIComponent(customPresetIDValue)}`)
      const readBody = (await readResponse.json()) as PromptPresetDocumentEnvelope

      expect(readResponse.status).toBe(200)
      expect(readBody.success).toBe(true)
      expect(readBody.data?.content).toBe(customSystemPrompt)

      const updateResponse = await app.request("http://localhost/api/prompts/plan-mode", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: customPlanPrompt,
        }),
      })
      const updateBody = (await updateResponse.json()) as JsonEnvelope

      expect(updateResponse.status).toBe(409)
      expect(updateBody.success).toBe(false)
      expect(updateBody.error?.code).toBe("BUNDLED_PROMPT_READ_ONLY")

      const updateCustomPresetResponse = await app.request(
        `http://localhost/api/prompts/${encodeURIComponent(customPresetIDValue)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            label: "Focus preset v2",
            content: `${customSystemPrompt}\nupdated`,
          }),
        },
      )
      const updateCustomPresetBody = (await updateCustomPresetResponse.json()) as PromptPresetDocumentEnvelope

      expect(updateCustomPresetResponse.status).toBe(200)
      expect(updateCustomPresetBody.success).toBe(true)
      expect(updateCustomPresetBody.data).toMatchObject({
        id: customPresetIDValue,
        label: "Focus preset v2",
        source: "custom",
        content: `${customSystemPrompt}\nupdated`,
      })

      const runtimePrompt = await SystemPrompt.defaultPrompt({
        agent: {
          name: "plan",
        },
      })
      expect(runtimePrompt.some((section) => section?.includes(customPlanPrompt) === true)).toBe(false)
      expect(runtimePrompt.some((section) => section?.includes(`${customSystemPrompt}\nupdated`) === true)).toBe(true)
      const blankOverrideResponse = await app.request("http://localhost/api/prompts/provider-gpt", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "",
        }),
      })
      const blankOverrideBody = (await blankOverrideResponse.json()) as JsonEnvelope

      expect(blankOverrideResponse.status).toBe(409)
      expect(blankOverrideBody.success).toBe(false)
      expect(blankOverrideBody.error?.code).toBe("BUNDLED_PROMPT_READ_ONLY")

      const resetResponse = await app.request("http://localhost/api/prompts/plan-mode", {
        method: "DELETE",
      })
      const resetBody = (await resetResponse.json()) as PromptPresetDocumentEnvelope

      expect(resetResponse.status).toBe(200)
      expect(resetBody.success).toBe(true)
      expect(resetBody.data?.hasOverride).toBe(false)
      expect(resetBody.data?.content).toContain("# Plan Mode")

      const runtimeAfterReset = await SystemPrompt.defaultPrompt({
        agent: {
          name: "plan",
        },
      })
      expect(runtimeAfterReset.some((section) => section?.includes(customPlanPrompt) === true)).toBe(false)

      const deleteCustomResponse = await app.request(
        `http://localhost/api/prompts/${encodeURIComponent(customPresetIDValue)}/custom`,
        {
          method: "DELETE",
        },
      )
      const deleteCustomBody = (await deleteCustomResponse.json()) as PromptPresetSelectionEnvelope

      expect(deleteCustomResponse.status).toBe(200)
      expect(deleteCustomBody.success).toBe(true)
      expect(deleteCustomBody.data).toEqual({
        systemPromptPresetID: "system-codex",
        planModePromptPresetID: "plan-mode",
        gitCommitPromptPresetID: "git-commit-message",
        cinemaTextGenerationPromptPresetID: "cinema-text-generation",
      })

      const runtimeAfterDelete = await SystemPrompt.defaultPrompt()
      expect(runtimeAfterDelete.some((section) => section?.includes(customSystemPrompt) === true)).toBe(false)

      const missingResponse = await app.request("http://localhost/api/prompts/not-a-preset")
      const missingBody = (await missingResponse.json()) as JsonEnvelope

      expect(missingResponse.status).toBe(404)
      expect(missingBody.success).toBe(false)
      expect(missingBody.error?.code).toBe("PROMPT_PRESET_NOT_FOUND")
    } finally {
      await Config.clearPromptOverride(Config.GLOBAL_CONFIG_ID, "plan-mode")
      await Config.clearPromptOverride(Config.GLOBAL_CONFIG_ID, "provider-gpt")
      if (customPresetID) {
        await Config.removeCustomPromptPreset(Config.GLOBAL_CONFIG_ID, customPresetID)
      }
      await Config.setSelectedPromptPresetIDs(Config.GLOBAL_CONFIG_ID, {
        systemPromptPresetID: "system-default",
        planModePromptPresetID: "plan-mode",
        gitCommitPromptPresetID: "git-commit-message",
      })
    }
    })
  })

  test("POST /api/projects should track extra git worktrees in sandboxes", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-worktree-root-")
    const extraWorktree = await createTempPath("anybox-worktree")

    try {
      await createGitRepo(repositoryRoot, "shared-repo")
      await $`git worktree add ${extraWorktree} -b test-worktree`.cwd(repositoryRoot).quiet()

      const rootResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const rootBody = (await rootResponse.json()) as ProjectResponseEnvelope

      const extraResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: extraWorktree }),
      })
      const extraBody = (await extraResponse.json()) as ProjectResponseEnvelope

      expect(rootResponse.status).toBe(201)
      expect(extraResponse.status).toBe(201)
      expect(rootBody.data?.id).toBeString()
      expect(extraBody.data?.id).toBe(rootBody.data?.id)
      expect(rootBody.data?.worktree).toBe(repositoryRoot)
      expect(extraBody.data?.worktree).toBe(repositoryRoot)
      expect(rootBody.data?.repositoryRoot).toBe(repositoryRoot)
      expect(extraBody.data?.repositoryRoot).toBe(repositoryRoot)
      expect(extraBody.data?.workspaceRoots).toContain(repositoryRoot)
      expect(extraBody.data?.workspaceRoots).toContain(extraWorktree)
      expect(extraBody.data?.sandboxes).toContain(extraWorktree)
      expect(extraBody.data?.sandboxes).not.toContain(repositoryRoot)

      const worktreesResponse = await app.request(`http://localhost/api/projects/${rootBody.data?.id}/worktrees`)
      const worktreesBody = (await worktreesResponse.json()) as WorktreesResponseEnvelope

      expect(worktreesResponse.status).toBe(200)
      expect(worktreesBody.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectID: rootBody.data?.id,
            path: repositoryRoot,
            kind: "primary",
            managed: false,
            cleanupPolicy: "manual",
          }),
          expect.objectContaining({
            projectID: rootBody.data?.id,
            path: extraWorktree,
            kind: "external",
            managed: false,
            cleanupPolicy: "manual",
          }),
        ]),
      )

      const listResponse = await app.request("http://localhost/api/projects")
      const listBody = (await listResponse.json()) as ProjectsResponseEnvelope

      expect(listResponse.status).toBe(200)
      expect(
        listBody.data?.some(
          (project) =>
            project.id === rootBody.data?.id &&
            project.worktree === repositoryRoot &&
            project.repositoryRoot === repositoryRoot &&
            project.workspaceRoots.includes(extraWorktree) &&
            project.sandboxes.includes(extraWorktree),
        ),
      ).toBe(true)
    } finally {
      await rm(extraWorktree, { recursive: true, force: true })
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("project worktree lifecycle should create, refresh, and delete managed worktrees safely", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-managed-worktree-root-")

    try {
      await createGitRepo(repositoryRoot, "managed-worktree")
      await $`git branch ${"功能开发"}`.cwd(repositoryRoot).quiet()

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()
      if (!projectID) throw new Error("Expected created project id")

      const initialWorktreesResponse = await app.request(`http://localhost/api/projects/${projectID}/worktrees`)
      const initialWorktreesBody = (await initialWorktreesResponse.json()) as WorktreesResponseEnvelope
      const primary = initialWorktreesBody.data?.find((record) => record.kind === "primary")

      expect(primary?.id).toBeString()

      const primaryDeleteResponse = await app.request(
        `http://localhost/api/projects/${projectID}/worktrees/${primary?.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      )
      const primaryDeleteBody = (await primaryDeleteResponse.json()) as JsonEnvelope

      expect(primaryDeleteResponse.status).toBe(403)
      expect(primaryDeleteBody.error?.code).toBe("WORKTREE_NOT_MANAGED")

      const createResponse = await app.request(`http://localhost/api/projects/${projectID}/worktrees`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchName: "功能开发",
          cleanupPolicy: "manual",
        }),
      })
      const createBody = (await createResponse.json()) as PreparedWorktreeResponseEnvelope
      const created = createBody.data?.worktree

      expect(createResponse.status).toBe(201)
      expect(created).toMatchObject({
        projectID,
        kind: "managed",
        managed: true,
        branch: "功能开发",
        cleanupPolicy: "manual",
        status: "active",
      })
      expect(created?.path).toBeString()
      expect(basename(created!.path)).toBe(basename(repositoryRoot))
      expect((await stat(created!.path)).isDirectory()).toBe(true)

      await writeFile(join(created!.path, "scratch.txt"), "dirty\n")

      const refreshResponse = await app.request(
        `http://localhost/api/projects/${projectID}/worktrees/${created!.id}/refresh`,
        {
          method: "POST",
        },
      )
      const refreshBody = (await refreshResponse.json()) as WorktreeResponseEnvelope

      expect(refreshResponse.status).toBe(200)
      expect(refreshBody.data?.status).toBe("dirty")

      const dirtyDeleteResponse = await app.request(
        `http://localhost/api/projects/${projectID}/worktrees/${created!.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      )
      const dirtyDeleteBody = (await dirtyDeleteResponse.json()) as JsonEnvelope

      expect(dirtyDeleteResponse.status).toBe(409)
      expect(dirtyDeleteBody.error?.code).toBe("WORKTREE_DIRTY")

      const forceDeleteResponse = await app.request(
        `http://localhost/api/projects/${projectID}/worktrees/${created!.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force: true }),
        },
      )
      const forceDeleteBody = (await forceDeleteResponse.json()) as WorktreeResponseEnvelope

      expect(forceDeleteResponse.status).toBe(200)
      expect(forceDeleteBody.data).toMatchObject({
        id: created!.id,
        status: "removed",
      })
      await expect(stat(created!.path)).rejects.toThrow()

      const listResponse = await app.request(`http://localhost/api/projects/${projectID}/worktrees`)
      const listBody = (await listResponse.json()) as WorktreesResponseEnvelope

      expect(listResponse.status).toBe(200)
      expect(listBody.data?.map((record) => record.id)).not.toContain(created!.id)
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("project worktree lifecycle should create managed worktrees before the first commit", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-managed-unborn-worktree-root-")
    let createdPath: string | undefined

    try {
      await mkdir(repositoryRoot, { recursive: true })
      await writeFile(join(repositoryRoot, "README.md"), "# unborn worktree\n")
      await $`git init`.cwd(repositoryRoot).quiet()
      await $`git config user.email test@example.com`.cwd(repositoryRoot).quiet()
      await $`git config user.name anybox-test`.cwd(repositoryRoot).quiet()

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()
      if (!projectID) throw new Error("Expected created project id")

      const createResponse = await app.request(`http://localhost/api/projects/${projectID}/worktrees`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchName: "unborn-worktree",
          cleanupPolicy: "manual",
        }),
      })
      const createBody = (await createResponse.json()) as PreparedWorktreeResponseEnvelope
      const created = createBody.data?.worktree
      createdPath = created?.path

      expect(createResponse.status).toBe(201)
      expect(created).toMatchObject({
        projectID,
        kind: "managed",
        managed: true,
        branch: "unborn-worktree",
        baseRef: null,
        baseSha: null,
        cleanupPolicy: "manual",
        status: "active",
      })
      expect(created?.path).toBeString()
      expect((await stat(created!.path)).isDirectory()).toBe(true)

      const activeBranch = (await $`git symbolic-ref --quiet --short HEAD`.cwd(created!.path).text()).trim()
      const headResult = await $`git rev-parse --verify HEAD`.cwd(created!.path).quiet().nothrow()

      expect(activeBranch).toBe("unborn-worktree")
      expect(headResult.exitCode).not.toBe(0)

      const deleteResponse = await app.request(
        `http://localhost/api/projects/${projectID}/worktrees/${created!.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force: true }),
        },
      )

      expect(deleteResponse.status).toBe(200)
    } finally {
      if (createdPath) {
        await rm(createdPath, { recursive: true, force: true })
      }
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("POST /api/projects should keep different git repos as different projects", async () => {
    const app = createServerApp()
    const firstDirectory = await createTempDirectory("anybox-project-a-")
    const secondDirectory = await createTempDirectory("anybox-project-b-")

    try {
      await createGitRepo(firstDirectory, "repo-a")
      await createGitRepo(secondDirectory, "repo-b")

      const firstResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: firstDirectory }),
      })
      const firstBody = (await firstResponse.json()) as ProjectResponseEnvelope

      const secondResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: secondDirectory }),
      })
      const secondBody = (await secondResponse.json()) as ProjectResponseEnvelope

      expect(firstResponse.status).toBe(201)
      expect(secondResponse.status).toBe(201)
      expect(firstBody.data?.id).toBeString()
      expect(secondBody.data?.id).toBeString()
      expect(firstBody.data?.id).not.toBe(secondBody.data?.id)
      expect(firstBody.data?.worktree).toBe(firstDirectory)
      expect(secondBody.data?.worktree).toBe(secondDirectory)
    } finally {
      await rm(firstDirectory, { recursive: true, force: true })
      await rm(secondDirectory, { recursive: true, force: true })
    }
  })

  test("project git routes should report capabilities, commit staged changes, and create branches", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-git-project-")

    try {
      await createGitRepo(repositoryRoot, "git-project")
      await writeFile(join(repositoryRoot, "README.md"), "# git-project\nupdated\n")
      await $`git add README.md`.cwd(repositoryRoot).quiet()

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()

      const capabilitiesResponse = await app.request(
        `http://localhost/api/projects/${projectID}/git/capabilities?directory=${encodeURIComponent(repositoryRoot)}`,
      )
      const capabilitiesBody = (await capabilitiesResponse.json()) as GitCapabilitiesEnvelope

      expect(capabilitiesResponse.status).toBe(200)
      expect(capabilitiesBody.data).toMatchObject({
        directory: repositoryRoot,
        root: repositoryRoot,
        isGitRepo: true,
        canCommit: {
          enabled: true,
        },
        canStageAllCommit: {
          enabled: true,
        },
        canPush: {
          enabled: false,
        },
        canCreateBranch: {
          enabled: true,
        },
        canCreatePullRequest: {
          enabled: false,
        },
      })

      const commitResponse = await app.request(`http://localhost/api/projects/${projectID}/git/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: repositoryRoot,
          message: "chore: update readme",
        }),
      })
      const commitBody = (await commitResponse.json()) as GitActionEnvelope

      expect(commitResponse.status).toBe(200)
      expect(commitBody.data?.root).toBe(repositoryRoot)
      expect(commitBody.data?.summary).toContain("Committed")

      const postCommitCapabilitiesResponse = await app.request(
        `http://localhost/api/projects/${projectID}/git/capabilities?directory=${encodeURIComponent(repositoryRoot)}`,
      )
      const postCommitCapabilitiesBody = (await postCommitCapabilitiesResponse.json()) as GitCapabilitiesEnvelope

      expect(postCommitCapabilitiesResponse.status).toBe(200)
      expect(postCommitCapabilitiesBody.data?.canCommit.enabled).toBe(false)

      const branchResponse = await app.request(`http://localhost/api/projects/${projectID}/git/branches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: repositoryRoot,
          name: "feature/git-menu",
        }),
      })
      const branchBody = (await branchResponse.json()) as GitActionEnvelope

      expect(branchResponse.status).toBe(200)
      expect(branchBody.data?.branch).toBe("feature/git-menu")
      expect(branchBody.data?.summary).toContain("feature/git-menu")

      const branchCapabilitiesResponse = await app.request(
        `http://localhost/api/projects/${projectID}/git/capabilities?directory=${encodeURIComponent(repositoryRoot)}`,
      )
      const branchCapabilitiesBody = (await branchCapabilitiesResponse.json()) as GitCapabilitiesEnvelope

      expect(branchCapabilitiesResponse.status).toBe(200)
      expect(branchCapabilitiesBody.data?.branch).toBe("feature/git-menu")
      expect(branchCapabilitiesBody.data?.canPush.enabled).toBe(false)
      expect(branchCapabilitiesBody.data?.canCreatePullRequest.enabled).toBe(false)
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("project git routes should list branches and checkout an existing branch", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-git-branch-list-project-")

    try {
      await createGitRepo(repositoryRoot, "git-branch-list-project")

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()

      const capabilitiesResponse = await app.request(
        `http://localhost/api/projects/${projectID}/git/capabilities?directory=${encodeURIComponent(repositoryRoot)}`,
      )
      const capabilitiesBody = (await capabilitiesResponse.json()) as GitCapabilitiesEnvelope
      const baseBranch = capabilitiesBody.data?.branch

      expect(capabilitiesResponse.status).toBe(200)
      expect(baseBranch).toBeString()

      await $`git checkout -b feature/branch-switcher`.cwd(repositoryRoot).quiet()
      await $`git checkout ${baseBranch!}`.cwd(repositoryRoot).quiet()

      const branchesResponse = await app.request(
        `http://localhost/api/projects/${projectID}/git/branches?directory=${encodeURIComponent(repositoryRoot)}`,
      )
      const branchesBody = (await branchesResponse.json()) as GitBranchesEnvelope

      expect(branchesResponse.status).toBe(200)
      expect(branchesBody.data).toEqual(
        expect.arrayContaining([
          {
            name: baseBranch!,
            kind: "local",
            current: true,
          },
          {
            name: "feature/branch-switcher",
            kind: "local",
            current: false,
          },
        ]),
      )

      const checkoutResponse = await app.request(`http://localhost/api/projects/${projectID}/git/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: repositoryRoot,
          name: "feature/branch-switcher",
        }),
      })
      const checkoutBody = (await checkoutResponse.json()) as GitActionEnvelope

      expect(checkoutResponse.status).toBe(200)
      expect(checkoutBody.data?.branch).toBe("feature/branch-switcher")
      expect(checkoutBody.data?.summary).toContain("feature/branch-switcher")

      const postCheckoutBranchesResponse = await app.request(
        `http://localhost/api/projects/${projectID}/git/branches?directory=${encodeURIComponent(repositoryRoot)}`,
      )
      const postCheckoutBranchesBody = (await postCheckoutBranchesResponse.json()) as GitBranchesEnvelope

      expect(postCheckoutBranchesResponse.status).toBe(200)
      expect(postCheckoutBranchesBody.data).toEqual(
        expect.arrayContaining([
          {
            name: baseBranch!,
            kind: "local",
            current: false,
          },
          {
            name: "feature/branch-switcher",
            kind: "local",
            current: true,
          },
        ]),
      )
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("project git branch list should return a client error outside git repositories", async () => {
    const app = createServerApp()
    const directory = await createTempDirectory("anybox-non-git-branch-list-project-")

    try {
      await writeFile(join(directory, "README.md"), "# plain project\n")

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()

      const branchesResponse = await app.request(
        `http://localhost/api/projects/${projectID}/git/branches?directory=${encodeURIComponent(directory)}`,
      )
      const branchesBody = (await branchesResponse.json()) as GitBranchesEnvelope

      expect(branchesResponse.status).toBe(400)
      expect(branchesBody.success).toBe(false)
      expect(branchesBody.error?.code).toBe("GIT_OPERATION_FAILED")
      expect(branchesBody.error?.message).toBe("The current workspace is not a Git repository.")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("project git capabilities should disable branch creation before the first commit", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-git-unborn-project-")

    try {
      await mkdir(repositoryRoot, { recursive: true })
      await writeFile(join(repositoryRoot, "README.md"), "# unborn\n")
      await $`git init`.cwd(repositoryRoot).quiet()
      await $`git config user.email test@example.com`.cwd(repositoryRoot).quiet()
      await $`git config user.name anybox-test`.cwd(repositoryRoot).quiet()

      const initialBranch = (await $`git symbolic-ref --quiet --short HEAD`.cwd(repositoryRoot).text()).trim()

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()

      const capabilitiesResponse = await app.request(
        `http://localhost/api/projects/${projectID}/git/capabilities?directory=${encodeURIComponent(repositoryRoot)}`,
      )
      const capabilitiesBody = (await capabilitiesResponse.json()) as GitCapabilitiesEnvelope

      expect(capabilitiesResponse.status).toBe(200)
      expect(capabilitiesBody.data?.branch).toBe(initialBranch)
      expect(capabilitiesBody.data?.canCreateBranch).toEqual({
        enabled: false,
        reason: "Create the first commit before creating a branch.",
      })
      expect(capabilitiesBody.data?.canPush).toEqual({
        enabled: false,
        reason: "Create the first commit before pushing this branch.",
      })
      expect(capabilitiesBody.data?.canCreatePullRequest).toEqual({
        enabled: false,
        reason: "Create the first commit before opening a pull request.",
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("project git routes should reject directories outside the requested project", async () => {
    const app = createServerApp()
    const repositoryRootA = await createTempDirectory("anybox-git-project-boundary-a-")
    const repositoryRootB = await createTempDirectory("anybox-git-project-boundary-b-")

    try {
      await createGitRepo(repositoryRootA, "git-project-boundary-a")
      await createGitRepo(repositoryRootB, "git-project-boundary-b")

      const projectResponseA = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRootA }),
      })
      const projectBodyA = (await projectResponseA.json()) as ProjectResponseEnvelope
      const projectIDA = projectBodyA.data?.id

      const projectResponseB = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRootB }),
      })
      const projectBodyB = (await projectResponseB.json()) as ProjectResponseEnvelope
      const projectIDB = projectBodyB.data?.id

      expect(projectResponseA.status).toBe(201)
      expect(projectResponseB.status).toBe(201)
      expect(projectIDA).toBeString()
      expect(projectIDB).toBeString()
      expect(projectIDA).not.toBe(projectIDB)

      const capabilitiesResponse = await app.request(
        `http://localhost/api/projects/${projectIDA}/git/capabilities?directory=${encodeURIComponent(repositoryRootB)}`,
      )
      const capabilitiesBody = (await capabilitiesResponse.json()) as GitCapabilitiesEnvelope

      expect(capabilitiesResponse.status).toBe(400)
      expect(capabilitiesBody.success).toBe(false)
      expect(capabilitiesBody.error?.code).toBe("DIRECTORY_NOT_IN_PROJECT")
    } finally {
      await rm(repositoryRootA, { recursive: true, force: true })
      await rm(repositoryRootB, { recursive: true, force: true })
    }
  })

  test("project git routes should reject project-local links that resolve to an external repo", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-git-project-link-root-")
    const externalRepositoryRoot = await createTempDirectory("anybox-git-project-link-external-")
    const linkedDirectory = join(repositoryRoot, "external-link")

    try {
      await createGitRepo(repositoryRoot, "git-project-link-root")
      await createGitRepo(externalRepositoryRoot, "git-project-link-external")
      await createDirectoryLink(linkedDirectory, externalRepositoryRoot)

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()

      const capabilitiesResponse = await app.request(
        `http://localhost/api/projects/${projectID}/git/capabilities?directory=${encodeURIComponent(linkedDirectory)}`,
      )
      const capabilitiesBody = (await capabilitiesResponse.json()) as GitCapabilitiesEnvelope

      expect(capabilitiesResponse.status).toBe(400)
      expect(capabilitiesBody.success).toBe(false)
      expect(capabilitiesBody.error?.code).toBe("DIRECTORY_NOT_IN_PROJECT")

      const branchResponse = await app.request(`http://localhost/api/projects/${projectID}/git/branches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: linkedDirectory,
          name: "feature/should-not-create",
        }),
      })
      const branchBody = (await branchResponse.json()) as GitActionEnvelope

      expect(branchResponse.status).toBe(400)
      expect(branchBody.success).toBe(false)
      expect(branchBody.error?.code).toBe("DIRECTORY_NOT_IN_PROJECT")
    } finally {
      await removeDirectoryLink(linkedDirectory)
      await rm(repositoryRoot, { recursive: true, force: true })
      await rm(externalRepositoryRoot, { recursive: true, force: true })
    }
  })

  test("project git routes should only commit staged changes", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-git-staged-commit-project-")

    try {
      await createGitRepo(repositoryRoot, "git-staged-commit-project")
      await writeFile(join(repositoryRoot, "staged.txt"), "staged\n")
      await writeFile(join(repositoryRoot, "unstaged.txt"), "unstaged\n")
      await $`git add staged.txt`.cwd(repositoryRoot).quiet()

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()

      const capabilitiesResponse = await app.request(
        `http://localhost/api/projects/${projectID}/git/capabilities?directory=${encodeURIComponent(repositoryRoot)}`,
      )
      const capabilitiesBody = (await capabilitiesResponse.json()) as GitCapabilitiesEnvelope

      expect(capabilitiesResponse.status).toBe(200)
      expect(capabilitiesBody.data?.canCommit).toEqual({
        enabled: true,
      })
      expect(capabilitiesBody.data?.canStageAllCommit).toEqual({
        enabled: true,
      })

      const commitResponse = await app.request(`http://localhost/api/projects/${projectID}/git/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: repositoryRoot,
          message: "chore: commit staged only",
        }),
      })
      const commitBody = (await commitResponse.json()) as GitActionEnvelope

      expect(commitResponse.status).toBe(200)
      expect(commitBody.data?.summary).toContain("Committed")

      const committedFiles = await $`git show --name-only --format= HEAD`.cwd(repositoryRoot).text()
      expect(committedFiles).toContain("staged.txt")
      expect(committedFiles).not.toContain("unstaged.txt")

      const statusOutput = await $`git status --porcelain`.cwd(repositoryRoot).text()
      expect(statusOutput).toContain("?? unstaged.txt")

      const postCommitCapabilitiesResponse = await app.request(
        `http://localhost/api/projects/${projectID}/git/capabilities?directory=${encodeURIComponent(repositoryRoot)}`,
      )
      const postCommitCapabilitiesBody = (await postCommitCapabilitiesResponse.json()) as GitCapabilitiesEnvelope

      expect(postCommitCapabilitiesResponse.status).toBe(200)
      expect(postCommitCapabilitiesBody.data?.canCommit).toEqual({
        enabled: false,
        reason: "Stage changes before committing.",
      })
      expect(postCommitCapabilitiesBody.data?.canStageAllCommit).toEqual({
        enabled: true,
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("project git routes should stage all changes before committing when requested", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-git-stage-all-project-")

    try {
      await createGitRepo(repositoryRoot, "git-stage-all-project")
      await writeFile(join(repositoryRoot, "stage-all.txt"), "stage-all\n")

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()

      const capabilitiesResponse = await app.request(
        `http://localhost/api/projects/${projectID}/git/capabilities?directory=${encodeURIComponent(repositoryRoot)}`,
      )
      const capabilitiesBody = (await capabilitiesResponse.json()) as GitCapabilitiesEnvelope

      expect(capabilitiesResponse.status).toBe(200)
      expect(capabilitiesBody.data?.canCommit).toEqual({
        enabled: false,
        reason: "Stage changes before committing.",
      })
      expect(capabilitiesBody.data?.canStageAllCommit).toEqual({
        enabled: true,
      })

      const commitResponse = await app.request(`http://localhost/api/projects/${projectID}/git/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: repositoryRoot,
          message: "chore: stage all and commit",
          stageAll: true,
        }),
      })
      const commitBody = (await commitResponse.json()) as GitActionEnvelope

      expect(commitResponse.status).toBe(200)
      expect(commitBody.data?.summary).toContain("Committed")

      const committedFiles = await $`git show --name-only --format= HEAD`.cwd(repositoryRoot).text()
      expect(committedFiles).toContain("stage-all.txt")
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("project git commit message route should generate from the selected change scope", async () => {
    await withTempPromptRoot(async () => {
      const app = createServerApp()
      const repositoryRoot = await createTempDirectory("anybox-git-commit-message-project-")
      const testModel = createPromptTranslationTestModel()
      const customCommitPrompt = "Only output a surgical commit subject."
      const capturedGenerateInputs: Record<string, unknown>[] = []
      let activeProjectID = ""
      const restoreProvider = Provider.setProviderFunctionOverridesForTesting({
        listModels: async () => [toPromptTranslationPublicModel(testModel)],
        getSelection: async () => ({
          small_model: "test-provider/prompt-translator",
        }),
        getModel: async () => testModel,
        getLanguage: async (model) => {
          expect(Instance.project.id).toBe(activeProjectID)
          return model as never
        },
      })
      const restoreCommitMessage = GitCommitMessage.setRuntimeDependenciesForTesting({
        getGenerateText: async () => async (input: Record<string, unknown>) => {
          capturedGenerateInputs.push(input)
          return {
            text: "\"feat: add generated commit messages\"\n\nBody should be ignored.",
          } as never
        },
      })

      try {
        const customCommitPromptPreset = await PromptPresets.createPromptPreset({
          label: "Commit subject prompt",
          content: customCommitPrompt,
        }, Config.GLOBAL_CONFIG_ID)
        await PromptPresets.updatePromptPresetSelection({
          systemPromptPresetID: "system-codex",
          planModePromptPresetID: "plan-mode",
          gitCommitPromptPresetID: customCommitPromptPreset.id,
          cinemaTextGenerationPromptPresetID: "cinema-text-generation",
        }, Config.GLOBAL_CONFIG_ID)

        await createGitRepo(repositoryRoot, "git-commit-message-project")
        await writeFile(join(repositoryRoot, "staged.txt"), "staged\n")
        await writeFile(join(repositoryRoot, "unstaged.txt"), "unstaged\n")
        await $`git add staged.txt`.cwd(repositoryRoot).quiet()

        const projectResponse = await app.request("http://localhost/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ directory: repositoryRoot }),
        })
        const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
        const projectID = projectBody.data?.id

        expect(projectResponse.status).toBe(201)
        expect(projectID).toBeString()
        if (!projectID) throw new Error("Expected a project ID")
        activeProjectID = projectID

        const stagedResponse = await app.request(`http://localhost/api/projects/${projectID}/git/commit-message`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            directory: repositoryRoot,
          }),
        })
        const stagedBody = (await stagedResponse.json()) as GitCommitMessageEnvelope

        expect(stagedResponse.status).toBe(200)
        expect(stagedBody.data?.message).toBe("feat: add generated commit messages")
        expect(capturedGenerateInputs[0]?.system).toBe(customCommitPrompt)
        expect(String(capturedGenerateInputs[0]?.prompt)).toContain("staged.txt")
        expect(String(capturedGenerateInputs[0]?.prompt)).not.toContain("unstaged.txt")

        const stageAllResponse = await app.request(`http://localhost/api/projects/${projectID}/git/commit-message`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            directory: repositoryRoot,
            stageAll: true,
          }),
        })
        const stageAllBody = (await stageAllResponse.json()) as GitCommitMessageEnvelope

        expect(stageAllResponse.status).toBe(200)
        expect(stageAllBody.data?.message).toBe("feat: add generated commit messages")
        expect(capturedGenerateInputs[1]?.system).toBe(customCommitPrompt)
        expect(String(capturedGenerateInputs[1]?.prompt)).toContain("staged.txt")
        expect(String(capturedGenerateInputs[1]?.prompt)).toContain("unstaged.txt")
        expect(capturedGenerateInputs[1]).toMatchObject({
          temperature: 0,
          model: testModel,
        })
      } finally {
        await Config.setSelectedPromptPresetIDs(Config.GLOBAL_CONFIG_ID, {
          systemPromptPresetID: "system-codex",
          planModePromptPresetID: "plan-mode",
          gitCommitPromptPresetID: "git-commit-message",
        })
        restoreCommitMessage()
        restoreProvider()
        await rm(repositoryRoot, { recursive: true, force: true })
      }
    })
  })

  test("project git commit message route should reject when the selected scope has no changes", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-git-empty-commit-message-project-")

    try {
      await createGitRepo(repositoryRoot, "git-empty-commit-message-project")

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()

      const commitMessageResponse = await app.request(`http://localhost/api/projects/${projectID}/git/commit-message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: repositoryRoot,
        }),
      })
      const commitMessageBody = (await commitMessageResponse.json()) as JsonEnvelope

      expect(commitMessageResponse.status).toBe(400)
      expect(commitMessageBody.success).toBe(false)
      expect(commitMessageBody.error?.code).toBe("GIT_OPERATION_FAILED")
      expect(commitMessageBody.error?.message).toBe("There are no staged changes to summarize.")
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  test("project git capabilities should enable push for a tracked branch with outgoing commits", async () => {
    const app = createServerApp()
    const repositoryRoot = await createTempDirectory("anybox-git-push-project-")
    const remoteRoot = await createTempDirectory("anybox-git-push-remote-")

    try {
      await createGitRepo(repositoryRoot, "git-push-project")
      await createBareGitRemote(remoteRoot)
      await attachTrackedRemote(repositoryRoot, "main", remoteRoot)
      await writeFile(join(repositoryRoot, "README.md"), "# git-push-project\nnext\n")
      await $`git add README.md`.cwd(repositoryRoot).quiet()

      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: repositoryRoot }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope
      const projectID = projectBody.data?.id

      expect(projectResponse.status).toBe(201)
      expect(projectID).toBeString()

      const commitResponse = await app.request(`http://localhost/api/projects/${projectID}/git/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: repositoryRoot,
          message: "chore: prepare push",
        }),
      })

      expect(commitResponse.status).toBe(200)

      const capabilitiesResponse = await app.request(
        `http://localhost/api/projects/${projectID}/git/capabilities?directory=${encodeURIComponent(repositoryRoot)}`,
      )
      const capabilitiesBody = (await capabilitiesResponse.json()) as GitCapabilitiesEnvelope

      expect(capabilitiesResponse.status).toBe(200)
      expect(capabilitiesBody.data?.branch).toBe("main")
      expect(capabilitiesBody.data?.canPush.enabled).toBe(true)

      const pushResponse = await app.request(`http://localhost/api/projects/${projectID}/git/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: repositoryRoot,
        }),
      })
      const pushBody = (await pushResponse.json()) as GitActionEnvelope

      expect(pushResponse.status).toBe(200)
      expect(pushBody.data?.summary).toContain("Pushed")

      const postPushCapabilitiesResponse = await app.request(
        `http://localhost/api/projects/${projectID}/git/capabilities?directory=${encodeURIComponent(repositoryRoot)}`,
      )
      const postPushCapabilitiesBody = (await postPushCapabilitiesResponse.json()) as GitCapabilitiesEnvelope

      expect(postPushCapabilitiesResponse.status).toBe(200)
      expect(postPushCapabilitiesBody.data?.canPush.enabled).toBe(false)
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
      await rm(remoteRoot, { recursive: true, force: true })
    }
  })

  test("GET /api/projects/:id/sessions should return sessions for the project", async () => {
    const app = createServerApp()
    const directory = process.cwd()

    const createResponse = await app.request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directory }),
    })
    const createBody = (await createResponse.json()) as SessionResponseEnvelope

    expect(createResponse.status).toBe(201)
    expect(createBody.success).toBe(true)
    expect(createBody.data?.id).toBeString()
    expect(createBody.data?.projectID).toBeString()

    const response = await app.request(`http://localhost/api/projects/${createBody.data!.projectID}/sessions`)
    const body = (await response.json()) as ProjectSessionsResponseEnvelope

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data?.some((session) => session.id === createBody.data?.id && session.directory === directory)).toBe(true)
  })

  test("GET /api/sessions/:id/messages should return stored message history", async () => {
    const app = createServerApp()
    const directory = process.cwd()

    const createResponse = await app.request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directory }),
    })
    const createBody = (await createResponse.json()) as SessionResponseEnvelope
    const sessionID = createBody.data?.id

    expect(createResponse.status).toBe(201)
    expect(sessionID).toBeString()

    const userMessage: Message.User = {
      id: Identifier.ascending("message"),
      sessionID: sessionID!,
      role: "user",
      created: Date.now(),
      agent: "plan",
      model: {
        providerID: "test-provider",
        modelID: "test-model",
      },
    }
    const userTextPart: Message.TextPart = {
      id: Identifier.ascending("part"),
      sessionID: sessionID!,
      messageID: userMessage.id,
      type: "text",
      text: "restore this history",
    }
    const assistantMessage: Message.Assistant = {
      id: Identifier.ascending("message"),
      sessionID: sessionID!,
      role: "assistant",
      created: Date.now() + 1,
      completed: Date.now() + 2,
      parentID: userMessage.id,
      modelID: "test-model",
      providerID: "test-provider",
      agent: "plan",
      path: {
        cwd: directory,
        root: directory,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    }
    const assistantTextPart: Message.TextPart = {
      id: Identifier.ascending("part"),
      sessionID: sessionID!,
      messageID: assistantMessage.id,
      type: "text",
      text: "history restored",
    }

    Session.DataBaseCreate("messages", userMessage)
    Session.DataBaseCreate("parts", userTextPart)
    Session.DataBaseCreate("messages", assistantMessage)
    Session.DataBaseCreate("parts", assistantTextPart)

    const response = await app.request(`http://localhost/api/sessions/${sessionID}/messages`)
    const body = (await response.json()) as SessionMessagesResponseEnvelope

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)
    expect(body.data?.[0]?.info.role).toBe("user")
    expect(body.data?.[0]?.parts[0]?.text).toBe("restore this history")
    expect(body.data?.[1]?.info.role).toBe("assistant")
    expect(body.data?.[1]?.parts[0]?.text).toBe("history restored")
  })

  test("session execution stream maps runtime events to SSE", async () => {
    const sessionID = "ses_stream_runtime"
    const turnID = Identifier.ascending("turn")
    const messageID = Identifier.ascending("message")
    const partID = Identifier.ascending("part")
    const timestamps = [101, 102, 103]
    const factory = RuntimeEvent.createRuntimeEventFactory({
      sessionID,
      turnID,
      timestamp: () => timestamps.shift() ?? 103,
    })

    const assistantMessage: Message.Assistant = {
      id: messageID,
      sessionID,
      role: "assistant",
      created: Date.now(),
      completed: Date.now() + 1,
      parentID: Identifier.ascending("message"),
      modelID: "test-model",
      providerID: "test-provider",
      agent: "plan",
      path: {
        cwd: process.cwd(),
        root: process.cwd(),
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      finishReason: "stop",
    }
    const textPart: Message.TextPart = {
      id: partID,
      sessionID,
      messageID,
      type: "text",
      text: "new answer",
      time: {
        start: Date.now(),
        end: Date.now() + 1,
      },
    }
    const startedEvent = factory.next("turn.started", {})
    const deltaEvent = factory.next("text.part.delta", {
      messageID,
      partID,
      kind: "text",
      delta: "new answer",
    })
    const completedEvent = factory.next("turn.completed", {
      status: "completed",
      finishReason: "stop",
      message: assistantMessage,
      parts: [textPart],
    })

    const response = createSessionExecutionStream({
      sessionID,
      heartbeatIntervalMs: 50,
      execute: async () => {
        LiveStreamHub.publish(startedEvent)
        await new Promise((resolve) => setTimeout(resolve, 5))
        LiveStreamHub.publish(deltaEvent)
        await new Promise((resolve) => setTimeout(resolve, 5))
        LiveStreamHub.publish(completedEvent)

        return {
          info: assistantMessage,
          parts: [textPart],
        }
      },
      cancel: () => {},
    })

    const raw = await response.text()
    const completedCursor = LiveStreamHub.serializeCursor(LiveStreamHub.cursorForEvent(completedEvent))

    expect(raw).toContain("event: runtime")
    expect(raw).toContain(`"type":"turn.started"`)
    expect(raw).toContain(`"type":"text.part.delta"`)
    expect(raw).toContain(`"type":"turn.completed"`)
    expect(raw).toContain(`"eventID":"`)
    expect(raw).toContain(`id: ${completedCursor}`)
    expect(raw).toContain(`"turnID":"${turnID}"`)
    expect(raw).toContain(`"partID":"${partID}"`)
  })

  test("session execution stream fallback terminal event keeps the observed turn id", async () => {
    const sessionID = "ses_stream_runtime_fallback"
    const turnID = Identifier.ascending("turn")
    const messageID = Identifier.ascending("message")
    const factory = RuntimeEvent.createRuntimeEventFactory({
      sessionID,
      turnID,
    })
    const assistantMessage: Message.Assistant = {
      id: messageID,
      sessionID,
      role: "assistant",
      created: Date.now(),
      completed: Date.now() + 1,
      parentID: Identifier.ascending("message"),
      modelID: "test-model",
      providerID: "test-provider",
      agent: "plan",
      path: {
        cwd: process.cwd(),
        root: process.cwd(),
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      finishReason: "stop",
    }
    const startedEvent = factory.next("turn.started", {})
    const completedStateEvent = factory.next("turn.state.changed", {
      phase: "completed",
      reason: "stop",
      messageID,
    })

    const response = createSessionExecutionStream({
      sessionID,
      heartbeatIntervalMs: 10,
      execute: async () => {
        LiveStreamHub.publish(startedEvent)
        LiveStreamHub.publish(completedStateEvent)

        return {
          info: assistantMessage,
          parts: [],
        }
      },
      cancel: () => {},
    })

    const raw = await response.text()

    expect(raw).toContain(`"type":"turn.started"`)
    expect(raw).toContain(`"type":"turn.state.changed"`)
    expect(raw).toContain(`"type":"turn.completed"`)
    expect(raw).toContain(`"turnID":"${turnID}"`)
    expect(raw).toContain(`"seq":3`)
    expect(raw).toContain("id: v2.")
    expect(raw).not.toContain(`:${turnID}:3`)
  })

  test("runtime event schema treats cancelled turns as terminal events", () => {
    const factory = RuntimeEvent.createRuntimeEventFactory({
      sessionID: Identifier.ascending("session"),
      turnID: Identifier.ascending("turn"),
      timestamp: () => 123,
    })

    const started = factory.next("turn.started", {})
    const cancelled = factory.next("turn.cancelled", {
      reason: "client-disconnect",
      detail: "client closed the stream",
    })

    expect(started.seq).toBe(1)
    expect(cancelled.seq).toBe(2)
    expect(RuntimeEvent.isTerminalRuntimeEvent(started)).toBe(false)
    expect(RuntimeEvent.isTerminalRuntimeEvent(cancelled)).toBe(true)
    expect(RuntimeEvent.isTerminalRuntimeEventType("turn.cancelled")).toBe(true)
  })

  test("session execution stream emits keepalive comments while waiting for runtime events", async () => {
    const sessionID = "ses_keepalive_runtime"
    const turnID = Identifier.ascending("turn")
    const messageID = Identifier.ascending("message")
    const factory = RuntimeEvent.createRuntimeEventFactory({ sessionID, turnID })
    const assistantMessage: Message.Assistant = {
      id: messageID,
      sessionID,
      role: "assistant",
      created: Date.now(),
      completed: Date.now() + 1,
      parentID: Identifier.ascending("message"),
      modelID: "test-model",
      providerID: "test-provider",
      agent: "plan",
      path: {
        cwd: process.cwd(),
        root: process.cwd(),
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    }

    const response = createSessionExecutionStream({
      sessionID,
      heartbeatIntervalMs: 20,
      execute: async () => {
        LiveStreamHub.publish(factory.next("turn.started", {}))
        await new Promise((resolve) => setTimeout(resolve, 60))
        LiveStreamHub.publish(factory.next("turn.completed", {
          status: "completed",
          message: assistantMessage,
          parts: [],
        }))
        return {
          info: assistantMessage,
          parts: [],
        }
      },
      cancel: () => {},
    })

    const raw = await response.text()

    expect(raw).toContain("event: runtime")
    expect(raw).toContain(`"type":"turn.started"`)
    expect(raw).toContain(": keepalive")
    expect(raw).toContain(`"type":"turn.completed"`)
  })

  test("GET /api/sessions/:id/events/stream replays missed session events across detached turns", async () => {
    const app = createServerApp()
    const session = await Session.createSession({
      directory: process.cwd(),
      projectID: "project_stream_replay",
      title: "Replay stream",
    })

    const turn1ID = Identifier.ascending("turn")
    const turn2ID = Identifier.ascending("turn")
    const assistantMessageID = Identifier.ascending("message")
    const toolPartID = Identifier.ascending("part")

    const assistantMessage: Message.Assistant = {
      id: assistantMessageID,
      sessionID: session.id,
      role: "assistant",
      created: Date.now(),
      completed: Date.now() + 1,
      parentID: Identifier.ascending("message"),
      modelID: "test-model",
      providerID: "test-provider",
      agent: "plan",
      path: {
        cwd: process.cwd(),
        root: process.cwd(),
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      finishReason: "tool-approval",
    }

    const waitingToolPart: Message.ToolPart = {
      id: toolPartID,
      sessionID: session.id,
      messageID: assistantMessageID,
      type: "tool",
      callID: "toolcall_stream_replay",
      tool: "read_file",
      state: {
        status: "waiting-approval",
        approvalID: "approval_stream_replay",
        input: {
          path: "README.md",
        },
        title: "Read File",
        time: {
          start: 301,
        },
      },
    }

    const turn1Factory = RuntimeEvent.createRuntimeEventFactory({
      sessionID: session.id,
      turnID: turn1ID,
      timestamp: () => 200,
    })
    const turn2Timestamps = [300, 301, 302]
    const turn2Factory = RuntimeEvent.createRuntimeEventFactory({
      sessionID: session.id,
      turnID: turn2ID,
      timestamp: () => turn2Timestamps.shift() ?? 302,
    })

    const turn1Started = turn1Factory.next("turn.started", {})
    const turn1Completed = turn1Factory.next("turn.completed", {
      status: "completed",
      finishReason: "stop",
      message: assistantMessage,
      parts: [],
    })
    const turn2Started = turn2Factory.next("turn.started", {
      userMessageID: assistantMessage.parentID,
      agent: assistantMessage.agent,
      model: {
        providerID: assistantMessage.providerID,
        modelID: assistantMessage.modelID,
      },
    })
    const turn2WaitingApproval = turn2Factory.next("tool.call.waiting_approval", {
      part: waitingToolPart,
    })
    const turn2Completed = turn2Factory.next("turn.completed", {
      status: "blocked",
      finishReason: "approval-resolved",
      message: assistantMessage,
      parts: [waitingToolPart],
    })

    LiveStreamHub.publish(turn1Started)
    LiveStreamHub.publish(turn1Completed)
    LiveStreamHub.publish(turn2Started)
    LiveStreamHub.publish(turn2WaitingApproval)
    LiveStreamHub.publish(turn2Completed)

    const since = LiveStreamHub.serializeCursor(LiveStreamHub.cursorForEvent(turn1Completed))
    const response = await app.request(
      `http://localhost/api/sessions/${session.id}/events/stream?since=${encodeURIComponent(since)}`,
    )
    const raw = await readStreamUntil(response, [
      `"type":"turn.completed"`,
      `"turnID":"${turn2ID}"`,
      `"status":"blocked"`,
    ])

    expect(response.status).toBe(200)
    expect(raw).toContain("event: runtime")
    expect(raw).toContain(`"type":"turn.started"`)
    expect(raw).toContain(`"type":"tool.call.waiting_approval"`)
    expect(raw).toContain(`"type":"turn.completed"`)
    expect(raw).toContain(`id: ${LiveStreamHub.serializeCursor(LiveStreamHub.cursorForEvent(turn2Started))}`)
    expect(raw).toContain(`"tool":"read_file"`)
    expect(raw).toContain(`"turnID":"${turn2ID}"`)
    expect(raw).not.toContain(`"turnID":"${turn1ID}"`)
    LiveStreamHub.clearSession(session.id)
  })

  test("GET /api/sessions/:id/events/stream seeds active turn transient deltas for late subscribers", async () => {
    const app = createServerApp()
    const session = await Session.createSession({
      directory: process.cwd(),
      projectID: "project_stream_late_subscriber",
      title: "Late subscriber stream",
    })
    const turnID = Identifier.ascending("turn")
    const messageID = Identifier.ascending("message")
    const partID = Identifier.ascending("part")
    const turn = Orchestrator.startTurn({
      sessionID: session.id,
      turnID,
    })

    try {
      turn.emitStream("tool.input.delta", {
        messageID,
        partID,
        toolCallID: "toolcall_apply_patch_late",
        toolName: "apply_patch",
        delta: "{\"cmd\":\"patch\"}",
        rawLength: 15,
      })
      turn.flushStreamEvents()

      const response = await app.request(
        `http://localhost/api/sessions/${session.id}/events/stream`,
      )
      const raw = await readStreamUntil(response, [
        `"type":"tool.input.delta"`,
        `"toolName":"apply_patch"`,
        `"turnID":"${turnID}"`,
      ])

      expect(response.status).toBe(200)
      expect(raw).toContain(`"type":"turn.started"`)
      expect(raw).toContain(`"type":"tool.input.delta"`)
      expect(raw).toContain(`"toolCallID":"toolcall_apply_patch_late"`)
      expect(raw).toContain(`"delta":"{\\"cmd\\":\\"patch\\"}"`)
    } finally {
      if (Orchestrator.activeTurn(session.id)?.turnID === turnID) {
        turn.emit("turn.cancelled", {
          reason: "user",
          detail: "test cleanup",
        })
        Orchestrator.finishTurn(turn)
      }
    }
  })

  test("GET /api/sessions/:id/events/stream asks legacy or malformed cursors to resync", async () => {
    const app = createServerApp()
    const session = await Session.createSession({
      directory: process.cwd(),
      projectID: "project_stream_invalid_cursor",
      title: "Invalid cursor stream",
    })

    const response = await app.request(
      `http://localhost/api/sessions/${session.id}/events/stream`,
      { headers: { "last-event-id": "123:legacy-turn:4" } },
    )
    const raw = await readStreamUntil(response, [
      "event: resync-required",
      `"sessionID":"${session.id}"`,
      `"reason":"cursor-invalid"`,
    ])

    expect(response.status).toBe(200)
    expect(raw).toContain("event: resync-required")
    expect(raw).toContain(`"reason":"cursor-invalid"`)
  })

  test("GET /api/projects/:id/sessions should return 404 for missing project", async () => {
    const app = createServerApp()
    const response = await app.request("http://localhost/api/projects/project_missing/sessions")
    const body = (await response.json()) as JsonEnvelope

    expect(response.status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("PROJECT_NOT_FOUND")
  })

  test("GET /api/projects/:id/sessions should return an empty list for a new project with no sessions", async () => {
    const app = createServerApp()
    const directory = await createTempDirectory("anybox-project-empty-")

    try {
      const projectResponse = await app.request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory }),
      })
      const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope

      expect(projectResponse.status).toBe(201)
      expect(projectBody.success).toBe(true)
      expect(projectBody.data?.id).toBeString()

      const response = await app.request(`http://localhost/api/projects/${projectBody.data!.id}/sessions`)
      const body = (await response.json()) as ProjectSessionsResponseEnvelope

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("POST /api/projects/:id/sessions should create a session for the project", async () => {
    const app = createServerApp()
    const directory = process.cwd()

    const projectResponse = await app.request("http://localhost/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directory }),
    })
    const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope

    expect(projectResponse.status).toBe(201)
    expect(projectBody.data?.id).toBeString()

    const createSessionResponse = await app.request(`http://localhost/api/projects/${projectBody.data!.id}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Backend chat", directory }),
    })
    const createSessionBody = (await createSessionResponse.json()) as SessionResponseEnvelope

    expect(createSessionResponse.status).toBe(201)
    expect(createSessionBody.success).toBe(true)
    expect(createSessionBody.data?.projectID).toBe(projectBody.data?.id)
    expect(createSessionBody.data?.worktreeID).toBeString()
    expect(createSessionBody.data?.title).toBe("Backend chat")

    const sessionsResponse = await app.request(`http://localhost/api/projects/${projectBody.data!.id}/sessions`)
    const sessionsBody = (await sessionsResponse.json()) as ProjectSessionsResponseEnvelope

    expect(sessionsResponse.status).toBe(200)
    expect(sessionsBody.data?.some((session) => session.id === createSessionBody.data?.id)).toBe(true)
    expect(sessionsBody.data?.find((session) => session.id === createSessionBody.data?.id)?.worktreeID).toBe(
      createSessionBody.data?.worktreeID,
    )
  })

  test("DELETE /api/sessions/:id should remove the session", async () => {
    const app = createServerApp()
    const directory = process.cwd()

    const createResponse = await app.request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directory }),
    })
    const createBody = (await createResponse.json()) as SessionResponseEnvelope

    expect(createResponse.status).toBe(201)
    expect(createBody.data?.id).toBeString()

    const deleteResponse = await app.request(`http://localhost/api/sessions/${createBody.data!.id}`, {
      method: "DELETE",
    })
    const deleteBody = (await deleteResponse.json()) as DeleteSessionResponseEnvelope

    expect(deleteResponse.status).toBe(200)
    expect(deleteBody.success).toBe(true)
    expect(deleteBody.data?.sessionID).toBe(createBody.data?.id)
    expect(deleteBody.data?.projectID).toBe(createBody.data?.projectID)

    const readResponse = await app.request(`http://localhost/api/sessions/${createBody.data!.id}`)
    const readBody = (await readResponse.json()) as JsonEnvelope

    expect(readResponse.status).toBe(404)
    expect(readBody.error?.code).toBe("SESSION_NOT_FOUND")
  })

  test("DELETE /api/projects/:id should remove the project and its sessions", async () => {
    const app = createServerApp()
    const directory = process.cwd()

    const projectResponse = await app.request("http://localhost/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directory }),
    })
    const projectBody = (await projectResponse.json()) as ProjectResponseEnvelope

    expect(projectResponse.status).toBe(201)
    expect(projectBody.data?.id).toBeString()

    const sessionResponse = await app.request(`http://localhost/api/projects/${projectBody.data!.id}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Disposable chat", directory }),
    })
    const sessionBody = (await sessionResponse.json()) as SessionResponseEnvelope

    expect(sessionResponse.status).toBe(201)
    expect(sessionBody.data?.id).toBeString()

    const deleteResponse = await app.request(`http://localhost/api/projects/${projectBody.data!.id}`, {
      method: "DELETE",
    })
    const deleteBody = (await deleteResponse.json()) as DeleteProjectResponseEnvelope

    expect(deleteResponse.status).toBe(200)
    expect(deleteBody.success).toBe(true)
    expect(deleteBody.data?.projectID).toBe(projectBody.data?.id)
    expect(deleteBody.data?.deletedSessionIDs).toContain(sessionBody.data?.id)

    const projectReadResponse = await app.request(`http://localhost/api/projects/${projectBody.data!.id}`)
    const projectReadBody = (await projectReadResponse.json()) as JsonEnvelope
    expect(projectReadResponse.status).toBe(404)
    expect(projectReadBody.error?.code).toBe("PROJECT_NOT_FOUND")

    const sessionReadResponse = await app.request(`http://localhost/api/sessions/${sessionBody.data!.id}`)
    const sessionReadBody = (await sessionReadResponse.json()) as JsonEnvelope
    expect(sessionReadResponse.status).toBe(404)
    expect(sessionReadBody.error?.code).toBe("SESSION_NOT_FOUND")
  })
})
