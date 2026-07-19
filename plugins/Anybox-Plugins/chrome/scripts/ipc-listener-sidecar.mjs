// Kept beside Browser Host so all Chrome transport code ships with the plugin.
import { randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { createInterface } from "node:readline"

const servers = new Map()
const sockets = new Map()
let started = false
let stopping = false

function send(message) {
  return process.stdout.write(`${JSON.stringify(message)}\n`)
}

function listen(role, endpoint) {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      const connectionID = randomUUID()
      sockets.set(connectionID, socket)
      send({ type: "connection.open", connectionID, role })

      socket.on("data", (chunk) => {
        const writable = send({
          type: "connection.data",
          connectionID,
          bytes: chunk.toString("base64"),
        })
        if (!writable) {
          socket.pause()
          process.stdout.once("drain", () => {
            if (!socket.destroyed) socket.resume()
          })
        }
      })
      socket.on("end", () => {
        send({ type: "connection.end", connectionID })
      })
      socket.on("error", (error) => {
        send({
          type: "connection.error",
          connectionID,
          message: error instanceof Error ? error.message : String(error),
        })
      })
      socket.on("close", () => {
        sockets.delete(connectionID)
        send({ type: "connection.close", connectionID })
      })
    })
    const onStartupError = (error) => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      server.off("error", onStartupError)
      server.on("error", (error) => {
        if (stopping) return
        send({
          type: "listener.error",
          role,
          message: error instanceof Error ? error.message : String(error),
        })
      })
      servers.set(role, server)
      resolve()
    }
    server.once("error", onStartupError)
    server.once("listening", onListening)
    server.listen({
      path: endpoint,
      exclusive: true,
      readableAll: false,
      writableAll: false,
    })
  })
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(() => resolve())
  })
}

async function stop(notify = true) {
  if (stopping) return
  stopping = true
  for (const socket of sockets.values()) socket.destroy()
  sockets.clear()
  await Promise.all([...servers.values()].map(closeServer))
  servers.clear()
  if (notify) send({ type: "stopped" })
}

async function handle(message) {
  if (!message || typeof message !== "object") return

  if (message.type === "start") {
    if (started) return
    started = true
    try {
      await listen("runtime", message.runtimeEndpoint)
      await listen("native-host", message.nativeHostEndpoint)
      send({ type: "ready" })
    } catch (error) {
      send({
        type: "start.error",
        message: error instanceof Error ? error.message : String(error),
      })
      await stop(false)
    }
    return
  }

  if (message.type === "connection.write") {
    const socket = sockets.get(message.connectionID)
    if (!socket || socket.destroyed || typeof message.bytes !== "string") return
    const bytes = Buffer.from(message.bytes, "base64")
    if (message.end === true) socket.end(bytes)
    else socket.write(bytes)
    return
  }

  if (message.type === "connection.end") {
    const socket = sockets.get(message.connectionID)
    if (socket && !socket.destroyed) socket.end()
    return
  }

  if (message.type === "connection.terminate") {
    sockets.get(message.connectionID)?.destroy()
    return
  }

  if (message.type === "stop") await stop()
}

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

input.on("line", (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    send({
      type: "sidecar.error",
      message: "Browser IPC listener sidecar received invalid JSON.",
    })
    return
  }
  void handle(message).catch((error) => {
    send({
      type: "sidecar.error",
      message: error instanceof Error ? error.message : String(error),
    })
  })
})

input.on("close", () => {
  void stop(false)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void stop(false).finally(() => process.exit(0))
  })
}
