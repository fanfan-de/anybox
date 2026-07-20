import { readFile } from "node:fs/promises"

const CAPABILITY_ID = "computer-use"
const RUNTIME_KEY = Symbol.for("anybox.computer-use-windows.runtime")
const TOOL_SURFACE_META_KEY = "anybox/toolSurface"
const DOCUMENTATION_NAMES = new Set(["api", "confirmations", "guidance"])
const SAFETY_VALUES = new Set([
  "normal",
  "submit_or_send",
  "delete",
  "upload",
  "install",
  "auth_or_secret",
  "finance",
  "security_settings",
])

export async function setupComputerUseRuntime({ globals = globalThis } = {}) {
  const nodeRepl = globals?.nodeRepl
  if (!nodeRepl || typeof nodeRepl.callPluginCapability !== "function") {
    throw new Error(
      "Computer Use Windows requires the Anybox Node REPL plugin-capability bridge.",
    )
  }

  await globals[RUNTIME_KEY]?.close?.().catch(() => {})
  const client = new PluginComputerUseClient(nodeRepl)
  const sky = instrumentComputerUseClient(client, globals)
  Object.defineProperty(globals, RUNTIME_KEY, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: client,
  })
  globals.sky = sky
  return sky
}

export async function readDocumentation(name) {
  if (!DOCUMENTATION_NAMES.has(name)) {
    throw new Error("Unsupported Computer Use Windows documentation name.")
  }
  return await readFile(new URL(`../docs/${name}.md`, import.meta.url), "utf8")
}

class PluginComputerUseClient {
  constructor(nodeRepl) {
    this.nodeRepl = nodeRepl
    this.target = "windows"
    this.nextWindowID = 1
    this.windowsByID = new Map()
    this.windowIDByRef = new Map()
    this.appsByID = new Map()
    this.latestStateByWindowRef = new Map()
    this.removeLifecycleHook = typeof nodeRepl.addLifecycleHook === "function"
      ? nodeRepl.addLifecycleHook((event) => {
          if (["turn-end", "session-end", "reset", "transport-close"].includes(event?.type)) {
            this.clearState()
          }
        })
      : undefined
  }

  documentation(name) {
    return readDocumentation(name)
  }

  async close() {
    this.removeLifecycleHook?.()
    this.removeLifecycleHook = undefined
    this.clearState()
  }

  clearState() {
    this.latestStateByWindowRef.clear()
    this.windowsByID.clear()
    this.windowIDByRef.clear()
    this.appsByID.clear()
    this.nextWindowID = 1
  }

  async call(operation, args = {}) {
    return await this.nodeRepl.callPluginCapability(CAPABILITY_ID, operation, args)
  }

  async list_windows() {
    const data = structured(await this.call("list_windows"))
    return array(data.windows)
      .filter((window) => !window?.blocked)
      .map((window) => this.rememberWindow(window))
  }

  async get_window(input) {
    const binding = this.resolveWindow(input)
    const data = structured(await this.call("get_window", {
      windowRef: binding.windowRef,
    }))
    return this.rememberWindow(data.window)
  }

  async list_apps() {
    const data = structured(await this.call("list_apps"))
    return array(data.apps)
      .filter((app) => !app?.blocked)
      .map((app) => {
        const id = requiredString(app?.appId, "The app catalog returned an invalid app id.")
        this.appsByID.set(id, {
          appId: id,
          appRef: optionalString(app.appRef),
          displayName: optionalString(app.displayName),
        })
        return {
          id,
          displayName: optionalString(app.displayName),
          isRunning: Boolean(app.isRunning),
          windows: array(app.windows)
            .filter((window) => !window?.blocked)
            .map((window) => this.rememberWindow({
              ...window,
              appId: window.appId || id,
            })),
        }
      })
  }

  async launch_app(input) {
    const appID = requiredString(input?.app, "launch_app requires an app id from list_apps().")
    const app = this.appsByID.get(appID)
    if (!app) {
      throw new Error(
        "The app is not in the current approved catalog. Call sky.list_apps() and use a returned id.",
      )
    }
    const intent = actionIntent(input, `Launch ${app.displayName || appID}`)
    await this.call("launch_app", {
      appId: app.appId,
      ...intent,
    })
    this.latestStateByWindowRef.clear()
  }

  async get_window_state(input) {
    const binding = this.resolveWindow(input?.window)
    const includeScreenshot = input?.include_screenshot !== false
    const includeText = input?.include_text === true
    const result = await this.call("get_window_state", {
      windowRef: binding.windowRef,
      includeScreenshot,
      includeAccessibility: includeText,
      includeDocumentText: includeText,
    })
    const data = structured(result)
    const images = array(result.content).filter(
      (block) => block?.type === "image" && typeof block.data === "string",
    )
    for (const image of images) {
      await this.nodeRepl.emitImage({
        data: image.data,
        mimeType: image.mimeType || "image/png",
      })
    }
    const screenshots = array(data.screenshots).map((screenshot, index) => {
      const image = images[index]
      return {
        id: requiredString(screenshot?.id, "Computer Use returned an invalid screenshot id."),
        originX: finiteOrUndefined(screenshot.originX),
        originY: finiteOrUndefined(screenshot.originY),
        width: finiteOrUndefined(screenshot.width),
        height: finiteOrUndefined(screenshot.height),
        zIndex: Number.isFinite(screenshot.zIndex) ? screenshot.zIndex : index,
        url: image
          ? `data:${image.mimeType || "image/png"};base64,${image.data}`
          : "",
      }
    })
    const window = this.rememberWindow(data.window)
    this.latestStateByWindowRef.set(binding.windowRef, {
      stateRef: requiredString(data.stateRef, "Computer Use returned an invalid state reference."),
      screenshotIDs: new Set(screenshots.map((screenshot) => screenshot.id)),
      defaultScreenshotID: screenshots[0]?.id,
    })
    return {
      window,
      screenshots,
      accessibility: toAccessibilityState(data.accessibility),
    }
  }

  async click(input) {
    const { binding, state } = this.actionState(input)
    const elementIndex = integerOrUndefined(input?.element_index)
    const args = {
      windowRef: binding.windowRef,
      stateRef: state.stateRef,
      ...actionIntent(input, "Click the selected control"),
      button: normalizeMouseButton(input?.mouse_button),
      clickCount: integerOrUndefined(input?.click_count) ?? 1,
    }
    if (elementIndex !== undefined) {
      args.elementIndex = elementIndex
    } else {
      args.screenshotId = this.resolveScreenshotID(input?.screenshotId, state)
      args.x = finiteNumber(input?.x, "click requires x for coordinate mode.")
      args.y = finiteNumber(input?.y, "click requires y for coordinate mode.")
    }
    await this.consumeState(binding.windowRef, () => this.call("click", args))
  }

  async press_key(input) {
    const { binding, state } = this.actionState(input)
    const key = requiredString(input?.key, "press_key requires a key or key chord.")
    await this.consumeState(binding.windowRef, () => this.call("press_key", {
      windowRef: binding.windowRef,
      stateRef: state.stateRef,
      keys: normalizeKeyChord(key),
      ...actionIntent(input, `Press ${key}`),
    }))
  }

  async type_text(input) {
    const { binding, state } = this.actionState(input)
    if (typeof input?.text !== "string") throw new Error("type_text requires text.")
    await this.consumeState(binding.windowRef, () => this.call("type_text", {
      windowRef: binding.windowRef,
      stateRef: state.stateRef,
      text: input.text,
      ...actionIntent(input, "Type text into the focused control"),
    }))
  }

  async scroll(input) {
    const { binding, state } = this.actionState(input)
    await this.consumeState(binding.windowRef, () => this.call("scroll", {
      windowRef: binding.windowRef,
      stateRef: state.stateRef,
      screenshotId: this.resolveScreenshotID(input?.screenshotId, state),
      x: finiteNumber(input?.x, "scroll requires x."),
      y: finiteNumber(input?.y, "scroll requires y."),
      deltaX: finiteNumber(input?.scrollX, "scroll requires scrollX."),
      deltaY: finiteNumber(input?.scrollY, "scroll requires scrollY."),
      ...actionIntent(input, "Scroll the selected window"),
    }))
  }

  async set_value(input) {
    const { binding, state } = this.actionState(input)
    if (typeof input?.value !== "string") throw new Error("set_value requires value.")
    await this.consumeState(binding.windowRef, () => this.call("set_value", {
      windowRef: binding.windowRef,
      stateRef: state.stateRef,
      elementIndex: nonNegativeInteger(input?.element_index, "set_value requires element_index."),
      value: input.value,
      ...actionIntent(input, "Set the selected editable value"),
    }))
  }

  async drag(input) {
    const { binding, state } = this.actionState(input)
    await this.consumeState(binding.windowRef, () => this.call("drag", {
      windowRef: binding.windowRef,
      stateRef: state.stateRef,
      screenshotId: this.resolveScreenshotID(input?.screenshotId, state),
      fromX: finiteNumber(input?.from_x, "drag requires from_x."),
      fromY: finiteNumber(input?.from_y, "drag requires from_y."),
      toX: finiteNumber(input?.to_x, "drag requires to_x."),
      toY: finiteNumber(input?.to_y, "drag requires to_y."),
      ...actionIntent(input, "Drag within the selected window"),
    }))
  }

  async perform_secondary_action(input) {
    const { binding, state } = this.actionState(input)
    const action = requiredString(
      input?.action,
      "perform_secondary_action requires action.",
    ).toLowerCase()
    if (!["toggle", "select", "expand", "collapse"].includes(action)) {
      throw new Error("Secondary action must be toggle, select, expand, or collapse.")
    }
    await this.consumeState(binding.windowRef, () => this.call("perform_secondary_action", {
      windowRef: binding.windowRef,
      stateRef: state.stateRef,
      elementIndex: nonNegativeInteger(
        input?.element_index,
        "perform_secondary_action requires element_index.",
      ),
      action,
      ...actionIntent(input, `Perform ${action} on the selected control`),
    }))
  }

  async activate_window(input) {
    const binding = this.resolveWindow(input?.window)
    await this.call("activate_window", {
      windowRef: binding.windowRef,
      ...actionIntent(input, "Activate the selected window"),
    })
    this.latestStateByWindowRef.delete(binding.windowRef)
  }

  rememberWindow(rawWindow) {
    const windowRef = requiredString(
      rawWindow?.windowRef,
      "Computer Use returned an invalid window reference.",
    )
    let id = this.windowIDByRef.get(windowRef)
    if (!id) {
      id = this.nextWindowID++
      this.windowIDByRef.set(windowRef, id)
    }
    const window = {
      app: requiredString(rawWindow.appId, "Computer Use returned an invalid window app id."),
      id,
      ...(optionalString(rawWindow.title) ? { title: rawWindow.title } : {}),
    }
    this.windowsByID.set(id, {
      windowRef,
      app: window.app,
      window,
    })
    return window
  }

  resolveWindow(value) {
    const candidate = value?.window && typeof value.window === "object"
      ? value.window
      : value
    const id = candidate?.id
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error("A Window returned by sky.list_apps() or sky.list_windows() is required.")
    }
    const binding = this.windowsByID.get(id)
    if (!binding) {
      throw new Error("The Window binding is unknown or expired. List windows again.")
    }
    if (candidate.app !== undefined && candidate.app !== binding.app) {
      throw new Error("The Window app identifier does not match its current binding.")
    }
    return binding
  }

  actionState(input) {
    const binding = this.resolveWindow(input?.window)
    const state = this.latestStateByWindowRef.get(binding.windowRef)
    if (!state) {
      throw new Error(
        "No fresh state exists for this Window. Call sky.get_window_state() immediately before acting.",
      )
    }
    return { binding, state }
  }

  resolveScreenshotID(candidate, state) {
    const screenshotID = candidate === undefined
      ? state.defaultScreenshotID
      : requiredString(candidate, "screenshotId must be a non-empty string.")
    if (!screenshotID || !state.screenshotIDs.has(screenshotID)) {
      throw new Error("The screenshotId is not part of the latest state for this Window.")
    }
    return screenshotID
  }

  async consumeState(windowRef, operation) {
    try {
      await operation()
    } finally {
      this.latestStateByWindowRef.delete(windowRef)
    }
  }
}

function instrumentComputerUseClient(client, globals) {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== "function") return value
      return (...args) => {
        globals.nodeRepl?.setResponseMeta?.({
          [TOOL_SURFACE_META_KEY]: {
            kind: "computerUse",
            app: appReference(args[0]),
          },
        })
        return Reflect.apply(value, target, args)
      }
    },
  })
}

function structured(result) {
  if (!result || typeof result !== "object" || !result.structuredContent) {
    throw new Error("Computer Use returned an invalid structured response.")
  }
  return result.structuredContent
}

function array(value) {
  return Array.isArray(value) ? value : []
}

function requiredString(value, message) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message)
  return value.trim()
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function finiteNumber(value, message) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(message)
  return value
}

function finiteOrUndefined(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function nonNegativeInteger(value, message) {
  if (!Number.isInteger(value) || value < 0) throw new Error(message)
  return value
}

function integerOrUndefined(value) {
  return value === undefined ? undefined : nonNegativeInteger(value, "Expected a non-negative integer.")
}

function normalizeMouseButton(value) {
  const button = typeof value === "string" ? value.trim().toLowerCase() : "left"
  if (button === "l") return "left"
  if (button === "r") return "right"
  if (button === "left" || button === "right") return button
  throw new Error("mouse_button must be left, right, l, or r.")
}

function normalizeKeyChord(value) {
  const aliases = new Map([
    ["control_l", "ctrl"],
    ["control_r", "ctrl"],
    ["control", "ctrl"],
    ["shift_l", "shift"],
    ["shift_r", "shift"],
    ["alt_l", "alt"],
    ["alt_r", "alt"],
    ["return", "enter"],
    ["escape", "esc"],
    ["period", "."],
    ["comma", ","],
    ["slash", "/"],
    ["backslash", "\\"],
  ])
  const keys = value.split("+").map((part) => {
    const key = part.trim()
    if (!key) throw new Error("Key chords cannot contain empty keys.")
    return aliases.get(key.toLowerCase()) || key
  })
  if (keys.length === 0 || keys.length > 4) {
    throw new Error("Key chords must contain between one and four keys.")
  }
  return keys
}

function actionIntent(input, fallbackPurpose) {
  const purpose = optionalString(input?.purpose) || fallbackPurpose
  const safety = optionalString(input?.safety)?.toLowerCase() || "normal"
  if (!SAFETY_VALUES.has(safety)) throw new Error(`Unsupported Computer Use safety value: ${safety}`)
  return { purpose, safety }
}

function toAccessibilityState(value) {
  if (!value || typeof value !== "object") return null
  return {
    tree: typeof value.tree === "string" ? value.tree : "",
    ...(optionalString(value.focusedElement)
      ? { focused_element: value.focusedElement }
      : {}),
    ...(typeof value.selectedText === "string"
      ? { selected_text: value.selectedText }
      : {}),
    ...(Array.isArray(value.selectedElements)
      ? { selected_elements: value.selectedElements }
      : {}),
    ...(typeof value.documentText === "string"
      ? { document_text: value.documentText }
      : {}),
  }
}

function appReference(value) {
  const app = value?.window?.app ?? value?.app
  return typeof app === "string" && app.trim()
    ? { kind: "appId", appId: app.trim() }
    : null
}
