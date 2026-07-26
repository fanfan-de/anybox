import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react"
import {
  APPEARANCE_TOKEN_GROUPS,
  APPEARANCE_TOKEN_RUNTIME_MAP,
} from "../../../../shared/appearance"
import {
  semanticTokenAuthoringOperationKey,
  type CommitSemanticTokenAuthoringCommitResult,
  type PrepareSemanticTokenAuthoringCommitResult,
  type SemanticTokenAuthoringCapability,
  type SemanticTokenAuthoringOperation,
  type SemanticTokenBindingEdit,
  type SemanticTokenColorChannelResult,
  type SemanticTokenCreation,
  type SemanticTokenThemeValueEdit,
} from "../../../../shared/semantic-token-authoring"
import {
  createSemanticTokenAuthoringHistoryState,
  semanticTokenAuthoringSessionReducer,
} from "./semantic-token-authoring-session"

const PREVIEW_STYLE_ATTRIBUTE = "data-semantic-token-authoring-preview"
const PREVIEW_TARGET_ATTRIBUTE = "data-semantic-token-authoring-target"

interface BindingPreviewDescriptor {
  element: Element
  targetID: string
  authoredValue?: string
}

interface EphemeralBindingPreview extends BindingPreviewDescriptor {
  cssProperty: string
  runtimeToken: string
}

const runtimeTokenPairs = new Map<string, { lightToken: string; darkToken: string }>()
for (const group of APPEARANCE_TOKEN_GROUPS) {
  for (const row of group.rows) {
    const runtimeToken = (APPEARANCE_TOKEN_RUNTIME_MAP as Readonly<Record<string, string>>)[row.id]
    if (!runtimeToken) continue
    runtimeTokenPairs.set(runtimeToken, {
      lightToken: row.lightToken,
      darkToken: row.darkToken,
    })
  }
}

function escapeCssValue(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")
}

function findBalancedFunctionEnd(value: string, start: number) {
  let depth = 0
  let quote = ""
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (character === "\\") index += 1
      else if (character === quote) quote = ""
      continue
    }
    if (character === "\"" || character === "'") quote = character
    else if (character === "(") depth += 1
    else if (character === ")") {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return -1
}

function replacePreviewShadowColor(value: string, runtimeToken: string) {
  const ranges: Array<{ start: number; end: number }> = []
  const functionPattern = /\b(?:var|rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = functionPattern.exec(value))) {
    const end = findBalancedFunctionEnd(value, match.index + match[0].length - 1)
    if (end < 0) return null
    ranges.push({ start: match.index, end })
    functionPattern.lastIndex = end
  }
  const keywordPattern = /#[0-9a-f]{3,8}\b|\b(?:transparent|currentcolor)\b/gi
  while ((match = keywordPattern.exec(value))) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
  }
  if (ranges.length !== 1) return null
  const [range] = ranges
  return `${value.slice(0, range.start)}var(--${runtimeToken})${value.slice(range.end)}`
}

function previewDeclarationValue(
  cssProperty: string,
  runtimeToken: string,
  authoredValue?: string,
) {
  if (cssProperty === "box-shadow" || cssProperty === "text-shadow") {
    return replacePreviewShadowColor(authoredValue ?? "", runtimeToken)
  }
  return `var(--${runtimeToken})`
}

export interface SemanticTokenAuthoringController {
  operations: SemanticTokenAuthoringOperation[]
  changeCount: number
  canUndo: boolean
  canRedo: boolean
  sourceThemeID: string
  setSourceThemeID: (themeID: string) => void
  review: Extract<PrepareSemanticTokenAuthoringCommitResult, { status: "prepared" }> | null
  error: string | null
  preparing: boolean
  committing: boolean
  lastCommitResult: CommitSemanticTokenAuthoringCommitResult | null
  bindChannel: (
    channel: SemanticTokenColorChannelResult,
    runtimeToken: string,
    target: Element,
    selector: string,
    sourceLabel: string,
    ruleRef?: string,
  ) => { staged: boolean; previewed: boolean }
  bindingForChannel: (channel: SemanticTokenColorChannelResult) => SemanticTokenBindingEdit | undefined
  setThemeValue: (runtimeToken: string, mode: "light" | "dark", value: string) => void
  resetThemeOverride: (runtimeToken: string, mode: "light" | "dark") => void
  restoreThemeSourceValue: (runtimeToken: string, mode: "light" | "dark") => void
  themeValueEdit: (
    runtimeToken: string,
    mode: "light" | "dark",
  ) => SemanticTokenThemeValueEdit | undefined
  createTokenAndBind: (
    creation: SemanticTokenCreation,
    channel: SemanticTokenColorChannelResult,
    target: Element,
    selector: string,
    sourceLabel: string,
    ruleRef?: string,
  ) => void
  isBindingTargetValid: (operation: SemanticTokenBindingEdit) => boolean
  removeOperation: (key: string) => void
  undo: () => void
  redo: () => void
  discard: () => void
  prepareReview: () => Promise<void>
  closeReview: () => void
  commitReview: () => Promise<CommitSemanticTokenAuthoringCommitResult | null>
}

export function useSemanticTokenAuthoring(input: {
  capability: SemanticTokenAuthoringCapability | null
  resolvedColorMode: "light" | "dark"
}): SemanticTokenAuthoringController {
  const [history, dispatch] = useReducer(
    semanticTokenAuthoringSessionReducer,
    undefined,
    createSemanticTokenAuthoringHistoryState,
  )
  const [sourceThemeID, setSourceThemeIDState] = useState("built-in:classic")
  const [review, setReview] = useState<
    Extract<PrepareSemanticTokenAuthoringCommitResult, { status: "prepared" }> | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [previewRevision, setPreviewRevision] = useState(0)
  const [lastCommitResult, setLastCommitResult] =
    useState<CommitSemanticTokenAuthoringCommitResult | null>(null)
  const bindingPreviewDescriptors = useRef(new Map<string, BindingPreviewDescriptor>())
  const targetRecords = useRef(new Map<string, { element: Element; previousValue: string | null }>())
  const ephemeralBinding = useRef<EphemeralBindingPreview | null>(null)
  const previewStyleRef = useRef<HTMLStyleElement | null>(null)
  const reviewRef = useRef(review)

  reviewRef.current = review

  useEffect(() => {
    const capability = input.capability
    if (capability?.status !== "available") return
    const availableThemeIDs = new Set(capability.sourceThemes.map((theme) => theme.id))
    setSourceThemeIDState((current) =>
      availableThemeIDs.has(current) ? current : capability.defaultSourceThemeID,
    )
  }, [input.capability])

  const discardPreparedReview = useCallback(() => {
    const prepared = reviewRef.current
    const discard = window.desktop?.discardSemanticTokenAuthoringCommit
    if (prepared && discard) {
      void discard({ transactionID: prepared.transactionID }).catch(() => undefined)
    }
    reviewRef.current = null
    setReview(null)
  }, [])

  const mutateHistory = useCallback((
    action: Parameters<typeof semanticTokenAuthoringSessionReducer>[1],
  ) => {
    discardPreparedReview()
    setError(null)
    setLastCommitResult(null)
    dispatch(action)
  }, [discardPreparedReview])

  const ensureTargetID = useCallback((element: Element) => {
    for (const [targetID, record] of targetRecords.current) {
      if (record.element === element) return targetID
    }
    const targetID = globalThis.crypto?.randomUUID?.() ??
      `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`
    targetRecords.current.set(targetID, {
      element,
      previousValue: element.getAttribute(PREVIEW_TARGET_ATTRIBUTE),
    })
    return targetID
  }, [])

  const clearPreviewTargets = useCallback(() => {
    for (const [targetID, record] of targetRecords.current) {
      if (record.element.getAttribute(PREVIEW_TARGET_ATTRIBUTE) !== targetID) continue
      if (record.previousValue === null) record.element.removeAttribute(PREVIEW_TARGET_ATTRIBUTE)
      else record.element.setAttribute(PREVIEW_TARGET_ATTRIBUTE, record.previousValue)
    }
    targetRecords.current.clear()
    bindingPreviewDescriptors.current.clear()
    ephemeralBinding.current = null
  }, [])

  useEffect(() => {
    const style = document.createElement("style")
    style.setAttribute(PREVIEW_STYLE_ATTRIBUTE, "")
    document.head.append(style)
    previewStyleRef.current = style
    return () => {
      style.remove()
      previewStyleRef.current = null
      clearPreviewTargets()
      const prepared = reviewRef.current
      const discard = window.desktop?.discardSemanticTokenAuthoringCommit
      if (prepared && discard) {
        void discard({ transactionID: prepared.transactionID }).catch(() => undefined)
      }
    }
  }, [clearPreviewTargets])

  useEffect(() => {
    const style = previewStyleRef.current
    if (!style) return
    const rules: string[] = []
    const activeTargetIDs = new Set<string>()
    const creations = new Map<string, SemanticTokenCreation>()
    const themeValues = new Map<string, SemanticTokenThemeValueEdit>()

    for (const operation of history.present) {
      if (operation.kind === "token-creation") {
        creations.set(operation.runtimeToken, operation)
      } else if (operation.kind === "theme-token-value-edit") {
        themeValues.set(`${operation.runtimeToken}:${operation.mode}`, operation)
      } else {
        const key = semanticTokenAuthoringOperationKey(operation)
        const descriptor = bindingPreviewDescriptors.current.get(key)
        if (!descriptor) continue
        activeTargetIDs.add(descriptor.targetID)
        const value = previewDeclarationValue(
          operation.cssProperty,
          operation.runtimeToken,
          descriptor.authoredValue,
        )
        if (!value) continue
        rules.push(
          `[${PREVIEW_TARGET_ATTRIBUTE}="${escapeCssValue(descriptor.targetID)}"] { ` +
          `${operation.cssProperty}: ${value} !important; }`,
        )
      }
    }

    const ephemeral = ephemeralBinding.current
    if (ephemeral) {
      activeTargetIDs.add(ephemeral.targetID)
      const value = previewDeclarationValue(
        ephemeral.cssProperty,
        ephemeral.runtimeToken,
        ephemeral.authoredValue,
      )
      if (value) {
        rules.push(
          `[${PREVIEW_TARGET_ATTRIBUTE}="${escapeCssValue(ephemeral.targetID)}"] { ` +
          `${ephemeral.cssProperty}: ${value} !important; }`,
        )
      }
    }

    const rootDeclarations: string[] = []
    for (const edit of themeValues.values()) {
      if (edit.action !== "set" || !edit.value) continue
      const pair = runtimeTokenPairs.get(edit.runtimeToken)
      const modeToken = edit.mode === "light" ? pair?.lightToken : pair?.darkToken
      if (modeToken) rootDeclarations.push(`--${modeToken}: ${edit.value} !important;`)
    }
    for (const creation of creations.values()) {
      rootDeclarations.push(`--${creation.runtimeToken}-light: ${creation.light.value} !important;`)
      rootDeclarations.push(`--${creation.runtimeToken}-dark: ${creation.dark.value} !important;`)
      const activeValue = input.resolvedColorMode === "light"
        ? `var(--${creation.runtimeToken}-light)`
        : `var(--${creation.runtimeToken}-dark)`
      rootDeclarations.push(`--${creation.runtimeToken}: ${activeValue} !important;`)
    }
    if (rootDeclarations.length > 0) {
      rules.unshift(`:root { ${rootDeclarations.join(" ")} }`)
    }

    for (const [targetID, record] of targetRecords.current) {
      if (activeTargetIDs.has(targetID)) {
        record.element.setAttribute(PREVIEW_TARGET_ATTRIBUTE, targetID)
      } else if (record.element.getAttribute(PREVIEW_TARGET_ATTRIBUTE) === targetID) {
        if (record.previousValue === null) record.element.removeAttribute(PREVIEW_TARGET_ATTRIBUTE)
        else record.element.setAttribute(PREVIEW_TARGET_ATTRIBUTE, record.previousValue)
      }
    }
    style.textContent = rules.join("\n")
  }, [history.present, input.resolvedColorMode, previewRevision])

  useEffect(() => {
    if (history.present.length === 0) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [history.present.length])

  const bindChannel = useCallback((
    channel: SemanticTokenColorChannelResult,
    runtimeToken: string,
    target: Element,
    selector: string,
    sourceLabel: string,
    ruleRef?: string,
  ) => {
    if (!channel.previewable) return { staged: false, previewed: false }
    const targetID = ensureTargetID(target)
    const canStage = (
      input.capability?.status === "available" &&
      channel.writable &&
      Boolean(channel.editRef || ruleRef)
    )
    if (!canStage) {
      ephemeralBinding.current = {
        element: target,
        targetID,
        authoredValue: channel.authoredValue,
        cssProperty: channel.cssProperty,
        runtimeToken,
      }
      setLastCommitResult(null)
      setPreviewRevision((revision) => revision + 1)
      return { staged: false, previewed: true }
    }

    ephemeralBinding.current = null
    const operation: SemanticTokenBindingEdit = {
      kind: "binding-edit",
      channelID: channel.id,
      cssProperty: channel.cssProperty,
      runtimeToken,
      editRef: channel.editRef,
      ruleRef: channel.editRef ? undefined : ruleRef,
      selector,
      sourceLabel,
    }
    const key = semanticTokenAuthoringOperationKey(operation)
    bindingPreviewDescriptors.current.set(key, {
      element: target,
      targetID,
      authoredValue: channel.authoredValue,
    })
    mutateHistory({ type: "upsert", operation })
    return { staged: true, previewed: true }
  }, [ensureTargetID, input.capability, mutateHistory])

  const bindingForChannel = useCallback((channel: SemanticTokenColorChannelResult) => {
    return history.present.find(
      (operation): operation is SemanticTokenBindingEdit =>
        operation.kind === "binding-edit" &&
        operation.channelID === channel.id &&
        (
          operation.editRef === channel.editRef ||
          channel.insertionRules.some((candidate) => candidate.ruleRef === operation.ruleRef)
        ),
    )
  }, [history.present])

  const setThemeValue = useCallback((
    runtimeToken: string,
    mode: "light" | "dark",
    value: string,
  ) => {
    mutateHistory({
      type: "upsert",
      operation: {
        kind: "theme-token-value-edit",
        runtimeToken,
        mode,
        action: "set",
        value,
      },
    })
  }, [mutateHistory])

  const resetThemeOverride = useCallback((
    runtimeToken: string,
    mode: "light" | "dark",
  ) => {
    mutateHistory({
      type: "upsert",
      operation: {
        kind: "theme-token-value-edit",
        runtimeToken,
        mode,
        action: "reset",
      },
    })
  }, [mutateHistory])

  const restoreThemeSourceValue = useCallback((
    runtimeToken: string,
    mode: "light" | "dark",
  ) => {
    mutateHistory({
      type: "remove",
      key: `theme:${runtimeToken}:${mode}`,
    })
  }, [mutateHistory])

  const themeValueEdit = useCallback((
    runtimeToken: string,
    mode: "light" | "dark",
  ) => history.present.find(
    (operation): operation is SemanticTokenThemeValueEdit =>
      operation.kind === "theme-token-value-edit" &&
      operation.runtimeToken === runtimeToken &&
      operation.mode === mode,
  ), [history.present])

  const createTokenAndBind = useCallback((
    creation: SemanticTokenCreation,
    channel: SemanticTokenColorChannelResult,
    target: Element,
    selector: string,
    sourceLabel: string,
    ruleRef?: string,
  ) => {
    if (
      input.capability?.status !== "available" ||
      !channel.writable ||
      (!channel.editRef && !ruleRef)
    ) {
      return
    }
    const binding: SemanticTokenBindingEdit = {
      kind: "binding-edit",
      channelID: channel.id,
      cssProperty: channel.cssProperty,
      runtimeToken: creation.runtimeToken,
      editRef: channel.editRef,
      ruleRef: channel.editRef ? undefined : ruleRef,
      selector,
      sourceLabel,
    }
    const targetID = ensureTargetID(target)
    bindingPreviewDescriptors.current.set(semanticTokenAuthoringOperationKey(binding), {
      element: target,
      targetID,
      authoredValue: channel.authoredValue,
    })
    ephemeralBinding.current = null
    mutateHistory({ type: "batch-upsert", operations: [creation, binding] })
  }, [ensureTargetID, input.capability, mutateHistory])

  const isBindingTargetValid = useCallback((operation: SemanticTokenBindingEdit) => {
    return bindingPreviewDescriptors.current.get(semanticTokenAuthoringOperationKey(operation))
      ?.element.isConnected ?? false
  }, [])

  const discard = useCallback(() => {
    discardPreparedReview()
    dispatch({ type: "discard" })
    clearPreviewTargets()
    if (previewStyleRef.current) previewStyleRef.current.textContent = ""
    setError(null)
    setLastCommitResult(null)
  }, [clearPreviewTargets, discardPreparedReview])

  const prepareReview = useCallback(async () => {
    if (
      input.capability?.status !== "available" ||
      history.present.length === 0 ||
      !window.desktop?.prepareSemanticTokenAuthoringCommit
    ) {
      setError("当前会话没有可写回的修改。")
      return
    }
    setPreparing(true)
    setError(null)
    try {
      const result = await window.desktop.prepareSemanticTokenAuthoringCommit({
        sessionID: input.capability.sessionID,
        draft: {
          version: 1,
          sourceThemeID,
          operations: history.present,
        },
      })
      if (result.status === "prepared") {
        reviewRef.current = result
        setReview(result)
      } else if (result.status === "invalid") {
        setError(result.issues.map((issue) => issue.message).join("\n"))
      } else {
        setError(result.message)
      }
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : String(prepareError))
    } finally {
      setPreparing(false)
    }
  }, [history.present, input.capability, sourceThemeID])

  const closeReview = useCallback(() => {
    discardPreparedReview()
    setError(null)
  }, [discardPreparedReview])

  const commitReview = useCallback(async () => {
    const prepared = reviewRef.current
    const commit = window.desktop?.commitSemanticTokenAuthoringCommit
    if (!prepared || !commit) return null
    setCommitting(true)
    setError(null)
    try {
      const result = await commit({ transactionID: prepared.transactionID })
      setLastCommitResult(result)
      if (result.status === "committed") {
        reviewRef.current = null
        setReview(null)
        dispatch({ type: "discard" })
        clearPreviewTargets()
        if (previewStyleRef.current) previewStyleRef.current.textContent = ""
      } else {
        setError(result.message)
        if (result.status === "stale" || result.status === "failed") {
          reviewRef.current = null
          setReview(null)
        }
      }
      return result
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : String(commitError))
      return null
    } finally {
      setCommitting(false)
    }
  }, [clearPreviewTargets])

  return useMemo(() => ({
    operations: history.present,
    changeCount: history.present.length,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    sourceThemeID,
    setSourceThemeID: (themeID: string) => {
      discardPreparedReview()
      setSourceThemeIDState(themeID)
    },
    review,
    error,
    preparing,
    committing,
    lastCommitResult,
    bindChannel,
    bindingForChannel,
    setThemeValue,
    resetThemeOverride,
    restoreThemeSourceValue,
    themeValueEdit,
    createTokenAndBind,
    isBindingTargetValid,
    removeOperation: (key: string) => mutateHistory({ type: "remove", key }),
    undo: () => mutateHistory({ type: "undo" }),
    redo: () => mutateHistory({ type: "redo" }),
    discard,
    prepareReview,
    closeReview,
    commitReview,
  }), [
    bindChannel,
    bindingForChannel,
    closeReview,
    commitReview,
    committing,
    createTokenAndBind,
    discard,
    discardPreparedReview,
    error,
    history.future.length,
    history.past.length,
    history.present,
    isBindingTargetValid,
    lastCommitResult,
    mutateHistory,
    prepareReview,
    preparing,
    resetThemeOverride,
    restoreThemeSourceValue,
    review,
    setThemeValue,
    sourceThemeID,
    themeValueEdit,
  ])
}
