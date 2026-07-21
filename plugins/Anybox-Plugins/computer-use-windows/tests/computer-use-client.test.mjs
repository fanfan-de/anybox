import assert from "node:assert/strict"
import test from "node:test"
import { setupComputerUseRuntime } from "../scripts/computer-use-client.mjs"

function fixtureWindow() {
  return {
    windowRef: "win_fixture",
    appId: "win32:notepad.exe:fixture",
    title: "Fixture Notepad",
    processName: "notepad.exe",
    blocked: false,
  }
}

function createGlobals() {
  const calls = []
  const images = []
  const permissions = []
  const responseMeta = []
  const closes = []
  const lifecycleHooks = new Set()
  const afterSubmittedCodeHooks = new Set()
  let stateCounter = 0
  const runtime = {
    async callOperation(operation, args, context) {
      calls.push({ operation, args, context })
      if (operation === "list_windows") {
        return result({ windows: [fixtureWindow()] })
      }
      if (operation === "get_window") {
        return result({ window: fixtureWindow() })
      }
      if (operation === "list_apps") {
        return result({
          apps: [{
            appRef: "app_fixture",
            appId: "win32:notepad.exe:fixture",
            displayName: "Fixture Notepad",
            isRunning: true,
            blocked: false,
            windows: [fixtureWindow()],
          }],
        })
      }
      if (operation === "get_window_state") {
        stateCounter += 1
        return result({
          stateRef: `state_${stateCounter}`,
          window: fixtureWindow(),
          screenshots: [{
            id: `shot_${stateCounter}`,
            originX: 0,
            originY: 0,
            width: 640,
            height: 480,
            zIndex: 0,
          }],
          accessibility: {
            tree: "[7] button \"Open\"",
            focusedElement: "[7] button \"Open\"",
            selectedText: null,
            selectedElements: [],
            documentText: "Fixture",
          },
        }, [{ data: Buffer.from("png").toString("base64"), mimeType: "image/png" }])
      }
      return result({ stateConsumed: operation !== "launch_app" })
    },
    async close(context) {
      await Promise.resolve()
      closes.push(context)
    },
  }
  const nodeRepl = {
    requestMeta: {
      sessionID: "session-fixture",
      turnID: "turn-fixture",
      messageID: "message-fixture",
      toolCallID: "tool-fixture",
    },
    async requestPermission(input) {
      permissions.push(input)
      return { allowed: true, decision: "allow-once", action: "accept" }
    },
    async emitImage(image) {
      images.push(image)
    },
    setResponseMeta(meta) {
      responseMeta.push(meta)
    },
    addLifecycleHook(hook) {
      lifecycleHooks.add(hook)
      return () => lifecycleHooks.delete(hook)
    },
    addAfterSubmittedCodeHook(hook) {
      afterSubmittedCodeHooks.add(hook)
      return () => afterSubmittedCodeHooks.delete(hook)
    },
  }
  return {
    globals: { nodeRepl },
    runtime,
    calls,
    images,
    permissions,
    responseMeta,
    closes,
    emitLifecycle: async (type) => {
      for (const hook of lifecycleHooks) await hook({ type })
    },
    emitSubmitted: async () => {
      for (const hook of afterSubmittedCodeHooks) await hook({ ok: true })
    },
  }
}

function result(data, images = []) {
  return {
    summary: "ok",
    data: { ok: true, ...data },
    images,
  }
}

test("installs a Codex-style sky API backed by the plugin-owned runtime", async () => {
  const fixture = createGlobals()
  const sky = await setupComputerUseRuntime({
    globals: fixture.globals,
    runtime: fixture.runtime,
  })
  assert.equal(fixture.globals.sky, sky)
  assert.equal(sky.target, "windows")

  const windows = await sky.list_windows()
  assert.deepEqual(windows, [{
    app: "win32:notepad.exe:fixture",
    id: 1,
    title: "Fixture Notepad",
  }])
  assert.deepEqual(await sky.get_window({ id: 1, app: windows[0].app }), windows[0])

  const state = await sky.get_window_state({
    window: windows[0],
    include_screenshot: true,
    include_text: true,
  })
  assert.equal(state.window.id, 1)
  assert.equal(state.accessibility.focused_element, "[7] button \"Open\"")
  assert.equal(state.accessibility.document_text, "Fixture")
  assert.match(state.screenshots[0].url, /^data:image\/png;base64,/u)
  assert.equal(fixture.images.length, 1)
  assert.equal("stateRef" in state, false)
  assert.equal("windowRef" in state.window, false)

  await sky.click({ window: windows[0], element_index: 7 })
  const click = fixture.calls.at(-1)
  assert.deepEqual(click, {
    operation: "click",
    args: {
      windowRef: "win_fixture",
      stateRef: "state_1",
      purpose: "Click the selected control",
      safety: "normal",
      button: "left",
      clickCount: 1,
      elementIndex: 7,
    },
    context: {
      signal: click.context.signal,
      requestMeta: fixture.globals.nodeRepl.requestMeta,
    },
  })
  assert.equal(fixture.permissions.length, 0)
  await assert.rejects(
    sky.click({ window: windows[0], element_index: 7 }),
    /No fresh state exists/u,
  )
  assert.equal(
    fixture.responseMeta.some((meta) => meta["anybox/toolSurface"]?.kind === "computerUse"),
    true,
  )
})

test("asks only for high-impact actions and keeps entered text redacted", async () => {
  const fixture = createGlobals()
  const sky = await setupComputerUseRuntime({
    globals: fixture.globals,
    runtime: fixture.runtime,
  })
  const windows = await sky.list_windows()

  await sky.get_window_state({ window: windows[0] })
  await sky.type_text({
    window: windows[0],
    text: "private fixture text",
    purpose: "Send a fixture message",
    safety: "submit_or_send",
  })

  assert.equal(fixture.permissions.length, 1)
  assert.equal(fixture.permissions[0].scope.kind, "plugin-action")
  assert.equal(fixture.permissions[0].scope.pluginID, "computer-use-windows")
  assert.equal(fixture.permissions[0].method, "type_text")
  assert.equal(fixture.permissions[0].risk, "high")
  assert.equal(fixture.permissions[0].sensitive, true)
  assert.equal(fixture.permissions[0].scope.actionBody.includes("private fixture text"), false)
  assert.equal(fixture.permissions[0].scope.actionBody.includes("<redacted; 20 characters>"), true)
})

test("maps app launch, key chords, coordinates, and lifecycle state inside the plugin", async () => {
  const fixture = createGlobals()
  const sky = await setupComputerUseRuntime({
    globals: fixture.globals,
    runtime: fixture.runtime,
  })
  const apps = await sky.list_apps()
  assert.equal(apps[0].id, "win32:notepad.exe:fixture")
  assert.equal(apps[0].windows[0].id, 1)

  await sky.launch_app({ app: apps[0].id })
  assert.equal(fixture.calls.at(-1).operation, "launch_app")
  assert.equal(fixture.calls.at(-1).args.appId, apps[0].id)
  await fixture.emitSubmitted()
  await assert.rejects(
    sky.launch_app({ app: "C:\\Windows\\notepad.exe" }),
    /not in the current approved catalog/u,
  )

  const windows = await sky.list_windows()
  await sky.get_window_state({ window: windows[0] })
  await sky.press_key({ window: windows[0], key: "Control_L + Shift_L + period" })
  assert.deepEqual(fixture.calls.at(-1).args.keys, ["ctrl", "shift", "."])
  await fixture.emitSubmitted()

  await sky.get_window_state({ window: windows[0] })
  await sky.scroll({
    window: windows[0],
    x: 10,
    y: 20,
    scrollX: 0,
    scrollY: 100,
  })
  assert.equal(fixture.calls.at(-1).args.screenshotId, "shot_2")
  await fixture.emitSubmitted()

  await sky.get_window_state({ window: windows[0] })
  await fixture.emitLifecycle("turn-end")
  assert.equal(fixture.closes.length, 1)
  assert.deepEqual(fixture.closes[0]?.requestMeta, fixture.globals.nodeRepl.requestMeta)
  await assert.rejects(
    sky.type_text({ window: windows[0], text: "blocked after turn" }),
    /unknown or expired|Window returned/u,
  )
})
