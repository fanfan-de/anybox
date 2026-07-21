"use strict"

const path = require("node:path")
const {
  CAPTURE_HELPER_TIMEOUT_MS,
  PLUGIN_VERSION,
  PROTOCOL_VERSION,
  STATE_TTL_MS,
} = require("./lib/build-info")
const { AppRegistry } = require("./lib/app-registry")
const { cuError } = require("./lib/errors")
const { HelperClient } = require("./lib/helper-client")
const {
  assertWindowAllowed,
  classifyApp,
  classifyWindow,
  validatePurpose,
  validateSafety,
} = require("./lib/policy")
const { SerialQueue } = require("./lib/serial-queue")
const { StateRegistry, makeRef } = require("./lib/state-registry")
const { WindowRegistry, normalizeProcessName } = require("./lib/window-registry")

const PLUGIN_ROOT = path.resolve(__dirname, "..")
const DEFAULT_HELPER_EXE = path.join(PLUGIN_ROOT, "helper", "win32-x64", "computer-use-helper.exe")

function runtimeResult(summary, data = {}) {
  return {
    summary,
    data: { ok: true, ...data },
    images: [],
  }
}

function imageResult(summary, imageBase64, data = {}) {
  return {
    summary,
    data: { ok: true, ...data },
    images: imageBase64
      ? [{ data: imageBase64, mimeType: "image/png" }]
      : [],
  }
}

function boolArg(args, name, defaultValue) {
  const value = args?.[name]
  return typeof value === "boolean" ? value : defaultValue
}

function numberArg(args, name, defaultValue) {
  const value = args?.[name]
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (defaultValue !== undefined) return defaultValue
  throw cuError("CU_INVALID_ARGUMENT", `${name} must be a finite number.`)
}

function integerArg(args, name) {
  const value = numberArg(args, name)
  if (!Number.isInteger(value) || value < 0) {
    throw cuError("CU_INVALID_ARGUMENT", `${name} must be a non-negative integer.`)
  }
  return value
}

function stringArg(args, name, required = false) {
  const value = args?.[name]
  if (typeof value === "string" && value.trim()) return value.trim()
  if (required) throw cuError("CU_INVALID_ARGUMENT", `${name} is required.`)
  return undefined
}

function keysArg(args) {
  const keys = args?.keys
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 4) {
    throw cuError("CU_INVALID_ARGUMENT", "keys must contain between one and four key names.")
  }
  const normalized = keys.map((key) => String(key || "").trim()).filter(Boolean)
  if (normalized.length !== keys.length) {
    throw cuError("CU_INVALID_ARGUMENT", "keys must contain only non-empty strings.")
  }
  return normalized
}

function validateCoordinate(state, x, y, label = "coordinate") {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw cuError("CU_INVALID_ARGUMENT", `${label} must contain finite numbers.`)
  }
  if (x < 0 || y < 0 || x >= state.imageWidth || y >= state.imageHeight) {
    throw cuError("CU_POINT_OUTSIDE_TARGET", `${label} is outside the observed screenshot bounds.`)
  }
}

class ComputerUseRuntime {
  constructor(options = {}) {
    this.windows = options.windows ?? new WindowRegistry(options.windowRegistryOptions)
    this.apps = options.apps ?? new AppRegistry(options.appRegistryOptions)
    this.states = options.states ?? new StateRegistry(options.stateRegistryOptions)
    this.helper = options.helper ?? new HelperClient({
      helperPath: options.helperPath
        ?? process.env.ANYBOX_COMPUTER_USE_HELPER_PATH
        ?? DEFAULT_HELPER_EXE,
      cwd: options.pluginRoot ?? PLUGIN_ROOT,
      onPhysicalEscape: options.onPhysicalEscape,
      onOverlayUnavailable: options.onOverlayUnavailable,
      requireAuthenticode: options.requireAuthenticode,
    })
    this.actions = options.actions ?? new SerialQueue()
    this.handlers = new Map([
      ["computer_health_check", (args, context) => this.healthCheck(args, context)],
      ["list_apps", (args, context) => this.listApps(args, context)],
      ["list_windows", (args, context) => this.listWindows(args, context)],
      ["get_window", (args, context) => this.getWindow(args, context)],
      ["get_window_state", (args, context) => this.getWindowState(args, context)],
      ["activate_window", (args, context) => this.activateWindow(args, context)],
      ["launch_app", (args, context) => this.launchApp(args, context)],
      ["click", (args, context) => this.performPointOrElementAction("click", args, context)],
      ["scroll", (args, context) => this.performPointOrElementAction("scroll", args, context)],
      ["press_key", (args, context) => this.pressKey(args, context)],
      ["type_text", (args, context) => this.typeText(args, context)],
      ["drag", (args, context) => this.drag(args, context)],
      ["set_value", (args, context) => this.setValue(args, context)],
      ["perform_secondary_action", (args, context) => this.performSecondaryAction(args, context)],
    ])
  }

  async callOperation(name, args = {}, context = {}) {
    const handler = this.handlers.get(name)
    if (!handler) throw cuError("CU_INVALID_ARGUMENT", `Unknown Computer Use operation: ${name}`)
    return handler(args, context)
  }

  helperOptions(context, extra = {}) {
    return {
      ...extra,
      signal: context?.signal,
      context: context?.requestMeta,
    }
  }

  async healthCheck(_args, context) {
    const handshake = await this.helper.ensureInitialized()
    const result = await this.helper.call("health_check", {}, this.helperOptions(context))
    return runtimeResult("Computer Use Windows helper is available.", {
      protocolVersion: PROTOCOL_VERSION,
      pluginVersion: PLUGIN_VERSION,
      helperVersion: result.helperVersion ?? handshake.helperVersion,
      platform: result.platform,
      captureBackend: result.captureBackend,
      accessibilityBackend: result.accessibilityBackend,
      inputBackend: result.inputBackend,
      features: result.features ?? handshake.capabilities,
    })
  }

  async listWindows(_args, context) {
    this.states.cleanup()
    const result = await this.helper.call("list_windows", {}, this.helperOptions(context))
    const windows = (result.windows ?? []).map((window) => {
      const record = this.windows.upsert(window)
      return this.windows.publicWindow(record, classifyWindow(record.window))
    })
    return runtimeResult(
      windows.length > 0
        ? windows.map((window) =>
            `${window.windowRef}: ${window.processName} - ${window.title}${window.blocked ? " [blocked]" : ""}`,
          ).join("\n")
        : "No visible desktop windows were found.",
      { windows },
    )
  }

  async listApps(_args, context) {
    this.states.cleanup()
    const result = await this.helper.call("list_apps", {}, this.helperOptions(context, {
      timeoutMs: CAPTURE_HELPER_TIMEOUT_MS,
    }))
    const apps = (result.apps ?? []).map((rawApp) => {
      const windows = (rawApp.windows ?? []).map((rawWindow) => {
        const windowRecord = this.windows.upsert(rawWindow)
        const publicWindow = this.windows.publicWindow(
          windowRecord,
          classifyWindow(windowRecord.window),
        )
        return {
          windowRef: publicWindow.windowRef,
          title: publicWindow.title,
          minimized: publicWindow.minimized,
          blocked: publicWindow.blocked,
        }
      })
      const nodePolicy = classifyApp(rawApp)
      const appRecord = this.apps.upsert({
        ...rawApp,
        blocked: Boolean(rawApp.blocked) || nodePolicy.blocked,
        blockReason: rawApp.blockReason || nodePolicy.reason,
      })
      return this.apps.publicApp(appRecord, windows)
    })
    return runtimeResult(
      apps.length > 0
        ? apps.map((app) =>
            `${app.appRef}: ${app.displayName} (${app.appId})${app.blocked ? " [blocked]" : ""}`,
          ).join("\n")
        : "No registered Windows applications were found.",
      { apps },
    )
  }

  async refreshRecord(record, context) {
    const result = await this.helper.call("resolve_window", {
      expectedIdentity: record.identity,
    }, this.helperOptions(context))
    const refreshed = this.windows.upsert(result.window)
    if (refreshed.identityDigest !== record.identityDigest) {
      this.states.invalidateWindow(record.windowRef)
      throw cuError("CU_WINDOW_CHANGED", "The selected window identity changed.")
    }
    refreshed.inputEpoch = Number(result.inputEpoch ?? 0)
    return refreshed
  }

  async findWindow(args, context) {
    const windowRef = stringArg(args, "windowRef")
    if (windowRef) return this.refreshRecord(this.windows.get(windowRef), context)

    const titleQuery = stringArg(args, "titleQuery")?.toLowerCase()
    const processName = normalizeProcessName(stringArg(args, "processName"))
    if (!titleQuery && !processName) {
      throw cuError("CU_INVALID_ARGUMENT", "get_window requires windowRef, titleQuery, or processName.")
    }
    const result = await this.helper.call("list_windows", {}, this.helperOptions(context))
    const matches = (result.windows ?? [])
      .map((window) => this.windows.upsert(window))
      .filter((record) => {
        const titleMatches = titleQuery
          ? String(record.window.title || "").toLowerCase().includes(titleQuery)
          : true
        const processMatches = processName
          ? normalizeProcessName(record.window.processName) === processName
          : true
        return titleMatches && processMatches
      })
    if (matches.length === 0) throw cuError("CU_WINDOW_NOT_FOUND", "No matching window was found.")
    if (matches.length > 1) {
      throw cuError("CU_INVALID_ARGUMENT", "The window query is ambiguous. Use list_windows and a windowRef.")
    }
    return matches[0]
  }

  async getWindow(args, context) {
    const record = await this.findWindow(args, context)
    const window = this.windows.publicWindow(record, classifyWindow(record.window))
    return runtimeResult(`${window.windowRef}: ${window.processName} - ${window.title}`, { window })
  }

  async getWindowState(args, context) {
    const includeScreenshot = boolArg(args, "includeScreenshot", true)
    const includeAccessibility = boolArg(args, "includeAccessibility", true)
    const includeDocumentText = boolArg(args, "includeDocumentText", false)
    if (!includeScreenshot && !includeAccessibility) {
      throw cuError(
        "CU_INVALID_ARGUMENT",
        "includeScreenshot and includeAccessibility cannot both be false.",
      )
    }
    const record = this.windows.get(stringArg(args, "windowRef", true))
    const result = await this.helper.call("get_window_state", {
      expectedIdentity: record.identity,
      includeScreenshot,
      includeAccessibility,
      includeDocumentText,
    }, this.helperOptions(context, {
      timeoutMs: CAPTURE_HELPER_TIMEOUT_MS,
    }))
    if (typeof result.nativeStateRef !== "string" || !result.nativeStateRef) {
      throw cuError(
        "CU_PROTOCOL_MISMATCH",
        "Computer Use helper did not return a native one-action observation token.",
      )
    }
    const nextRecord = this.windows.upsert(result.window)
    if (nextRecord.identityDigest !== record.identityDigest) {
      this.states.invalidateWindow(record.windowRef)
      throw cuError("CU_WINDOW_CHANGED", "The selected window changed while it was being observed.")
    }

    const screenshotId = result.screenshot ? makeRef("shot") : undefined
    const elementIndexes = Array.isArray(result.accessibility?.elementIndexes)
      ? result.accessibility.elementIndexes
      : []
    const state = this.states.create({
      windowRef: nextRecord.windowRef,
      nativeStateRef: result.nativeStateRef,
      identityDigest: nextRecord.identityDigest,
      windowRevision: nextRecord.revision,
      inputEpoch: Number(result.inputEpoch ?? 0),
      bounds: nextRecord.window.bounds,
      dpiScale: nextRecord.window.dpiScale,
      imageWidth: Number(result.screenshot?.width ?? 0),
      imageHeight: Number(result.screenshot?.height ?? 0),
      screenshotIds: screenshotId ? [screenshotId] : [],
      accessibilityRevision: result.accessibility?.revision,
      accessibilityElementIndexes: elementIndexes,
    })
    const publicWindow = this.windows.publicWindow(nextRecord, classifyWindow(nextRecord.window))
    const screenshots = screenshotId
      ? [{
          id: screenshotId,
          originX: Number(result.screenshot.originX ?? 0),
          originY: Number(result.screenshot.originY ?? 0),
          width: Number(result.screenshot.width),
          height: Number(result.screenshot.height),
          zIndex: 0,
        }]
      : []
    const accessibility = result.accessibility
      ? {
          revision: result.accessibility.revision,
          tree: result.accessibility.tree,
          focusedElement: result.accessibility.focusedElement ?? null,
          selectedText: result.accessibility.selectedText ?? null,
          selectedElements: result.accessibility.selectedElements ?? [],
          documentText: result.accessibility.documentText ?? null,
          truncated: Boolean(result.accessibility.truncated),
        }
      : null
    return imageResult(
      `Captured a fresh state for ${publicWindow.processName} - ${publicWindow.title}.`,
      includeScreenshot ? result.screenshot?.imageBase64 : undefined,
      {
        stateRef: state.stateRef,
        window: publicWindow,
        screenshots,
        accessibility,
        accessibilityStatus: result.accessibilityStatus ?? null,
        expiresAt: new Date(state.expiresAt).toISOString(),
      },
    )
  }

  validateActionIntent(args) {
    const purpose = validatePurpose(args)
    const safety = validateSafety(args)
    return { purpose, ...safety }
  }

  async activateWindow(args, context) {
    return this.actions.run(async () => {
      this.validateActionIntent(args)
      const record = this.windows.get(stringArg(args, "windowRef", true))
      assertWindowAllowed(record.window)
      try {
        const result = await this.helper.call("activate_window", {
          expectedIdentity: record.identity,
        }, this.helperOptions(context))
        const nextRecord = this.windows.upsert(result.window)
        return runtimeResult(`Activated ${nextRecord.window.processName} - ${nextRecord.window.title}.`, {
          window: this.windows.publicWindow(nextRecord, classifyWindow(nextRecord.window)),
        })
      } finally {
        this.states.invalidateWindow(record.windowRef)
      }
    })
  }

  async launchApp(args, context) {
    return this.actions.run(async () => {
      const allowed = new Set(["appRef", "appId", "purpose", "safety"])
      const unexpected = Object.keys(args ?? {}).filter((name) => !allowed.has(name))
      if (unexpected.length > 0) {
        throw cuError(
          "CU_INVALID_ARGUMENT",
          "launch_app does not accept paths, arguments, URLs, commands, or other extra parameters.",
        )
      }
      this.validateActionIntent(args)
      const app = this.apps.resolve(args)
      if (app.blocked) {
        throw cuError("CU_APP_BLOCKED", app.blockReason || "The selected application is blocked.")
      }
      if (!app.canLaunch) {
        throw cuError("CU_INVALID_ARGUMENT", "The selected application cannot be launched.")
      }
      try {
        await this.helper.call("launch_app", {
          catalogRef: app.catalogRef,
          appId: app.appId,
        }, this.helperOptions(context))
        return runtimeResult(`Launched ${app.displayName}.`, {
          app: this.apps.publicApp(app, []),
        })
      } finally {
        this.states.invalidateAll()
      }
    })
  }

  async prepareStateAction(args, context, options = {}) {
    this.validateActionIntent(args)
    const windowRef = stringArg(args, "windowRef", true)
    const stateRef = stringArg(args, "stateRef", true)
    const record = this.windows.get(windowRef)
    assertWindowAllowed(record.window)
    const initialState = this.states.validate({
      windowRef,
      stateRef,
      screenshotId: options.screenshotId,
      elementIndex: options.elementIndex,
      identityDigest: record.identityDigest,
      windowRevision: record.revision,
    })
    const refreshed = await this.refreshRecord(record, context)
    const state = this.states.consume({
      windowRef,
      stateRef,
      screenshotId: options.screenshotId,
      elementIndex: options.elementIndex,
      identityDigest: refreshed.identityDigest,
      windowRevision: refreshed.revision,
      currentInputEpoch: Number(refreshed.inputEpoch ?? initialState.inputEpoch),
    })
    return { record: refreshed, state }
  }

  helperState(record, state) {
    return {
      expectedIdentity: record.identity,
      observedBounds: state.bounds,
      observedDpiScale: state.dpiScale,
      observedInputEpoch: state.inputEpoch,
      imageWidth: state.imageWidth,
      imageHeight: state.imageHeight,
      nativeStateRef: state.nativeStateRef,
      accessibilityRevision: state.accessibilityRevision,
    }
  }

  async performPointOrElementAction(type, args, context) {
    return this.actions.run(async () => {
      const hasElement = args?.elementIndex !== undefined
      const hasPoint = args?.screenshotId !== undefined || args?.x !== undefined || args?.y !== undefined
      if (hasElement === hasPoint) {
        throw cuError(
          "CU_INVALID_ARGUMENT",
          `${type} requires exactly one target: elementIndex or screenshotId + x + y.`,
        )
      }
      if (hasElement) {
        const elementIndex = integerArg(args, "elementIndex")
        const { record, state } = await this.prepareStateAction(args, context, { elementIndex })
        const action = type === "click"
          ? {
              type: "click_element",
              elementIndex,
              button: stringArg(args, "button") || "left",
              clickCount: Math.min(Math.max(numberArg(args, "clickCount", 1), 1), 2),
            }
          : {
              type: "scroll_element",
              elementIndex,
              deltaX: numberArg(args, "deltaX", 0),
              deltaY: numberArg(args, "deltaY"),
            }
        await this.helper.call("perform_action", {
          ...this.helperState(record, state),
          action,
        }, this.helperOptions(context))
        return runtimeResult(
          type === "click"
            ? `Clicked UI Automation element ${elementIndex}.`
            : `Scrolled UI Automation element ${elementIndex}.`,
          { windowRef: record.windowRef, stateConsumed: true, elementIndex },
        )
      }

      const screenshotId = stringArg(args, "screenshotId", true)
      const { record, state } = await this.prepareStateAction(args, context, { screenshotId })
      const x = numberArg(args, "x")
      const y = numberArg(args, "y")
      validateCoordinate(state, x, y)
      const action = type === "click"
        ? {
            type,
            x,
            y,
            button: stringArg(args, "button") || "left",
            clickCount: Math.min(Math.max(numberArg(args, "clickCount", 1), 1), 2),
          }
        : {
            type,
            x,
            y,
            deltaX: numberArg(args, "deltaX", 0),
            deltaY: numberArg(args, "deltaY"),
          }
      await this.helper.call("perform_action", {
        ...this.helperState(record, state),
        action,
      }, this.helperOptions(context))
      return runtimeResult(
        type === "click" ? `Clicked ${action.button} at ${x}, ${y}.` : `Scrolled at ${x}, ${y}.`,
        { windowRef: record.windowRef, stateConsumed: true },
      )
    })
  }

  async setValue(args, context) {
    return this.actions.run(async () => {
      const elementIndex = integerArg(args, "elementIndex")
      const { record, state } = await this.prepareStateAction(args, context, { elementIndex })
      const value = typeof args?.value === "string" ? args.value : undefined
      if (value === undefined || value.length > 32768) {
        throw cuError("CU_INVALID_ARGUMENT", "value must be a string no longer than 32768 characters.")
      }
      await this.helper.call("perform_action", {
        ...this.helperState(record, state),
        action: { type: "set_value", elementIndex, value },
      }, this.helperOptions(context))
      return runtimeResult(`Set UI Automation element ${elementIndex} to a ${value.length}-character value.`, {
        windowRef: record.windowRef,
        stateConsumed: true,
        elementIndex,
        characterCount: value.length,
      })
    })
  }

  async performSecondaryAction(args, context) {
    return this.actions.run(async () => {
      const elementIndex = integerArg(args, "elementIndex")
      const secondaryAction = stringArg(args, "action", true)
      if (!["toggle", "select", "expand", "collapse"].includes(secondaryAction)) {
        throw cuError("CU_INVALID_ARGUMENT", "action must be toggle, select, expand, or collapse.")
      }
      const { record, state } = await this.prepareStateAction(args, context, { elementIndex })
      await this.helper.call("perform_action", {
        ...this.helperState(record, state),
        action: {
          type: "perform_secondary_action",
          elementIndex,
          secondaryAction,
        },
      }, this.helperOptions(context))
      return runtimeResult(`Performed ${secondaryAction} on UI Automation element ${elementIndex}.`, {
        windowRef: record.windowRef,
        stateConsumed: true,
        elementIndex,
        action: secondaryAction,
      })
    })
  }

  async pressKey(args, context) {
    return this.actions.run(async () => {
      const { record, state } = await this.prepareStateAction(args, context)
      const keys = keysArg(args)
      await this.helper.call("perform_action", {
        ...this.helperState(record, state),
        action: { type: "press_key", keys },
      }, this.helperOptions(context))
      return runtimeResult(`Pressed ${keys.join("+")}.`, {
        windowRef: record.windowRef,
        stateConsumed: true,
        keys,
      })
    })
  }

  async typeText(args, context) {
    return this.actions.run(async () => {
      const { record, state } = await this.prepareStateAction(args, context)
      const text = typeof args?.text === "string" ? args.text : undefined
      if (text === undefined || text.length > 32768) {
        throw cuError("CU_INVALID_ARGUMENT", "text must be a string no longer than 32768 characters.")
      }
      await this.helper.call("perform_action", {
        ...this.helperState(record, state),
        action: { type: "type_text", text },
      }, this.helperOptions(context))
      return runtimeResult(`Typed ${text.length} character(s).`, {
        windowRef: record.windowRef,
        stateConsumed: true,
        characterCount: text.length,
      })
    })
  }

  async drag(args, context) {
    return this.actions.run(async () => {
      const screenshotId = stringArg(args, "screenshotId", true)
      const { record, state } = await this.prepareStateAction(args, context, { screenshotId })
      const fromX = numberArg(args, "fromX")
      const fromY = numberArg(args, "fromY")
      const toX = numberArg(args, "toX")
      const toY = numberArg(args, "toY")
      validateCoordinate(state, fromX, fromY, "from coordinate")
      validateCoordinate(state, toX, toY, "to coordinate")
      await this.helper.call("perform_action", {
        ...this.helperState(record, state),
        action: { type: "drag", fromX, fromY, toX, toY },
      }, this.helperOptions(context))
      return runtimeResult(`Dragged from ${fromX}, ${fromY} to ${toX}, ${toY}.`, {
        windowRef: record.windowRef,
        stateConsumed: true,
      })
    })
  }

  async close(context = {}) {
    this.states.invalidateAll()
    try {
      if (typeof this.helper.endTurnAndStop === "function") {
        await this.helper.endTurnAndStop(this.helperOptions(context))
      } else {
        await this.helper.call("end_turn", {}, this.helperOptions(context))
      }
    } catch {
      // Connection loss and physical interruption already force native cleanup.
    } finally {
      this.helper.stop()
    }
  }
}

module.exports = {
  ComputerUseRuntime,
  imageResult,
  runtimeResult,
  validateCoordinate,
}
