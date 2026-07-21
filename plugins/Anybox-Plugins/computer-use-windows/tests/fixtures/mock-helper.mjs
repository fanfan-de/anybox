import { createRequire } from "node:module"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import process from "node:process"

const require = createRequire(import.meta.url)
const { FrameDecoder, encodeFrame } = require("../../scripts/lib/frame-codec")

const pipeFlagIndex = process.argv.indexOf("--broker-pipe")
const pipeName = pipeFlagIndex >= 0 ? process.argv[pipeFlagIndex + 1] : ""
if (!/^anybox-cu-[a-f0-9]{32}$/u.test(pipeName)) {
  throw new Error("Mock helper requires a valid plugin broker pipe name.")
}
const pipePath = process.platform === "win32"
  ? `\\\\.\\pipe\\${pipeName}`
  : path.join(tmpdir(), `${pipeName}.sock`)

let startupInput = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  startupInput += chunk
  const newline = startupInput.indexOf("\n")
  if (newline < 0) return
  process.stdin.removeAllListeners("data")
  const brokerToken = startupInput.slice(0, newline).trim()
  startBroker(brokerToken)
})

function startBroker(brokerToken) {
  const server = net.createServer((socket) => {
    const decoder = new FrameDecoder()
    const send = (payload) => socket.write(encodeFrame(payload))
    socket.on("data", (chunk) => {
      for (const message of decoder.push(chunk)) {
        if (message.method === "hang" || message.method === "perform_action") continue
        if (message.method === "crash") process.exit(23)
        if (message.method === "emit_physical_escape") {
          send({
            jsonrpc: "2.0",
            method: "physical_escape",
            params: { inputEpoch: 1 },
          })
          continue
        }
        if (message.method === "emit_overlay_unavailable") {
          send({
            jsonrpc: "2.0",
            method: "overlay_unavailable",
            params: {
              computerUseCode: "CU_OVERLAY_UNAVAILABLE",
              retryable: true,
              requiresFreshState: true,
            },
          })
          continue
        }
        const result = message.method === "initialize"
          ? {
              protocolVersion: 1,
              helperVersion: "0.2.1",
              capabilities: {
                hostBroker: message.params?.brokerToken === brokerToken,
                physicalEscape: true,
                overlay: !process.argv.includes("--without-overlay"),
              },
            }
          : {
              method: message.method,
              params: message.params,
            }
        send({
          jsonrpc: "2.0",
          id: message.id,
          result,
        })
      }
    })
  })
  server.listen(pipePath)
}
