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
  const responseMeta = []
  const lifecycleHooks = new Set()
  let stateCounter = 0
  const nodeRepl = {
    async callPluginCapability(capability, operation, args) {
      calls.push({ capability, operation, args })
      assert.equal(capability, "computer-use")
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
        }, [{ type: "image", data: Buffer.from("png").toString("base64"), mimeType: "image/png" }])
      }
      return result({ stateConsumed: operation !== "launch_app" })
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
  }
  return {
    globals: { nodeRepl },
    calls,
    images,
    responseMeta,
    emitLifecycle: async (type) => {
      for (const hook of lifecycleHooks) await hook({ type })
    },
  }
}

function result(structuredContent, extraContent = []) {
  return {
    content: [{ type: "text", text: "ok" }, ...extraContent],
    structuredContent: { ok: true, ...structuredContent },
    isError: false,
  }
}

test("installs a Codex-style sky API while using only the generic plugin bridge", async () => {
  const fixture = createGlobals()
  const sky = await setupComputerUseRuntime({ globals: fixture.globals })
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
    capability: "computer-use",
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
  })
  await assert.rejects(
    sky.click({ window: windows[0], element_index: 7 }),
    /No fresh state exists/u,
  )
  assert.equal(
    fixture.responseMeta.some((meta) => meta["anybox/toolSurface"]?.kind === "computerUse"),
    true,
  )
})

test("maps app launch, key chords, coordinates, and lifecycle state inside the plugin", async () => {
  const fixture = createGlobals()
  const sky = await setupComputerUseRuntime({ globals: fixture.globals })
  const apps = await sky.list_apps()
  assert.equal(apps[0].id, "win32:notepad.exe:fixture")
  assert.equal(apps[0].windows[0].id, 1)

  await sky.launch_app({ app: apps[0].id })
  assert.equal(fixture.calls.at(-1).operation, "launch_app")
  assert.equal(fixture.calls.at(-1).args.appId, apps[0].id)
  await assert.rejects(
    sky.launch_app({ app: "C:\\Windows\\notepad.exe" }),
    /not in the current approved catalog/u,
  )

  const windows = await sky.list_windows()
  await sky.get_window_state({ window: windows[0] })
  await sky.press_key({ window: windows[0], key: "Control_L + Shift_L + period" })
  assert.deepEqual(fixture.calls.at(-1).args.keys, ["ctrl", "shift", "."])

  await sky.get_window_state({ window: windows[0] })
  await sky.scroll({
    window: windows[0],
    x: 10,
    y: 20,
    scrollX: 0,
    scrollY: 100,
  })
  assert.equal(fixture.calls.at(-1).args.screenshotId, "shot_2")

  await sky.get_window_state({ window: windows[0] })
  await fixture.emitLifecycle("turn-end")
  await assert.rejects(
    sky.type_text({ window: windows[0], text: "blocked after turn" }),
    /unknown or expired|Window returned/u,
  )
})
