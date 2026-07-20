import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const runtimeDir = path.resolve(
  process.argv[2]
    ?? process.env.ANYBOX_AGENT_RUNTIME_OUTPUT_DIR
    ?? path.join(import.meta.dirname, "..", "build", "agent-runtime"),
)
const bunName = process.platform === "win32" ? "bun.exe" : "bun"
const dataDir = await mkdtemp(path.join(tmpdir(), "anybox-computer-use-runtime-"))
const port = 41_000 + Math.floor(Math.random() * 1_000)
const child = spawn(
  path.join(runtimeDir, bunName),
  [path.join(runtimeDir, "agent-server.js")],
  {
    cwd: runtimeDir,
    env: {
      ...process.env,
      ANYBOX_AGENT_DATA_DIR: dataDir,
      ANYBOX_DATABASE_FILE: path.join(dataDir, "agent.db"),
      ANYBOX_LOG_FILE: "0",
      ANYBOX_LOG_PRINT: "0",
      ANYBOX_SERVER_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
)

async function request(route, timeoutMs = 10_000) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`${route} returned HTTP ${response.status}.`)
  }
  return await response.json()
}

try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged Agent exited before readiness (${child.exitCode}).`)
    }
    try {
      await request("/healthz", 500)
      ready = true
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  if (!ready) throw new Error("Packaged Agent did not become ready.")

  const servers = await request("/api/mcp/servers")
  const nodeRepl = servers.data?.find?.((item) => item.id === "anybox.node-repl")
  if (!nodeRepl) throw new Error("Packaged Agent did not register anybox.node-repl.")
  const computerUse = servers.data?.find?.((item) => item.id === "anybox.computer-use")
  if (!computerUse) throw new Error("Packaged Agent did not register anybox.computer-use.")
  const nodeReplDiagnostic = await request(
    "/api/mcp/servers/anybox.node-repl/diagnostic",
    30_000,
  )
  if (!nodeReplDiagnostic.data?.ok || nodeReplDiagnostic.data?.toolCount !== 3) {
    throw new Error(
      `Packaged Node REPL diagnostic failed: ${JSON.stringify(nodeReplDiagnostic.data)}`,
    )
  }
  const computerUseDiagnostic = await request(
    "/api/mcp/servers/anybox.computer-use/diagnostic",
    30_000,
  )
  if (!computerUseDiagnostic.data?.ok || computerUseDiagnostic.data?.toolCount !== 14) {
    throw new Error(
      `Packaged Computer Use diagnostic failed: ${JSON.stringify(computerUseDiagnostic.data)}`,
    )
  }
  const packagedNodeReplSource = await readFile(
    path.join(runtimeDir, "mcp", "node-repl", "server.js"),
    "utf8",
  )
  for (const marker of ["callPluginCapability", "anybox/plugin-capability/call"]) {
    if (!packagedNodeReplSource.includes(marker)) {
      throw new Error(`Packaged Node REPL is missing the generic capability bridge marker '${marker}'.`)
    }
  }
  console.log(JSON.stringify({
    ok: true,
    nodeRepl: {
      serverID: nodeRepl.id,
      owner: nodeRepl.owner,
      toolCount: nodeReplDiagnostic.data.toolCount,
      toolNames: nodeReplDiagnostic.data.toolNames,
      genericPluginCapabilityBridge: true,
    },
    computerUse: {
      serverID: computerUse.id,
      owner: computerUse.owner,
      internalToolCount: computerUseDiagnostic.data.toolCount,
      internalToolNames: computerUseDiagnostic.data.toolNames,
    },
  }, null, 2))
} finally {
  child.kill()
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ])
  await rm(dataDir, { recursive: true, force: true })
}
