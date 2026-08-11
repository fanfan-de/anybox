// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { createAssetLibraryApi } from "./assetLibraryApi"

type Listener = (event: Event) => void

class FakeEventTarget {
  private readonly listeners = new Map<string, Listener[]>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (typeof listener !== "function") return
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener as Listener)
    this.listeners.set(type, listeners)
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type))
  }
}

class FakeXMLHttpRequest extends FakeEventTarget {
  static latest: FakeXMLHttpRequest | undefined
  readonly upload = new FakeEventTarget()
  readonly requestHeaders = new Headers()
  method = ""
  url = ""
  status = 200
  responseType: XMLHttpRequestResponseType = ""
  response: unknown = {
    success: true,
    data: {
      revision: 2,
      asset: {
        id: "asset-1",
        folderID: "root",
        relativePath: "image.png",
        displayName: "image.png",
        kind: "image",
        source: "upload",
        status: "ready",
        mimeType: "image/png",
        sizeBytes: 3,
        checksum: "checksum",
        contentRevision: 1,
        createdAt: "2026-08-11T00:00:00.000Z",
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
    },
  }

  constructor() {
    super()
    FakeXMLHttpRequest.latest = this
  }

  open(method: string, url: string | URL) {
    this.method = method
    this.url = String(url)
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders.set(name, value)
  }

  send(_body?: Document | XMLHttpRequestBodyInit | null) {
    queueMicrotask(() => this.dispatch("load"))
  }

  abort() {
    this.dispatch("abort")
  }
}

describe("asset library XHR upload authorization", () => {
  afterEach(() => {
    FakeXMLHttpRequest.latest = undefined
    vi.unstubAllGlobals()
  })

  it("adds the standalone double-submit CSRF token to multipart uploads", async () => {
    document.cookie = "cinema_csrf=standalone%20token; Path=/"
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest)
    const api = createAssetLibraryApi(
      "http://127.0.0.1:4096",
      "project-1",
      { type: "project", projectID: "project-1" },
    )

    await expect(api.upload({
      file: new File(["png"], "image.png", { type: "image/png" }),
      folderID: "root",
      operationID: "upload-1",
      baseRevision: 1,
    })).resolves.toMatchObject({ revision: 2, asset: { id: "asset-1" } })

    expect(FakeXMLHttpRequest.latest?.method).toBe("POST")
    expect(FakeXMLHttpRequest.latest?.requestHeaders.get("x-cinema-csrf")).toBe("standalone token")
  })
})
