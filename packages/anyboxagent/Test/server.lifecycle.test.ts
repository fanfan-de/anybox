import { afterEach, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { createPtyRegistry } from "#pty/registry.ts"
import type { PtyRuntimeAdapter } from "#pty/runtime.ts"
import { resumeIpythonRuntime } from "#ipython/registry.ts"
import { startServer, stopServer } from "#server/server.ts"

const unusedPtyRuntime: PtyRuntimeAdapter = {
  spawn() {
    throw new Error("PTY creation is not expected in server lifecycle tests")
  },
}

afterEach(async () => {
  await stopServer().catch(() => undefined)
  // stopServer intentionally leaves a process-lifetime tombstone. Reset the
  // module singleton so this focused lifecycle test does not leak that state
  // into other test files sharing Bun's process.
  resumeIpythonRuntime()
})

test("startServer rejects a restart until the current stop operation finishes", async () => {
  const first = startServer({
    host: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    ptyRegistry: createPtyRegistry({ runtime: unusedPtyRuntime }),
  })

  const stopping = stopServer()

  expect(stopServer()).toBe(stopping)
  expect(() => startServer({ host: "127.0.0.1", port: 0 })).toThrow(
    "Cannot start the Anybox Agent server while it is stopping",
  )

  await stopping

  const restarted = startServer({
    host: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    ptyRegistry: createPtyRegistry({ runtime: unusedPtyRuntime }),
  })
  expect(restarted).not.toBe(first)
})
