import { memo, useMemo, type ComponentType, type ReactNode } from "react"
import { CopyIcon, ForkIcon, SideChatIcon } from "../icons"
import { joinClassNames } from "../shared-ui"
import type { SessionMessageBranchOption } from "../session-message-tree"
import type { MarkdownArtifactLinkTarget, MarkdownLocalFileLinkTarget } from "../thread-markdown"
import type {
  AssistantTraceFileChange,
  AssistantTraceItem,
  AssistantTraceSectionKey,
  AssistantTraceVisibility,
  AssistantThreadMessage,
  PermissionDecision,
  PermissionRequest,
  SessionDiffFile,
  SessionDiffSummary,
  SessionSummary,
  ThreadMessage,
  UserThreadMessage,
} from "../types"
import {
  permissionRequestMatchesApprovalTraceItem,
  shouldRenderDiffOnStandaloneUserMessage,
  traceSectionTitle,
  type AssistantActionsRow,
  type AssistantDiffCardRow,
  type AssistantEphemeralStateRow,
  type AssistantFileChangeRow,
  type AssistantInsertedUserMessageRow,
  type AssistantTraceItemRow,
  type AssistantTraceItemRowKind,
  type AssistantTraceRowItem,
  type PermissionRequestRow,
  type ThreadDisplayRow,
  type UserMessageRow,
} from "./thread-display-rows"

type AssistantTraceResponseRowKind = Extract<AssistantTraceItemRowKind, "assistant-response-row" | "assistant-question-row">
type AssistantTraceLiteRowKind = Exclude<AssistantTraceItemRowKind, "assistant-response-row" | "assistant-question-row">
export type AssistantTraceRenderableRow = AssistantTraceItemRow | AssistantFileChangeRow
type AssistantTraceSectionRow = AssistantFileChangeRow | (AssistantTraceItemRow & { kind: AssistantTraceResponseRowKind })
type AssistantTraceLiteRow = AssistantTraceItemRow & { kind: AssistantTraceLiteRowKind }

export type ProposedPlanConfirmHandler = (input: { planMarkdown: string }) => void | Promise<void>
export type ThreadMessageMotion = "history" | "new" | "live"

export type PermissionRequestResponseHandler = (input: {
  sessionID: string
  request: PermissionRequest
  decision: PermissionDecision
  note?: string
}) => void | Promise<void>

export type QuestionAnswerHandler = (input: {
  text: string
  questionID?: string
  sessionID?: string | null
  selectedOptions?: string[]
  freeformText?: string
}) => void | Promise<void>

export interface ImagePreviewPayload {
  src: string
  alt: string
  width?: number
  height?: number
  mimeType?: string
  triggerElement?: HTMLButtonElement | null
}

export interface TraceRowItemRenderInput {
  isQuestionAnswerDisabled: boolean
  isQuestionAnswered: boolean
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onAskUserQuestionAnswer?: QuestionAnswerHandler
  onFileChangeSelect?: (file: string) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  onOpenImagePreview?: (payload: ImagePreviewPayload) => void
  onProposedPlanConfirm?: ProposedPlanConfirmHandler
  row: AssistantTraceRenderableRow
  traceItem: AssistantTraceRowItem
  traceVisibility: AssistantTraceVisibility
}

export interface UserThreadMessageArticleRendererProps {
  className?: string
  copied: boolean
  diffCard?: ReactNode
  message: UserThreadMessage
  motion: ThreadMessageMotion
  onCopy: (messageID: string, text: string) => void | Promise<void>
  rowKind?: string
}

export interface MessageDiffCardRendererProps {
  activeSessionDiff?: SessionDiffSummary | null
  allowWorkspaceDiffFallback?: boolean
  diffSummary?: SessionDiffSummary
  messageID: string
  onFileChangeSelect?: (file: string) => void
  onMessageDiffRestore?: (diffs: SessionDiffFile[]) => void | Promise<void>
  onMessageDiffReview?: (files: string[]) => void | Promise<void>
  onMessageDiffSummaryHydrate?: (messageID: string, diffSummary: SessionDiffSummary) => void | Promise<void>
  patchSourceFileChanges?: AssistantTraceFileChange[]
}

export interface PermissionRequestInlinePromptRendererProps {
  activeSession: SessionSummary | null
  isResolvingPermissionRequest: boolean
  pendingPermissionRequests: PermissionRequest[]
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  motion: ThreadMessageMotion
  onPermissionRequestResponse: PermissionRequestResponseHandler
}

export interface PermissionRequestCardRendererProps {
  activeSession: SessionSummary
  actionError: string | null
  isResolving: boolean
  queueCount?: number
  request: PermissionRequest
  onRespond: PermissionRequestResponseHandler
}

export interface BranchSwitcherRendererProps {
  onSelect?: (messageID: string) => void | Promise<void>
  options: SessionMessageBranchOption[]
}

export interface ThreadRowRendererComponents {
  AssistantMessagePlaceholder: ComponentType<{ message: string }>
  AssistantTraceSection: ComponentType<{
    children: ReactNode
    sectionKey: AssistantTraceSectionKey
    title: string
  }>
  BranchSwitcher: ComponentType<BranchSwitcherRendererProps>
  MessageDiffCard: ComponentType<MessageDiffCardRendererProps>
  PermissionRequestCard: ComponentType<PermissionRequestCardRendererProps>
  PermissionRequestInlinePrompt: ComponentType<PermissionRequestInlinePromptRendererProps>
  UserThreadMessageArticle: ComponentType<UserThreadMessageArticleRendererProps>
  collectAssistantPatchFileChanges: (assistantMessage: AssistantThreadMessage | null) => AssistantTraceFileChange[]
  getAssistantTraceBlockStackClassName: (sectionKey: AssistantTraceSectionKey) => string
  renderTraceItemForRow: (input: TraceRowItemRenderInput) => ReactNode
}

interface TraceRowViewSharedProps {
  components: ThreadRowRendererComponents
  isQuestionAnswerDisabled: boolean
  isQuestionAnswered: boolean
  motion: ThreadMessageMotion
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onAskUserQuestionAnswer?: QuestionAnswerHandler
  onFileChangeSelect?: (file: string) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  onOpenImagePreview?: (payload: ImagePreviewPayload) => void
  onProposedPlanConfirm?: ProposedPlanConfirmHandler
  traceVisibility: AssistantTraceVisibility
}

interface UserDisplayRowViewProps {
  activeSessionDiff?: SessionDiffSummary | null
  allowWorkspaceDiffFallback: boolean
  components: ThreadRowRendererComponents
  copied: boolean
  motion: ThreadMessageMotion
  onCopy: (messageID: string, text: string) => void | Promise<void>
  onFileChangeSelect?: (file: string) => void
  onMessageDiffRestore?: (diffs: SessionDiffFile[]) => void | Promise<void>
  onMessageDiffReview?: (files: string[]) => void | Promise<void>
  onMessageDiffSummaryHydrate?: (messageID: string, diffSummary: SessionDiffSummary) => void | Promise<void>
  row: UserMessageRow
  showDiffCard: boolean
}

interface PermissionRequestRowViewProps {
  activeSession: SessionSummary | null
  components: ThreadRowRendererComponents
  isResolvingPermissionRequest: boolean
  motion: ThreadMessageMotion
  onPermissionRequestResponse: PermissionRequestResponseHandler
  pendingPermissionRequests: PermissionRequest[]
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  row: PermissionRequestRow
}

interface AssistantTraceSectionRowViewProps extends TraceRowViewSharedProps {
  row: AssistantTraceSectionRow
}

interface AssistantTraceLiteRowViewProps extends TraceRowViewSharedProps {
  activeSession: SessionSummary | null
  isResolvingPermissionRequest: boolean
  onPermissionRequestResponse: PermissionRequestResponseHandler
  pendingPermissionRequest: PermissionRequest | null
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  row: AssistantTraceLiteRow
}

interface AssistantEphemeralRowViewProps {
  components: ThreadRowRendererComponents
  motion: ThreadMessageMotion
  row: AssistantEphemeralStateRow
}

interface AssistantInsertedUserRowViewProps {
  components: ThreadRowRendererComponents
  copied: boolean
  motion: ThreadMessageMotion
  onCopy: (messageID: string, text: string) => void | Promise<void>
  row: AssistantInsertedUserMessageRow
}

interface AssistantDiffRowViewProps {
  activeSessionDiff?: SessionDiffSummary | null
  components: ThreadRowRendererComponents
  motion: ThreadMessageMotion
  onFileChangeSelect?: (file: string) => void
  onMessageDiffRestore?: (diffs: SessionDiffFile[]) => void | Promise<void>
  onMessageDiffReview?: (files: string[]) => void | Promise<void>
  onMessageDiffSummaryHydrate?: (messageID: string, diffSummary: SessionDiffSummary) => void | Promise<void>
  row: AssistantDiffCardRow
}

interface AssistantActionsRowViewProps {
  components: ThreadRowRendererComponents
  copied: boolean
  motion: ThreadMessageMotion
  onBranchSelect?: (messageID: string) => void | Promise<void>
  onCopyAssistantResponse: (messageID: string, text: string) => void | Promise<void>
  onForkFromMessage?: (messageID: string) => void | Promise<void>
  onOpenSideChat?: (anchorMessageID: string) => void | Promise<void>
  row: AssistantActionsRow
}

export interface ThreadRowRendererProps {
  activeSession: SessionSummary | null
  activeSessionDiff?: SessionDiffSummary | null
  assistantTraceVisibility: AssistantTraceVisibility
  components: ThreadRowRendererComponents
  copiedResponseMessageID: string | null
  copiedUserThreadMessageID: string | null
  displayMessages: ThreadMessage[]
  isResolvingPermissionRequest: boolean
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onAskUserQuestionAnswer: QuestionAnswerHandler
  onBranchSelect?: (messageID: string) => void | Promise<void>
  onCopyAssistantResponse: (messageID: string, text: string) => void | Promise<void>
  onCopyUserMessage: (messageID: string, text: string) => void | Promise<void>
  onFileChangeSelect?: (file: string) => void
  onForkFromMessage?: (messageID: string) => void | Promise<void>
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  onMessageDiffRestore?: (diffs: SessionDiffFile[]) => void | Promise<void>
  onMessageDiffReview?: (files: string[]) => void | Promise<void>
  onMessageDiffSummaryHydrate?: (messageID: string, diffSummary: SessionDiffSummary) => void | Promise<void>
  onOpenImagePreview: (payload: ImagePreviewPayload) => void
  onOpenSideChat?: (anchorMessageID: string) => void | Promise<void>
  onPermissionRequestResponse: PermissionRequestResponseHandler
  onProposedPlanConfirm?: ProposedPlanConfirmHandler
  pendingPermissionRequests: PermissionRequest[]
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  readThreadMessageMotion: (messageID: string, isLive?: boolean) => ThreadMessageMotion
  row: ThreadDisplayRow
  isTraceItemQuestionAnswered: (item: AssistantTraceItem) => boolean
}

function areAssistantTraceVisibilityEqual(left: AssistantTraceVisibility, right: AssistantTraceVisibility) {
  return (
    left === right ||
    (
      left.response === right.response &&
      left.reasoning === right.reasoning &&
      left.toolCalls === right.toolCalls &&
      left.toolInputs === right.toolInputs &&
      left.toolOutputs === right.toolOutputs &&
      left.sources === right.sources &&
      left.files === right.files &&
      left.approvals === right.approvals &&
      left.workflow === right.workflow &&
      left.debugMetadata === right.debugMetadata
    )
  )
}

function areTraceRowSharedPropsEqual<TProps extends TraceRowViewSharedProps>(left: TProps, right: TProps) {
  return (
    left.components === right.components &&
    left.motion === right.motion &&
    left.isQuestionAnswered === right.isQuestionAnswered &&
    left.isQuestionAnswerDisabled === right.isQuestionAnswerDisabled &&
    left.onArtifactLinkOpen === right.onArtifactLinkOpen &&
    left.onAskUserQuestionAnswer === right.onAskUserQuestionAnswer &&
    left.onFileChangeSelect === right.onFileChangeSelect &&
    left.onLocalFileLinkOpen === right.onLocalFileLinkOpen &&
    left.onOpenImagePreview === right.onOpenImagePreview &&
    left.onProposedPlanConfirm === right.onProposedPlanConfirm &&
    areAssistantTraceVisibilityEqual(left.traceVisibility, right.traceVisibility)
  )
}

function areAssistantTraceRowBasesEqual(left: AssistantTraceRenderableRow, right: AssistantTraceRenderableRow) {
  return (
    left.kind === right.kind &&
    left.rowID === right.rowID &&
    left.message === right.message &&
    left.messageID === right.messageID &&
    left.motionKey === right.motionKey &&
    left.section === right.section &&
    left.isLatestMessage === right.isLatestMessage &&
    left.suppressReasoningMessageCompletionCollapse === right.suppressReasoningMessageCompletionCollapse &&
    left.shouldCollapseTraceItemAfterMessageCompletion === right.shouldCollapseTraceItemAfterMessageCompletion
  )
}

function areAssistantTraceSectionRowsEqual(left: AssistantTraceSectionRow, right: AssistantTraceSectionRow) {
  if (left === right) return true
  if (!areAssistantTraceRowBasesEqual(left, right)) return false

  if (left.kind === "assistant-file-change-row" || right.kind === "assistant-file-change-row") {
    return (
      left.kind === "assistant-file-change-row" &&
      right.kind === "assistant-file-change-row" &&
      left.itemID === right.itemID &&
      left.items === right.items &&
      left.summaryKey === right.summaryKey
    )
  }

  return (
    left.item === right.item &&
    left.itemID === right.itemID &&
    left.traceItem === right.traceItem &&
    left.traceItem.item === right.traceItem.item
  )
}

function areAssistantTraceLiteRowsEqual(left: AssistantTraceLiteRow, right: AssistantTraceLiteRow) {
  return (
    left === right ||
    (
      areAssistantTraceRowBasesEqual(left, right) &&
      left.item === right.item &&
      left.itemID === right.itemID &&
      left.traceItem === right.traceItem &&
      left.traceItem.item === right.traceItem.item
    )
  )
}

const UserDisplayRowView = memo(function UserDisplayRowView({
  activeSessionDiff,
  allowWorkspaceDiffFallback,
  components,
  copied,
  motion,
  onCopy,
  onFileChangeSelect,
  onMessageDiffRestore,
  onMessageDiffReview,
  onMessageDiffSummaryHydrate,
  row,
  showDiffCard,
}: UserDisplayRowViewProps) {
  const { message } = row
  const { MessageDiffCard, UserThreadMessageArticle } = components

  return (
    <UserThreadMessageArticle
      copied={copied}
      motion={motion}
      onCopy={onCopy}
      message={message}
      rowKind={row.kind}
      diffCard={
        showDiffCard ? (
          <MessageDiffCard
            messageID={message.id}
            diffSummary={message.diffSummary}
            activeSessionDiff={activeSessionDiff}
            allowWorkspaceDiffFallback={allowWorkspaceDiffFallback}
            onFileChangeSelect={onFileChangeSelect}
            onMessageDiffSummaryHydrate={onMessageDiffSummaryHydrate}
            onMessageDiffRestore={onMessageDiffRestore}
            onMessageDiffReview={onMessageDiffReview}
          />
        ) : null
      }
    />
  )
}, areUserDisplayRowViewPropsEqual)

function areUserDisplayRowsEqual(left: UserMessageRow, right: UserMessageRow) {
  return (
    left === right ||
    (
      left.rowID === right.rowID &&
      left.message === right.message &&
      left.messageID === right.messageID &&
      left.messageIndex === right.messageIndex
    )
  )
}

function areUserDisplayRowViewPropsEqual(left: UserDisplayRowViewProps, right: UserDisplayRowViewProps) {
  return (
    areUserDisplayRowsEqual(left.row, right.row) &&
    left.activeSessionDiff === right.activeSessionDiff &&
    left.allowWorkspaceDiffFallback === right.allowWorkspaceDiffFallback &&
    left.components === right.components &&
    left.copied === right.copied &&
    left.motion === right.motion &&
    left.onCopy === right.onCopy &&
    left.onFileChangeSelect === right.onFileChangeSelect &&
    left.onMessageDiffRestore === right.onMessageDiffRestore &&
    left.onMessageDiffReview === right.onMessageDiffReview &&
    left.onMessageDiffSummaryHydrate === right.onMessageDiffSummaryHydrate &&
    left.showDiffCard === right.showDiffCard
  )
}

const PermissionRequestRowView = memo(function PermissionRequestRowView({
  activeSession,
  components,
  isResolvingPermissionRequest,
  motion,
  onPermissionRequestResponse,
  pendingPermissionRequests,
  permissionRequestActionError,
  permissionRequestActionRequestID,
}: PermissionRequestRowViewProps) {
  const { PermissionRequestInlinePrompt } = components

  return (
    <PermissionRequestInlinePrompt
      activeSession={activeSession}
      isResolvingPermissionRequest={isResolvingPermissionRequest}
      pendingPermissionRequests={pendingPermissionRequests}
      permissionRequestActionError={permissionRequestActionError}
      permissionRequestActionRequestID={permissionRequestActionRequestID}
      motion={motion}
      onPermissionRequestResponse={onPermissionRequestResponse}
    />
  )
}, arePermissionRequestRowViewPropsEqual)

function arePermissionRequestRowsEqual(left: PermissionRequestRow, right: PermissionRequestRow) {
  return (
    left === right ||
    (
      left.rowID === right.rowID &&
      left.requestID === right.requestID &&
      left.messageID === right.messageID &&
      left.messageIndex === right.messageIndex
    )
  )
}

function arePermissionRequestRowViewPropsEqual(left: PermissionRequestRowViewProps, right: PermissionRequestRowViewProps) {
  return (
    arePermissionRequestRowsEqual(left.row, right.row) &&
    left.activeSession === right.activeSession &&
    left.components === right.components &&
    left.isResolvingPermissionRequest === right.isResolvingPermissionRequest &&
    left.motion === right.motion &&
    left.onPermissionRequestResponse === right.onPermissionRequestResponse &&
    left.pendingPermissionRequests === right.pendingPermissionRequests &&
    left.permissionRequestActionError === right.permissionRequestActionError &&
    left.permissionRequestActionRequestID === right.permissionRequestActionRequestID
  )
}

const AssistantTraceSectionRowView = memo(function AssistantTraceSectionRowView({
  components,
  isQuestionAnswerDisabled,
  isQuestionAnswered,
  motion,
  onArtifactLinkOpen,
  onAskUserQuestionAnswer,
  onFileChangeSelect,
  onLocalFileLinkOpen,
  onOpenImagePreview,
  onProposedPlanConfirm,
  row,
  traceVisibility,
}: AssistantTraceSectionRowViewProps) {
  const traceItems = row.kind === "assistant-file-change-row" ? row.items : [row.traceItem]
  const { AssistantTraceSection, getAssistantTraceBlockStackClassName, renderTraceItemForRow } = components

  return (
    <article
      className={joinClassNames("thread-row", row.kind)}
      data-thread-row-kind={row.kind}
      data-thread-message-id={row.messageID}
      data-assistant-item-id={row.itemID}
      data-thread-message-motion={motion}
    >
      <div className={row.message.isStreaming ? "assistant-shell is-sectioned is-streaming" : "assistant-shell is-sectioned"}>
        <AssistantTraceSection
          sectionKey={row.section}
          title={traceSectionTitle(row.section)}
        >
          <div className={getAssistantTraceBlockStackClassName(row.section)}>
            {traceItems.map((traceItem) => renderTraceItemForRow({
              isQuestionAnswerDisabled,
              isQuestionAnswered: row.kind === "assistant-file-change-row" ? false : isQuestionAnswered,
              onArtifactLinkOpen,
              onAskUserQuestionAnswer,
              onFileChangeSelect,
              onLocalFileLinkOpen,
              onOpenImagePreview,
              onProposedPlanConfirm,
              row,
              traceItem,
              traceVisibility,
            }))}
          </div>
        </AssistantTraceSection>
      </div>
    </article>
  )
}, areAssistantTraceSectionRowViewPropsEqual)

function areAssistantTraceSectionRowViewPropsEqual(left: AssistantTraceSectionRowViewProps, right: AssistantTraceSectionRowViewProps) {
  return (
    areAssistantTraceSectionRowsEqual(left.row, right.row) &&
    areTraceRowSharedPropsEqual(left, right)
  )
}

const AssistantTraceLiteRowView = memo(function AssistantTraceLiteRowView({
  activeSession,
  components,
  isQuestionAnswerDisabled,
  isQuestionAnswered,
  isResolvingPermissionRequest,
  motion,
  onArtifactLinkOpen,
  onAskUserQuestionAnswer,
  onFileChangeSelect,
  onLocalFileLinkOpen,
  onOpenImagePreview,
  onPermissionRequestResponse,
  onProposedPlanConfirm,
  pendingPermissionRequest,
  permissionRequestActionError,
  permissionRequestActionRequestID,
  row,
  traceVisibility,
}: AssistantTraceLiteRowViewProps) {
  const { PermissionRequestCard, renderTraceItemForRow } = components
  const pendingPermissionActionError =
    pendingPermissionRequest &&
    permissionRequestActionError &&
    (!permissionRequestActionRequestID || permissionRequestActionRequestID === pendingPermissionRequest.id)
      ? permissionRequestActionError
      : null
  const shouldRenderPermissionCard = Boolean(activeSession && pendingPermissionRequest)
  const isPendingPermissionRequestResolving = Boolean(
    pendingPermissionRequest &&
      (permissionRequestActionRequestID === pendingPermissionRequest.id ||
        (isResolvingPermissionRequest && !permissionRequestActionRequestID)),
  )
  const traceItem = row.section === "approvals"
    ? {
        ...row.traceItem,
        item: {
          ...row.traceItem.item,
          detail: shouldRenderPermissionCard ? undefined : row.traceItem.item.detail,
          status: undefined,
        },
      }
    : row.traceItem

  return (
    <article
      className={joinClassNames("thread-row", row.kind, "assistant-trace-lite-row")}
      data-thread-row-kind={row.kind}
      data-thread-message-id={row.messageID}
      data-assistant-item-id={row.itemID}
      data-thread-message-motion={motion}
    >
      <div
        className={joinClassNames(
          "assistant-trace-lite",
          `is-${row.section}`,
          shouldRenderPermissionCard && "has-permission-card",
        )}
        role="region"
        aria-label={traceSectionTitle(row.section)}
      >
        {renderTraceItemForRow({
          isQuestionAnswerDisabled,
          isQuestionAnswered,
          onArtifactLinkOpen,
          onAskUserQuestionAnswer,
          onFileChangeSelect,
          onLocalFileLinkOpen,
          onOpenImagePreview,
          onProposedPlanConfirm,
          row,
          traceItem,
          traceVisibility,
        })}
        {activeSession && pendingPermissionRequest ? (
          <div className="assistant-approval-inline-card">
            <PermissionRequestCard
              actionError={pendingPermissionActionError}
              activeSession={activeSession}
              isResolving={isPendingPermissionRequestResolving}
              request={pendingPermissionRequest}
              onRespond={onPermissionRequestResponse}
            />
          </div>
        ) : null}
      </div>
    </article>
  )
}, areAssistantTraceLiteRowViewPropsEqual)

function areAssistantTraceLiteRowViewPropsEqual(left: AssistantTraceLiteRowViewProps, right: AssistantTraceLiteRowViewProps) {
  return (
    areAssistantTraceLiteRowsEqual(left.row, right.row) &&
    areTraceRowSharedPropsEqual(left, right) &&
    left.activeSession === right.activeSession &&
    left.isResolvingPermissionRequest === right.isResolvingPermissionRequest &&
    left.onPermissionRequestResponse === right.onPermissionRequestResponse &&
    left.pendingPermissionRequest === right.pendingPermissionRequest &&
    left.permissionRequestActionError === right.permissionRequestActionError &&
    left.permissionRequestActionRequestID === right.permissionRequestActionRequestID
  )
}

const AssistantEphemeralRowView = memo(function AssistantEphemeralRowView({
  components,
  motion,
  row,
}: AssistantEphemeralRowViewProps) {
  const { AssistantMessagePlaceholder } = components

  return (
    <article
      className="thread-row assistant-ephemeral-state-row"
      data-thread-row-kind={row.kind}
      data-thread-message-id={row.messageID}
      data-thread-message-motion={motion}
    >
      <div className={row.message.isStreaming ? "assistant-shell is-sectioned is-streaming" : "assistant-shell is-sectioned"}>
        <AssistantMessagePlaceholder message={row.ephemeralHint} />
      </div>
    </article>
  )
}, areAssistantEphemeralRowViewPropsEqual)

function areAssistantEphemeralRowsEqual(left: AssistantEphemeralStateRow, right: AssistantEphemeralStateRow) {
  return (
    left === right ||
    (
      left.rowID === right.rowID &&
      left.message === right.message &&
      left.messageID === right.messageID &&
      left.motionKey === right.motionKey &&
      left.ephemeralHint === right.ephemeralHint
    )
  )
}

function areAssistantEphemeralRowViewPropsEqual(left: AssistantEphemeralRowViewProps, right: AssistantEphemeralRowViewProps) {
  return (
    areAssistantEphemeralRowsEqual(left.row, right.row) &&
    left.components === right.components &&
    left.motion === right.motion
  )
}

const AssistantInsertedUserRowView = memo(function AssistantInsertedUserRowView({
  components,
  copied,
  motion,
  onCopy,
  row,
}: AssistantInsertedUserRowViewProps) {
  const { UserThreadMessageArticle } = components

  return (
    <UserThreadMessageArticle
      className="assistant-stream-insertion-user-message"
      copied={copied}
      motion={motion}
      onCopy={onCopy}
      message={row.insertedMessage}
      rowKind={row.kind}
    />
  )
}, areAssistantInsertedUserRowViewPropsEqual)

function areAssistantInsertedUserRowsEqual(left: AssistantInsertedUserMessageRow, right: AssistantInsertedUserMessageRow) {
  return (
    left === right ||
    (
      left.rowID === right.rowID &&
      left.message === right.message &&
      left.messageID === right.messageID &&
      left.motionKey === right.motionKey &&
      left.insertedMessage === right.insertedMessage
    )
  )
}

function areAssistantInsertedUserRowViewPropsEqual(left: AssistantInsertedUserRowViewProps, right: AssistantInsertedUserRowViewProps) {
  return (
    areAssistantInsertedUserRowsEqual(left.row, right.row) &&
    left.components === right.components &&
    left.copied === right.copied &&
    left.motion === right.motion &&
    left.onCopy === right.onCopy
  )
}

const AssistantDiffRowView = memo(function AssistantDiffRowView({
  activeSessionDiff,
  components,
  motion,
  onFileChangeSelect,
  onMessageDiffRestore,
  onMessageDiffReview,
  onMessageDiffSummaryHydrate,
  row,
}: AssistantDiffRowViewProps) {
  const { MessageDiffCard, collectAssistantPatchFileChanges } = components
  const patchSourceFileChanges = useMemo(
    () => collectAssistantPatchFileChanges(row.patchSourceMessage),
    [collectAssistantPatchFileChanges, row.patchSourceMessage],
  )

  return (
    <article
      className="thread-row assistant-diff-row"
      data-thread-row-kind={row.kind}
      data-thread-message-id={row.messageID}
      data-thread-message-motion={motion}
    >
      <div className="assistant-shell is-sectioned">
        <MessageDiffCard
          messageID={row.diffMessageID}
          diffSummary={row.diffSummary}
          activeSessionDiff={activeSessionDiff}
          allowWorkspaceDiffFallback={row.allowWorkspaceDiffFallback}
          patchSourceFileChanges={patchSourceFileChanges}
          onFileChangeSelect={onFileChangeSelect}
          onMessageDiffSummaryHydrate={onMessageDiffSummaryHydrate}
          onMessageDiffRestore={onMessageDiffRestore}
          onMessageDiffReview={onMessageDiffReview}
        />
      </div>
    </article>
  )
}, areAssistantDiffRowViewPropsEqual)

function areAssistantDiffRowsEqual(left: AssistantDiffCardRow, right: AssistantDiffCardRow) {
  return (
    left === right ||
    (
      left.rowID === right.rowID &&
      left.message === right.message &&
      left.messageID === right.messageID &&
      left.motionKey === right.motionKey &&
      left.allowWorkspaceDiffFallback === right.allowWorkspaceDiffFallback &&
      left.diffMessage === right.diffMessage &&
      left.diffMessageID === right.diffMessageID &&
      left.diffSummary === right.diffSummary &&
      left.patchSourceMessage === right.patchSourceMessage
    )
  )
}

function areAssistantDiffRowViewPropsEqual(left: AssistantDiffRowViewProps, right: AssistantDiffRowViewProps) {
  return (
    areAssistantDiffRowsEqual(left.row, right.row) &&
    left.activeSessionDiff === right.activeSessionDiff &&
    left.components === right.components &&
    left.motion === right.motion &&
    left.onFileChangeSelect === right.onFileChangeSelect &&
    left.onMessageDiffRestore === right.onMessageDiffRestore &&
    left.onMessageDiffReview === right.onMessageDiffReview &&
    left.onMessageDiffSummaryHydrate === right.onMessageDiffSummaryHydrate
  )
}

const AssistantActionsRowView = memo(function AssistantActionsRowView({
  components,
  copied,
  motion,
  onBranchSelect,
  onCopyAssistantResponse,
  onForkFromMessage,
  onOpenSideChat,
  row,
}: AssistantActionsRowViewProps) {
  const { BranchSwitcher } = components

  return (
    <article
      className="thread-row assistant-actions-row"
      data-thread-row-kind={row.kind}
      data-thread-message-id={row.messageID}
      data-thread-message-motion={motion}
    >
      <div className="assistant-response-side-chat">
        <div className="assistant-response-actions">
          <BranchSwitcher options={row.branchOptions} onSelect={onBranchSelect} />
          {row.responseCopyText ? (
            <button
              className={joinClassNames(
                "assistant-response-action-button message-action-icon-button",
                copied && "is-active",
              )}
              type="button"
              aria-label={copied ? "Copied assistant response" : "Copy assistant response"}
              title={copied ? "Copied" : "Copy"}
              onClick={() => void onCopyAssistantResponse(row.ownerMessageID, row.responseCopyText)}
            >
              <CopyIcon />
            </button>
          ) : null}
          {row.canOpenSideChat ? (
            <button
              className={joinClassNames(
                "assistant-response-action-button message-action-icon-button",
                row.marksSideChatButtonActive && "is-active",
              )}
              type="button"
              aria-label={row.sideChatButtonLabel}
              aria-pressed={row.marksSideChatButtonActive}
              title={row.sideChatButtonTitle}
              onClick={() => void onOpenSideChat?.(row.sideChatAnchorMessageID)}
            >
              <SideChatIcon />
            </button>
          ) : null}
          {row.canForkFromMessage ? (
            <button
              className="assistant-response-action-button message-action-icon-button"
              type="button"
              aria-label="Fork from here"
              title="Fork from here"
              onClick={() => void onForkFromMessage?.(row.threadMessageID)}
            >
              <ForkIcon />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}, areAssistantActionsRowViewPropsEqual)

function areAssistantActionsRowsEqual(left: AssistantActionsRow, right: AssistantActionsRow) {
  return (
    left === right ||
    (
      left.rowID === right.rowID &&
      left.message === right.message &&
      left.messageID === right.messageID &&
      left.motionKey === right.motionKey &&
      left.branchOptions === right.branchOptions &&
      left.canForkFromMessage === right.canForkFromMessage &&
      left.canOpenSideChat === right.canOpenSideChat &&
      left.existingSideChatCount === right.existingSideChatCount &&
      left.marksSideChatButtonActive === right.marksSideChatButtonActive &&
      left.ownerMessageID === right.ownerMessageID &&
      left.responseCopyText === right.responseCopyText &&
      left.sideChatAnchorMessageID === right.sideChatAnchorMessageID &&
      left.sideChatButtonLabel === right.sideChatButtonLabel &&
      left.sideChatButtonTitle === right.sideChatButtonTitle &&
      left.threadMessageID === right.threadMessageID
    )
  )
}

function areAssistantActionsRowViewPropsEqual(left: AssistantActionsRowViewProps, right: AssistantActionsRowViewProps) {
  return (
    areAssistantActionsRowsEqual(left.row, right.row) &&
    left.components === right.components &&
    left.copied === right.copied &&
    left.motion === right.motion &&
    left.onBranchSelect === right.onBranchSelect &&
    left.onCopyAssistantResponse === right.onCopyAssistantResponse &&
    left.onForkFromMessage === right.onForkFromMessage &&
    left.onOpenSideChat === right.onOpenSideChat
  )
}

function isAssistantTraceSectionRow(row: ThreadDisplayRow): row is AssistantTraceSectionRow {
  return row.kind === "assistant-response-row" ||
    row.kind === "assistant-question-row" ||
    row.kind === "assistant-file-change-row"
}

function isAssistantTraceLiteRow(row: ThreadDisplayRow): row is AssistantTraceLiteRow {
  return row.kind === "assistant-reasoning-row" ||
    row.kind === "assistant-tool-row" ||
    row.kind === "assistant-workflow-row" ||
    row.kind === "assistant-debug-row" ||
    row.kind === "assistant-source-row" ||
    row.kind === "assistant-approval-row"
}

function findPendingPermissionRequestForApprovalRow({
  pendingPermissionRequests,
  row,
}: {
  pendingPermissionRequests: PermissionRequest[]
  row: AssistantTraceLiteRow
}) {
  if (row.kind !== "assistant-approval-row") return null

  return pendingPermissionRequests.find((request) =>
    permissionRequestMatchesApprovalTraceItem(request, row.traceItem.item),
  ) ?? null
}

export function ThreadRowRenderer({
  activeSession,
  activeSessionDiff,
  assistantTraceVisibility,
  components,
  copiedResponseMessageID,
  copiedUserThreadMessageID,
  displayMessages,
  isResolvingPermissionRequest,
  isTraceItemQuestionAnswered,
  onArtifactLinkOpen,
  onAskUserQuestionAnswer,
  onBranchSelect,
  onCopyAssistantResponse,
  onCopyUserMessage,
  onFileChangeSelect,
  onForkFromMessage,
  onLocalFileLinkOpen,
  onMessageDiffRestore,
  onMessageDiffReview,
  onMessageDiffSummaryHydrate,
  onOpenImagePreview,
  onOpenSideChat,
  onPermissionRequestResponse,
  onProposedPlanConfirm,
  pendingPermissionRequests,
  permissionRequestActionError,
  permissionRequestActionRequestID,
  readThreadMessageMotion,
  row,
}: ThreadRowRendererProps) {
  if (row.kind === "user-message") {
    const { message, messageIndex } = row
    return (
      <UserDisplayRowView
        activeSessionDiff={activeSessionDiff}
        allowWorkspaceDiffFallback={messageIndex === displayMessages.length - 1}
        components={components}
        copied={copiedUserThreadMessageID === message.id}
        motion={readThreadMessageMotion(message.id)}
        onCopy={onCopyUserMessage}
        onFileChangeSelect={onFileChangeSelect}
        onMessageDiffSummaryHydrate={onMessageDiffSummaryHydrate}
        onMessageDiffRestore={onMessageDiffRestore}
        onMessageDiffReview={onMessageDiffReview}
        row={row}
        showDiffCard={shouldRenderDiffOnStandaloneUserMessage(displayMessages, messageIndex, message)}
      />
    )
  }

  if (row.kind === "permission-request") {
    return (
      <PermissionRequestRowView
        activeSession={activeSession}
        components={components}
        isResolvingPermissionRequest={isResolvingPermissionRequest}
        pendingPermissionRequests={pendingPermissionRequests}
        permissionRequestActionError={permissionRequestActionError}
        permissionRequestActionRequestID={permissionRequestActionRequestID}
        motion={readThreadMessageMotion(
          pendingPermissionRequests[0]?.id ? `permission-request:${pendingPermissionRequests[0].id}` : "permission-request",
        )}
        onPermissionRequestResponse={onPermissionRequestResponse}
        row={row}
      />
    )
  }

  const isQuestionAnswerDisabled = isResolvingPermissionRequest || pendingPermissionRequests.length > 0

  if (isAssistantTraceLiteRow(row)) {
    const pendingPermissionRequest = findPendingPermissionRequestForApprovalRow({
      pendingPermissionRequests,
      row,
    })

    return (
      <AssistantTraceLiteRowView
        activeSession={activeSession}
        components={components}
        isQuestionAnswered={isTraceItemQuestionAnswered(row.traceItem.item)}
        isQuestionAnswerDisabled={isQuestionAnswerDisabled}
        isResolvingPermissionRequest={isResolvingPermissionRequest}
        motion={readThreadMessageMotion(row.motionKey, row.message.isStreaming)}
        onOpenImagePreview={onOpenImagePreview}
        onAskUserQuestionAnswer={onAskUserQuestionAnswer}
        onFileChangeSelect={onFileChangeSelect}
        onArtifactLinkOpen={onArtifactLinkOpen}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
        onPermissionRequestResponse={onPermissionRequestResponse}
        onProposedPlanConfirm={onProposedPlanConfirm}
        pendingPermissionRequest={pendingPermissionRequest}
        permissionRequestActionError={permissionRequestActionError}
        permissionRequestActionRequestID={permissionRequestActionRequestID}
        row={row}
        traceVisibility={assistantTraceVisibility}
      />
    )
  }

  if (isAssistantTraceSectionRow(row)) {
    return (
      <AssistantTraceSectionRowView
        components={components}
        isQuestionAnswered={row.kind === "assistant-file-change-row" ? false : isTraceItemQuestionAnswered(row.traceItem.item)}
        isQuestionAnswerDisabled={isQuestionAnswerDisabled}
        motion={readThreadMessageMotion(row.motionKey, row.message.isStreaming)}
        onOpenImagePreview={onOpenImagePreview}
        onAskUserQuestionAnswer={onAskUserQuestionAnswer}
        onFileChangeSelect={onFileChangeSelect}
        onArtifactLinkOpen={onArtifactLinkOpen}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
        onProposedPlanConfirm={onProposedPlanConfirm}
        row={row}
        traceVisibility={assistantTraceVisibility}
      />
    )
  }

  if (row.kind === "assistant-ephemeral-state") {
    return (
      <AssistantEphemeralRowView
        components={components}
        motion={readThreadMessageMotion(row.motionKey, row.message.isStreaming)}
        row={row}
      />
    )
  }

  if (row.kind === "assistant-inserted-user-message") {
    return (
      <AssistantInsertedUserRowView
        components={components}
        copied={copiedUserThreadMessageID === row.insertedMessage.id}
        motion={readThreadMessageMotion(row.insertedMessage.id)}
        onCopy={onCopyUserMessage}
        row={row}
      />
    )
  }

  if (row.kind === "assistant-diff-card") {
    return (
      <AssistantDiffRowView
        activeSessionDiff={activeSessionDiff}
        components={components}
        motion={readThreadMessageMotion(row.motionKey, row.message.isStreaming)}
        onFileChangeSelect={onFileChangeSelect}
        onMessageDiffSummaryHydrate={onMessageDiffSummaryHydrate}
        onMessageDiffRestore={onMessageDiffRestore}
        onMessageDiffReview={onMessageDiffReview}
        row={row}
      />
    )
  }

  if (row.kind === "assistant-actions") {
    return (
      <AssistantActionsRowView
        components={components}
        copied={copiedResponseMessageID === row.ownerMessageID}
        motion={readThreadMessageMotion(row.motionKey, row.message.isStreaming)}
        onBranchSelect={onBranchSelect}
        onCopyAssistantResponse={onCopyAssistantResponse}
        onForkFromMessage={onForkFromMessage}
        onOpenSideChat={onOpenSideChat}
        row={row}
      />
    )
  }

  return null
}
