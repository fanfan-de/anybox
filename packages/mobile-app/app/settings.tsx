import Feather from "@expo/vector-icons/Feather"
import { Stack, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Alert, Image, Pressable, ScrollView, Share, Text, useWindowDimensions, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { getStatus, type MobileStatus } from "@/api/mobile-api"
import { MOBILE_LOCALES, localeNames, useI18n, type MobileLocale } from "@/i18n"
import { formatAppVersionLabel, getCurrentAppInfo } from "@/services/app-updates"
import { useAccount } from "@/state/account"
import { useConnection } from "@/state/connection"
import { useFocus } from "@/state/focus"

type FeatherName = React.ComponentProps<typeof Feather>["name"]

export default function SettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { account, clearAccount, loading: accountLoading } = useAccount()
  const { connection, loading: connectionLoading } = useConnection()
  const { locale, localeLabel, setLocale, t } = useI18n()
  const focus = useFocus()
  const [status, setStatus] = useState<MobileStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const appInfo = useMemo(() => getCurrentAppInfo(), [])
  const appVersion = formatAppVersionLabel(appInfo)
  const maxWidth = width >= 760 ? 430 : undefined

  const loadConnectionOverview = useCallback(async () => {
    if (!connection) {
      setStatus(null)
      setStatusLoading(false)
      return
    }
    setStatusLoading(true)
    try {
      const nextStatus = await getStatus(connection)
      setStatus(nextStatus)
    } catch {
      setStatus(null)
    } finally {
      setStatusLoading(false)
    }
  }, [connection])

  useEffect(() => {
    void loadConnectionOverview()
  }, [loadConnectionOverview])

  const displayName = accountLoading
    ? t("settings.loadingAccount")
    : account?.user.displayName?.trim() || account?.user.name?.trim() || account?.user.username?.trim() || account?.user.email?.split("@")[0] || t("settings.signIn")
  const avatarLabel = (displayName.trim()[0] || account?.user.email?.trim()[0] || "A").toLocaleUpperCase()
  const avatarUrl = account?.user.avatarUrl?.trim()
  const connectionState = connectionLoading
    ? t("settings.connection.loading")
    : status?.online
      ? t("settings.connection.connected")
      : connection
        ? statusLoading
          ? t("settings.connection.checking")
          : t("settings.connection.needsAttention")
        : t("settings.connection.offline")
  const connectionTone = status?.online ? "#74d58b" : connection ? "#f5c86b" : "#8a8a8a"
  const hasSavedFocus = Boolean(focus.workspaceID || focus.sessionID)

  function confirmClearFocus() {
    if (!focus.workspaceID && !focus.sessionID) return
    Alert.alert(t("settings.clearFocusTitle"), t("settings.clearFocusMessage"), [
      { text: t("app.cancel"), style: "cancel" },
      {
        text: t("app.clear"),
        style: "destructive",
        onPress: () => {
          void focus.clearFocus()
        },
      },
    ])
  }

  function showLanguagePicker() {
    Alert.alert(t("settings.languageTitle"), t("settings.languageMessage"), [
      ...MOBILE_LOCALES.map((item) => ({
        text: localeNames[item],
        style: item === locale ? "default" as const : "default" as const,
        onPress: () => {
          void setLocale(item as MobileLocale)
        },
      })),
      { text: t("app.cancel"), style: "cancel" as const },
    ])
  }

  function showAppearanceInfo() {
    Alert.alert(t("settings.appearanceTitle"), t("settings.appearanceMessage"))
  }

  function confirmSignOut() {
    if (!account || signingOut) return
    Alert.alert(t("settings.signOutTitle"), t("settings.signOutMessage"), [
      { text: t("app.cancel"), style: "cancel" },
      {
        text: t("settings.signOut"),
        style: "destructive",
        onPress: () => {
          void runSignOut()
        },
      },
    ])
  }

  async function runSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await clearAccount()
      router.replace("/account" as never)
    } catch (signOutError) {
      Alert.alert(t("settings.signOutFailedTitle"), signOutError instanceof Error ? signOutError.message : t("settings.signOutFailedMessage"))
    } finally {
      setSigningOut(false)
    }
  }

  async function shareAnybox() {
    try {
      await Share.share({
        message: `Anybox${account?.baseUrl ? ` ${account.baseUrl}` : ""}`,
      })
    } catch (shareError) {
      Alert.alert(t("settings.shareFailedTitle"), shareError instanceof Error ? shareError.message : t("settings.shareFailedMessage"))
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={{ backgroundColor: "#191919", flex: 1 }}
        contentContainerStyle={{
          alignItems: "center",
          paddingBottom: Math.max(insets.bottom, 18) + 14,
          paddingHorizontal: 20,
          paddingTop: insets.top + 10,
        }}
      >
        <View style={{ gap: 18, width: "100%", maxWidth }}>
          <View style={{ alignItems: "center", flexDirection: "row", minHeight: 38 }}>
            <HeaderIconButton icon="chevron-left" label={t("app.back")} onPress={() => router.back()} />
            <Text numberOfLines={1} style={{ color: "#f2f2f2", flex: 1, fontSize: 24, fontWeight: "900", textAlign: "center" }}>
              Anybox
            </Text>
            <View style={{ width: 38 }} />
          </View>

          <Pressable
            accessibilityLabel="Account"
            accessibilityRole="button"
            onPress={() => router.push("/account" as never)}
            style={({ pressed }) => ({
              alignItems: "center",
              gap: 8,
              opacity: pressed ? 0.72 : 1,
            })}
          >
            <View style={{ alignItems: "center", backgroundColor: "#7e55d6", borderRadius: 39, height: 78, justifyContent: "center", width: 78 }}>
              {avatarUrl ? (
                <Image
                  accessibilityIgnoresInvertColors
                  source={{ uri: avatarUrl }}
                  style={{ borderRadius: 39, height: 78, width: 78 }}
                />
              ) : (
                <Text style={{ color: "#ffffff", fontSize: 36, fontWeight: "800" }}>{avatarLabel}</Text>
              )}
            </View>
            <View style={{ alignItems: "center", flexDirection: "row", gap: 4, maxWidth: "100%" }}>
              <Text numberOfLines={1} style={{ color: "#eeeeee", fontSize: 22, fontWeight: "800", maxWidth: "88%", textAlign: "center" }}>
                {displayName}
              </Text>
              <Feather color="#7f7f7f" name="chevron-right" size={20} />
            </View>
          </Pressable>

          <SettingsCard>
            <SettingsCardTitle title="Anybox" />
            <SettingsRow
              icon="activity"
              title={t("settings.desktopConnection")}
              value={connectionState}
              valueColor={connectionTone}
              onPress={() => router.push("/provider" as never)}
            />
          </SettingsCard>

          <SettingsCard>
            <SettingsCardTitle title={t("settings.preferences")} />
            <SettingsRow icon="globe" title={t("settings.language")} value={localeLabel} onPress={showLanguagePicker} />
            <SettingsRow icon="moon" title={t("settings.appearance")} value={t("settings.followSystem")} onPress={showAppearanceInfo} />
          </SettingsCard>

          <SettingsCard>
            <SettingsCardTitle title={t("settings.app")} />
            <SettingsRow icon="package" title={t("settings.version")} value={appVersion} onPress={() => router.push("/updates" as never)} />
          </SettingsCard>

          <SettingsCard>
            <SettingsCardTitle title={t("settings.actions")} />
            <SettingsRow icon="share-2" title={t("settings.shareAnybox")} onPress={() => void shareAnybox()} />
            {hasSavedFocus ? <SettingsRow icon="database" title={t("settings.savedFocus")} value={t("settings.clearSavedFocus")} onPress={confirmClearFocus} /> : null}
          </SettingsCard>

          {account ? <SignOutButton label={t("settings.signOut")} loading={signingOut} loadingLabel={t("settings.signingOut")} onPress={confirmSignOut} /> : null}
        </View>
      </ScrollView>
    </>
  )
}

function HeaderIconButton({ icon, label, onPress }: { icon: FeatherName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        height: 38,
        justifyContent: "center",
        opacity: pressed ? 0.62 : 1,
        width: 38,
      })}
    >
      <Feather color="#f2f2f2" name={icon} size={24} />
    </Pressable>
  )
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: "#292929",
        borderColor: "#333333",
        borderRadius: 8,
        borderWidth: 1,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  )
}

function SettingsCardTitle({ title }: { title: string }) {
  return (
    <View style={{ justifyContent: "center", minHeight: 40, paddingBottom: 6, paddingHorizontal: 20, paddingTop: 12 }}>
      <Text numberOfLines={1} style={{ color: "#9d9d9d", fontSize: 13, fontWeight: "800" }}>
        {title}
      </Text>
    </View>
  )
}

function SettingsRow({
  disabled,
  icon,
  title,
  value,
  valueColor = "#8f8f8f",
  onPress,
}: {
  disabled?: boolean
  icon: FeatherName
  title: string
  value?: string
  valueColor?: string
  onPress?: () => void
}) {
  const interactive = Boolean(onPress) && !disabled
  return (
    <Pressable
      accessibilityLabel={interactive ? title : undefined}
      accessibilityRole={interactive ? "button" : undefined}
      disabled={!interactive}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
        minHeight: 60,
        opacity: disabled ? 0.48 : pressed ? 0.72 : 1,
        paddingHorizontal: 20,
      })}
    >
      <Feather color="#e4e4e4" name={icon} size={22} />
      <View
        style={{
          alignItems: "center",
          borderBottomColor: "#383838",
          borderBottomWidth: 1,
          flex: 1,
          flexDirection: "row",
          gap: 10,
          minHeight: 60,
        }}
      >
        <Text numberOfLines={1} style={{ color: "#eeeeee", flex: 1, fontSize: 18, fontWeight: "700" }}>
          {title}
        </Text>
        {value ? (
          <Text numberOfLines={1} style={{ color: valueColor, flexShrink: 1, fontSize: 16, fontVariant: ["tabular-nums"], fontWeight: "700", maxWidth: "50%" }}>
            {value}
          </Text>
        ) : null}
        {interactive ? <Feather color="#7f7f7f" name="chevron-right" size={22} /> : null}
      </View>
    </Pressable>
  )
}

function SignOutButton({
  label,
  loading,
  loadingLabel,
  onPress,
}: {
  label: string
  loading: boolean
  loadingLabel: string
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
        backgroundColor: "#292929",
        borderColor: "#333333",
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 12,
        minHeight: 60,
        opacity: loading ? 0.52 : pressed ? 0.72 : 1,
        paddingHorizontal: 20,
      })}
    >
      <Feather color="#eeeeee" name="log-out" size={22} />
      <Text numberOfLines={1} style={{ color: "#eeeeee", flex: 1, fontSize: 18, fontWeight: "700" }}>
        {loading ? loadingLabel : label}
      </Text>
    </Pressable>
  )
}
