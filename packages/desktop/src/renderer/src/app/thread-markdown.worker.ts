import { parseThreadMarkdownDocument, type ParsedThreadMarkdownDocument } from "./thread-markdown-parser"
import {
  isMarkdownWorkerRequest,
  type MarkdownWorkerResponse,
} from "./thread-markdown-worker-protocol"

interface MarkdownWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: MarkdownWorkerResponse): void
}

const workerScope = self as unknown as MarkdownWorkerScope
const documents = new Map<string, ParsedThreadMarkdownDocument>()

function postError({
  blockIndex,
  documentID,
  error,
  operation,
  requestID,
}: {
  blockIndex?: number
  documentID?: string
  error: unknown
  operation: "load-block" | "parse"
  requestID?: string
}) {
  workerScope.postMessage({
    blockIndex,
    documentID,
    message: error instanceof Error ? error.message : String(error),
    operation,
    requestID,
    type: "error",
  })
}

workerScope.onmessage = (event) => {
  if (!isMarkdownWorkerRequest(event.data)) {
    postError({ error: "Invalid Markdown worker request.", operation: "parse" })
    return
  }

  const request = event.data
  if (request.type === "dispose") {
    documents.delete(request.documentID)
    return
  }

  if (request.type === "parse") {
    try {
      const document = parseThreadMarkdownDocument(request.documentID, request.text)
      documents.set(request.documentID, document)
      workerScope.postMessage({
        documentID: request.documentID,
        manifest: document.manifest,
        requestID: request.requestID,
        type: "document-ready",
      })
    } catch (error) {
      documents.delete(request.documentID)
      postError({
        documentID: request.documentID,
        error,
        operation: "parse",
        requestID: request.requestID,
      })
    }
    return
  }

  const document = documents.get(request.documentID)
  const block = document?.blocks[request.blockIndex]
  if (!document || !block) {
    postError({
      blockIndex: request.blockIndex,
      documentID: request.documentID,
      error: `Markdown block ${request.blockIndex} is unavailable.`,
      operation: "load-block",
      requestID: request.requestID,
    })
    return
  }

  workerScope.postMessage({
    block,
    blockIndex: request.blockIndex,
    documentID: request.documentID,
    requestID: request.requestID,
    type: "block-ready",
  })
}
