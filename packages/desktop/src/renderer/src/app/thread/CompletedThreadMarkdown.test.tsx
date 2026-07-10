import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  THREAD_COMPLETED_MARKDOWN_AUTO_CHARACTER_LIMIT,
  THREAD_COMPLETED_MARKDOWN_SYNC_CHARACTER_LIMIT,
  THREAD_MARKDOWN_PIPELINE_VERSION,
  type MarkdownBlockManifest,
  type MarkdownDocumentManifest,
  type MarkdownHastRoot,
  type MarkdownWorkerRequest,
  type MarkdownWorkerResponse,
} from "../thread-markdown-worker-protocol"
import { CompletedThreadMarkdown } from "./CompletedThreadMarkdown"
import {
  createThreadMarkdownWorkerClient,
  type ThreadMarkdownWorkerClient,
  type ThreadMarkdownWorkerPort,
} from "./thread-markdown-worker-client"

const { legacyThreadMarkdownSpy } = vi.hoisted(() => ({
  legacyThreadMarkdownSpy: vi.fn(),
}))

vi.mock("../thread-markdown", async () => {
  const actual = await vi.importActual<typeof import("../thread-markdown")>("../thread-markdown")
  return {
    ...actual,
    ThreadMarkdown: ({ className, text }: { className?: string; text: string }) => {
      legacyThreadMarkdownSpy({ className, text })
      return <div className={className} data-testid="legacy-thread-markdown">{text}</div>
    },
  }
})

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
}

interface MarkdownHarness {
  client: ThreadMarkdownWorkerClient
  workers: FakeWorker[]
}

const clients: ThreadMarkdownWorkerClient[] = []
let idleSequence = 0
let idleCallbacks = new Map<number, IdleRequestCallback>()
let originalRequestIdleCallback: typeof window.requestIdleCallback | undefined
let originalCancelIdleCallback: typeof window.cancelIdleCallback | undefined

function createHarness(): MarkdownHarness {
  const workers: FakeWorker[] = []
  const client = createThreadMarkdownWorkerClient({
    createWorker: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
  })
  clients.push(client)
  return { client, workers }
}

function parseRequest(worker: FakeWorker) {
  const request = worker.requests.find((candidate) => candidate.type === "parse")
  expect(request?.type).toBe("parse")
  return request as Extract<MarkdownWorkerRequest, { type: "parse" }>
}

function loadBlockRequests(worker: FakeWorker) {
  return worker.requests.filter(
    (request): request is Extract<MarkdownWorkerRequest, { type: "load-block" }> =>
      request.type === "load-block",
  )
}

function createBlockManifest(
  index: number,
  overrides: Partial<MarkdownBlockManifest> = {},
): MarkdownBlockManifest {
  return {
    atomic: false,
    characterCount: 128,
    id: `block-${index}`,
    index,
    nodeCount: 3,
    oversized: false,
    previewText: `Preview ${index}`,
    ...overrides,
  }
}

function createManifest(
  documentID: string,
  blocks: MarkdownBlockManifest[],
): MarkdownDocumentManifest {
  return {
    blocks,
    characterCount: blocks.reduce((total, block) => total + block.characterCount, 0),
    documentID,
    nodeCount: blocks.reduce((total, block) => total + block.nodeCount, 0),
    pipelineVersion: THREAD_MARKDOWN_PIPELINE_VERSION,
  }
}

function emitDocumentReady(
  worker: FakeWorker,
  documentID: string,
  blocks: MarkdownBlockManifest[],
) {
  const request = parseRequest(worker)
  act(() => {
    worker.emit({
      type: "document-ready",
      documentID,
      manifest: createManifest(documentID, blocks),
      requestID: request.requestID,
    })
  })
}

function textRoot(text: string): MarkdownHastRoot {
  return {
    type: "root",
    children: [{ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: text }] }],
  }
}

function emitBlockReady(
  worker: FakeWorker,
  documentID: string,
  blockIndex: number,
  block: MarkdownHastRoot,
) {
  const request = [...loadBlockRequests(worker)]
    .reverse()
    .find((candidate) => candidate.blockIndex === blockIndex)
  expect(request).toBeDefined()
  act(() => {
    worker.emit({
      type: "block-ready",
      block,
      blockIndex,
      documentID,
      requestID: request!.requestID,
    })
  })
}

function flushIdleCallbacks() {
  const callbacks = [...idleCallbacks.values()]
  idleCallbacks.clear()
  act(() => {
    callbacks.forEach((callback) => callback({
      didTimeout: false,
      timeRemaining: () => 50,
    }))
  })
}

function renderCompleted(
  harness: MarkdownHarness,
  {
    documentID = "document-1",
    text = "x".repeat(THREAD_COMPLETED_MARKDOWN_SYNC_CHARACTER_LIMIT + 1),
    ...props
  }: Partial<ComponentProps<typeof CompletedThreadMarkdown>> = {},
) {
  return render(
    <CompletedThreadMarkdown
      documentID={documentID}
      text={text}
      workerClient={harness.client}
      {...props}
    />,
  )
}

beforeEach(() => {
  legacyThreadMarkdownSpy.mockReset()
  idleSequence = 0
  idleCallbacks = new Map()
  originalRequestIdleCallback = window.requestIdleCallback
  originalCancelIdleCallback = window.cancelIdleCallback
  window.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
    idleSequence += 1
    idleCallbacks.set(idleSequence, callback)
    return idleSequence
  })
  window.cancelIdleCallback = vi.fn((idleID: number) => {
    idleCallbacks.delete(idleID)
  })
})

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.dispose())
  if (originalRequestIdleCallback) window.requestIdleCallback = originalRequestIdleCallback
  else delete (window as Partial<Window>).requestIdleCallback
  if (originalCancelIdleCallback) window.cancelIdleCallback = originalCancelIdleCallback
  else delete (window as Partial<Window>).cancelIdleCallback
})

describe("CompletedThreadMarkdown", () => {
  it("keeps content at or below 16k on the synchronous legacy renderer", () => {
    const harness = createHarness()
    const text = "x".repeat(THREAD_COMPLETED_MARKDOWN_SYNC_CHARACTER_LIMIT)

    renderCompleted(harness, { text })

    expect(screen.getByTestId("legacy-thread-markdown")).toHaveTextContent(text)
    expect(legacyThreadMarkdownSpy).toHaveBeenCalledTimes(1)
    expect(harness.workers).toHaveLength(0)
  })

  it("automatically parses medium content, requests edge blocks first, and renders HAST progressively", async () => {
    const harness = createHarness()
    renderCompleted(harness)

    expect(harness.workers).toHaveLength(1)
    expect(parseRequest(harness.workers[0]!).text).toHaveLength(
      THREAD_COMPLETED_MARKDOWN_SYNC_CHARACTER_LIMIT + 1,
    )
    expect(document.querySelector('[data-thread-completed-markdown-render-mode="preparing-preview"]'))
      .toBeInTheDocument()
    expect(legacyThreadMarkdownSpy).not.toHaveBeenCalled()

    const blocks = [createBlockManifest(0), createBlockManifest(1), createBlockManifest(2)]
    emitDocumentReady(harness.workers[0]!, "document-1", blocks)

    await waitFor(() => {
      expect(loadBlockRequests(harness.workers[0]!).map((request) => request.blockIndex)).toEqual([0, 2])
    })
    expect(idleCallbacks.size).toBe(1)

    emitBlockReady(harness.workers[0]!, "document-1", 0, textRoot("First block"))
    expect(await screen.findByText("First block")).toBeInTheDocument()
    expect(screen.queryByText("Last block")).not.toBeInTheDocument()

    emitBlockReady(harness.workers[0]!, "document-1", 2, textRoot("Last block"))
    expect(await screen.findByText("Last block")).toBeInTheDocument()

    flushIdleCallbacks()
    await waitFor(() => {
      expect(loadBlockRequests(harness.workers[0]!).map((request) => request.blockIndex)).toEqual([0, 2, 1])
    })
    emitBlockReady(harness.workers[0]!, "document-1", 1, textRoot("Middle block"))
    expect(await screen.findByText("Middle block")).toBeInTheDocument()
    expect(document.querySelector('[data-thread-completed-markdown-render-mode="segmented-hast"]'))
      .toBeInTheDocument()
  })

  it("defers content above 256k until the user explicitly requests formatting", async () => {
    const harness = createHarness()
    const text = "x".repeat(THREAD_COMPLETED_MARKDOWN_AUTO_CHARACTER_LIMIT + 1)

    renderCompleted(harness, { text })

    expect(harness.workers).toHaveLength(0)
    expect(document.querySelector('[data-thread-completed-markdown-render-mode="large-preview"]'))
      .toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "渲染完整格式" }))

    await waitFor(() => expect(harness.workers).toHaveLength(1))
    expect(parseRequest(harness.workers[0]!).text).toBe(text)
    expect(document.querySelector('[data-thread-completed-markdown-render-mode="preparing-preview"]'))
      .toBeInTheDocument()
  })

  it("keeps oversized blocks as safe previews until their explicit load action", async () => {
    const harness = createHarness()
    renderCompleted(harness)
    const oversizedBlock = createBlockManifest(0, {
      atomic: true,
      characterCount: 300_000,
      nodeCount: 9_000,
      oversized: true,
      previewText: "Safe oversized preview",
    })

    emitDocumentReady(harness.workers[0]!, "document-1", [oversizedBlock])

    expect(await screen.findByText("Safe oversized preview")).toBeInTheDocument()
    expect(loadBlockRequests(harness.workers[0]!)).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "渲染完整格式" }))
    await waitFor(() => {
      expect(loadBlockRequests(harness.workers[0]!).map((request) => request.blockIndex)).toEqual([0])
    })

    emitBlockReady(harness.workers[0]!, "document-1", 0, textRoot("Full oversized block"))
    expect(await screen.findByText("Full oversized block")).toBeInTheDocument()
    expect(screen.queryByText("Safe oversized preview")).not.toBeInTheDocument()
  })

  it("shows a retryable lightweight preview after worker errors without invoking ThreadMarkdown", async () => {
    const harness = createHarness()
    renderCompleted(harness)
    const request = parseRequest(harness.workers[0]!)

    act(() => {
      harness.workers[0]!.emit({
        type: "error",
        documentID: "document-1",
        message: "parse failed",
        operation: "parse",
        requestID: request.requestID,
      })
    })

    expect(await screen.findByText("完整格式排版失败，当前保留轻量预览。")).toBeInTheDocument()
    expect(document.querySelector('[data-thread-completed-markdown-render-mode="error-preview"]'))
      .toBeInTheDocument()
    expect(legacyThreadMarkdownSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "重试排版" }))
    await waitFor(() => expect(harness.workers).toHaveLength(2))
    expect(parseRequest(harness.workers[1]!).type).toBe("parse")
    expect(legacyThreadMarkdownSpy).not.toHaveBeenCalled()
  })

  it("preserves artifact and local-file callbacks while suppressing unsafe HAST links", async () => {
    const harness = createHarness()
    const onArtifactLinkOpen = vi.fn()
    const onLocalFileLinkOpen = vi.fn()
    renderCompleted(harness, { onArtifactLinkOpen, onLocalFileLinkOpen })
    emitDocumentReady(harness.workers[0]!, "document-1", [createBlockManifest(0)])
    await waitFor(() => expect(loadBlockRequests(harness.workers[0]!)).toHaveLength(1))

    const root: MarkdownHastRoot = {
      type: "root",
      children: [{
        type: "element",
        tagName: "p",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "a",
            properties: { href: "agent://artifact/report-1" },
            children: [{ type: "text", value: "Artifact" }],
          },
          { type: "text", value: " " },
          {
            type: "element",
            tagName: "a",
            properties: { href: "C:/Projects/Anybox/src/App.tsx:12" },
            children: [{ type: "text", value: "Local file" }],
          },
          { type: "text", value: " " },
          {
            type: "element",
            tagName: "a",
            properties: { href: "javascript:alert(1)" },
            children: [{ type: "text", value: "Unsafe" }],
          },
        ],
      }],
    }
    emitBlockReady(harness.workers[0]!, "document-1", 0, root)

    fireEvent.click(await screen.findByRole("link", { name: "Artifact" }))
    fireEvent.click(screen.getByRole("link", { name: "Local file" }))
    expect(onArtifactLinkOpen).toHaveBeenCalledWith({
      href: "agent://artifact/report-1",
      id: "report-1",
    })
    expect(onLocalFileLinkOpen).toHaveBeenCalledWith({
      lineRange: { startLineNumber: 12, endLineNumber: 12 },
      path: "C:/Projects/Anybox/src/App.tsx",
    })
    expect(screen.getByText("Unsafe").closest("a")).toBeNull()
  })

  it("preserves Markdown code, table, and image rendering on the HAST path", async () => {
    const harness = createHarness()
    renderCompleted(harness)
    emitDocumentReady(harness.workers[0]!, "document-1", [createBlockManifest(0)])
    await waitFor(() => expect(loadBlockRequests(harness.workers[0]!)).toHaveLength(1))

    const root: MarkdownHastRoot = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "pre",
          properties: {},
          children: [{
            type: "element",
            tagName: "code",
            properties: { className: ["language-ts"] },
            children: [{ type: "text", value: "const ready = true\n" }],
          }],
        },
        {
          type: "element",
          tagName: "table",
          properties: {},
          children: [{
            type: "element",
            tagName: "tbody",
            properties: {},
            children: [{
              type: "element",
              tagName: "tr",
              properties: {},
              children: [{
                type: "element",
                tagName: "td",
                properties: {},
                children: [{ type: "text", value: "ready" }],
              }],
            }],
          }],
        },
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "img",
              properties: { alt: "Remote", src: "https://example.com/diagram.png" },
              children: [],
            },
            {
              type: "element",
              tagName: "img",
              properties: { alt: "Local", src: "C:/Temp/diagram.png" },
              children: [],
            },
            {
              type: "element",
              tagName: "img",
              properties: { alt: "Unsafe", src: "javascript:alert(1)" },
              children: [],
            },
          ],
        },
      ],
    }
    emitBlockReady(harness.workers[0]!, "document-1", 0, root)

    await screen.findByText("const ready = true")
    expect(document.querySelector('code[data-language="ts"]')).toHaveTextContent("const ready = true")
    expect(document.querySelector(".thread-markdown-table-scroll table")).toBe(screen.getByRole("table"))
    expect(screen.getByRole("img", { name: "Remote" })).toHaveAttribute(
      "src",
      "https://example.com/diagram.png",
    )
    expect(screen.getByRole("img", { name: "Local" }).getAttribute("src"))
      .toMatch(/^anybox-local-image:\/\/image\?source=/)
    expect(screen.queryByRole("img", { name: "Unsafe" })).not.toBeInTheDocument()
    expect(screen.getByText("Unsafe")).toHaveClass("thread-markdown-image-alt")
  })

  it("releases and terminates unfinished parsing when unmounted", () => {
    const harness = createHarness()
    const { unmount } = renderCompleted(harness)

    expect(harness.workers).toHaveLength(1)
    unmount()

    expect(harness.workers[0]!.requests.at(-1)).toEqual({
      type: "dispose",
      documentID: "document-1",
    })
    expect(harness.workers[0]!.terminateCount).toBe(1)
  })
})
