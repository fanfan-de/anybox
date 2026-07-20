import process from "node:process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { FrameDecoder, encodeFrame } = require("../../scripts/lib/frame-codec")

const decoder = new FrameDecoder()

function send(payload) {
  process.stdout.write(encodeFrame(payload))
}

process.stdin.on("data", (chunk) => {
  for (const message of decoder.push(chunk)) {
    if (message.method === "hang" || message.method === "perform_action") continue
    if (message.method === "crash") process.exit(23)
    const result = message.method === "initialize"
      ? {
          protocolVersion: 1,
          helperVersion: "0.2.0",
          capabilities: {},
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
