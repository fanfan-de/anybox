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
const foregroundTitle = "Anybox Computer Use Foreground Fixture"

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function waitForReady(child, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let buffer = ""
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out waiting for the UIA fixture window."))
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
      reject(new Error(`UIA fixture exited before ready (${code}).`))
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

async function startFixture(args = []) {
  const child = spawn(testAppPath, args, {
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

async function stopFixture(child) {
  if (!child || child.exitCode !== null) return
  const exited = new Promise((resolve) => child.once("exit", resolve))
  child.kill()
  await Promise.race([exited, delay(2000)])
}

async function waitForWindow(helper, title = targetTitle, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  do {
    const result = await helper.call("list_windows")
    const match = result.windows?.find((window) => window.title === title)
    if (match) return match
    await delay(75)
  } while (Date.now() < deadline)
  throw new Error("Timed out waiting for the UIA fixture in helper window discovery.")
}

async function observe(helper, window, includeDocumentText = false) {
  const state = await helper.call("get_window_state", {
    expectedIdentity: window.identity,
    includeScreenshot: false,
    includeAccessibility: true,
    includeDocumentText,
  }, { timeoutMs: 30_000 })
  assert.equal(state.accessibilityStatus, "ok")
  assert.match(state.nativeStateRef, /^native_[a-f0-9]{24}$/u)
  assert.match(state.accessibility.revision, /^uia_[a-f0-9]{20}$/u)
  assert.ok(Array.isArray(state.accessibility.elementIndexes))
  return state
}

function findElement(accessibility, role, text) {
  for (const line of accessibility.tree.split(/\r?\n/u)) {
    const match = /^\s*\[(\d+)\]\s+(\S+)\s*(.*)$/u.exec(line)
    if (!match || match[2] !== role || !match[3].includes(text)) continue
    const index = Number(match[1])
    assert.ok(accessibility.elementIndexes.includes(index))
    return { index, line }
  }
  throw new Error(`Could not find UIA element: ${role} containing ${text}\n${accessibility.tree}`)
}

function actionParameters(window, state, action) {
  return {
    expectedIdentity: window.identity,
    observedBounds: state.window.bounds,
    observedDpiScale: state.window.dpiScale,
    observedInputEpoch: state.inputEpoch,
    imageWidth: 0,
    imageHeight: 0,
    nativeStateRef: state.nativeStateRef,
    accessibilityRevision: state.accessibility.revision,
    action,
  }
}

async function main() {
  const helper = new HelperClient({
    helperPath,
    cwd: pluginRoot,
    defaultTimeoutMs: 10_000,
    defaultContext: {
      sessionID: "smoke-uia",
      turnID: "smoke-uia",
      toolCallID: "smoke-uia",
    },
  })
  let fixture
  let foregroundFixture
  try {
    fixture = await startFixture()
    let window = await waitForWindow(helper)
    foregroundFixture = await startFixture([
      "--title",
      foregroundTitle,
      "--left",
      "900",
      "--top",
      "140",
    ])
    const foregroundWindow = await waitForWindow(helper, foregroundTitle)
    await helper.call("activate_window", {
      expectedIdentity: foregroundWindow.identity,
    })

    const initial = await observe(helper, window, true)
    const serialized = JSON.stringify(initial.accessibility)
    assert.ok(initial.accessibility.tree.length <= 256 * 1024)
    assert.equal(initial.accessibility.truncated, false)
    assert.equal(serialized.includes("do-not-export-this-secret"), false)
    assert.equal(serialized.includes("fixture-ready"), true)
    assert.ok(initial.accessibility.documentText?.includes("fixture-ready"))
    assert.equal(initial.accessibility.documentText?.includes("do-not-export-this-secret"), false)
    const windowsBeforeSemanticClick = await helper.call("list_windows")
    assert.equal(
      windowsBeforeSemanticClick.windows.find(
        (candidate) => candidate.identity.hwnd === window.identity.hwnd,
      )?.isForeground,
      false,
    )

    const button = findElement(initial.accessibility, "button", "Increment")
    const clickParameters = actionParameters(window, initial, {
      type: "click_element",
      elementIndex: button.index,
      button: "left",
      clickCount: 1,
    })
    const semanticClick = await helper.call("perform_action", clickParameters)
    assert.equal(semanticClick.inputMode, "uia")
    await assert.rejects(
      helper.call("perform_action", clickParameters),
      (error) => error?.code === "CU_STATE_CONSUMED",
    )

    await delay(150)
    const afterClick = await observe(helper, window)
    assert.ok(
      afterClick.accessibility.tree.includes("Count: 1"),
      `InvokePattern did not update the fixture counter:\n${afterClick.accessibility.tree}`,
    )
    const editable = findElement(afterClick.accessibility, "edit", "Editable value")
    await helper.call("perform_action", actionParameters(window, afterClick, {
      type: "set_value",
      elementIndex: editable.index,
      value: "uia-updated",
    }))

    const afterSetValue = await observe(helper, window)
    assert.ok(afterSetValue.accessibility.tree.includes("value=\"uia-updated\""))
    const password = findElement(afterSetValue.accessibility, "edit", "Secret value")
    assert.ok(password.line.includes("password"))
    assert.equal(password.line.includes("value="), false)
    await assert.rejects(
      helper.call("perform_action", actionParameters(window, afterSetValue, {
        type: "set_value",
        elementIndex: password.index,
        value: "must-not-be-injected",
      })),
      (error) => error?.code === "CU_APP_BLOCKED",
    )

    const beforeToggle = await observe(helper, window)
    const checkbox = findElement(beforeToggle.accessibility, "checkbox", "Controlled test checkbox")
    assert.ok(checkbox.line.includes("secondary=toggle"))
    assert.ok(checkbox.line.includes("unchecked"))
    await helper.call("perform_action", actionParameters(window, beforeToggle, {
      type: "perform_secondary_action",
      elementIndex: checkbox.index,
      secondaryAction: "toggle",
    }))
    const afterToggle = await observe(helper, window)
    const checked = findElement(afterToggle.accessibility, "checkbox", "Controlled test checkbox")
    assert.ok(checked.line.includes("checked"))

    const staleRevision = await observe(helper, window)
    const staleButton = findElement(staleRevision.accessibility, "button", "Increment")
    const staleParameters = actionParameters(window, staleRevision, {
      type: "click_element",
      elementIndex: staleButton.index,
      button: "left",
      clickCount: 1,
    })
    staleParameters.accessibilityRevision = "uia_wrong_revision"
    await assert.rejects(
      helper.call("perform_action", staleParameters),
      (error) => error?.code === "CU_UIA_STALE",
    )

    await stopFixture(fixture)
    fixture = await startFixture(["--mutate-after-ms", "800"])
    window = await waitForWindow(helper)
    const beforeMutation = await observe(helper, window)
    const mutationButton = findElement(beforeMutation.accessibility, "button", "Increment")
    await delay(1100)
    await assert.rejects(
      helper.call("perform_action", actionParameters(window, beforeMutation, {
        type: "click_element",
        elementIndex: mutationButton.index,
        button: "left",
        clickCount: 1,
      })),
      (error) => error?.code === "CU_UIA_STALE",
    )

    await stopFixture(fixture)
    fixture = await startFixture(["--extra-controls", "2100"])
    window = await waitForWindow(helper)
    const bounded = await observe(helper, window)
    assert.equal(bounded.accessibility.truncated, true)
    assert.ok(bounded.accessibility.elementIndexes.length <= 2000)
    assert.ok(bounded.accessibility.tree.length <= 256 * 1024)

    process.stdout.write(`${JSON.stringify({
      ok: true,
      accessibilityBackend: "uia",
      initialNodeCount: initial.accessibility.elementIndexes.length,
      treeCharacters: initial.accessibility.tree.length,
      passwordValueFiltered: true,
      boundedDocumentText: true,
      invokePattern: true,
      backgroundInvokeSucceeded: true,
      valuePattern: true,
      togglePattern: true,
      toggleStateReported: true,
      oneActionNativeState: true,
      staleRevisionRejected: true,
      changedTreeRejected: true,
      boundedTree: {
        truncated: bounded.accessibility.truncated,
        nodeCount: bounded.accessibility.elementIndexes.length,
        characters: bounded.accessibility.tree.length,
      },
    }, null, 2)}\n`)
  } finally {
    helper.stop()
    await stopFixture(foregroundFixture)
    await stopFixture(fixture)
  }
}

await main()
