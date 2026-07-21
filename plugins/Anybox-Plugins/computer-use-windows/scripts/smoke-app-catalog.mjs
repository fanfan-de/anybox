import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { HelperClient } = require("./lib/helper-client")

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(scriptDirectory, "..")
const helperPath = path.join(pluginRoot, "helper", "win32-x64", "computer-use-helper.exe")
const testAppPath = path.join(
  pluginRoot,
  ".cache",
  "test-app-build",
  "bin",
  "ComputerUse.TestApp",
  "release",
  "computer-use-test-app.exe",
)
const targetTitle = "Anybox Computer Use Test Fixture"
const testProcessName = "computer-use-test-app.exe"

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function waitForReady(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = ""
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out waiting for the application catalog fixture."))
    }, timeoutMs)
    const onData = (chunk) => {
      buffer += chunk.toString("utf8")
      const newline = buffer.indexOf("\n")
      if (newline < 0) return
      cleanup()
      resolve(JSON.parse(buffer.slice(0, newline)))
    }
    const onExit = (code) => {
      cleanup()
      reject(new Error(`Application catalog fixture exited before ready (${code}).`))
    }
    const cleanup = () => {
      clearTimeout(timeout)
      child.stdout.off("data", onData)
      child.off("exit", onExit)
    }
    child.stdout.on("data", onData)
    child.once("exit", onExit)
  })
}

async function startFixture() {
  const child = spawn(testAppPath, [], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  try {
    await waitForReady(child)
    return child
  } catch (error) {
    child.kill()
    throw error
  }
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return
  const exited = new Promise((resolve) => child.once("exit", resolve))
  child.kill()
  await Promise.race([exited, delay(2000)])
}

async function waitForLaunchedWindow(helper, originalPid, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  do {
    const result = await helper.call("list_windows")
    const launched = result.windows?.find((window) =>
      window.title === targetTitle
      && window.processName === testProcessName
      && window.identity.pid !== originalPid,
    )
    if (launched) return launched
    await delay(100)
  } while (Date.now() < deadline)
  throw new Error("Catalog launch did not create a second controlled fixture window.")
}

async function main() {
  const helper = new HelperClient({
    helperPath,
    cwd: pluginRoot,
    defaultTimeoutMs: 20_000,
    defaultContext: {
      sessionID: "smoke-app-catalog",
      turnID: "smoke-app-catalog",
      toolCallID: "smoke-app-catalog",
    },
  })
  let fixture
  let launchedPid
  try {
    fixture = await startFixture()
    const first = await helper.call("list_apps", {}, { timeoutMs: 30_000 })
    const firstFixture = first.apps.find((app) => app.processName === testProcessName)
    assert.ok(firstFixture, "running fixture must appear in the application catalog")
    assert.equal(firstFixture.blocked, false)
    assert.equal(firstFixture.canLaunch, true)
    assert.match(firstFixture.appId, /^win32:computer-use-test-app\.exe:[a-f0-9]{16}$/u)

    const serialized = JSON.stringify(first.apps)
    assert.equal(serialized.includes("C:\\Projects\\Anybox"), false)
    assert.equal(serialized.includes("executablePath"), false)
    assert.ok(first.apps.some((app) => app.blocked), "catalog should retain blocked apps for explanation")

    const second = await helper.call("list_apps", {}, { timeoutMs: 30_000 })
    const fixtureEntry = second.apps.find((app) => app.processName === testProcessName)
    assert.equal(fixtureEntry.appId, firstFixture.appId)
    assert.notEqual(fixtureEntry.catalogRef, firstFixture.catalogRef)

    await assert.rejects(
      helper.call("launch_app", {
        catalogRef: "catalog_forged",
        appId: "win32:forged.exe:0000000000000000",
        executablePath: "C:\\Windows\\System32\\cmd.exe",
        arguments: ["/c", "whoami"],
      }),
      (error) => error?.code === "CU_INVALID_ARGUMENT",
    )
    await assert.rejects(
      helper.call("launch_app", {
        catalogRef: "catalog_forged",
        appId: "win32:forged.exe:0000000000000000",
      }),
      (error) => error?.code === "CU_APP_APPROVAL_REQUIRED",
    )

    await helper.call("launch_app", {
      catalogRef: fixtureEntry.catalogRef,
      appId: fixtureEntry.appId,
    })
    const launched = await waitForLaunchedWindow(helper, fixture.pid)
    launchedPid = launched.identity.pid
    assert.notEqual(launchedPid, fixture.pid)

    process.stdout.write(`${JSON.stringify({
      ok: true,
      appCount: second.apps.length,
      blockedAppCount: second.apps.filter((app) => app.blocked).length,
      stableAppId: true,
      arbitraryPathRejected: true,
      controlledLaunchVerified: true,
      packagedAppCount: second.apps.filter((app) => app.kind === "packaged").length,
    }, null, 2)}\n`)
  } finally {
    helper.stop()
    if (launchedPid) {
      try {
        process.kill(launchedPid)
      } catch {
        // The controlled launched fixture may already have closed.
      }
    }
    await stopProcess(fixture)
  }
}

await main()
