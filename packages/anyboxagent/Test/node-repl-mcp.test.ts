import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import * as BuiltinMcp from "../src/mcp/builtin"
import { McpClient } from "../src/mcp/client"

const temporaryRoots: string[] = []
const originalNodeBinary = process.env.ANYBOX_NODE_BINARY
const originalNodeRunAsNode = process.env.ANYBOX_NODE_RUN_AS_NODE
const originalTestSecret = process.env.ANYBOX_NODE_REPL_TEST_SECRET
const originalComputerUseSignature = process.env.ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE
const originalBrowserPrivateKey = process.env.ANYBOX_BROWSER_AUTH_PRIVATE_KEY

function structuredResult(result: Awaited<ReturnType<McpClient["callTool"]>>) {
  const content = result.structuredContent
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("Expected object structured content from the Node REPL MCP server.")
  }
  return content.result
}

function structuredContent(result: Awaited<ReturnType<McpClient["callTool"]>>) {
  const content = result.structuredContent
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("Expected object structured content from the Node REPL MCP server.")
  }
  return content as Record<string, unknown>
}

function textContent(result: Awaited<ReturnType<McpClient["callTool"]>>) {
  return result.content.flatMap((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return []
    const record = block as Record<string, unknown>
    return record.type === "text" && typeof record.text === "string"
      ? [record.text]
      : []
  }).join("\n")
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return
    await Bun.sleep(20)
  }
  throw new Error(`Process ${pid} was still alive after ${timeoutMs}ms.`)
}

function nodeReplServer() {
  const definition = BuiltinMcp.getDefinition(BuiltinMcp.NODE_REPL_DEFINITION_ID)
  if (!definition) throw new Error("Expected the built-in Node REPL MCP definition.")
  return {
    id: definition.serverID,
    ...definition.runtime,
    transport: "stdio" as const,
    enabled: definition.runtime.enabled ?? true,
    owner: {
      kind: "anybox" as const,
      bindingID: definition.id,
    },
  }
}

async function createClient(options: {
  onElicitation?: ConstructorParameters<typeof McpClient>[0]["onElicitation"]
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "anybox-node-repl-"))
  temporaryRoots.push(root)
  return new McpClient({
    cwd: root,
    worktree: root,
    requestTimeoutMs: 10_000,
    server: nodeReplServer(),
    onElicitation: options.onElicitation,
  })
}

afterEach(async () => {
  if (originalNodeBinary === undefined) delete process.env.ANYBOX_NODE_BINARY
  else process.env.ANYBOX_NODE_BINARY = originalNodeBinary
  if (originalNodeRunAsNode === undefined) delete process.env.ANYBOX_NODE_RUN_AS_NODE
  else process.env.ANYBOX_NODE_RUN_AS_NODE = originalNodeRunAsNode
  if (originalTestSecret === undefined) delete process.env.ANYBOX_NODE_REPL_TEST_SECRET
  else process.env.ANYBOX_NODE_REPL_TEST_SECRET = originalTestSecret
  if (originalComputerUseSignature === undefined) {
    delete process.env.ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE
  } else {
    process.env.ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE = originalComputerUseSignature
  }
  if (originalBrowserPrivateKey === undefined) delete process.env.ANYBOX_BROWSER_AUTH_PRIVATE_KEY
  else process.env.ANYBOX_BROWSER_AUTH_PRIVATE_KEY = originalBrowserPrivateKey
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    ),
  )
})

describe("built-in Node REPL MCP", () => {
  test("is a platform-owned general-purpose runtime with no Chrome implementation", async () => {
    const definition = BuiltinMcp.getDefinition("node-repl")
    expect(definition).toMatchObject({
      id: "node-repl",
      serverID: "anybox.node-repl",
      risk: "high",
      available: true,
    })
    const configuredRuntime = definition?.runtime
    expect(configuredRuntime).toMatchObject({
      transport: "stdio",
      command: "node",
      timeoutMs: 300_000,
    })
    expect(configuredRuntime?.cwd).toBeUndefined()

    const serverPath = configuredRuntime?.args?.[0] ?? ""
    const source = await readFile(serverPath, "utf8")
    const kernelSource = await readFile(join(dirname(serverPath), "kernel.js"), "utf8")
    const packageBoundary = JSON.parse(
      await readFile(join(dirname(serverPath), "package.json"), "utf8"),
    )
    expect(packageBoundary).toMatchObject({ private: true, type: "commonjs" })
    expect(source).toContain("anybox-node-repl")
    expect(source).toContain("fork(KERNEL_PATH")
    expect(source).not.toContain("new AsyncFunction")
    expect(kernelSource).toContain("new AsyncFunction")
    expect(kernelSource).toContain("requestPermission")
    expect(source).not.toMatch(
      /Chrome|browser|native-host|requestHost|getCapability/,
    )
  })

  test("uses Electron's Node mode in the managed desktop runtime", () => {
    process.env.ANYBOX_NODE_BINARY = "C:\\Anybox\\Anybox.exe"
    process.env.ANYBOX_NODE_RUN_AS_NODE = "1"
    const runtime = BuiltinMcp.getDefinition("node-repl")?.runtime
    expect(runtime).toMatchObject({
      transport: "stdio",
      command: "C:\\Anybox\\Anybox.exe",
      env: {
        ELECTRON_RUN_AS_NODE: "1",
      },
    })
  })

  test("keeps JavaScript state and exposes only generic Node helpers", async () => {
    const client = await createClient()
    try {
      const listedTools = await client.listTools()
      expect(listedTools.map((tool) => tool.name)).toEqual([
        "js",
        "js_reset",
        "js_add_node_module_dir",
      ])
      expect(listedTools.find((tool) => tool.name === "js")?.description)
        .toContain("explicit return")
      expect(listedTools.find((tool) => tool.name === "js")).toMatchObject({
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        },
        outputSchema: {
          required: ["result", "writes", "imageCount"],
        },
      })
      expect(listedTools.find((tool) => tool.name === "js_reset")?.annotations)
        .toMatchObject({ destructiveHint: true })

      const invalidTimeout = await client.callTool("js", {
        code: "return 'must not run'",
        timeoutMs: 600_000,
      })
      expect(invalidTimeout.isError).toBe(true)
      expect(structuredContent(invalidTimeout)).toMatchObject({
        code: "INVALID_TIMEOUT",
        retryable: false,
        details: { provided: 600_000, minimum: 1, maximum: 120_000 },
      })

      const bareExpression = await client.callTool("js", { code: "1 + 1" })
      expect(structuredResult(bareExpression)).toBeNull()
      const returnedExpression = await client.callTool("js", { code: "return 1 + 1" })
      expect(structuredResult(returnedExpression)).toBe(2)

      await client.callTool("js", { code: "globalThis.counter = 40" })
      const result = await client.callTool("js", {
        code: `return {
          counter: globalThis.counter + 2,
          cwd: nodeRepl.cwd,
          processType: typeof process,
          agentType: typeof agent,
          capabilityType: typeof nodeRepl.getCapability,
          requestHostType: typeof nodeRepl.requestHost,
          pluginCapabilityType: typeof nodeRepl.callPluginCapability,
          permissionType: typeof nodeRepl.requestPermission
        }`,
      })
      expect(structuredResult(result)).toMatchObject({
        counter: 42,
        processType: "undefined",
        agentType: "undefined",
        capabilityType: "undefined",
        requestHostType: "undefined",
        pluginCapabilityType: "undefined",
        permissionType: "function",
      })

      await client.callTool("js_reset", {})
      const reset = await client.callTool("js", {
        code: "return typeof globalThis.counter",
      })
      expect(structuredResult(reset)).toBe("undefined")
    } finally {
      await client.dispose()
    }
  })

  test("hard-resets the kernel process and all process-scoped resources", async () => {
    const client = await createClient()
    try {
      const addedModuleDirectory = await client.callTool("js_add_node_module_dir", {
        path: ".",
      })
      expect(structuredContent(addedModuleDirectory).path).toBeString()
      const seeded = await client.callTool("js", {
        code: `globalThis.beforeHardReset = "present"
          globalThis.backgroundTimer = setInterval(() => {}, 10)
          return (await import("node:process")).pid`,
      })
      const oldKernelPID = structuredResult(seeded) as number
      expect(processIsAlive(oldKernelPID)).toBe(true)

      const reset = await client.callTool("js_reset", {})
      expect(reset.isError).toBe(false)
      expect(structuredContent(reset)).toMatchObject({ reset: true, hard: true })
      await waitForProcessExit(oldKernelPID)

      const recovered = await client.callTool("js", {
        code: `return {
          pid: (await import("node:process")).pid,
          priorState: typeof globalThis.beforeHardReset,
          priorTimer: typeof globalThis.backgroundTimer,
          moduleDirCount: nodeRepl.nodeModuleDirs.length
        }`,
      })
      expect(structuredResult(recovered)).toMatchObject({
        priorState: "undefined",
        priorTimer: "undefined",
        moduleDirCount: 0,
      })
      expect((structuredResult(recovered) as { pid: number }).pid).not.toBe(oldKernelPID)
    } finally {
      await client.dispose()
    }
  })

  test("isolates persistent state when the Anybox session changes", async () => {
    const client = await createClient()
    try {
      const first = await client.callTool(
        "js",
        {
          code: `globalThis.sessionMarker = "session-a"
            return (await import("node:process")).pid`,
        },
        undefined,
        {
          sessionID: "session-a",
          turnID: "turn-a",
          messageID: "message-a",
          toolCallID: "tool-a",
        },
      )
      const firstPID = structuredResult(first) as number

      const second = await client.callTool(
        "js",
        {
          code: `return {
            marker: typeof globalThis.sessionMarker,
            pid: (await import("node:process")).pid
          }`,
        },
        undefined,
        {
          sessionID: "session-b",
          turnID: "turn-b",
          messageID: "message-b",
          toolCallID: "tool-b",
        },
      )
      expect(structuredResult(second)).toMatchObject({ marker: "undefined" })
      const secondPID = (structuredResult(second) as { pid: number }).pid
      expect(secondPID).not.toBe(firstPID)
      await waitForProcessExit(firstPID)

      await client.callTool(
        "js",
        { code: "globalThis.sessionMarker = 'session-b'; return true" },
        undefined,
        {
          sessionID: "session-b",
          turnID: "turn-b",
          messageID: "message-b-2",
          toolCallID: "tool-b-2",
        },
      )
      await client.notifyLifecycle({
        type: "session-end",
        context: { sessionID: "session-a", turnID: "turn-a" },
      })
      const afterStaleLifecycle = await client.callTool(
        "js",
        {
          code: `return {
            marker: globalThis.sessionMarker,
            pid: (await import("node:process")).pid
          }`,
        },
        undefined,
        {
          sessionID: "session-b",
          turnID: "turn-b-2",
          messageID: "message-b-3",
          toolCallID: "tool-b-3",
        },
      )
      expect(structuredResult(afterStaleLifecycle)).toEqual({
        marker: "session-b",
        pid: secondPID,
      })
    } finally {
      await client.dispose()
    }
  })

  test("gives the built-in Node REPL only the browser receipt public key", async () => {
    process.env.ANYBOX_NODE_REPL_TEST_SECRET = "must-not-cross-the-mcp-boundary"
    process.env.ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE = "1"
    process.env.ANYBOX_BROWSER_AUTH_PRIVATE_KEY = "must-remain-in-the-agent"
    const client = await createClient()
    try {
      const result = await client.callTool("js", {
        code: `const nodeProcess = await import("node:process")
          return {
            publicKey: nodeProcess.env.ANYBOX_BROWSER_AUTH_PUBLIC_KEY,
            privateKey: nodeProcess.env.ANYBOX_BROWSER_AUTH_PRIVATE_KEY,
            inheritedSecret: nodeProcess.env.ANYBOX_NODE_REPL_TEST_SECRET,
            failClosedControl: nodeProcess.env.ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE,
            path: nodeProcess.env.PATH || nodeProcess.env.Path
          }`,
      })
      const environment = structuredResult(result) as {
        publicKey?: unknown
        privateKey?: unknown
        inheritedSecret?: unknown
        failClosedControl?: unknown
        path?: unknown
      }
      expect(typeof environment.publicKey).toBe("string")
      expect(environment.publicKey).toMatch(/^[A-Za-z0-9_-]+$/u)
      expect(environment.privateKey).toBeUndefined()
      expect(environment.inheritedSecret).toBeUndefined()
      expect(environment.failClosedControl).toBe("1")
      expect(typeof environment.path).toBe("string")
    } finally {
      await client.dispose()
    }
  })

  test("returns stable JSON errors and caps duplicate text previews", async () => {
    const client = await createClient()
    try {
      const bigint = await client.callTool("js", {
        code: "return { nested: { value: 42n } }",
      })
      expect(bigint.isError).toBe(true)
      expect(structuredContent(bigint)).toMatchObject({
        code: "RESULT_NOT_JSON_SERIALIZABLE",
        details: { path: "$.nested.value", type: "bigint" },
      })

      const circular = await client.callTool("js", {
        code: "const value = {}; value.self = value; return value",
      })
      expect(circular.isError).toBe(true)
      expect(structuredContent(circular)).toMatchObject({
        code: "RESULT_NOT_JSON_SERIALIZABLE",
        details: { path: "$.self", referencePath: "$", type: "circular" },
      })

      const nonFinite = await client.callTool("js", {
        code: "return { value: Number.POSITIVE_INFINITY }",
      })
      expect(nonFinite.isError).toBe(true)
      expect(structuredContent(nonFinite)).toMatchObject({
        code: "RESULT_NOT_JSON_SERIALIZABLE",
        details: { path: "$.value", type: "Infinity" },
      })

      const throwingGetter = await client.callTool("js", {
        code: `return {
          get broken() { throw new Error("getter failed") }
        }`,
      })
      expect(throwingGetter.isError).toBe(true)
      expect(structuredContent(throwingGetter)).toMatchObject({
        code: "RESULT_NOT_JSON_SERIALIZABLE",
        details: { path: "$.broken", type: "property-access" },
      })

      const unsafeError = await client.callTool("js", {
        code: `const error = new Error("fixture failure")
          error.code = "FIXTURE_FAILURE"
          error.details = {}
          error.details.self = error.details
          throw error`,
      })
      expect(unsafeError.isError).toBe(true)
      expect(structuredContent(unsafeError)).toMatchObject({
        code: "FIXTURE_FAILURE",
        details: { omitted: "Error details were not JSON-serializable." },
      })

      const tooDeep = await client.callTool("js", {
        code: `const root = {}
          let cursor = root
          for (let index = 0; index < 300; index += 1) {
            cursor.next = {}
            cursor = cursor.next
          }
          return root`,
      })
      expect(tooDeep.isError).toBe(true)
      expect(structuredContent(tooDeep)).toMatchObject({
        code: "RESULT_LIMIT_EXCEEDED",
        details: { limit: 256, kind: "depth" },
      })

      const large = await client.callTool("js", {
        code: "return 'x'.repeat(1024 * 1024)",
      })
      expect(large.isError).toBe(false)
      expect((structuredResult(large) as string).length).toBe(1024 * 1024)
      expect(textContent(large).length).toBeLessThan(70_000)
      expect(textContent(large)).toContain("characters omitted")

      const tooLarge = await client.callTool("js", {
        code: "return 'x'.repeat(9 * 1024 * 1024)",
      })
      expect(tooLarge.isError).toBe(true)
      expect(structuredContent(tooLarge)).toMatchObject({
        code: "RESULT_LIMIT_EXCEEDED",
        details: { limit: 8 * 1024 * 1024, kind: "bytes" },
      })

      const recovered = await client.callTool("js", { code: "return 6 * 7" })
      expect(structuredResult(recovered)).toBe(42)
    } finally {
      await client.dispose()
    }
  })

  test("exposes generic per-call metadata without a business-specific host-service bridge", async () => {
    const client = await createClient()
    try {
      const result = await client.callTool(
        "js",
        {
          code: `const pathModule = await import("node:path")
            return {
              requestMeta: nodeRepl.requestMeta,
              requestHostType: typeof nodeRepl.requestHost,
              importedModule: typeof pathModule.resolve
            }`,
        },
        undefined,
        {
          sessionID: "session-node-repl",
          turnID: "turn-node-repl",
          messageID: "message-node-repl",
          toolCallID: "tool-node-repl",
        },
      )

      expect(result.isError).toBe(false)
      expect(structuredResult(result)).toMatchObject({
        requestMeta: {
          sessionID: "session-node-repl",
          turnID: "turn-node-repl",
          messageID: "message-node-repl",
          toolCallID: "tool-node-repl",
        },
        requestHostType: "undefined",
        importedModule: "function",
      })

      const nextCall = await client.callTool("js", {
        code: "return nodeRepl.requestMeta",
      })
      expect(structuredResult(nextCall)).toBeNull()
    } finally {
      await client.dispose()
    }
  })

  test("continues the same JavaScript promise after an in-process permission decision", async () => {
    let receivedMeta: Record<string, unknown> | undefined
    const client = await createClient({
      onElicitation: async (request) => {
        receivedMeta = request.params._meta?.["anybox/permission"] as Record<string, unknown>
        return {
          action: "accept",
          content: {
            decision: "allow-session",
            grantID: "grant-test",
            authorization: "receipt-test",
          },
        }
      },
    })
    try {
      const result = await client.callTool(
        "js",
        {
          code: `globalThis.permissionContinuation = ["before"]
            const permission = await nodeRepl.requestPermission({
              message: "Allow plugin action?",
              method: "fixture.action",
              scope: {
                kind: "plugin-action",
                sessionID: "spoofed-session",
                pluginID: "fixture-plugin",
                pluginDisplayName: "Fixture Plugin",
                actionTitle: "Fixture action",
                actionSummary: "Run the fixture action."
              }
            })
            globalThis.permissionContinuation.push("after")
            return { permission, continuation: globalThis.permissionContinuation }`,
        },
        undefined,
        {
          sessionID: "session-node-repl",
          turnID: "turn-node-repl",
          messageID: "message-node-repl",
          toolCallID: "tool-node-repl",
        },
      )

      expect(result.isError).toBe(false)
      expect(structuredResult(result)).toEqual({
        permission: {
          allowed: true,
          decision: "allow-session",
          action: "accept",
          grantID: "grant-test",
          authorization: "receipt-test",
        },
        continuation: ["before", "after"],
      })
      expect(receivedMeta?.continuation).toBe("in-process")
      expect(receivedMeta?.timeoutMs).toBe(120_000)
      expect(receivedMeta?.scope).toMatchObject({
        kind: "plugin-action",
        pluginID: "fixture-plugin",
      })
      expect(receivedMeta?.context).toEqual({
        sessionID: "session-node-repl",
        turnID: "turn-node-repl",
        messageID: "message-node-repl",
        toolCallID: "tool-node-repl",
      })
    } finally {
      await client.dispose()
    }
  })

  test("does not charge user decision time against the JavaScript timeout", async () => {
    const client = await createClient({
      onElicitation: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80))
        return {
          action: "accept",
          content: {
            decision: "allow-once",
            grantID: "grant-delayed",
          },
        }
      },
    })
    try {
      const result = await client.callTool(
        "js",
        {
          code: `const decision = await nodeRepl.requestPermission({
              message: "Allow action?",
              timeoutMs: 1000
            })
            return decision.decision`,
          timeoutMs: 25,
        },
        undefined,
        {
          sessionID: "session-node-repl",
          turnID: "turn-node-repl",
          messageID: "message-node-repl",
          toolCallID: "tool-node-repl",
        },
      )
      expect(result.isError).toBe(false)
      expect(structuredResult(result)).toBe("allow-once")
    } finally {
      await client.dispose()
    }
  })

  test.each([
    ["a synchronous loop", "while (true) {}"],
    ["a loop after a microtask", "await Promise.resolve(); while (true) {}"],
    ["a loop after a timer", "await new Promise((resolve) => setTimeout(resolve, 20)); while (true) {}"],
    ["a loop inside a loaded Node module", "require('node:vm').runInThisContext('while (true) {}')"],
  ])("force-terminates %s at the execution timeout", async (_label, code) => {
    const client = await createClient()
    try {
      const started = Date.now()
      const result = await client.callTool("js", { code, timeoutMs: 150 })
      const elapsed = Date.now() - started

      expect(result.isError).toBe(true)
      expect(structuredContent(result)).toMatchObject({
        status: "error",
        error: "Execution timed out after 150ms. The Node REPL runtime was reset.",
        runtimeReset: true,
        code: "EXECUTION_TIMEOUT",
      })
      expect(elapsed).toBeGreaterThanOrEqual(100)
      expect(elapsed).toBeLessThan(3_000)
    } finally {
      await client.dispose()
    }
  })

  test("reaps the timed-out kernel, resets state, and remains immediately usable", async () => {
    const client = await createClient()
    try {
      const seeded = await client.callTool("js", {
        code: `globalThis.beforeTimeout = "present"
          return (await import("node:process")).pid`,
      })
      const oldKernelPID = structuredResult(seeded) as number
      expect(processIsAlive(oldKernelPID)).toBe(true)

      const timedOut = await client.callTool("js", {
        code: "while (true) {}",
        timeoutMs: 120,
      })
      expect(structuredContent(timedOut)).toMatchObject({
        status: "error",
        runtimeReset: true,
      })
      await waitForProcessExit(oldKernelPID)

      const listStarted = Date.now()
      expect((await client.listTools()).map((tool) => tool.name)).toContain("js")
      expect(Date.now() - listStarted).toBeLessThan(1_000)

      const recovered = await client.callTool("js", {
        code: `return {
          priorState: typeof globalThis.beforeTimeout,
          pid: (await import("node:process")).pid,
          value: 6 * 7
        }`,
      })
      expect(structuredResult(recovered)).toMatchObject({
        priorState: "undefined",
        value: 42,
      })
      expect((structuredResult(recovered) as { pid: number }).pid).not.toBe(oldKernelPID)
    } finally {
      await client.dispose()
    }
  })

  test("keeps the MCP supervisor responsive while the kernel is blocked", async () => {
    const client = await createClient()
    try {
      const blocked = client.callTool("js", {
        code: "while (true) {}",
        timeoutMs: 300,
      })
      await Bun.sleep(50)

      const started = Date.now()
      const listed = await client.listTools()
      expect(listed.map((tool) => tool.name)).toContain("js")
      expect(Date.now() - started).toBeLessThan(500)
      expect((await blocked).isError).toBe(true)
    } finally {
      await client.dispose()
    }
  })

  test("cancels an in-flight loop quickly and reaps its kernel", async () => {
    const client = await createClient()
    const pidResult = await client.callTool("js", {
      code: "return (await import('node:process')).pid",
    })
    const kernelPID = structuredResult(pidResult) as number
    const controller = new AbortController()
    const started = Date.now()
    const pending = client.callTool(
      "js",
      { code: "while (true) {}", timeoutMs: 10_000 },
      controller.signal,
    )
    setTimeout(() => controller.abort(new Error("test cancellation")), 100)

    try {
      await expect(pending).rejects.toThrow("test cancellation")
      expect(Date.now() - started).toBeLessThan(3_000)
      await waitForProcessExit(kernelPID)
    } finally {
      await client.dispose()
    }
  })
})
