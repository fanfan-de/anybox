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
  ComposerAttachment,
  ComposerDraftState,
  ComposerPastedImageAttachment,
  PendingConversationInput,
  PermissionDecision,
  PermissionRequest,
  ReasoningEffort,
  SessionDiffFile,
  SessionDiffSummary,
  SessionSummary,
  ThreadMessage,
  UserThreadMessage,
} from "../types"
import {
  shouldRenderDiffOnStandaloneUserMessage,
  traceSectionTitle,
  type AssistantActionsRow,
  type AssistantDiffCardRow,
  type AssistantEphemeralStateRow,
  type AssistantFileChangeRow,
  type AssistantInlineSideChatRow,
  type AssistantInsertedUserMessageRow,
  type AssistantTraceItemRow,
  type AssistantTraceItemRowKind,
  type AssistantTraceRowItem,
  type PermissionRequestRow,
  type ThreadDisplayRow,
  type UserMessageRow,
} from "./thread-display-rows"
import type { ThreadScrollSnapshot } from "./use-thread-scroll-controller"

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

export interface BranchSwitcherRendererProps {
  onSelect?: (messageID: string) => void | Promise<void>
  options: SessionMessageBranchOption[]
}

export type InlineSideChatSendHandler = (input: {
  attachmentError?: string | null
  draftStateOverride?: ComposerDraftState
  questionAnswer?: {
    questionID: string
    selectedOptions?: string[]
    freeformText?: string
  }
  selectedReasoningEffort?: ReasoningEffort | null
  selectedModel?: string | null
  selectedSkillIDs: string[]
  steerQueuedMessageID?: string
  submissionMode?: UserThreadMessage["submissionMode"]
  waitForPendingModelSelection: () => Promise<void>
}) => void | Promise<void>

export interface InlineSideChatThreadRendererProps {
  activeProjectID: string | null
  attachments: ComposerAttachment[]
  assistantTraceVisibility: AssistantTraceVisibility
  composerRefreshVersion: number
  draftState: ComposerDraftState
  isAgentDebugTraceEnabled: boolean
  isResolvingPermissionRequest: boolean
  isCancelling?: boolean
  isInterruptible?: boolean
  isSending: boolean
  pendingInputs: PendingConversationInput[]
  pendingPermissionRequests: PermissionRequest[]
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  session: SessionSummary
  sideChatSessions: SessionSummary[]
  messages: ThreadMessage[]
  isThreadVisible?: boolean
  readScrollSnapshot?: (key: string) => ThreadScrollSnapshot | null
  saveScrollSnapshot?: (key: string, snapshot: ThreadScrollSnapshot) => void
  onDraftStateChange: (value: ComposerDraftState) => void
  onHide: () => void
  onAskUserQuestionAnswer: QuestionAnswerHandler
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  onPermissionRequestResponse: PermissionRequestResponseHandler
  onPickAttachments: (input: {
    allowImage: boolean
    allowPdf: boolean
    disabledReason: string | null
  }) => void | Promise<void>
  onPasteImageAttachments?: (input: {
    allowImage: boolean
    disabledReason: string | null
    images: ComposerPastedImageAttachment[]
  }) => void | Promise<void>
  onRemoveAttachment: (path: string) => void
  onCancelSend?: () => void | Promise<void>
  onCreateSideChat: () => void | Promise<void>
  onDeleteSideChat: (sessionID: string) => void | Promise<void>
  onSend: InlineSideChatSendHandler
  onSelectSideChat: (sessionID: string) => void | Promise<void>
  onSessionModelSelectionChange?: (sessionID: string, selection: SessionSummary["modelSelection"] | undefined) => void
}

export interface ThreadRowRendererComponents {
  AssistantMessagePlaceholder: ComponentType<{ message: string }>
  AssistantTraceSection: ComponentType<{
    children: ReactNode
    sectionKey: AssistantTraceSectionKey
    title: string
  }>
  BranchSwitcher: ComponentType<BranchSwitcherRendererProps>
  InlineSideChatThread: ComponentType<InlineSideChatThreadRendererProps>
  MessageDiffCard: ComponentType<MessageDiffCardRendererProps>
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

interface AssistantInlineSideChatRowViewProps {
  activeProjectID: string | null
  attachments: ComposerAttachment[]
  assistantTraceVisibility: AssistantTraceVisibility
  components: ThreadRowRendererComponents
  composerRefreshVersion: number
  draftState: ComposerDraftState
  isAgentDebugTraceEnabled: boolean
  isCancelling: boolean
  isInterruptible: boolean
  isResolvingPermissionRequest: boolean
  isSending: boolean
  isThreadVisible: boolean
  messages: ThreadMessage[]
  motion: ThreadMessageMotion
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onAskUserQuestionAnswer: QuestionAnswerHandler
  onCancelSend?: () => void | Promise<void>
  onCreateSideChat?: (anchorMessageID: string) => void | Promise<void>
  onDeleteSideChat?: (sessionID: string) => void | Promise<void>
  onDraftStateChange?: (value: ComposerDraftState) => void
  onHideSideChat?: (anchorMessageID: string) => void | Promise<void>
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  onPasteImageAttachments?: (input: {
    allowImage: boolean
    disabledReason: string | null
    images: ComposerPastedImageAttachment[]
  }) => void | Promise<void>
  onPermissionRequestResponse: PermissionRequestResponseHandler
  onPickAttachments?: (input: {
    allowImage: boolean
    allowPdf: boolean
    disabledReason: string | null
  }) => void | Promise<void>
  onRemoveAttachment?: (path: string) => void
  onSelectSideChat?: (sessionID: string) => void | Promise<void>
  onSend?: InlineSideChatSendHandler
  onSessionModelSelectionChange?: (sessionID: string, selection: SessionSummary["modelSelection"] | undefined) => void
  pendingInputs: PendingConversationInput[]
  pendingPermissionRequests: PermissionRequest[]
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  readScrollSnapshot?: (key: string) => ThreadScrollSnapshot | null
  row: AssistantInlineSideChatRow
  saveScrollSnapshot?: (key: string, snapshot: ThreadScrollSnapshot) => void
}

export interface ThreadRowRendererProps {
  activeProjectID: string | null
  activeSession: SessionSummary | null
  activeSessionDiff?: SessionDiffSummary | null
  assistantTraceVisibility: AssistantTraceVisibility
  components: ThreadRowRendererComponents
  composerRefreshVersion: number
  copiedResponseMessageID: string | null
  copiedUserThreadMessageID: string | null
  displayMessages: ThreadMessage[]
  isAgentDebugTraceEnabled: boolean
  isResolvingPermissionRequest: boolean
  isThreadVisible: boolean
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
  onSideChatCancelSend?: () => void | Promise<void>
  onSideChatCreate?: (anchorMessageID: string) => void | Promise<void>
  onSideChatDelete?: (sessionID: string) => void | Promise<void>
  onSideChatDraftStateChange?: (value: ComposerDraftState) => void
  onSideChatPasteImageAttachments?: (input: {
    allowImage: boolean
    disabledReason: string | null
    images: ComposerPastedImageAttachment[]
  }) => void | Promise<void>
  onSideChatPickAttachments?: (input: {
    allowImage: boolean
    allowPdf: boolean
    disabledReason: string | null
  }) => void | Promise<void>
  onSideChatRemoveAttachment?: (path: string) => void
  onSideChatSelect?: (sessionID: string) => void | Promise<void>
  onSideChatSend?: InlineSideChatSendHandler
  onSessionModelSelectionChange?: (sessionID: string, selection: SessionSummary["modelSelection"] | undefined) => void
  pendingPermissionRequests: PermissionRequest[]
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  readScrollSnapshot?: (key: string) => ThreadScrollSnapshot | null
  readThreadMessageMotion: (messageID: string, isLive?: boolean) => ThreadMessageMotion
  row: ThreadDisplayRow
  saveScrollSnapshot?: (key: string, snapshot: ThreadScrollSnapshot) => void
  sideChatAttachments: ComposerAttachment[]
  sideChatDraftState: ComposerDraftState
  sideChatIsCancelling: boolean
  sideChatIsInterruptible: boolean
  sideChatIsSending: boolean
  sideChatMessages: ThreadMessage[]
  sideChatPendingInputs: PendingConversationInput[]
  sideChatPendingPermissionRequests: PermissionRequest[]
  sideChatPermissionRequestActionError: string | null
  sideChatPermissionRequestActionRequestID: string | null
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
}: AssistantTraceLiteRowViewProps) {
  const { renderTraceItemForRow } = components

  return (
    <article
      className={joinClassNames("thread-row", row.kind, "assistant-trace-lite-row")}
      data-thread-row-kind={row.kind}
      data-thread-message-id={row.messageID}
      data-assistant-item-id={row.itemID}
      data-thread-message-motion={motion}
    >
      <div
        className={joinClassNames("assistant-trace-lite", `is-${row.section}`)}
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
          traceItem: row.traceItem,
          traceVisibility,
        })}
      </div>
    </article>
  )
}, areAssistantTraceLiteRowViewPropsEqual)

function areAssistantTraceLiteRowViewPropsEqual(left: AssistantTraceLiteRowViewProps, right: AssistantTraceLiteRowViewProps) {
  return (
    areAssistantTraceLiteRowsEqual(left.row, right.row) &&
    areTraceRowSharedPropsEqual(left, right)
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

const AssistantInlineSideChatRowView = memo(function AssistantInlineSideChatRowView({
  activeProjectID,
  attachments,
  assistantTraceVisibility,
  components,
  composerRefreshVersion,
  draftState,
  isAgentDebugTraceEnabled,
  isCancelling,
  isInterruptible,
  isResolvingPermissionRequest,
  isSending,
  isThreadVisible,
  messages,
  motion,
  onArtifactLinkOpen,
  onAskUserQuestionAnswer,
  onCancelSend,
  onCreateSideChat,
  onDeleteSideChat,
  onDraftStateChange,
  onHideSideChat,
  onLocalFileLinkOpen,
  onPasteImageAttachments,
  onPermissionRequestResponse,
  onPickAttachments,
  onRemoveAttachment,
  onSelectSideChat,
  onSend,
  onSessionModelSelectionChange,
  pendingInputs,
  pendingPermissionRequests,
  permissionRequestActionError,
  permissionRequestActionRequestID,
  readScrollSnapshot,
  row,
  saveScrollSnapshot,
}: AssistantInlineSideChatRowViewProps) {
  const { InlineSideChatThread } = components

  if (
    !onDraftStateChange ||
    !onPickAttachments ||
    !onRemoveAttachment ||
    !onCreateSideChat ||
    !onDeleteSideChat ||
    !onSelectSideChat ||
    !onSend
  ) {
    return null
  }

  return (
    <article
      className="thread-row assistant-inline-side-chat-row"
      data-thread-row-kind={row.kind}
      data-thread-message-id={row.messageID}
      data-thread-message-motion={motion}
    >
      <div className="assistant-response-side-chat">
        <InlineSideChatThread
          activeProjectID={activeProjectID}
          attachments={attachments}
          assistantTraceVisibility={assistantTraceVisibility}
          composerRefreshVersion={composerRefreshVersion}
          draftState={draftState}
          isAgentDebugTraceEnabled={isAgentDebugTraceEnabled}
          isResolvingPermissionRequest={isResolvingPermissionRequest}
          isCancelling={isCancelling}
          isInterruptible={isInterruptible}
          isSending={isSending}
          pendingInputs={pendingInputs}
          pendingPermissionRequests={pendingPermissionRequests}
          permissionRequestActionError={permissionRequestActionError}
          permissionRequestActionRequestID={permissionRequestActionRequestID}
          session={row.activeInlineSideChat}
          sideChatSessions={row.sideChatSessions}
          messages={messages}
          isThreadVisible={isThreadVisible}
          readScrollSnapshot={readScrollSnapshot}
          saveScrollSnapshot={saveScrollSnapshot}
          onDraftStateChange={onDraftStateChange}
          onHide={() => void onHideSideChat?.(row.sideChatAnchorMessageID)}
          onAskUserQuestionAnswer={onAskUserQuestionAnswer}
          onArtifactLinkOpen={onArtifactLinkOpen}
          onLocalFileLinkOpen={onLocalFileLinkOpen}
          onPermissionRequestResponse={onPermissionRequestResponse}
          onPickAttachments={onPickAttachments}
          onPasteImageAttachments={onPasteImageAttachments}
          onRemoveAttachment={onRemoveAttachment}
          onCancelSend={onCancelSend}
          onCreateSideChat={() => onCreateSideChat(row.sideChatAnchorMessageID)}
          onDeleteSideChat={onDeleteSideChat}
          onSend={onSend}
          onSelectSideChat={onSelectSideChat}
          onSessionModelSelectionChange={onSessionModelSelectionChange}
        />
      </div>
    </article>
  )
}, areAssistantInlineSideChatRowViewPropsEqual)

function areAssistantInlineSideChatRowsEqual(left: AssistantInlineSideChatRow, right: AssistantInlineSideChatRow) {
  return (
    left === right ||
    (
      left.rowID === right.rowID &&
      left.message === right.message &&
      left.messageID === right.messageID &&
      left.motionKey === right.motionKey &&
      left.activeInlineSideChat === right.activeInlineSideChat &&
      left.sideChatAnchorMessageID === right.sideChatAnchorMessageID &&
      left.sideChatSessions === right.sideChatSessions
    )
  )
}

function areAssistantInlineSideChatRowViewPropsEqual(left: AssistantInlineSideChatRowViewProps, right: AssistantInlineSideChatRowViewProps) {
  return (
    areAssistantInlineSideChatRowsEqual(left.row, right.row) &&
    left.activeProjectID === right.activeProjectID &&
    left.attachments === right.attachments &&
    areAssistantTraceVisibilityEqual(left.assistantTraceVisibility, right.assistantTraceVisibility) &&
    left.components === right.components &&
    left.composerRefreshVersion === right.composerRefreshVersion &&
    left.draftState === right.draftState &&
    left.isAgentDebugTraceEnabled === right.isAgentDebugTraceEnabled &&
    left.isCancelling === right.isCancelling &&
    left.isInterruptible === right.isInterruptible &&
    left.isResolvingPermissionRequest === right.isResolvingPermissionRequest &&
    left.isSending === right.isSending &&
    left.isThreadVisible === right.isThreadVisible &&
    left.messages === right.messages &&
    left.motion === right.motion &&
    left.onArtifactLinkOpen === right.onArtifactLinkOpen &&
    left.onAskUserQuestionAnswer === right.onAskUserQuestionAnswer &&
    left.onCancelSend === right.onCancelSend &&
    left.onCreateSideChat === right.onCreateSideChat &&
    left.onDeleteSideChat === right.onDeleteSideChat &&
    left.onDraftStateChange === right.onDraftStateChange &&
    left.onHideSideChat === right.onHideSideChat &&
    left.onLocalFileLinkOpen === right.onLocalFileLinkOpen &&
    left.onPasteImageAttachments === right.onPasteImageAttachments &&
    left.onPermissionRequestResponse === right.onPermissionRequestResponse &&
    left.onPickAttachments === right.onPickAttachments &&
    left.onRemoveAttachment === right.onRemoveAttachment &&
    left.onSelectSideChat === right.onSelectSideChat &&
    left.onSend === right.onSend &&
    left.onSessionModelSelectionChange === right.onSessionModelSelectionChange &&
    left.pendingInputs === right.pendingInputs &&
    left.pendingPermissionRequests === right.pendingPermissionRequests &&
    left.permissionRequestActionError === right.permissionRequestActionError &&
    left.permissionRequestActionRequestID === right.permissionRequestActionRequestID &&
    left.readScrollSnapshot === right.readScrollSnapshot &&
    left.saveScrollSnapshot === right.saveScrollSnapshot
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

export function ThreadRowRenderer({
  activeProjectID,
  activeSession,
  activeSessionDiff,
  assistantTraceVisibility,
  components,
  composerRefreshVersion,
  copiedResponseMessageID,
  copiedUserThreadMessageID,
  displayMessages,
  isAgentDebugTraceEnabled,
  isResolvingPermissionRequest,
  isThreadVisible,
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
  onSideChatCancelSend,
  onSideChatCreate,
  onSideChatDelete,
  onSideChatDraftStateChange,
  onSideChatPasteImageAttachments,
  onSideChatPickAttachments,
  onSideChatRemoveAttachment,
  onSideChatSelect,
  onSideChatSend,
  onSessionModelSelectionChange,
  pendingPermissionRequests,
  permissionRequestActionError,
  permissionRequestActionRequestID,
  readScrollSnapshot,
  readThreadMessageMotion,
  row,
  saveScrollSnapshot,
  sideChatAttachments,
  sideChatDraftState,
  sideChatIsCancelling,
  sideChatIsInterruptible,
  sideChatIsSending,
  sideChatMessages,
  sideChatPendingInputs,
  sideChatPendingPermissionRequests,
  sideChatPermissionRequestActionError,
  sideChatPermissionRequestActionRequestID,
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
    return (
      <AssistantTraceLiteRowView
        components={components}
        isQuestionAnswered={isTraceItemQuestionAnswered(row.traceItem.item)}
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

  if (row.kind === "assistant-inline-side-chat") {
    return (
      <AssistantInlineSideChatRowView
        activeProjectID={activeProjectID}
        attachments={sideChatAttachments}
        assistantTraceVisibility={assistantTraceVisibility}
        components={components}
        composerRefreshVersion={composerRefreshVersion}
        draftState={sideChatDraftState}
        isAgentDebugTraceEnabled={isAgentDebugTraceEnabled}
        isResolvingPermissionRequest={isResolvingPermissionRequest}
        isCancelling={sideChatIsCancelling}
        isInterruptible={sideChatIsInterruptible}
        isSending={sideChatIsSending}
        pendingInputs={sideChatPendingInputs}
        pendingPermissionRequests={sideChatPendingPermissionRequests}
        permissionRequestActionError={sideChatPermissionRequestActionError}
        permissionRequestActionRequestID={sideChatPermissionRequestActionRequestID}
        messages={sideChatMessages}
        isThreadVisible={isThreadVisible}
        readScrollSnapshot={readScrollSnapshot}
        saveScrollSnapshot={saveScrollSnapshot}
        onDraftStateChange={onSideChatDraftStateChange}
        onHideSideChat={onOpenSideChat}
        onAskUserQuestionAnswer={onAskUserQuestionAnswer}
        onArtifactLinkOpen={onArtifactLinkOpen}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
        onPermissionRequestResponse={onPermissionRequestResponse}
        onPickAttachments={onSideChatPickAttachments}
        onPasteImageAttachments={onSideChatPasteImageAttachments}
        onRemoveAttachment={onSideChatRemoveAttachment}
        onCancelSend={onSideChatCancelSend}
        onCreateSideChat={onSideChatCreate}
        onDeleteSideChat={onSideChatDelete}
        onSend={onSideChatSend}
        onSelectSideChat={onSideChatSelect}
        onSessionModelSelectionChange={onSessionModelSelectionChange}
        motion={readThreadMessageMotion(row.motionKey, row.message.isStreaming)}
        row={row}
      />
    )
  }

  return null
}
