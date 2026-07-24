import React, { useEffect } from "react"
import {
  BackHandler,
  Modal,
  ScrollView,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Button } from "@/components/button"
import { StateCard } from "@/components/state-card"
import { useI18n } from "@/i18n"
import { selectUpdatePromptPriority } from "@/services/update-policy"
import { useUpdateCoordinator } from "@/state/update-coordinator"
import { theme } from "@/theme"

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const amount = value / 1024 ** unit
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`
}

export function UpdateOverlay() {
  const { t } = useI18n()
  const update = useUpdateCoordinator()
  const priority = selectUpdatePromptPriority({
    forcedApk: update.binaryRequired && update.binaryPromptVisible,
    downloadedOta: update.otaPromptVisible && update.otaReady,
    optionalApk: update.binaryPromptVisible && Boolean(update.binaryRelease),
  })
  const forced = priority === "forced-apk"
  const ota = priority === "downloaded-ota"
  const optionalBinary = priority === "optional-apk"
  const visible = priority !== "none"
  const downloading = update.phase === "apk-downloading"
  const release = update.binaryRelease

  useEffect(() => {
    if (!forced) return
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true)
    return () => subscription.remove()
  }, [forced])

  const requestClose = () => {
    if (forced) return
    if (ota) {
      update.dismissOtaPrompt()
      return
    }
    void update.dismissOptionalUpdate()
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={requestClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={visible}
    >
      <SafeAreaView style={{ backgroundColor: theme.colors.canvas, flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: theme.spacing.screen,
          }}
        >
          <View
            style={{
              alignSelf: "center",
              gap: theme.spacing.screen,
              maxWidth: 560,
              width: "100%",
            }}
          >
            <View style={{ gap: theme.spacing.md }}>
              <Text
                accessibilityRole="header"
                style={{
                  color: theme.colors.text,
                  fontSize: 28,
                  fontWeight: theme.typography.weight.heavy,
                }}
              >
                {ota
                  ? t("updates.otaReadyTitle")
                  : forced
                    ? t("updates.requiredTitle")
                    : t("updates.availableTitle")}
              </Text>
              <Text
                style={{
                  color: theme.colors.textMuted,
                  fontSize: theme.typography.size.lg,
                  lineHeight: 24,
                }}
              >
                {ota
                  ? t("updates.otaReadyDetail")
                  : forced
                    ? t("updates.requiredDetail", {
                        version: release?.version ?? t("app.unknown"),
                      })
                    : t("updates.availableDetail", {
                        version: release?.version ?? t("app.unknown"),
                      })}
              </Text>
            </View>

            {forced ? (
              <StateCard
                detail={t("updates.forceNotice")}
                title={`${release?.version ?? ""} (${release?.versionCode ?? "?"})`}
                tone="danger"
              />
            ) : null}

            {release?.notes.length ? (
              <View
                style={{
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.sm,
                  borderWidth: 1,
                  gap: theme.spacing.md,
                  padding: theme.spacing.xxl,
                }}
              >
                <Text
                  style={{
                    color: theme.colors.text,
                    fontSize: theme.typography.size.lg,
                    fontWeight: theme.typography.weight.bold,
                  }}
                >
                  {t("updates.releaseNotes")}
                </Text>
                {release.notes.map((note, index) => (
                  <Text
                    key={`${index}-${note}`}
                    style={{
                      color: theme.colors.textMuted,
                      fontSize: theme.typography.size.sm,
                      lineHeight: theme.typography.lineHeight.md,
                    }}
                  >
                    • {note}
                  </Text>
                ))}
              </View>
            ) : null}

            {downloading && update.progress ? (
              <View style={{ gap: theme.spacing.md }}>
                <View
                  accessibilityLabel={t("updates.progress")}
                  accessibilityRole="progressbar"
                  accessibilityValue={{
                    max: 100,
                    min: 0,
                    now: Math.round(update.progress.percent),
                  }}
                  style={{
                    backgroundColor: theme.colors.surfaceSubtle,
                    borderRadius: theme.radius.pill,
                    height: 10,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      backgroundColor: theme.colors.actionPrimary,
                      height: "100%",
                      width: `${Math.max(0, Math.min(100, update.progress.percent))}%`,
                    }}
                  />
                </View>
                <Text
                  style={{
                    color: theme.colors.textMuted,
                    fontSize: theme.typography.size.sm,
                    textAlign: "center",
                  }}
                >
                  {t("updates.progressValue", {
                    downloaded: formatBytes(update.progress.downloadedBytes),
                    total: formatBytes(update.progress.totalBytes),
                    percent: Math.round(update.progress.percent),
                  })}
                </Text>
              </View>
            ) : null}

            {update.error ? (
              <StateCard detail={update.error} title={t("updates.errorTitle")} tone="danger" />
            ) : null}

            <View style={{ gap: theme.spacing.lg }}>
              {ota ? (
                <>
                  <Button label={t("updates.restartNow")} onPress={() => void update.reloadOta()} />
                  <Button
                    label={t("updates.later")}
                    onPress={update.dismissOtaPrompt}
                    variant="secondary"
                  />
                </>
              ) : (
                <>
                  {downloading ? (
                    <Button
                      label={t("updates.cancelDownload")}
                      onPress={() => void update.cancelBinaryDownload()}
                      variant="secondary"
                    />
                  ) : update.downloadedApkUri ? (
                    <Button
                      label={t("updates.continueInstall")}
                      onPress={() => void update.continueBinaryInstall()}
                    />
                  ) : (
                    <Button
                      label={t("updates.downloadInstall")}
                      onPress={() => void update.downloadAndInstallBinary()}
                    />
                  )}
                  <Button
                    disabled={downloading}
                    label={t("updates.browserFallback")}
                    onPress={() => void update.openBinaryFallback()}
                    variant="secondary"
                  />
                  {forced && update.error ? (
                    <Button
                      disabled={downloading}
                      label={t("updates.checkAgain")}
                      onPress={() => void update.checkNow({ manual: true })}
                      variant="secondary"
                    />
                  ) : null}
                  {!forced ? (
                    <Button
                      disabled={downloading}
                      label={t("updates.remindLater")}
                      onPress={() => void update.dismissOptionalUpdate()}
                      variant="secondary"
                    />
                  ) : null}
                </>
              )}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}
