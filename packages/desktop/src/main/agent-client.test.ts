import { describe, expect, it, vi } from "vitest"
import { consumeSSEBuffer, parseSSE, readAgentSSEStream, requestAgentAppRuntime } from "./agent-client"

describe("App Runtime Gateway client", () => {
  it("keeps the gateway secret in main and strips browser origin and cookies", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("proxied", {
      status: 206,
      headers: {
        "content-range": "bytes 0-6/7",
        "set-cookie": "runtime-session=secret",
      },
    }))

    try {
      const response = await requestAgentAppRuntime(
        "media app",
        "/api/assets?preview=1",
        new Request("anybox-preview://token/__anybox_runtime__/api/assets", {
          headers: {
            origin: "anybox-preview://token",
            referer: "anybox-preview://token/",
            range: "bytes=0-6",
          },
        }),
      )

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(String(url)).toContain("/api/plugins/installed/media%20app/app-runtime/api/assets?preview=1")
      const headers = new Headers(init?.headers)
      expect(headers.get("origin")).toBeNull()
      expect(headers.get("referer")).toBeNull()
      expect(headers.get("range")).toBe("bytes=0-6")
      expect(headers.get("x-anybox-app-gateway-secret")).toMatch(/^[A-Za-z0-9_-]{40,}$/)
      expect(response.status).toBe(206)
      expect(response.headers.get("content-range")).toBe("bytes 0-6/7")
      expect(response.headers.get("set-cookie")).toBeNull()
    } finally {
      fetchMock.mockRestore()
    }
  })
})

describe("agent SSE parsing", () => {
  it("ignores keepalive comment blocks in completed responses", () => {
    const events = parseSSE(
      [
        "event: started",
        'data: {"sessionID":"session-1"}',
        "",
        ": keepalive 1744300000000",
        "",
        "event: delta",
        'data: {"kind":"text","delta":"Streaming answer"}',
        "",
      ].join("\n"),
    )

    expect(events).toEqual([
      {
        event: "started",
        data: {
          sessionID: "session-1",
        },
      },
      {
        event: "delta",
        data: {
          kind: "text",
          delta: "Streaming answer",
        },
      },
    ])
  })

  it("ignores split keepalive comment blocks while incrementally consuming stream chunks", () => {
    const firstChunk = consumeSSEBuffer(
      [
        "event: started",
        'data: {"sessionID":"session-1"}',
        "",
        ": keep",
      ].join("\n"),
    )

    expect(firstChunk.events).toEqual([
      {
        event: "started",
        data: {
          sessionID: "session-1",
        },
      },
    ])
    expect(firstChunk.remainder).toBe(": keep")

    const secondChunk = consumeSSEBuffer(
      `${firstChunk.remainder}alive 1744300000000\n\nevent: done\ndata: {"sessionID":"session-1","parts":[]}\n\n`,
    )

    expect(secondChunk.events).toEqual([
      {
        event: "done",
        data: {
          sessionID: "session-1",
          parts: [],
        },
      },
    ])
    expect(secondChunk.remainder).toBe("")
  })

  it("preserves SSE ids so callers can resume from the last cursor", () => {
    const events = parseSSE(
      [
        "id: 1740000000000:turn-1:2",
        "event: delta",
        'data: {"kind":"text","delta":"Recovered chunk"}',
        "",
      ].join("\n"),
    )

    expect(events).toEqual([
      {
        id: "1740000000000:turn-1:2",
        event: "delta",
        data: {
          kind: "text",
          delta: "Recovered chunk",
        },
      },
    ])
  })

  it("streams events through the callback without returning an accumulated event array", async () => {
    const encoder = new TextEncoder()
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("event: delta\n"))
          controller.enqueue(encoder.encode('data: {"kind":"text","delta":"chunk"}\n\n'))
          controller.close()
        },
      }),
    )
    const events: ReturnType<typeof parseSSE> = []

    const result = await readAgentSSEStream(response, (event) => {
      events.push(event)
    })

    expect(result).toBeUndefined()
    expect(events).toEqual([
      {
        event: "delta",
        data: {
          kind: "text",
          delta: "chunk",
        },
      },
    ])
  })
})
