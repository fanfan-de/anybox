#!/usr/bin/env node

const { spawn } = require("node:child_process")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const readline = require("node:readline")

const PLUGIN_ROOT = path.resolve(__dirname, "..")
const HELPER_EXE = path.join(PLUGIN_ROOT, "helper", "win32-x64", "computer-use-helper.exe")
const SNAPSHOT_TTL_MS = 10 * 60 * 1000
const WINDOW_TTL_MS = 10 * 60 * 1000
const HELPER_TIMEOUT_MS = 15_000
const SAFETY_VALUES = [
  "normal",
  "submit_or_send",
  "delete",
  "upload",
  "install",
  "auth_or_secret",
  "finance",
  "security_settings",
]
const HARD_REJECT_SAFETY = new Set(["auth_or_secret", "finance", "security_settings"])
const ELEVATED_REVIEW_SAFETY = new Set(["submit_or_send", "delete", "upload", "install"])
const BLOCKED_PROCESSES = new Set([
  "1password.exe",
  "bash.exe",
  "bitwarden.exe",
  "cmd.exe",
  "conhost.exe",
  "consent.exe",
  "credentialui.exe",
  "dashlane.exe",
  "keepass.exe",
  "keepassxc.exe",
  "lastpass.exe",
  "lockapp.exe",
  "openconsole.exe",
  "powershell.exe",
  "pwsh.exe",
  "securityhealthsystray.exe",
  "windowsterminal.exe",
  "wsl.exe",
  "wt.exe",
])
const BLOCKED_TITLE_PATTERNS = [
  /\bCAPTCHA\b/i,
  /\bCredential\b/i,
  /\bUser Account Control\b/i,
  /\bWindows Security\b/i,
  /\bsecurity warning\b/i,
  /\bdeceptive site ahead\b/i,
  /\bprivacy error\b/i,
  /\byour connection is not private\b/i,
]

const windowsByRef = new Map()
const windowRefsByHwnd = new Map()
const snapshotsByRef = new Map()

let helperProcess
let helperReadline
let helperNextID = 1
let inputClosed = false
const helperPending = new Map()

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function textResult(text, structuredContent) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
    isError: false,
  }
}

function imageResult(text, imageBase64, structuredContent) {
  const content = [{ type: "text", text }]
  if (imageBase64) {
    content.push({ type: "image", data: imageBase64, mimeType: "image/png" })
  }
  return { content, structuredContent, isError: false }
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message },
    isError: true,
  }
}

function now() {
  return Date.now()
}

function makeRef(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
}

function normalizeProcessName(value) {
  const raw = String(value || "").trim().toLowerCase()
  if (!raw) return ""
  return raw.endsWith(".exe") ? raw : `${raw}.exe`
}

function windowBlockReason(window) {
  const processName = normalizeProcessName(window.processName)
  if (BLOCKED_PROCESSES.has(processName)) {
    return `Blocked target process: ${processName}`
  }

  const title = String(window.title || "")
  for (const pattern of BLOCKED_TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return `Blocked target window title: ${title}`
    }
  }

  return null
}

function publicWindow(record) {
  const reason = windowBlockReason(record.window)
  return {
    windowRef: record.windowRef,
    title: record.window.title || "",
    processName: record.window.processName || "",
    pid: record.window.pid,
    bounds: record.window.bounds,
    clientBounds: record.window.clientBounds,
    dpiScale: record.window.dpiScale,
    blocked: Boolean(reason),
    blockReason: reason || undefined,
    updatedAt: record.updatedAt,
  }
}

function upsertWindow(rawWindow) {
  if (!rawWindow || typeof rawWindow !== "object" || !rawWindow.hwnd) {
    throw new Error("Helper returned an invalid window object.")
  }

  const hwnd = String(rawWindow.hwnd)
  let windowRef = windowRefsByHwnd.get(hwnd)
  if (!windowRef) {
    windowRef = makeRef("win")
    windowRefsByHwnd.set(hwnd, windowRef)
  }

  const previous = windowsByRef.get(windowRef)
  const previousEpoch = previous?.epoch ?? 0
  const changed =
    previous &&
    (
      previous.window.title !== rawWindow.title ||
      previous.window.processName !== rawWindow.processName ||
      previous.window.pid !== rawWindow.pid ||
      JSON.stringify(previous.window.bounds) !== JSON.stringify(rawWindow.bounds)
    )

  const record = {
    windowRef,
    hwnd,
    window: rawWindow,
    epoch: changed ? previousEpoch + 1 : previousEpoch,
    updatedAt: now(),
  }
  windowsByRef.set(windowRef, record)
  return record
}

function getKnownWindow(windowRef) {
  if (!windowRef || typeof windowRef !== "string") {
    throw new Error("A valid windowRef is required.")
  }

  const record = windowsByRef.get(windowRef)
  if (!record) {
    throw new Error(`Unknown windowRef: ${windowRef}`)
  }

  if (now() - record.updatedAt > WINDOW_TTL_MS) {
    throw new Error(`Window reference expired: ${windowRef}. Call list_windows or get_window again.`)
  }

  return record
}

function getSnapshot(snapshotRef, windowRef) {
  if (!snapshotRef || typeof snapshotRef !== "string") {
    throw new Error("A valid snapshotRef is required.")
  }

  const snapshot = snapshotsByRef.get(snapshotRef)
  if (!snapshot) {
    throw new Error(`Unknown snapshotRef: ${snapshotRef}`)
  }

  if (snapshot.windowRef !== windowRef) {
    throw new Error("snapshotRef does not belong to the selected windowRef.")
  }

  if (now() - snapshot.createdAt > SNAPSHOT_TTL_MS) {
    throw new Error(`Snapshot expired: ${snapshotRef}. Call get_window_state again.`)
  }

  return snapshot
}

function validatePurpose(args) {
  const purpose = String(args?.purpose || "").trim()
  if (!purpose) {
    throw new Error("Action tools require a non-empty purpose.")
  }
  return purpose
}

function validateSafety(args) {
  const safety = String(args?.safety || "normal").trim()
  if (!SAFETY_VALUES.includes(safety)) {
    throw new Error(`Invalid safety value: ${safety}`)
  }
  if (HARD_REJECT_SAFETY.has(safety)) {
    throw new Error(`Safety category '${safety}' cannot be automated by this plugin.`)
  }
  return safety
}

function validateActionWindow(record) {
  const reason = windowBlockReason(record.window)
  if (reason) {
    throw new Error(reason)
  }
}

function validateCoordinate(snapshot, x, y, label = "coordinate") {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`${label} must be finite numbers.`)
  }

  if (x < 0 || y < 0 || x >= snapshot.imageWidth || y >= snapshot.imageHeight) {
    throw new Error(`${label} is outside the latest snapshot bounds.`)
  }
}

function boolArg(args, name, defaultValue) {
  const value = args?.[name]
  return typeof value === "boolean" ? value : defaultValue
}

function numberArg(args, name, defaultValue) {
  const value = args?.[name]
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value)
  if (defaultValue !== undefined) return defaultValue
  throw new Error(`${name} must be a number.`)
}

function stringArg(args, name, required = false) {
  const value = args?.[name]
  if (typeof value === "string" && value.trim()) return value.trim()
  if (required) throw new Error(`${name} is required.`)
  return undefined
}

function keysArg(args) {
  const value = args?.keys
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new Error("keys must be a non-empty string array.")
  }
  return value.map((item) => item.trim())
}

function helperAvailable() {
  return process.platform === "win32" && fs.existsSync(HELPER_EXE)
}

function ensureHelper() {
  if (process.platform !== "win32") {
    throw new Error("Computer Use Windows is only supported on Windows.")
  }
  if (!fs.existsSync(HELPER_EXE)) {
    throw new Error(`Computer Use helper executable is missing: ${HELPER_EXE}`)
  }
  if (helperProcess && !helperProcess.killed) return helperProcess

  helperProcess = spawn(HELPER_EXE, [], {
    cwd: PLUGIN_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })

  const child = helperProcess
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")

  helperReadline = readline.createInterface({ input: child.stdout })
  helperReadline.on("line", (line) => {
    if (!line.trim()) return
    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      process.stderr.write(`[computer-use-windows] invalid helper JSON: ${line}\n`)
      return
    }

    const pending = helperPending.get(String(message.id || ""))
    if (!pending) return
    if (pending.child !== child) return
    helperPending.delete(String(message.id || ""))
    clearTimeout(pending.timeout)
    if (message.ok) {
      pending.resolve(message.result)
    } else {
      pending.reject(new Error(message.error || "Helper command failed."))
    }
  })

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[computer-use-windows helper] ${chunk}`)
  })

  child.on("exit", (code, signal) => {
    for (const [pendingID, pending] of helperPending.entries()) {
      if (pending.child !== child) continue
      clearTimeout(pending.timeout)
      pending.reject(new Error(`Computer Use helper exited (${code ?? signal ?? "unknown"}).`))
      helperPending.delete(pendingID)
    }
    if (helperProcess === child) {
      helperProcess = undefined
      helperReadline = undefined
    }
  })

  return child
}

function helperCall(command, params = {}, timeoutMs = HELPER_TIMEOUT_MS) {
  const child = ensureHelper()
  const id = String(helperNextID++)
  const payload = JSON.stringify({ id, command, params })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      helperPending.delete(id)
      if (helperProcess === child) {
        helperProcess = undefined
        helperReadline = undefined
      }
      if (!child.killed) {
        child.kill()
      }
      reject(new Error(`Helper command timed out: ${command}`))
    }, timeoutMs)
    helperPending.set(id, { child, resolve, reject, timeout })
    child.stdin.write(`${payload}\n`, "utf8", (error) => {
      if (error) {
        clearTimeout(timeout)
        helperPending.delete(id)
        reject(error)
      }
    })
  })
}

async function refreshRecord(record) {
  const result = await helperCall("resolve_window", { hwnd: record.hwnd })
  return upsertWindow(result.window)
}

async function findWindow(args = {}) {
  if (args.windowRef) {
    return await refreshRecord(getKnownWindow(args.windowRef))
  }

  const titleQuery = stringArg(args, "titleQuery", false)?.toLowerCase()
  const processName = normalizeProcessName(args.processName)
  if (!titleQuery && !processName) {
    throw new Error("get_window requires windowRef, titleQuery, or processName.")
  }

  const result = await helperCall("list_windows")
  const records = result.windows.map(upsertWindow)
  const match = records.find((record) => {
    const titleMatches = titleQuery ? String(record.window.title || "").toLowerCase().includes(titleQuery) : true
    const processMatches = processName ? normalizeProcessName(record.window.processName) === processName : true
    return titleMatches && processMatches
  })

  if (!match) {
    throw new Error("No matching window found.")
  }
  return match
}

function cleanupStores() {
  const cutoff = now() - Math.max(WINDOW_TTL_MS, SNAPSHOT_TTL_MS)
  for (const [ref, record] of windowsByRef.entries()) {
    if (record.updatedAt < cutoff) {
      windowsByRef.delete(ref)
      windowRefsByHwnd.delete(record.hwnd)
    }
  }
  for (const [ref, snapshot] of snapshotsByRef.entries()) {
    if (snapshot.createdAt < cutoff) snapshotsByRef.delete(ref)
  }
}

const tools = [
  {
    name: "computer_health_check",
    title: "Computer Use Health Check",
    description: "Check whether the local Windows helper is available.",
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true },
    async handler() {
      if (!helperAvailable()) {
        return textResult("Computer Use Windows helper is not available.", {
          supported: process.platform === "win32",
          helperPath: HELPER_EXE,
          helperExists: fs.existsSync(HELPER_EXE),
        })
      }
      const result = await helperCall("health_check")
      return textResult("Computer Use Windows helper is available.", {
        ...result,
        helperPath: HELPER_EXE,
      })
    },
  },
  {
    name: "list_windows",
    title: "List Windows",
    description: "List visible controllable Windows desktop windows.",
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true },
    async handler() {
      cleanupStores()
      const result = await helperCall("list_windows")
      const windows = result.windows.map((window) => publicWindow(upsertWindow(window)))
      return textResult(
        windows.length
          ? windows.map((window) => `${window.windowRef}: ${window.processName} - ${window.title}${window.blocked ? " [blocked]" : ""}`).join("\n")
          : "No visible desktop windows were found.",
        { windows },
      )
    },
  },
  {
    name: "get_window",
    title: "Get Window",
    description: "Resolve a window by reference, title substring, or process name.",
    inputSchema: objectSchema({
      windowRef: { type: "string", description: "A windowRef returned by list_windows or get_window_state." },
      titleQuery: { type: "string", description: "Case-insensitive title substring." },
      processName: { type: "string", description: "Process executable name such as notepad.exe." },
    }),
    annotations: { readOnlyHint: true },
    async handler(args) {
      const record = await findWindow(args)
      const window = publicWindow(record)
      return textResult(`${window.windowRef}: ${window.processName} - ${window.title}`, { window })
    },
  },
  {
    name: "get_window_state",
    title: "Get Window State",
    description: "Capture screenshot metadata and optional image content for a selected window.",
    inputSchema: objectSchema({
      windowRef: { type: "string", description: "A windowRef returned by list_windows or get_window." },
      includeScreenshot: { type: "boolean", description: "Whether to include a PNG screenshot. Defaults to true." },
      includeAccessibility: { type: "boolean", description: "Reserved for UI Automation in a later phase." },
    }, ["windowRef"]),
    annotations: { readOnlyHint: true },
    async handler(args) {
      const includeScreenshot = boolArg(args, "includeScreenshot", true)
      const includeAccessibility = boolArg(args, "includeAccessibility", false)
      const record = await refreshRecord(getKnownWindow(stringArg(args, "windowRef", true)))
      const result = await helperCall("capture_window", { hwnd: record.hwnd }, 20_000)
      const nextRecord = upsertWindow(result.window)
      const snapshotRef = makeRef("snap")
      const snapshot = {
        snapshotRef,
        windowRef: nextRecord.windowRef,
        epoch: nextRecord.epoch,
        imageWidth: result.imageWidth,
        imageHeight: result.imageHeight,
        bounds: nextRecord.window.bounds,
        createdAt: now(),
      }
      snapshotsByRef.set(snapshotRef, snapshot)

      const state = {
        windowRef: nextRecord.windowRef,
        snapshotRef,
        title: nextRecord.window.title || "",
        processName: nextRecord.window.processName || "",
        pid: nextRecord.window.pid,
        bounds: nextRecord.window.bounds,
        clientBounds: nextRecord.window.clientBounds,
        dpiScale: nextRecord.window.dpiScale,
        imageWidth: result.imageWidth,
        imageHeight: result.imageHeight,
        accessibility: includeAccessibility ? null : null,
        accessibilityStatus: includeAccessibility ? "not_implemented" : undefined,
        blocked: Boolean(windowBlockReason(nextRecord.window)),
        blockReason: windowBlockReason(nextRecord.window) || undefined,
      }

      return imageResult(
        `Captured ${state.imageWidth}x${state.imageHeight} window state for ${state.processName} - ${state.title}.`,
        includeScreenshot ? result.imageBase64 : undefined,
        state,
      )
    },
  },
  {
    name: "activate_window",
    title: "Activate Window",
    description: "Bring a selected window to the foreground.",
    inputSchema: actionSchema({
      windowRef: { type: "string" },
    }, ["windowRef", "purpose"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args) {
      validatePurpose(args)
      validateSafety({ ...args, safety: "normal" })
      const record = await refreshRecord(getKnownWindow(stringArg(args, "windowRef", true)))
      validateActionWindow(record)
      const result = await helperCall("activate_window", { hwnd: record.hwnd })
      const nextRecord = upsertWindow(result.window)
      return textResult(`Activated ${nextRecord.window.processName} - ${nextRecord.window.title}.`, {
        window: publicWindow(nextRecord),
      })
    },
  },
  {
    name: "click",
    title: "Click",
    description: "Click inside a selected window using snapshot-relative coordinates.",
    inputSchema: actionSchema({
      windowRef: { type: "string" },
      snapshotRef: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
      button: { type: "string", enum: ["left", "right"] },
      clickCount: { type: "number", minimum: 1, maximum: 2 },
    }, ["windowRef", "snapshotRef", "x", "y", "purpose", "safety"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args) {
      const { record } = await validateInputAction(args)
      const snapshot = getSnapshot(stringArg(args, "snapshotRef", true), record.windowRef)
      const x = numberArg(args, "x")
      const y = numberArg(args, "y")
      validateCoordinate(snapshot, x, y)
      const button = stringArg(args, "button", false) || "left"
      const clickCount = Math.min(Math.max(numberArg(args, "clickCount", 1), 1), 2)
      await helperCall("send_input", { hwnd: record.hwnd, action: "click", x, y, button, clickCount })
      return textResult(`Clicked ${button} at ${x}, ${y}.`, { ok: true, windowRef: record.windowRef })
    },
  },
  {
    name: "scroll",
    title: "Scroll",
    description: "Scroll inside a selected window using snapshot-relative coordinates.",
    inputSchema: actionSchema({
      windowRef: { type: "string" },
      snapshotRef: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
      deltaX: { type: "number" },
      deltaY: { type: "number" },
    }, ["windowRef", "snapshotRef", "x", "y", "deltaY", "purpose", "safety"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args) {
      const { record } = await validateInputAction(args)
      const snapshot = getSnapshot(stringArg(args, "snapshotRef", true), record.windowRef)
      const x = numberArg(args, "x")
      const y = numberArg(args, "y")
      validateCoordinate(snapshot, x, y)
      const deltaX = numberArg(args, "deltaX", 0)
      const deltaY = numberArg(args, "deltaY")
      await helperCall("send_input", { hwnd: record.hwnd, action: "scroll", x, y, deltaX, deltaY })
      return textResult(`Scrolled at ${x}, ${y}.`, { ok: true, windowRef: record.windowRef, deltaX, deltaY })
    },
  },
  {
    name: "press_key",
    title: "Press Key",
    description: "Press keyboard keys or shortcuts in a selected window.",
    inputSchema: actionSchema({
      windowRef: { type: "string" },
      keys: { type: "array", items: { type: "string" }, minItems: 1 },
    }, ["windowRef", "keys", "purpose", "safety"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args) {
      const { record } = await validateInputAction(args)
      const keys = keysArg(args)
      await helperCall("send_input", { hwnd: record.hwnd, action: "press_key", keys })
      return textResult(`Pressed ${keys.join("+")}.`, { ok: true, windowRef: record.windowRef, keys })
    },
  },
  {
    name: "type_text",
    title: "Type Text",
    description: "Type text into a selected window.",
    inputSchema: actionSchema({
      windowRef: { type: "string" },
      text: { type: "string" },
    }, ["windowRef", "text", "purpose", "safety"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args) {
      const { record } = await validateInputAction(args)
      const text = stringArg(args, "text", true)
      await helperCall("send_input", { hwnd: record.hwnd, action: "type_text", text })
      return textResult(`Typed ${text.length} character(s).`, { ok: true, windowRef: record.windowRef, characterCount: text.length })
    },
  },
  {
    name: "drag",
    title: "Drag",
    description: "Drag inside a selected window using snapshot-relative coordinates.",
    inputSchema: actionSchema({
      windowRef: { type: "string" },
      snapshotRef: { type: "string" },
      fromX: { type: "number" },
      fromY: { type: "number" },
      toX: { type: "number" },
      toY: { type: "number" },
    }, ["windowRef", "snapshotRef", "fromX", "fromY", "toX", "toY", "purpose", "safety"]),
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args) {
      const { record } = await validateInputAction(args)
      const snapshot = getSnapshot(stringArg(args, "snapshotRef", true), record.windowRef)
      const fromX = numberArg(args, "fromX")
      const fromY = numberArg(args, "fromY")
      const toX = numberArg(args, "toX")
      const toY = numberArg(args, "toY")
      validateCoordinate(snapshot, fromX, fromY, "from coordinate")
      validateCoordinate(snapshot, toX, toY, "to coordinate")
      await helperCall("send_input", { hwnd: record.hwnd, action: "drag", fromX, fromY, toX, toY })
      return textResult(`Dragged from ${fromX}, ${fromY} to ${toX}, ${toY}.`, { ok: true, windowRef: record.windowRef })
    },
  },
]

const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))

async function validateInputAction(args) {
  validatePurpose(args)
  const safety = validateSafety(args)
  const record = await refreshRecord(getKnownWindow(stringArg(args, "windowRef", true)))
  validateActionWindow(record)
  return {
    record,
    safety,
    elevatedReview: ELEVATED_REVIEW_SAFETY.has(safety),
  }
}

function objectSchema(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  }
}

function actionSchema(properties, required = []) {
  return objectSchema({
    ...properties,
    purpose: {
      type: "string",
      description: "Short reason for the desktop action.",
    },
    safety: {
      type: "string",
      enum: SAFETY_VALUES,
      description: "Risk category for the action.",
    },
  }, required)
}

function toolDefinition(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }
}

async function callTool(name, args) {
  const tool = toolsByName.get(name)
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  return await tool.handler(args || {})
}

const rl = readline.createInterface({ input: process.stdin })

rl.on("line", (line) => {
  void (async () => {
    if (!line.trim()) return
    const message = JSON.parse(line)

    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "computer-use-windows", version: "0.1.1" },
        },
      })
      return
    }

    if (String(message.method || "").startsWith("notifications/")) return

    if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools: tools.map(toolDefinition) } })
      return
    }

    if (message.method === "tools/call") {
      try {
        const result = await callTool(message.params && message.params.name, message.params && message.params.arguments)
        send({ jsonrpc: "2.0", id: message.id, result })
      } catch (error) {
        send({ jsonrpc: "2.0", id: message.id, result: errorResult(error) })
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
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
      },
    })
  })
})

rl.on("close", () => {
  inputClosed = true
  shutdownWhenIdle()
})

function shutdownWhenIdle() {
  if (!inputClosed) return
  if (helperPending.size > 0) {
    setTimeout(shutdownWhenIdle, 50)
    return
  }
  if (helperProcess && !helperProcess.killed) {
    helperProcess.kill()
  }
  process.exit(0)
}
