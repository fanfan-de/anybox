import { existsSync, mkdirSync, statSync } from "node:fs"
import http from "node:http"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolveAnyboxMobileScheme } from "./lib/android-development.mjs"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const defaultApkPath = path.join(packageRoot, "build", "anybox-mobile-debug.apk")
const defaultScreenshotPath = path.join(packageRoot, "build", "anybox-mobile-pairing.png")
const defaultPackageName = "com.anybox.mobile"
const remoteScreenshotPath = "/sdcard/anybox-mobile-pairing-smoke.png"
const remoteWindowPath = "/sdcard/anybox-mobile-pairing-window.xml"
const mockPairingCode = "smoke-code"
const mockDeviceToken = "mobile_smoke_device_token"
const smokePromptText = "runmobilesmoke"
const smokeReplyText = "Streamed reply from mock bridge."
const smokeApprovalID = "approval-smoke"
const smokeApprovalTitle = "Allow smoke command"
const smokeGlobalApprovalID = "approval-global-smoke"
const smokeGlobalApprovalTitle = "Allow global smoke command"

const mockCapabilities = [
  "workspace:read",
  "session:read",
  "session:create",
  "message:send",
  "task:cancel",
  "approval:read",
  "approval:respond",
  "workspace-file:read",
]

const fatalLogPatterns = [
  /FATAL EXCEPTION/i,
  /\bE AndroidRuntime\b.*FATAL/i,
  /Unable to load script/i,
  /Cannot find native module/i,
  /Invariant Violation/i,
  /ReactNativeJS.*(?:Error|TypeError|ReferenceError)/i,
]

function usage() {
  return [
    "Anybox Android Pairing Smoke Test",
    "",
    "Usage:",
    "  pnpm --filter anybox-mobile-app run android:smoke:pairing",
    "",
    "Options:",
    "  --apk <path>          APK path. Defaults to build/anybox-mobile-debug.apk.",
    "  --package <name>      Android application ID.",
    "  --scheme <scheme>     Deep-link scheme: anybox-mobile or anybox-mobile-dev.",
    "  --screenshot <path>   Local screenshot output path.",
    "  --wait <seconds>      Max seconds to wait for paired Home UI. Defaults to 30.",
    "  --skip-install        Reuse the app already installed on the connected device.",
    "  --help                Show this help.",
  ].join("\n")
}

function parseArgs(argv) {
  const args = {
    apk: defaultApkPath,
    help: false,
    packageName: defaultPackageName,
    scheme: "anybox-mobile",
    screenshot: defaultScreenshotPath,
    skipInstall: false,
    waitSeconds: 30,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--help" || value === "-h") {
      args.help = true
    } else if (value === "--apk") {
      args.apk = path.resolve(argv[index + 1] ?? args.apk)
      index += 1
    } else if (value === "--package") {
      args.packageName = argv[index + 1] ?? args.packageName
      index += 1
    } else if (value === "--scheme") {
      args.scheme = argv[index + 1] ?? args.scheme
      index += 1
    } else if (value === "--screenshot") {
      args.screenshot = path.resolve(argv[index + 1] ?? args.screenshot)
      index += 1
    } else if (value === "--wait") {
      const parsed = Number(argv[index + 1])
      args.waitSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : args.waitSeconds
      index += 1
    } else if (value === "--skip-install") {
      args.skipInstall = true
    }
  }

  return args
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? "inherit",
    windowsHide: true,
  })

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`)
  }

  return result
}

function read(command, args, options = {}) {
  const result = run(command, args, {
    ...options,
    stdio: "pipe",
  })
  return {
    ok: result.status === 0,
    stderr: result.stderr?.toString() ?? "",
    stdout: result.stdout?.toString() ?? "",
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function requireConnectedDevice() {
  const devices = read("adb", ["devices"])
  const activeDevices = devices.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices"))
    .filter((line) => /\tdevice$/.test(line))

  if (!activeDevices.length) {
    throw new Error("No adb device is connected. Start an emulator or connect an Android device with USB debugging enabled.")
  }

  const serial = activeDevices[0]?.split(/\s+/)[0] ?? ""
  console.log(`adb device: ${serial}`)
  return {
    isEmulator: serial.startsWith("emulator-"),
    serial,
  }
}

function prepareInteractiveDevice() {
  run("adb", ["shell", "input", "keyevent", "224"], { allowFailure: true })
  run("adb", ["shell", "wm", "dismiss-keyguard"], { allowFailure: true })
  run("adb", ["shell", "cmd", "statusbar", "collapse"], { allowFailure: true })
}

function assertApkExists(apkPath) {
  if (!existsSync(apkPath)) {
    throw new Error(`APK not found: ${apkPath}. Build it first with corepack pnpm mobile:android:build:debug`)
  }
}

function androidLocalBridgeUrl(port, device) {
  if (device.isEmulator) {
    return `http://10.0.2.2:${port}`
  }

  run("adb", ["reverse", `tcp:${port}`, `tcp:${port}`])
  console.log(`adb reverse: tcp:${port} -> tcp:${port}`)
  return `http://127.0.0.1:${port}`
}

function removeAndroidReverse(port) {
  run("adb", ["reverse", "--remove", `tcp:${port}`], { allowFailure: true })
}

function jsonResponse(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  })
  response.end(JSON.stringify(value))
}

function ok(data) {
  return { success: true, data }
}

function error(code, message) {
  return { success: false, error: { code, message } }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    request.on("error", reject)
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

function hasDeviceAuthorization(request) {
  const authorization = request.headers.authorization
  return typeof authorization === "string" && authorization.trim() === `Bearer ${mockDeviceToken}`
}

function mockWorkspace(now) {
  return {
    id: "workspace-smoke",
    directory: "C:\\Projects\\Smoke Workspace",
    name: "Smoke Workspace",
    exists: true,
    created: now - 120_000,
    updated: now,
    project: {
      id: "project-smoke",
      name: "Smoke Project",
      repositoryRoot: "C:\\Projects\\Smoke Workspace",
      worktree: "C:\\Projects\\Smoke Workspace",
      kind: "git",
      vcs: "git",
    },
    sessions: [
      {
        id: "session-smoke",
        projectID: "project-smoke",
        directory: "C:\\Projects\\Smoke Workspace",
        title: "Smoke Chat",
        kind: "main",
        created: now - 60_000,
        updated: now,
        workflow: {
          agent: "codex",
          status: "completed",
          active: false,
          updatedAt: now,
        },
      },
    ],
  }
}

function mockMessages(now, sentPromptText) {
  const messages = [
    {
      info: {
        id: "message-user-smoke",
        role: "user",
        created: now - 30_000,
        updated: now - 30_000,
      },
      parts: [{ type: "text", text: "Hello from Android smoke." }],
    },
    {
      info: {
        id: "message-assistant-smoke",
        role: "assistant",
        created: now - 20_000,
        updated: now - 20_000,
      },
      parts: [{ type: "text", text: "Ready from mock bridge." }],
    },
  ]

  if (sentPromptText) {
    messages.push(
      {
        info: {
          id: "message-user-smoke-sent",
          role: "user",
          created: now - 10_000,
          updated: now - 10_000,
        },
        parts: [{ type: "text", text: sentPromptText }],
      },
      {
        info: {
          id: "message-assistant-smoke-streamed",
          role: "assistant",
          created: now,
          updated: now,
        },
        parts: [{ type: "text", text: smokeReplyText }],
      },
    )
  }

  return messages
}

function mockTasks(now) {
  return {
    sessionID: "session-smoke",
    generatedAt: now,
    tasks: [],
    current: [],
    next: [],
    blocked: [],
    summary: {
      total: 0,
      completed: 0,
      pending: 0,
      inProgress: 0,
      blocked: 0,
    },
  }
}

function mockApproval(now, input) {
  const { id, sessionID, status, title } = input
  return {
    id,
    approvalID: id,
    sessionID,
    messageID: "message-assistant-smoke",
    toolCallID: "tool-smoke",
    projectID: "project-smoke",
    agent: "codex",
    status,
    createdAt: now - 15_000,
    prompt: {
      title,
      summary: "Mock bridge requests permission to run the Android smoke command.",
      rationale: "This verifies that mobile approval actions reach the bridge.",
      risk: "low",
      detailsAvailable: true,
      details: {
        command: "echo android-smoke",
        workdir: "C:\\Projects\\Smoke Workspace",
        paths: ["README.md"],
      },
      allowedDecisions: ["allow", "deny"],
      recommendedDecision: "allow",
    },
    ...(status === "pending"
      ? {}
      : {
          resolution: {
            decision: status === "approved" ? "allow" : "deny",
            note: "Resolved by Android smoke.",
            approved: status === "approved",
            resolvedAt: now,
          },
        }),
  }
}

function startMockBridge() {
  const sseClients = new Set()
  const requests = []
  let sentPromptText = ""
  const approvalStatuses = new Map([
    [smokeGlobalApprovalID, "pending"],
    [smokeApprovalID, "pending"],
  ])
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`)
    requests.push(`${request.method ?? "GET"} ${requestUrl.pathname}`)

    if (requestUrl.pathname === "/api/mobile/status" && request.method === "GET") {
      jsonResponse(response, 200, ok({
        service: "anybox-mobile-bridge",
        running: true,
        desktopName: "Smoke Desktop",
        appVersion: "0.0.0",
        online: true,
        capabilities: mockCapabilities,
      }))
      return
    }

    if (requestUrl.pathname === "/api/mobile/pair/preview" && request.method === "GET") {
      const valid = requestUrl.searchParams.get("code") === mockPairingCode
      const now = Date.now()
      jsonResponse(response, 200, ok({
        service: "anybox-mobile-bridge",
        running: true,
        desktopName: "Smoke Desktop",
        appVersion: "0.0.0",
        online: true,
        capabilities: mockCapabilities,
        pairing: {
          valid,
          expiresAt: valid ? now + 300_000 : null,
          serverTime: now,
        },
      }))
      return
    }

    if (requestUrl.pathname === "/api/mobile/pair" && request.method === "POST") {
      await readRequestBody(request)
      if (requestUrl.searchParams.get("code") !== mockPairingCode) {
        jsonResponse(response, 401, error("UNAUTHORIZED", "Invalid pairing code."))
        return
      }

      const now = Date.now()
      jsonResponse(response, 200, ok({
        token: mockDeviceToken,
        device: {
          id: "device-smoke",
          name: "Anybox Android",
          createdAt: now,
          lastSeenAt: now,
          capabilities: mockCapabilities,
        },
      }))
      return
    }

    if (!hasDeviceAuthorization(request)) {
      jsonResponse(response, 401, error("UNAUTHORIZED", "Missing smoke device token."))
      return
    }

    if (requestUrl.pathname === "/api/mobile/devices/me/revoke" && request.method === "POST") {
      jsonResponse(response, 200, ok({
        deviceID: "device-smoke",
        revoked: true,
      }))
      return
    }

    if (requestUrl.pathname === "/api/mobile/workspaces" && request.method === "GET") {
      jsonResponse(response, 200, ok([mockWorkspace(Date.now())]))
      return
    }

    if (requestUrl.pathname === "/api/mobile/workspaces/workspace-smoke/files" && request.method === "GET") {
      jsonResponse(response, 200, ok([
        {
          path: "README.md",
          name: "README.md",
          kind: "file",
          extension: ".md",
          hasChildren: false,
        },
        {
          path: "src",
          name: "src",
          kind: "directory",
          extension: null,
          hasChildren: true,
        },
      ]))
      return
    }

    if (requestUrl.pathname === "/api/mobile/workspaces/workspace-smoke/files/search" && request.method === "GET") {
      jsonResponse(response, 200, ok([]))
      return
    }

    if (requestUrl.pathname === "/api/mobile/workspaces/workspace-smoke/diff" && request.method === "GET") {
      jsonResponse(response, 200, ok({
        title: "Smoke Changes",
        body: "Mock bridge has one changed file.",
        stats: {
          additions: 1,
          deletions: 0,
          files: 1,
        },
        scope: "workspace-smoke",
        diffs: [
          {
            file: "README.md",
            additions: 1,
            deletions: 0,
            gitState: "unstaged",
          },
        ],
      }))
      return
    }

    if (requestUrl.pathname === "/api/mobile/approvals" && request.method === "GET") {
      const requestedStatus = requestUrl.searchParams.get("status") || "pending"
      const requestedSessionID = requestUrl.searchParams.get("sessionID")
      const now = Date.now()
      const approvals = [
        mockApproval(now, {
          id: smokeGlobalApprovalID,
          sessionID: "session-global-smoke",
          status: approvalStatuses.get(smokeGlobalApprovalID) ?? "pending",
          title: smokeGlobalApprovalTitle,
        }),
        mockApproval(now, {
          id: smokeApprovalID,
          sessionID: "session-smoke",
          status: approvalStatuses.get(smokeApprovalID) ?? "pending",
          title: smokeApprovalTitle,
        }),
      ].filter((approval) => {
        if (approval.status !== requestedStatus) return false
        if (requestedSessionID && approval.sessionID !== requestedSessionID) return false
        return true
      })
      jsonResponse(response, 200, ok(approvals))
      return
    }

    const approvalDecisionMatch = requestUrl.pathname.match(/^\/api\/mobile\/approvals\/([^/]+)\/(approve|deny)$/)
    if (approvalDecisionMatch && request.method === "POST") {
      await readRequestBody(request)
      const [, approvalID, action] = approvalDecisionMatch
      const status = action === "approve" ? "approved" : "denied"
      approvalStatuses.set(approvalID, status)
      jsonResponse(response, 200, ok({ approvalID, decision: action === "approve" ? "allow" : "deny", approved: action === "approve" }))
      return
    }

    if (requestUrl.pathname === "/api/mobile/sessions/session-smoke/messages" && request.method === "GET") {
      jsonResponse(response, 200, ok(mockMessages(Date.now(), sentPromptText)))
      return
    }

    if (requestUrl.pathname === "/api/mobile/sessions/session-smoke/messages/stream" && request.method === "POST") {
      const rawBody = await readRequestBody(request)
      const parsed = rawBody.trim() ? JSON.parse(rawBody) : {}
      sentPromptText = typeof parsed.text === "string" ? parsed.text : smokePromptText
      response.writeHead(200, {
        "cache-control": "no-cache",
        "connection": "close",
        "content-type": "text/event-stream; charset=utf-8",
      })
      response.write(`event: delta\ndata: ${JSON.stringify({ kind: "text", delta: smokeReplyText })}\n\n`)
      response.write(`event: done\ndata: ${JSON.stringify({ generatedAt: Date.now() })}\n\n`)
      response.end()
      return
    }

    if (requestUrl.pathname === "/api/mobile/sessions/session-smoke/cancel" && request.method === "POST") {
      jsonResponse(response, 200, ok({ sessionID: "session-smoke", cancelled: true }))
      return
    }

    if (requestUrl.pathname === "/api/mobile/sessions/session-smoke/tasks" && request.method === "GET") {
      jsonResponse(response, 200, ok(mockTasks(Date.now())))
      return
    }

    if (requestUrl.pathname === "/api/mobile/sessions/session-smoke/events/stream" && request.method === "GET") {
      response.writeHead(200, {
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
      })
      response.write(`event: runtime\ndata: ${JSON.stringify({ type: "smoke.ready", generatedAt: Date.now() })}\n\n`)
      sseClients.add(response)
      request.on("close", () => sseClients.delete(response))
      return
    }

    if (requestUrl.pathname === "/api/mobile/events/stream" && request.method === "GET") {
      response.writeHead(200, {
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
      })
      response.write(`event: sync.ready\ndata: ${JSON.stringify({ generatedAt: Date.now() })}\n\n`)
      sseClients.add(response)
      request.on("close", () => sseClients.delete(response))
      return
    }

    jsonResponse(response, 404, error("NOT_FOUND", `Unhandled mock route: ${requestUrl.pathname}`))
  })

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      resolve({
        close: () =>
          new Promise((closeResolve) => {
            for (const client of sseClients) client.end()
            server.close(() => closeResolve())
          }),
        port,
        requests,
      })
    })
  })
}

function dumpWindowHierarchy() {
  const dumped = read("adb", ["shell", "uiautomator", "dump", remoteWindowPath], { allowFailure: true })
  if (!dumped.ok) return ""

  const hierarchy = read("adb", ["shell", "cat", remoteWindowPath], { allowFailure: true })
  run("adb", ["shell", "rm", remoteWindowPath], { allowFailure: true })
  return hierarchy.stdout
}

async function waitForUi(packageName, timeoutSeconds, expectedTexts, label) {
  const deadline = Date.now() + timeoutSeconds * 1000
  let lastHierarchy = ""

  while (Date.now() < deadline) {
    await sleep(1000)
    prepareInteractiveDevice()
    lastHierarchy = dumpWindowHierarchy()
    const isAppWindow = lastHierarchy.includes(`package="${packageName}"`)
    const hasExpectedText = expectedTexts.every((text) => lastHierarchy.includes(`text="${text}"`))
    if (isAppWindow && hasExpectedText) return lastHierarchy
  }

  const visibleText = [...lastHierarchy.matchAll(/text="([^"]*)"/g)]
    .map((match) => match[1])
    .filter(Boolean)
    .slice(0, 20)
    .join(", ")
  const suffix = visibleText ? ` Visible text: ${visibleText}` : ""
  throw new Error(`${label} UI was not visible within ${timeoutSeconds} seconds.${suffix}`)
}

async function waitForUiContaining(packageName, timeoutSeconds, expectedSnippets, label) {
  const deadline = Date.now() + timeoutSeconds * 1000
  let lastHierarchy = ""

  while (Date.now() < deadline) {
    await sleep(1000)
    prepareInteractiveDevice()
    lastHierarchy = dumpWindowHierarchy()
    const isAppWindow = lastHierarchy.includes(`package="${packageName}"`)
    const hasExpectedText = expectedSnippets.every((text) => lastHierarchy.includes(text))
    if (isAppWindow && hasExpectedText) return lastHierarchy
  }

  const visibleText = [...lastHierarchy.matchAll(/text="([^"]*)"/g)]
    .map((match) => match[1])
    .filter(Boolean)
    .slice(0, 20)
    .join(", ")
  const suffix = visibleText ? ` Visible text: ${visibleText}` : ""
  throw new Error(`${label} UI was not visible within ${timeoutSeconds} seconds.${suffix}`)
}

async function waitForAnyUi(packageName, timeoutSeconds, choices, label) {
  const deadline = Date.now() + timeoutSeconds * 1000
  let lastHierarchy = ""

  while (Date.now() < deadline) {
    await sleep(1000)
    prepareInteractiveDevice()
    lastHierarchy = dumpWindowHierarchy()
    const isAppWindow = lastHierarchy.includes(`package="${packageName}"`)
    if (isAppWindow) {
      for (const choice of choices) {
        const hasExpectedText = choice.expectedTexts.every((text) => lastHierarchy.includes(`text="${text}"`))
        if (hasExpectedText) return { hierarchy: lastHierarchy, name: choice.name }
      }
    }
  }

  const visibleText = [...lastHierarchy.matchAll(/text="([^"]*)"/g)]
    .map((match) => match[1])
    .filter(Boolean)
    .slice(0, 20)
    .join(", ")
  const suffix = visibleText ? ` Visible text: ${visibleText}` : ""
  throw new Error(`${label} UI was not visible within ${timeoutSeconds} seconds.${suffix}`)
}

async function waitForPairedHomeUi(packageName, timeoutSeconds) {
  const result = await waitForAnyUi(
    packageName,
    timeoutSeconds,
    [
      {
        name: "thread",
        expectedTexts: ["Smoke Chat", "Ready from mock bridge.", "Send to Smoke Chat"],
      },
      {
        name: "drawer",
        expectedTexts: ["AnyboxProvider", "Smoke Workspace", "Smoke Chat"],
      },
    ],
    "Paired Home",
  )
  return result.hierarchy
}

async function waitForReplaceConnectionUi(packageName, timeoutSeconds) {
  return waitForUi(
    packageName,
    timeoutSeconds,
    ["Connect to Smoke Desktop", "Switch desktop"],
    "Replace connection confirmation",
  )
}

async function waitForConfirmConnectionUi(packageName, timeoutSeconds) {
  return waitForUiContaining(
    packageName,
    timeoutSeconds,
    ["Connect to Smoke Desktop", "Direct connection", "Connect: Direct connection"],
    "Connection confirmation",
  )
}

async function waitForWorkspaceUi(packageName, timeoutSeconds) {
  return waitForUi(
    packageName,
    timeoutSeconds,
    ["Smoke Workspace", "Chats", "Changes", "Smoke Changes", "Files", "README.md"],
    "Workspace",
  )
}

async function waitForSessionUi(packageName, timeoutSeconds) {
  return waitForUi(
    packageName,
    timeoutSeconds,
    ["Smoke Chat", "Messages", "Stop"],
    "Session",
  )
}

async function waitForGlobalApprovalsUi(packageName, timeoutSeconds) {
  return waitForUi(
    packageName,
    timeoutSeconds,
    ["Pending", "Requests", smokeGlobalApprovalTitle, smokeApprovalTitle],
    "Global approvals",
  )
}

async function waitForGlobalApprovalHistoryUi(packageName, timeoutSeconds) {
  return waitForUi(
    packageName,
    timeoutSeconds,
    ["History", smokeGlobalApprovalTitle, "approved"],
    "Global approval history",
  )
}

async function waitForApprovalClearedUi(packageName, timeoutSeconds) {
  return waitForUi(
    packageName,
    timeoutSeconds,
    ["No pending approvals", "Messages", "Resume"],
    "Approval cleared",
  )
}

function findTextBounds(hierarchy, text) {
  return findNodeBoundsByAttribute(hierarchy, "text", text)
}

function findNodeBoundsByAttribute(hierarchy, attribute, value) {
  const escapedText = escapeRegExp(value)
  const escapedAttribute = escapeRegExp(attribute)
  const pattern = new RegExp(`<node\\b(?=[^>]*\\s${escapedAttribute}="${escapedText}")[^>]*\\bbounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"[^>]*>`, "g")
  const match = pattern.exec(hierarchy)
  if (!match) return null
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  }
}

function tapBounds(bounds) {
  const x = Math.round((bounds.left + bounds.right) / 2)
  const y = Math.round((bounds.top + bounds.bottom) / 2)
  run("adb", ["shell", "input", "tap", String(x), String(y)])
}

function tapText(hierarchy, text) {
  const bounds = findTextBounds(hierarchy, text)
  if (!bounds) {
    throw new Error(`Unable to find tappable text in Android hierarchy: ${text}`)
  }
  tapBounds(bounds)
}

function tapAccessibilityLabel(hierarchy, label) {
  const bounds = findNodeBoundsByAttribute(hierarchy, "content-desc", label)
  if (bounds) {
    tapBounds(bounds)
    return
  }
  tapText(hierarchy, label)
}

async function waitForExpectedUiOrNull(packageName, timeoutSeconds, expectedTexts) {
  const deadline = Date.now() + timeoutSeconds * 1000
  let lastHierarchy = ""

  while (Date.now() < deadline) {
    await sleep(700)
    prepareInteractiveDevice()
    lastHierarchy = dumpWindowHierarchy()
    const isAppWindow = lastHierarchy.includes(`package="${packageName}"`)
    const hasExpectedText = expectedTexts.every((text) => lastHierarchy.includes(`text="${text}"`))
    if (isAppWindow && hasExpectedText) return lastHierarchy
  }

  return null
}

async function waitForMockRequest(requests, route, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000
  while (Date.now() < deadline) {
    if (requests.includes(route)) return
    await sleep(500)
  }
  throw new Error(`Android pairing smoke did not call expected mock route: ${route}. Seen routes: ${requests.join(", ")}`)
}

async function tapAccessibilityLabelUntilUi(packageName, label, expectedTexts, targetLabel) {
  let lastHierarchy = ""
  for (let attempt = 0; attempt < 3; attempt += 1) {
    lastHierarchy = dumpWindowHierarchy()
    tapAccessibilityLabel(lastHierarchy, label)
    const targetHierarchy = await waitForExpectedUiOrNull(packageName, 5, expectedTexts)
    if (targetHierarchy) return targetHierarchy
  }

  const visibleText = [...lastHierarchy.matchAll(/text="([^"]*)"/g)]
    .map((match) => match[1])
    .filter(Boolean)
    .slice(0, 20)
    .join(", ")
  const suffix = visibleText ? ` Visible text: ${visibleText}` : ""
  throw new Error(`${targetLabel} UI was not visible after tapping ${label}.${suffix}`)
}

async function openApprovalsFromCurrentUi(packageName, timeoutSeconds, hierarchy) {
  if (hierarchy.includes('content-desc="2"') || hierarchy.includes('text="2"')) {
    tapAccessibilityLabel(hierarchy, "2")
  } else {
    tapText(hierarchy, "Open approvals")
  }
  return waitForGlobalApprovalsUi(packageName, timeoutSeconds)
}

async function confirmReplaceConnection(packageName, hierarchy) {
  await sleep(1200)
  tapAccessibilityLabel(hierarchy, "Connect: Direct connection")
  await sleep(1200)
  const afterTapHierarchy = dumpWindowHierarchy()
  if (
    afterTapHierarchy.includes(`package="${packageName}"`) &&
    afterTapHierarchy.includes('content-desc="Connect: Direct connection"')
  ) {
    tapAccessibilityLabel(afterTapHierarchy, "Connect: Direct connection")
  }
}

async function scrollUntilText(packageName, timeoutSeconds, text) {
  const deadline = Date.now() + timeoutSeconds * 1000
  let lastHierarchy = ""

  while (Date.now() < deadline) {
    lastHierarchy = dumpWindowHierarchy()
    if (lastHierarchy.includes(`package="${packageName}"`) && lastHierarchy.includes(`text="${text}"`)) {
      return lastHierarchy
    }
    run("adb", ["shell", "input", "swipe", "540", "2050", "540", "1250", "350"])
    await sleep(700)
  }

  const visibleText = [...lastHierarchy.matchAll(/text="([^"]*)"/g)]
    .map((match) => match[1])
    .filter(Boolean)
    .slice(0, 20)
    .join(", ")
  const suffix = visibleText ? ` Visible text: ${visibleText}` : ""
  throw new Error(`Unable to find text while scrolling: ${text}.${suffix}`)
}

async function scrollTowardTopUntilText(packageName, timeoutSeconds, text) {
  const deadline = Date.now() + timeoutSeconds * 1000
  let lastHierarchy = ""

  while (Date.now() < deadline) {
    lastHierarchy = dumpWindowHierarchy()
    if (lastHierarchy.includes(`package="${packageName}"`) && lastHierarchy.includes(`text="${text}"`)) {
      return lastHierarchy
    }
    run("adb", ["shell", "input", "swipe", "540", "1250", "540", "2050", "350"])
    await sleep(700)
  }

  const visibleText = [...lastHierarchy.matchAll(/text="([^"]*)"/g)]
    .map((match) => match[1])
    .filter(Boolean)
    .slice(0, 20)
    .join(", ")
  const suffix = visibleText ? ` Visible text: ${visibleText}` : ""
  throw new Error(`Unable to find text while scrolling toward top: ${text}.${suffix}`)
}

async function sendSmokePrompt(packageName, timeoutSeconds) {
  const inputHierarchy = await scrollUntilText(packageName, timeoutSeconds, "Send a prompt")
  tapText(inputHierarchy, "Send a prompt")
  await sleep(1000)
  run("adb", ["shell", "input", "text", smokePromptText])
  await sleep(1000)
  const typedHierarchy = dumpWindowHierarchy()
  if (!typedHierarchy.includes(smokePromptText)) {
    throw new Error(`Prompt input was not filled with ${smokePromptText}.`)
  }

  run("adb", ["shell", "input", "keyevent", "61"])
  await sleep(500)
  run("adb", ["shell", "input", "keyevent", "66"])
}

async function allowApprovalByTitle(packageName, timeoutSeconds, approvalTitle) {
  const approvalHierarchy = await scrollUntilText(packageName, timeoutSeconds, approvalTitle)
  const allowButtonHierarchy = approvalHierarchy.includes('text="Allow"')
    ? approvalHierarchy
    : await scrollUntilText(packageName, timeoutSeconds, "Allow")
  tapText(allowButtonHierarchy, "Allow")

  const alertHierarchy = await waitForUi(packageName, timeoutSeconds, ["Allow this request?", approvalTitle, "ALLOW"], "Allow confirmation")
  tapText(alertHierarchy, "ALLOW")
}

async function allowSmokeApproval(packageName, timeoutSeconds) {
  await allowApprovalByTitle(packageName, timeoutSeconds, smokeApprovalTitle)
  await waitForApprovalClearedUi(packageName, timeoutSeconds)
}

async function stopSmokeSession(packageName, timeoutSeconds) {
  const stopHierarchy = await scrollTowardTopUntilText(packageName, timeoutSeconds, "Stop")
  tapText(stopHierarchy, "Stop")
  const alertHierarchy = await waitForUi(packageName, timeoutSeconds, ["Stop this chat?", "STOP"], "Stop confirmation")
  tapText(alertHierarchy, "STOP")
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function findFatalLogLines(logcat) {
  return logcat
    .split(/\r?\n/)
    .filter((line) => fatalLogPatterns.some((pattern) => pattern.test(line)))
}

function assertMockBridgeWasUsed(requests) {
  for (const route of [
    "GET /api/mobile/pair/preview",
    "POST /api/mobile/pair",
    "GET /api/mobile/status",
    "GET /api/mobile/workspaces",
    "GET /api/mobile/approvals",
    "GET /api/mobile/workspaces/workspace-smoke/files",
    "GET /api/mobile/workspaces/workspace-smoke/diff",
    "GET /api/mobile/sessions/session-smoke/messages",
    "GET /api/mobile/sessions/session-smoke/tasks",
    "POST /api/mobile/sessions/session-smoke/messages/stream",
    "POST /api/mobile/sessions/session-smoke/cancel",
    `POST /api/mobile/approvals/${smokeGlobalApprovalID}/approve`,
    `POST /api/mobile/approvals/${smokeApprovalID}/approve`,
  ]) {
    if (!requests.includes(route)) {
      throw new Error(`Android pairing smoke did not call expected mock route: ${route}. Seen routes: ${requests.join(", ")}`)
    }
  }
}

function assertInitialBridgeWasReplaced(requests) {
  for (const route of [
    "GET /api/mobile/pair/preview",
    "POST /api/mobile/pair",
    "POST /api/mobile/devices/me/revoke",
  ]) {
    if (!requests.includes(route)) {
      throw new Error(`Android pairing smoke did not call expected initial bridge route: ${route}. Seen routes: ${requests.join(", ")}`)
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }
  args.scheme = resolveAnyboxMobileScheme(args.scheme)

  const device = requireConnectedDevice()
  prepareInteractiveDevice()
  if (!args.skipInstall) {
    assertApkExists(args.apk)
    run("adb", ["install", "-r", "-g", args.apk])
  }

  const bridge = await startMockBridge()
  let replacementBridge = null
  try {
    const bridgeUrl = `${androidLocalBridgeUrl(bridge.port, device)}/?code=${encodeURIComponent(mockPairingCode)}`
    const deepLink = `${args.scheme}://connect?url=${encodeURIComponent(bridgeUrl)}`

    run("adb", ["shell", "pm", "clear", args.packageName])
    run("adb", ["logcat", "-c"])
    prepareInteractiveDevice()
    run("adb", ["shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", deepLink, args.packageName])
    const initialPairingHierarchy = await waitForConfirmConnectionUi(args.packageName, args.waitSeconds)
    await confirmReplaceConnection(args.packageName, initialPairingHierarchy)
    await waitForPairedHomeUi(args.packageName, args.waitSeconds)

    replacementBridge = await startMockBridge()
    const replacementBridgeUrl = `${androidLocalBridgeUrl(replacementBridge.port, device)}/?code=${encodeURIComponent(mockPairingCode)}`
    const replacementDeepLink = `${args.scheme}://connect?url=${encodeURIComponent(replacementBridgeUrl)}`

    prepareInteractiveDevice()
    run("adb", ["shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", replacementDeepLink, args.packageName])
    const replaceConnectionHierarchy = await waitForReplaceConnectionUi(args.packageName, args.waitSeconds)
    await confirmReplaceConnection(args.packageName, replaceConnectionHierarchy)
    const homeAfterReplaceHierarchy = await waitForPairedHomeUi(args.packageName, args.waitSeconds)

    await openApprovalsFromCurrentUi(args.packageName, args.waitSeconds, homeAfterReplaceHierarchy)
    await allowApprovalByTitle(args.packageName, args.waitSeconds, smokeGlobalApprovalTitle)
    await waitForUi(args.packageName, args.waitSeconds, ["Requests", smokeApprovalTitle], "Remaining session approval")
    const historyButtonHierarchy = await scrollUntilText(args.packageName, args.waitSeconds, "History")
    tapText(historyButtonHierarchy, "History")
    await waitForGlobalApprovalHistoryUi(args.packageName, args.waitSeconds)
    run("adb", ["shell", "input", "keyevent", "4"])
    await sleep(700)

    await waitForPairedHomeUi(args.packageName, args.waitSeconds)
    run("adb", [
      "shell",
      "am",
      "start",
      "-W",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      `${args.scheme}://workspaces/workspace-smoke`,
      args.packageName,
    ])
    await waitForWorkspaceUi(args.packageName, args.waitSeconds)
    try {
      await waitForMockRequest(replacementBridge.requests, "GET /api/mobile/workspaces/workspace-smoke/files", 10)
    } catch (requestError) {
      console.error(`Primary routes: ${bridge.requests.join(", ")}`)
      console.error(`Replacement routes: ${replacementBridge.requests.join(", ")}`)
      throw requestError
    }
    await sleep(1500)
    await tapAccessibilityLabelUntilUi(args.packageName, "Smoke Chat", ["Smoke Chat", "Messages", "Stop"], "Session")
    await stopSmokeSession(args.packageName, args.waitSeconds)
    await waitForMockRequest(replacementBridge.requests, "POST /api/mobile/sessions/session-smoke/cancel", 10)
    await waitForSessionUi(args.packageName, args.waitSeconds)
    await allowSmokeApproval(args.packageName, args.waitSeconds)
    await sendSmokePrompt(args.packageName, args.waitSeconds)
    await waitForUiContaining(args.packageName, args.waitSeconds, [smokePromptText, smokeReplyText], "Sent prompt")

    const pid = read("adb", ["shell", "pidof", args.packageName], { allowFailure: true }).stdout.trim()
    if (!pid) {
      throw new Error(`App process is not running after pairing smoke: ${args.packageName}`)
    }

    mkdirSync(path.dirname(args.screenshot), { recursive: true })
    run("adb", ["shell", "screencap", "-p", remoteScreenshotPath])
    run("adb", ["pull", remoteScreenshotPath, args.screenshot])
    run("adb", ["shell", "rm", remoteScreenshotPath], { allowFailure: true })

    const screenshotSize = statSync(args.screenshot).size
    if (screenshotSize < 4096) {
      throw new Error(`Screenshot looks too small to be valid: ${args.screenshot} (${screenshotSize} bytes)`)
    }

    const logcat = read("adb", ["logcat", "-d", "-t", "800"], { allowFailure: true }).stdout
    const fatalLines = findFatalLogLines(logcat)
    if (fatalLines.length) {
      console.error(fatalLines.slice(0, 40).join("\n"))
      throw new Error("Android pairing smoke failed: fatal startup log lines were found.")
    }

    assertInitialBridgeWasReplaced(bridge.requests)
    assertMockBridgeWasUsed(replacementBridge.requests)
    console.log(`Mock bridge: http://127.0.0.1:${bridge.port}`)
    console.log(`Replacement mock bridge: http://127.0.0.1:${replacementBridge.port}`)
    console.log(`App process: ${pid}`)
    console.log(`Screenshot: ${args.screenshot}`)
    console.log("Android pairing smoke passed.")
  } finally {
    if (replacementBridge) removeAndroidReverse(replacementBridge.port)
    removeAndroidReverse(bridge.port)
    if (replacementBridge) await replacementBridge.close()
    await bridge.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
