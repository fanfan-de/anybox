import assert from "node:assert/strict"
import { access, readFile, readdir } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..")
const agentRoot = path.join(repoRoot, "packages", "anyboxagent")
const sharedRoot = path.join(repoRoot, "packages", "shared")
const generatedPluginRoot = path.join(
  repoRoot,
  "plugins",
  "Anybox-Plugins",
  "chrome",
)

async function filesUnder(root) {
  const files = []
  async function visit(directory) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === "ENOENT") return
      throw error
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(target)
      } else if (entry.isFile()) {
        files.push(target)
      }
    }
  }
  await visit(root)
  return files
}

test("keeps Chrome runtime business out of AnyboxAgent and shared core", async () => {
  assert.deepEqual(
    await filesUnder(path.join(agentRoot, "src", "browser-extension")),
    [],
  )
  const sourceFiles = (
    await filesUnder(path.join(agentRoot, "src"))
  ).filter((file) => /\.(?:c|m)?(?:j|t)s$/.test(file))
  sourceFiles.push(
    path.join(agentRoot, "connectors", "node-repl", "server.js"),
  )
  const forbidden = [
    "@anybox/chrome-shared",
    "@anybox/shared/browser-",
    "BrowserIpcGateway",
    "runBrowserRuntimeCommand",
    "ANYBOX_BROWSER_IPC_",
    "anybox/node-repl/host-request",
    "nodeRepl.requestHost",
  ]
  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8")
    for (const marker of forbidden) {
      assert.equal(
        source.includes(marker),
        false,
        `${path.relative(repoRoot, file)} contains Chrome runtime marker ${marker}`,
      )
    }
  }

  const sharedFiles = await filesUnder(path.join(sharedRoot, "src"))
  assert.equal(
    sharedFiles.some((file) => /browser-(?:contract|extension|ipc)/.test(file)),
    false,
  )
  const sharedPackage = await readFile(
    path.join(sharedRoot, "package.json"),
    "utf8",
  )
  assert.doesNotMatch(sharedPackage, /browser-(?:contract|extension|ipc)/)
})

test("ships Browser Client and Browser Host together inside the Chrome plugin", async () => {
  for (const filename of [
    "browser-client.mjs",
    "browser-host.mjs",
    "ipc-listener-sidecar.mjs",
  ]) {
    await access(path.join(generatedPluginRoot, "scripts", filename))
  }
  const browserClient = await readFile(
    path.join(generatedPluginRoot, "scripts", "browser-client.mjs"),
    "utf8",
  )
  assert.match(browserClient, /browser-host\.mjs/)
  assert.doesNotMatch(browserClient, /\brequestHost\b/)
})
