import React from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { Button } from "@/components/button"
import { Field } from "@/components/field"
import { ListRow } from "@/components/list-row"
import { Section } from "@/components/section"
import { StateCard } from "@/components/state-card"
import type { MobileAccountRelayDesktop } from "@/api/account-api"
import { useI18n } from "@/i18n"
import { formatRelativeTime } from "@/utils/format"
import { DarkProviderRow } from "./shared"
import type { ProviderStatusTone } from "./types"

export function ConnectionHomePage({
  accountDesktops,
  accountDesktopsLoading,
  accountDesktopError,
  appVersion,
  connectingDesktopID,
  endpoint,
  error,
  manualOpen,
  maxWidth,
  onConnectDesktop,
  onEndpointChange,
  onManualToggle,
  onOpenDiagnostics,
  onOpenProvider,
  onOpenSettings,
  onOpenUpdates,
  onRefreshDesktopList,
  onReviewConnection,
  onScan,
  onTokenChange,
  paddingBottom,
  paddingTop,
  providerDetail,
  providerLabel,
  providerTone,
  token,
}: {
  accountDesktops: MobileAccountRelayDesktop[]
  accountDesktopsLoading: boolean
  accountDesktopError: string | null
  appVersion: string
  connectingDesktopID: string | null
  endpoint: string
  error: string | null
  manualOpen: boolean
  maxWidth?: number
  onConnectDesktop: (desktop: MobileAccountRelayDesktop) => Promise<void>
  onEndpointChange: (value: string) => void
  onManualToggle: () => void
  onOpenDiagnostics: () => void
  onOpenProvider: () => void
  onOpenSettings: () => void
  onOpenUpdates: () => void
  onRefreshDesktopList: () => void
  onReviewConnection: () => void
  onScan: () => void
  onTokenChange: (value: string) => void
  paddingBottom: number
  paddingTop: number
  providerDetail: string
  providerLabel: string
  providerTone: ProviderStatusTone
  token: string
}) {
  return (
    <View style={{ flex: 1, backgroundColor: "#171717" }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={{
          alignItems: "center",
          gap: 14,
          paddingBottom,
          paddingHorizontal: 16,
          paddingTop,
        }}
      >
        <View style={{ maxWidth, width: "100%", gap: 14 }}>
          <DarkProviderRow
            detail={providerDetail}
            label={providerLabel}
            tone={providerTone}
            onPress={onOpenProvider}
          />
          <MobileUtilityRow
            appVersion={appVersion}
            onOpenDiagnostics={onOpenDiagnostics}
            onOpenProvider={onOpenProvider}
            onOpenSettings={onOpenSettings}
            onOpenUpdates={onOpenUpdates}
          />
          <ConnectionSetupSection
            accountDesktops={accountDesktops}
            accountDesktopsLoading={accountDesktopsLoading}
            accountDesktopError={accountDesktopError}
            connectingDesktopID={connectingDesktopID}
            endpoint={endpoint}
            error={error}
            manualOpen={manualOpen}
            onConnectDesktop={onConnectDesktop}
            onEndpointChange={onEndpointChange}
            onManualToggle={onManualToggle}
            onRefreshDesktopList={onRefreshDesktopList}
            onReviewConnection={onReviewConnection}
            onScan={onScan}
            onTokenChange={onTokenChange}
            token={token}
          />
        </View>
      </ScrollView>
    </View>
  )
}

export function MobileUtilityRow({
  appVersion,
  onOpenDiagnostics,
  onOpenProvider,
  onOpenSettings,
  onOpenUpdates,
}: {
  appVersion: string
  onOpenDiagnostics: () => void
  onOpenProvider: () => void
  onOpenSettings: () => void
  onOpenUpdates: () => void
}) {
  const { t } = useI18n()

  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <UtilityTile label={t("home.utility.provider")} onPress={onOpenProvider} value={t("home.utility.details")} />
      <UtilityTile label={t("home.utility.updates")} onPress={onOpenUpdates} value={appVersion} />
      <UtilityTile label={t("home.utility.settings")} onPress={onOpenSettings} value={t("home.utility.manage")} />
      <UtilityTile label={t("home.utility.diagnostics")} onPress={onOpenDiagnostics} value={t("home.utility.health")} />
    </View>
  )
}

function UtilityTile({
  label,
  onPress,
  value,
}: {
  label: string
  onPress: () => void
  value: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: "#ffffff",
        borderColor: "#e5e3dc",
        borderRadius: 14,
        borderWidth: 1,
        flex: 1,
        gap: 6,
        minHeight: 70,
        opacity: pressed ? 0.78 : 1,
        padding: 12,
      })}
    >
      <Text style={{ color: "#151515", fontSize: 15, fontWeight: "800", letterSpacing: 0 }}>{label}</Text>
      <Text selectable numberOfLines={1} style={{ color: "#676760", fontSize: 12, fontVariant: ["tabular-nums"], letterSpacing: 0 }}>
        {value}
      </Text>
    </Pressable>
  )
}

export function ProviderStatusCard({
  detail,
  label,
  tone,
  onPress,
}: {
  detail: string
  label: string
  tone: ProviderStatusTone
  onPress: () => void
}) {
  const color = tone === "success" ? "#155c34" : tone === "danger" ? "#8f1f1f" : "#4d4d49"

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: "#ffffff",
        borderColor: "#e5e3dc",
        borderRadius: 14,
        borderWidth: 1,
        gap: 6,
        opacity: pressed ? 0.78 : 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
      })}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
        <View
          style={{
            backgroundColor: color,
            borderRadius: 4,
            height: 8,
            width: 8,
          }}
        />
        <Text style={{ color: "#151515", flex: 1, fontSize: 16, fontWeight: "800", letterSpacing: 0 }}>AnyboxProvider</Text>
        <Text selectable style={{ color, fontSize: 13, fontWeight: "700", letterSpacing: 0 }}>
          {label}
        </Text>
      </View>
      <Text selectable numberOfLines={1} style={{ color: "#676760", fontSize: 13, letterSpacing: 0, lineHeight: 18 }}>
        {detail}
      </Text>
    </Pressable>
  )
}

export function ConnectionSetupSection({
  accountDesktops,
  accountDesktopsLoading,
  accountDesktopError,
  connectingDesktopID,
  endpoint,
  error,
  manualOpen,
  onConnectDesktop,
  onEndpointChange,
  onManualToggle,
  onRefreshDesktopList,
  onReviewConnection,
  onScan,
  onTokenChange,
  token,
}: {
  accountDesktops: MobileAccountRelayDesktop[]
  accountDesktopsLoading: boolean
  accountDesktopError: string | null
  connectingDesktopID: string | null
  endpoint: string
  error: string | null
  manualOpen: boolean
  onConnectDesktop: (desktop: MobileAccountRelayDesktop) => Promise<void>
  onEndpointChange: (value: string) => void
  onManualToggle: () => void
  onRefreshDesktopList: () => void
  onReviewConnection: () => void
  onScan: () => void
  onTokenChange: (value: string) => void
  token: string
}) {
  const { locale, t } = useI18n()

  return (
    <Section title={t("connection.availableDesktops")} caption={accountDesktopsLoading ? t("app.searching") : `${accountDesktops.length}`}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label={t("connection.scanQr")} onPress={onScan} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={t("app.refresh")} loading={accountDesktopsLoading} onPress={onRefreshDesktopList} variant="secondary" />
        </View>
      </View>
      {accountDesktopsLoading ? <StateCard title={t("connection.findingDesktops")} /> : null}
      {accountDesktopError ? <StateCard title={t("connection.discoveryFailed")} detail={accountDesktopError} tone="danger" /> : null}
      {!accountDesktopsLoading && !accountDesktopError && !accountDesktops.length ? (
        <StateCard title={t("connection.noDesktops")} detail={t("connection.noDesktopsDetail")} />
      ) : null}
      {accountDesktops.map((desktop) => (
        <ListRow
          key={desktop.id}
          title={desktop.appVersion ? `${desktop.name} ${desktop.appVersion}` : desktop.name}
          subtitle={desktop.online ? t("connection.availableRelay") : t("connection.lastSeen", { time: formatRelativeTime(desktop.lastSeenAt, locale) })}
          meta={connectingDesktopID === desktop.id ? t("connection.connecting") : desktop.online ? t("connection.online") : t("connection.offline")}
          onPress={desktop.online && connectingDesktopID !== desktop.id ? () => void onConnectDesktop(desktop) : undefined}
        />
      ))}
      <Button label={manualOpen ? t("connection.hideBridgeUrl") : t("connection.useBridgeUrl")} onPress={onManualToggle} variant="secondary" />
      {manualOpen ? (
        <>
          <Field label={t("connection.bridgeUrl")} onChangeText={onEndpointChange} placeholder="https://anybox.com.cn/?code=..." value={endpoint} />
          <Field label={t("connection.token")} onChangeText={onTokenChange} placeholder={t("connection.optionalToken")} secureTextEntry value={token} />
          <Button disabled={!endpoint.trim()} label={t("connection.review")} onPress={onReviewConnection} />
        </>
      ) : null}
      {error ? <StateCard title={t("connection.failed")} detail={error} tone="danger" /> : null}
    </Section>
  )
}
