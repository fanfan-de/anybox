import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { browserRuntimePaths } from "@anybox/chrome-shared/runtime-paths"
import { BROWSER_IPC_PROTOCOL_VERSION } from "@anybox/chrome-shared/browser-ipc"
import { BrowserIpcGateway } from "./ipc-gateway.ts"
import { browserExtensionBridge } from "./bridge.ts"
import * as Log from "./log.ts"

const BROWSER_HOST_VERSION = "0.12.0"
const IDLE_TIMEOUT_MS = 15 * 60_000
const log = Log.create({ service: "browser-host" })

const runtimeBootstrapPath = path.resolve(
  process.env.ANYBOX_BROWSER_HOST_BOOTSTRAP_PATH?.trim()
    || browserRuntimePaths().runtimeBootstrap,
)
const gateway = new BrowserIpcGateway()
let stopping = false
let lastConnectedAt = Date.now()

function writeRuntimeBootstrap() {
  mkdirSync(path.dirname(runtimeBootstrapPath), {
    recursive: true,
    mode: 0o700,
  })
  const document = {
    role: "runtime",
    transport: gateway.transport,
    protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
    brokerInstanceID: gateway.brokerInstanceID,
    endpoint: gateway.runtimeEndpoint,
    proof: gateway.runtimeProof,
    hostPID: process.pid,
    hostVersion: BROWSER_HOST_VERSION,
    nativeHostEndpoint: gateway.nativeHostEndpoint,
    nativeBootstrapPath: gateway.bootstrapPath,
    updatedAt: new Date().toISOString(),
  }
  const temporaryPath =
    `${runtimeBootstrapPath}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(document, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  if (process.platform !== "win32") chmodSync(temporaryPath, 0o600)
  renameSync(temporaryPath, runtimeBootstrapPath)
}

function removeRuntimeBootstrapIfOwned() {
  if (!existsSync(runtimeBootstrapPath)) return
  try {
    const parsed = JSON.parse(readFileSync(runtimeBootstrapPath, "utf8")) as {
      brokerInstanceID?: unknown
    }
    if (parsed.brokerInstanceID !== gateway.brokerInstanceID) return
    rmSync(runtimeBootstrapPath, { force: true })
  } catch {
    // Do not remove a file whose ownership cannot be proven.
  }
}

async function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  clearInterval(idleTimer)
  removeRuntimeBootstrapIfOwned()
  await gateway.stop().catch(() => undefined)
  process.exitCode = exitCode
}

await gateway.start()
writeRuntimeBootstrap()
log.info("ready", {
  transport: gateway.transport,
  hostVersion: BROWSER_HOST_VERSION,
})

const idleTimer = setInterval(() => {
  browserExtensionBridge.heartbeat()
  const status = gateway.status()
  if (status.runtimeConnections > 0 || status.nativeHostConnections > 0) {
    lastConnectedAt = Date.now()
    return
  }
  if (Date.now() - lastConnectedAt >= IDLE_TIMEOUT_MS) {
    void stop()
  }
}, 30_000)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void stop()
  })
}

process.on("uncaughtException", (error) => {
  log.error("uncaught-exception", { error })
  void stop(1)
})

process.on("unhandledRejection", (error) => {
  log.error("unhandled-rejection", { error })
  void stop(1)
})
