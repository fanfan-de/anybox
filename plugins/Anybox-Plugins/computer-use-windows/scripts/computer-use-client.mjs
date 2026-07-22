import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { ComputerUseRuntime } = require("./runtime.cjs")
const { cuError } = require("./lib/errors")

const PLUGIN_ID = "computer-use-windows"
const PLUGIN_DISPLAY_NAME = "Computer Use Windows"
const RUNTIME_KEY = Symbol.for("anybox.computer-use-windows.runtime")
const TOOL_SURFACE_META_KEY = "anybox/toolSurface"
const DOCUMENTATION_NAMES = new Set(["api", "confirmations", "guidance"])
const MUTATING_OPERATIONS = new Set([
  "activate_window",
  "click",
  "drag",
  "launch_app",
  "perform_secondary_action",
  "press_key",
  "scroll",
  "set_value",
  "type_text",
])
const HARD_REJECT_SAFETY = new Set([
  "auth_or_secret",
  "finance",
  "security_settings",
])
const APPROVAL_REQUIRED_SAFETY = new Set([
  "submit_or_send",
  "delete",
  "upload",
  "install",
])
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

export async function setupComputerUseRuntime({ globals = globalThis, runtime: providedRuntime } = {}) {
  const nodeRepl = globals?.nodeRepl
  if (
    !nodeRepl
    || typeof nodeRepl.requestPermission !== "function"
    || typeof nodeRepl.emitImage !== "function"
  ) {
    throw new Error(
      "Computer Use Windows requires the general-purpose Anybox Node REPL runtime.",
    )
  }

  await globals[RUNTIME_KEY]?.close?.().catch(() => {})
  let client
  const runtime = providedRuntime ?? new ComputerUseRuntime({
    onPhysicalEscape(error) {
      client?.handlePhysicalEscape(error)
    },
    onOverlayUnavailable(error) {
      client?.handleOverlayUnavailable(error)
    },
  })
  client = new PluginComputerUseClient(nodeRepl, runtime)
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
  constructor(nodeRepl, runtime) {
    this.nodeRepl = nodeRepl
    this.runtime = runtime
    this.target = "windows"
    this.nextWindowID = 1
    this.windowsByID = new Map()
    this.windowIDByRef = new Map()
    this.appsByID = new Map()
    this.latestStateByWindowRef = new Map()
    this.activeControllers = new Set()
    this.interrupted = false
    this.mutationClaimed = false
    this.removeLifecycleHook = typeof nodeRepl.addLifecycleHook === "function"
      ? nodeRepl.addLifecycleHook(async (event) => {
          if (["turn-end", "session-end", "reset", "transport-close"].includes(event?.type)) {
            await this.endLifecycleBoundary()
          }
        })
      : undefined
    this.removeAfterSubmittedCodeHook = typeof nodeRepl.addAfterSubmittedCodeHook === "function"
      ? nodeRepl.addAfterSubmittedCodeHook(() => {
          this.mutationClaimed = false
        })
      : undefined
  }

  documentation(name) {
    return readDocumentation(name)
  }

  async close() {
    this.removeLifecycleHook?.()
    this.removeLifecycleHook = undefined
    this.removeAfterSubmittedCodeHook?.()
    this.removeAfterSubmittedCodeHook = undefined
    this.abortActiveCalls()
    try {
      await this.runtime.close({ requestMeta: this.nodeRepl.requestMeta })
    } finally {
      this.clearState()
    }
  }

  async endLifecycleBoundary() {
    this.abortActiveCalls()
    try {
      await this.runtime.close({ requestMeta: this.nodeRepl.requestMeta })
    } finally {
      this.interrupted = false
      this.overlayUnavailable = undefined
      this.mutationClaimed = false
      this.clearState()
    }
  }

  abortActiveCalls() {
    for (const controller of this.activeControllers) controller.abort()
    this.activeControllers.clear()
  }

  handlePhysicalEscape() {
    this.interrupted = true
    this.clearState()
  }

  handleOverlayUnavailable(error) {
    this.overlayUnavailable = error ?? computerUseError(
      "CU_OVERLAY_UNAVAILABLE",
      "The Computer Use safety overlay became unavailable.",
    )
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
    if (this.interrupted) {
      throw computerUseError(
        "CU_INTERRUPTED",
        "Computer Use was interrupted by physical Escape; wait for the next turn before continuing.",
      )
    }
    if (this.overlayUnavailable) {
      throw computerUseError(
        "CU_OVERLAY_UNAVAILABLE",
        this.overlayUnavailable.message
          ?? "The Computer Use safety overlay became unavailable.",
      )
    }
    if (MUTATING_OPERATIONS.has(operation)) {
      if (this.mutationClaimed) {
        throw computerUseError(
          "CU_BUSY",
          "Only one state-changing Computer Use action is allowed per JavaScript submission.",
        )
      }
      this.mutationClaimed = true
      await this.authorizeAction(operation, args)
    }

    const controller = new AbortController()
    this.activeControllers.add(controller)
    try {
      return await this.runtime.callOperation(operation, args, {
        signal: controller.signal,
        requestMeta: this.nodeRepl.requestMeta,
      })
    } catch (error) {
      if (error?.code === "CU_INTERRUPTED") {
        this.interrupted = true
        this.clearState()
      }
      if (error?.code === "CU_OVERLAY_UNAVAILABLE") {
        this.handleOverlayUnavailable(error)
      }
      throw error
    } finally {
      this.activeControllers.delete(controller)
    }
  }

  async authorizeAction(operation, args) {
    const descriptor = describePluginAction(operation, args, this)
    if (HARD_REJECT_SAFETY.has(descriptor.safety)) {
      throw computerUseError(
        "CU_APP_BLOCKED",
        `Computer Use does not permit ${descriptor.safety.replaceAll("_", " ")} actions.`,
      )
    }
    if (!APPROVAL_REQUIRED_SAFETY.has(descriptor.safety)) return
    await this.requestPluginPermission(operation, descriptor)
  }

  async requestPluginPermission(operation, descriptor) {
    const result = await this.nodeRepl.requestPermission({
      message: descriptor.summary,
      scope: {
        kind: "plugin-action",
        pluginID: PLUGIN_ID,
        pluginDisplayName: PLUGIN_DISPLAY_NAME,
        actionTitle: descriptor.title,
        actionSummary: descriptor.summary,
        actionBody: descriptor.body,
      },
      method: operation,
      risk: descriptor.risk,
      sensitive: true,
      permissionAction: "ask",
      rationale: descriptor.rationale,
      timeoutMs: 120_000,
    })
    if (!result.allowed) {
      const error = computerUseError(
        "CU_APP_APPROVAL_REQUIRED",
        "The Computer Use request was denied by the user.",
      )
      error.code = "PERMISSION_DENIED"
      throw error
    }
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
    const data = structured(await this.call("launch_app", {
      appId: app.appId,
      ...intent,
    }))
    this.latestStateByWindowRef.clear()
    const window = data.window ? this.rememberWindow(data.window) : undefined
    return {
      ok: data.ok === true,
      app: appID,
      window_ready: Boolean(data.windowReady && window),
      ...(window ? { window } : {}),
    }
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
    const images = array(result.images).filter(
      (image) => typeof image?.data === "string",
    )
    for (const image of images) {
      await this.nodeRepl.emitImage({
        data: image.data,
        mimeType: image.mimeType || "image/png",
      })
    }
    const screenshots = array(data.screenshots).map((screenshot, index) => {
      const image = images[index]
      const publicScreenshot = {
        id: requiredString(screenshot?.id, "Computer Use returned an invalid screenshot id."),
        originX: finiteOrUndefined(screenshot.originX),
        originY: finiteOrUndefined(screenshot.originY),
        width: finiteOrUndefined(screenshot.width),
        height: finiteOrUndefined(screenshot.height),
        zIndex: Number.isFinite(screenshot.zIndex) ? screenshot.zIndex : index,
        image_emitted: Boolean(image),
        ...(image ? { mime_type: image.mimeType || "image/png" } : {}),
      }
      if (image) {
        Object.defineProperty(publicScreenshot, "url", {
          configurable: false,
          enumerable: false,
          writable: false,
          value: `data:${image.mimeType || "image/png"};base64,${image.data}`,
        })
      }
      return publicScreenshot
    })
    const window = this.rememberWindow(data.window)
    this.latestStateByWindowRef.set(binding.windowRef, {
      stateRef: requiredString(data.stateRef, "Computer Use returned an invalid state reference."),
      screenshotIDs: new Set(screenshots.map((screenshot) => screenshot.id)),
      defaultScreenshotID: screenshots[0]?.id,
      includeScreenshot,
      includeText,
    })
    return {
      window,
      viewport: toViewport(data.window),
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
    return this.completeAction(binding, state, input, () => this.call("click", args))
  }

  async press_key(input) {
    const { binding, state } = this.actionState(input)
    const key = requiredString(input?.key, "press_key requires a key or key chord.")
    return this.completeAction(binding, state, input, () => this.call("press_key", {
      windowRef: binding.windowRef,
      stateRef: state.stateRef,
      keys: normalizeKeyChord(key),
      ...actionIntent(input, `Press ${key}`),
    }))
  }

  async type_text(input) {
    const { binding, state } = this.actionState(input)
    if (typeof input?.text !== "string") throw new Error("type_text requires text.")
    return this.completeAction(binding, state, input, () => this.call("type_text", {
      windowRef: binding.windowRef,
      stateRef: state.stateRef,
      text: input.text,
      ...actionIntent(input, "Type text into the focused control"),
    }))
  }

  async scroll(input) {
    const { binding, state } = this.actionState(input)
    const elementIndex = integerOrUndefined(input?.element_index)
    const args = {
      windowRef: binding.windowRef,
      stateRef: state.stateRef,
      deltaX: finiteNumber(input?.scrollX, "scroll requires scrollX."),
      deltaY: finiteNumber(input?.scrollY, "scroll requires scrollY."),
      ...actionIntent(input, "Scroll the selected window"),
    }
    if (elementIndex !== undefined) {
      args.elementIndex = elementIndex
    } else {
      args.screenshotId = this.resolveScreenshotID(input?.screenshotId, state)
      args.x = finiteNumber(input?.x, "scroll requires x for coordinate mode.")
      args.y = finiteNumber(input?.y, "scroll requires y for coordinate mode.")
    }
    return this.completeAction(binding, state, input, () => this.call("scroll", args))
  }

  async set_value(input) {
    const { binding, state } = this.actionState(input)
    if (typeof input?.value !== "string") throw new Error("set_value requires value.")
    return this.completeAction(binding, state, input, () => this.call("set_value", {
      windowRef: binding.windowRef,
      stateRef: state.stateRef,
      elementIndex: nonNegativeInteger(input?.element_index, "set_value requires element_index."),
      value: input.value,
      ...actionIntent(input, "Set the selected editable value"),
    }))
  }

  async drag(input) {
    const { binding, state } = this.actionState(input)
    return this.completeAction(binding, state, input, () => this.call("drag", {
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
    return this.completeAction(binding, state, input, () => this.call("perform_secondary_action", {
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
    const data = structured(await this.call("activate_window", {
      windowRef: binding.windowRef,
      ...actionIntent(input, "Activate the selected window"),
    }))
    this.latestStateByWindowRef.delete(binding.windowRef)
    return {
      ok: data.ok === true,
      window: this.rememberWindow(data.window),
    }
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
      throw computerUseError(
        "CU_STATE_REQUIRED",
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
      return await operation()
    } finally {
      this.latestStateByWindowRef.delete(windowRef)
    }
  }

  async completeAction(binding, state, input, operation) {
    const result = await this.consumeState(binding.windowRef, operation)
    const receipt = toActionReceipt(result)
    if (input?.observe_after !== true) return receipt
    try {
      const postState = await this.get_window_state({
        window: binding.window,
        include_screenshot: state.includeScreenshot,
        include_text: state.includeText,
      })
      return { ...receipt, post_state: postState }
    } catch (error) {
      return {
        ...receipt,
        post_state: null,
        observation_error: {
          code: optionalString(error?.code) || "CU_INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error),
          retryable: Boolean(error?.retryable),
          requires_fresh_state: Boolean(error?.requiresFreshState),
        },
      }
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
  if (!result || typeof result !== "object" || !result.data) {
    throw new Error("Computer Use returned an invalid structured response.")
  }
  return result.data
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

const ACTION_DESCRIPTORS = Object.freeze({
  activate_window: {
    title: "Activate window",
    summary: "Bring the selected Windows application window to the foreground.",
    risk: "medium",
  },
  click: {
    title: "Click",
    summary: "Send a click to the selected Windows application window.",
    risk: "medium",
  },
  drag: {
    title: "Drag",
    summary: "Drag between two points in the selected Windows application window.",
    risk: "medium",
  },
  launch_app: {
    title: "Launch application",
    summary: "Launch an application selected from the plugin-owned Windows app catalog.",
    risk: "high",
  },
  perform_secondary_action: {
    title: "Change control state",
    summary: "Change the state of the selected accessibility control.",
    risk: "medium",
  },
  press_key: {
    title: "Press keys",
    summary: "Send a key or key chord to the selected Windows application window.",
    risk: "high",
  },
  scroll: {
    title: "Scroll",
    summary: "Scroll the selected Windows application window.",
    risk: "medium",
  },
  set_value: {
    title: "Set value",
    summary: "Set the value of the selected accessibility control.",
    risk: "high",
  },
  type_text: {
    title: "Type text",
    summary: "Type text into the selected Windows application window.",
    risk: "high",
  },
})

function describePluginAction(operation, args, client) {
  const definition = ACTION_DESCRIPTORS[operation]
  if (!definition) {
    throw computerUseError("CU_INVALID_ARGUMENT", `Unknown state-changing operation: ${operation}`)
  }
  const safety = optionalString(args?.safety)?.toLowerCase() || "normal"
  if (!SAFETY_VALUES.has(safety)) {
    throw computerUseError("CU_INVALID_ARGUMENT", `Unsupported Computer Use safety value: ${safety}`)
  }
  const body = [
    `Plugin: ${PLUGIN_DISPLAY_NAME}`,
    `Action: ${definition.title}`,
    `Target: ${permissionTarget(args, client)}`,
    `Purpose: ${safePermissionText(args?.purpose, "Operate the selected application", 500)}`,
    `Safety: ${safety}`,
    ...permissionActionDetails(operation, args),
  ].join("\n")
  return {
    ...definition,
    safety,
    risk: APPROVAL_REQUIRED_SAFETY.has(safety) ? "high" : definition.risk,
    body,
    rationale: "This action may send, remove, upload, or install data or software and requires a one-time decision.",
  }
}

function permissionTarget(args, client) {
  const appID = optionalString(args?.appId)
  if (appID) {
    const app = client.appsByID.get(appID)
    return safePermissionText(app?.displayName || appID, "selected application", 300)
  }
  const windowRef = optionalString(args?.windowRef)
  if (windowRef) {
    const binding = [...client.windowsByID.values()].find(
      (candidate) => candidate.windowRef === windowRef,
    )
    return safePermissionText(binding?.app, "selected window", 300)
  }
  return "selected application"
}

function permissionActionDetails(operation, args) {
  switch (operation) {
    case "click":
      return args?.elementIndex !== undefined
        ? [`Accessibility element: ${Number(args.elementIndex)}`]
        : [`Screenshot coordinate: ${Number(args?.x)}, ${Number(args?.y)}`]
    case "drag":
      return [
        `From: ${Number(args?.fromX)}, ${Number(args?.fromY)}`,
        `To: ${Number(args?.toX)}, ${Number(args?.toY)}`,
      ]
    case "perform_secondary_action":
      return [
        `Accessibility element: ${Number(args?.elementIndex)}`,
        `Control action: ${safePermissionText(args?.action, "unknown", 80)}`,
      ]
    case "press_key":
      return [`Keys: ${array(args?.keys).map((key) => safePermissionText(key, "?", 40)).join("+")}`]
    case "scroll":
      return [
        ...(args?.elementIndex !== undefined
          ? [`Accessibility element: ${Number(args.elementIndex)}`]
          : [`Screenshot coordinate: ${Number(args?.x)}, ${Number(args?.y)}`]),
        `Scroll delta: ${Number(args?.deltaX)}, ${Number(args?.deltaY)}`,
      ]
    case "set_value":
      return [`Value: <redacted; ${typeof args?.value === "string" ? args.value.length : 0} characters>`]
    case "type_text":
      return [`Text: <redacted; ${typeof args?.text === "string" ? args.text.length : 0} characters>`]
    default:
      return []
  }
}

function safePermissionText(value, fallback, max) {
  const normalized = typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]+/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
    : ""
  return (normalized || fallback).slice(0, max)
}

function computerUseError(code, message) {
  return cuError(code, message)
}

function toActionReceipt(result) {
  const data = structured(result)
  return {
    ok: data.ok === true,
    state_consumed: data.stateConsumed === true,
    ...(data.inputMode === "uia" || data.inputMode === "physical"
      ? { input_mode: data.inputMode }
      : {}),
    ...(typeof data.focusValidated === "boolean"
      ? { focus_validated: data.focusValidated }
      : {}),
    ...(Number.isInteger(data.elementIndex) ? { element_index: data.elementIndex } : {}),
    ...(Number.isInteger(data.characterCount)
      ? { character_count: data.characterCount }
      : {}),
  }
}

function toViewport(window) {
  const bounds = window?.bounds && typeof window.bounds === "object"
    ? window.bounds
    : {}
  return {
    x: finiteOrUndefined(bounds.x) ?? 0,
    y: finiteOrUndefined(bounds.y) ?? 0,
    width: finiteOrUndefined(bounds.width) ?? 0,
    height: finiteOrUndefined(bounds.height) ?? 0,
    is_foreground: Boolean(window?.isForeground),
    minimized: Boolean(window?.minimized),
    coordinate_space: "screen",
    action_coordinate_space: "screenshot-local",
  }
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
