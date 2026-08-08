import { memo } from "react"
import {
  ThreadMarkdown,
  type MarkdownArtifactLinkTarget,
  type MarkdownLocalFileLinkTarget,
} from "../thread-markdown"
import {
  THREAD_MARKDOWN_PREVIEW_CHARACTER_LIMIT,
  THREAD_MARKDOWN_PREVIEW_HEAD_CHARACTER_LIMIT,
  THREAD_STREAMING_MARKDOWN_PREVIEW_OMISSION_MARKER,
  buildBoundedMarkdownPreview,
} from "../thread-markdown-preview"

export const THREAD_STREAMING_MARKDOWN_FULL_RENDER_CHARACTER_LIMIT = 16_000
export const THREAD_STREAMING_MARKDOWN_PREVIEW_CHARACTER_LIMIT = THREAD_MARKDOWN_PREVIEW_CHARACTER_LIMIT
export const THREAD_STREAMING_MARKDOWN_PREVIEW_HEAD_CHARACTER_LIMIT = THREAD_MARKDOWN_PREVIEW_HEAD_CHARACTER_LIMIT
export { THREAD_STREAMING_MARKDOWN_PREVIEW_OMISSION_MARKER }

export interface SizeAwareStreamingMarkdownProps {
  className?: string
  isStreaming: boolean
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  resolveImageSrc?: (src: string) => string | null
  text: string
}

export function shouldRenderFullStreamingMarkdown(text: string, isStreaming: boolean) {
  return !isStreaming || text.length <= THREAD_STREAMING_MARKDOWN_FULL_RENDER_CHARACTER_LIMIT
}

export function buildBoundedStreamingMarkdownPreview(text: string) {
  return buildBoundedMarkdownPreview(text, {
    omissionMarker: THREAD_STREAMING_MARKDOWN_PREVIEW_OMISSION_MARKER,
  })
}

export const SizeAwareStreamingMarkdown = memo(function SizeAwareStreamingMarkdown({
  className,
  isStreaming,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  resolveImageSrc,
  text,
}: SizeAwareStreamingMarkdownProps) {
  if (shouldRenderFullStreamingMarkdown(text, isStreaming)) {
    return (
      <ThreadMarkdown
        className={className}
        onArtifactLinkOpen={onArtifactLinkOpen}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
        resolveImageSrc={resolveImageSrc}
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
