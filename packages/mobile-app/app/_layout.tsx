import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import React from "react"
import { AccountProvider } from "@/state/account"
import { ConnectionProvider } from "@/state/connection"
import { FocusProvider } from "@/state/focus"
import { UpdateGate } from "@/components/update-gate"
import { MobileI18nProvider, useI18n } from "@/i18n"
import { theme } from "@/theme"

export default function RootLayout() {
  return (
    <MobileI18nProvider>
      <AccountProvider>
        <ConnectionProvider>
          <FocusProvider>
            <AppStack />
          </FocusProvider>
        </ConnectionProvider>
      </AccountProvider>
    </MobileI18nProvider>
  )
}

function AppStack() {
  const { t } = useI18n()

  return (
    <>
      <UpdateGate />
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: theme.colors.canvas },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ title: "Anybox" }} />
        <Stack.Screen name="account" options={{ headerBackTitle: t("nav.settings"), title: t("nav.account") }} />
        <Stack.Screen name="provider" options={{ title: t("nav.provider") }} />
        <Stack.Screen name="scan" options={{ title: t("nav.scan") }} />
        <Stack.Screen name="connect" options={{ title: t("nav.connect") }} />
        <Stack.Screen name="settings" options={{ title: t("nav.settings") }} />
        <Stack.Screen name="updates" options={{ title: t("nav.updates") }} />
        <Stack.Screen name="diagnostics" options={{ title: t("nav.diagnostics") }} />
        <Stack.Screen name="approvals" options={{ title: t("nav.approvals") }} />
      </Stack>
    </>
  )
}
