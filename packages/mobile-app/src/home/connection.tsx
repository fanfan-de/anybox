import Feather from "@expo/vector-icons/Feather"
import React from "react"
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native"
import type { MobileAccountRelayDesktop } from "@/api/account-api"
import { useI18n } from "@/i18n"
import { theme } from "@/theme"
import { formatRelativeTime } from "@/utils/format"

type FeatherName = React.ComponentProps<typeof Feather>["name"]

const homeColors = {
  canvas: "#141414",
  panel: "#1d1d1b",
  panelStrong: "#252522",
  border: "rgba(247, 247, 244, 0.13)",
  borderStrong: "rgba(247, 247, 244, 0.22)",
  text: "#f7f7f4",
  textMuted: "rgba(247, 247, 244, 0.68)",
  textSubtle: "rgba(247, 247, 244, 0.48)",
  primary: "#f7f7f4",
  primaryText: "#121211",
  dangerBackground: "rgba(255, 107, 107, 0.12)",
  dangerBorder: "rgba(255, 107, 107, 0.34)",
  dangerText: "#ffb0a8",
  successText: "#74d58b",
  warningText: "#f5c86b",
} as const

export function ConnectionHomePage({
  accountDesktops,
  accountDesktopsLoading,
  accountDesktopError,
  appVersion,
  connectingDesktopID,
  hasAccount,
  maxWidth,
  onConnectDesktop,
  onOpenAccount,
  onOpenSettings,
  onRefreshDesktopList,
  onScan,
  paddingBottom,
  paddingTop,
}: {
  accountDesktops: MobileAccountRelayDesktop[]
  accountDesktopsLoading: boolean
  accountDesktopError: string | null
  appVersion: string
  connectingDesktopID: string | null
  hasAccount: boolean
  maxWidth?: number
  onConnectDesktop: (desktop: MobileAccountRelayDesktop) => Promise<void>
  onOpenAccount: () => void
  onOpenSettings: () => void
  onRefreshDesktopList: () => void
  onScan: () => void
  paddingBottom: number
  paddingTop: number
}) {
  const { t } = useI18n()
  const showDesktopResults = hasAccount && (accountDesktopsLoading || Boolean(accountDesktopError) || accountDesktops.length > 0)

  return (
    <View style={{ flex: 1, backgroundColor: homeColors.canvas }}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{
          alignItems: "center",
          flexGrow: 1,
          paddingBottom,
          paddingHorizontal: 28,
          paddingTop,
        }}
      >
        <View style={{ flex: 1, maxWidth, minHeight: 620, width: "100%" }}>
          <View style={{ alignItems: "center", flexDirection: "row", minHeight: 40 }}>
            <Text style={{ color: homeColors.text, flex: 1, fontSize: 22, fontWeight: "900" }}>
              Anybox
            </Text>
            <HeaderIconButton icon="settings" label={t("nav.settings")} onPress={onOpenSettings} />
          </View>

          <View
            style={{
              alignItems: "center",
              flex: 1,
              justifyContent: "center",
              paddingBottom: showDesktopResults ? 30 : 76,
              paddingTop: 36,
            }}
          >
            <View style={{ alignItems: "center", gap: 16, width: "100%" }}>
              <Image
                accessibilityIgnoresInvertColors
                source={require("../../assets/icon.png")}
                style={{ borderRadius: 24, height: 88, width: 88 }}
              />
              <View style={{ alignItems: "center", gap: 8 }}>
                <Text
                  style={{
                    color: homeColors.text,
                    fontSize: 36,
                    fontWeight: "900",
                    letterSpacing: 0,
                    lineHeight: 42,
                    textAlign: "center",
                  }}
                >
                  Anybox
                </Text>
                <Text
                  style={{
                    color: homeColors.textMuted,
                    fontSize: theme.typography.size.md,
                    lineHeight: 21,
                    maxWidth: 310,
                    textAlign: "center",
                  }}
                >
                  {t("connection.homeDetail")}
                </Text>
              </View>
            </View>

            <View style={{ gap: 12, marginTop: 48, width: "100%" }}>
              <DarkActionButton icon="camera" label={t("connection.scanDesktop")} onPress={onScan} />
              <DarkActionButton
                icon="cloud"
                label={t("connection.signInToDiscover")}
                loading={hasAccount && accountDesktopsLoading}
                onPress={hasAccount ? onRefreshDesktopList : onOpenAccount}
                variant="secondary"
              />
            </View>
          </View>

          {showDesktopResults ? (
            <AccountDesktopResults
              accountDesktops={accountDesktops}
              accountDesktopsLoading={accountDesktopsLoading}
              accountDesktopError={accountDesktopError}
              connectingDesktopID={connectingDesktopID}
              onConnectDesktop={onConnectDesktop}
            />
          ) : null}

          <Text style={{ color: homeColors.textSubtle, fontSize: theme.typography.size.xs, paddingTop: 20, textAlign: "center" }}>
            {appVersion}
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}

function AccountDesktopResults({
  accountDesktops,
  accountDesktopsLoading,
  accountDesktopError,
  connectingDesktopID,
  onConnectDesktop,
}: {
  accountDesktops: MobileAccountRelayDesktop[]
  accountDesktopsLoading: boolean
  accountDesktopError: string | null
  connectingDesktopID: string | null
  onConnectDesktop: (desktop: MobileAccountRelayDesktop) => Promise<void>
}) {
  const { locale, t } = useI18n()

  return (
    <View style={{ borderColor: homeColors.border, borderTopWidth: 1, gap: 12, paddingTop: 14 }}>
      {accountDesktopsLoading ? <DarkNotice title={t("connection.findingDesktops")} /> : null}
      {accountDesktopError ? <DarkNotice detail={accountDesktopError} title={t("connection.discoveryFailed")} tone="danger" /> : null}
      {accountDesktops.map((desktop) => (
        <DesktopRow
          connecting={connectingDesktopID === desktop.id}
          desktop={desktop}
          key={desktop.id}
          onPress={desktop.online && connectingDesktopID !== desktop.id ? () => void onConnectDesktop(desktop) : undefined}
          subtitle={desktop.online ? t("connection.availableRelay") : t("connection.lastSeen", { time: formatRelativeTime(desktop.lastSeenAt, locale) })}
        />
      ))}
    </View>
  )
}

function DesktopRow({
  connecting,
  desktop,
  onPress,
  subtitle,
}: {
  connecting: boolean
  desktop: MobileAccountRelayDesktop
  onPress?: () => void
  subtitle: string
}) {
  const { t } = useI18n()
  const meta = connecting ? t("connection.connecting") : desktop.online ? t("connection.online") : t("connection.offline")
  const metaColor = connecting ? homeColors.warningText : desktop.online ? homeColors.successText : homeColors.textSubtle

  return (
    <Pressable
      accessibilityLabel={desktop.name}
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: homeColors.panel,
        borderColor: homeColors.border,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        gap: 8,
        opacity: pressed ? theme.opacity.pressed : 1,
        padding: 14,
      })}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
        <Feather color={desktop.online ? homeColors.successText : homeColors.textSubtle} name="monitor" size={18} />
        <Text numberOfLines={1} style={{ color: homeColors.text, flex: 1, fontSize: theme.typography.size.lg, fontWeight: "800" }}>
          {desktop.appVersion ? `${desktop.name} ${desktop.appVersion}` : desktop.name}
        </Text>
        {connecting ? <ActivityIndicator color={metaColor} size="small" /> : null}
        <Text style={{ color: metaColor, fontSize: theme.typography.size.sm, fontWeight: "800" }}>
          {meta}
        </Text>
      </View>
      <Text numberOfLines={2} style={{ color: homeColors.textMuted, fontSize: theme.typography.size.sm, lineHeight: 18 }}>
        {subtitle}
      </Text>
    </Pressable>
  )
}

function HeaderIconButton({
  icon,
  label,
  loading,
  onPress,
}: {
  icon: FeatherName
  label: string
  loading?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: homeColors.panel,
        borderColor: homeColors.border,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        height: 40,
        justifyContent: "center",
        opacity: loading ? theme.opacity.disabled : pressed ? theme.opacity.pressed : 1,
        width: 40,
      })}
    >
      {loading ? <ActivityIndicator color={homeColors.textMuted} size="small" /> : <Feather color={homeColors.textMuted} name={icon} size={19} />}
    </Pressable>
  )
}

function DarkActionButton({
  disabled,
  icon,
  label,
  loading,
  onPress,
  variant = "primary",
}: {
  disabled?: boolean
  icon: FeatherName
  label: string
  loading?: boolean
  onPress: () => void
  variant?: "primary" | "secondary"
}) {
  const isDisabled = disabled || loading
  const isPrimary = variant === "primary"
  const foreground = isPrimary ? homeColors.primaryText : homeColors.text

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: isPrimary ? homeColors.primary : homeColors.panelStrong,
        borderColor: isPrimary ? "transparent" : homeColors.borderStrong,
        borderRadius: theme.radius.pill,
        borderWidth: isPrimary ? 0 : 1,
        flexDirection: "row",
        gap: 10,
        justifyContent: "center",
        minHeight: 58,
        opacity: isDisabled ? theme.opacity.disabled : pressed ? theme.opacity.pressedStrong : 1,
        paddingHorizontal: 18,
        paddingVertical: 15,
      })}
    >
      {loading ? <ActivityIndicator color={foreground} /> : <Feather color={foreground} name={icon} size={21} />}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{
          color: foreground,
          fontSize: theme.typography.size.lg,
          fontWeight: "900",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function DarkNotice({
  detail,
  title,
  tone = "neutral",
}: {
  detail?: string
  title: string
  tone?: "danger" | "neutral"
}) {
  const danger = tone === "danger"

  return (
    <View
      style={{
        backgroundColor: danger ? homeColors.dangerBackground : homeColors.panel,
        borderColor: danger ? homeColors.dangerBorder : homeColors.border,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        gap: 5,
        padding: 13,
      }}
    >
      <Text style={{ color: danger ? homeColors.dangerText : homeColors.text, fontSize: theme.typography.size.md, fontWeight: "900" }}>
        {title}
      </Text>
      {detail ? (
        <Text style={{ color: homeColors.textMuted, fontSize: theme.typography.size.sm, lineHeight: 18 }}>
          {detail}
        </Text>
      ) : null}
    </View>
  )
}
