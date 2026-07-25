import * as SecureStore from "expo-secure-store"
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { AppState, type AppStateStatus } from "react-native"
import { useI18n } from "@/i18n"
import {
  canInstallDownloadedApk,
  cancelBinaryDownload,
  checkAppUpdates,
  downloadBinaryRelease,
  downloadOtaUpdate,
  getCurrentAppInfo,
  installDownloadedApk,
  openApkInstallPermissionSettings,
  openBinaryReleaseInBrowser,
  readOtaDiagnosticErrors,
  reloadToDownloadedOtaUpdate,
  type AndroidReleaseManifest,
  type AppUpdateCheckResult,
  type DownloadProgress,
} from "@/services/app-updates"
import {
  shouldRetainConfirmedForcedUpdate,
  shouldShowOptionalUpdate,
  type OptionalUpdateDismissal,
} from "@/services/update-policy"

const FORCED_UPDATE_KEY = "anybox.mobile.update.forced.v1"
const OPTIONAL_DISMISS_KEY = "anybox.mobile.update.optional-dismiss.v1"
const LAST_CHECK_KEY = "anybox.mobile.update.last-check.v1"
const INITIAL_CHECK_DELAY_MS = 2_500
const FOREGROUND_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const OPTIONAL_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000

type CoordinatorPhase =
  | "hydrating"
  | "idle"
  | "checking"
  | "ota-downloading"
  | "apk-downloading"
  | "apk-installing"

interface ForcedUpdateRecord {
  schemaVersion: 1
  confirmedAt: number
  release: AndroidReleaseManifest
}

type OptionalDismissRecord = OptionalUpdateDismissal

export interface UpdateCoordinatorState {
  phase: CoordinatorPhase
  result: AppUpdateCheckResult | null
  lastCheckedAt: number | null
  binaryRelease: AndroidReleaseManifest | null
  binaryRequired: boolean
  binaryPromptVisible: boolean
  otaReady: boolean
  otaPromptVisible: boolean
  downloadedApkUri: string | null
  progress: DownloadProgress | null
  error: string | null
  otaDiagnosticErrors: string[]
}

interface UpdateCoordinatorValue extends UpdateCoordinatorState {
  checkNow: (options?: { manual?: boolean }) => Promise<AppUpdateCheckResult | null>
  dismissOptionalUpdate: () => Promise<void>
  dismissOtaPrompt: () => void
  downloadAndInstallBinary: () => Promise<void>
  cancelBinaryDownload: () => Promise<void>
  continueBinaryInstall: () => Promise<void>
  openBinaryFallback: () => Promise<void>
  reloadOta: () => Promise<void>
}

const UpdateCoordinatorContext = createContext<UpdateCoordinatorValue | null>(null)

function parseForcedRecord(value: string | null): ForcedUpdateRecord | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as ForcedUpdateRecord
    if (
      parsed.schemaVersion !== 1 ||
      !Number.isFinite(parsed.confirmedAt) ||
      !parsed.release ||
      !Number.isSafeInteger(parsed.release.versionCode)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function parseOptionalDismiss(value: string | null): OptionalDismissRecord | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as OptionalDismissRecord
    return Number.isSafeInteger(parsed.versionCode) && Number.isFinite(parsed.dismissedAt)
      ? parsed
      : null
  } catch {
    return null
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function UpdateCoordinatorProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  const developmentBuild = getCurrentAppInfo().buildProfile === "development"
  const [phase, setPhase] = useState<CoordinatorPhase>("hydrating")
  const [result, setResult] = useState<AppUpdateCheckResult | null>(null)
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null)
  const [binaryRelease, setBinaryRelease] = useState<AndroidReleaseManifest | null>(null)
  const [binaryRequired, setBinaryRequired] = useState(false)
  const [binaryPromptVisible, setBinaryPromptVisible] = useState(false)
  const [otaReady, setOtaReady] = useState(false)
  const [otaPromptVisible, setOtaPromptVisible] = useState(false)
  const [downloadedApkUri, setDownloadedApkUri] = useState<string | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [otaDiagnosticErrors, setOtaDiagnosticErrors] = useState<string[]>([])
  const optionalDismissRef = useRef<OptionalDismissRecord | null>(null)
  const forcedRecordRef = useRef<ForcedUpdateRecord | null>(null)
  const lastCheckedRef = useRef<number | null>(null)
  const checkingRef = useRef<Promise<AppUpdateCheckResult | null> | null>(null)
  const otaDeferredForSessionRef = useRef(false)
  const initialCheckStartedRef = useRef(false)
  const cancelRequestedRef = useRef(false)
  const mountedRef = useRef(true)

  const clearForcedRecord = useCallback(async () => {
    forcedRecordRef.current = null
    setBinaryRequired(false)
    await SecureStore.deleteItemAsync(FORCED_UPDATE_KEY).catch(() => undefined)
  }, [])

  const persistForcedRecord = useCallback(async (release: AndroidReleaseManifest) => {
    const record: ForcedUpdateRecord = {
      schemaVersion: 1,
      confirmedAt: Date.now(),
      release,
    }
    forcedRecordRef.current = record
    await SecureStore.setItemAsync(FORCED_UPDATE_KEY, JSON.stringify(record)).catch(
      () => undefined,
    )
  }, [])

  useEffect(() => {
    mountedRef.current = true
    if (developmentBuild) {
      forcedRecordRef.current = null
      optionalDismissRef.current = null
      setPhase("idle")
      return () => {
        mountedRef.current = false
      }
    }
    void Promise.all([
      SecureStore.getItemAsync(FORCED_UPDATE_KEY),
      SecureStore.getItemAsync(OPTIONAL_DISMISS_KEY),
      SecureStore.getItemAsync(LAST_CHECK_KEY),
    ])
      .then(([forcedValue, dismissValue, lastCheckValue]) => {
        if (!mountedRef.current) return
        const forced = parseForcedRecord(forcedValue)
        const currentCode = getCurrentAppInfo().versionCode
        if (
          forced &&
          (currentCode === null || currentCode < forced.release.versionCode)
        ) {
          forcedRecordRef.current = forced
          setBinaryRelease(forced.release)
          setBinaryRequired(true)
          setBinaryPromptVisible(true)
        } else if (forced) {
          void SecureStore.deleteItemAsync(FORCED_UPDATE_KEY)
        }
        optionalDismissRef.current = parseOptionalDismiss(dismissValue)
        const storedLastCheck = Number(lastCheckValue)
        if (Number.isFinite(storedLastCheck) && storedLastCheck > 0) {
          lastCheckedRef.current = storedLastCheck
          setLastCheckedAt(storedLastCheck)
        }
      })
      .finally(() => {
        if (mountedRef.current) setPhase("idle")
      })
    return () => {
      mountedRef.current = false
    }
  }, [developmentBuild])

  const shouldShowOptional = useCallback((release: AndroidReleaseManifest) => {
    return shouldShowOptionalUpdate(
      release.versionCode,
      optionalDismissRef.current,
      Date.now(),
      OPTIONAL_REMINDER_INTERVAL_MS,
    )
  }, [])

  const checkNow = useCallback(
    async (options: { manual?: boolean } = {}) => {
      if (checkingRef.current) return checkingRef.current
      if (
        !options.manual &&
        lastCheckedRef.current !== null &&
        Date.now() - lastCheckedRef.current < FOREGROUND_CHECK_INTERVAL_MS
      ) {
        return result
      }

      const task = (async () => {
        setPhase("checking")
        setError(null)
        const checked = await checkAppUpdates()
        if (!mountedRef.current) return checked
        setResult(checked)
        setLastCheckedAt(checked.checkedAt)
        lastCheckedRef.current = checked.checkedAt
        void SecureStore.setItemAsync(LAST_CHECK_KEY, String(checked.checkedAt)).catch(
          () => undefined,
        )

        if (checked.binary.required && checked.binary.release) {
          await persistForcedRecord(checked.binary.release)
          if (!mountedRef.current) return checked
          setBinaryRelease(checked.binary.release)
          setBinaryRequired(true)
          setBinaryPromptVisible(true)
          setOtaPromptVisible(false)
          return checked
        }

        if (forcedRecordRef.current) {
          const cachedRelease = forcedRecordRef.current.release
          const currentCode = checked.current.versionCode
          if (
            shouldRetainConfirmedForcedUpdate(
              currentCode,
              cachedRelease.versionCode,
              checked.binary.status,
              checked.binary.source,
            )
          ) {
            setBinaryRelease(cachedRelease)
            setBinaryRequired(true)
            setBinaryPromptVisible(true)
            setOtaPromptVisible(false)
            setError(t("updates.requiredOffline"))
            const loggedErrors = await readOtaDiagnosticErrors()
            setOtaDiagnosticErrors(
              [checked.binary.error, ...loggedErrors].filter(
                (entry): entry is string => Boolean(entry),
              ).slice(-20),
            )
            return checked
          }
        }

        if (forcedRecordRef.current) {
          await clearForcedRecord()
        }

        const optionalRelease =
          checked.binary.available && checked.binary.release
            ? checked.binary.release
            : null
        setBinaryRelease(optionalRelease)
        setBinaryRequired(false)
        setBinaryPromptVisible(false)

        if (checked.ota.available) {
          setPhase("ota-downloading")
          try {
            await downloadOtaUpdate()
            if (!mountedRef.current) return checked
            setOtaReady(true)
            if (!otaDeferredForSessionRef.current) setOtaPromptVisible(true)
            setBinaryPromptVisible(false)
          } catch (otaError) {
            if (!mountedRef.current) return checked
            setOtaDiagnosticErrors((current) => [
              ...current,
              errorMessage(otaError, "Unable to download the OTA update."),
            ].slice(-20))
            if (optionalRelease && shouldShowOptional(optionalRelease)) {
              setBinaryPromptVisible(true)
            }
          }
        } else if (optionalRelease && shouldShowOptional(optionalRelease)) {
          setBinaryPromptVisible(true)
        }
        const loggedErrors = await readOtaDiagnosticErrors()
        setOtaDiagnosticErrors((current) =>
          [...new Set([...current, ...loggedErrors])].slice(-20),
        )
        return checked
      })()
        .catch((checkError) => {
          if (mountedRef.current) {
            setError(t("updates.checkFailed"))
            setOtaDiagnosticErrors((current) => [
              ...current,
              errorMessage(checkError, "Unable to check updates."),
            ].slice(-20))
          }
          return null
        })
        .finally(() => {
          checkingRef.current = null
          if (mountedRef.current) setPhase("idle")
        })
      checkingRef.current = task
      return task
    },
    [clearForcedRecord, persistForcedRecord, result, shouldShowOptional, t],
  )

  useEffect(() => {
    if (
      developmentBuild ||
      phase === "hydrating" ||
      initialCheckStartedRef.current
    ) return
    initialCheckStartedRef.current = true
    const timeout = setTimeout(
      () => void checkNow({ manual: true }),
      INITIAL_CHECK_DELAY_MS,
    )
    return () => clearTimeout(timeout)
  }, [checkNow, developmentBuild, phase])

  useEffect(() => {
    if (developmentBuild) return
    let previousState: AppStateStatus = AppState.currentState
    const subscription = AppState.addEventListener("change", (nextState) => {
      const returnedToForeground =
        previousState !== "active" && nextState === "active"
      previousState = nextState
      if (
        returnedToForeground &&
        (lastCheckedRef.current === null ||
          Date.now() - lastCheckedRef.current >= FOREGROUND_CHECK_INTERVAL_MS)
      ) {
        void checkNow()
      }
    })
    return () => subscription.remove()
  }, [checkNow, developmentBuild])

  const dismissOptionalUpdate = useCallback(async () => {
    if (!binaryRelease || binaryRequired) return
    const record = {
      versionCode: binaryRelease.versionCode,
      dismissedAt: Date.now(),
    }
    optionalDismissRef.current = record
    setBinaryPromptVisible(false)
    await SecureStore.setItemAsync(OPTIONAL_DISMISS_KEY, JSON.stringify(record)).catch(
      () => undefined,
    )
  }, [binaryRelease, binaryRequired])

  const dismissOtaPrompt = useCallback(() => {
    otaDeferredForSessionRef.current = true
    setOtaPromptVisible(false)
  }, [])

  const continueBinaryInstall = useCallback(async () => {
    if (!downloadedApkUri) return
    setPhase("apk-installing")
    setError(null)
    try {
      if (!(await canInstallDownloadedApk())) {
        await openApkInstallPermissionSettings()
        return
      }
      await installDownloadedApk(downloadedApkUri)
    } catch (installError) {
      setError(t("updates.installFailed"))
      setOtaDiagnosticErrors((current) => [
        ...current,
        errorMessage(installError, "Unable to open the Android installer."),
      ].slice(-20))
    } finally {
      if (mountedRef.current) setPhase("idle")
    }
  }, [downloadedApkUri, t])

  const downloadAndInstallBinary = useCallback(async () => {
    if (!binaryRelease) return
    cancelRequestedRef.current = false
    setPhase("apk-downloading")
    setProgress({ downloadedBytes: 0, totalBytes: binaryRelease.sizeBytes, percent: 0 })
    setError(null)
    try {
      const downloaded = await downloadBinaryRelease(binaryRelease, setProgress)
      if (!mountedRef.current) return
      setDownloadedApkUri(downloaded.fileUri)
      setProgress({
        downloadedBytes: downloaded.sizeBytes,
        totalBytes: downloaded.sizeBytes,
        percent: 100,
      })
      setPhase("idle")
      if (!(await canInstallDownloadedApk())) {
        await openApkInstallPermissionSettings()
        return
      }
      await installDownloadedApk(downloaded.fileUri)
    } catch (downloadError) {
      if (mountedRef.current && !cancelRequestedRef.current) {
        setError(t("updates.downloadFailed"))
        setOtaDiagnosticErrors((current) => [
          ...current,
          errorMessage(downloadError, "Unable to download the Android update."),
        ].slice(-20))
      }
    } finally {
      cancelRequestedRef.current = false
      if (mountedRef.current) setPhase("idle")
    }
  }, [binaryRelease, t])

  const cancelCurrentBinaryDownload = useCallback(async () => {
    cancelRequestedRef.current = true
    try {
      await cancelBinaryDownload()
    } finally {
      if (mountedRef.current) {
        setPhase("idle")
        setProgress(null)
      }
    }
  }, [])

  const openBinaryFallback = useCallback(async () => {
    if (!binaryRelease) return
    try {
      await openBinaryReleaseInBrowser(binaryRelease)
    } catch (openError) {
      setError(t("updates.browserFailed"))
      setOtaDiagnosticErrors((current) => [
        ...current,
        errorMessage(openError, "Unable to open the fallback download."),
      ].slice(-20))
    }
  }, [binaryRelease, t])

  const reloadOta = useCallback(async () => {
    setError(null)
    try {
      await reloadToDownloadedOtaUpdate()
    } catch (reloadError) {
      setError(t("updates.restartFailed"))
      setOtaDiagnosticErrors((current) => [
        ...current,
        errorMessage(reloadError, "Unable to restart into the downloaded update."),
      ].slice(-20))
    }
  }, [t])

  const value = useMemo<UpdateCoordinatorValue>(
    () => ({
      phase,
      result,
      lastCheckedAt,
      binaryRelease,
      binaryRequired,
      binaryPromptVisible,
      otaReady,
      otaPromptVisible,
      downloadedApkUri,
      progress,
      error,
      otaDiagnosticErrors,
      checkNow,
      dismissOptionalUpdate,
      dismissOtaPrompt,
      downloadAndInstallBinary,
      cancelBinaryDownload: cancelCurrentBinaryDownload,
      continueBinaryInstall,
      openBinaryFallback,
      reloadOta,
    }),
    [
      binaryPromptVisible,
      binaryRelease,
      binaryRequired,
      cancelCurrentBinaryDownload,
      checkNow,
      continueBinaryInstall,
      dismissOptionalUpdate,
      dismissOtaPrompt,
      downloadAndInstallBinary,
      downloadedApkUri,
      error,
      lastCheckedAt,
      openBinaryFallback,
      otaDiagnosticErrors,
      otaPromptVisible,
      otaReady,
      phase,
      progress,
      reloadOta,
      result,
    ],
  )

  return (
    <UpdateCoordinatorContext.Provider value={value}>
      {children}
    </UpdateCoordinatorContext.Provider>
  )
}

export function useUpdateCoordinator() {
  const value = useContext(UpdateCoordinatorContext)
  if (!value) {
    throw new Error("useUpdateCoordinator must be used inside UpdateCoordinatorProvider.")
  }
  return value
}
