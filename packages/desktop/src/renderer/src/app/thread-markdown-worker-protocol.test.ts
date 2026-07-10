import { describe, expect, it } from "vitest"
import {
  THREAD_MARKDOWN_PIPELINE_VERSION,
  isMarkdownWorkerRequest,
  isMarkdownWorkerResponse,
  type MarkdownDocumentManifest,
} from "./thread-markdown-worker-protocol"

function createManifest(): MarkdownDocumentManifest {
  return {
    blocks: [
      {
        atomic: false,
        characterCount: 12,
        id: "block:0",
        index: 0,
        nodeCount: 3,
        oversized: false,
        previewText: "Hello world",
      },
    ],
    characterCount: 12,
    documentID: "document-1",
    nodeCount: 3,
    parseMilliseconds: 1.5,
    pipelineVersion: THREAD_MARKDOWN_PIPELINE_VERSION,
  }
}

describe("thread Markdown worker protocol guards", () => {
  it("accepts every valid request variant", () => {
    expect(isMarkdownWorkerRequest({
      type: "parse",
      documentID: "document-1",
      requestID: "request-1",
      text: "",
    })).toBe(true)
    expect(isMarkdownWorkerRequest({
      type: "load-block",
      blockIndex: 0,
      documentID: "document-1",
      requestID: "request-2",
    })).toBe(true)
    expect(isMarkdownWorkerRequest({
      type: "dispose",
      documentID: "document-1",
    })).toBe(true)
  })

  it.each([
    null,
    "parse",
    {},
    { type: "unknown" },
    { type: "parse", documentID: "", requestID: "request-1", text: "text" },
    { type: "parse", documentID: "document-1", requestID: "", text: "text" },
    { type: "parse", documentID: "document-1", requestID: "request-1", text: 1 },
    { type: "load-block", blockIndex: -1, documentID: "document-1", requestID: "request-1" },
    { type: "load-block", blockIndex: 1.5, documentID: "document-1", requestID: "request-1" },
    { type: "load-block", blockIndex: 0, documentID: "", requestID: "request-1" },
    { type: "dispose", documentID: "" },
  ])("rejects malformed requests: %j", (request) => {
    expect(isMarkdownWorkerRequest(request)).toBe(false)
  })

  it("accepts every valid response variant", () => {
    expect(isMarkdownWorkerResponse({
      type: "document-ready",
      documentID: "document-1",
      manifest: createManifest(),
      requestID: "request-1",
    })).toBe(true)
    expect(isMarkdownWorkerResponse({
      type: "block-ready",
      block: {
        type: "root",
        children: [{ type: "text", value: "Hello" }],
      },
      blockIndex: 0,
      documentID: "document-1",
      requestID: "request-2",
    })).toBe(true)
    expect(isMarkdownWorkerResponse({
      type: "error",
      blockIndex: 0,
      documentID: "document-1",
      message: "Unable to parse",
      operation: "load-block",
      requestID: "request-3",
    })).toBe(true)
    expect(isMarkdownWorkerResponse({
      type: "error",
      message: "Worker crashed",
      operation: "worker",
    })).toBe(true)
  })

  it.each([
    null,
    "document-ready",
    {},
    { type: "unknown" },
    { type: "document-ready", documentID: "", manifest: createManifest(), requestID: "request-1" },
    { type: "document-ready", documentID: "document-1", manifest: {}, requestID: "request-1" },
    {
      type: "document-ready",
      documentID: "document-1",
      manifest: { ...createManifest(), pipelineVersion: "" },
      requestID: "request-1",
    },
    {
      type: "document-ready",
      documentID: "document-1",
      manifest: {
        ...createManifest(),
        blocks: [{ ...createManifest().blocks[0], index: -1 }],
      },
      requestID: "request-1",
    },
    {
      type: "block-ready",
      block: { type: "element", children: [] },
      blockIndex: 0,
      documentID: "document-1",
      requestID: "request-1",
    },
    {
      type: "block-ready",
      block: { type: "root", children: [] },
      blockIndex: -1,
      documentID: "document-1",
      requestID: "request-1",
    },
    { type: "error", message: 1, operation: "worker" },
    { type: "error", message: "bad", operation: "unknown" },
    { type: "error", blockIndex: -1, message: "bad", operation: "load-block" },
    { type: "error", documentID: "", message: "bad", operation: "parse" },
    { type: "error", message: "bad", operation: "worker", requestID: "" },
  ])("rejects malformed responses: %j", (response) => {
    expect(isMarkdownWorkerResponse(response)).toBe(false)
  })
})
