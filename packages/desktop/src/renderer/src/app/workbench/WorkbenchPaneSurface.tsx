import { memo, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react"
import type { DesktopIpcOutput } from "../../../../shared/desktop-ipc-contract"
import { CreateSessionCanvas, getCreateSessionProjectWorkspaces } from "../canvas/CreateSessionCanvas"
import { SessionCanvasTopMenu, type SessionViewMode } from "../canvas/SessionCanvasTopMenu"
import { Composer } from "../composer/Composer"
import { ComposerConcurrentInputDrawer } from "../composer/ComposerConcurrentInputDrawer"
import { appendTextToComposerDraftState } from "../composer/draft-state"
import { useDeferredComposerDraftSync } from "../composer/use-deferred-composer-draft-sync"
import type { CodeHighlightTheme } from "../code-theme"
import { ComposerUtilityBar } from "../ComposerUtilityBar"
import { getSessionWorkflowBadge, type SessionWorkflowBadge as SessionWorkflowBadgeInfo } from "../session-workflow"
import { useI18n } from "../i18n/I18nProvider"
import type { MarkdownArtifactLinkTarget, MarkdownLocalFileLinkTarget } from "../thread-markdown"
import type {
  AssistantTraceVisibility,
  ComposerDraftState,
  ComposerPastedImageAttachment,
  PermissionDecision,
  PermissionRequest,
  ReasoningEffort,
  SessionDiffFile,
  SessionDiffSummary,
  SessionModelSelection,
  ToolPermissionMode,
  UserThreadMessage,
  WorkspaceGroup,
} from "../types"
import { useProjectComposer } from "../use-project-composer"
import { BranchThreadView, type BranchThreadViewSnapshot } from "../thread/BranchThreadView"
import {
  ThreadView,
  type ThreadNavigationRequest,
  type ThreadScrollSnapshot,
} from "../thread/ThreadView"
import { deriveActiveMessages } from "../thread-turn-state"
import type { WorkbenchPaneState } from "../agent-workspace/workspace-derived-state"
import { useConversationTurns, type ConversationStoreApi } from "../agent-workspace/conversation-store"
import type { ComposerCommandStatus } from "../agent-workspace/composer-controller"

const THREAD_TOP_RESET_THRESHOLD_PX = 2
const SESSION_BAG_DESCRIPTION_MAX_LENGTH = 2000

function ComposerPlanModeNotice({ workflow }: { workflow: SessionWorkflowBadgeInfo }) {
  return (
    <div className="composer-plan-mode-notice" role="status" title={workflow.description}>
      <span className="composer-plan-mode-dot" aria-hidden="true" />
      <span className="composer-plan-mode-label">{workflow.label}</span>
      <span className="composer-plan-mode-detail">Read-only research</span>
    </div>
  )
}

function ComposerBranchParentNotice({
  messagePreview,
  onClear,
}: {
  messagePreview?: string
  onClear: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="composer-branch-parent-notice" role="status">
      <span className="composer-branch-parent-label">{t("branchView.composerParent.label")}</span>
      <span className="composer-branch-parent-preview">
        {messagePreview || t("branchView.composerParent.fallback")}
      </span>
      <button
        className="composer-branch-parent-clear"
        type="button"
        aria-label={t("branchView.composerParent.clearAria")}
        onClick={onClear}
      >
        {t("branchView.composerParent.clear")}
      </button>
    </div>
  )
}

function ComposerCommandStatusNotice({ status }: { status: ComposerCommandStatus }) {
  const { t } = useI18n()
  const title = t(status.titleKey, status.titleParams)
  const detail = status.detailKey ? t(status.detailKey, status.detailParams) : ""

  return (
    <div className={`composer-command-status-notice is-${status.tone}`} role="status">
      <span className="composer-command-status-dot" aria-hidden="true" />
      <span className="composer-command-status-title">{title}</span>
      {detail ? <span className="composer-command-status-detail">{detail}</span> : null}
    </div>
  )
}

type SessionBagPrepareResult = DesktopIpcOutput<"desktop:prepare-session-bag-submission">
type SessionBagUploadResult = DesktopIpcOutput<"desktop:upload-session-bag-submission">

type SessionBagDialogState =
  | {
      stage: "preparing"
    }
  | {
      prepare: SessionBagPrepareResult
      stage: "confirm"
    }
  | {
      prepare: SessionBagPrepareResult
      stage: "uploading"
    }
  | {
      prepare: SessionBagPrepareResult
      result: SessionBagUploadResult
      stage: "success"
    }
  | {
      message: string
      prepare?: SessionBagPrepareResult
      stage: "error"
    }

function formatSessionBagSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "-"

  const units = ["B", "KB", "MB", "GB"] as const
  let value = sizeBytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return unitIndex === 0 ? `${Math.round(value)} ${units[unitIndex]}` : `${value.toFixed(1)} ${units[unitIndex]}`
}

function readSessionBagErrorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error.message : String(error || fallbackMessage)
}

function SessionBagSummary({ prepare }: { prepare: SessionBagPrepareResult }) {
  const { t } = useI18n()
  const targetAccount = [
    prepare.account?.email,
    prepare.account?.workspaceName,
    prepare.account?.planLabel,
  ].filter(Boolean).join(" / ")
  const redactionSummary = prepare.redaction.enabled
    ? t("workbench.sessionBag.redaction.enabled", {
        pattern: prepare.redaction.redactedKeyPattern || t("workbench.sessionBag.redaction.configured"),
        max: prepare.redaction.maxStringLength,
      })
    : t("workbench.sessionBag.redaction.disabled")

  return (
    <dl className="session-bag-summary">
      <div>
        <dt>{t("workbench.sessionBag.field.file")}</dt>
        <dd>{prepare.filename}</dd>
      </div>
      <div>
        <dt>{t("workbench.sessionBag.field.records")}</dt>
        <dd>{prepare.recordCount}</dd>
      </div>
      <div>
        <dt>{t("workbench.sessionBag.field.files")}</dt>
        <dd>{prepare.fileCount}</dd>
      </div>
      <div>
        <dt>{t("workbench.sessionBag.field.size")}</dt>
        <dd>{formatSessionBagSize(prepare.sizeBytes)}</dd>
      </div>
      <div>
        <dt>{t("workbench.sessionBag.field.target")}</dt>
        <dd>{targetAccount || prepare.baseURL || "Anybox"}</dd>
      </div>
      <div>
        <dt>{t("workbench.sessionBag.field.redaction")}</dt>
        <dd>{redactionSummary}</dd>
      </div>
    </dl>
  )
}

export function SessionBagSubmissionDialog({
  description,
  onDescriptionChange,
  state,
  onCancel,
  onClose,
  onSubmit,
}: {
  description: string
  onDescriptionChange: (description: string) => void
  state: SessionBagDialogState
  onCancel: () => void
  onClose: () => void
  onSubmit: () => void
}) {
  function handleOverlayClick(event: MouseEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return
    if (state.stage === "success") {
      onClose()
      return
    }
    if (state.stage === "preparing" || state.stage === "confirm" || state.stage === "error") {
      onCancel()
    }
  }

  function handleSuccessLinkClick(event: MouseEvent<HTMLAnchorElement>) {
    if (state.stage !== "success" || !state.result.url) return
    event.preventDefault()
    void window.desktop?.openExternalUrl?.({ url: state.result.url })
  }

  function handleDescriptionChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onDescriptionChange(event.currentTarget.value.slice(0, SESSION_BAG_DESCRIPTION_MAX_LENGTH))
  }

  const { t } = useI18n()
  const title =
    state.stage === "preparing"
      ? t("workbench.sessionBag.title.preparing")
      : state.stage === "uploading"
        ? t("workbench.sessionBag.title.uploading")
        : state.stage === "success"
          ? t("workbench.sessionBag.title.success")
          : state.stage === "error"
            ? t("workbench.sessionBag.title.error")
            : t("workbench.sessionBag.title.confirm")
  const preparedSummary = state.stage === "confirm" || state.stage === "uploading" || state.stage === "success"
    ? state.prepare
    : state.stage === "error"
      ? state.prepare
      : undefined
  const showDescriptionField =
    state.stage === "confirm" ||
    state.stage === "uploading" ||
    (state.stage === "error" && Boolean(state.prepare))
  const canEditDescription = state.stage === "confirm" || (state.stage === "error" && Boolean(state.prepare))

  return (
    <section className="session-bag-overlay" role="presentation" onClick={handleOverlayClick}>
      <article className={`session-bag-dialog is-${state.stage}`} role="dialog" aria-modal="true" aria-labelledby="session-bag-dialog-title">
        <header className="session-bag-header">
          <h2 id="session-bag-dialog-title">{title}</h2>
          <p>
            {state.stage === "preparing"
              ? t("workbench.sessionBag.description.preparing")
              : state.stage === "uploading"
                ? t("workbench.sessionBag.description.uploading")
                : state.stage === "success"
                  ? t("workbench.sessionBag.description.success")
                  : state.stage === "error"
                    ? state.message
                    : t("workbench.sessionBag.description.confirm")}
          </p>
        </header>

        {preparedSummary ? <SessionBagSummary prepare={preparedSummary} /> : null}

        {showDescriptionField ? (
          <div className="session-bag-problem-field">
            <label className="session-bag-problem-label" htmlFor="session-bag-problem-description">
              {t("workbench.sessionBag.problem.label")}
            </label>
            <textarea
              id="session-bag-problem-description"
              value={description}
              placeholder={t("workbench.sessionBag.problem.placeholder")}
              maxLength={SESSION_BAG_DESCRIPTION_MAX_LENGTH}
              rows={5}
              disabled={!canEditDescription}
              aria-describedby="session-bag-problem-help session-bag-problem-count"
              onChange={handleDescriptionChange}
            />
            <span className="session-bag-problem-footer">
              <span id="session-bag-problem-help">{t("workbench.sessionBag.problem.hint")}</span>
              <span id="session-bag-problem-count">
                {t("workbench.sessionBag.problem.count", {
                  count: description.length,
                  max: SESSION_BAG_DESCRIPTION_MAX_LENGTH,
                })}
              </span>
            </span>
          </div>
        ) : null}

        {state.stage === "success" ? (
          <div className="session-bag-success">
            <span>{t("workbench.sessionBag.success.reportId")}</span>
            <code>{state.result.bagID}</code>
            {state.result.url ? (
              <a href={state.result.url} onClick={handleSuccessLinkClick}>
                {t("workbench.sessionBag.success.open")}
              </a>
            ) : null}
          </div>
        ) : null}

        {state.stage === "error" ? (
          <p className="session-bag-error" role="alert">
            {state.message}
          </p>
        ) : null}

        <footer className="session-bag-actions">
          {state.stage === "success" ? (
            <button className="primary-button" type="button" onClick={onClose}>
              {t("app.close")}
            </button>
          ) : state.stage === "confirm" ? (
            <>
              <button className="secondary-button" type="button" onClick={onCancel}>
                {t("app.cancel")}
              </button>
              <button className="primary-button" type="button" onClick={onSubmit}>
                {t("workbench.sessionBag.action.submit")}
              </button>
            </>
          ) : state.stage === "error" ? (
            <>
              <button className="secondary-button" type="button" onClick={onCancel}>
                {t("app.close")}
              </button>
              {state.prepare ? (
                <button className="primary-button" type="button" onClick={onSubmit}>
                  {t("workbench.sessionBag.action.retry")}
                </button>
              ) : null}
            </>
          ) : state.stage === "preparing" ? (
            <button className="secondary-button" type="button" onClick={onCancel}>
              {t("app.cancel")}
            </button>
          ) : (
            <button className="secondary-button" type="button" disabled>
              {t("workbench.sessionBag.action.uploading")}
            </button>
          )}
        </footer>
      </article>
    </section>
  )
}

export interface WorkbenchPaneSurfaceProps {
  assistantTraceVisibility: AssistantTraceVisibility
  codeTheme: CodeHighlightTheme
  composerCommandStatusByTabKey?: Record<string, ComposerCommandStatus>
  composerRefreshVersion: number
  conversationStore: ConversationStoreApi
  isResolvingPermissionRequest: boolean
  isSavingToolPermissionMode: boolean
  isTopRow: boolean
  pane: WorkbenchPaneState
  permissionRequestActionError: string | null
  permissionRequestActionRequestID: string | null
  toolPermissionMode: ToolPermissionMode
  toolPermissionModeError: string | null
  conversationWorkspaceID?: string | null
  workspaces: WorkspaceGroup[]
  readThreadScrollSnapshot: (key: string) => ThreadScrollSnapshot | null
  saveThreadScrollSnapshot: (key: string, snapshot: ThreadScrollSnapshot) => void
  threadNavigationRequestBySession?: Record<string, ThreadNavigationRequest>
  onCreateSessionSubmit: (createSessionTabID?: string | null, paneID?: string) => Promise<void>
  onCreateSessionWorkspaceChange: (workspaceID: string, createSessionTabID?: string | null) => void
  onOpenProjectFolder: () => void | Promise<void>
  onInspectFileInSidebar: (file: string | null, sessionID: string | null, paneID: string) => void
  onInspectMessageInSidebar: (messageID: string, sessionID: string, paneID: string) => void
  onArtifactLinkOpen?: (input: {
    paneID: string
    sessionID: string | null
    target: MarkdownArtifactLinkTarget
    workspaceDirectory: string | null
    workspaceID: string | null
  }) => void
  onLocalFileLinkOpen: (input: {
    paneID: string
    sessionID: string | null
    target: MarkdownLocalFileLinkTarget
    workspaceDirectory: string | null
    workspaceID: string | null
  }) => void
  onOpenSubagentSession?: (sessionID: string, title?: string) => void | Promise<void>
  onBranchSelect: (input: { messageID: string; sessionID?: string | null }) => Promise<void>
  onClearComposerParentMessage: (input?: { tabKey?: string | null }) => void
  onForkFromMessage: (messageID: string, options?: { tabKey?: string | null }) => void
  onOpenBranchChat?: (input: {
    messageID: string
    paneID: string
    quoteText?: string
    sessionID: string
  }) => void
  onAskUserQuestionAnswer: (input: {
    freeformText?: string
    questionID?: string
    selectedOptions?: string[]
    sessionID?: string | null
    tabKey?: string | null
    text: string
  }) => Promise<void>
  onApproveProposedPlan: (input: {
    planMarkdown: string
    selectedReasoningEffort?: ReasoningEffort | null
    selectedModel?: string | null
    selectedSkillIDs?: string[]
    sessionID?: string | null
    tabKey?: string | null
    waitForPendingModelSelection?: (() => Promise<void>) | null
  }) => Promise<void>
  onPermissionRequestResponse: (input: {
    sessionID: string
    request: PermissionRequest
    decision: PermissionDecision
    note?: string
  }) => Promise<void>
  onToolPermissionModeChange: (mode: ToolPermissionMode) => void | Promise<void>
  onPickComposerAttachments: (input: { allowImage: boolean; allowPdf: boolean; disabledReason: string | null; tabKey?: string | null }) => Promise<void>
  onPasteComposerImageAttachments: (input: { allowImage: boolean; disabledReason?: string | null; images: ComposerPastedImageAttachment[]; tabKey?: string | null }) => Promise<void>
  onRemoveComposerAttachment: (path: string, tabKey?: string | null) => void
  onCancelSend: (input?: { sessionID?: string | null; tabKey?: string | null }) => Promise<void>
  onPlanModeToggle: (input: { createSessionTabID?: string | null; sessionID?: string | null }) => Promise<void>
  onSend: (input?: {
    attachmentError?: string | null
    createSessionTabID?: string | null
    draftStateOverride?: ComposerDraftState
    paneID?: string | null
    preserveComposerState?: boolean
    questionAnswer?: {
      questionID: string
      selectedOptions?: string[]
      freeformText?: string
    }
    selectedReasoningEffort?: ReasoningEffort | null
    selectedModel?: string | null
    selectedSkillIDs?: string[]
    sessionID?: string | null
    steerQueuedMessageID?: string
    submissionMode?: UserThreadMessage["submissionMode"]
    tabKey?: string | null
    waitForPendingModelSelection?: (() => Promise<void>) | null
  }) => Promise<void>
  onSessionModelSelectionChange: (sessionID: string, selection: SessionModelSelection | undefined) => void
  onSetDraft: (tabKey: string, value: ComposerDraftState) => void
  onMessageDiffRestore: (diffs: SessionDiffFile[], sessionID: string | null, paneID: string) => void | Promise<void>
  onMessageDiffReview: (files: string[], sessionID: string | null, paneID: string) => void | Promise<void>
  onMessageDiffSummaryHydrate: (messageID: string, diffSummary: SessionDiffSummary, sessionID?: string | null) => void | Promise<void>
}

export function resolveWorkbenchPaneNavigationRequest(
  paneID: string,
  sessionID: string | null | undefined,
  requestsBySession?: Record<string, ThreadNavigationRequest>,
) {
  if (!sessionID) return null
  const request = requestsBySession?.[sessionID] ?? null
  if (request?.paneID && request.paneID !== paneID) return null
  return request
}

function InactiveWorkbenchPaneSurface({
  isTopRow,
  pane,
}: Pick<WorkbenchPaneSurfaceProps, "isTopRow" | "pane">) {
  return (
    <section
      className={pane.isFocused ? "workbench-pane is-focused" : "workbench-pane"}
      data-is-top-row={isTopRow ? "true" : "false"}
      data-pane-id={pane.id}
    >
      <div className="workbench-pane-stage">
        <div className="workbench-pane-live-region is-dockview-managed" />
      </div>
    </section>
  )
}

export const WorkbenchPaneSurface = memo(function WorkbenchPaneSurface(props: WorkbenchPaneSurfaceProps) {
  const lastActivePropsRef = useRef<WorkbenchPaneSurfaceProps | null>(null)
  const lastPaneActiveRef = useRef(false)
  const threadActivationVersionRef = useRef(0)

  if (props.pane.isActivePanel && !lastPaneActiveRef.current) {
    threadActivationVersionRef.current += 1
  }
  lastPaneActiveRef.current = props.pane.isActivePanel
  const threadActivationVersion = threadActivationVersionRef.current

  if (props.pane.isActivePanel || import.meta.env.MODE === "test") {
    lastActivePropsRef.current = props
    return (
      <ActiveWorkbenchPaneSurface
        {...props}
        threadActivationVersion={threadActivationVersion}
      />
    )
  }

  const cachedProps = lastActivePropsRef.current
  if (cachedProps) {
    return (
      <ActiveWorkbenchPaneSurface
        {...cachedProps}
        threadActivationVersion={threadActivationVersion}
      />
    )
  }

  if (!props.pane.isActivePanel) {
    return <InactiveWorkbenchPaneSurface isTopRow={props.isTopRow} pane={props.pane} />
  }

  return (
    <ActiveWorkbenchPaneSurface
      {...props}
      threadActivationVersion={threadActivationVersion}
    />
  )
})

interface ActiveWorkbenchPaneSurfaceProps extends WorkbenchPaneSurfaceProps {
  threadActivationVersion: number
}

export function useWorkbenchPaneConversationSnapshot(
  conversationStore: ConversationStoreApi,
  sessionID: string | null | undefined,
) {
  const activeTurns = useConversationTurns(conversationStore, sessionID)
  const activeMessages = useMemo(() => deriveActiveMessages(activeTurns), [activeTurns])

  return { activeMessages, activeTurns }
}

const ActiveWorkbenchPaneSurface = memo(function ActiveWorkbenchPaneSurface({
  assistantTraceVisibility,
  codeTheme,
  composerCommandStatusByTabKey,
  composerRefreshVersion,
  conversationStore,
  isResolvingPermissionRequest,
  isSavingToolPermissionMode,
  isTopRow,
  pane,
  permissionRequestActionError,
  permissionRequestActionRequestID,
  toolPermissionMode,
  toolPermissionModeError,
  conversationWorkspaceID = null,
  workspaces,
  readThreadScrollSnapshot,
  saveThreadScrollSnapshot,
  threadNavigationRequestBySession,
  onCreateSessionSubmit,
  onCreateSessionWorkspaceChange,
  onOpenProjectFolder,
  onInspectFileInSidebar,
  onInspectMessageInSidebar,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  onOpenSubagentSession,
  onBranchSelect,
  onClearComposerParentMessage,
  onForkFromMessage,
  onOpenBranchChat,
  onAskUserQuestionAnswer,
  onApproveProposedPlan,
  onPermissionRequestResponse,
  onToolPermissionModeChange,
  onPickComposerAttachments,
  onPasteComposerImageAttachments,
  onRemoveComposerAttachment,
  onCancelSend,
  onPlanModeToggle,
  onSend,
  onSessionModelSelectionChange,
  onSetDraft,
  onMessageDiffRestore,
  onMessageDiffReview,
  onMessageDiffSummaryHydrate,
  threadActivationVersion,
}: ActiveWorkbenchPaneSurfaceProps) {
  const { t } = useI18n()
  const threadColumnRef = useRef<HTMLDivElement | null>(null)
  const bagOperationVersionRef = useRef(0)
  const branchViewSnapshotsRef = useRef<Record<string, BranchThreadViewSnapshot>>({})
  const [bagDialogState, setBagDialogState] = useState<SessionBagDialogState | null>(null)
  const [bagDescription, setBagDescription] = useState("")
  const [sessionViewModeByTabKey, setSessionViewModeByTabKey] = useState<Record<string, SessionViewMode>>({})
  const sessionViewStateKey = pane.tabKey ?? pane.sessionID ?? pane.id
  const sessionViewMode = sessionViewModeByTabKey[sessionViewStateKey] ?? "linear"
  const branchViewSnapshotKey = `${sessionViewStateKey}:${pane.sessionID ?? "none"}`
  const { activeMessages, activeTurns } = useWorkbenchPaneConversationSnapshot(
    conversationStore,
    pane.sessionID,
  )
  const paneNavigationRequest = resolveWorkbenchPaneNavigationRequest(
    pane.id,
    pane.sessionID,
    threadNavigationRequestBySession,
  )

  const composerParentMessagePreview = pane.composerParentMessageID
    ? pane.messageTree?.nodesByID[pane.composerParentMessageID]?.preview
    : undefined

  useLayoutEffect(() => {
    const threadColumn = threadColumnRef.current
    const scrollStateKey = pane.tabKey
    if (!threadColumn || !scrollStateKey) return
    if (threadColumn.scrollTop > THREAD_TOP_RESET_THRESHOLD_PX) return

    const snapshot = readThreadScrollSnapshot(scrollStateKey)
    if (!snapshot || snapshot.pinnedToBottom || snapshot.scrollTop <= THREAD_TOP_RESET_THRESHOLD_PX) return
    if (snapshot.anchor) return

    const maxScrollTop = Math.max(0, threadColumn.scrollHeight - threadColumn.clientHeight)
    if (maxScrollTop <= THREAD_TOP_RESET_THRESHOLD_PX) return

    threadColumn.scrollTop = Math.min(snapshot.scrollTop, maxScrollTop)
  })

  const composer = useProjectComposer({
    attachmentPaths: pane.composerAttachments.map((attachment) => attachment.path),
    onSessionModelSelectionChange,
    projectID: pane.composerProjectID,
    refreshToken: composerRefreshVersion,
    sessionModelSelection: pane.activeSession?.modelSelection,
    sessionID: pane.sessionID,
  })
  const showGitControls = pane.isActivePanel
  const mainSessionBagSessionID = pane.activeSession && pane.sessionID ? pane.sessionID : null
  const pendingSubmissionInputs = useMemo(
    () => [...pane.pendingConversationInputs].sort((left, right) => left.createdAt - right.createdAt),
    [pane.pendingConversationInputs],
  )
  const {
    flushDraftSync,
    scheduleDraftSync,
  } = useDeferredComposerDraftSync({
    draftKey: pane.tabKey,
    onSync: onSetDraft,
  })
  const composerWorkflowBadge = getSessionWorkflowBadge(pane.activeSession?.workflow)
  const composerCommandStatus = pane.tabKey ? composerCommandStatusByTabKey?.[pane.tabKey] ?? null : null
  const addImageToComposerDisabledReason = composer.attachmentCapabilities.image
    ? composer.attachmentDisabledReason
    : composer.attachmentDisabledReason ?? "The current model does not support image input."
  const createSessionWorkflowBadge =
    pane.createSessionInitialWorkflowMode === "planning"
      ? getSessionWorkflowBadge({
          mode: "planning",
          plan: {
            status: "idle",
            updatedAt: 0,
          },
        })
      : null

  const createSessionProjectWorkspaces = useMemo(
    () => getCreateSessionProjectWorkspaces(workspaces, conversationWorkspaceID),
    [conversationWorkspaceID, workspaces],
  )
  const canCreateProjectSession = Boolean(
    pane.createSessionWorkspaceID &&
      createSessionProjectWorkspaces.some((workspace) => workspace.id === pane.createSessionWorkspaceID),
  )
  async function discardPreparedSessionBag(prepare: SessionBagPrepareResult | undefined) {
    if (!prepare) return
    await window.desktop?.discardSessionBagSubmission?.({ submissionID: prepare.submissionID }).catch(() => undefined)
  }

  async function handlePrepareSessionBag(input: {
    projectID?: string | null
    sessionID: string
    workspaceDirectory?: string | null
  }) {
    const operationVersion = bagOperationVersionRef.current + 1
    bagOperationVersionRef.current = operationVersion
    setBagDescription("")
    const prepareSessionBag = window.desktop?.prepareSessionBagSubmission
    if (!prepareSessionBag) {
      setBagDialogState({
        stage: "error",
        message: t("workbench.sessionBag.error.prepareBridgeUnavailable"),
      })
      return
    }

    setBagDialogState({ stage: "preparing" })
    try {
      const prepare = await prepareSessionBag(input)
      if (bagOperationVersionRef.current !== operationVersion) {
        void discardPreparedSessionBag(prepare)
        return
      }

      setBagDialogState({
        stage: "confirm",
        prepare,
      })
    } catch (error) {
      if (bagOperationVersionRef.current !== operationVersion) return

      setBagDialogState({
        stage: "error",
        message: readSessionBagErrorMessage(error, t("workbench.sessionBag.error.fallback")),
      })
    }
  }

  async function handleConfirmSessionBagUpload() {
    bagOperationVersionRef.current += 1
    const currentState = bagDialogState
    const prepare = currentState?.stage === "confirm" || currentState?.stage === "uploading" || currentState?.stage === "success"
      ? currentState.prepare
      : currentState?.stage === "error"
        ? currentState.prepare
        : undefined
    if (!prepare) return

    const uploadSessionBag = window.desktop?.uploadSessionBagSubmission
    if (!uploadSessionBag) {
      setBagDialogState({
        stage: "error",
        prepare,
        message: t("workbench.sessionBag.error.uploadBridgeUnavailable"),
      })
      return
    }

    setBagDialogState({
      stage: "uploading",
      prepare,
    })
    try {
      const result = await uploadSessionBag({
        submissionID: prepare.submissionID,
        description: bagDescription,
      })
      setBagDialogState({
        stage: "success",
        prepare,
        result,
      })
    } catch (error) {
      setBagDialogState({
        stage: "error",
        prepare,
        message: readSessionBagErrorMessage(error, t("workbench.sessionBag.error.fallback")),
      })
    }
  }

  function handleCancelSessionBagDialog() {
    bagOperationVersionRef.current += 1
    const currentState = bagDialogState
    const prepare = currentState?.stage === "confirm" || currentState?.stage === "uploading" || currentState?.stage === "success"
      ? currentState.prepare
      : currentState?.stage === "error"
        ? currentState.prepare
        : undefined
    setBagDialogState(null)
    setBagDescription("")
    if (currentState?.stage !== "success") {
      void discardPreparedSessionBag(prepare)
    }
  }

  function handleCloseSessionBagDialog() {
    bagOperationVersionRef.current += 1
    setBagDialogState(null)
    setBagDescription("")
  }

  function handleAddTextToComposer(text: string) {
    if (!pane.tabKey) return

    const pendingDraft = flushDraftSync()
    const draftState = pendingDraft?.draftState ?? pane.draftState
    onSetDraft(pane.tabKey, appendTextToComposerDraftState(draftState, text))
  }

  return (
    <section
      className={pane.isFocused ? "workbench-pane is-focused" : "workbench-pane"}
      data-is-top-row={isTopRow ? "true" : "false"}
      data-pane-id={pane.id}
    >
      <div className="workbench-pane-stage">
        <div className="workbench-pane-live-region is-dockview-managed">
            <SessionCanvasTopMenu
              activeSession={pane.activeSession}
              sessionViewMode={sessionViewMode}
              onSessionViewModeChange={(mode) => {
                setSessionViewModeByTabKey((current) => ({
                  ...current,
                  [sessionViewStateKey]: mode,
                }))
              }}
              sessionTasks={pane.activeSessionTasks ?? pane.activeSessionRuntimeDebug?.tasks ?? null}
              gitProjectID={pane.projectID}
              gitDirectory={pane.workspace?.directory ?? null}
              showGitControls={showGitControls}
              isSavingToolPermissionMode={isSavingToolPermissionMode}
              mcpOptions={composer.mcpOptions}
              pluginOptions={composer.pluginOptions}
              pendingPermissionRequests={pane.pendingPermissionRequests}
              selectedMcpServerIDs={composer.selectedMcpServerIDs}
              selectedMcpServerLabel={composer.selectedMcpLabel}
              onMcpServerToggle={composer.handleMcpToggle}
              selectedPluginIDs={composer.selectedPluginIDs}
              selectedPluginLabel={composer.selectedPluginLabel}
              onPluginToggle={composer.handlePluginToggle}
              toolPermissionMode={toolPermissionMode}
              toolPermissionModeError={toolPermissionModeError}
              onToolPermissionModeChange={onToolPermissionModeChange}
              onOpenReview={() => onMessageDiffReview([], pane.sessionID, pane.id)}
              onOpenSubagentSession={onOpenSubagentSession}
              skillOptions={composer.skillOptions}
              selectedSkillIDs={composer.selectedSkillIDs}
              selectedSkillLabel={composer.selectedSkillLabel}
              onSkillToggle={composer.handleSkillToggle}
            />
          {pane.createSessionTabID ? (
            <div className="create-session-layout">
                <CreateSessionCanvas
                  conversationWorkspaceID={conversationWorkspaceID}
                  isCreatingSession={pane.isCreatingSession}
                  selectedWorkspaceID={pane.createSessionWorkspaceID}
                  workspaces={workspaces}
                  onOpenProjectFolder={onOpenProjectFolder}
                  onWorkspaceChange={(workspaceID) => onCreateSessionWorkspaceChange(workspaceID, pane.createSessionTabID)}
                />
              <div className="composer-stack create-session-composer-stack">
                  <Composer
                    attachments={pane.composerAttachments}
                    attachmentButtonTitle={composer.attachmentButtonTitle}
                    attachmentDisabledReason={composer.attachmentDisabledReason}
                    attachmentError={composer.attachmentError}
                    canSend={canCreateProjectSession}
                    canPasteImageAttachments={composer.attachmentCapabilities.image && composer.attachmentDisabledReason === null}
                    draftState={pane.draftState}
                    hasPendingPermissionRequests={false}
                    isCancelling={pane.isCancelling}
                    isInterruptible={pane.isInterruptible || pane.isCreatingSession}
                    isSending={pane.isSending || pane.isCreatingSession}
                    mcpOptions={composer.mcpOptions}
                    modelOptions={composer.modelOptions}
                    onDraftStateChange={scheduleDraftSync}
                    onPluginToggle={composer.handlePluginToggle}
                    pluginOptions={composer.pluginOptions}
                    reasoningEffortOptions={composer.reasoningEffortOptions}
                    selectedMcpServerIDs={composer.selectedMcpServerIDs}
                    selectedModel={composer.selectedModel}
                    selectedModelLabel={composer.selectedModelLabel}
                    selectedPluginIDs={composer.selectedPluginIDs}
                    selectedReasoningEffort={composer.selectedReasoningEffort}
                    selectedReasoningEffortLabel={composer.selectedReasoningEffortLabel}
                    selectedSkillIDs={composer.selectedSkillIDs}
                    showModelSelector
                    showProjectTagCommands
                    skillOptions={composer.skillOptions}
                    unsupportedAttachmentPaths={composer.unsupportedAttachmentPaths}
                    workspaceDirectory={pane.workspace?.directory ?? null}
                    onModelChange={composer.handleModelChange}
                    onReasoningEffortChange={composer.handleReasoningEffortChange}
                    onPickAttachments={() =>
                      onPickComposerAttachments({
                        allowImage: composer.attachmentCapabilities.image,
                        allowPdf: composer.attachmentCapabilities.pdf,
                        disabledReason: composer.attachmentDisabledReason,
                        tabKey: pane.tabKey,
                      })
                    }
                    onPasteImageAttachments={(images) =>
                      onPasteComposerImageAttachments({
                        allowImage: composer.attachmentCapabilities.image,
                        disabledReason: composer.attachmentDisabledReason,
                        images,
                        tabKey: pane.tabKey,
                      })
                    }
                    onPlanModeToggle={
                      pane.createSessionTabID
                        ? () => void onPlanModeToggle({ createSessionTabID: pane.createSessionTabID })
                        : () => void onPlanModeToggle({ sessionID: pane.sessionID })
                    }
                    onRemoveAttachment={(path) => onRemoveComposerAttachment(path, pane.tabKey)}
                    onCancelSend={() => void onCancelSend({ tabKey: pane.tabKey })}
                    onSend={(draftStateOverride) => {
                      flushDraftSync()
                      void onSend({
                        attachmentError: composer.attachmentError,
                        createSessionTabID: pane.createSessionTabID,
                        draftStateOverride,
                        paneID: pane.id,
                        selectedReasoningEffort: composer.selectedReasoningEffort,
                        selectedModel: composer.selectedModel,
                        selectedSkillIDs: composer.selectedSkillIDs,
                        tabKey: pane.tabKey,
                        waitForPendingModelSelection: composer.awaitPendingModelSelection,
                      })
                    }}
                  />
                {createSessionWorkflowBadge ? <ComposerPlanModeNotice workflow={createSessionWorkflowBadge} /> : null}
                <ComposerUtilityBar
                  contextWindow={composer.contextWindow}
                  gitDirectory={pane.workspace?.directory ?? null}
                  gitProjectID={pane.projectID}
                  showGitControls={pane.isActivePanel}
                  usage={null}
                />
              </div>
            </div>
          ) : (
            <>
              {sessionViewMode === "branch" ? (
                <BranchThreadView
                  initialSnapshot={branchViewSnapshotsRef.current[branchViewSnapshotKey] ?? null}
                  isSessionRunning={pane.isSending || pane.isInterruptible}
                  messageTree={pane.messageTree}
                  onContinueFromMessage={(messageID) => {
                    if (pane.tabKey) {
                      onForkFromMessage(messageID, { tabKey: pane.tabKey })
                    }
                  }}
                  onInspectMessage={(messageID) => {
                    if (!pane.sessionID) return
                    onInspectMessageInSidebar(messageID, pane.sessionID, pane.id)
                  }}
                  onSnapshotChange={(snapshot) => {
                    branchViewSnapshotsRef.current[branchViewSnapshotKey] = snapshot
                  }}
                />
              ) : (
                <ThreadView
                  activeSession={pane.activeSession}
                  activeSessionDiff={pane.activeSessionDiff}
                  assistantTraceVisibility={assistantTraceVisibility}
                  codeTheme={codeTheme}
                  isResolvingPermissionRequest={isResolvingPermissionRequest}
                  isSessionRunning={pane.isSending || pane.isInterruptible}
                  pendingPermissionRequests={pane.pendingPermissionRequests}
                  pendingConversationInputs={pane.pendingConversationInputs}
                  permissionRequestActionError={permissionRequestActionError}
                  permissionRequestActionRequestID={permissionRequestActionRequestID}
                  activeMessages={activeMessages}
                  activeTurns={activeTurns}
                  messageTree={pane.messageTree}
                  scrollStateKey={pane.tabKey}
                  threadColumnRef={threadColumnRef}
                  isThreadVisible={pane.isActivePanel}
                  navigationRequest={paneNavigationRequest}
                  virtualMeasurementKey={`${pane.tabKey ?? pane.sessionID ?? pane.id}:${String(threadActivationVersion)}`}
                  readScrollSnapshot={readThreadScrollSnapshot}
                  saveScrollSnapshot={saveThreadScrollSnapshot}
                  onBranchSelect={(messageID) => onBranchSelect({ messageID, sessionID: pane.sessionID })}
                  onForkFromMessage={(messageID) => {
                    if (pane.sessionID && onOpenBranchChat) {
                      onOpenBranchChat({
                        messageID,
                        paneID: pane.id,
                        sessionID: pane.sessionID,
                      })
                      return
                    }
                    onForkFromMessage(messageID, { tabKey: pane.tabKey })
                  }}
                  onBranchChatFromSelection={({ messageID, text }) => {
                    if (!pane.sessionID || !onOpenBranchChat) return
                    onOpenBranchChat({
                      messageID,
                      paneID: pane.id,
                      quoteText: text,
                      sessionID: pane.sessionID,
                    })
                  }}
                  onAskUserQuestionAnswer={(answer) =>
                    onAskUserQuestionAnswer({
                      freeformText: answer.freeformText,
                      questionID: answer.questionID,
                      selectedOptions: answer.selectedOptions,
                      sessionID: pane.sessionID,
                      tabKey: pane.tabKey,
                      text: answer.text,
                    })
                  }
                  onFileChangeSelect={(file) => onInspectFileInSidebar(file, pane.sessionID, pane.id)}
                  onMessageDiffRestore={(files) => onMessageDiffRestore(files, pane.sessionID, pane.id)}
                  onMessageDiffReview={(files) => onMessageDiffReview(files, pane.sessionID, pane.id)}
                  onMessageDiffSummaryHydrate={(messageID, diffSummary) => onMessageDiffSummaryHydrate(messageID, diffSummary, pane.sessionID)}
                  onArtifactLinkOpen={(target) =>
                    onArtifactLinkOpen?.({
                      paneID: pane.id,
                      sessionID: pane.sessionID,
                      target,
                      workspaceDirectory: pane.workspace?.directory ?? null,
                      workspaceID: pane.workspace?.id ?? null,
                    })
                  }
                  onLocalFileLinkOpen={(target) =>
                    onLocalFileLinkOpen({
                      paneID: pane.id,
                      sessionID: pane.sessionID,
                      target,
                      workspaceDirectory: pane.workspace?.directory ?? null,
                      workspaceID: pane.workspace?.id ?? null,
                    })
                  }
                  onAddToComposer={handleAddTextToComposer}
                  onAddImageToComposer={(images) =>
                    onPasteComposerImageAttachments({
                      allowImage: composer.attachmentCapabilities.image,
                      disabledReason: composer.attachmentDisabledReason,
                      images,
                      tabKey: pane.tabKey,
                    })
                  }
                  addImageToComposerDisabledReason={addImageToComposerDisabledReason}
                  onProposedPlanConfirm={(input) =>
                    onApproveProposedPlan({
                      planMarkdown: input.planMarkdown,
                      selectedReasoningEffort: composer.selectedReasoningEffort,
                      selectedModel: composer.selectedModel,
                      selectedSkillIDs: composer.selectedSkillIDs,
                      sessionID: pane.sessionID,
                      tabKey: pane.tabKey,
                      waitForPendingModelSelection: composer.awaitPendingModelSelection,
                    })
                  }
                  onPermissionRequestResponse={onPermissionRequestResponse}
                />
              )}
              <div className="composer-stack">
                <ComposerConcurrentInputDrawer
                  canSteer={Boolean(pane.activeSession)}
                  hasPendingPermissionRequests={pane.pendingPermissionRequests.length > 0 || isResolvingPermissionRequest}
                  isCancelling={pane.isCancelling}
                  pendingInputs={pendingSubmissionInputs}
                  onSteerQueuedMessage={(input) => {
                    void onSend({
                      paneID: pane.id,
                      selectedReasoningEffort: composer.selectedReasoningEffort,
                      selectedModel: composer.selectedModel,
                      selectedSkillIDs: composer.selectedSkillIDs,
                      sessionID: pane.sessionID,
                      steerQueuedMessageID: input.id,
                      tabKey: pane.tabKey,
                      waitForPendingModelSelection: composer.awaitPendingModelSelection,
                    })
                  }}
                />
                  <Composer
                    attachments={pane.composerAttachments}
                    attachmentButtonTitle={composer.attachmentButtonTitle}
                    attachmentDisabledReason={composer.attachmentDisabledReason}
                    attachmentError={composer.attachmentError}
                    canSend={Boolean(pane.activeSession)}
                    canPasteImageAttachments={composer.attachmentCapabilities.image && composer.attachmentDisabledReason === null}
                    draftState={pane.draftState}
                    hasBagSubmit={mainSessionBagSessionID !== null}
                    hasCompactCommand={Boolean(pane.activeSession)}
                    hasPendingPermissionRequests={pane.pendingPermissionRequests.length > 0 || isResolvingPermissionRequest}
                    isCancelling={pane.isCancelling}
                    isInterruptible={pane.isInterruptible}
                    isSending={pane.isSending}
                    mcpOptions={composer.mcpOptions}
                    modelOptions={composer.modelOptions}
                    onDraftStateChange={scheduleDraftSync}
                    onPluginToggle={composer.handlePluginToggle}
                    pluginOptions={composer.pluginOptions}
                    reasoningEffortOptions={composer.reasoningEffortOptions}
                    selectedMcpServerIDs={composer.selectedMcpServerIDs}
                    selectedModel={composer.selectedModel}
                    selectedModelLabel={composer.selectedModelLabel}
                    selectedPluginIDs={composer.selectedPluginIDs}
                    selectedReasoningEffort={composer.selectedReasoningEffort}
                    selectedReasoningEffortLabel={composer.selectedReasoningEffortLabel}
                    selectedSkillIDs={composer.selectedSkillIDs}
                    showModelSelector
                    showProjectTagCommands
                    skillOptions={composer.skillOptions}
                    unsupportedAttachmentPaths={composer.unsupportedAttachmentPaths}
                    workspaceDirectory={pane.workspace?.directory ?? null}
                    onModelChange={composer.handleModelChange}
                    onReasoningEffortChange={composer.handleReasoningEffortChange}
                    onPickAttachments={() =>
                      onPickComposerAttachments({
                        allowImage: composer.attachmentCapabilities.image,
                        allowPdf: composer.attachmentCapabilities.pdf,
                        disabledReason: composer.attachmentDisabledReason,
                        tabKey: pane.tabKey,
                      })
                    }
                    onPasteImageAttachments={(images) =>
                      onPasteComposerImageAttachments({
                        allowImage: composer.attachmentCapabilities.image,
                        disabledReason: composer.attachmentDisabledReason,
                        images,
                        tabKey: pane.tabKey,
                      })
                    }
                    onPlanModeToggle={() => void onPlanModeToggle({ sessionID: pane.sessionID })}
                    onSubmitBag={
                      mainSessionBagSessionID === null
                        ? undefined
                        : () => void handlePrepareSessionBag({
                            sessionID: mainSessionBagSessionID,
                            projectID: pane.projectID,
                            workspaceDirectory: pane.workspace?.directory ?? null,
                          })
                    }
                    onRemoveAttachment={(path) => onRemoveComposerAttachment(path, pane.tabKey)}
                    onCancelSend={() => void onCancelSend({
                      sessionID: pane.sessionID,
                      tabKey: pane.tabKey,
                    })}
                    onSend={(draftStateOverride) => {
                      flushDraftSync()
                      void onSend({
                        attachmentError: composer.attachmentError,
                        draftStateOverride,
                        paneID: pane.id,
                        selectedReasoningEffort: composer.selectedReasoningEffort,
                        selectedModel: composer.selectedModel,
                        selectedSkillIDs: composer.selectedSkillIDs,
                        sessionID: pane.sessionID,
                        submissionMode: pane.isSending || pane.isInterruptible ? "queued" : undefined,
                        tabKey: pane.tabKey,
                        waitForPendingModelSelection: composer.awaitPendingModelSelection,
                      })
                    }}
                  />
                {composerCommandStatus ? <ComposerCommandStatusNotice status={composerCommandStatus} /> : null}
                {pane.composerParentMessageID ? (
                  <ComposerBranchParentNotice
                    messagePreview={composerParentMessagePreview}
                    onClear={() => onClearComposerParentMessage({ tabKey: pane.tabKey })}
                  />
                ) : null}
                {composerWorkflowBadge ? <ComposerPlanModeNotice workflow={composerWorkflowBadge} /> : null}
                <ComposerUtilityBar
                  contextWindow={composer.contextWindow}
                  gitDirectory={pane.workspace?.directory ?? null}
                  gitProjectID={pane.projectID}
                  showGitControls={showGitControls}
                  usage={pane.activeSessionContextUsage}
                />
              </div>
            </>
          )}
        </div>
      </div>
      {bagDialogState ? (
        <SessionBagSubmissionDialog
          description={bagDescription}
          state={bagDialogState}
          onDescriptionChange={setBagDescription}
          onCancel={handleCancelSessionBagDialog}
          onClose={handleCloseSessionBagDialog}
          onSubmit={() => void handleConfirmSessionBagUpload()}
        />
      ) : null}
    </section>
  )
})
