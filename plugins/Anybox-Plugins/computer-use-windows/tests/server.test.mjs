import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { ComputerUseServer } = require("../scripts/server")

const identity = {
  hwnd: "200",
  pid: 77,
  processStartTime: "638887000000000000",
  rootOwnerHwnd: "200",
  executableIdentity: "c:\\windows\\notepad.exe",
  sessionId: 1,
}
const window = {
  identity,
  title: "Untitled - Notepad",
  processName: "notepad.exe",
  appId: "process:notepad.exe",
  bounds: { x: 50, y: 50, width: 640, height: 480 },
  clientBounds: { x: 0, y: 30, width: 640, height: 450 },
  dpiScale: 1,
  minimized: false,
}

class MockHelper {
  constructor(options = {}) {
    this.actions = []
    this.requests = []
    this.launches = []
    this.failNextAction = false
    this.accessibility = options.accessibility ?? null
  }

  async ensureInitialized() {
    return { protocolVersion: 1, helperVersion: "0.2.0", capabilities: {} }
  }

  async call(method, params) {
    if (method === "health_check") {
      return {
        protocolVersion: 1,
        helperVersion: "0.2.0",
        platform: "win32-x64",
        captureBackend: "test",
        accessibilityBackend: "test",
        inputBackend: "test",
      }
    }
    if (method === "list_windows") return { windows: [window], inputEpoch: 0 }
    if (method === "list_apps") {
      return {
        apps: [{
          catalogRef: "catalog_fixture",
          appId: "win32:notepad.exe:0123456789abcdef",
          displayName: "Fixture Notepad",
          kind: "win32",
          processName: "notepad.exe",
          isRunning: true,
          canLaunch: true,
          blocked: false,
          windows: [window],
        }],
      }
    }
    if (method === "resolve_window") return { window, inputEpoch: 0 }
    if (method === "get_window_state") {
      return {
        window,
        inputEpoch: 0,
        nativeStateRef: `native_${Math.random().toString(16).slice(2)}`,
        screenshot: {
          imageBase64: Buffer.from("png").toString("base64"),
          width: 640,
          height: 480,
          originX: 0,
          originY: 0,
        },
        accessibility: this.accessibility,
        accessibilityStatus: this.accessibility ? "ok" : null,
      }
    }
    if (method === "perform_action") {
      if (this.failNextAction) {
        this.failNextAction = false
        const error = new Error("Injected action failure")
        error.code = "CU_INTERNAL_ERROR"
        throw error
      }
      this.requests.push(params)
      this.actions.push(params.action)
      return { ok: true, inputEpoch: 0 }
    }
    if (method === "launch_app") {
      this.launches.push(params)
      return { launched: true, appId: params.appId }
    }
    if (method === "activate_window") return { window, inputEpoch: 0 }
    throw new Error(`Unexpected method: ${method}`)
  }

  stop() {}
}

test("requires a fresh state for input and consumes it after one action", async () => {
  const helper = new MockHelper()
  const server = new ComputerUseServer({ helper })
  const listed = await server.callTool("list_windows")
  const windowRef = listed.structuredContent.windows[0].windowRef
  const observed = await server.callTool("get_window_state", {
    windowRef,
    includeScreenshot: true,
    includeAccessibility: false,
  })
  const stateRef = observed.structuredContent.stateRef
  const screenshotId = observed.structuredContent.screenshots[0].id

  const clicked = await server.callTool("click", {
    windowRef,
    stateRef,
    screenshotId,
    x: 10,
    y: 20,
    purpose: "Open a local menu",
    safety: "normal",
  })
  assert.equal(clicked.structuredContent.stateConsumed, true)
  assert.equal(helper.actions.length, 1)

  await assert.rejects(
    server.callTool("click", {
      windowRef,
      stateRef,
      screenshotId,
      x: 10,
      y: 20,
      purpose: "Repeat",
      safety: "normal",
    }),
    (error) => error.code === "CU_STATE_CONSUMED",
  )
  await assert.rejects(
    server.callTool("press_key", {
      windowRef,
      keys: ["ctrl", "s"],
      purpose: "Save",
      safety: "normal",
    }),
    (error) => error.code === "CU_INVALID_ARGUMENT",
  )
})

test("MCP structured content never duplicates screenshot base64", async () => {
  const server = new ComputerUseServer({ helper: new MockHelper() })
  const listed = await server.callTool("list_windows")
  const observed = await server.callTool("get_window_state", {
    windowRef: listed.structuredContent.windows[0].windowRef,
    includeScreenshot: true,
    includeAccessibility: false,
  })
  assert.equal(observed.content[1].type, "image")
  assert.equal(JSON.stringify(observed.structuredContent).includes(Buffer.from("png").toString("base64")), false)
})

test("an injected helper failure still consumes the action state", async () => {
  const helper = new MockHelper()
  const server = new ComputerUseServer({ helper })
  const listed = await server.callTool("list_windows")
  const windowRef = listed.structuredContent.windows[0].windowRef
  const observed = await server.callTool("get_window_state", {
    windowRef,
    includeScreenshot: true,
    includeAccessibility: false,
  })
  const args = {
    windowRef,
    stateRef: observed.structuredContent.stateRef,
    screenshotId: observed.structuredContent.screenshots[0].id,
    x: 10,
    y: 10,
    purpose: "Test failure handling",
    safety: "normal",
  }
  helper.failNextAction = true
  await assert.rejects(server.callTool("click", args))
  await assert.rejects(
    server.callTool("click", args),
    (error) => error.code === "CU_STATE_CONSUMED",
  )
})

test("element actions carry the native token and UIA revision from one fresh state", async () => {
  const accessibility = {
    revision: "uia_test_revision",
    tree: [
      "[0] window \"Fixture\"",
      "  [7] button \"Increment\" patterns=Invoke",
      "  [8] edit \"Editable\" value=\"before\" patterns=Value",
      "  [9] checkbox \"Toggle\" unchecked patterns=Toggle secondary=toggle",
    ].join("\n"),
    focusedElement: "8",
    selectedText: null,
    selectedElements: [],
    documentText: null,
    truncated: false,
    elementIndexes: [0, 7, 8, 9],
  }
  const helper = new MockHelper({ accessibility })
  const server = new ComputerUseServer({ helper })
  const listed = await server.callTool("list_windows")
  const windowRef = listed.structuredContent.windows[0].windowRef

  const observe = () => server.callTool("get_window_state", {
    windowRef,
    includeScreenshot: true,
    includeAccessibility: true,
  })

  const clickState = await observe()
  await server.callTool("click", {
    windowRef,
    stateRef: clickState.structuredContent.stateRef,
    elementIndex: 7,
    purpose: "Increment the controlled fixture",
    safety: "normal",
  })
  assert.equal(helper.actions.at(-1).type, "click_element")
  assert.equal(helper.requests.at(-1).accessibilityRevision, "uia_test_revision")
  assert.match(helper.requests.at(-1).nativeStateRef, /^native_/u)

  const valueState = await observe()
  await server.callTool("set_value", {
    windowRef,
    stateRef: valueState.structuredContent.stateRef,
    elementIndex: 8,
    value: "after",
    purpose: "Update the controlled fixture",
    safety: "normal",
  })
  assert.deepEqual(helper.actions.at(-1), {
    type: "set_value",
    elementIndex: 8,
    value: "after",
  })

  const toggleState = await observe()
  await server.callTool("perform_secondary_action", {
    windowRef,
    stateRef: toggleState.structuredContent.stateRef,
    elementIndex: 9,
    action: "toggle",
    purpose: "Toggle the controlled fixture",
    safety: "normal",
  })
  assert.equal(helper.actions.at(-1).secondaryAction, "toggle")

  const ambiguousState = await observe()
  await assert.rejects(
    server.callTool("click", {
      windowRef,
      stateRef: ambiguousState.structuredContent.stateRef,
      elementIndex: 7,
      screenshotId: ambiguousState.structuredContent.screenshots[0].id,
      x: 10,
      y: 10,
      purpose: "Reject ambiguous target mode",
      safety: "normal",
    }),
    (error) => error.code === "CU_INVALID_ARGUMENT",
  )
})

test("launch_app accepts only a current app catalog selector and never forwards paths", async () => {
  const helper = new MockHelper()
  const server = new ComputerUseServer({ helper })
  const listed = await server.callTool("list_apps")
  const app = listed.structuredContent.apps[0]
  assert.match(app.appRef, /^app_/u)
  assert.equal(JSON.stringify(app).includes("catalog_fixture"), false)

  await server.callTool("launch_app", {
    appRef: app.appRef,
    purpose: "Open the controlled fixture",
    safety: "normal",
  })
  assert.deepEqual(helper.launches, [{
    catalogRef: "catalog_fixture",
    appId: "win32:notepad.exe:0123456789abcdef",
  }])

  await assert.rejects(
    server.callTool("launch_app", {
      appId: "win32:forged.exe:0000000000000000",
      executablePath: "C:\\Windows\\System32\\cmd.exe",
      arguments: ["/c", "whoami"],
      purpose: "Reject a forged path",
      safety: "normal",
    }),
    (error) => error.code === "CU_INVALID_ARGUMENT",
  )
  await assert.rejects(
    server.callTool("launch_app", {
      appId: "win32:forged.exe:0000000000000000",
      purpose: "Reject a forged ID",
      safety: "normal",
    }),
    (error) => error.code === "CU_APP_APPROVAL_REQUIRED",
  )
})
