import { Stack, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Animated, Easing, Linking, PanResponder, Pressable, useWindowDimensions, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Screen } from "@/components/screen"
import { StateCard } from "@/components/state-card"
import { ConnectionHomePage } from "@/home/connection"
import { SessionDrawerPage } from "@/home/drawer"
import { buildSessionTitle, formatProviderStatus, sortSessions } from "@/home/format"
import { ThreadViewPage } from "@/home/thread"
import {
  connectAccountRelayDesktop,
  listAccountRelayDesktops,
  type MobileAccountRelayDesktop,
  type MobileAccountSession,
} from "@/api/account-api"
import {
  createSession,
  getApprovals,
  getMessages,
  getSessionModels,
  getStatus,
  getWorkspaces,
  normalizeConnectionOptionsInput,
  readConnectionUrlFromDeepLink,
  respondApproval,
  sendPrompt,
  updateSessionModelSelection,
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
  appendMessageContentSegment,
  mergeOptimisticMessages,
  type PendingPromptOverlay,
  type StreamingAssistantOverlay,
} from "@/utils/message"
import { getMobileDeviceName } from "@/utils/platform"

const handledIncomingLinks = new Set<string>()
const ACCOUNT_DESKTOP_REFRESH_INTERVAL_MS = 10_000
const AUTO_CONNECT_RETRY_INTERVAL_MS = 30_000
const OPEN_DRAWER_MIN_DX = 18
const OPEN_DRAWER_MIN_VX = 0.65
const DRAWER_GESTURE_DIRECTION_RATIO = 1.25
const DRAWER_SETTLE_RATIO = 0.18

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
  const [endpoint, setEndpoint] = useState("")
  const [token, setToken] = useState("")
  const [manualOpen, setManualOpen] = useState(false)
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
  const [sending, setSending] = useState(false)
  const [drawerMounted, setDrawerMounted] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<PendingPromptOverlay | null>(null)
  const [streamingAssistant, setStreamingAssistant] = useState<StreamingAssistantOverlay | null>(null)
  const autoConnectAttemptedAtRef = useRef<Record<string, number>>({})
  const accountDesktopRefreshInFlightRef = useRef(false)
  const currentApp = useMemo(() => getCurrentAppInfo(), [])

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
  }, [connection, drawerProgress])

  useEffect(() => {
    if (!accountLoading && !connectionLoading && !account && !connection) {
      router.replace("/account" as never)
    }
  }, [account, accountLoading, connection, connectionLoading, router])

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

  const openConnectionConfirmation = useCallback((nextEndpoint: string, nextToken: string) => {
    setError(null)
    try {
      normalizeConnectionOptionsInput(nextEndpoint, nextToken)
      const params = new URLSearchParams({ url: nextEndpoint })
      if (nextToken.trim()) params.set("token", nextToken.trim())
      router.push(`/connect?${params.toString()}` as never)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to prepare connection.")
    }
  }, [router])

  const handleIncomingLink = useCallback(
    (url: string) => {
      if (handledIncomingLinks.has(url)) return
      handledIncomingLinks.add(url)
      const bridgeUrl = readConnectionUrlFromDeepLink(url)
      if (!bridgeUrl) return
      setEndpoint(bridgeUrl)
      setToken("")
      try {
        const nextOptions = normalizeConnectionOptionsInput(bridgeUrl, "")
        if (
          connection &&
          nextOptions.length === 1 &&
          !nextOptions[0]?.connection.pairingCode &&
          nextOptions[0]?.connection.baseUrl === connection.baseUrl &&
          nextOptions[0]?.connection.token === connection.token
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
    () => workspaces.find((workspace) => workspace.id === focus.workspaceID) ?? sortedWorkspaces[0] ?? null,
    [focus.workspaceID, sortedWorkspaces, workspaces],
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
  const focusedSession = useMemo(
    () => (focus.sessionID ? focusedSessions.find((session) => session.id === focus.sessionID) ?? null : null),
    [focus.sessionID, focusedSessions],
  )
  const selectedSessionID = focusedSession?.id ?? null

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
    const nextMessages = await getMessages(connection, sessionID)
    setMessages(nextMessages)
  }, [connection])

  const loadMessages = useCallback(async () => {
    if (!connection || !selectedSessionID) {
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
    if (!connection || !selectedSessionID) {
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
      const result = await getSessionModels(connection, selectedSessionID)
      setModelOptions(result.items.filter((model) => model.available))
      setModelSelection(result.selection ?? {})
      setEffectiveModel(result.effectiveModel ?? null)
    } catch (loadError) {
      if (!options?.silent) {
        setModelError(loadError instanceof Error ? loadError.message : "Unable to load models.")
      }
    } finally {
      if (!options?.silent) setModelsLoading(false)
    }
  }, [connection, selectedSessionID])

  useEffect(() => {
    void loadSessionModels()
  }, [loadSessionModels])

  const refreshFromMobileEvent = useCallback(() => {
    void load({ silent: true })
    void loadSessionApprovals({ silent: true })
    void loadSessionModels({ silent: true })
    if (selectedSessionID) {
      void readSessionMessages(selectedSessionID).catch(() => undefined)
    }
  }, [load, loadSessionApprovals, loadSessionModels, readSessionMessages, selectedSessionID])

  useMobileEvents({
    connection,
    enabled: Boolean(connection),
    onEvent: refreshFromMobileEvent,
  })

  const visibleMessages = useMemo(
    () => mergeOptimisticMessages(messages, pendingPrompt, streamingAssistant),
    [messages, pendingPrompt, streamingAssistant],
  )

  const handleSelectWorkspace = useCallback(
    (workspace: MobileWorkspace) => {
      setOptimisticSession(null)
      void focus.setFocus({
        workspaceID: workspace.id,
        sessionID: null,
      })
    },
    [focus],
  )

  const handleSelectSession = useCallback(
    (session: MobileSessionSummary, workspace?: MobileWorkspace) => {
      setOptimisticSession((current) => (current?.session.id === session.id ? current : null))
      void focus.setFocus({
        workspaceID: workspace?.id ?? focusedWorkspace?.id ?? focus.workspaceID ?? null,
        sessionID: session.id,
      })
    },
    [focus, focusedWorkspace?.id],
  )

  const handleCreateConversation = useCallback(async () => {
    if (!connection || !focusedWorkspace) return
    setSending(true)
    setMessageError(null)
    setApprovalError(null)
    try {
      const session = await createSession(connection, focusedWorkspace.id, { title: "Mobile chat" })
      setOptimisticSession({ session, workspaceID: focusedWorkspace.id })
      setMessages([])
      setSessionApprovals([])
      await focus.setFocus({ workspaceID: focusedWorkspace.id, sessionID: session.id })
      await load({ silent: true })
    } catch (createError) {
      setMessageError(createError instanceof Error ? createError.message : "Unable to create conversation.")
    } finally {
      setSending(false)
    }
  }, [connection, focus, focusedWorkspace, load])

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
    if (!connection || !selectedSessionID) return
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
    const anchorMessageID = messages.at(-1)?.info?.id ?? null
    setPendingPrompt({ id: `local-${Date.now()}`, text, anchorMessageID })
    const streamID = `stream-${Date.now()}`
    setStreamingAssistant({ id: streamID, segments: [], anchorMessageID })
    setMessageError(null)

    try {
      let targetSessionID = focusedSession?.id
      if (!targetSessionID) {
        const session = await createSession(connection, focusedWorkspace.id, {
          title: buildSessionTitle(text, t("home.mobileChat")),
        })
        targetSessionID = session.id
        setOptimisticSession({ session, workspaceID: focusedWorkspace.id })
        setSessionApprovals([])
        await focus.setFocus({ workspaceID: focusedWorkspace.id, sessionID: session.id })
        await load({ silent: true })
      }

      await sendPrompt(connection, targetSessionID, text, {
        onEvent: () => {
          void readSessionMessages(targetSessionID).catch(() => undefined)
        },
        onOpen: () => {
          setSending(false)
        },
        onTextDelta: ({ kind, delta }) => {
          setStreamingAssistant((current) => ({
            id: current?.id ?? streamID,
            segments: appendMessageContentSegment(
              current?.segments ?? [],
              kind === "reasoning" ? "reasoning" : "response",
              delta,
            ),
            anchorMessageID: current?.anchorMessageID ?? anchorMessageID,
          }))
        },
      })
      setPendingPrompt(null)
      setStreamingAssistant(null)
      await readSessionMessages(targetSessionID)
    } catch (sendError) {
      setPendingPrompt(null)
      setStreamingAssistant(null)
      setDraft(text)
      setMessageError(sendError instanceof Error ? sendError.message : "Unable to send prompt.")
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

  if (!account && !connection) {
    return (
      <Screen>
        <StateCard title={t("home.openingEmailSignIn")} />
      </Screen>
    )
  }

  const providerStatus = formatProviderStatus({
    accountDesktopsLoading,
    connectingDesktopID,
    connection,
    onlineDesktops,
    status,
    t,
  })
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
          endpoint={endpoint}
          error={error}
          manualOpen={manualOpen}
          maxWidth={maxWidth}
          onConnectDesktop={connectAccountDesktop}
          onEndpointChange={setEndpoint}
          onManualToggle={() => setManualOpen((current) => !current)}
          onOpenDiagnostics={() => router.push("/diagnostics" as never)}
          onOpenProvider={() => router.push("/provider" as never)}
          onOpenSettings={() => router.push("/settings" as never)}
          onOpenUpdates={() => router.push("/updates" as never)}
          onRefreshDesktopList={() => void loadAccountDesktops(account)}
          onReviewConnection={() => openConnectionConfirmation(endpoint, token)}
          onScan={() => router.push("/scan" as never)}
          onTokenChange={setToken}
          paddingBottom={32 + insets.bottom}
          paddingTop={18 + insets.top}
          providerDetail={providerStatus.detail}
          providerLabel={providerStatus.label}
          providerTone={providerStatus.tone}
          token={token}
        />
      ) : (
        <View style={{ flex: 1, backgroundColor: "#171717" }} {...openDrawerPanResponder.panHandlers}>
          <ThreadViewPage
            actingApprovalID={actingApprovalID}
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
            modelOptions={modelOptions}
            modelsLoading={modelsLoading}
            onApproveApproval={(approval) => void handleApprovalDecision(approval, "approve")}
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
                  onNewChat={() => {
                    void handleCreateConversation()
                  }}
                  onOpenSettings={() => {
                    closeSessionDrawer()
                    router.push("/settings" as never)
                  }}
                  onSelectSession={handleSelectSession}
                  onSelectWorkspace={handleSelectWorkspace}
                  paddingBottom={Math.max(insets.bottom, 14)}
                  paddingTop={insets.top}
                  sending={sending}
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
