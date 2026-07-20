import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { ComputerUseHelperTransport } from "../src/mcp/computer-use/helper-transport.ts"
import { ComputerUseTurnLease } from "../src/mcp/computer-use/turn-lease.ts"
import { ComputerUseFacadeClient } from "../src/mcp/computer-use/facade-client.ts"
import {
  ComputerUseBroker,
  computerUseBroker,
} from "../src/mcp/computer-use/broker.ts"

const transports: ComputerUseHelperTransport[] = []

function packagedHelperPath() {
  return resolve(
    import.meta.dir,
    "..",
    "..",
    "..",
    "plugins",
    "Anybox-Plugins",
    "computer-use-windows",
    "helper",
    "win32-x64",
    "computer-use-helper.exe",
  )
}

afterEach(() => {
  for (const transport of transports.splice(0)) {
    transport.stop()
  }
})

describe("Computer Use global turn lease", () => {
  test("renews for one turn, rejects interleaving, and remains fused after interrupt", () => {
    const lease = new ComputerUseTurnLease()
    const first = lease.acquire({ sessionID: "session_a", turnID: "turn_a" })
    expect(first.created).toBe(true)
    expect(
      lease.acquire({ sessionID: "session_a", turnID: "turn_a" }).lease.leaseID,
    ).toBe(first.lease.leaseID)
    expect(() => lease.acquire({
      sessionID: "session_b",
      turnID: "turn_b",
    })).toThrow("another active turn")
    lease.interrupt({ sessionID: "session_a", turnID: "turn_a" })
    expect(() => lease.acquire({
      sessionID: "session_a",
      turnID: "turn_a",
    })).toThrow("cannot continue")
    expect(lease.release({
      sessionID: "session_a",
      turnID: "turn_a",
    })?.leaseID).toBe(first.lease.leaseID)
  })

  test("routes a framed physical Escape notification to the broker callback", () => {
    let interrupts = 0
    const transport = new ComputerUseHelperTransport(
      "missing-helper.exe",
      () => {
        interrupts += 1
      },
    )
    const body = Buffer.from(JSON.stringify({
      jsonrpc: "2.0",
      method: "physical_escape",
      params: { inputEpoch: 1 },
    }))
    const frame = Buffer.alloc(4 + body.length)
    frame.writeUInt32LE(body.length, 0)
    body.copy(frame, 4)
    ;(transport as unknown as { onData(chunk: Buffer): void }).onData(frame)
    expect(interrupts).toBe(1)
  })

  test("binds trusted helper window identity to its application approval key", () => {
    const broker = new ComputerUseBroker("missing-helper.exe")
    const identity = {
      hwnd: "123",
      pid: 42,
      processStartTime: "1000",
      rootOwnerHwnd: "123",
      executableIdentity: "notepad.exe",
      sessionId: 1,
      integrityLevel: "medium",
    }
    const internals = broker as unknown as {
      rememberApps(method: string, value: unknown): void
      resolveApp(
        method: string,
        params: Record<string, unknown>,
      ): { appID: string; displayName: string } | undefined
    }
    internals.rememberApps("list_windows", {
      windows: [{
        identity,
        appId: "win32:notepad.exe:stable",
        processName: "notepad.exe",
      }],
    })
    expect(internals.resolveApp("get_window_state", {
      expectedIdentity: identity,
    })).toEqual({
      appID: "win32:notepad.exe:stable",
      displayName: "notepad.exe",
    })
    broker.dispose()
  })
})

describe.skipIf(process.platform !== "win32")("Computer Use host broker transport", () => {
  test("rejects a replaced helper before spawning it", async () => {
    const directory = mkdtempSync(join(tmpdir(), "anybox-cu-integrity-"))
    try {
      const helperPath = join(directory, "computer-use-helper.exe")
      writeFileSync(helperPath, "not a trusted helper")
      writeFileSync(
        join(directory, "computer-use-helper.sha256"),
        `${"0".repeat(64)}  computer-use-helper.exe\n`,
      )
      const transport = new ComputerUseHelperTransport(helperPath, () => undefined)
      transports.push(transport)
      await expect(transport.ensureInitialized()).rejects.toMatchObject({
        code: "CU_PROTOCOL_MISMATCH",
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("rejects an unsigned helper when the release signature gate is enabled", async () => {
    const directory = mkdtempSync(join(tmpdir(), "anybox-cu-signature-"))
    try {
      const helperPath = join(directory, "computer-use-helper.exe")
      const contents = Buffer.from("unsigned helper fixture")
      writeFileSync(helperPath, contents)
      writeFileSync(
        join(directory, "computer-use-helper.sha256"),
        `${createHash("sha256").update(contents).digest("hex")}  computer-use-helper.exe\n`,
      )
      const transport = new ComputerUseHelperTransport(
        helperPath,
        () => undefined,
        { requireAuthenticode: true },
      )
      transports.push(transport)
      await expect(transport.ensureInitialized()).rejects.toMatchObject({
        code: "CU_PROTOCOL_MISMATCH",
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("authenticates a real helper over the private named pipe", async () => {
    const helperPath = packagedHelperPath()
    const transport = new ComputerUseHelperTransport(helperPath, () => undefined)
    transports.push(transport)
    const handshake = await transport.ensureInitialized()
    expect(handshake.protocolVersion).toBe(1)
    expect((handshake.capabilities as Record<string, unknown>).hostBroker).toBe(true)
    expect((handshake.capabilities as Record<string, unknown>).physicalEscape).toBe(true)

    const health = await transport.call("health_check", {}, {
      context: {
        sessionID: "session_test",
        turnID: "turn_test",
        toolCallID: "call_test",
      },
    }) as Record<string, any>
    expect(health.features.hostBroker).toBe(true)
    expect(health.features.physicalEscape).toBe(true)
  })

  test("kills a disconnected helper and recovers with a fresh process", async () => {
    const transport = new ComputerUseHelperTransport(packagedHelperPath(), () => undefined)
    transports.push(transport)
    await transport.ensureInitialized()
    const internals = transport as unknown as {
      child?: {
        pid?: number
        exitCode: number | null
        killed: boolean
        once(event: string, cb: () => void): void
      }
      socket?: { destroy(): void }
    }
    const first = internals.child
    const firstPID = first?.pid
    expect(firstPID).toBeNumber()
    const exited = new Promise<void>((resolve) => {
      first?.once("exit", resolve)
    })
    internals.socket?.destroy()
    await Promise.race([
      exited,
      Bun.sleep(5_000).then(() => {
        throw new Error("Disconnected Computer Use helper did not exit.")
      }),
    ])
    expect(first?.killed || first?.exitCode !== null).toBe(true)

    await transport.ensureInitialized()
    expect(internals.child?.pid).toBeNumber()
    expect(internals.child?.pid).not.toBe(firstPID)
  })

  test("rejects a named-pipe client whose PID is not the broker parent", async () => {
    const pipeName = `anybox-cu-${randomBytes(16).toString("hex")}`
    const pipePath = `\\\\.\\pipe\\${pipeName}`
    const helper = spawn(
      packagedHelperPath(),
      ["--broker-pipe", pipeName, "--broker-pid", String(process.pid)],
      { stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
    )
    let rogue: ReturnType<typeof spawn> | undefined
    try {
      helper.stdin.end(`${randomBytes(32).toString("hex")}\n`)
      rogue = spawn(
        process.execPath,
        [
          "-e",
          [
            "const net=require('node:net')",
            `const path=${JSON.stringify(pipePath)}`,
            "const deadline=Date.now()+7000",
            "const connect=()=>{",
            "const s=net.connect(path)",
            "s.once('connect',()=>setTimeout(()=>s.end(),50))",
            "s.once('error',()=>{s.destroy();if(Date.now()<deadline)setTimeout(connect,25);else process.exit(2)})",
            "}",
            "connect()",
          ].join(";"),
        ],
        { stdio: "ignore", windowsHide: true },
      )
      const helperExit = new Promise<number | null>((resolve) => {
        helper.once("exit", (code) => resolve(code))
      })
      const rogueExit = new Promise<void>((resolve) => {
        rogue?.once("exit", () => resolve())
      })
      const exitCode = await Promise.race([
        helperExit,
        Bun.sleep(8_000).then(() => {
          throw new Error("Helper did not reject the rogue named-pipe client.")
        }),
      ])
      await rogueExit
      expect(exitCode).not.toBe(0)
    } finally {
      if (helper.exitCode === null) helper.kill()
      if (rogue?.exitCode === null) rogue.kill()
    }
  }, 10_000)

  test("serves the 14-tool host facade without spawning a plugin MCP process", async () => {
    const client = new ComputerUseFacadeClient()
    try {
      expect(await client.listTools()).toHaveLength(14)
      const result = await client.callTool(
        "computer_health_check",
        {},
        undefined,
        {
          sessionID: "session_test",
          turnID: "turn_test",
          messageID: "message_test",
          toolCallID: "call_health",
        },
      )
      expect(result.isError).toBe(false)
      expect(result.structuredContent).toMatchObject({
        ok: true,
        protocolVersion: 1,
      })
    } finally {
      await client.dispose()
      computerUseBroker().dispose()
    }
  })
})
