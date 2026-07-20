#!/usr/bin/env node
"use strict"

const path = require("node:path")
const readline = require("node:readline")
const {
  CAPTURE_HELPER_TIMEOUT_MS,
  PLUGIN_VERSION,
  PROTOCOL_VERSION,
  STATE_TTL_MS,
} = require("./lib/build-info")
const { AppRegistry } = require("./lib/app-registry")
const { asComputerUseError, cuError, errorPayload } = require("./lib/errors")
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
const { TOOL_DEFINITIONS } = require("./lib/tool-definitions")
const { WindowRegistry, normalizeProcessName } = require("./lib/window-registry")

const PLUGIN_ROOT = path.resolve(__dirname, "..")
const DEFAULT_HELPER_EXE = path.join(PLUGIN_ROOT, "helper", "win32-x64", "computer-use-helper.exe")

function textResult(text, structuredContent = {}) {
  return {
    content: [{ type: "text", text }],
    structuredContent: { ok: true, ...structuredContent },
    isError: false,
  }
}

function imageResult(text, imageBase64, structuredContent = {}) {
  const content = [{ type: "text", text }]
  if (imageBase64) content.push({ type: "image", data: imageBase64, mimeType: "image/png" })
  return {
    content,
    structuredContent: { ok: true, ...structuredContent },
    isError: false,
  }
}

function errorResult(error) {
  const normalized = asComputerUseError(error)
  return {
    content: [{ type: "text", text: normalized.message }],
    structuredContent: {
      ok: false,
      error: errorPayload(normalized),
    },
    isError: true,
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

class ComputerUseServer {
  constructor(options = {}) {
    this.windows = options.windows ?? new WindowRegistry(options.windowRegistryOptions)
    this.apps = options.apps ?? new AppRegistry(options.appRegistryOptions)
    this.states = options.states ?? new StateRegistry(options.stateRegistryOptions)
    this.helper = options.helper ?? new HelperClient({
      helperPath: options.helperPath
        ?? process.env.ANYBOX_COMPUTER_USE_HELPER_PATH
        ?? DEFAULT_HELPER_EXE,
      cwd: options.pluginRoot ?? PLUGIN_ROOT,
    })
    this.actions = options.actions ?? new SerialQueue()
    this.definitions = TOOL_DEFINITIONS
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

  toolDefinitions() {
    return this.definitions
  }

  async callTool(name, args = {}, context = {}) {
    const handler = this.handlers.get(name)
    if (!handler) throw cuError("CU_INVALID_ARGUMENT", `Unknown tool: ${name}`)
    return handler(args, context)
  }

  async healthCheck(_args, context) {
    const handshake = await this.helper.ensureInitialized()
    const result = await this.helper.call("health_check", {}, { signal: context.signal })
    return textResult("Computer Use Windows helper is available.", {
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
    const result = await this.helper.call("list_windows", {}, { signal: context.signal })
    const windows = (result.windows ?? []).map((window) => {
      const record = this.windows.upsert(window)
      return this.windows.publicWindow(record, classifyWindow(record.window))
    })
    return textResult(
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
    const result = await this.helper.call("list_apps", {}, {
      signal: context.signal,
      timeoutMs: CAPTURE_HELPER_TIMEOUT_MS,
    })
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
    return textResult(
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
    }, { signal: context.signal })
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
    const result = await this.helper.call("list_windows", {}, { signal: context.signal })
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
    return textResult(`${window.windowRef}: ${window.processName} - ${window.title}`, { window })
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
    }, {
      signal: context.signal,
      timeoutMs: CAPTURE_HELPER_TIMEOUT_MS,
    })
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
        }, { signal: context.signal })
        const nextRecord = this.windows.upsert(result.window)
        return textResult(`Activated ${nextRecord.window.processName} - ${nextRecord.window.title}.`, {
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
        }, { signal: context.signal })
        return textResult(`Launched ${app.displayName}.`, {
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
        }, { signal: context.signal })
        return textResult(
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
      }, { signal: context.signal })
      return textResult(
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
      }, { signal: context.signal })
      return textResult(`Set UI Automation element ${elementIndex} to a ${value.length}-character value.`, {
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
      }, { signal: context.signal })
      return textResult(`Performed ${secondaryAction} on UI Automation element ${elementIndex}.`, {
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
      }, { signal: context.signal })
      return textResult(`Pressed ${keys.join("+")}.`, {
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
      }, { signal: context.signal })
      return textResult(`Typed ${text.length} character(s).`, {
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
      }, { signal: context.signal })
      return textResult(`Dragged from ${fromX}, ${fromY} to ${toX}, ${toY}.`, {
        windowRef: record.windowRef,
        stateConsumed: true,
      })
    })
  }

  close() {
    this.states.invalidateAll()
    this.helper.stop()
  }
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function startMcpServer(server = new ComputerUseServer()) {
  const controllers = new Map()
  const rl = readline.createInterface({ input: process.stdin })

  rl.on("line", (line) => {
    void (async () => {
      if (!line.trim()) return
      let message
      try {
        message = JSON.parse(line)
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid MCP JSON." } })
        return
      }

      if (message.method === "initialize") {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "computer-use-windows", version: PLUGIN_VERSION },
          },
        })
        return
      }
      if (message.method === "notifications/cancelled") {
        controllers.get(String(message.params?.requestId))?.abort()
        return
      }
      if (String(message.method || "").startsWith("notifications/")) return
      if (message.method === "tools/list") {
        send({ jsonrpc: "2.0", id: message.id, result: { tools: server.toolDefinitions() } })
        return
      }
      if (message.method === "tools/call") {
        const id = String(message.id)
        const controller = new AbortController()
        controllers.set(id, controller)
        try {
          const result = await server.callTool(
            message.params?.name,
            message.params?.arguments ?? {},
            { signal: controller.signal },
          )
          send({ jsonrpc: "2.0", id: message.id, result })
        } catch (error) {
          send({ jsonrpc: "2.0", id: message.id, result: errorResult(error) })
        } finally {
          controllers.delete(id)
        }
        return
      }
      if (message.method === "ping") {
        send({ jsonrpc: "2.0", id: message.id, result: {} })
        return
      }
      if (message.method === "roots/list") {
        send({ jsonrpc: "2.0", id: message.id, result: { roots: [] } })
        return
      }
      if (message.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `Unknown method: ${message.method}` },
        })
      }
    })().catch((error) => {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: asComputerUseError(error).message },
      })
    })
  })

  rl.on("close", () => {
    for (const controller of controllers.values()) controller.abort()
    server.close()
  })
  return { rl, server }
}

if (require.main === module) startMcpServer()

module.exports = {
  ComputerUseServer,
  errorResult,
  imageResult,
  startMcpServer,
  textResult,
  validateCoordinate,
}
