import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin"
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type TextNode,
} from "lexical"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react"
import { toLocalImageProtocolUrl } from "../../../../shared/local-image-protocol"
import { ArrowUpIcon, ChevronDownIcon, CloseIcon, PaperclipIcon, StopIcon } from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import { translateLiteral, type TranslationKey } from "../i18n/translations"
import { areRendererDevelopmentFeaturesEnabled } from "../runtime-capabilities"
import { joinClassNames } from "../shared-ui"
import type {
  ComposerAttachment,
  ComposerDraftState,
  ComposerMcpOption,
  ComposerModelOption,
  ComposerPastedImageAttachment,
  ComposerPluginOption,
  ComposerReasoningEffortOption,
  ComposerSkillOption,
  ComposerTagData,
  ComposerLongTextTagData,
  ReasoningEffort,
  SessionContextUsage,
} from "../types"
import { getComposerAttachmentKind } from "./attachment-utils"
import { ComposerContextPressure } from "./ComposerContextPressure"
import { $createComposerTagNode, ComposerTagNode } from "./ComposerTagNode"
import {
  createComposerDraftStateFromEditorState,
  createComposerDraftStateFromPlainText,
  createComposerFileTagData,
  createComposerLongTextTagData,
  createComposerMcpTagData,
  createComposerPluginTagData,
  createComposerSkillTagData,
  normalizeComposerDraftState,
  readComposerLongTextStats,
  readComposerTagIdentity,
  readComposerTagsFromDraftState,
  readTaggedPluginIDsFromDraftState,
  removeComposerTagFromDraftState,
  shouldCreateComposerLongTextTag,
  updateComposerLongTextTagInDraftState,
} from "./draft-state"

const COMPOSER_THUMBNAIL_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"])

interface ComposerProps {
  attachments: ComposerAttachment[]
  attachmentButtonTitle: string
  attachmentDisabledReason: string | null
  attachmentError: string | null
  canSend: boolean
  canPasteImageAttachments?: boolean
  contextUsage: SessionContextUsage | null
  contextWindow: number | null
  draftState: ComposerDraftState
  hasBagSubmit?: boolean
  hasCompactCommand?: boolean
  hasPendingPermissionRequests: boolean
  hasSupplementalSubmitContent?: boolean
  isCancelling?: boolean
  isInterruptible?: boolean
  isSending: boolean
  mcpOptions: ComposerMcpOption[]
  modelOptions: ComposerModelOption[]
  onDraftStateChange: (value: ComposerDraftState) => void
  onModelChange: (value: string | null) => void | Promise<void>
  onPickAttachments: () => void | Promise<void>
  onPasteImageAttachments?: (images: ComposerPastedImageAttachment[]) => void | Promise<void>
  onPlanModeToggle?: () => void | Promise<void>
  onPluginToggle?: (value: string) => void | Promise<void>
  onReasoningEffortChange: (value: ReasoningEffort | null) => void
  onRemoveAttachment: (path: string) => void
  onSubmitBag?: () => void | Promise<void>
  onCancelSend?: () => void | Promise<void>
  onSend: (draftStateOverride?: ComposerDraftState) => void | Promise<void>
  placeholder?: string
  pluginOptions?: ComposerPluginOption[]
  reasoningEffortOptions: ComposerReasoningEffortOption[]
  selectedMcpServerIDs: string[]
  selectedModel: string | null
  selectedModelLabel: string
  selectedPluginIDs?: string[]
  selectedReasoningEffort: ReasoningEffort | null
  selectedReasoningEffortLabel: string
  selectedSkillIDs: string[]
  showModelSelector?: boolean
  showProjectTagCommands?: boolean
  skillOptions: ComposerSkillOption[]
  unsupportedAttachmentPaths: string[]
  workspaceDirectory: string | null
}

type ComposerMenuKey = "model" | "reasoning" | null
type ComposerCommandKey = "attach" | "bag" | "compact" | "file" | "mcp" | "plan" | "plugin" | "skill"
type ComposerCommandTriggerPrefix = "~" | "/"

interface ComposerModelProviderGroup {
  matchingOptions: ComposerModelOption[]
  providerID: string
  providerLabel: string
}

type ComposerDebugWindow = Window & {
  __ANYBOX_COMPOSER_DEBUG__?: boolean
  __ANYBOX_COMPOSER_EVENTS__?: unknown[]
}

interface ComposerTriggerMatch {
  end: number
  nodeKey: string
  start: number
}

type ComposerCommandMenuState =
  | {
      anchorRect: DOMRect | null
      kind: "mention"
      match: ComposerTriggerMatch
      query: string
    }
  | {
      anchorRect: DOMRect | null
      kind: "command-trigger"
      match: ComposerTriggerMatch
      query: string
      triggerPrefix: ComposerCommandTriggerPrefix
    }
  | {
      anchorRect: DOMRect | null
      kind: "command-selector"
      match: ComposerTriggerMatch
      query: string
      selector: "file" | "mcp" | "plugin" | "skill"
      triggerPrefix: ComposerCommandTriggerPrefix
    }

type ComposerCommandMenuItem =
  | {
      description: string
      disabled?: boolean
      group: string
      key: string
      label: string
      type: "command"
      value: ComposerCommandKey
    }
  | {
      description: string
      disabled?: boolean
      group: string
      key: string
      label: string
      tagData: ComposerTagData
      type: "tag"
    }

type ComposerKeyAction =
  | {
      preventDefault: boolean
      step: -1 | 1
      type: "move-active"
    }
  | {
      preventDefault: boolean
      type: "close-menu" | "noop" | "select-active" | "send"
    }

interface ComposerLongTextEditorState {
  tagID: string
  text: string
}

const LEXICAL_INITIAL_CONFIG = {
  namespace: "DesktopComposer",
  nodes: [ComposerTagNode],
  onError(error: Error) {
    throw error
  },
}

const EMPTY_PLUGIN_OPTIONS: ComposerPluginOption[] = []
const EMPTY_SELECTED_PLUGIN_IDS: string[] = []

const COMPOSER_COMMAND_TRIGGER_PREFIX = "~"
const COMPOSER_CLASSIC_COMMAND_TRIGGER_PREFIX = "/"

const COMPOSER_COMMANDS: Array<{
  description?: string
  descriptionKey?: TranslationKey
  label: string
  value: ComposerCommandKey
}> = [
  {
    value: "file",
    label: `${COMPOSER_COMMAND_TRIGGER_PREFIX}file`,
    description: "Search project files and insert an inline file tag.",
  },
  {
    value: "skill",
    label: `${COMPOSER_COMMAND_TRIGGER_PREFIX}skill`,
    description: "Insert a project skill tag for this message only.",
  },
  {
    value: "mcp",
    label: `${COMPOSER_COMMAND_TRIGGER_PREFIX}mcp`,
    description: "Enable a project MCP server and insert its inline tag.",
  },
  {
    value: "plugin",
    label: `${COMPOSER_COMMAND_TRIGGER_PREFIX}plugin`,
    description: "Enable a project plugin and insert its inline tag.",
  },
  {
    value: "attach",
    label: `${COMPOSER_COMMAND_TRIGGER_PREFIX}attach`,
    description: "Open the attachment picker for images or PDFs.",
  },
  {
    value: "bag",
    label: `${COMPOSER_COMMAND_TRIGGER_PREFIX}report`,
    descriptionKey: "composer.commands.reportDescription",
  },
  {
    value: "plan",
    label: `${COMPOSER_COMMAND_TRIGGER_PREFIX}plan`,
    description: "Toggle Plan Mode for this session.",
  },
  {
    value: "compact",
    label: `${COMPOSER_COMMAND_TRIGGER_PREFIX}compact`,
    description: "Compact earlier session history into continuation context.",
  },
]

function isComposerCommandTriggerPrefix(value: string | undefined): value is ComposerCommandTriggerPrefix {
  return value === COMPOSER_COMMAND_TRIGGER_PREFIX || value === COMPOSER_CLASSIC_COMMAND_TRIGGER_PREFIX
}

function getComposerCommandName(command: (typeof COMPOSER_COMMANDS)[number]) {
  return command.label.slice(1)
}

function formatComposerCommandLabel(
  command: (typeof COMPOSER_COMMANDS)[number],
  triggerPrefix: ComposerCommandTriggerPrefix,
) {
  return `${triggerPrefix}${getComposerCommandName(command)}`
}

function hasComposerCommandQueryMatch(query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  return COMPOSER_COMMANDS.some((command) => getComposerCommandName(command).includes(normalizedQuery))
}

export function getVisibleComposerCommandLabels({
  hasBagSubmit = false,
  hasCompactCommand = false,
  hasPlanModeToggle = false,
  query = "",
  showProjectTagCommands = false,
  triggerPrefix = COMPOSER_COMMAND_TRIGGER_PREFIX,
}: {
  hasBagSubmit?: boolean
  hasCompactCommand?: boolean
  hasPlanModeToggle?: boolean
  query?: string
  showProjectTagCommands?: boolean
  triggerPrefix?: ComposerCommandTriggerPrefix
}) {
  const normalizedQuery = query.trim().toLowerCase()

  return COMPOSER_COMMANDS
    .filter((command) => getComposerCommandName(command).includes(normalizedQuery))
    .filter((command) => {
      if ((command.value === "skill" || command.value === "mcp" || command.value === "plugin") && !showProjectTagCommands) {
        return false
      }

      if (command.value === "plan" && !hasPlanModeToggle) {
        return false
      }

      if (command.value === "bag" && !hasBagSubmit) {
        return false
      }

      if (command.value === "compact" && !hasCompactCommand) {
        return false
      }

      return true
    })
    .map((command) => formatComposerCommandLabel(command, triggerPrefix))
}


function isComposerSubmitKeyEvent(event: KeyboardEvent<HTMLElement>, isComposing: boolean) {
  if (event.key !== "Enter") return false
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false

  const nativeEvent = event.nativeEvent
  return !(isComposing || nativeEvent.isComposing || nativeEvent.keyCode === 229)
}

function matchesComposerModelOptionSearch(option: ComposerModelOption, normalizedQuery: string) {
  if (!normalizedQuery) return true

  return `${option.label} ${option.providerLabel} ${option.providerID} ${option.value}`
    .toLowerCase()
    .includes(normalizedQuery)
}

function matchesComposerModelProviderSearch(
  providerID: string,
  providerLabel: string,
  normalizedQuery: string,
) {
  if (!normalizedQuery) return true

  return `${providerLabel} ${providerID}`.toLowerCase().includes(normalizedQuery)
}

function buildComposerModelProviderGroups(
  modelOptions: ComposerModelOption[],
  searchQuery: string,
): ComposerModelProviderGroup[] {
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const groupedOptions = new Map<string, ComposerModelProviderGroup & { allOptions: ComposerModelOption[] }>()

  for (const option of modelOptions) {
    const existingGroup = groupedOptions.get(option.providerID)
    if (existingGroup) {
      existingGroup.allOptions.push(option)
      continue
    }

    groupedOptions.set(option.providerID, {
      providerID: option.providerID,
      providerLabel: option.providerLabel,
      allOptions: [option],
      matchingOptions: [],
    })
  }

  const groups: ComposerModelProviderGroup[] = []

  for (const group of groupedOptions.values()) {
    const providerMatches = matchesComposerModelProviderSearch(group.providerID, group.providerLabel, normalizedQuery)
    const matchingOptions = normalizedQuery
      ? group.allOptions.filter((option) => matchesComposerModelOptionSearch(option, normalizedQuery))
      : group.allOptions

    if (normalizedQuery && !providerMatches && matchingOptions.length === 0) continue

    groups.push({
      providerID: group.providerID,
      providerLabel: group.providerLabel,
      matchingOptions: providerMatches ? group.allOptions : matchingOptions,
    })
  }

  return groups
}

function readComposerModelOptionID(option: ComposerModelOption) {
  const separatorIndex = option.value.indexOf("/")
  return separatorIndex >= 0 ? option.value.slice(separatorIndex + 1) : option.value
}

function resolveComposerSelectedModelOption(
  modelOptions: ComposerModelOption[],
  selectedModel: string | null,
) {
  if (!selectedModel) return null

  const exactMatch = modelOptions.find((option) => option.value === selectedModel)
  if (exactMatch) return exactMatch
  if (selectedModel.includes("/")) return null

  const modelIDMatches = modelOptions.filter((option) => readComposerModelOptionID(option) === selectedModel)
  return modelIDMatches.length === 1 ? modelIDMatches[0] : null
}

function getComposerSendButtonDescription({
  attachmentError,
  canSend,
  hasRunningTask,
  hasPendingPermissionRequests,
  isCancelling,
  sendButtonActsAsStop,
}: {
  attachmentError: string | null
  canSend: boolean
  hasRunningTask: boolean
  hasPendingPermissionRequests: boolean
  isCancelling?: boolean
  sendButtonActsAsStop: boolean
}) {
  if (attachmentError) {
    return `${attachmentError} Press Shift+Enter for a newline.`
  }

  if (!canSend) {
    return "Choose a session or workspace before sending. Press Shift+Enter for a newline."
  }

  if (hasPendingPermissionRequests) {
    return "Enter is unavailable while approval requests are pending. Press Shift+Enter for a newline."
  }

  if (isCancelling) {
    return "Cancellation has been requested. Press Shift+Enter for a newline."
  }

  if (sendButtonActsAsStop) {
    return "Stop the current execution. Press Shift+Enter for a newline."
  }

  if (hasRunningTask) {
    return "Queue this message after the current execution. Press Shift+Enter for a newline."
  }

  return "Press Enter to send. Press Shift+Enter for a newline."
}

function hasComposerDraftText(draftState: ComposerDraftState) {
  return draftState.plainText.trim().length > 0
}

function hasComposerSubmittableContent(draftState: ComposerDraftState, attachments: ComposerAttachment[]) {
  return hasComposerDraftText(draftState) || attachments.length > 0
}

function getComposerAttachmentExtension(path: string) {
  return path.trim().toLowerCase().split(".").pop() ?? ""
}

function getComposerAttachmentThumbnailUrl(attachment: ComposerAttachment) {
  if (getComposerAttachmentKind(attachment.path) !== "image") return null
  if (!COMPOSER_THUMBNAIL_IMAGE_EXTENSIONS.has(getComposerAttachmentExtension(attachment.path))) return null
  return toLocalImageProtocolUrl(attachment.path)
}

function ComposerAttachmentRemoveButton({
  attachment,
  onRemoveAttachment,
}: {
  attachment: ComposerAttachment
  onRemoveAttachment: (path: string) => void
}) {
  return (
    <button
      aria-label={`Remove ${attachment.name}`}
      className="composer-attachment-remove"
      onClick={() => onRemoveAttachment(attachment.path)}
      type="button"
    >
      <CloseIcon />
    </button>
  )
}

function ComposerAttachmentFileChip({
  attachment,
  isInvalid,
  onRemoveAttachment,
}: {
  attachment: ComposerAttachment
  isInvalid: boolean
  onRemoveAttachment: (path: string) => void
}) {
  return (
    <div className={joinClassNames("composer-attachment-chip", isInvalid && "is-invalid")}>
      <span className="composer-attachment-name" title={attachment.path}>
        {attachment.name}
      </span>
      <ComposerAttachmentRemoveButton attachment={attachment} onRemoveAttachment={onRemoveAttachment} />
    </div>
  )
}

function ComposerAttachmentItem({
  attachment,
  isInvalid,
  onRemoveAttachment,
}: {
  attachment: ComposerAttachment
  isInvalid: boolean
  onRemoveAttachment: (path: string) => void
}) {
  const previewUrl = getComposerAttachmentThumbnailUrl(attachment)
  const [hasPreviewError, setHasPreviewError] = useState(false)

  useEffect(() => {
    setHasPreviewError(false)
  }, [previewUrl])

  if (!previewUrl || hasPreviewError) {
    return (
      <ComposerAttachmentFileChip
        attachment={attachment}
        isInvalid={isInvalid}
        onRemoveAttachment={onRemoveAttachment}
      />
    )
  }

  return (
    <div
      className={joinClassNames("composer-attachment-chip", "is-image-preview", isInvalid && "is-invalid")}
      title={attachment.path}
    >
      <img
        alt={attachment.name}
        className="composer-attachment-thumbnail"
        decoding="async"
        loading="lazy"
        onError={() => setHasPreviewError(true)}
        src={previewUrl}
      />
      <ComposerAttachmentRemoveButton attachment={attachment} onRemoveAttachment={onRemoveAttachment} />
    </div>
  )
}

function getComposerSelectionRect() {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!range.collapsed || typeof range.getBoundingClientRect !== "function") return null
  return range.getBoundingClientRect()
}

function isComposerDebugEnabled() {
  if (
    typeof window === "undefined" ||
    !areRendererDevelopmentFeaturesEnabled()
  ) return false

  try {
    const debugWindow = window as ComposerDebugWindow
    return debugWindow.__ANYBOX_COMPOSER_DEBUG__ === true || window.localStorage.getItem("anybox:composer-debug") === "1"
  } catch {
    return false
  }
}

function describeComposerDebugEvent(event: Event | null | undefined) {
  if (!event) return null

  const isKeyboardEvent = event instanceof globalThis.KeyboardEvent
  const isInputEvent = typeof InputEvent !== "undefined" && event instanceof InputEvent

  return {
    defaultPrevented: event.defaultPrevented,
    eventPhase: event.eventPhase,
    inputType: isInputEvent ? event.inputType : undefined,
    isComposing: isKeyboardEvent || isInputEvent ? event.isComposing : undefined,
    key: isKeyboardEvent ? event.key : undefined,
    keyCode: isKeyboardEvent ? event.keyCode : undefined,
    type: event.type,
    value: isInputEvent ? event.data : undefined,
  }
}

function readComposerDebugSnapshot(editor: LexicalEditor | null, element: HTMLElement | null) {
  if (typeof window === "undefined") return {}

  const domSelection = window.getSelection()
  let lexicalSelection: unknown = null

  try {
    editor?.getEditorState().read(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) {
        lexicalSelection = selection ? { type: selection.constructor.name } : null
        return
      }

      lexicalSelection = {
        anchorKey: selection.anchor.key,
        anchorOffset: selection.anchor.offset,
        anchorText: selection.anchor.getNode().getTextContent().slice(0, 120),
        anchorType: selection.anchor.type,
        collapsed: selection.isCollapsed(),
        dirty: selection.dirty,
        focusKey: selection.focus.key,
        focusOffset: selection.focus.offset,
        focusType: selection.focus.type,
      }
    })
  } catch (error) {
    lexicalSelection = {
      error: error instanceof Error ? error.message : String(error),
    }
  }

  return {
    activeElementClassName:
      document.activeElement instanceof HTMLElement ? document.activeElement.className : document.activeElement?.nodeName,
    activeElementIsComposer: Boolean(element && document.activeElement && element.contains(document.activeElement)),
    domSelection: domSelection
      ? {
          anchorInComposer: Boolean(element && domSelection.anchorNode && element.contains(domSelection.anchorNode)),
          anchorNode: domSelection.anchorNode?.nodeType === Node.TEXT_NODE ? "#text" : domSelection.anchorNode?.nodeName,
          anchorOffset: domSelection.anchorOffset,
          collapsed: domSelection.isCollapsed,
          focusInComposer: Boolean(element && domSelection.focusNode && element.contains(domSelection.focusNode)),
          focusNode: domSelection.focusNode?.nodeType === Node.TEXT_NODE ? "#text" : domSelection.focusNode?.nodeName,
          focusOffset: domSelection.focusOffset,
          rangeCount: domSelection.rangeCount,
        }
      : null,
    editorText: element?.textContent ?? "",
    lexicalSelection,
  }
}

function logComposerDebug(
  label: string,
  payload: Record<string, unknown> = {},
  options: { trace?: boolean } = {},
) {
  if (!isComposerDebugEnabled()) return

  const entry = {
    label,
    payload,
    time: Math.round(performance.now()),
  }

  try {
    const debugWindow = window as ComposerDebugWindow
    const events = debugWindow.__ANYBOX_COMPOSER_EVENTS__ ?? []
    events.push(entry)
    debugWindow.__ANYBOX_COMPOSER_EVENTS__ = events.slice(-300)
  } catch {
    // Ignore debug storage failures.
  }

  console.debug(`[composer-debug] ${label}`, entry)
  if (options.trace) {
    console.trace(`[composer-debug] ${label}`)
  }
}

function toSet(values: string[]) {
  return new Set(values)
}

function difference(left: Set<string>, right: Set<string>) {
  return [...left].filter((value) => !right.has(value))
}

function matchesQuery(value: string, query: string) {
  return value.toLowerCase().includes(query.trim().toLowerCase())
}

export function formatComposerAbsoluteFilePath(filePath: string) {
  return filePath.trim()
}

export function buildMenuStyle(
  anchorRect: DOMRect | null,
  containerRect: DOMRect | null,
): CSSProperties | undefined {
  if (!anchorRect || !containerRect) return undefined

  return {
    bottom: `${String(Math.max(0, containerRect.bottom - anchorRect.top + 10))}px`,
  }
}

export function shouldApplyExternalComposerDraftState(
  editor: Pick<LexicalEditor, "getEditorState">,
  lexicalJSON: string,
  options: {
    localDraftEchoes?: Set<string>
    localLexicalJSON?: string | null
  } = {},
) {
  if (options.localLexicalJSON === lexicalJSON || options.localDraftEchoes?.has(lexicalJSON)) {
    return false
  }

  try {
    return JSON.stringify(editor.getEditorState().toJSON()) !== lexicalJSON
  } catch {
    return true
  }
}

function isComposerEditorFocused(editor: LexicalEditor) {
  if (typeof document === "undefined") return false

  const rootElement = editor.getRootElement()
  return Boolean(rootElement && document.activeElement && rootElement.contains(document.activeElement))
}

function parseComposerDraftStateForEditor(
  editor: LexicalEditor,
  lexicalJSON: string,
  options: {
    selectEnd?: boolean
  } = {},
) {
  return editor.parseEditorState(lexicalJSON, () => {
    if (options.selectEnd) {
      $getRoot().selectEnd()
    }
  })
}

function isComposerCommandMenuTextAnchor(anchorNode: unknown): anchorNode is Pick<TextNode, "getTextContent" | "isToken"> {
  return Boolean(
    anchorNode &&
      typeof anchorNode === "object" &&
      "getTextContent" in anchorNode &&
      typeof (anchorNode as { getTextContent?: unknown }).getTextContent === "function" &&
      "isToken" in anchorNode &&
      typeof (anchorNode as { isToken?: unknown }).isToken === "function",
  )
}

export function readComposerBeforeTextForCommandMenu(anchorNode: unknown, anchorOffset: number) {
  if (!isComposerCommandMenuTextAnchor(anchorNode) || anchorNode.isToken()) {
    return null
  }

  return anchorNode.getTextContent().slice(0, anchorOffset)
}

export function getComposerKeyAction({
  allowSubmitWhenCommandMenuEmpty = false,
  commandMenuItemCount,
  hasCommandMenu,
  isSubmitKeyEvent,
  key,
}: {
  allowSubmitWhenCommandMenuEmpty?: boolean
  commandMenuItemCount: number
  hasCommandMenu: boolean
  isSubmitKeyEvent: boolean
  key: string
}): ComposerKeyAction {
  if (hasCommandMenu) {
    if (key === "ArrowDown") {
      return commandMenuItemCount > 0
        ? { type: "move-active", step: 1, preventDefault: true }
        : { type: "noop", preventDefault: false }
    }

    if (key === "ArrowUp") {
      return commandMenuItemCount > 0
        ? { type: "move-active", step: -1, preventDefault: true }
        : { type: "noop", preventDefault: false }
    }

    if (key === "Escape") {
      return { type: "close-menu", preventDefault: true }
    }

    if (isSubmitKeyEvent) {
      if (commandMenuItemCount > 0) {
        return { type: "select-active", preventDefault: true }
      }

      return allowSubmitWhenCommandMenuEmpty
        ? { type: "send", preventDefault: true }
        : { type: "noop", preventDefault: true }
    }

    return { type: "noop", preventDefault: false }
  }

  if (isSubmitKeyEvent) {
    return { type: "send", preventDefault: true }
  }

  return { type: "noop", preventDefault: false }
}

export function handleComposerCommandMenuMouseDown(
  event: Pick<ReactMouseEvent<HTMLButtonElement>, "button" | "preventDefault" | "stopPropagation">,
  onSelect: () => void,
) {
  if (event.button !== 0) {
    return false
  }

  event.preventDefault()
  event.stopPropagation()
  onSelect()
  return true
}

function createTextReplacement(editor: LexicalEditor, match: ComposerTriggerMatch, replacementText: string) {
  editor.update(() => {
    const node = $getNodeByKey(match.nodeKey)
    if (!$isTextNode(node)) return

    const text = node.getTextContent()
    const beforeText = text.slice(0, match.start)
    const afterText = text.slice(match.end)
    const nextTextNode = $createTextNode(`${beforeText}${replacementText}${afterText}`)
    node.replace(nextTextNode)
    const nextOffset = beforeText.length + replacementText.length
    nextTextNode.select(nextOffset, nextOffset)
  })
}

function isImageClipboardFile(file: File | null | undefined): file is File {
  return Boolean(file && file.type.trim().toLowerCase().startsWith("image/"))
}

export function readComposerClipboardImageFiles(clipboardData: Pick<DataTransfer, "files" | "items"> | null) {
  if (!clipboardData) return [] as File[]

  const itemFiles = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === "file" && item.type.trim().toLowerCase().startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(isImageClipboardFile)

  if (itemFiles.length > 0) {
    return itemFiles
  }

  return Array.from(clipboardData.files ?? []).filter(isImageClipboardFile)
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read pasted image."))
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Pasted image could not be converted to a data URL."))
        return
      }

      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export async function createComposerPastedImageAttachments(files: File[]) {
  return Promise.all(
    files.map(async (file, index) => ({
      dataUrl: await readFileAsDataUrl(file),
      mimeType: file.type || "image/png",
      name: file.name || `pasted-image-${String(index + 1)}.png`,
    })),
  )
}

function readComposerClipboardPlainText(clipboardData: DataTransfer | null) {
  if (!clipboardData) return ""

  try {
    return clipboardData.getData("text/plain")
  } catch {
    return ""
  }
}

function insertLongTextTagAtSelection(editor: LexicalEditor, text: string) {
  const tagData = createComposerLongTextTagData(text)

  editor.update(() => {
    const selection = $getSelection()
    const trailingTextNode = $createTextNode(" ")
    if (!$isRangeSelection(selection)) {
      const root = $getRoot()
      const lastRootChild = root.getLastChild()
      const paragraph = $isParagraphNode(lastRootChild) ? lastRootChild : $createParagraphNode()
      if (!$isParagraphNode(lastRootChild)) {
        root.append(paragraph)
      }

      const lastChild = paragraph.getLastChild()
      if ($isTextNode(lastChild) && !lastChild.getTextContent().endsWith(" ")) {
        paragraph.append($createTextNode(" "))
      }

      paragraph.append($createComposerTagNode(tagData))
      paragraph.append(trailingTextNode)
      trailingTextNode.select(1, 1)
      return
    }

    const insertedNodes = [$createComposerTagNode(tagData), trailingTextNode]
    if (selection.isCollapsed()) {
      const anchorNode = selection.anchor.getNode()
      const anchorOffset = selection.anchor.offset
      const anchorText = $isTextNode(anchorNode) ? anchorNode.getTextContent() : ""
      if (anchorOffset > 0 && anchorText && !/\s/.test(anchorText[anchorOffset - 1] ?? "")) {
        insertedNodes.unshift($createTextNode(" "))
      }
    }

    selection.insertNodes(insertedNodes)
    trailingTextNode.select(1, 1)
  })
}

function findComposerLongTextTagElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return null

  const element = target.closest<HTMLElement>(".composer-inline-tag.is-long-text[data-composer-tag-id]")
  if (!element) return null

  return element
}

function insertTagAtMatch(editor: LexicalEditor, match: ComposerTriggerMatch, tagData: ComposerTagData) {
  editor.update(() => {
    const node = $getNodeByKey(match.nodeKey)
    if (!$isTextNode(node)) return

    const text = node.getTextContent()
    const beforeText = text.slice(0, match.start)
    const afterText = text.slice(match.end).replace(/^\s+/, "")
    const firstNode = beforeText.length > 0 ? $createTextNode(beforeText) : $createComposerTagNode(tagData)
    node.replace(firstNode)

    let cursor = firstNode
    if (beforeText.length > 0) {
      const tagNode = $createComposerTagNode(tagData)
      cursor.insertAfter(tagNode)
      cursor = tagNode
    }

    const trailingTextNode = $createTextNode(afterText.length > 0 ? ` ${afterText}` : " ")
    cursor.insertAfter(trailingTextNode)
    trailingTextNode.select(1, 1)
  })
}

function findTriggerMatch(inputText: string, pattern: RegExp) {
  const match = pattern.exec(inputText)
  if (!match) return null

  const triggerText = match[0].trimStart()
  return {
    groups: match.slice(1),
    start: inputText.length - triggerText.length,
    text: triggerText,
  }
}

function deriveCommandMenuState() {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null

  const anchorNode = selection.anchor.getNode()
  if (!$isTextNode(anchorNode)) return null

  const beforeText = readComposerBeforeTextForCommandMenu(anchorNode, selection.anchor.offset)
  if (beforeText === null) return null

  const selectorMatch = findTriggerMatch(beforeText, /(^|\s)([~/])(file|skill|mcp|plugin)(?:\s+([^\n]*))?$/)
  if (selectorMatch) {
    const triggerPrefix = selectorMatch.groups[1]
    if (!isComposerCommandTriggerPrefix(triggerPrefix)) return null

    return {
      anchorRect: getComposerSelectionRect(),
      kind: "command-selector",
      match: {
        nodeKey: anchorNode.getKey(),
        start: selectorMatch.start,
        end: selection.anchor.offset,
      },
      query: selectorMatch.groups[3] ?? "",
      selector: selectorMatch.groups[2] as "file" | "mcp" | "plugin" | "skill",
      triggerPrefix,
    } satisfies ComposerCommandMenuState
  }

  const mentionMatch = findTriggerMatch(beforeText, /(^|\s)@([^\s@/~]*)$/)
  if (mentionMatch) {
    return {
      anchorRect: getComposerSelectionRect(),
      kind: "mention",
      match: {
        nodeKey: anchorNode.getKey(),
        start: mentionMatch.start,
        end: selection.anchor.offset,
      },
      query: mentionMatch.groups[1] ?? "",
    } satisfies ComposerCommandMenuState
  }

  const commandTriggerMatch = findTriggerMatch(beforeText, /(^|\s)([~/])([^\s]*)$/)
  if (commandTriggerMatch) {
    const triggerPrefix = commandTriggerMatch.groups[1]
    if (!isComposerCommandTriggerPrefix(triggerPrefix)) return null

    const query = commandTriggerMatch.groups[2] ?? ""
    if (triggerPrefix === COMPOSER_CLASSIC_COMMAND_TRIGGER_PREFIX && !hasComposerCommandQueryMatch(query)) {
      return null
    }

    return {
      anchorRect: getComposerSelectionRect(),
      kind: "command-trigger",
      match: {
        nodeKey: anchorNode.getKey(),
        start: commandTriggerMatch.start,
        end: selection.anchor.offset,
      },
      query,
      triggerPrefix,
    } satisfies ComposerCommandMenuState
  }

  return null
}

function ComposerEditorSyncPlugin({
  draftState,
  draftStateRef,
  localEditorLexicalJSONRef,
  localDraftEchoesRef,
  onReady,
}: {
  draftState: ComposerDraftState
  draftStateRef: { current: ComposerDraftState }
  localEditorLexicalJSONRef: { current: string }
  localDraftEchoesRef: { current: Set<string> }
  onReady: (editor: LexicalEditor) => void
}) {
  const [editor] = useLexicalComposerContext()
  const lastLexicalJSONRef = useRef(draftState.lexicalJSON)

  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])

  useEffect(() => {
    if (draftState.lexicalJSON === lastLexicalJSONRef.current) {
      logComposerDebug("sync-skip-same-prop", {
        draftPlainText: draftState.plainText,
      })
      return
    }

    if (
      !shouldApplyExternalComposerDraftState(editor, draftState.lexicalJSON, {
        localDraftEchoes: localDraftEchoesRef.current,
        localLexicalJSON: localEditorLexicalJSONRef.current,
      })
    ) {
      logComposerDebug("sync-skip-local-echo", {
        draftPlainText: draftState.plainText,
        echoCount: localDraftEchoesRef.current.size,
        incomingEqualsLocal: draftState.lexicalJSON === localEditorLexicalJSONRef.current,
      })
      lastLexicalJSONRef.current = draftState.lexicalJSON
      return
    }

    logComposerDebug(
      "sync-apply-setEditorState",
      {
        draftPlainText: draftState.plainText,
        incomingEqualsLocal: draftState.lexicalJSON === localEditorLexicalJSONRef.current,
      },
      { trace: true },
    )
    const nextEditorState = parseComposerDraftStateForEditor(editor, draftState.lexicalJSON, {
      selectEnd: isComposerEditorFocused(editor),
    })
    editor.setEditorState(nextEditorState)
    draftStateRef.current = draftState
    localEditorLexicalJSONRef.current = draftState.lexicalJSON
    localDraftEchoesRef.current.clear()
    lastLexicalJSONRef.current = draftState.lexicalJSON
  }, [draftState, draftStateRef, editor, localDraftEchoesRef, localEditorLexicalJSONRef])

  return null
}

function rememberLocalComposerDraftEcho(localDraftEchoes: Set<string>, lexicalJSON: string) {
  localDraftEchoes.add(lexicalJSON)

  if (localDraftEchoes.size <= 10) return

  const oldestEcho = localDraftEchoes.values().next().value
  if (oldestEcho) {
    localDraftEchoes.delete(oldestEcho)
  }
}

export function Composer({
  attachments,
  attachmentButtonTitle,
  attachmentDisabledReason,
  attachmentError,
  canSend,
  canPasteImageAttachments = false,
  contextUsage,
  contextWindow,
  draftState,
  hasBagSubmit = false,
  hasCompactCommand = false,
  hasPendingPermissionRequests,
  hasSupplementalSubmitContent = false,
  isCancelling = false,
  isInterruptible = false,
  isSending,
  mcpOptions,
  modelOptions,
  onDraftStateChange,
  onModelChange,
  onPickAttachments,
  onPasteImageAttachments,
  onPlanModeToggle,
  onPluginToggle,
  onReasoningEffortChange,
  onRemoveAttachment,
  onSubmitBag,
  onCancelSend,
  onSend,
  placeholder,
  pluginOptions = EMPTY_PLUGIN_OPTIONS,
  reasoningEffortOptions,
  selectedMcpServerIDs,
  selectedModel,
  selectedModelLabel,
  selectedPluginIDs = EMPTY_SELECTED_PLUGIN_IDS,
  selectedReasoningEffort,
  selectedReasoningEffortLabel,
  selectedSkillIDs,
  showModelSelector = true,
  showProjectTagCommands = true,
  skillOptions,
  unsupportedAttachmentPaths,
  workspaceDirectory,
}: ComposerProps) {
  const { locale, t } = useI18n()
  const localizedPlaceholder = placeholder ? translateLiteral(locale, placeholder) : t("composer.placeholder")
  const normalizedDraftState = useMemo(() => normalizeComposerDraftState(draftState), [draftState.lexicalJSON])
  const draftStateRef = useRef(normalizedDraftState)
  const localEditorLexicalJSONRef = useRef(normalizedDraftState.lexicalJSON)
  const localDraftEchoesRef = useRef(new Set<string>())
  const editorRef = useRef<LexicalEditor | null>(null)
  const contentEditableRef = useRef<HTMLDivElement | null>(null)
  const footerRef = useRef<HTMLElement | null>(null)
  const attachmentUnavailableAnchorRef = useRef<HTMLDivElement | null>(null)
  const activeModelProviderOptionRef = useRef<HTMLButtonElement | null>(null)
  const selectedModelOptionRef = useRef<HTMLButtonElement | null>(null)
  const isComposingRef = useRef(false)
  const fileSearchRequestRef = useRef(0)
  const pendingPluginDiffRef = useRef<{
    added: Set<string>
    removed: Set<string>
  } | null>(null)

  const [openMenu, setOpenMenu] = useState<ComposerMenuKey>(null)
  const [modelSearchQuery, setModelSearchQuery] = useState("")
  const [activeModelProviderID, setActiveModelProviderID] = useState<string | null>(null)
  const previousOpenMenuRef = useRef<ComposerMenuKey>(null)
  const [isAttachmentUnavailablePopoverOpen, setIsAttachmentUnavailablePopoverOpen] = useState(false)
  const attachmentUnavailablePopoverID = useId()
  const attachmentUnavailableTitleID = useId()
  const attachmentUnavailableDescriptionID = useId()
  const [commandMenuState, setCommandMenuState] = useState<ComposerCommandMenuState | null>(null)
  const [commandMenuItems, setCommandMenuItems] = useState<ComposerCommandMenuItem[]>([])
  const [activeCommandIndex, setActiveCommandIndex] = useState(0)
  const [longTextEditorState, setLongTextEditorState] = useState<ComposerLongTextEditorState | null>(null)
  const [hasDraftText, setHasDraftText] = useState(() => hasComposerDraftText(normalizedDraftState))
  const localizedAttachmentButtonTitle = translateLiteral(locale, attachmentButtonTitle)
  const localizedAttachmentDisabledReason = attachmentDisabledReason
    ? translateLiteral(locale, attachmentDisabledReason)
    : null
  const commandMenuStateRef = useRef<ComposerCommandMenuState | null>(commandMenuState)
  const commandMenuItemsRef = useRef<ComposerCommandMenuItem[]>(commandMenuItems)
  const activeCommandIndexRef = useRef(activeCommandIndex)

  commandMenuStateRef.current = commandMenuState
  commandMenuItemsRef.current = commandMenuItems
  activeCommandIndexRef.current = activeCommandIndex

  function setCommandMenuStateWithRef(nextState: ComposerCommandMenuState | null) {
    commandMenuStateRef.current = nextState
    setCommandMenuState(nextState)
  }

  function setCommandMenuItemsWithRef(nextItems: ComposerCommandMenuItem[]) {
    commandMenuItemsRef.current = nextItems
    setCommandMenuItems(nextItems)
  }

  function applyDraftStateToEditor(nextDraftState: ComposerDraftState) {
    const normalizedNextDraftState = normalizeComposerDraftState(nextDraftState)
    const editor = editorRef.current

    draftStateRef.current = normalizedNextDraftState
    localEditorLexicalJSONRef.current = normalizedNextDraftState.lexicalJSON
    rememberLocalComposerDraftEcho(localDraftEchoesRef.current, normalizedNextDraftState.lexicalJSON)
    setCommandMenuStateWithRef(null)
    setHasDraftText(hasComposerDraftText(normalizedNextDraftState))

    if (editor) {
      const nextEditorState = parseComposerDraftStateForEditor(editor, normalizedNextDraftState.lexicalJSON, {
        selectEnd: isComposerEditorFocused(editor),
      })
      editor.setEditorState(nextEditorState)
    }

    onDraftStateChange(normalizedNextDraftState)
  }

  function readLongTextTagFromDraft(tagID: string) {
    return readComposerTagsFromDraftState(draftStateRef.current)
      .find((tag): tag is ComposerLongTextTagData => tag.kind === "long-text" && tag.id === tagID) ?? null
  }

  function openLongTextEditor(tagID: string) {
    const tag = readLongTextTagFromDraft(tagID)
    if (!tag) return

    setLongTextEditorState({
      tagID: tag.id,
      text: tag.text,
    })
  }

  function commitLongTextEditor() {
    if (!longTextEditorState) return

    applyDraftStateToEditor(
      updateComposerLongTextTagInDraftState(
        draftStateRef.current,
        longTextEditorState.tagID,
        longTextEditorState.text,
      ),
    )
    setLongTextEditorState(null)
  }

  function removeLongTextTag() {
    if (!longTextEditorState) return

    applyDraftStateToEditor(removeComposerTagFromDraftState(draftStateRef.current, longTextEditorState.tagID))
    setLongTextEditorState(null)
  }

  function getCurrentTagIdentities() {
    return new Set(readComposerTagsFromDraftState(draftStateRef.current).map(readComposerTagIdentity))
  }

  function buildComposerCommandItems(query: string, triggerPrefix: ComposerCommandTriggerPrefix = COMPOSER_COMMAND_TRIGGER_PREFIX) {
    const visibleLabels = new Set(getVisibleComposerCommandLabels({
      hasBagSubmit,
      hasCompactCommand,
      hasPlanModeToggle: Boolean(onPlanModeToggle),
      query,
      showProjectTagCommands: Boolean(showProjectTagCommands),
      triggerPrefix,
    }))

    return COMPOSER_COMMANDS
      .map((command) => ({
        command,
        label: formatComposerCommandLabel(command, triggerPrefix),
      }))
      .filter(({ label }) => visibleLabels.has(label))
      .map(({ command, label }) => ({
        type: "command",
        key: `command:${command.value}`,
        group: "Commands",
        label,
        description: command.descriptionKey ? t(command.descriptionKey) : command.description ?? "",
        value: command.value,
      } satisfies ComposerCommandMenuItem))
  }

  function buildSkillTagItems(query: string) {
    const currentTagIdentities = getCurrentTagIdentities()
    const selectedSkillIDSet = toSet(selectedSkillIDs)

    return skillOptions
      .filter((option) => matchesQuery(option.label, query) || matchesQuery(option.value, query))
      .map((option) => {
        const tagData = createComposerSkillTagData(option)
        const disabled = currentTagIdentities.has(readComposerTagIdentity(tagData))
        return {
          type: "tag",
          key: `skill:${option.value}`,
          group: "Skills",
          label: option.label,
          description: disabled
            ? "Already tagged in this draft."
            : selectedSkillIDSet.has(option.value)
              ? "Already selected in the project menu; this tag still keeps it in this message."
              : option.description,
          disabled,
          tagData,
        } satisfies ComposerCommandMenuItem
      })
  }

  function buildMcpTagItems(query: string) {
    const currentTagIdentities = getCurrentTagIdentities()
    const selectedMcpServerIDSet = toSet(selectedMcpServerIDs)

    return mcpOptions
      .filter((option) => matchesQuery(option.label, query) || matchesQuery(option.value, query))
      .map((option) => {
        const tagData = createComposerMcpTagData(option)
        const disabled = currentTagIdentities.has(readComposerTagIdentity(tagData))
        return {
          type: "tag",
          key: `mcp:${option.value}`,
          group: "MCP",
          label: option.label,
          description: disabled
            ? "Already tagged in this draft."
            : selectedMcpServerIDSet.has(option.value)
              ? "Already enabled in the project menu."
              : option.description,
          disabled,
          tagData,
        } satisfies ComposerCommandMenuItem
      })
  }

  function buildPluginTagItems(query: string) {
    if (!showProjectTagCommands) return []

    const currentTagIdentities = getCurrentTagIdentities()
    const selectedPluginIDSet = toSet(selectedPluginIDs)

    return pluginOptions
      .filter((option) => matchesQuery(option.label, query) || matchesQuery(option.value, query))
      .map((option) => {
        const tagData = createComposerPluginTagData(option)
        const disabled = currentTagIdentities.has(readComposerTagIdentity(tagData))
        return {
          type: "tag",
          key: `plugin:${option.value}`,
          group: "Plugins",
          label: option.label,
          description: disabled
            ? "Already tagged in this draft."
            : selectedPluginIDSet.has(option.value)
              ? "Already enabled in the project menu."
              : option.description,
          disabled,
          tagData,
        } satisfies ComposerCommandMenuItem
      })
  }

  function buildImmediateCommandMenuItems(state: ComposerCommandMenuState | null) {
    if (!state) return []

    if (state.kind === "command-trigger") {
      return buildComposerCommandItems(state.query, state.triggerPrefix)
    }

    if (state.kind === "command-selector") {
      if (state.selector === "skill") {
        return buildSkillTagItems(state.query)
      }

      if (state.selector === "mcp") {
        return buildMcpTagItems(state.query)
      }

      if (state.selector === "plugin") {
        return buildPluginTagItems(state.query)
      }

      return []
    }

    return []
  }

  function readCommandMenuStateFromEditor() {
    return editorRef.current?.getEditorState().read(() => deriveCommandMenuState()) ?? null
  }

  useEffect(() => {
    logComposerDebug("mount", {
      draftPlainText: normalizedDraftState.plainText,
    })

    return () => {
      logComposerDebug("unmount", {
        draftPlainText: draftStateRef.current.plainText,
      })
    }
  }, [])

  useEffect(() => {
    if (
      normalizedDraftState.lexicalJSON === localEditorLexicalJSONRef.current ||
      localDraftEchoesRef.current.has(normalizedDraftState.lexicalJSON)
    ) {
      setHasDraftText(hasComposerDraftText(normalizedDraftState))
      logComposerDebug("draft-ref-skip-local-prop", {
        draftPlainText: normalizedDraftState.plainText,
        echoCount: localDraftEchoesRef.current.size,
        incomingEqualsLocal: normalizedDraftState.lexicalJSON === localEditorLexicalJSONRef.current,
      })
      return
    }

    logComposerDebug("draft-ref-update-from-prop", {
      draftPlainText: normalizedDraftState.plainText,
    })
    draftStateRef.current = normalizedDraftState
    setHasDraftText(hasComposerDraftText(normalizedDraftState))
  }, [normalizedDraftState])

  useEffect(() => {
    const element = contentEditableRef.current
    const editor = editorRef.current
    if (!element || !editor) return

    const handleSyntheticDraftChange = (event: Event) => {
      const nextValue =
        event instanceof CustomEvent && typeof event.detail?.value === "string"
          ? event.detail.value
          : element.textContent ?? ""
      const nextDraftState = createComposerDraftStateFromPlainText(nextValue)
      const nextEditorState = parseComposerDraftStateForEditor(editor, nextDraftState.lexicalJSON, {
        selectEnd: isComposerEditorFocused(editor),
      })

      draftStateRef.current = nextDraftState
      localEditorLexicalJSONRef.current = nextDraftState.lexicalJSON
      rememberLocalComposerDraftEcho(localDraftEchoesRef.current, nextDraftState.lexicalJSON)
      setCommandMenuStateWithRef(null)
      setHasDraftText(hasComposerDraftText(nextDraftState))
      logComposerDebug(
        "synthetic-setEditorState",
        {
          nextValue,
          snapshot: readComposerDebugSnapshot(editor, element),
        },
        { trace: true },
      )
      editor.setEditorState(nextEditorState)
      onDraftStateChange(nextDraftState)
    }

    element.addEventListener("desktop-composer-change", handleSyntheticDraftChange)
    return () => {
      element.removeEventListener("desktop-composer-change", handleSyntheticDraftChange)
    }
  }, [onDraftStateChange])

  useEffect(() => {
    const element = contentEditableRef.current
    if (!element) return

    const handleEditorDebugEvent = (event: Event) => {
      logComposerDebug(`event:${event.type}`, {
        event: describeComposerDebugEvent(event),
        snapshot: readComposerDebugSnapshot(editorRef.current, element),
      })
    }
    const handleSelectionChange = () => {
      logComposerDebug("event:selectionchange", {
        snapshot: readComposerDebugSnapshot(editorRef.current, element),
      })
    }
    const eventTypes = ["keydown", "beforeinput", "input", "keyup", "compositionstart", "compositionend"]

    for (const eventType of eventTypes) {
      element.addEventListener(eventType, handleEditorDebugEvent, true)
    }
    document.addEventListener("selectionchange", handleSelectionChange, true)

    return () => {
      for (const eventType of eventTypes) {
        element.removeEventListener(eventType, handleEditorDebugEvent, true)
      }
      document.removeEventListener("selectionchange", handleSelectionChange, true)
    }
  }, [])

  useEffect(() => {
    if (!openMenu) return

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!footerRef.current?.contains(event.target as Node)) {
        setOpenMenu(null)
      }
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null)
      }
    }

    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [openMenu])

  useEffect(() => {
    if (attachmentDisabledReason !== null || !isAttachmentUnavailablePopoverOpen) return
    setIsAttachmentUnavailablePopoverOpen(false)
  }, [attachmentDisabledReason, isAttachmentUnavailablePopoverOpen])

  useEffect(() => {
    if (!isAttachmentUnavailablePopoverOpen) return

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node
      if (!attachmentUnavailableAnchorRef.current?.contains(target)) {
        setIsAttachmentUnavailablePopoverOpen(false)
      }
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAttachmentUnavailablePopoverOpen(false)
      }
    }

    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isAttachmentUnavailablePopoverOpen])

  useEffect(() => {
    if (openMenu === "model" || modelSearchQuery === "") return
    setModelSearchQuery("")
  }, [modelSearchQuery, openMenu])

  const resolvedSelectedModelOption = useMemo(
    () => resolveComposerSelectedModelOption(modelOptions, selectedModel),
    [modelOptions, selectedModel],
  )
  const selectedModelValue = resolvedSelectedModelOption?.value ?? selectedModel
  const selectedModelProviderID =
    resolvedSelectedModelOption?.providerID ?? (selectedModel?.includes("/") ? selectedModel.split("/")[0] : null)
  const allModelProviderGroups = useMemo(() => buildComposerModelProviderGroups(modelOptions, ""), [modelOptions])
  const allModelProviderIDsKey = allModelProviderGroups.map((group) => group.providerID).join("\n")
  const visibleModelProviderGroups = useMemo(
    () => buildComposerModelProviderGroups(modelOptions, modelSearchQuery),
    [modelOptions, modelSearchQuery],
  )
  const activeModelProviderGroup =
    (activeModelProviderID
      ? visibleModelProviderGroups.find((group) => group.providerID === activeModelProviderID)
      : null) ??
    visibleModelProviderGroups[0] ??
    null

  useEffect(() => {
    const previousOpenMenu = previousOpenMenuRef.current
    previousOpenMenuRef.current = openMenu
    if (openMenu !== "model") return
    if (previousOpenMenu === "model") return

    const allModelProviderIDs = allModelProviderIDsKey ? allModelProviderIDsKey.split("\n") : []

    setActiveModelProviderID(
      selectedModelProviderID && allModelProviderIDs.includes(selectedModelProviderID)
        ? selectedModelProviderID
        : (allModelProviderIDs[0] ?? null),
    )
  }, [allModelProviderIDsKey, openMenu, selectedModelProviderID])

  useEffect(() => {
    if (openMenu !== "model") return
    if (activeModelProviderID && visibleModelProviderGroups.some((group) => group.providerID === activeModelProviderID)) return

    const fallbackProviderID =
      selectedModelProviderID && visibleModelProviderGroups.some((group) => group.providerID === selectedModelProviderID)
        ? selectedModelProviderID
        : (visibleModelProviderGroups[0]?.providerID ?? null)
    setActiveModelProviderID(fallbackProviderID)
  }, [activeModelProviderID, openMenu, selectedModelProviderID, visibleModelProviderGroups])

  useEffect(() => {
    if (openMenu === "model" || activeModelProviderID === null) return
    setActiveModelProviderID(null)
  }, [activeModelProviderID, openMenu])

  useEffect(() => {
    if (openMenu !== "model") return
    activeModelProviderOptionRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [activeModelProviderGroup?.providerID, openMenu])

  useEffect(() => {
    if (openMenu !== "model") return
    selectedModelOptionRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [activeModelProviderGroup?.providerID, openMenu, selectedModelValue])

  useEffect(() => {
    if (!commandMenuState) {
      setCommandMenuItemsWithRef([])
      return
    }

    async function buildFileTagItems(query: string) {
      if (!workspaceDirectory || !query.trim() || !window.desktop?.searchWorkspaceFiles) {
        return [] as ComposerCommandMenuItem[]
      }

      const currentTagIdentities = getCurrentTagIdentities()
      const requestID = ++fileSearchRequestRef.current
      const results = await window.desktop.searchWorkspaceFiles({
        directory: workspaceDirectory,
        query,
      })

      if (fileSearchRequestRef.current !== requestID) {
        return null
      }

      return results.map((result) => {
        const tagData = createComposerFileTagData(result.absolutePath ?? result.path, result.path)
        const filePathDescription = formatComposerAbsoluteFilePath(result.absolutePath ?? result.path)
        return {
          type: "tag",
          key: `file:${result.path}`,
          group: "Files",
          label: result.name,
          description: filePathDescription,
          disabled: currentTagIdentities.has(readComposerTagIdentity(tagData)),
          tagData,
        } satisfies ComposerCommandMenuItem
      })
    }

    if (commandMenuState.kind === "command-trigger") {
      setCommandMenuItemsWithRef(buildComposerCommandItems(commandMenuState.query, commandMenuState.triggerPrefix))
      return
    }

    if (commandMenuState.kind === "command-selector") {
      const query = commandMenuState.query
      if (commandMenuState.selector === "skill") {
        setCommandMenuItemsWithRef(buildSkillTagItems(query))
        return
      }

      if (commandMenuState.selector === "mcp") {
        setCommandMenuItemsWithRef(buildMcpTagItems(query))
        return
      }

      if (commandMenuState.selector === "plugin") {
        setCommandMenuItemsWithRef(buildPluginTagItems(query))
        return
      }

      void buildFileTagItems(query).then((items) => {
        if (items) {
          setCommandMenuItemsWithRef(items)
        }
      })
      return
    }

    setCommandMenuItemsWithRef([])
    const pluginItems = buildPluginTagItems(commandMenuState.query)
    if (pluginItems.length > 0) {
      setCommandMenuItemsWithRef(pluginItems)
    }
    void buildFileTagItems(commandMenuState.query).then((fileItems) => {
      if (!fileItems) return
      setCommandMenuItemsWithRef([...pluginItems, ...fileItems])
    })
  }, [
    commandMenuState,
    mcpOptions,
    hasBagSubmit,
    onPlanModeToggle,
    pluginOptions,
    selectedMcpServerIDs,
    selectedPluginIDs,
    selectedSkillIDs,
    showProjectTagCommands,
    skillOptions,
    workspaceDirectory,
  ])

  useEffect(() => {
    if (activeCommandIndex < commandMenuItems.length) return
    activeCommandIndexRef.current = 0
    setActiveCommandIndex(0)
  }, [activeCommandIndex, commandMenuItems.length])

  function handleModelSelect(value: string | null) {
    setOpenMenu(null)
    void onModelChange(value)
  }

  function handleAttachmentButtonClick() {
    if (attachmentDisabledReason !== null) {
      setOpenMenu(null)
      setIsAttachmentUnavailablePopoverOpen((current) => !current)
      return
    }

    setIsAttachmentUnavailablePopoverOpen(false)
    void onPickAttachments()
  }

  function handleReasoningEffortSelect(value: ReasoningEffort) {
    setOpenMenu(null)
    onReasoningEffortChange(value)
  }

  function handleEditorReady(editor: LexicalEditor) {
    editorRef.current = editor
  }

  function syncPluginDiff(nextDraftState: ComposerDraftState) {
    if (!showProjectTagCommands || !onPluginToggle) return

    const previousPluginIDs = new Set(readTaggedPluginIDsFromDraftState(draftStateRef.current))
    const nextPluginIDs = new Set(readTaggedPluginIDsFromDraftState(nextDraftState))
    const pendingDiff = pendingPluginDiffRef.current
    pendingPluginDiffRef.current = null

    const added = difference(nextPluginIDs, previousPluginIDs).filter((value) => !pendingDiff?.added.has(value))
    const removed = difference(previousPluginIDs, nextPluginIDs).filter((value) => !pendingDiff?.removed.has(value))

    for (const pluginID of [...added, ...removed]) {
      void onPluginToggle(pluginID)
    }
  }

  function handleEditorChange(editorState: ReturnType<LexicalEditor["getEditorState"]>) {
    const nextDraftState = createComposerDraftStateFromEditorState(editorState)
    const nextCommandMenuState = editorState.read(() => deriveCommandMenuState())

    logComposerDebug("onChange", {
      changed:
        nextDraftState.lexicalJSON !== draftStateRef.current.lexicalJSON ||
        nextDraftState.plainText !== draftStateRef.current.plainText,
      nextPlainText: nextDraftState.plainText,
      snapshot: readComposerDebugSnapshot(editorRef.current, contentEditableRef.current),
    })
    setCommandMenuStateWithRef(nextCommandMenuState)
    if (nextDraftState.lexicalJSON === draftStateRef.current.lexicalJSON && nextDraftState.plainText === draftStateRef.current.plainText) {
      return
    }

    syncPluginDiff(nextDraftState)
    draftStateRef.current = nextDraftState
    localEditorLexicalJSONRef.current = nextDraftState.lexicalJSON
    rememberLocalComposerDraftEcho(localDraftEchoesRef.current, nextDraftState.lexicalJSON)
    setHasDraftText(hasComposerDraftText(nextDraftState))
    onDraftStateChange(nextDraftState)
  }

  function replaceCurrentTriggerWithCommand(command: ComposerCommandKey) {
    const editor = editorRef.current
    const currentCommandMenuState = commandMenuStateRef.current ?? readCommandMenuStateFromEditor()
    if (!editor || !currentCommandMenuState || currentCommandMenuState.kind !== "command-trigger") return

    if (command === "file" || command === "skill" || command === "mcp" || command === "plugin") {
      createTextReplacement(editor, currentCommandMenuState.match, `${currentCommandMenuState.triggerPrefix}${command} `)
      return
    }

    createTextReplacement(editor, currentCommandMenuState.match, "")
    setCommandMenuStateWithRef(null)

    if (command === "attach") {
      if (attachmentDisabledReason !== null) {
        setOpenMenu(null)
        setIsAttachmentUnavailablePopoverOpen(true)
        return
      }

      void onPickAttachments()
      return
    }

    if (command === "plan") {
      void onPlanModeToggle?.()
      return
    }

    if (command === "compact") {
      void onSend(createComposerDraftStateFromPlainText(`${currentCommandMenuState.triggerPrefix}compact`))
      return
    }

    if (command === "bag") {
      void onSubmitBag?.()
    }
  }

  function handleCommandMenuItemSelect(item: ComposerCommandMenuItem) {
    if (item.disabled) return

    const currentCommandMenuState = commandMenuStateRef.current ?? readCommandMenuStateFromEditor()

    if (item.type === "command") {
      replaceCurrentTriggerWithCommand(item.value)
      return
    }

    const editor = editorRef.current
    if (!editor || !currentCommandMenuState) return

    if (item.tagData.kind === "plugin") {
      pendingPluginDiffRef.current = {
        added: new Set([item.tagData.pluginID]),
        removed: new Set(),
      }

      if (!selectedPluginIDs.includes(item.tagData.pluginID)) {
        void onPluginToggle?.(item.tagData.pluginID)
      }
    }

    insertTagAtMatch(editor, currentCommandMenuState.match, item.tagData)
    setCommandMenuStateWithRef(null)
  }

  function isEditorEventTarget(target: EventTarget | null) {
    return target instanceof Node && contentEditableRef.current?.contains(target)
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLElement>) {
    const longTextTagElement = findComposerLongTextTagElement(event.target)
    if (longTextTagElement && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault()
      event.stopPropagation()
      openLongTextEditor(longTextTagElement.dataset.composerTagId ?? "")
      return
    }

    if (!isEditorEventTarget(event.target)) return

    const currentCommandMenuState = commandMenuStateRef.current ?? readCommandMenuStateFromEditor()
    const currentCommandMenuItems =
      commandMenuItemsRef.current.length > 0 ? commandMenuItemsRef.current : buildImmediateCommandMenuItems(currentCommandMenuState)
    const action = getComposerKeyAction({
      key: event.key,
      isSubmitKeyEvent: isComposerSubmitKeyEvent(event, isComposingRef.current),
      hasCommandMenu: currentCommandMenuState !== null,
      commandMenuItemCount: currentCommandMenuItems.length,
      allowSubmitWhenCommandMenuEmpty:
        currentCommandMenuState?.kind === "command-trigger" &&
        currentCommandMenuState.triggerPrefix === COMPOSER_CLASSIC_COMMAND_TRIGGER_PREFIX,
    })

    logComposerDebug("footer-keydown-capture", {
      action,
      event: describeComposerDebugEvent(event.nativeEvent),
      snapshot: readComposerDebugSnapshot(editorRef.current, contentEditableRef.current),
    })

    if (action.preventDefault) {
      event.preventDefault()
      event.stopPropagation()
    }

    if (action.type === "move-active") {
      setActiveCommandIndex((current) => {
        const nextIndex = (current + action.step + currentCommandMenuItems.length) % currentCommandMenuItems.length
        activeCommandIndexRef.current = nextIndex
        return nextIndex
      })
      return
    }

    if (action.type === "close-menu") {
      setCommandMenuStateWithRef(null)
      return
    }

    if (action.type === "select-active") {
      const activeItem = currentCommandMenuItems[activeCommandIndexRef.current]
      if (activeItem) {
        handleCommandMenuItemSelect(activeItem)
      }
      return
    }

    if (action.type === "send") {
      if (!isEditorEventTarget(event.target)) return
      if (isCancelling) return
      if (
        (isSending || isInterruptible) &&
        !hasSupplementalSubmitContent &&
        !hasComposerSubmittableContent(draftStateRef.current, attachments)
      ) {
        void onCancelSend?.()
        return
      }
      void onSend(draftStateRef.current)
      return
    }
  }

  function handleEditorPaste(event: ReactClipboardEvent<HTMLElement>) {
    const imageFiles = readComposerClipboardImageFiles(event.clipboardData)
    if (imageFiles.length > 0) {
      if (!canPasteImageAttachments || !onPasteImageAttachments) return

      event.preventDefault()
      event.stopPropagation()

      void createComposerPastedImageAttachments(imageFiles)
        .then((images) => onPasteImageAttachments(images))
        .catch((error) => {
          console.error("[desktop] read pasted composer image failed:", error)
        })
      return
    }

    const pastedText = readComposerClipboardPlainText(event.clipboardData)
    if (!shouldCreateComposerLongTextTag(pastedText)) return

    const editor = editorRef.current
    if (!editor) return

    event.preventDefault()
    event.stopPropagation()
    insertLongTextTagAtSelection(editor, pastedText)
  }

  function handleEditorClick(event: ReactMouseEvent<HTMLElement>) {
    const longTextTagElement = findComposerLongTextTagElement(event.target)
    if (!longTextTagElement) return

    event.preventDefault()
    event.stopPropagation()
    openLongTextEditor(longTextTagElement.dataset.composerTagId ?? "")
  }

  const unsupportedAttachmentPathSet = new Set(unsupportedAttachmentPaths)
  const hasRunningTask = isSending || isInterruptible
  const hasSubmittableContent =
    hasDraftText ||
    attachments.length > 0 ||
    hasSupplementalSubmitContent
  const sendButtonActsAsStop = hasRunningTask && !hasSubmittableContent
  const showStopButton = isCancelling || hasRunningTask
  const stopButtonLabel = isCancelling ? "Cancelling task" : "Stop task"
  const stopButtonDisabled = isCancelling || !onCancelSend
  const sendButtonLabel = sendButtonActsAsStop
    ? stopButtonLabel
    : hasPendingPermissionRequests
      ? "Resolve approval first"
      : hasRunningTask
        ? "Queue message"
        : "Send task"
  const sendButtonDescription = getComposerSendButtonDescription({
    attachmentError,
    canSend,
    hasRunningTask,
    hasPendingPermissionRequests,
    isCancelling,
    sendButtonActsAsStop,
  })
  const sendButtonTitle = `${sendButtonLabel}. ${sendButtonDescription}`
  const sendShortcut = !sendButtonActsAsStop && canSend && !hasPendingPermissionRequests ? "Enter" : undefined
  const sendButtonDisabled = sendButtonActsAsStop
    ? stopButtonDisabled
    : !canSend || hasPendingPermissionRequests || isCancelling || attachmentError !== null
  const showReasoningEffortSelector = showModelSelector && reasoningEffortOptions.length > 0
  const selectedReasoningEffortButtonLabel = `Reasoning: ${selectedReasoningEffortLabel}`
  const modelMenuEmptyLabel =
    modelOptions.length === 0 ? "No visible models are available for this project yet." : "No models match your search."
  const commandMenuEmptyLabel =
    commandMenuState?.kind === "mention" || (commandMenuState?.kind === "command-selector" && commandMenuState.selector === "file")
      ? "Type a file name to search this project."
      : commandMenuState?.kind === "command-trigger"
        ? "No matching commands."
        : "No matching commands or tags."
  const commandMenuStyle = commandMenuState
    ? buildMenuStyle(commandMenuState.anchorRect, footerRef.current?.getBoundingClientRect() ?? null)
    : undefined
  const longTextEditorStats = longTextEditorState ? readComposerLongTextStats(longTextEditorState.text) : null

  return (
    <footer ref={footerRef} className="composer prompt-input-shell" onKeyDownCapture={handleEditorKeyDown}>
      <LexicalComposer
        initialConfig={{
          ...LEXICAL_INITIAL_CONFIG,
          editorState: normalizedDraftState.lexicalJSON,
        }}
      >
        <div className="composer-editor-shell">
          <ComposerEditorSyncPlugin
            draftState={normalizedDraftState}
            draftStateRef={draftStateRef}
            localEditorLexicalJSONRef={localEditorLexicalJSONRef}
            localDraftEchoesRef={localDraftEchoesRef}
            onReady={handleEditorReady}
          />
          <HistoryPlugin />
          <OnChangePlugin onChange={handleEditorChange} />
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                aria-description={sendButtonDescription}
                aria-label="Task draft"
                className="composer-editor-input"
                onClickCapture={handleEditorClick}
                onCompositionEnd={() => {
                  isComposingRef.current = false
                }}
                onCompositionStart={() => {
                  isComposingRef.current = true
                }}
                onPasteCapture={handleEditorPaste}
                ref={contentEditableRef}
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
            placeholder={<div className="composer-editor-placeholder">{localizedPlaceholder}</div>}
          />
        </div>
      </LexicalComposer>

      {longTextEditorState && longTextEditorStats ? (
        <div
          className="composer-long-text-overlay"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setLongTextEditorState(null)
            }
          }}
        >
          <article
            className="composer-long-text-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Edit long pasted text"
          >
            <header className="composer-long-text-dialog-header">
              <div className="composer-long-text-dialog-title">
                <h2>Long pasted text</h2>
                <p>{longTextEditorStats.characterCount} chars · {longTextEditorStats.lineCount} lines</p>
              </div>
              <button
                aria-label="Close long text editor"
                className="composer-long-text-close"
                onClick={() => setLongTextEditorState(null)}
                type="button"
              >
                <CloseIcon />
              </button>
            </header>

            <label className="composer-long-text-field">
              <span>Text</span>
              <textarea
                aria-label="Long pasted text"
                autoFocus
                value={longTextEditorState.text}
                onChange={(event) => {
                  const nextText = event.currentTarget.value
                  setLongTextEditorState((current) =>
                    current ? { ...current, text: nextText } : current,
                  )
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault()
                    setLongTextEditorState(null)
                    return
                  }

                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault()
                    commitLongTextEditor()
                  }
                }}
              />
            </label>

            <div className="composer-long-text-actions">
              <button className="secondary-button" onClick={removeLongTextTag} type="button">
                Remove
              </button>
              <button className="secondary-button" onClick={() => setLongTextEditorState(null)} type="button">
                Cancel
              </button>
              <button className="primary-button" onClick={commitLongTextEditor} type="button">
                Save
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {commandMenuState ? (
        <div
          className="composer-command-menu"
          data-kind={commandMenuState.kind}
          role="listbox"
          style={commandMenuStyle}
          aria-label="Composer commands"
        >
          {commandMenuItems.length > 0 ? (
            commandMenuItems.map((item, index) => (
              <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={index === activeCommandIndex}
                className={index === activeCommandIndex ? "composer-command-option is-active" : "composer-command-option"}
                disabled={item.disabled}
                onMouseDown={(event) => {
                  handleComposerCommandMenuMouseDown(event, () => handleCommandMenuItemSelect(item))
                }}
              >
                <span
                  className={
                    item.type === "tag" && item.tagData.kind === "file"
                      ? "composer-command-option-copy is-file"
                      : "composer-command-option-copy"
                  }
                >
                  <strong>{item.label}</strong>
                  {item.description ? (
                    <span
                      className={
                        item.type === "tag" && item.tagData.kind === "file"
                          ? "composer-command-option-description is-path"
                          : "composer-command-option-description"
                      }
                      title={item.description}
                    >
                      {item.description}
                    </span>
                  ) : null}
                </span>
              </button>
            ))
          ) : (
            <div className="composer-command-empty">{commandMenuEmptyLabel}</div>
          )}
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="composer-attachment-strip" aria-label="Selected attachments">
          {attachments.map((attachment) => (
            <ComposerAttachmentItem
              key={attachment.path}
              attachment={attachment}
              isInvalid={unsupportedAttachmentPathSet.has(attachment.path)}
              onRemoveAttachment={onRemoveAttachment}
            />
          ))}
        </div>
      ) : null}

      {attachmentError ? (
        <p className="composer-attachment-note" role="alert">
          {attachmentError}
        </p>
      ) : null}

      <div className="composer-toolbar">
        <div className="composer-selectors" aria-label="Composer options">
          <div className="composer-menu-anchor" ref={attachmentUnavailableAnchorRef}>
            <button
              aria-controls={isAttachmentUnavailablePopoverOpen ? attachmentUnavailablePopoverID : undefined}
              aria-describedby={isAttachmentUnavailablePopoverOpen ? attachmentUnavailableDescriptionID : undefined}
              aria-disabled={attachmentDisabledReason !== null ? "true" : undefined}
              aria-expanded={attachmentDisabledReason !== null ? isAttachmentUnavailablePopoverOpen : undefined}
              aria-haspopup={attachmentDisabledReason !== null ? "dialog" : undefined}
              aria-label={t("composer.attachments.add")}
              className={joinClassNames(
                "composer-selector-button is-icon-only",
                attachmentDisabledReason !== null && "is-unavailable",
                isAttachmentUnavailablePopoverOpen && "is-active",
              )}
              onClick={handleAttachmentButtonClick}
              title={localizedAttachmentButtonTitle}
              type="button"
            >
              <PaperclipIcon />
            </button>

            {isAttachmentUnavailablePopoverOpen && attachmentDisabledReason !== null ? (
              <div
                id={attachmentUnavailablePopoverID}
                aria-labelledby={attachmentUnavailableTitleID}
                className="composer-attachment-unavailable-popover"
                role="dialog"
              >
                <div className="composer-attachment-unavailable-copy">
                  <h2 id={attachmentUnavailableTitleID}>{t("composer.attachments.unavailableTitle")}</h2>
                  <p id={attachmentUnavailableDescriptionID}>{localizedAttachmentDisabledReason}</p>
                </div>
              </div>
            ) : null}
          </div>

          {showModelSelector ? (
            <div className="composer-menu-anchor">
              <button
                aria-expanded={openMenu === "model"}
                aria-haspopup="listbox"
                aria-label={`Select model: ${selectedModelLabel}`}
                className="composer-selector-button"
                onClick={() => setOpenMenu((current) => (current === "model" ? null : "model"))}
                type="button"
              >
                <span>{selectedModelLabel}</span>
                <ChevronDownIcon />
              </button>

              {openMenu === "model" ? (
                <div className="composer-menu-panel composer-model-menu-panel">
                  <div className="composer-menu-search" role="presentation">
                    <input
                      aria-label="Search models"
                      autoFocus
                      className="composer-menu-search-input"
                      onChange={(event) => setModelSearchQuery(event.currentTarget.value)}
                      placeholder="Search models"
                      type="search"
                      value={modelSearchQuery}
                    />
                  </div>
                  {visibleModelProviderGroups.length > 0 ? (
                    <div className="composer-model-picker-body">
                      <div className="composer-model-provider-list" role="listbox" aria-label="Model providers">
                        {visibleModelProviderGroups.map((group) => {
                          const isActive = activeModelProviderGroup?.providerID === group.providerID

                          return (
                            <button
                              key={group.providerID}
                              ref={isActive ? activeModelProviderOptionRef : undefined}
                              type="button"
                              role="option"
                              aria-selected={isActive}
                              className={
                                isActive
                                  ? "composer-model-provider-option is-active"
                                  : "composer-model-provider-option"
                              }
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                setActiveModelProviderID(group.providerID)
                              }}
                            >
                              <span className="composer-model-provider-name">{group.providerLabel}</span>
                            </button>
                          )
                        })}
                      </div>

                      <div className="composer-menu-options composer-model-menu-options" role="listbox" aria-label="Model selection">
                        {activeModelProviderGroup && activeModelProviderGroup.matchingOptions.length > 0 ? (
                          activeModelProviderGroup.matchingOptions.map((option) => {
                            const isSelected = selectedModelValue === option.value

                            return (
                              <button
                                key={option.value}
                                ref={isSelected ? selectedModelOptionRef : undefined}
                                aria-label={`${option.label} ${option.providerLabel}`}
                                aria-selected={isSelected}
                                className={isSelected ? "composer-menu-option is-selected" : "composer-menu-option"}
                                onClick={() => handleModelSelect(option.value)}
                                role="option"
                                type="button"
                              >
                                <span className="composer-menu-option-copy">
                                  <strong>{option.label}</strong>
                                </span>
                              </button>
                            )
                          })
                        ) : (
                          <p className="composer-menu-empty">No models found.</p>
                        )}
                      </div>
                    </div>
                    ) : (
                      <p className="composer-menu-empty">{modelMenuEmptyLabel}</p>
                    )}
                </div>
              ) : null}
            </div>
          ) : null}

          {showReasoningEffortSelector ? (
            <div className="composer-menu-anchor">
              <button
                aria-expanded={openMenu === "reasoning"}
                aria-haspopup="listbox"
                aria-label={`Select reasoning effort: ${selectedReasoningEffortLabel}`}
                className="composer-selector-button"
                onClick={() => setOpenMenu((current) => (current === "reasoning" ? null : "reasoning"))}
                type="button"
              >
                <span>{selectedReasoningEffortButtonLabel}</span>
                <ChevronDownIcon />
              </button>

              {openMenu === "reasoning" ? (
                <div className="composer-menu-panel is-scrollbar-hidden" role="listbox" aria-label="Reasoning effort selection">
                  {reasoningEffortOptions.map((option) => (
                    <button
                      key={option.value}
                      aria-selected={selectedReasoningEffort === option.value}
                      className={
                        selectedReasoningEffort === option.value
                          ? "composer-menu-option is-selected"
                          : "composer-menu-option"
                      }
                      onClick={() => handleReasoningEffortSelect(option.value)}
                      role="option"
                      type="button"
                    >
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <ComposerContextPressure
            contextWindow={contextWindow}
            usage={contextUsage}
            onBeforeOpen={() => {
              setOpenMenu(null)
              setIsAttachmentUnavailablePopoverOpen(false)
            }}
          />
        </div>

        <div className="composer-actions">
          {!sendButtonActsAsStop ? (
            <button
              aria-description={sendButtonDescription}
              aria-keyshortcuts={sendShortcut}
              aria-label={sendButtonLabel}
              className="primary-button is-icon-only"
              disabled={sendButtonDisabled}
              onClick={() => void onSend(draftStateRef.current)}
              title={sendButtonTitle}
              type="button"
            >
              <ArrowUpIcon />
            </button>
          ) : null}
          {showStopButton ? (
            <button
              aria-label={stopButtonLabel}
              className="secondary-button is-icon-only"
              disabled={stopButtonDisabled}
              onClick={() => void onCancelSend?.()}
              title={stopButtonLabel}
              type="button"
            >
              <StopIcon />
            </button>
          ) : null}
        </div>
      </div>
    </footer>
  )
}
