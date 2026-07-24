import { Stack, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Animated, Easing, Linking, PanResponder, Pressable, useWindowDimensions, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Screen } from "@/components/screen"
import { StateCard } from "@/components/state-card"
import { ConnectionHomePage } from "@/home/connection"
import { SessionDrawerPage } from "@/home/drawer"
import { buildSessionTitle, sortSessions } from "@/home/format"
import { ThreadViewPage } from "@/home/thread"
import {
  connectAccountRelayDesktop,
  listAccountRelayDesktops,
  type MobileAccountRelayDesktop,
  type MobileAccountSession,
} from "@/api/account-api"
import {
  answerSessionQuestion,
  createSession,
  deleteSession as deleteRemoteSession,
  getApprovals,
  getMessages,
  getSessionModels,
  getStatus,
  getWorkspaces,
  getWorkspaceModels,
  MobileApiError,
  normalizeConnectionOptionsInput,
  readConnectionUrlFromDeepLink,
  renameSession,
  respondApproval,
  sendPrompt,
  updateSessionModelSelection,
  updateSessionPinned,
  type MobileApproval,
  type MobileMessage,
  type MobileModelSelection,
  type MobileProviderModel,
  type MobileSessionSummary,
  type MobileStatus,
  type MobileWorkspace,
} from "@/api/mobile-api"
import { useMobileEvents } from "@/hooks/use-mobile-events"
import { formatAppVersionLabel, getCurrentAppInfo } from "@/services/app-updates"
import { useI18n } from "@/i18n"
import { useAccount } from "@/state/account"
import { useConnection } from "@/state/connection"
import { useFocus } from "@/state/focus"
import { describeAccountApiError, isRelayDisabledByEntitlement } from "@/utils/account-entitlements"
import {
  applyMobileStreamToolEvent,
  appendMessageContentSegment,
  mergeActiveStreamMessages,
  orderMobileMessagesForDisplay,
  type ActiveMobileStream,
} from "@/utils/message"
import { getMobileDeviceName } from "@/utils/platform"

const handledIncomingLinks = new Set<string>()
const ACCOUNT_DESKTOP_REFRESH_INTERVAL_MS = 10_000
const AUTO_CONNECT_RETRY_INTERVAL_MS = 30_000
const OPEN_DRAWER_MIN_DX = 18
const OPEN_DRAWER_MIN_VX = 0.65
const DRAWER_GESTURE_DIRECTION_RATIO = 1.25
const DRAWER_SETTLE_RATIO = 0.18

function applyPrimaryModelSelection(selection: MobileModelSelection, modelValue: string | null) {
  const nextSelection = { ...selection }
  if (modelValue?.trim()) {
    nextSelection.model = modelValue.trim()
  } else {
    delete nextSelection.model
  }
  return nextSelection
}

function replaceSessionInWorkspaces(
  workspaces: MobileWorkspace[],
  workspaceID: string,
  session: MobileSessionSummary,
) {
  return workspaces.map((workspace) => {
    if (workspace.id !== workspaceID && !workspace.sessions.some((item) => item.id === session.id)) return workspace
    return {
      ...workspace,
      updated: Math.max(workspace.updated, session.updated),
      sessions: workspace.sessions.map((item) => (item.id === session.id ? session : item)),
    }
  })
}

function removeSessionFromWorkspaces(workspaces: MobileWorkspace[], sessionID: string) {
  return workspaces.map((workspace) => {
    if (!workspace.sessions.some((session) => session.id === sessionID)) return workspace
    return {
      ...workspace,
      sessions: workspace.sessions.filter((session) => session.id !== sessionID),
    }
  })
}

export default function HomeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const maxWidth = width >= 760 ? 720 : undefined
  const drawerWidth = Math.min(width * 0.86, 430)
  const drawerProgress = useRef(new Animated.Value(0)).current
  const { account, loading: accountLoading } = useAccount()
  const { connection, loading: connectionLoading, saveConnection } = useConnection()
  const { t } = useI18n()
  const focus = useFocus()
  const [refreshing, setRefreshing] = useState(false)
  const [accountDesktops, setAccountDesktops] = useState<MobileAccountRelayDesktop[]>([])
  const [accountDesktopsLoading, setAccountDesktopsLoading] = useState(false)
  const [accountDesktopError, setAccountDesktopError] = useState<string | null>(null)
  const [connectingDesktopID, setConnectingDesktopID] = useState<string | null>(null)
  const [status, setStatus] = useState<MobileStatus | null>(null)
  const [workspaces, setWorkspaces] = useState<MobileWorkspace[]>([])
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<MobileMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messageError, setMessageError] = useState<string | null>(null)
  const [sessionApprovals, setSessionApprovals] = useState<MobileApproval[]>([])
  const [approvalsLoading, setApprovalsLoading] = useState(false)
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [actingApprovalID, setActingApprovalID] = useState<string | null>(null)
  const [optimisticSession, setOptimisticSession] = useState<{ session: MobileSessionSummary; workspaceID: string } | null>(null)
  const [modelOptions, setModelOptions] = useState<MobileProviderModel[]>([])
  const [modelSelection, setModelSelection] = useState<MobileModelSelection>({})
  const [effectiveModel, setEffectiveModel] = useState<MobileProviderModel | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [savingModel, setSavingModel] = useState(false)
  const [draft, setDraft] = useState("")
  const [draftWorkspaceID, setDraftWorkspaceID] = useState<string | null>(null)
  const [draftModelSelection, setDraftModelSelection] = useState<MobileModelSelection>({})
  const [sending, setSending] = useState(false)
  const [answeringQuestionID, setAnsweringQuestionID] = useState<string | null>(null)
  const [drawerMounted, setDrawerMounted] = useState(false)
  const [activeStream, setActiveStream] = useState<ActiveMobileStream | null>(null)
  const messagesRequestSeqRef = useRef(0)
  const selectedSessionIDRef = useRef<string | null>(null)
  const autoConnectAttemptedAtRef = useRef<Record<string, number>>({})
  const accountDesktopRefreshInFlightRef = useRef(false)
  const draftModelSelectionRef = useRef<MobileModelSelection>({})
  const currentApp = useMemo(() => getCurrentAppInfo(), [])
  draftModelSelectionRef.current = draftModelSelection

  const openSessionDrawer = useCallback(() => {
    drawerProgress.stopAnimation()
    setDrawerMounted(true)
    Animated.timing(drawerProgress, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start()
  }, [drawerProgress])

  const closeSessionDrawer = useCallback(() => {
    drawerProgress.stopAnimation()
    Animated.timing(drawerProgress, {
      duration: 180,
      easing: Easing.in(Easing.cubic),
      toValue: 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setDrawerMounted(false)
    })
  }, [drawerProgress])

  const drawerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          drawerMounted && gestureState.dx < -8 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
        onPanResponderGrant: () => {
          drawerProgress.stopAnimation()
        },
        onPanResponderMove: (_, gestureState) => {
          const nextProgress = Math.max(0, Math.min(1, 1 + gestureState.dx / drawerWidth))
          drawerProgress.setValue(nextProgress)
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx < -drawerWidth * 0.24 || gestureState.vx < -0.75) {
            closeSessionDrawer()
            return
          }
          openSessionDrawer()
        },
        onPanResponderTerminate: openSessionDrawer,
      }),
    [closeSessionDrawer, drawerMounted, drawerProgress, drawerWidth, openSessionDrawer],
  )

  const openDrawerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Boolean(connection) &&
          !drawerMounted &&
          gestureState.dx > OPEN_DRAWER_MIN_DX &&
          gestureState.dx > Math.abs(gestureState.dy) * DRAWER_GESTURE_DIRECTION_RATIO,
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          Boolean(connection) &&
          !drawerMounted &&
          gestureState.dx > OPEN_DRAWER_MIN_DX &&
          gestureState.dx > Math.abs(gestureState.dy) * DRAWER_GESTURE_DIRECTION_RATIO,
        onPanResponderGrant: () => {
          drawerProgress.stopAnimation()
          drawerProgress.setValue(0)
          setDrawerMounted(true)
        },
        onPanResponderMove: (_, gestureState) => {
          const nextProgress = Math.max(0, Math.min(1, gestureState.dx / drawerWidth))
          drawerProgress.setValue(nextProgress)
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx > drawerWidth * DRAWER_SETTLE_RATIO || gestureState.vx > OPEN_DRAWER_MIN_VX) {
            openSessionDrawer()
            return
          }
          closeSessionDrawer()
        },
        onPanResponderTerminate: closeSessionDrawer,
      }),
    [closeSessionDrawer, connection, drawerMounted, drawerProgress, drawerWidth, openSessionDrawer],
  )

  useEffect(() => {
    if (connection) return
    drawerProgress.stopAnimation()
    drawerProgress.setValue(0)
    setDrawerMounted(false)
    setDraftWorkspaceID(null)
    setDraftModelSelection({})
  }, [connection, drawerProgress])

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!connection) {
      setStatus(null)
      setWorkspaces([])
      setSessionApprovals([])
      setApprovalsLoading(false)
      setApprovalError(null)
      setActingApprovalID(null)
      return
    }
    if (!options?.silent) {
      setRefreshing(true)
      setError(null)
    }
    try {
      const [nextStatus, nextWorkspaces] = await Promise.all([
        getStatus(connection),
        getWorkspaces(connection),
      ])
      setStatus(nextStatus)
      setWorkspaces(nextWorkspaces)
    } catch (loadError) {
      if (!options?.silent) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load Anybox.")
      }
    } finally {
      if (!options?.silent) setRefreshing(false)
    }
  }, [connection])

  useEffect(() => {
    void load()
  }, [load])

  const loadAccountDesktops = useCallback(async (nextAccount: MobileAccountSession | null = account, options?: { silent?: boolean }) => {
    if (!nextAccount) {
      setAccountDesktops([])
      setAccountDesktopError(null)
      return
    }
    if (isRelayDisabledByEntitlement(nextAccount)) {
      setAccountDesktops([])
      setAccountDesktopError("当前套餐不支持 Relay。请在管理后台启用 Relay 权益后重试。")
      return
    }
    if (accountDesktopRefreshInFlightRef.current) return
    accountDesktopRefreshInFlightRef.current = true
    if (!options?.silent) setAccountDesktopsLoading(true)
    if (!options?.silent) setAccountDesktopError(null)
    try {
      setAccountDesktops(await listAccountRelayDesktops(nextAccount))
      setAccountDesktopError(null)
    } catch (desktopError) {
      if (!options?.silent) {
        setAccountDesktopError(describeAccountApiError(desktopError, "Unable to load desktop devices."))
      }
    } finally {
      accountDesktopRefreshInFlightRef.current = false
      if (!options?.silent) setAccountDesktopsLoading(false)
    }
  }, [account])

  const connectAccountDesktop = useCallback(async (desktop: MobileAccountRelayDesktop) => {
    if (!account || !desktop.online) return
    setConnectingDesktopID(desktop.id)
    setError(null)
    setAccountDesktopError(null)
    try {
      const result = await connectAccountRelayDesktop(account, desktop.id, getMobileDeviceName())
      await saveConnection(account.baseUrl, result.token, result.device.id, {
        transport: "relay",
        desktopID: result.desktop?.id ?? result.desktopID ?? desktop.id,
      })
    } catch (connectError) {
      setAccountDesktopError(describeAccountApiError(connectError, "Unable to connect this desktop."))
    } finally {
      setConnectingDesktopID(null)
    }
  }, [account, saveConnection])

  useEffect(() => {
    if (connection || accountLoading) return
    void loadAccountDesktops(account)
  }, [account, accountLoading, connection, loadAccountDesktops])

  useEffect(() => {
    if (connection || accountLoading || !account) return undefined
    const interval = setInterval(() => {
      void loadAccountDesktops(account, { silent: true })
    }, ACCOUNT_DESKTOP_REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [account, accountLoading, connection, loadAccountDesktops])

  useEffect(() => {
    autoConnectAttemptedAtRef.current = {}
  }, [account?.baseUrl, account?.user.id])

  const onlineDesktops = useMemo(() => accountDesktops.filter((desktop) => desktop.online), [accountDesktops])

  useEffect(() => {
    if (connection || !account || accountDesktopsLoading || connectingDesktopID || onlineDesktops.length !== 1) return
    const [desktop] = onlineDesktops
    if (!desktop) return
    const previousAttemptAt = autoConnectAttemptedAtRef.current[desktop.id] ?? 0
    if (Date.now() - previousAttemptAt < AUTO_CONNECT_RETRY_INTERVAL_MS) return
    autoConnectAttemptedAtRef.current[desktop.id] = Date.now()
    void connectAccountDesktop(desktop)
  }, [account, accountDesktopsLoading, connectAccountDesktop, connectingDesktopID, connection, onlineDesktops])

  const handleIncomingLink = useCallback(
    (url: string) => {
      if (handledIncomingLinks.has(url)) return
      handledIncomingLinks.add(url)
      const bridgeUrl = readConnectionUrlFromDeepLink(url)
      if (!bridgeUrl) return
      try {
        const nextOptions = normalizeConnectionOptionsInput(bridgeUrl, "")
        if (
          connection &&
          nextOptions.length === 1 &&
          nextOptions[0]?.connection.baseUrl === connection.baseUrl &&
          (!nextOptions[0]?.connection.token || nextOptions[0].connection.token === connection.token)
        ) {
          return
        }
      } catch {
        return
      }
      router.push(`/connect?url=${encodeURIComponent(bridgeUrl)}` as never)
    },
    [connection, router],
  )

  useEffect(() => {
    if (connectionLoading) return undefined
    let cancelled = false
    void Linking.getInitialURL()
      .then((url) => {
        if (!cancelled && url) handleIncomingLink(url)
      })
      .catch(() => undefined)

    const subscription = Linking.addEventListener("url", ({ url }) => handleIncomingLink(url))
    return () => {
      cancelled = true
      subscription.remove()
    }
  }, [handleIncomingLink, connectionLoading])

  const sortedWorkspaces = useMemo(
    () => [...workspaces].sort((left, right) => right.updated - left.updated),
    [workspaces],
  )
  const focusedWorkspace = useMemo(
    () =>
      workspaces.find((workspace) => workspace.id === (draftWorkspaceID ?? focus.workspaceID)) ??
      sortedWorkspaces[0] ??
      null,
    [draftWorkspaceID, focus.workspaceID, sortedWorkspaces, workspaces],
  )
  const focusedSessions = useMemo(() => {
    const sessions = focusedWorkspace?.sessions ?? []
    if (!focusedWorkspace || !optimisticSession || optimisticSession.workspaceID !== focusedWorkspace.id) {
      return sortSessions(sessions)
    }
    if (sessions.some((session) => session.id === optimisticSession.session.id)) {
      return sortSessions(sessions)
    }
    return sortSessions([optimisticSession.session, ...sessions])
  }, [focusedWorkspace, optimisticSession])
  const isConversationDraftActive = Boolean(draftWorkspaceID && focusedWorkspace?.id === draftWorkspaceID)
  const focusedSession = useMemo(
    () => (
      isConversationDraftActive
        ? null
        : focus.sessionID
          ? focusedSessions.find((session) => session.id === focus.sessionID) ?? null
          : null
    ),
    [focus.sessionID, focusedSessions, isConversationDraftActive],
  )
  const selectedSessionID = focusedSession?.id ?? null
  selectedSessionIDRef.current = selectedSessionID

  useEffect(() => {
    messagesRequestSeqRef.current += 1
    setActiveStream((current) => (current?.sessionID === selectedSessionID ? current : null))
  }, [selectedSessionID])

  useEffect(() => {
    if (!optimisticSession) return
    const workspace = workspaces.find((item) => item.id === optimisticSession.workspaceID)
    if (workspace?.sessions.some((session) => session.id === optimisticSession.session.id)) {
      setOptimisticSession(null)
    }
  }, [optimisticSession, workspaces])

  useEffect(() => {
    if (focus.loading || !focusedWorkspace) return
    const nextSessionID = focusedSession?.id ?? null
    if (focus.workspaceID === focusedWorkspace.id && focus.sessionID === nextSessionID) return
    void focus.setFocus({
      workspaceID: focusedWorkspace.id,
      sessionID: nextSessionID,
    })
  }, [focus, focusedSession?.id, focusedWorkspace])

  const readSessionMessages = useCallback(async (sessionID: string) => {
    if (!connection) return
    const requestSeq = messagesRequestSeqRef.current + 1
    messagesRequestSeqRef.current = requestSeq
    const nextMessages = await getMessages(connection, sessionID)
    if (messagesRequestSeqRef.current !== requestSeq) return
    if (selectedSessionIDRef.current !== sessionID) return
    setMessages(orderMobileMessagesForDisplay(nextMessages))
  }, [connection])

  const loadMessages = useCallback(async () => {
    if (!connection || !selectedSessionID) {
      messagesRequestSeqRef.current += 1
      setMessages([])
      setMessagesLoading(false)
      setMessageError(null)
      return
    }
    setMessagesLoading(true)
    setMessageError(null)
    try {
      await readSessionMessages(selectedSessionID)
    } catch (loadError) {
      setMessageError(loadError instanceof Error ? loadError.message : "Unable to load conversation.")
    } finally {
      setMessagesLoading(false)
    }
  }, [connection, readSessionMessages, selectedSessionID])

  useEffect(() => {
    void loadMessages()
  }, [loadMessages])

  const readSessionApprovals = useCallback(async (sessionID: string) => {
    if (!connection) return
    const nextApprovals = await getApprovals(connection, { sessionID, status: "pending" })
    setSessionApprovals(
      nextApprovals
        .filter((approval) => approval.status === "pending")
        .sort((left, right) => left.createdAt - right.createdAt),
    )
  }, [connection])

  const loadSessionApprovals = useCallback(async (options?: { silent?: boolean }) => {
    if (!connection || !selectedSessionID) {
      setSessionApprovals([])
      setApprovalsLoading(false)
      setApprovalError(null)
      setActingApprovalID(null)
      return
    }
    if (!options?.silent) {
      setApprovalsLoading(true)
      setApprovalError(null)
    }
    try {
      await readSessionApprovals(selectedSessionID)
    } catch (loadError) {
      if (!options?.silent) {
        setApprovalError(loadError instanceof Error ? loadError.message : "Unable to load approvals.")
      }
    } finally {
      if (!options?.silent) setApprovalsLoading(false)
    }
  }, [connection, readSessionApprovals, selectedSessionID])

  useEffect(() => {
    void loadSessionApprovals()
  }, [loadSessionApprovals])

  const loadSessionModels = useCallback(async (options?: { silent?: boolean }) => {
    const modelSessionID = selectedSessionID
    const modelWorkspaceID = modelSessionID ? null : focusedWorkspace?.id ?? null
    if (!connection || (!modelSessionID && !modelWorkspaceID)) {
      setModelOptions([])
      setModelSelection({})
      setEffectiveModel(null)
      setModelsLoading(false)
      setModelError(null)
      setSavingModel(false)
      return
    }
    if (!options?.silent) {
      setModelsLoading(true)
      setModelError(null)
    }
    try {
      const result = modelSessionID
        ? await getSessionModels(connection, modelSessionID)
        : await getWorkspaceModels(connection, modelWorkspaceID!)
      setModelOptions(result.items.filter((model) => model.available))
      setModelSelection(modelSessionID ? result.selection ?? {} : draftModelSelectionRef.current)
      setEffectiveModel(result.effectiveModel ?? null)
    } catch (loadError) {
      if (!options?.silent) {
        setModelError(loadError instanceof Error ? loadError.message : "Unable to load models.")
      }
    } finally {
      if (!options?.silent) setModelsLoading(false)
    }
  }, [connection, focusedWorkspace?.id, selectedSessionID])

  useEffect(() => {
    void loadSessionModels()
  }, [loadSessionModels])

  const refreshFromMobileEvent = useCallback(() => {
    void load({ silent: true })
    void loadSessionApprovals({ silent: true })
    void loadSessionModels({ silent: true })
    const hasSelectedActiveStream = Boolean(
      selectedSessionID &&
      activeStream?.sessionID === selectedSessionID &&
      activeStream.status !== "error",
    )
    if (selectedSessionID && !hasSelectedActiveStream) {
      void readSessionMessages(selectedSessionID).catch(() => undefined)
    }
  }, [activeStream, load, loadSessionApprovals, loadSessionModels, readSessionMessages, selectedSessionID])

  useMobileEvents({
    connection,
    enabled: Boolean(connection),
    onEvent: refreshFromMobileEvent,
  })

  const visibleMessages = useMemo(
    () => mergeActiveStreamMessages(
      messages,
      activeStream?.sessionID === selectedSessionID ? activeStream : null,
    ),
    [activeStream, messages, selectedSessionID],
  )

  const handleSelectWorkspace = useCallback(
    (workspace: MobileWorkspace) => {
      setOptimisticSession(null)
      setDraftWorkspaceID(workspace.id)
      setDraftModelSelection({})
      setModelSelection({})
      void focus.setFocus({
        workspaceID: workspace.id,
        sessionID: null,
      })
    },
    [focus],
  )

  const handleSelectSession = useCallback(
    (session: MobileSessionSummary, workspace?: MobileWorkspace) => {
      setDraftWorkspaceID(null)
      setDraftModelSelection({})
      setOptimisticSession((current) => (current?.session.id === session.id ? current : null))
      void focus.setFocus({
        workspaceID: workspace?.id ?? focusedWorkspace?.id ?? focus.workspaceID ?? null,
        sessionID: session.id,
      })
    },
    [focus, focusedWorkspace?.id],
  )

  const handleRenameSession = useCallback(async (session: MobileSessionSummary, workspace: MobileWorkspace, title: string) => {
    if (!connection) return
    const updatedSession = await renameSession(connection, session.id, { title })
    setOptimisticSession((current) => (
      current?.session.id === updatedSession.id
        ? { ...current, session: updatedSession }
        : current
    ))
    setWorkspaces((current) => replaceSessionInWorkspaces(current, workspace.id, updatedSession))
    void load({ silent: true })
  }, [connection, load])

  const handleTogglePinSession = useCallback(async (session: MobileSessionSummary, workspace: MobileWorkspace, pinned: boolean) => {
    if (!connection) return
    const updatedSession = await updateSessionPinned(connection, session.id, { pinned })
    setOptimisticSession((current) => (
      current?.session.id === updatedSession.id
        ? { ...current, session: updatedSession }
        : current
    ))
    setWorkspaces((current) => replaceSessionInWorkspaces(current, workspace.id, updatedSession))
    void load({ silent: true })
  }, [connection, load])

  const handleDeleteSession = useCallback(async (session: MobileSessionSummary, workspace: MobileWorkspace) => {
    if (!connection) return
    await deleteRemoteSession(connection, session.id)
    setOptimisticSession((current) => (current?.session.id === session.id ? null : current))
    setWorkspaces((current) => removeSessionFromWorkspaces(current, session.id))
    setActiveStream((current) => (current?.sessionID === session.id ? null : current))
    if (focus.sessionID === session.id) {
      messagesRequestSeqRef.current += 1
      selectedSessionIDRef.current = null
      setMessages([])
      setMessagesLoading(false)
      setMessageError(null)
      setSessionApprovals([])
      setApprovalsLoading(false)
      setApprovalError(null)
      setActingApprovalID(null)
      await focus.setFocus({ workspaceID: workspace.id, sessionID: null })
    }
    void load({ silent: true })
  }, [connection, focus, load])

  const handleCreateConversation = useCallback(() => {
    if (!connection || !focusedWorkspace || sending) return
    messagesRequestSeqRef.current += 1
    selectedSessionIDRef.current = null
    setOptimisticSession(null)
    setDraftWorkspaceID(focusedWorkspace.id)
    setDraftModelSelection({})
    setActiveStream(null)
    setMessages([])
    setMessagesLoading(false)
    setMessageError(null)
    setSessionApprovals([])
    setApprovalsLoading(false)
    setApprovalError(null)
    setActingApprovalID(null)
    setModelOptions([])
    setModelSelection({})
    setEffectiveModel(null)
    setModelsLoading(false)
    setModelError(null)
    setSavingModel(false)
    setDraft("")
    void focus.setFocus({ workspaceID: focusedWorkspace.id, sessionID: null })
  }, [connection, focus, focusedWorkspace, sending])

  const handleApprovalDecision = useCallback(async (approval: MobileApproval, decision: "approve" | "deny") => {
    if (!connection) return
    setActingApprovalID(approval.id)
    setApprovalError(null)
    try {
      await respondApproval(connection, approval.id, decision, { resume: true })
      setSessionApprovals((current) => current.filter((item) => item.id !== approval.id))
      if (selectedSessionID) {
        await Promise.all([
          readSessionApprovals(selectedSessionID).catch(() => undefined),
          readSessionMessages(selectedSessionID).catch(() => undefined),
          load({ silent: true }).catch(() => undefined),
        ])
      }
    } catch (decisionError) {
      setApprovalError(decisionError instanceof Error ? decisionError.message : "Unable to resolve approval.")
    } finally {
      setActingApprovalID(null)
    }
  }, [connection, load, readSessionApprovals, readSessionMessages, selectedSessionID])

  const handleModelSelection = useCallback(async (modelValue: string | null) => {
    if (!connection) return
    if (!selectedSessionID) {
      const nextSelection = applyPrimaryModelSelection(draftModelSelectionRef.current, modelValue)
      setDraftModelSelection(nextSelection)
      setModelSelection(nextSelection)
      setModelError(null)
      return
    }
    const previousSelection = modelSelection
    setSavingModel(true)
    setModelError(null)
    setModelSelection((current) => ({
      ...current,
      model: modelValue ?? undefined,
    }))
    try {
      const nextSelection = await updateSessionModelSelection(connection, selectedSessionID, { model: modelValue })
      setModelSelection(nextSelection)
      void load({ silent: true })
    } catch (saveError) {
      setModelSelection(previousSelection)
      setModelError(saveError instanceof Error ? saveError.message : "Unable to update model.")
    } finally {
      setSavingModel(false)
    }
  }, [connection, load, modelSelection, selectedSessionID])

  const handleAnswerQuestion = useCallback(async (answer: {
    questionID: string
    text: string
    selectedOptions?: string[]
    freeformText?: string
  }) => {
    if (!connection || !selectedSessionID) return
    setAnsweringQuestionID(answer.questionID)
    setMessageError(null)
    const { text, ...structuredAnswer } = answer
    try {
      await answerSessionQuestion(connection, selectedSessionID, structuredAnswer)
      await Promise.all([
        readSessionMessages(selectedSessionID).catch(() => undefined),
        load({ silent: true }).catch(() => undefined),
      ])
    } catch (answerError) {
      if (answerError instanceof MobileApiError && answerError.code === "QUESTION_NOT_WAITING" && text.trim()) {
        try {
          await sendPrompt(connection, selectedSessionID, text.trim())
          await Promise.all([
            readSessionMessages(selectedSessionID).catch(() => undefined),
            load({ silent: true }).catch(() => undefined),
          ])
          return
        } catch (fallbackError) {
          setMessageError(fallbackError instanceof Error ? fallbackError.message : "Unable to send answer.")
          return
        }
      }
      setMessageError(answerError instanceof Error ? answerError.message : "Unable to answer question.")
    } finally {
      setAnsweringQuestionID(null)
    }
  }, [connection, load, readSessionMessages, selectedSessionID])

  const handleSend = useCallback(async () => {
    const text = draft.trim()
    if (!text || sending) return
    if (!connection) {
      setMessageError("Connect AnyboxProvider before sending.")
      return
    }
    if (!focusedWorkspace) {
      setMessageError("Select a project before sending.")
      return
    }

    setSending(true)
    setDraft("")
    const lastMessage = messages.length ? messages[messages.length - 1] : undefined
    const anchorMessageID = lastMessage?.info?.id ?? null
    const createdAt = Date.now()
    const promptID = `local-${createdAt}`
    const streamID = `stream-${createdAt}`
    setMessageError(null)
    let targetSessionID = focusedSession?.id
    const draftSelectionForNewSession = targetSessionID ? null : draftModelSelectionRef.current

    try {
      if (!targetSessionID) {
        const session = await createSession(connection, focusedWorkspace.id, {
          title: buildSessionTitle(text, t("home.mobileChat")),
        })
        targetSessionID = session.id
        selectedSessionIDRef.current = session.id
        setDraftWorkspaceID(null)
        setDraftModelSelection({})
        setOptimisticSession({ session, workspaceID: focusedWorkspace.id })
        setMessages([])
        setSessionApprovals([])
        await focus.setFocus({ workspaceID: focusedWorkspace.id, sessionID: session.id })
        const draftModel = draftSelectionForNewSession?.model?.trim()
        if (draftModel) {
          try {
            const nextSelection = await updateSessionModelSelection(connection, session.id, { model: draftModel })
            setModelSelection(nextSelection)
          } catch (saveError) {
            setModelSelection({})
            setModelError(saveError instanceof Error ? saveError.message : "Unable to update model.")
          }
        }
        await load({ silent: true })
      }

      const streamSessionID = targetSessionID
      setActiveStream({
        sessionID: streamSessionID,
        anchorMessageID,
        createdAt,
        updatedAt: createdAt,
        status: "streaming",
        prompt: {
          id: promptID,
          text,
        },
        assistant: {
          id: streamID,
          segments: [],
        },
      })

      await sendPrompt(connection, streamSessionID, text, {
        onEvent: (event) => {
          setActiveStream((current) => {
            if (!current || current.sessionID !== streamSessionID) return current
            const currentSegments = current.assistant.segments
            const nextSegments = applyMobileStreamToolEvent(currentSegments, event)
            if (nextSegments === currentSegments) return current
            return {
              ...current,
              updatedAt: Date.now(),
              status: current.status === "error" ? current.status : "streaming",
              assistant: {
                ...current.assistant,
                segments: nextSegments,
              },
            }
          })
        },
        onOpen: () => {
          setSending(false)
        },
        onTextDelta: ({ kind, delta, sourceID }) => {
          setActiveStream((current) => {
            if (!current || current.sessionID !== streamSessionID) return current
            return {
              ...current,
              updatedAt: Date.now(),
              status: current.status === "error" ? current.status : "streaming",
              assistant: {
                ...current.assistant,
                segments: appendMessageContentSegment(
                  current.assistant.segments,
                  kind === "reasoning" ? "reasoning" : "response",
                  delta,
                  sourceID,
                ),
              },
            }
          })
        },
      })
      setActiveStream((current) => (
        current?.sessionID === streamSessionID
          ? { ...current, status: "settling", updatedAt: Date.now() }
          : current
      ))
      try {
        await readSessionMessages(streamSessionID)
        setActiveStream((current) => (current?.sessionID === streamSessionID ? null : current))
      } catch (refreshError) {
        const message = refreshError instanceof Error ? refreshError.message : "Unable to refresh conversation."
        setActiveStream((current) => (
          current?.sessionID === streamSessionID
            ? { ...current, status: "error", updatedAt: Date.now(), error: message }
            : current
        ))
        setMessageError(message)
      }
    } catch (sendError) {
      setDraft(text)
      const message = sendError instanceof Error ? sendError.message : "Unable to send prompt."
      setActiveStream((current) => (
        targetSessionID && current?.sessionID === targetSessionID
          ? { ...current, status: "error", updatedAt: Date.now(), error: message }
          : null
      ))
      setMessageError(message)
    } finally {
      setSending(false)
    }
  }, [connection, draft, focus, focusedSession?.id, focusedWorkspace, load, messages, readSessionMessages, sending])

  if (accountLoading || connectionLoading || focus.loading) {
    return (
      <Screen>
        <StateCard title={t("home.openingAnybox")} />
      </Screen>
    )
  }

  const composerDisabled = sending || !draft.trim() || !connection || !focusedWorkspace
  const composerPlaceholder = !connection
    ? t("connection.providerOffline")
    : !focusedWorkspace
      ? t("connection.selectProject")
      : focusedSession
        ? t("connection.sendTo", { title: focusedSession.title })
        : t("connection.startConversation")

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />
      {!connection ? (
        <ConnectionHomePage
          accountDesktops={accountDesktops}
          accountDesktopsLoading={accountDesktopsLoading}
          accountDesktopError={accountDesktopError}
          appVersion={formatAppVersionLabel(currentApp)}
          connectingDesktopID={connectingDesktopID}
          hasAccount={Boolean(account)}
          maxWidth={maxWidth}
          onConnectDesktop={connectAccountDesktop}
          onOpenAccount={() => router.push("/account?mode=login" as never)}
          onOpenSettings={() => router.push("/settings" as never)}
          onRefreshDesktopList={() => void loadAccountDesktops(account)}
          onScan={() => router.push("/scan" as never)}
          paddingBottom={32 + insets.bottom}
          paddingTop={18 + insets.top}
        />
      ) : (
        <View style={{ flex: 1, backgroundColor: "#171717" }} {...openDrawerPanResponder.panHandlers}>
          <ThreadViewPage
            actingApprovalID={actingApprovalID}
            answeringQuestionID={answeringQuestionID}
            approvalError={approvalError}
            approvals={sessionApprovals}
            disabled={composerDisabled}
            draft={draft}
            focusedSession={focusedSession}
            focusedWorkspace={focusedWorkspace}
            effectiveModel={effectiveModel}
            messageError={messageError}
            messages={visibleMessages}
            messagesLoading={messagesLoading}
            modelError={modelError}
            modelSelectionEnabled={Boolean(focusedWorkspace)}
            modelOptions={modelOptions}
            modelsLoading={modelsLoading}
            onApproveApproval={(approval) => void handleApprovalDecision(approval, "approve")}
            onAnswerQuestion={handleAnswerQuestion}
            onChangeText={setDraft}
            onDenyApproval={(approval) => void handleApprovalDecision(approval, "deny")}
            onModelSelect={(modelValue) => void handleModelSelection(modelValue)}
            onNewChat={() => void handleCreateConversation()}
            onOpenDrawer={openSessionDrawer}
            onSend={() => void handleSend()}
            paddingBottom={Math.max(insets.bottom, 10)}
            paddingTop={insets.top}
            placeholder={composerPlaceholder}
            savingModel={savingModel}
            selectedModel={modelSelection.model ?? null}
            sending={sending}
          />
          {drawerMounted ? (
            <>
              <Animated.View
                style={{
                  backgroundColor: "#000000",
                  bottom: 0,
                  left: 0,
                  opacity: drawerProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 0.48],
                  }),
                  position: "absolute",
                  right: 0,
                  top: 0,
                  zIndex: 10,
                }}
              >
                <Pressable
                  accessibilityLabel="Close projects and sessions"
                  accessibilityRole="button"
                  onPress={closeSessionDrawer}
                  style={{ flex: 1 }}
                />
              </Animated.View>
              <Animated.View
                style={{
                  bottom: 0,
                  left: 0,
                  overflow: "hidden",
                  position: "absolute",
                  shadowColor: "#000000",
                  shadowOpacity: 0.28,
                  shadowRadius: 18,
                  top: 0,
                  elevation: 12,
                  transform: [
                    {
                      translateX: drawerProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-drawerWidth, 0],
                      }),
                    },
                  ],
                  width: drawerWidth,
                  zIndex: 11,
                }}
                {...drawerPanResponder.panHandlers}
              >
                <SessionDrawerPage
                  focusedSessionID={focusedSession?.id}
                  focusedWorkspaceID={focusedWorkspace?.id}
                  onDeleteSession={handleDeleteSession}
                  onOpenSettings={() => {
                    closeSessionDrawer()
                    router.push("/settings" as never)
                  }}
                  onRenameSession={handleRenameSession}
                  onSelectSession={handleSelectSession}
                  onSelectWorkspace={handleSelectWorkspace}
                  onTogglePinSession={handleTogglePinSession}
                  paddingBottom={Math.max(insets.bottom, 14)}
                  paddingTop={insets.top}
                  sessions={focusedSessions}
                  workspaces={sortedWorkspaces}
                />
              </Animated.View>
            </>
          ) : null}
        </View>
      )}
    </>
  )
}
