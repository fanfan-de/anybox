import React, { useMemo } from "react"
import { Text, View } from "react-native"
import { Button } from "@/components/button"
import { ListRow } from "@/components/list-row"
import { Screen } from "@/components/screen"
import { Section } from "@/components/section"
import { StateCard } from "@/components/state-card"
import { useI18n } from "@/i18n"
import { formatAppVersionLabel, getCurrentAppInfo } from "@/services/app-updates"
import { useUpdateCoordinator } from "@/state/update-coordinator"
import { theme } from "@/theme"

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const amount = value / 1024 ** unit
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`
}

export default function UpdatesScreen() {
  const { locale, t } = useI18n()
  const update = useUpdateCoordinator()
  const current = useMemo(
    () => update.result?.current ?? getCurrentAppInfo(),
    [update.result?.current],
  )
  const release = update.binaryRelease ?? update.result?.binary.release ?? null
  const checking = update.phase === "checking"
  const downloading = update.phase === "apk-downloading"
  const lastChecked = update.lastCheckedAt
    ? t("updates.lastChecked", {
        time: new Date(update.lastCheckedAt).toLocaleString(locale),
      })
    : t("updates.neverChecked")

  const status = (() => {
    if (update.binaryRequired && release) {
      return {
        title: t("updates.requiredTitle"),
        detail: t("updates.requiredDetail", { version: release.version }),
        tone: "danger" as const,
      }
    }
    if (update.otaReady) {
      return {
        title: t("updates.otaReadyTitle"),
        detail: t("updates.otaReadyDetail"),
        tone: "success" as const,
      }
    }
    if (release) {
      return {
        title: t("updates.availableTitle"),
        detail: t("updates.availableDetail", { version: release.version }),
        tone: "success" as const,
      }
    }
    if (update.phase === "ota-downloading") {
      return {
        title: t("updates.otaDownloading"),
        detail: t("updates.otaAvailable"),
        tone: "success" as const,
      }
    }
    return {
      title: checking ? t("updates.checking") : t("updates.current"),
      detail: lastChecked,
      tone: "neutral" as const,
    }
  })()

  return (
    <Screen>
      <Section title={t("updates.installed")} caption={formatAppVersionLabel(current)}>
        <ListRow
          meta={current.buildVersion ?? t("app.unknown")}
          subtitle={current.packageName ?? current.platform}
          title={t("updates.nativeBuild")}
        />
        <ListRow
          meta={current.updatesEnabled ? t("updates.enabled") : t("updates.disabled")}
          subtitle={current.runtimeVersion ?? t("updates.unavailable")}
          title={t("updates.otaRuntime")}
        />
        <ListRow
          meta={current.channel ?? t("updates.unavailable")}
          subtitle={current.updateId ?? t("updates.embedded")}
          title={t("updates.channel")}
        />
      </Section>

      <Section title={t("updates.status")}>
        <StateCard detail={status.detail} title={status.title} tone={status.tone} />
        {update.result?.ota.error ? (
          <StateCard
            detail={update.result.ota.error}
            title={t("updates.errorTitle")}
            tone="danger"
          />
        ) : null}
        {update.result?.binary.error ? (
          <StateCard
            detail={update.result.binary.error}
            title={t("updates.errorTitle")}
            tone="danger"
          />
        ) : null}
        {update.error ? (
          <StateCard detail={update.error} title={t("updates.errorTitle")} tone="danger" />
        ) : null}
      </Section>

      {downloading && update.progress ? (
        <Section title={t("updates.progress")}>
          <View style={{ gap: theme.spacing.md }}>
            <View
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
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.size.sm }}>
              {t("updates.progressValue", {
                downloaded: formatBytes(update.progress.downloadedBytes),
                total: formatBytes(update.progress.totalBytes),
                percent: Math.round(update.progress.percent),
              })}
            </Text>
          </View>
        </Section>
      ) : null}

      {release?.notes.length ? (
        <Section title={t("updates.releaseNotes")}>
          {release.notes.map((note, index) => (
            <Text
              key={`${index}-${note}`}
              selectable
              style={{
                color: theme.colors.textSubtle,
                fontSize: theme.typography.size.sm,
                lineHeight: theme.typography.lineHeight.md,
              }}
            >
              • {note}
            </Text>
          ))}
          <ListRow
            meta={String(release.versionCode)}
            subtitle={release.version}
            title={t("updates.versionCode")}
          />
          <ListRow
            meta={formatBytes(release.sizeBytes)}
            subtitle={new Date(release.publishedAt).toLocaleString(locale)}
            title={t("updates.publishedAt")}
          />
        </Section>
      ) : null}

      <Section title={t("updates.actions")}>
        <Button
          label={t("updates.checkAgain")}
          loading={checking}
          onPress={() => void update.checkNow({ manual: true })}
          variant="secondary"
        />
        {update.otaReady ? (
          <Button label={t("updates.restartNow")} onPress={() => void update.reloadOta()} />
        ) : null}
        {release && !downloading && !update.downloadedApkUri ? (
          <Button
            label={t("updates.downloadInstall")}
            onPress={() => void update.downloadAndInstallBinary()}
            variant={update.binaryRequired ? "danger" : "primary"}
          />
        ) : null}
        {release && downloading ? (
          <Button
            label={t("updates.cancelDownload")}
            onPress={() => void update.cancelBinaryDownload()}
            variant="secondary"
          />
        ) : null}
        {release && update.downloadedApkUri && !downloading ? (
          <Button
            label={t("updates.continueInstall")}
            onPress={() => void update.continueBinaryInstall()}
          />
        ) : null}
        {release ? (
          <Button
            disabled={downloading}
            label={t("updates.browserFallback")}
            onPress={() => void update.openBinaryFallback()}
            variant="secondary"
          />
        ) : null}
      </Section>

      <Section title={t("updates.sources")}>
        <ListRow
          meta={
            update.result?.binary.configured
              ? t("updates.configured")
              : t("updates.notConfigured")
          }
          subtitle={current.releaseManifestUrl ?? t("updates.unavailable")}
          title={t("updates.appRelease")}
        />
        <ListRow
          meta={current.updatesEnabled ? t("updates.ready") : t("updates.unavailable")}
          subtitle={current.updatesUrl ?? t("updates.unavailable")}
          title={t("updates.selfHostedOta")}
        />
        <ListRow
          meta={
            update.result?.binary.signatureVerified
              ? t("updates.signatureVerified")
              : t("updates.signatureNotVerified")
          }
          subtitle={update.result?.binary.source ?? "none"}
          title={t("updates.signature")}
        />
        <ListRow
          meta={current.updateId ? t("updates.ready") : t("updates.embedded")}
          subtitle={current.updateId ?? t("updates.unavailable")}
          title={t("updates.updateId")}
        />
      </Section>

      <Section title={t("updates.diagnostics")}>
        {update.otaDiagnosticErrors.length ? (
          update.otaDiagnosticErrors.map((entry, index) => (
            <StateCard
              detail={entry}
              key={`${index}-${entry}`}
              title={t("updates.errorTitle")}
              tone="danger"
            />
          ))
        ) : (
          <StateCard detail={t("updates.noDiagnostics")} title={lastChecked} />
        )}
      </Section>

      <View style={{ height: 1 }} />
    </Screen>
  )
}
