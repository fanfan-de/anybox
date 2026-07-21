import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { HelperClient } = require("../scripts/lib/helper-client")

const directory = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(directory, "fixtures", "mock-helper.mjs")
const pipePath = (name) => process.platform === "win32"
  ? `\\\\.\\pipe\\${name}`
  : path.join(tmpdir(), `${name}.sock`)

function createClient(options = {}) {
  return new HelperClient({
    helperPath: process.execPath,
    helperArgs: [fixture],
    cwd: directory,
    defaultTimeoutMs: 1000,
    pipePath,
    platform: "win32",
    verifyIntegrity: false,
    ...options,
  })
}

test("helper client performs handshake and serializes concurrent requests", async () => {
  const client = createClient()
  try {
    const [first, second] = await Promise.all([
      client.call("first", { value: 1 }),
      client.call("second", { value: 2 }),
    ])
    assert.deepEqual(first, { method: "first", params: { value: 1 } })
    assert.deepEqual(second, { method: "second", params: { value: 2 } })
  } finally {
    client.stop()
  }
})

test("helper client terminates a timed-out helper and restarts cleanly", async () => {
  const client = createClient({ defaultTimeoutMs: 100 })
  try {
    await assert.rejects(
      client.call("hang"),
      (error) => error.code === "CU_TIMEOUT",
    )
    const recovered = await client.call("after-timeout")
    assert.equal(recovered.method, "after-timeout")
  } finally {
    client.stop()
  }
})

test("helper client aborts an in-flight request and reports possible action effect", async () => {
  const client = createClient()
  const controller = new AbortController()
  try {
    await client.ensureInitialized()
    const pending = client.call("perform_action", {}, { signal: controller.signal })
    setTimeout(() => controller.abort(), 25)
    await assert.rejects(
      pending,
      (error) => error.code === "CU_INTERRUPTED" && error.effectMayHaveOccurred,
    )
  } finally {
    client.stop()
  }
})

test("helper client treats physical Escape as a non-bypassable interruption", async () => {
  let physicalEscapes = 0
  const client = createClient({
    onPhysicalEscape() {
      physicalEscapes += 1
    },
  })
  try {
    await assert.rejects(
      client.call("emit_physical_escape"),
      (error) => error.code === "CU_INTERRUPTED",
    )
    assert.equal(physicalEscapes, 1)
  } finally {
    client.stop()
  }
})
