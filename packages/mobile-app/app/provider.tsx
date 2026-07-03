import Feather from "@expo/vector-icons/Feather"
import { useRouter } from "expo-router"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native"
import { Screen } from "@/components/screen"
import { Section } from "@/components/section"
import { StateCard } from "@/components/state-card"
import { theme, type ThemeTone } from "@/theme"
import {
  connectAccountRelayDesktop,
  listAccountRelayDesktops,
  type MobileAccountRelayDesktop,
} from "@/api/account-api"
import {
  getStatus,
  isRelayConnection,
  revokeCurrentDevice,
  type MobileStatus,
} from "@/api/mobile-api"
import { useI18n } from "@/i18n"
import { useAccount } from "@/state/account"
import { useConnection } from "@/state/connection"
import {
  describeAccountApiError,
  isRelayDisabledByEntitlement,
} from "@/utils/account-entitlements"
import { formatRelativeTime, trimMiddle } from "@/utils/format"
import { getMobileDeviceName } from "@/utils/platform"

type FeatherName = React.ComponentProps<typeof Feather>["name"]

export default function ProviderScreen() {
  const router = useRouter()
  const { t } = useI18n()
  const { account, refreshAccount } = useAccount()
  const { connection, clearConnection, saveConnection } = useConnection()
  const [status, setStatus] = useState<MobileStatus | null>(null)
  const [desktops, setDesktops] = useState<MobileAccountRelayDesktop[]>([])
  const [loading, setLoading] = useState(false)
  const [desktopLoading, setDesktopLoading] = useState(false)
  const [connectingDesktopID, setConnectingDesktopID] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [desktopError, setDesktopError] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const refreshedAccountKeyRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (!connection) {
        setStatus(null)
        return
      }
      setStatus(await getStatus(connection))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("provider.connectionRefreshFailed"))
    } finally {
      setLoading(false)
    }
  }, [connection])

  const loadDesktops = useCallback(async () => {
    if (!account) {
      setDesktops([])
      setDesktopError(null)
      return
    }
    if (isRelayDisabledByEntitlement(account)) {
      setDesktops([])
      setDesktopError(null)
      return
    }
    setDesktopLoading(true)
    setDesktopError(null)
    try {
      setDesktops(await listAccountRelayDesktops(account))
    } catch (loadError) {
      setDesktopError(describeAccountApiError(loadError, t("provider.desktopListFailed")))
    } finally {
      setDesktopLoading(false)
    }
  }, [account])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadDesktops()
  }, [loadDesktops])

  useEffect(() => {
    if (!account) {
      refreshedAccountKeyRef.current = null
      return
    }
    const refreshKey = `${account.baseUrl}:${account.user.id}`
    if (refreshedAccountKeyRef.current === refreshKey) return
    refreshedAccountKeyRef.current = refreshKey
    let cancelled = false
    refreshAccount().catch((refreshError) => {
      if (!cancelled) setDesktopError((current) => current ?? describeAccountApiError(refreshError, t("provider.desktopListFailed")))
    })
    return () => {
      cancelled = true
    }
  }, [account?.baseUrl, account?.user.id, refreshAccount])

  const sortedDesktops = useMemo(() => {
    return [...desktops].sort((left, right) => {
      const leftCurrent = left.id === connection?.desktopID
      const rightCurrent = right.id === connection?.desktopID
      if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1
      if (left.online !== right.online) return left.online ? -1 : 1
      return right.lastSeenAt - left.lastSeenAt
    })
  }, [connection?.desktopID, desktops])

  const runDisconnect = useCallback(async () => {
    if (!connection) return
    setDisconnecting(true)
    setError(null)
    try {
      if (connection.deviceID) {
        await revokeCurrentDevice(connection)
      }
      await clearConnection()
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : t("provider.changeConnection"))
    } finally {
      setDisconnecting(false)
    }
  }, [clearConnection, connection])

  const handleDisconnect = useCallback(() => {
    if (!connection) return
    Alert.alert(t("provider.changeTitle"), t("provider.changeMessage"), [
      { text: t("app.cancel"), style: "cancel" },
      {
        text: t("provider.changeAction"),
        style: "destructive",
        onPress: () => void runDisconnect(),
      },
    ])
  }, [connection, runDisconnect])

  const connectDesktop = useCallback(async (desktop: MobileAccountRelayDesktop) => {
    if (!account || !desktop.online) return
    setConnectingDesktopID(desktop.id)
    setDesktopError(null)
    setError(null)
    try {
      const previousConnection = connection
      const result = await connectAccountRelayDesktop(account, desktop.id, getMobileDeviceName())
      await saveConnection(account.baseUrl, result.token, result.device.id, {
        transport: "relay",
        desktopID: result.desktop?.id ?? result.desktopID ?? desktop.id,
      })
      if (previousConnection?.deviceID) {
        await revokeCurrentDevice(previousConnection).catch(() => undefined)
      }
    } catch (connectError) {
      setDesktopError(describeAccountApiError(connectError, t("connection.failed")))
    } finally {
      setConnectingDesktopID(null)
    }
  }, [account, connection, saveConnection])

  const connectionState = status?.online ? t("home.provider.connected") : connection ? t("home.provider.checking") : t("settings.connection.offline")
  const connectionTone: ThemeTone = status?.online ? "success" : connection ? "neutral" : "danger"
  const relayDisabled = isRelayDisabledByEntitlement(account)
  const desktopName = status?.desktopName?.trim() || currentDesktopName(connection?.desktopID, desktops) || t("home.provider.defaultDesktop")
  const transportLabel = connection?.transport === "relay" ? "Relay" : connection ? "Local" : t("app.unknown")
  const capabilityCount = status?.capabilities?.length ?? 0
  const capabilityLabel = formatCapabilityCount(capabilityCount, t)
  const diagnostics = buildDiagnostics({
    accountEmail: account?.user.email,
    accountWorkspace: account?.workspace?.name,
    connection,
    status,
  })

  return (
    <Screen>
      <Section title={t("provider.currentConnection")} caption={transportLabel}>
        <ConnectionSummary
          desktopName={desktopName}
          state={connectionState}
          tone={connectionTone}
          connected={Boolean(connection)}
        />
        {error ? <StateCard title={t("provider.connectionRefreshFailed")} detail={error} tone="danger" /> : null}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <ActionButton icon="refresh-cw" label={t("app.refresh")} loading={loading} onPress={() => void load()} variant="secondary" />
          </View>
          <View style={{ flex: 1 }}>
            <ActionButton icon="camera" label={t("connection.scanQr")} onPress={() => router.push("/scan" as never)} variant="primary" />
          </View>
        </View>
        <ActionButton disabled={!connection} icon="repeat" label={t("provider.changeConnection")} loading={disconnecting} onPress={handleDisconnect} variant="danger" />
      </Section>

      <Section title={t("connection.availableDesktops")} caption={desktopLoading ? t("app.searching") : `${desktops.length}`}>
        {relayDisabled ? <StateCard title={t("provider.relayUnavailable")} detail={t("provider.relayUnavailableDetail")} tone="danger" /> : null}
        {desktopError ? <StateCard title={t("provider.desktopListFailed")} detail={desktopError} tone="danger" /> : null}
        {!relayDisabled && sortedDesktops.length ? (
          sortedDesktops.map((desktop) => {
            const isCurrentDesktop = desktop.id === connection?.desktopID
            const currentConnectionIsOnline = isCurrentDesktop && status?.online === true
            const canConnectDesktop = desktop.online && connectingDesktopID !== desktop.id && (!isCurrentDesktop || !currentConnectionIsOnline)
            const actionLabel =
              connectingDesktopID === desktop.id
                ? t("connection.connecting")
                : isCurrentDesktop
                  ? currentConnectionIsOnline
                    ? t("provider.current")
                    : desktop.online
                      ? t("provider.reconnect")
                      : t("provider.current")
                  : desktop.online
                    ? t("provider.switch")
                    : t("connection.offline")
            return (
              <DesktopDeviceRow
                actionLabel={actionLabel}
                actionTone={desktop.online ? (isCurrentDesktop ? "success" : "neutral") : "danger"}
                capabilities={desktop.capabilities.length}
                connecting={connectingDesktopID === desktop.id}
                current={isCurrentDesktop}
                key={desktop.id}
                lastSeenAt={desktop.lastSeenAt}
                name={desktop.name}
                onPress={canConnectDesktop ? () => void connectDesktop(desktop) : undefined}
                online={desktop.online}
                version={desktop.appVersion}
              />
            )
          })
        ) : !relayDisabled ? (
          <StateCard title={desktopLoading ? t("connection.findingDesktops") : t("connection.noDesktops")} />
        ) : null}
        <ActionButton icon="refresh-cw" label={t("provider.refreshDesktops")} loading={desktopLoading} onPress={() => void loadDesktops()} variant="secondary" />
      </Section>

      <CollapsiblePanel
        caption={capabilityLabel}
        expanded={advancedOpen}
        onToggle={() => setAdvancedOpen((current) => !current)}
        title={t("provider.advanced")}
      >
        <DetailCard>
          <DetailRow title={t("provider.providerUrl")} value={account?.baseUrl ?? connection?.baseUrl ?? t("app.unknown")} />
          <DetailRow divided title={t("provider.version")} value={status?.appVersion ?? t("app.unknown")} />
          <DetailRow divided title={t("provider.capabilities")} value={capabilityCount ? `${capabilityCount}` : t("app.unknown")} />
        </DetailCard>
        {status?.capabilities?.length ? <CapabilityCard capabilities={status.capabilities} /> : null}
        <DetailCard>
          <DetailRow mono title={t("provider.endpoint")} value={connection ? trimMiddle(connection.baseUrl, 76) : t("settings.connection.offline")} />
          {connection?.desktopID ? <DetailRow divided mono title={t("provider.desktopId")} value={trimMiddle(connection.desktopID, 76)} /> : null}
          {connection?.deviceID ? <DetailRow divided mono title={t("provider.mobileDeviceId")} value={trimMiddle(connection.deviceID, 76)} /> : null}
        </DetailCard>
        <DiagnosticsCard diagnostics={diagnostics} />
      </CollapsiblePanel>
    </Screen>
  )
}

function ConnectionSummary({
  connected,
  desktopName,
  state,
  tone,
}: {
  connected: boolean
  desktopName: string
  state: string
  tone: ThemeTone
}) {
  const { t } = useI18n()

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        gap: theme.spacing.xl,
        padding: theme.spacing.xxl,
      }}
    >
      <View style={{ alignItems: "flex-start", flexDirection: "row", gap: theme.spacing.xl }}>
        <View style={{ flex: 1, gap: theme.spacing.sm, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              color: theme.colors.text,
              fontSize: theme.typography.size.xl,
              fontWeight: theme.typography.weight.heavy,
            }}
          >
            {connected ? desktopName : t("provider.noDesktopConnected")}
          </Text>
          {!connected ? (
            <Text
              numberOfLines={2}
              style={{
                color: theme.colors.textMuted,
                fontSize: theme.typography.size.sm,
                lineHeight: theme.typography.lineHeight.sm,
              }}
            >
              {t("provider.connectDesktopHint")}
            </Text>
          ) : null}
        </View>
        <StatusBadge label={state} tone={tone} />
      </View>
    </View>
  )
}

function DetailCard({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        overflow: "hidden",
        paddingHorizontal: theme.spacing.xxl,
      }}
    >
      {children}
    </View>
  )
}

function DetailRow({
  badgeTone,
  divided,
  mono,
  onPress,
  title,
  value,
}: {
  badgeTone?: ThemeTone
  divided?: boolean
  mono?: boolean
  onPress?: () => void
  title: string
  value: string
}) {
  const interactive = Boolean(onPress)
  return (
    <Pressable
      accessibilityLabel={interactive ? title : undefined}
      accessibilityRole={interactive ? "button" : undefined}
      accessible={interactive}
      disabled={!interactive}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        borderColor: theme.colors.border,
        borderTopWidth: divided ? 1 : 0,
        flexDirection: "row",
        gap: theme.spacing.xl,
        minHeight: 48,
        opacity: pressed ? theme.opacity.pressed : 1,
        paddingVertical: theme.spacing.lg,
      })}
    >
      <Text
        style={{
          color: theme.colors.textSubtle,
          flex: 1,
          fontSize: theme.typography.size.sm,
          fontWeight: theme.typography.weight.bold,
        }}
      >
        {title}
      </Text>
      {badgeTone ? (
        <StatusBadge label={value} tone={badgeTone} />
      ) : (
        <Text
          numberOfLines={2}
          selectable={!interactive}
          style={{
            color: theme.colors.text,
            flex: 1.5,
            flexShrink: 1,
            fontFamily: mono ? theme.typography.family.mono : undefined,
            fontSize: mono ? theme.typography.size.xs : theme.typography.size.md,
            lineHeight: mono ? theme.typography.lineHeight.sm : theme.typography.lineHeight.md,
            textAlign: "right",
          }}
        >
          {value}
        </Text>
      )}
      {interactive ? <Feather color={theme.colors.textPlaceholder} name="chevron-right" size={18} /> : null}
    </Pressable>
  )
}

function DesktopDeviceRow({
  actionLabel,
  actionTone,
  capabilities,
  connecting,
  current,
  lastSeenAt,
  name,
  onPress,
  online,
  version,
}: {
  actionLabel: string
  actionTone: ThemeTone
  capabilities: number
  connecting: boolean
  current: boolean
  lastSeenAt: number
  name: string
  onPress?: () => void
  online: boolean
  version?: string
}) {
  const { locale, t } = useI18n()
  const subtitle = online
    ? [version, formatCapabilityCount(capabilities, t)].filter(Boolean).join(" / ")
    : t("connection.lastSeen", { time: formatRelativeTime(lastSeenAt, locale) })
  return (
    <Pressable
      accessibilityLabel={onPress ? name : undefined}
      accessibilityRole={onPress ? "button" : undefined}
      accessible={Boolean(onPress)}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.surface,
        borderColor: current ? theme.colors.status.success.border : theme.colors.border,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        opacity: pressed ? theme.opacity.pressed : 1,
        padding: theme.spacing.xxl,
      })}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: theme.spacing.xl }}>
        <View
          style={{
            backgroundColor: online ? theme.colors.status.success.text : theme.colors.textPlaceholder,
            borderRadius: theme.radius.indicator,
            height: 8,
            width: 8,
          }}
        />
        <View style={{ flex: 1, gap: theme.spacing.sm, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              color: theme.colors.text,
              fontSize: theme.typography.size.lg,
              fontWeight: theme.typography.weight.bold,
            }}
          >
            {name}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              color: theme.colors.textMuted,
              fontSize: theme.typography.size.sm,
            }}
          >
            {subtitle}
          </Text>
        </View>
        {connecting ? <ActivityIndicator color={theme.colors.textSubtle} /> : <StatusBadge label={actionLabel} tone={actionTone} />}
      </View>
    </Pressable>
  )
}

function CollapsiblePanel({
  caption,
  children,
  expanded,
  onToggle,
  title,
}: {
  caption?: string
  children: React.ReactNode
  expanded: boolean
  onToggle: () => void
  title: string
}) {
  return (
    <View style={{ gap: theme.spacing.lg }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => ({
          alignItems: "center",
          flexDirection: "row",
          gap: theme.spacing.xl,
          justifyContent: "space-between",
          opacity: pressed ? theme.opacity.pressed : 1,
        })}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              color: theme.colors.text,
              fontSize: theme.typography.size.xl,
              fontWeight: theme.typography.weight.heavy,
            }}
          >
            {title}
          </Text>
        </View>
        {caption ? (
          <Text
            numberOfLines={1}
            style={{
              color: theme.colors.textMuted,
              fontSize: theme.typography.size.sm,
            }}
          >
            {caption}
          </Text>
        ) : null}
        <Feather color={theme.colors.textMuted} name={expanded ? "chevron-up" : "chevron-down"} size={20} />
      </Pressable>
      {expanded ? <View style={{ gap: theme.spacing.lg }}>{children}</View> : null}
    </View>
  )
}

function CapabilityCard({ capabilities }: { capabilities: string[] }) {
  const { t } = useI18n()

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        gap: theme.spacing.xl,
        padding: theme.spacing.xxl,
      }}
    >
      <Text
        style={{
          color: theme.colors.textSubtle,
          fontSize: theme.typography.size.sm,
          fontWeight: theme.typography.weight.bold,
        }}
      >
        {t("provider.capabilityList")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md }}>
        {capabilities.map((capability) => (
          <View
            key={capability}
            style={{
              backgroundColor: theme.colors.surfaceSubtle,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.pill,
              borderWidth: 1,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.xs,
            }}
          >
            <Text
              selectable
              style={{
                color: theme.colors.textSubtle,
                fontFamily: theme.typography.family.mono,
                fontSize: theme.typography.size.xs,
              }}
            >
              {capability}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function DiagnosticsCard({ diagnostics }: { diagnostics: string }) {
  const { t } = useI18n()

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        gap: theme.spacing.xl,
        padding: theme.spacing.xxl,
      }}
    >
      <Text
        style={{
          color: theme.colors.textSubtle,
          fontSize: theme.typography.size.sm,
          fontWeight: theme.typography.weight.bold,
        }}
      >
        {t("nav.diagnostics")}
      </Text>
      <Text
        selectable
        style={{
          color: theme.colors.textSubtle,
          fontFamily: theme.typography.family.mono,
          fontSize: theme.typography.size.xs,
          lineHeight: theme.typography.lineHeight.sm,
        }}
      >
        {diagnostics}
      </Text>
    </View>
  )
}

function StatusBadge({ label, tone }: { label: string; tone: ThemeTone }) {
  const toneColors = theme.colors.status[tone]
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: tone === "neutral" ? theme.colors.surfaceSubtle : toneColors.background,
        borderColor: toneColors.border,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        flexDirection: "row",
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.xs,
      }}
    >
      <View
        style={{
          backgroundColor: toneColors.text,
          borderRadius: theme.radius.indicator,
          height: 6,
          width: 6,
        }}
      />
      <Text
        numberOfLines={1}
        style={{
          color: toneColors.text,
          fontSize: theme.typography.size.xs,
          fontWeight: theme.typography.weight.bold,
        }}
      >
        {label}
      </Text>
    </View>
  )
}

function ActionButton({
  disabled,
  icon,
  label,
  loading,
  onPress,
  variant,
}: {
  disabled?: boolean
  icon: FeatherName
  label: string
  loading?: boolean
  onPress: () => void
  variant: "primary" | "secondary" | "danger"
}) {
  const isDisabled = disabled || loading
  const colors = actionButtonColors(variant)
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: colors.background,
        borderColor: colors.border,
        borderRadius: theme.radius.sm,
        borderWidth: colors.borderWidth,
        flexDirection: "row",
        gap: theme.spacing.md,
        justifyContent: "center",
        minHeight: 46,
        opacity: isDisabled ? theme.opacity.disabled : pressed ? theme.opacity.pressedStrong : 1,
        paddingHorizontal: theme.spacing.screen,
        paddingVertical: theme.spacing.xl,
      })}
    >
      {loading ? <ActivityIndicator color={colors.text} /> : <Feather color={colors.text} name={icon} size={18} />}
      <Text
        numberOfLines={1}
        style={{
          color: colors.text,
          fontSize: theme.typography.size.lg,
          fontWeight: theme.typography.weight.bold,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function actionButtonColors(variant: "primary" | "secondary" | "danger") {
  if (variant === "primary") {
    return {
      background: theme.colors.actionPrimary,
      border: theme.colors.actionPrimary,
      borderWidth: 0,
      text: theme.colors.textInverted,
    }
  }
  if (variant === "danger") {
    return {
      background: theme.colors.status.danger.background,
      border: theme.colors.status.danger.border,
      borderWidth: 1,
      text: theme.colors.status.danger.text,
    }
  }
  return {
    background: theme.colors.actionSecondary,
    border: theme.colors.actionSecondary,
    borderWidth: 0,
    text: theme.colors.text,
  }
}

function formatCapabilityCount(count: number, t: ReturnType<typeof useI18n>["t"]) {
  if (!count) return t("provider.unknownCapabilities")
  if (count === 1 && t("provider.capabilityCount", { count }) === "1 capabilities") return "1 capability"
  return t("provider.capabilityCount", { count })
}

function currentDesktopName(desktopID: string | undefined, desktops: MobileAccountRelayDesktop[]) {
  if (!desktopID) return null
  return desktops.find((desktop) => desktop.id === desktopID)?.name ?? null
}

function buildDiagnostics({
  accountEmail,
  accountWorkspace,
  connection,
  status,
}: {
  accountEmail?: string
  accountWorkspace?: string
  connection: ReturnType<typeof useConnection>["connection"]
  status: MobileStatus | null
}) {
  return [
    `status=${status?.online ? "connected" : connection ? "checking" : "not_connected"}`,
    `transport=${connection?.transport === "relay" ? "relay" : connection ? "local" : "none"}`,
    `relay=${isRelayConnection(connection) ? "yes" : "no"}`,
    `desktop=${status?.desktopName ?? "unknown"}`,
    `version=${status?.appVersion ?? "unknown"}`,
    `endpoint=${connection ? trimMiddle(connection.baseUrl, 96) : "none"}`,
    `desktop_id=${connection?.desktopID ? trimMiddle(connection.desktopID, 96) : "none"}`,
    `device_id=${connection?.deviceID ? trimMiddle(connection.deviceID, 96) : "none"}`,
    `account=${accountEmail ?? "none"}`,
    `workspace=${accountWorkspace ?? "unknown"}`,
    `capabilities=${status?.capabilities?.length ?? 0}`,
  ].join("\n")
}
