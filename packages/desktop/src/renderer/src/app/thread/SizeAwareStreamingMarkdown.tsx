import { memo } from "react"
import {
  ThreadMarkdown,
  type MarkdownArtifactLinkTarget,
  type MarkdownLocalFileLinkTarget,
} from "../thread-markdown"

export const THREAD_STREAMING_MARKDOWN_FULL_RENDER_CHARACTER_LIMIT = 16_000
export const THREAD_STREAMING_MARKDOWN_PREVIEW_CHARACTER_LIMIT = 12_000
export const THREAD_STREAMING_MARKDOWN_PREVIEW_HEAD_CHARACTER_LIMIT = 4_000
export const THREAD_STREAMING_MARKDOWN_PREVIEW_OMISSION_MARKER =
  "\n\n… Earlier live response content omitted …\n\n"

export interface SizeAwareStreamingMarkdownProps {
  className?: string
  isStreaming: boolean
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  text: string
}

function isHighSurrogate(codeUnit: number) {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff
}

function isLowSurrogate(codeUnit: number) {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff
}

function avoidSplittingSurrogatePairAtEnd(text: string, endIndex: number) {
  if (endIndex <= 0 || endIndex >= text.length) return endIndex

  return isHighSurrogate(text.charCodeAt(endIndex - 1)) && isLowSurrogate(text.charCodeAt(endIndex))
    ? endIndex - 1
    : endIndex
}

function avoidSplittingSurrogatePairAtStart(text: string, startIndex: number) {
  if (startIndex <= 0 || startIndex >= text.length) return startIndex

  return isHighSurrogate(text.charCodeAt(startIndex - 1)) && isLowSurrogate(text.charCodeAt(startIndex))
    ? startIndex + 1
    : startIndex
}

export function shouldRenderFullStreamingMarkdown(text: string, isStreaming: boolean) {
  return !isStreaming || text.length <= THREAD_STREAMING_MARKDOWN_FULL_RENDER_CHARACTER_LIMIT
}

export function buildBoundedStreamingMarkdownPreview(text: string) {
  if (text.length <= THREAD_STREAMING_MARKDOWN_PREVIEW_CHARACTER_LIMIT) return text

  const marker = THREAD_STREAMING_MARKDOWN_PREVIEW_OMISSION_MARKER
  const contentCharacterBudget = Math.max(
    0,
    THREAD_STREAMING_MARKDOWN_PREVIEW_CHARACTER_LIMIT - marker.length,
  )
  const headCharacterBudget = Math.min(
    THREAD_STREAMING_MARKDOWN_PREVIEW_HEAD_CHARACTER_LIMIT,
    Math.floor(contentCharacterBudget / 2),
  )
  const tailCharacterBudget = contentCharacterBudget - headCharacterBudget
  const headEndIndex = avoidSplittingSurrogatePairAtEnd(text, headCharacterBudget)
  const tailStartIndex = avoidSplittingSurrogatePairAtStart(
    text,
    Math.max(headEndIndex, text.length - tailCharacterBudget),
  )

  return `${text.slice(0, headEndIndex)}${marker}${text.slice(tailStartIndex)}`
}

export const SizeAwareStreamingMarkdown = memo(function SizeAwareStreamingMarkdown({
  className,
  isStreaming,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  text,
}: SizeAwareStreamingMarkdownProps) {
  if (shouldRenderFullStreamingMarkdown(text, isStreaming)) {
    return (
      <ThreadMarkdown
        className={className}
        onArtifactLinkOpen={onArtifactLinkOpen}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
        text={text}
      />
    )
  }

  return (
    <div
      className={className}
      data-thread-streaming-render-mode="plain-preview"
      style={{ whiteSpace: "pre-wrap" }}
    >
      {buildBoundedStreamingMarkdownPreview(text)}
    </div>
  )
})
