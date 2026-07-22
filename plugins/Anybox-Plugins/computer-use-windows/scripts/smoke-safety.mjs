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
const occluderTitle = "Anybox Computer Use Test Occluder"

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function waitForReady(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = ""
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out waiting for the safety fixture."))
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
      reject(new Error(`Safety fixture exited before ready (${code}).`))
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
    child.fixtureReady = await waitForReady(child)
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

async function waitForWindow(helper, title, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  do {
    const result = await helper.call("list_windows")
    const match = result.windows?.find((window) => window.title === title)
    if (match) return match
    await delay(75)
  } while (Date.now() < deadline)
  throw new Error(`Timed out waiting for safety window: ${title}`)
}

async function observe(helper, window) {
  return helper.call("get_window_state", {
    expectedIdentity: window.identity,
    includeScreenshot: true,
    includeAccessibility: true,
    includeDocumentText: false,
  }, { timeoutMs: 30_000 })
}

async function waitForAccessibilityText(
  helper,
  window,
  candidates,
  timeoutMs = 5_000,
) {
  const expected = Array.isArray(candidates) ? candidates : [candidates]
  const deadline = Date.now() + timeoutMs
  do {
    const state = await observe(helper, window)
    const match = expected.find((text) =>
      state.accessibility.tree.includes(text)
    )
    if (match) return { match, state }
    await delay(75)
  } while (Date.now() < deadline)
  throw new Error(
    `Timed out waiting for controlled accessibility status: ${expected.join(" | ")}`,
  )
}

function findElement(accessibility, role, text) {
  for (const line of accessibility.tree.split(/\r?\n/u)) {
    const index = /^\s*\[(\d+)\]\s+(\S+)\s+(.*)$/u.exec(line)
    if (!index || index[2] !== role || !index[3].includes(text)) continue
    const bounds = /bounds=\((-?\d+),(-?\d+),(\d+),(\d+)\)/u.exec(line)
    return {
      index: Number(index[1]),
      line,
      bounds: bounds
        ? {
            x: Number(bounds[1]),
            y: Number(bounds[2]),
            width: Number(bounds[3]),
            height: Number(bounds[4]),
          }
        : null,
    }
  }
  throw new Error(`Could not find ${role} ${text} in controlled UIA tree.`)
}

function actionParameters(window, state, action) {
  return {
    expectedIdentity: window.identity,
    observedBounds: state.window.bounds,
    observedDpiScale: state.window.dpiScale,
    observedInputEpoch: state.inputEpoch,
    imageWidth: state.screenshot?.width ?? 0,
    imageHeight: state.screenshot?.height ?? 0,
    nativeStateRef: state.nativeStateRef,
    accessibilityRevision: state.accessibility?.revision,
    action,
  }
}

function integrityRank(level) {
  return ["untrusted", "low", "medium", "high", "system"].indexOf(level)
}

async function main() {
  const helper = new HelperClient({
    helperPath,
    cwd: pluginRoot,
    defaultTimeoutMs: 10_000,
    defaultContext: {
      sessionID: "smoke-safety",
      turnID: "smoke-safety",
      toolCallID: "smoke-safety",
    },
  })
  let target
  let occluder
  try {
    target = await startFixture(["--pointer-takeover-after-ms", "3000"])
    const health = await helper.call("health_check")
    assert.equal(health.features.physicalInputEpoch, true)
    let window = await waitForWindow(helper, targetTitle)
    assert.ok(integrityRank(health.helperIntegrityLevel) >= 0)
    assert.ok(integrityRank(window.identity.integrityLevel) >= 0)
    assert.ok(
      integrityRank(window.identity.integrityLevel) <= integrityRank(health.helperIntegrityLevel),
    )

    const beforeTakeover = await observe(helper, window)
    const button = findElement(beforeTakeover.accessibility, "button", "Increment")
    await delay(3500)
    const afterTakeoverDiscovery = await helper.call("resolve_window", {
      expectedIdentity: window.identity,
    })
    assert.ok(afterTakeoverDiscovery.inputEpoch > beforeTakeover.inputEpoch)
    await assert.rejects(
      helper.call("perform_action", actionParameters(window, beforeTakeover, {
        type: "click_element",
        elementIndex: button.index,
        button: "left",
        clickCount: 1,
      })),
      (error) => error?.code === "CU_USER_INPUT_DETECTED",
    )

    const fresh = await observe(helper, window)
    const freshButton = findElement(fresh.accessibility, "button", "Increment")
    await helper.call("perform_action", actionParameters(window, fresh, {
      type: "click_element",
      elementIndex: freshButton.index,
      button: "left",
      clickCount: 1,
    }))
    await delay(100)
    const afterInvoke = await observe(helper, window)
    assert.ok(afterInvoke.accessibility.tree.includes("Count: 1"))
    const coordinateButton = findElement(afterInvoke.accessibility, "button", "Increment")
    assert.ok(coordinateButton.bounds)
    const x = Math.round(
      coordinateButton.bounds.x
      + coordinateButton.bounds.width / 2
      - afterInvoke.window.bounds.x,
    )
    const y = Math.round(
      coordinateButton.bounds.y
      + coordinateButton.bounds.height / 2
      - afterInvoke.window.bounds.y,
    )

    occluder = await startFixture(["--occluder"])
    await waitForWindow(helper, occluderTitle)
    await delay(750)
    const coveredScreenPoint = {
      x: afterInvoke.window.bounds.x
        + Math.round(x * afterInvoke.window.bounds.width / afterInvoke.screenshot.width),
      y: afterInvoke.window.bounds.y
        + Math.round(y * afterInvoke.window.bounds.height / afterInvoke.screenshot.height),
    }
    const occluderBounds = occluder.fixtureReady.bounds
    assert.ok(
      coveredScreenPoint.x >= occluderBounds.x
        && coveredScreenPoint.x < occluderBounds.x + occluderBounds.width
        && coveredScreenPoint.y >= occluderBounds.y
        && coveredScreenPoint.y < occluderBounds.y + occluderBounds.height,
      "The controlled occluder must geometrically cover the tested input point.",
    )
    const coveredParameters = actionParameters(window, afterInvoke, {
      type: "click",
      x,
      y,
      button: "left",
      clickCount: 1,
    })
    await assert.rejects(
      helper.call("perform_action", coveredParameters),
      (error) => error?.code === "CU_POINT_OUTSIDE_TARGET",
    )
    await assert.rejects(
      helper.call("perform_action", coveredParameters),
      (error) => error?.code === "CU_STATE_CONSUMED",
    )
    await stopFixture(occluder)
    occluder = undefined

    const coordinateState = await observe(helper, window)
    const coordinateTarget = findElement(
      coordinateState.accessibility,
      "button",
      "Increment",
    )
    const coordinateX = Math.round(
      coordinateTarget.bounds.x
      + coordinateTarget.bounds.width / 2
      - coordinateState.window.bounds.x,
    )
    const coordinateY = Math.round(
      coordinateTarget.bounds.y
      + coordinateTarget.bounds.height / 2
      - coordinateState.window.bounds.y,
    )
    await helper.call("perform_action", actionParameters(window, coordinateState, {
      type: "click",
      x: coordinateX,
      y: coordinateY,
      button: "left",
      clickCount: 1,
    }))
    await delay(150)
    const afterCoordinate = await observe(helper, window)
    assert.ok(afterCoordinate.accessibility.tree.includes("Count: 2"))
    const afterSyntheticInput = await helper.call("resolve_window", {
      expectedIdentity: window.identity,
    })
    assert.equal(afterSyntheticInput.inputEpoch, coordinateState.inputEpoch)

    await stopFixture(target)
    target = await startFixture(["--clipboard-takeover"])
    window = await waitForWindow(helper, targetTitle)
    const passwordFocusState = await observe(helper, window)
    const password = findElement(
      passwordFocusState.accessibility,
      "edit",
      "Secret value",
    )
    await helper.call("perform_action", actionParameters(window, passwordFocusState, {
      type: "click_element",
      elementIndex: password.index,
      button: "left",
      clickCount: 1,
    }))
    const passwordTypingState = await observe(helper, window)
    await assert.rejects(
      helper.call("perform_action", actionParameters(window, passwordTypingState, {
        type: "type_text",
        text: "must-not-type-into-password",
      })),
      (error) => error?.code === "CU_APP_BLOCKED",
    )

    const nonEditableFocusState = await observe(helper, window)
    const nonEditableButton = findElement(
      nonEditableFocusState.accessibility,
      "button",
      "Increment",
    )
    await helper.call("perform_action", actionParameters(window, nonEditableFocusState, {
      type: "click_element",
      elementIndex: nonEditableButton.index,
      button: "left",
      clickCount: 2,
    }))
    const buttonTypingState = await observe(helper, window)
    const focusedButton = findElement(
      buttonTypingState.accessibility,
      "button",
      "Increment",
    )
    assert.ok(focusedButton.line.includes("focused"))
    await assert.rejects(
      helper.call("perform_action", actionParameters(window, buttonTypingState, {
        type: "type_text",
        text: "must-not-type-without-editable-focus",
      })),
      (error) => error?.code === "CU_FOCUS_NOT_EDITABLE",
    )

    const focusState = await observe(helper, window)
    const editable = findElement(focusState.accessibility, "edit", "Editable value")
    await helper.call("perform_action", actionParameters(window, focusState, {
      type: "click_element",
      elementIndex: editable.index,
      button: "left",
      clickCount: 1,
    }))
    const typingState = await observe(helper, window)
    const focusedEdit = findElement(typingState.accessibility, "edit", "Editable value")
    assert.ok(focusedEdit.index >= 0)
    await helper.call("perform_action", actionParameters(window, typingState, {
      type: "type_text",
      text: "ANYBOX-CLIPBOARD-TEMP-测试",
    }))
    const clipboardResult = await waitForAccessibilityText(helper, window, [
      "Clipboard concurrent value preserved",
      "Clipboard concurrent value overwritten",
    ])
    assert.equal(
      clipboardResult.match,
      "Clipboard concurrent value preserved",
    )
    await waitForAccessibilityText(helper, window, "Clipboard original restored")

    process.stdout.write(`${JSON.stringify({
      ok: true,
      physicalInputEpoch: {
        before: beforeTakeover.inputEpoch,
        after: afterTakeoverDiscovery.inputEpoch,
        staleStateRejected: true,
      },
      integrity: {
        helper: health.helperIntegrityLevel,
        target: window.identity.integrityLevel,
      },
      coveredPointRejected: true,
      coordinateFallbackVerified: true,
      syntheticInputIgnoredByEpoch: true,
      passwordTypingBlocked: true,
      nonEditableFocusRejected: true,
      clipboardConcurrentValuePreserved: true,
      clipboardOriginalRestoredByFixture: true,
    }, null, 2)}\n`)
  } finally {
    helper.stop()
    await stopFixture(occluder)
    await stopFixture(target)
  }
}

await main()
