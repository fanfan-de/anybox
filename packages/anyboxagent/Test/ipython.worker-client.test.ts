import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import {
  IPYTHON_SHUTDOWN_GRACE_MS,
  IpythonWorkerClient,
} from "../src/ipython/worker-client.ts"

function inlineHost(source: string) {
  return {
    executable: process.execPath,
    source: "override" as const,
    commandArgs: ["-e", source],
  }
}

function clientFor(source: string, sessionID: string) {
  return new IpythonWorkerClient({
    sessionID,
    cwd: process.cwd(),
    generation: 1,
    runtime: inlineHost(source),
    startupTimeoutMs: 5_000,
    cellTimeoutMs: 5_000,
    interruptGraceMs: 500,
    shutdownGraceMs: 1_000,
  })
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("IPython worker client protocol failures", () => {
  test("allows the host to finish its bounded Windows process-tree cleanup", () => {
    expect(IPYTHON_SHUTDOWN_GRACE_MS).toBeGreaterThanOrEqual(7_000)
  })

  test("waits until a known kernel process tree is confirmed stopped", async () => {
    const kernel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: true,
    })
    await new Promise<void>((resolve, reject) => {
      kernel.once("spawn", resolve)
      kernel.once("error", reject)
    })
    if (!kernel.pid) throw new Error("Test kernel process did not expose a PID")

    const client = clientFor("", "worker-kernel-tree")
    const internals = client as unknown as {
      kernelPid: number
      terminateKnownKernel: () => Promise<void>
    }
    internals.kernelPid = kernel.pid

    try {
      await internals.terminateKnownKernel()
      expect(isProcessAlive(kernel.pid)).toBe(false)
    } finally {
      if (isProcessAlive(kernel.pid)) kernel.kill("SIGKILL")
    }
  }, 10_000)

  test("returns promptly when startup is cancelled", async () => {
    const client = clientFor(`
      setTimeout(() => {
        process.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 1 }) + "\\n");
      }, 1500);
      process.stdin.setEncoding("utf8");
      process.stdin.once("data", (line) => {
        const request = JSON.parse(line.trim());
        process.stdout.write(JSON.stringify({ type: "shutdown", requestId: request.requestId }) + "\\n", () => {
          process.exit(0);
        });
      });
      setInterval(() => {}, 1000);
    `, "worker-startup-abort")
    const controller = new AbortController()
    const startedAt = Date.now()
    const execution = client.execute({ code: "1 + 1", signal: controller.signal })
    setTimeout(() => controller.abort(), 50)

    try {
      await expect(execution).resolves.toMatchObject({ status: "aborted", stateLost: true })
      expect(Date.now() - startedAt).toBeLessThan(500)
    } finally {
      await client.shutdown()
    }
  }, 10_000)

  test("treats a request-scoped fatal event as terminal", async () => {
    const client = clientFor(`
      const ready = { type: "ready", protocolVersion: 1 };
      process.stdout.write(JSON.stringify(ready) + "\\n");
      process.stdin.setEncoding("utf8");
      let buffer = "";
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        const newline = buffer.indexOf("\\n");
        if (newline < 0) return;
        const request = JSON.parse(buffer.slice(0, newline));
        process.stdout.write(JSON.stringify({
          type: "fatal",
          requestId: request.requestId,
          message: "transport failed",
        }) + "\\n");
      });
      setInterval(() => {}, 1000);
    `, "worker-fatal")

    try {
      await expect(client.execute({ code: "1 + 1" })).rejects.toMatchObject({
        code: "IPYTHON_HOST_PROTOCOL_ERROR",
        stateLost: true,
      })
      await expect(client.execute({ code: "2 + 2" })).rejects.toMatchObject({
        code: "IPYTHON_HOST_PROTOCOL_ERROR",
        stateLost: true,
      })
    } finally {
      await client.shutdown()
    }
  }, 10_000)

  test("consumes the final idle event before close cleanup", async () => {
    const client = clientFor(`
      const ready = { type: "ready", protocolVersion: 1 };
      process.stdout.write(JSON.stringify(ready) + "\\n");
      process.stdin.setEncoding("utf8");
      let buffer = "";
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        const newline = buffer.indexOf("\\n");
        if (newline < 0) return;
        const request = JSON.parse(buffer.slice(0, newline));
        const events = [
          { type: "result", requestId: request.requestId, text: "42", executionCount: 1 },
          { type: "idle", requestId: request.requestId, executionCount: 1 },
        ];
        process.stdout.write(events.map((event) => JSON.stringify(event)).join("\\n") + "\\n", () => {
          process.exit(0);
        });
      });
    `, "worker-final-idle")

    try {
      await expect(client.execute({ code: "40 + 2" })).resolves.toMatchObject({
        status: "ok",
        result: "42",
        executionCount: 1,
      })
    } finally {
      await client.shutdown()
    }
  }, 10_000)
})
