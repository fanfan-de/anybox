import {
  memo,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ThreadMarkdown,
  createThreadMarkdownComponents,
  type ThreadMarkdownRenderContext,
} from "../thread-markdown"
import { buildBoundedMarkdownPreview } from "../thread-markdown-preview"
import {
  THREAD_COMPLETED_MARKDOWN_AUTO_CHARACTER_LIMIT,
  THREAD_COMPLETED_MARKDOWN_SYNC_CHARACTER_LIMIT,
  THREAD_MARKDOWN_PIPELINE_VERSION,
  type MarkdownBlockManifest,
} from "../thread-markdown-worker-protocol"
import { ThreadMarkdownHastBlock } from "./ThreadMarkdownHastBlock"
import {
  createThreadMarkdownWorkerClient,
  type ThreadMarkdownDocumentResource,
  type ThreadMarkdownDocumentSnapshot,
  type ThreadMarkdownWorkerClient,
  type ThreadMarkdownWorkerPort,
} from "./thread-markdown-worker-client"

export interface CompletedThreadMarkdownProps extends ThreadMarkdownRenderContext {
  className?: string
  documentID: string
  text: string
  workerClient?: ThreadMarkdownWorkerClient
}

interface AcquiredMarkdownResource {
  generation: number
  resource: ThreadMarkdownDocumentResource
  sourceText: string
}

function createBrowserMarkdownWorker(): ThreadMarkdownWorkerPort {
  if (typeof Worker === "undefined") {
    throw new Error("Markdown Worker is unavailable in this renderer.")
  }

  return new Worker(
    new URL("../thread-markdown.worker.ts", import.meta.url),
    { name: "anybox-thread-markdown", type: "module" },
  ) as unknown as ThreadMarkdownWorkerPort
}

const defaultThreadMarkdownWorkerClient = createThreadMarkdownWorkerClient({
  createWorker: createBrowserMarkdownWorker,
})

function scheduleMarkdownBlockRequest(callback: () => void) {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    const idleID = window.requestIdleCallback(callback, { timeout: 120 })
    return () => window.cancelIdleCallback(idleID)
  }

  const timeoutID = window.setTimeout(callback, 16)
  return () => window.clearTimeout(timeoutID)
}

function CompletedMarkdownPreview({
  actionLabel,
  busy = false,
  className,
  mode,
  onAction,
  status,
  text,
}: {
  actionLabel?: string
  busy?: boolean
  className?: string
  mode: "error-preview" | "large-preview" | "preparing-preview"
  onAction?: () => void
  status: string
  text: string
}) {
  return (
    <div
      aria-busy={busy || undefined}
      className={className}
      data-thread-completed-markdown-render-mode={mode}
    >
      <div className="thread-markdown-plain-preview">
        {buildBoundedMarkdownPreview(text)}
      </div>
      <div className="thread-markdown-deferred-footer">
        <span className="thread-markdown-deferred-status" role="status">{status}</span>
        {actionLabel && onAction ? (
          <button
            className="thread-markdown-deferred-button"
            type="button"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function OversizedMarkdownBlock({
  block,
  onRender,
}: {
  block: MarkdownBlockManifest
  onRender: () => void
}) {
  return (
    <section
      className="thread-markdown-deferred-block"
      data-thread-markdown-block-index={block.index}
      data-thread-markdown-block-mode="oversized-preview"
    >
      <div className="thread-markdown-plain-preview">
        {block.previewText || "这个 Markdown 内容块过大，已暂缓格式化。"}
      </div>
      <div className="thread-markdown-deferred-footer">
        <span className="thread-markdown-deferred-status">
          这个内容块较大，完整格式化可能暂时占用更多资源。
        </span>
        <button className="thread-markdown-deferred-button" type="button" onClick={onRender}>
          渲染完整格式
        </button>
      </div>
    </section>
  )
}

function useMarkdownResourceSnapshot(resource: ThreadMarkdownDocumentResource) {
  const [snapshot, setSnapshot] = useState<ThreadMarkdownDocumentSnapshot>(() => resource.getSnapshot())

  useEffect(() => {
    setSnapshot(resource.getSnapshot())
    return resource.subscribe(() => {
      startTransition(() => setSnapshot(resource.getSnapshot()))
    })
  }, [resource])

  return snapshot
}

function ThreadMarkdownDocumentResourceView({
  className,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  resolveImageSrc,
  resolveLinkTarget,
  resource,
  text,
}: Omit<CompletedThreadMarkdownProps, "documentID" | "workerClient"> & {
  resource: ThreadMarkdownDocumentResource
}) {
  const snapshot = useMarkdownResourceSnapshot(resource)
  const [forcedBlockIndices, setForcedBlockIndices] = useState<ReadonlySet<number>>(() => new Set())
  const components = useMemo(() => createThreadMarkdownComponents({
    onArtifactLinkOpen,
    onLocalFileLinkOpen,
    resolveImageSrc,
    resolveLinkTarget,
  }), [onArtifactLinkOpen, onLocalFileLinkOpen, resolveImageSrc, resolveLinkTarget])

  useEffect(() => {
    setForcedBlockIndices(new Set())
  }, [resource])

  useEffect(() => {
    const manifest = snapshot.manifest
    if (snapshot.status !== "ready" || !manifest || manifest.blocks.length === 0) return

    const requestableBlocks = manifest.blocks.filter((block) =>
      !block.oversized || forcedBlockIndices.has(block.index),
    )
    const firstBlock = requestableBlocks[0]
    const lastBlock = requestableBlocks[requestableBlocks.length - 1]
    if (firstBlock && !snapshot.blocks.has(firstBlock.index)) resource.requestBlock(firstBlock.index)
    if (
      lastBlock &&
      lastBlock.index !== firstBlock?.index &&
      !snapshot.blocks.has(lastBlock.index)
    ) {
      resource.requestBlock(lastBlock.index)
    }

    const middleBlock = requestableBlocks.find((block) =>
      block.index !== firstBlock?.index &&
      block.index !== lastBlock?.index &&
      !snapshot.blocks.has(block.index),
    )
    if (!middleBlock) return
    return scheduleMarkdownBlockRequest(() => resource.requestBlock(middleBlock.index))
  }, [forcedBlockIndices, resource, snapshot.blocks, snapshot.manifest, snapshot.status])

  if (snapshot.status === "error") {
    return (
      <CompletedMarkdownPreview
        actionLabel="重试排版"
        className={className}
        mode="error-preview"
        onAction={resource.retry}
        status="完整格式排版失败，当前保留轻量预览。"
        text={text}
      />
    )
  }

  if (
    !snapshot.manifest ||
    (
      snapshot.blocks.size === 0 &&
      !snapshot.manifest.blocks.some((block) => block.oversized)
    )
  ) {
    return (
      <CompletedMarkdownPreview
        busy
        className={className}
        mode="preparing-preview"
        status="正在排版完整回复…"
        text={text}
      />
    )
  }

  const pendingAutomaticBlockCount = snapshot.manifest.blocks.filter((block) =>
    (!block.oversized || forcedBlockIndices.has(block.index)) && !snapshot.blocks.has(block.index),
  ).length

  return (
    <div
      aria-busy={pendingAutomaticBlockCount > 0 || undefined}
      className={className}
      data-thread-completed-markdown-render-mode="segmented-hast"
    >
      {pendingAutomaticBlockCount > 0 ? (
        <span className="thread-markdown-progress-status" role="status">
          正在排版完整回复…
        </span>
      ) : null}
      {snapshot.manifest.blocks.map((block) => {
        const root = snapshot.blocks.get(block.index)
        if (root) {
          return <ThreadMarkdownHastBlock components={components} key={block.id} root={root} />
        }
        if (!block.oversized || forcedBlockIndices.has(block.index)) return null

        return (
          <OversizedMarkdownBlock
            block={block}
            key={block.id}
            onRender={() => {
              setForcedBlockIndices((current) => new Set(current).add(block.index))
            }}
          />
        )
      })}
    </div>
  )
}

function WorkerCompletedThreadMarkdown({
  className,
  documentID,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  resolveImageSrc,
  resolveLinkTarget,
  text,
  workerClient = defaultThreadMarkdownWorkerClient,
}: CompletedThreadMarkdownProps) {
  const generationRef = useRef(0)
  const [acquiredResource, setAcquiredResource] = useState<AcquiredMarkdownResource | null>(null)

  useEffect(() => {
    generationRef.current += 1
    const generation = generationRef.current
    const resource = workerClient.acquireDocument({
      documentID,
      pipelineVersion: THREAD_MARKDOWN_PIPELINE_VERSION,
      sourceText: text,
    })
    setAcquiredResource({ generation, resource, sourceText: text })

    return () => resource.release()
  }, [documentID, text, workerClient])

  if (!acquiredResource || acquiredResource.sourceText !== text) {
    return (
      <CompletedMarkdownPreview
        busy
        className={className}
        mode="preparing-preview"
        status="正在准备完整回复…"
        text={text}
      />
    )
  }

  return (
    <ThreadMarkdownDocumentResourceView
      key={acquiredResource.generation}
      className={className}
      onArtifactLinkOpen={onArtifactLinkOpen}
      onLocalFileLinkOpen={onLocalFileLinkOpen}
      resolveImageSrc={resolveImageSrc}
      resolveLinkTarget={resolveLinkTarget}
      resource={acquiredResource.resource}
      text={text}
    />
  )
}

const LargeCompletedThreadMarkdown = memo(function LargeCompletedThreadMarkdown(
  props: CompletedThreadMarkdownProps,
) {
  const [explicitRequest, setExplicitRequest] = useState<{
    documentID: string
    text: string
  } | null>(null)
  const isExplicitlyRequested =
    explicitRequest?.documentID === props.documentID && explicitRequest.text === props.text

  if (
    props.text.length > THREAD_COMPLETED_MARKDOWN_AUTO_CHARACTER_LIMIT &&
    !isExplicitlyRequested
  ) {
    return (
      <CompletedMarkdownPreview
        actionLabel="渲染完整格式"
        className={props.className}
        mode="large-preview"
        onAction={() => setExplicitRequest({ documentID: props.documentID, text: props.text })}
        status="这条回复很长，当前使用轻量预览以保持界面流畅。"
        text={props.text}
      />
    )
  }

  return <WorkerCompletedThreadMarkdown {...props} />
})

export const CompletedThreadMarkdown = memo(function CompletedThreadMarkdown(
  props: CompletedThreadMarkdownProps,
) {
  if (props.text.length <= THREAD_COMPLETED_MARKDOWN_SYNC_CHARACTER_LIMIT) {
    return (
      <ThreadMarkdown
        className={props.className}
        onArtifactLinkOpen={props.onArtifactLinkOpen}
        onLocalFileLinkOpen={props.onLocalFileLinkOpen}
        resolveImageSrc={props.resolveImageSrc}
        resolveLinkTarget={props.resolveLinkTarget}
        text={props.text}
      />
    )
  }

  return <LargeCompletedThreadMarkdown {...props} />
})
