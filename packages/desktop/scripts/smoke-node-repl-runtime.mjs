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
const dataDir = await mkdtemp(path.join(tmpdir(), "anybox-node-repl-runtime-"))
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
  const retiredComputerUse = servers.data?.find?.((item) => item.id === "anybox.computer-use")
  if (retiredComputerUse) {
    throw new Error("Packaged Agent still registers the retired anybox.computer-use MCP.")
  }
  const nodeReplDiagnostic = await request(
    "/api/mcp/servers/anybox.node-repl/diagnostic",
    30_000,
  )
  if (!nodeReplDiagnostic.data?.ok || nodeReplDiagnostic.data?.toolCount !== 3) {
    throw new Error(
      `Packaged Node REPL diagnostic failed: ${JSON.stringify(nodeReplDiagnostic.data)}`,
    )
  }
  const packagedNodeReplSource = [
    await readFile(path.join(runtimeDir, "mcp", "node-repl", "server.js"), "utf8"),
    await readFile(path.join(runtimeDir, "mcp", "node-repl", "kernel.js"), "utf8"),
  ].join("\n")
  if (!packagedNodeReplSource.includes("requestPermission")) {
    throw new Error("Packaged Node REPL is missing generic in-process permission support.")
  }
  for (const retiredMarker of ["callPluginCapability", "anybox/plugin-capability/call"]) {
    if (packagedNodeReplSource.includes(retiredMarker)) {
      throw new Error(`Packaged Node REPL still contains retired capability bridge marker '${retiredMarker}'.`)
    }
  }
  console.log(JSON.stringify({
    ok: true,
    nodeRepl: {
      serverID: nodeRepl.id,
      owner: nodeRepl.owner,
      toolCount: nodeReplDiagnostic.data.toolCount,
      toolNames: nodeReplDiagnostic.data.toolNames,
      genericPermissionRequests: true,
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
