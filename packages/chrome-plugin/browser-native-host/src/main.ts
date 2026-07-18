import { encodeNativeMessage, NativeMessageDecoder } from "./framing"
import { agentBaseURL, HOST_NAME } from "./agent-config"

const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 5_000

let socket: WebSocket | undefined
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let reconnectAttempt = 0
const pendingChromeMessages: unknown[] = []
const decoder = new NativeMessageDecoder()

function log(message: string, detail?: unknown) {
  const suffix = detail === undefined ? "" : ` ${detail instanceof Error ? detail.message : String(detail)}`
  process.stderr.write(`[anybox-chrome-native-host] ${message}${suffix}\n`)
}

function wsURL() {
  const url = new URL("/api/browser-extension/ws", agentBaseURL())
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.searchParams.set("transport", "native")
  url.searchParams.set("hostName", HOST_NAME)
  return url.toString()
}

function writeChromeMessage(message: unknown) {
  process.stdout.write(encodeNativeMessage(message))
}

function sendAgentMessage(message: unknown) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message))
    return
  }
  pendingChromeMessages.push(message)
}

function flushPendingMessages() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  while (pendingChromeMessages.length > 0) {
    socket.send(JSON.stringify(pendingChromeMessages.shift()))
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt)
  reconnectAttempt += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    connectAgent()
  }, delay)
}

function connectAgent() {
  try {
    socket = new WebSocket(wsURL())
  } catch (error) {
    log("failed to create websocket", error)
    scheduleReconnect()
    return
  }

  socket.addEventListener("open", () => {
    reconnectAttempt = 0
    flushPendingMessages()
  })

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return
    try {
      writeChromeMessage(JSON.parse(event.data))
    } catch (error) {
      log("failed to forward agent message", error)
    }
  })

  socket.addEventListener("close", () => {
    socket = undefined
    scheduleReconnect()
  })

  socket.addEventListener("error", () => {
    log("websocket connection failed")
  })
}

process.stdin.on("data", (chunk: Buffer) => {
  try {
    for (const message of decoder.push(chunk)) {
      sendAgentMessage(message)
    }
  } catch (error) {
    log("failed to decode native message", error)
  }
})

process.stdin.on("end", () => {
  socket?.close()
  process.exit(0)
})

process.stdin.on("error", (error) => {
  log("stdin failed", error)
  socket?.close()
  process.exit(1)
})

connectAgent()
