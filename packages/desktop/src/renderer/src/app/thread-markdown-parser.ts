import type { Nodes, Root, RootContent } from "hast"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"
import { normalizeLooseLocalFileMarkdownLinks } from "./thread-markdown-normalize"
import {
  THREAD_COMPLETED_MARKDOWN_PREVIEW_OMISSION_MARKER,
  buildBoundedMarkdownPreview,
} from "./thread-markdown-preview"
import {
  THREAD_MARKDOWN_BLOCK_TARGET_CHARACTER_COUNT,
  THREAD_MARKDOWN_OVERSIZED_BLOCK_CHARACTER_COUNT,
  THREAD_MARKDOWN_OVERSIZED_BLOCK_NODE_COUNT,
  THREAD_MARKDOWN_PIPELINE_VERSION,
  type MarkdownBlockManifest,
  type MarkdownDocumentManifest,
  type MarkdownHastRoot,
} from "./thread-markdown-worker-protocol"

export interface ParsedThreadMarkdownDocument {
  blocks: MarkdownHastRoot[]
  manifest: MarkdownDocumentManifest
}

interface MarkdownHastBlockGroup {
  children: RootContent[]
  characterCount: number
  endOffset: number | null
  startOffset: number | null
}

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)

function isWhitespaceTextNode(node: RootContent) {
  return node.type === "text" && /^\s*$/.test(node.value)
}

function countHastNodes(node: Nodes): number {
  let count = 1
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) count += countHastNodes(child)
  }
  return count
}

function collectHastText(node: Nodes): string {
  if (node.type === "text") return node.value
  if (!("children" in node) || !Array.isArray(node.children)) return ""
  return node.children.map(collectHastText).join("")
}

function readNodeOffsets(node: RootContent) {
  const startOffset = node.position?.start.offset
  const endOffset = node.position?.end.offset
  return {
    endOffset: Number.isSafeInteger(endOffset) ? endOffset ?? null : null,
    startOffset: Number.isSafeInteger(startOffset) ? startOffset ?? null : null,
  }
}

function estimateNodeCharacterCount(node: RootContent) {
  const { endOffset, startOffset } = readNodeOffsets(node)
  if (startOffset !== null && endOffset !== null && endOffset >= startOffset) {
    return endOffset - startOffset
  }
  return collectHastText(node).length
}

function groupTopLevelHastChildren(root: Root): MarkdownHastBlockGroup[] {
  const groups: MarkdownHastBlockGroup[] = []
  let currentChildren: RootContent[] = []
  let currentCharacterCount = 0
  let currentStartOffset: number | null = null
  let currentEndOffset: number | null = null

  function flush() {
    if (currentChildren.length === 0) return
    const positionedCharacterCount = currentStartOffset !== null && currentEndOffset !== null
      ? Math.max(0, currentEndOffset - currentStartOffset)
      : 0
    groups.push({
      children: currentChildren,
      characterCount: Math.max(currentCharacterCount, positionedCharacterCount),
      endOffset: currentEndOffset,
      startOffset: currentStartOffset,
    })
    currentChildren = []
    currentCharacterCount = 0
    currentStartOffset = null
    currentEndOffset = null
  }

  for (const child of root.children) {
    const characterCount = estimateNodeCharacterCount(child)
    const hasSubstantiveChild = currentChildren.some((candidate) => !isWhitespaceTextNode(candidate))
    if (
      !isWhitespaceTextNode(child) &&
      hasSubstantiveChild &&
      currentCharacterCount + characterCount > THREAD_MARKDOWN_BLOCK_TARGET_CHARACTER_COUNT
    ) {
      flush()
    }

    currentChildren.push(child)
    currentCharacterCount += characterCount
    const { endOffset, startOffset } = readNodeOffsets(child)
    if (startOffset !== null) {
      currentStartOffset = currentStartOffset === null ? startOffset : Math.min(currentStartOffset, startOffset)
    }
    if (endOffset !== null) {
      currentEndOffset = currentEndOffset === null ? endOffset : Math.max(currentEndOffset, endOffset)
    }
  }
  flush()
  return groups
}

function hashBlockIdentity(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function stripHastPositions(node: Nodes) {
  if ("position" in node) delete node.position
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) stripHastPositions(child)
  }
}

function buildBlock(
  group: MarkdownHastBlockGroup,
  index: number,
  normalizedText: string,
): { manifest: MarkdownBlockManifest; root: MarkdownHastRoot } {
  const root: MarkdownHastRoot = { type: "root", children: group.children }
  const nodeCount = countHastNodes(root)
  const substantiveChildren = group.children.filter((child) => !isWhitespaceTextNode(child))
  const sourceText = group.startOffset !== null && group.endOffset !== null
    ? normalizedText.slice(group.startOffset, group.endOffset)
    : collectHastText(root)
  const characterCount = Math.max(group.characterCount, sourceText.length)
  const previewText = buildBoundedMarkdownPreview(collectHastText(root) || sourceText, {
    omissionMarker: THREAD_COMPLETED_MARKDOWN_PREVIEW_OMISSION_MARKER,
  })
  const identityHash = hashBlockIdentity(sourceText || previewText || `${index}:${nodeCount}`)
  const startLabel = group.startOffset ?? "generated"
  const endLabel = group.endOffset ?? "generated"

  stripHastPositions(root)
  return {
    manifest: {
      atomic: substantiveChildren.length <= 1,
      characterCount,
      id: `block:${index}:${startLabel}:${endLabel}:${identityHash}`,
      index,
      nodeCount,
      oversized:
        nodeCount > THREAD_MARKDOWN_OVERSIZED_BLOCK_NODE_COUNT ||
        characterCount > THREAD_MARKDOWN_OVERSIZED_BLOCK_CHARACTER_COUNT,
      previewText,
    },
    root,
  }
}

export function parseThreadMarkdownDocument(
  documentID: string,
  text: string,
): ParsedThreadMarkdownDocument {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now()
  const normalizedText = normalizeLooseLocalFileMarkdownLinks(text)
  const parsedTree = markdownProcessor.parse(normalizedText)
  const hastRoot = markdownProcessor.runSync(parsedTree) as Root
  const parsedBlocks = groupTopLevelHastChildren(hastRoot).map((group, index) =>
    buildBlock(group, index, normalizedText),
  )
  const parseMilliseconds = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt
  const blocks = parsedBlocks.map((block) => block.root)
  const blockManifests = parsedBlocks.map((block) => block.manifest)

  return {
    blocks,
    manifest: {
      blocks: blockManifests,
      characterCount: text.length,
      documentID,
      nodeCount: blockManifests.reduce((total, block) => total + block.nodeCount, 0),
      parseMilliseconds,
      pipelineVersion: THREAD_MARKDOWN_PIPELINE_VERSION,
    },
  }
}
