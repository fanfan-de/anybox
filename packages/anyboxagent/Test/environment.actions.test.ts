import { afterEach, describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createPtyRegistry } from "#pty/registry.ts"
import type { PtyRuntimeAdapter, PtyRuntimeHandle } from "#pty/runtime.ts"
import type { PtySessionInfo } from "#pty/types.ts"
import { createServerRuntime } from "#server/server.ts"
import type { EnvironmentCandidate, EnvironmentRunRecord } from "#environment/types.ts"

interface JsonEnvelope<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

class FakePtyHandle implements PtyRuntimeHandle {
  readonly pid = Math.floor(Math.random() * 10_000)
  readonly writes: string[] = []
  private readonly exitListeners = new Set<(event: { exitCode: number | null }) => void>()

  write(data: string) {
    this.writes.push(data)
  }

  resize() {}

  kill() {
    for (const listener of [...this.exitListeners]) listener({ exitCode: 0 })
  }

  onData() {
    return () => {}
  }

  onExit(listener: (event: { exitCode: number | null }) => void) {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }
}

class FakePtyRuntime implements PtyRuntimeAdapter {
  readonly handles: FakePtyHandle[] = []

  spawn() {
    const handle = new FakePtyHandle()
    this.handles.push(handle)
    return handle
  }
}

const activeServers: Bun.Server<unknown>[] = []

afterEach(() => {
  for (const server of activeServers.splice(0, activeServers.length)) {
    server.stop(true)
  }
})

async function post<T>(baseURL: string, pathname: string, body: unknown) {
  const response = await fetch(`${baseURL}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return {
    response,
    body: await response.json() as JsonEnvelope<T>,
  }
}

describe("environment actions", () => {
  test("requires trust, reuses a running action, and isolates two action terminals", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "anybox-environment-actions-"))
    const runtime = new FakePtyRuntime()
    const registry = createPtyRegistry({
      runtime,
      exitRetentionMs: 30_000,
      deleteRetentionMs: 30_000,
    })
    const serverRuntime = createServerRuntime({ ptyRegistry: registry })
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: serverRuntime.app.fetch,
    })
    activeServers.push(server)
    const baseURL = `http://127.0.0.1:${String(server.port)}`

    try {
      const configDirectory = path.join(directory, ".anybox", "environments")
      await mkdir(configDirectory, { recursive: true })
      await writeFile(
        path.join(configDirectory, "environment.jsonc"),
        JSON.stringify({
          version: 1,
          name: "Action test",
          actions: [
            {
              id: "dev",
              name: "Development",
              scripts: { default: "echo dev" },
              cwd: ".",
            },
            {
              id: "preview",
              name: "Preview",
              scripts: { default: "echo preview" },
              cwd: ".",
            },
          ],
        }, null, 2),
      )

      const createdSession = await post<{
        id: string
        projectID: string
      }>(baseURL, "/api/sessions", { directory })
      expect(createdSession.response.status).toBe(201)
      const session = createdSession.body.data!

      const listResponse = await fetch(
        `${baseURL}/api/projects/${session.projectID}/environments?directory=${encodeURIComponent(directory)}`,
      )
      const list = await listResponse.json() as JsonEnvelope<{ items: EnvironmentCandidate[] }>
      const environment = list.data?.items[0]
      expect(environment?.trusted).toBe(false)

      const untrusted = await post<unknown>(
        baseURL,
        `/api/projects/${session.projectID}/environments/${environment!.key}/actions/dev/start`,
        {
          sessionID: session.id,
          expectedHash: environment!.contentHash,
        },
      )
      expect(untrusted.response.status).toBe(403)
      expect(untrusted.body.error?.code).toBe("ENVIRONMENT_NOT_TRUSTED")

      const trusted = await post<EnvironmentCandidate>(
        baseURL,
        `/api/projects/${session.projectID}/environments/${environment!.key}/trust`,
        {
          directory,
          expectedHash: environment!.contentHash,
        },
      )
      expect(trusted.body.data?.trusted).toBe(true)

      const actionPath = (actionID: string) =>
        `/api/projects/${session.projectID}/environments/${environment!.key}/actions/${actionID}/start`
      const dev = await post<{
        run: EnvironmentRunRecord
        pty: PtySessionInfo
        reused: boolean
      }>(baseURL, actionPath("dev"), {
        sessionID: session.id,
        expectedHash: environment!.contentHash,
      })
      const repeatedDev = await post<{
        run: EnvironmentRunRecord
        pty: PtySessionInfo
        reused: boolean
      }>(baseURL, actionPath("dev"), {
        sessionID: session.id,
        expectedHash: environment!.contentHash,
      })
      const preview = await post<{
        run: EnvironmentRunRecord
        pty: PtySessionInfo
        reused: boolean
      }>(baseURL, actionPath("preview"), {
        sessionID: session.id,
        expectedHash: environment!.contentHash,
      })

      expect(dev.response.status).toBe(201)
      expect(dev.body.data?.pty.purpose).toBe("environment-action")
      expect(repeatedDev.body.data?.reused).toBe(true)
      expect(repeatedDev.body.data?.pty.id).toBe(dev.body.data?.pty.id)
      expect(preview.body.data?.pty.id).not.toBe(dev.body.data?.pty.id)
      expect(runtime.handles).toHaveLength(2)
      expect(runtime.handles[0]?.writes.join("")).toContain("echo dev")
      expect(runtime.handles[1]?.writes.join("")).toContain("echo preview")

      const stopped = await post<EnvironmentRunRecord>(
        baseURL,
        `/api/projects/${session.projectID}/environments/${environment!.key}/actions/dev/stop`,
        { sessionID: session.id },
      )
      expect(stopped.body.data?.status).toBe("cancelled")
      expect(registry.info(preview.body.data!.pty.id)?.status).toBe("running")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
