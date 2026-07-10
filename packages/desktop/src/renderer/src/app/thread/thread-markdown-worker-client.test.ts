import { describe, expect, it, vi } from "vitest"
import type {
  MarkdownDocumentManifest,
  MarkdownHastRoot,
  MarkdownWorkerRequest,
  MarkdownWorkerResponse,
} from "../thread-markdown-worker-protocol"
import {
  createThreadMarkdownWorkerClient,
  type ThreadMarkdownDocumentResource,
  type ThreadMarkdownWorkerPort,
} from "./thread-markdown-worker-client"

const PIPELINE_VERSION = "1"

class FakeWorker implements ThreadMarkdownWorkerPort {
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessage: ((event: MessageEvent<MarkdownWorkerResponse>) => void) | null = null
  readonly requests: MarkdownWorkerRequest[] = []
  terminateCount = 0

  postMessage(message: MarkdownWorkerRequest) {
    this.requests.push(message)
  }

  terminate() {
    this.terminateCount += 1
  }

  emit(response: MarkdownWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<MarkdownWorkerResponse>)
  }

  emitError(message: string) {
    this.onerror?.({ message } as ErrorEvent)
  }
}

function createHarness(limits?: {
  maxCharacters?: number
  maxDocuments?: number
  maxNodes?: number
}) {
  const workers: FakeWorker[] = []
  const client = createThreadMarkdownWorkerClient({
    createWorker: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    limits,
  })
  return { client, workers }
}

function acquire(
  client: ReturnType<typeof createThreadMarkdownWorkerClient>,
  documentID = "document-1",
  sourceText = "# Hello",
  pipelineVersion = PIPELINE_VERSION,
) {
  return client.acquireDocument({ documentID, pipelineVersion, sourceText })
}

function parseRequest(worker: FakeWorker) {
  const request = worker.requests.find((candidate) => candidate.type === "parse")
  expect(request?.type).toBe("parse")
  return request as Extract<MarkdownWorkerRequest, { type: "parse" }>
}

function blockRequest(worker: FakeWorker, blockIndex: number) {
  const request = worker.requests.find(
    (candidate) => candidate.type === "load-block" && candidate.blockIndex === blockIndex,
  )
  expect(request?.type).toBe("load-block")
  return request as Extract<MarkdownWorkerRequest, { type: "load-block" }>
}

function manifest(
  documentID = "document-1",
  blocks: MarkdownDocumentManifest["blocks"] = [{
    atomic: false,
    characterCount: 7,
    id: "block-0",
    index: 0,
    nodeCount: 1,
    oversized: false,
    previewText: "Hello",
  }],
): MarkdownDocumentManifest {
  return {
    blocks,
    characterCount: blocks.reduce((total, block) => total + block.characterCount, 0),
    documentID,
    nodeCount: blocks.reduce((total, block) => total + block.nodeCount, 0),
    pipelineVersion: PIPELINE_VERSION,
  }
}

function ready(worker: FakeWorker, nextManifest = manifest()) {
  const request = parseRequest(worker)
  worker.emit({
    type: "document-ready",
    documentID: request.documentID,
    manifest: nextManifest,
    requestID: request.requestID,
  })
}

function root(text = "Hello"): MarkdownHastRoot {
  return {
    type: "root",
    children: [{ type: "text", value: text }],
  }
}

function emitBlock(worker: FakeWorker, blockIndex: number, block = root()) {
  const request = blockRequest(worker, blockIndex)
  worker.emit({
    type: "block-ready",
    block,
    blockIndex,
    documentID: request.documentID,
    requestID: request.requestID,
  })
}

function releaseAll(...resources: ThreadMarkdownDocumentResource[]) {
  resources.forEach((resource) => resource.release())
}

describe("thread Markdown worker client", () => {
  it("prepares a document and loads blocks only when explicitly requested", () => {
    const { client, workers } = createHarness()
    const resource = acquire(client)
    const listener = vi.fn()
    resource.subscribe(listener)

    expect(resource.getSnapshot()).toMatchObject({
      blocks: new Map(),
      error: null,
      manifest: null,
      status: "preparing",
    })
    expect(workers).toHaveLength(1)
    expect(parseRequest(workers[0]!).text).toBe("# Hello")

    ready(workers[0]!)
    expect(resource.getSnapshot()).toMatchObject({ status: "ready", manifest: manifest() })
    expect(workers[0]!.requests.some((request) => request.type === "load-block")).toBe(false)

    resource.requestBlock(0)
    expect(blockRequest(workers[0]!, 0).blockIndex).toBe(0)
    emitBlock(workers[0]!, 0)
    expect(resource.getSnapshot().blocks.get(0)).toEqual(root())
    expect(listener).toHaveBeenCalled()
    expect(workers[0]!.terminateCount).toBe(1)

    resource.release()
    client.dispose()
  })

  it("queues and deduplicates block requests made before parsing completes", () => {
    const { client, workers } = createHarness()
    const resource = acquire(client)

    resource.requestBlock(0)
    resource.requestBlock(0)
    expect(workers[0]!.requests.filter((request) => request.type === "load-block")).toHaveLength(0)

    ready(workers[0]!)
    expect(workers[0]!.requests.filter((request) => request.type === "load-block")).toHaveLength(1)

    releaseAll(resource)
    client.dispose()
  })

  it("deduplicates identical documents and reuses cached blocks across virtual remounts", () => {
    const { client, workers } = createHarness()
    const first = acquire(client)
    const second = acquire(client)
    expect(workers).toHaveLength(1)

    ready(workers[0]!)
    first.requestBlock(0)
    emitBlock(workers[0]!, 0)
    releaseAll(first, second)

    const remounted = acquire(client)
    expect(remounted.getSnapshot().status).toBe("ready")
    expect(remounted.getSnapshot().blocks.get(0)).toEqual(root())
    remounted.requestBlock(0)
    expect(workers).toHaveLength(1)

    releaseAll(remounted)
    client.dispose()
  })

  it("does not deduplicate a changed source or pipeline version", () => {
    const { client, workers } = createHarness()
    const first = acquire(client)
    const changedSource = acquire(client, "document-1", "# Changed")
    const changedPipeline = acquire(client, "document-1", "# Hello", "2")

    expect(workers).toHaveLength(3)

    releaseAll(first, changedSource, changedPipeline)
    client.dispose()
  })

  it("terminates unfinished work only after the last resource releases", () => {
    const { client, workers } = createHarness()
    const first = acquire(client)
    const second = acquire(client)

    first.release()
    expect(workers[0]!.terminateCount).toBe(0)
    second.release()
    expect(workers[0]!.requests.at(-1)).toEqual({ type: "dispose", documentID: "document-1" })
    expect(workers[0]!.terminateCount).toBe(1)

    const remounted = acquire(client)
    expect(workers).toHaveLength(2)
    releaseAll(remounted)
    client.dispose()
  })

  it("ignores stale generations after retry and recovers from protocol errors", () => {
    const { client, workers } = createHarness()
    const resource = acquire(client)
    const staleWorker = workers[0]!
    const staleHandler = staleWorker.onmessage
    const staleRequest = parseRequest(staleWorker)

    staleWorker.emit({
      type: "error",
      documentID: "document-1",
      message: "parse failed",
      operation: "parse",
      requestID: staleRequest.requestID,
    })
    expect(resource.getSnapshot()).toMatchObject({
      error: { message: "parse failed", operation: "parse" },
      status: "error",
    })

    resource.retry()
    expect(workers).toHaveLength(2)
    expect(resource.getSnapshot().status).toBe("preparing")

    staleHandler?.({
      data: {
        type: "document-ready",
        documentID: "document-1",
        manifest: manifest(),
        requestID: staleRequest.requestID,
      },
    } as MessageEvent<MarkdownWorkerResponse>)
    expect(resource.getSnapshot().status).toBe("preparing")

    ready(workers[1]!)
    expect(resource.getSnapshot()).toMatchObject({ error: null, status: "ready" })

    releaseAll(resource)
    client.dispose()
  })

  it("surfaces worker crashes and can retry with a fresh worker", () => {
    const { client, workers } = createHarness()
    const resource = acquire(client)

    workers[0]!.emitError("worker crashed")
    expect(resource.getSnapshot()).toMatchObject({
      error: { message: "worker crashed", operation: "worker" },
      status: "error",
    })
    expect(workers[0]!.terminateCount).toBe(1)

    resource.retry()
    expect(workers).toHaveLength(2)

    releaseAll(resource)
    client.dispose()
  })

  it("evicts the least recently used inactive document while pinning active documents", () => {
    const { client, workers } = createHarness({
      maxCharacters: 1_000,
      maxDocuments: 2,
      maxNodes: 100,
    })
    const active = acquire(client, "active", "active")
    ready(workers[0]!, manifest("active", []))

    const oldInactive = acquire(client, "old", "old")
    ready(workers[1]!, manifest("old", []))
    oldInactive.release()

    const newest = acquire(client, "new", "new")
    ready(workers[2]!, manifest("new", []))
    newest.release()

    const activeAgain = acquire(client, "active", "active")
    expect(workers).toHaveLength(3)
    const oldAgain = acquire(client, "old", "old")
    expect(workers).toHaveLength(4)

    releaseAll(active, activeAgain, oldAgain)
    client.dispose()
  })

  it("evicts inactive HAST entries that exceed the node budget", () => {
    const { client, workers } = createHarness({
      maxCharacters: 1_000,
      maxDocuments: 8,
      maxNodes: 1,
    })
    const resource = acquire(client)
    ready(workers[0]!, manifest("document-1", [{
      atomic: false,
      characterCount: 7,
      id: "block-0",
      index: 0,
      nodeCount: 2,
      oversized: false,
      previewText: "Hello",
    }]))
    resource.requestBlock(0)
    emitBlock(workers[0]!, 0)
    resource.release()

    const remounted = acquire(client)
    expect(workers).toHaveLength(2)

    releaseAll(remounted)
    client.dispose()
  })

  it("pins an active oversized source and evicts it after the final release", () => {
    const { client, workers } = createHarness({
      maxCharacters: 5,
      maxDocuments: 8,
      maxNodes: 100,
    })
    const first = acquire(client, "large", "0123456789")
    const second = acquire(client, "large", "0123456789")
    expect(workers).toHaveLength(1)

    first.release()
    expect(workers[0]!.terminateCount).toBe(0)
    second.release()
    expect(workers[0]!.terminateCount).toBe(1)

    const remounted = acquire(client, "large", "0123456789")
    expect(workers).toHaveLength(2)

    releaseAll(remounted)
    client.dispose()
  })

  it("validates block indices and disposes the complete client idempotently", () => {
    const { client, workers } = createHarness()
    const resource = acquire(client)
    const listener = vi.fn()
    resource.subscribe(listener)

    expect(() => resource.requestBlock(-1)).toThrow(RangeError)
    client.dispose()
    client.dispose()

    expect(workers[0]!.terminateCount).toBe(1)
    expect(resource.getSnapshot().status).toBe("error")
    expect(listener).toHaveBeenCalled()
    expect(() => acquire(client)).toThrow("disposed")
  })
})
