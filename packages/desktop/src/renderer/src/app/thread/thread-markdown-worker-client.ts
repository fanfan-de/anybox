import type {
  MarkdownDocumentManifest,
  MarkdownHastRoot,
  MarkdownPipelineVersion,
  MarkdownWorkerRequest,
  MarkdownWorkerResponse,
} from "../thread-markdown-worker-protocol"

export const THREAD_MARKDOWN_CACHE_MAX_DOCUMENTS = 8
export const THREAD_MARKDOWN_CACHE_MAX_NODES = 100_000
export const THREAD_MARKDOWN_CACHE_MAX_CHARACTERS = 1_000_000

export interface ThreadMarkdownWorkerPort {
  onerror: ((event: ErrorEvent) => void) | null
  onmessage: ((event: MessageEvent<MarkdownWorkerResponse>) => void) | null
  postMessage(message: MarkdownWorkerRequest): void
  terminate(): void
}

export interface ThreadMarkdownDocumentInput {
  documentID: string
  pipelineVersion: MarkdownPipelineVersion
  sourceText: string
}

export type ThreadMarkdownDocumentErrorOperation = "load-block" | "parse" | "worker"

export interface ThreadMarkdownDocumentError {
  message: string
  operation: ThreadMarkdownDocumentErrorOperation
}

export interface ThreadMarkdownDocumentSnapshot {
  blocks: ReadonlyMap<number, MarkdownHastRoot>
  error: ThreadMarkdownDocumentError | null
  manifest: MarkdownDocumentManifest | null
  status: "error" | "preparing" | "ready"
}

export interface ThreadMarkdownDocumentResource {
  getSnapshot(): ThreadMarkdownDocumentSnapshot
  release(): void
  requestBlock(blockIndex: number): void
  retry(): void
  subscribe(listener: () => void): () => void
}

export interface ThreadMarkdownWorkerClient {
  acquireDocument(input: ThreadMarkdownDocumentInput): ThreadMarkdownDocumentResource
  dispose(): void
}

export interface ThreadMarkdownWorkerClientOptions {
  createWorker: (documentID: string) => ThreadMarkdownWorkerPort
  limits?: Partial<ThreadMarkdownWorkerCacheLimits>
}

interface ThreadMarkdownWorkerCacheLimits {
  maxCharacters: number
  maxDocuments: number
  maxNodes: number
}

interface DocumentCacheEntry extends ThreadMarkdownDocumentInput {
  blockRequestIDs: Map<number, string>
  generation: number
  lastAccess: number
  listeners: Set<() => void>
  parseRequestID: string | null
  referenceCount: number
  requestedBlockIndices: Set<number>
  snapshot: ThreadMarkdownDocumentSnapshot
  worker: ThreadMarkdownWorkerPort | null
}

const EMPTY_BLOCKS: ReadonlyMap<number, MarkdownHastRoot> = new Map()

function createPreparingSnapshot(): ThreadMarkdownDocumentSnapshot {
  return {
    blocks: EMPTY_BLOCKS,
    error: null,
    manifest: null,
    status: "preparing",
  }
}

function findBlockManifest(manifest: MarkdownDocumentManifest, blockIndex: number) {
  return manifest.blocks.find((block) => block.index === blockIndex)
}

function loadedNodeCount(entry: DocumentCacheEntry) {
  const manifest = entry.snapshot.manifest
  if (!manifest) return 0

  let nodeCount = 0
  entry.snapshot.blocks.forEach((_block, blockIndex) => {
    nodeCount += findBlockManifest(manifest, blockIndex)?.nodeCount ?? 0
  })
  return nodeCount
}

export function createThreadMarkdownWorkerClient({
  createWorker,
  limits: limitOverrides,
}: ThreadMarkdownWorkerClientOptions): ThreadMarkdownWorkerClient {
  const limits: ThreadMarkdownWorkerCacheLimits = {
    maxCharacters: limitOverrides?.maxCharacters ?? THREAD_MARKDOWN_CACHE_MAX_CHARACTERS,
    maxDocuments: limitOverrides?.maxDocuments ?? THREAD_MARKDOWN_CACHE_MAX_DOCUMENTS,
    maxNodes: limitOverrides?.maxNodes ?? THREAD_MARKDOWN_CACHE_MAX_NODES,
  }
  const entries = new Set<DocumentCacheEntry>()
  let accessSequence = 0
  let requestSequence = 0
  let disposed = false

  function touch(entry: DocumentCacheEntry) {
    accessSequence += 1
    entry.lastAccess = accessSequence
  }

  function notify(entry: DocumentCacheEntry) {
    for (const listener of [...entry.listeners]) listener()
  }

  function updateSnapshot(entry: DocumentCacheEntry, snapshot: ThreadMarkdownDocumentSnapshot) {
    entry.snapshot = snapshot
    touch(entry)
    notify(entry)
  }

  function nextRequestID(entry: DocumentCacheEntry, operation: "block" | "parse") {
    requestSequence += 1
    return `${entry.documentID}:${entry.generation}:${operation}:${requestSequence}`
  }

  function terminateWorker(entry: DocumentCacheEntry, sendDispose: boolean) {
    const worker = entry.worker
    if (!worker) return

    entry.worker = null
    entry.generation += 1
    entry.parseRequestID = null
    entry.blockRequestIDs.clear()
    if (sendDispose) {
      try {
        worker.postMessage({
          type: "dispose",
          documentID: entry.documentID,
        })
      } catch {
        // Termination is the authoritative cleanup path.
      }
    }
    worker.onmessage = null
    worker.onerror = null
    worker.terminate()
  }

  function evictEntry(entry: DocumentCacheEntry) {
    terminateWorker(entry, true)
    entry.listeners.clear()
    entries.delete(entry)
  }

  function enforceCacheLimits() {
    const exceedsLimits = () => {
      let characterCount = 0
      let nodeCount = 0
      entries.forEach((entry) => {
        characterCount += entry.sourceText.length
        nodeCount += loadedNodeCount(entry)
      })
      return entries.size > limits.maxDocuments ||
        characterCount > limits.maxCharacters ||
        nodeCount > limits.maxNodes
    }

    while (exceedsLimits()) {
      const evictionCandidate = [...entries]
        .filter((entry) => entry.referenceCount === 0)
        .sort((left, right) => left.lastAccess - right.lastAccess)[0]
      if (!evictionCandidate) return
      evictEntry(evictionCandidate)
    }
  }

  function setError(
    entry: DocumentCacheEntry,
    operation: ThreadMarkdownDocumentErrorOperation,
    message: string,
  ) {
    terminateWorker(entry, true)
    updateSnapshot(entry, {
      ...entry.snapshot,
      error: { message, operation },
      status: "error",
    })
    enforceCacheLimits()
  }

  function requestBlockFromWorker(entry: DocumentCacheEntry, blockIndex: number) {
    const manifest = entry.snapshot.manifest
    const worker = entry.worker
    if (!manifest || !worker || entry.parseRequestID) return
    if (entry.snapshot.blocks.has(blockIndex) || entry.blockRequestIDs.has(blockIndex)) return
    if (!findBlockManifest(manifest, blockIndex)) {
      entry.requestedBlockIndices.delete(blockIndex)
      setError(entry, "load-block", `Markdown block ${blockIndex} does not exist.`)
      return
    }

    const requestID = nextRequestID(entry, "block")
    entry.blockRequestIDs.set(blockIndex, requestID)
    try {
      worker.postMessage({
        type: "load-block",
        blockIndex,
        documentID: entry.documentID,
        requestID,
      })
    } catch (error) {
      setError(entry, "load-block", error instanceof Error ? error.message : String(error))
    }
  }

  function requestPendingBlocks(entry: DocumentCacheEntry) {
    for (const blockIndex of [...entry.requestedBlockIndices].sort((left, right) => left - right)) {
      requestBlockFromWorker(entry, blockIndex)
    }
  }

  function retainCompatibleBlocks(
    currentManifest: MarkdownDocumentManifest | null,
    nextManifest: MarkdownDocumentManifest,
    currentBlocks: ReadonlyMap<number, MarkdownHastRoot>,
  ) {
    if (!currentManifest) return new Map<number, MarkdownHastRoot>()

    const blocks = new Map<number, MarkdownHastRoot>()
    currentBlocks.forEach((block, blockIndex) => {
      const currentBlockManifest = findBlockManifest(currentManifest, blockIndex)
      const nextBlockManifest = findBlockManifest(nextManifest, blockIndex)
      if (currentBlockManifest?.id === nextBlockManifest?.id) blocks.set(blockIndex, block)
    })
    return blocks
  }

  function handleWorkerResponse(
    entry: DocumentCacheEntry,
    worker: ThreadMarkdownWorkerPort,
    generation: number,
    response: MarkdownWorkerResponse,
  ) {
    if (entry.worker !== worker || entry.generation !== generation) return

    switch (response.type) {
      case "document-ready": {
        if (response.documentID !== entry.documentID || response.requestID !== entry.parseRequestID) return
        if (response.manifest.pipelineVersion !== entry.pipelineVersion) {
          setError(entry, "parse", "Markdown worker pipeline version did not match the requested version.")
          return
        }

        const blocks = retainCompatibleBlocks(entry.snapshot.manifest, response.manifest, entry.snapshot.blocks)
        entry.parseRequestID = null
        updateSnapshot(entry, {
          blocks,
          error: null,
          manifest: response.manifest,
          status: "ready",
        })
        requestPendingBlocks(entry)
        if (response.manifest.blocks.length === 0) terminateWorker(entry, true)
        enforceCacheLimits()
        return
      }
      case "block-ready": {
        if (response.documentID !== entry.documentID) return
        if (entry.blockRequestIDs.get(response.blockIndex) !== response.requestID) return

        entry.blockRequestIDs.delete(response.blockIndex)
        entry.requestedBlockIndices.delete(response.blockIndex)
        const blocks = new Map(entry.snapshot.blocks)
        blocks.set(response.blockIndex, response.block)
        updateSnapshot(entry, {
          blocks,
          error: null,
          manifest: entry.snapshot.manifest,
          status: "ready",
        })

        if (entry.snapshot.manifest && blocks.size >= entry.snapshot.manifest.blocks.length) {
          terminateWorker(entry, true)
        }
        enforceCacheLimits()
        return
      }
      case "error": {
        if (response.documentID && response.documentID !== entry.documentID) return
        if (response.requestID) {
          const isCurrentParseRequest = response.requestID === entry.parseRequestID
          const isCurrentBlockRequest = [...entry.blockRequestIDs.values()].includes(response.requestID)
          if (!isCurrentParseRequest && !isCurrentBlockRequest) return
        }
        setError(entry, response.operation, response.message)
      }
    }
  }

  function startWorker(entry: DocumentCacheEntry, forcePreparing = false) {
    if (disposed || entry.worker) return
    if (forcePreparing || !entry.snapshot.manifest) {
      updateSnapshot(entry, {
        ...entry.snapshot,
        error: null,
        status: "preparing",
      })
    }

    entry.generation += 1
    const generation = entry.generation
    let worker: ThreadMarkdownWorkerPort
    try {
      worker = createWorker(entry.documentID)
    } catch (error) {
      setError(entry, "worker", error instanceof Error ? error.message : String(error))
      return
    }

    entry.worker = worker
    worker.onmessage = (event) => handleWorkerResponse(entry, worker, generation, event.data)
    worker.onerror = (event) => {
      if (entry.worker !== worker || entry.generation !== generation) return
      setError(entry, "worker", event.message || "Markdown worker failed.")
    }
    const requestID = nextRequestID(entry, "parse")
    entry.parseRequestID = requestID
    try {
      worker.postMessage({
        type: "parse",
        documentID: entry.documentID,
        requestID,
        text: entry.sourceText,
      })
    } catch (error) {
      setError(entry, "parse", error instanceof Error ? error.message : String(error))
    }
  }

  function findEntry(input: ThreadMarkdownDocumentInput) {
    return [...entries].find((entry) =>
      entry.documentID === input.documentID &&
      entry.pipelineVersion === input.pipelineVersion &&
      entry.sourceText === input.sourceText,
    )
  }

  function createEntry(input: ThreadMarkdownDocumentInput): DocumentCacheEntry {
    const entry: DocumentCacheEntry = {
      ...input,
      blockRequestIDs: new Map(),
      generation: 0,
      lastAccess: 0,
      listeners: new Set(),
      parseRequestID: null,
      referenceCount: 0,
      requestedBlockIndices: new Set(),
      snapshot: createPreparingSnapshot(),
      worker: null,
    }
    entries.add(entry)
    touch(entry)
    return entry
  }

  function acquireDocument(input: ThreadMarkdownDocumentInput): ThreadMarkdownDocumentResource {
    if (disposed) throw new Error("Thread Markdown worker client has been disposed.")
    if (!input.documentID) throw new Error("Markdown documentID is required.")

    const entry = findEntry(input) ?? createEntry(input)
    entry.referenceCount += 1
    touch(entry)
    if (entry.snapshot.status === "preparing" && !entry.worker) startWorker(entry)
    enforceCacheLimits()

    let released = false
    const ownedListeners = new Set<() => void>()

    return {
      getSnapshot() {
        return entry.snapshot
      },
      release() {
        if (released) return
        released = true
        ownedListeners.forEach((listener) => entry.listeners.delete(listener))
        ownedListeners.clear()
        entry.referenceCount = Math.max(0, entry.referenceCount - 1)
        touch(entry)
        if (entry.referenceCount === 0) {
          terminateWorker(entry, true)
          entry.requestedBlockIndices.clear()
          entry.blockRequestIDs.clear()
        }
        enforceCacheLimits()
      },
      requestBlock(blockIndex) {
        if (released) return
        if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) {
          throw new RangeError("Markdown block index must be a non-negative safe integer.")
        }
        if (entry.snapshot.manifest && !findBlockManifest(entry.snapshot.manifest, blockIndex)) {
          throw new RangeError(`Markdown block ${blockIndex} does not exist.`)
        }
        touch(entry)
        if (entry.snapshot.blocks.has(blockIndex)) return
        entry.requestedBlockIndices.add(blockIndex)
        if (entry.snapshot.status === "error") return
        if (!entry.worker) startWorker(entry)
        requestBlockFromWorker(entry, blockIndex)
      },
      retry() {
        if (released) return
        terminateWorker(entry, true)
        startWorker(entry, true)
      },
      subscribe(listener) {
        if (released) return () => {}
        const registeredListener = () => listener()
        entry.listeners.add(registeredListener)
        ownedListeners.add(registeredListener)
        return () => {
          entry.listeners.delete(registeredListener)
          ownedListeners.delete(registeredListener)
        }
      },
    }
  }

  return {
    acquireDocument,
    dispose() {
      if (disposed) return
      disposed = true
      entries.forEach((entry) => {
        terminateWorker(entry, true)
        entry.snapshot = {
          ...entry.snapshot,
          error: { message: "Thread Markdown worker client was disposed.", operation: "worker" },
          status: "error",
        }
        notify(entry)
        entry.listeners.clear()
      })
      entries.clear()
    },
  }
}
