import { requireOptionalNativeModule } from "expo"

interface EventSubscription {
  remove(): void
}

export interface DownloadApkOptions {
  url: string
  expectedSha256: string
  expectedSizeBytes: number
  expectedPackageName: string
  expectedVersionCode: number
  fileName?: string
}

export interface DownloadedApk {
  fileUri: string
  sizeBytes: number
  sha256: string
  packageName: string
  versionCode: number
  signerSha256: string
}

export interface DownloadProgress {
  downloadedBytes: number
  totalBytes: number
  percent: number
}

interface NativeUpdaterModule {
  downloadApk(options: DownloadApkOptions): Promise<DownloadedApk>
  cancelDownload(): Promise<void>
  canRequestPackageInstalls(): Promise<boolean>
  openInstallPermissionSettings(): Promise<void>
  installApk(fileUri: string): Promise<void>
  verifyDetachedSignature(payload: string, signature: string): Promise<boolean>
  clearStaleDownloads(): Promise<void>
  addListener(eventName: "onDownloadProgress", listener: (event: DownloadProgress) => void): EventSubscription
}

const nativeUpdater = requireOptionalNativeModule<NativeUpdaterModule>("AnyboxAndroidUpdater")

function requireUpdater(): NativeUpdaterModule {
  if (!nativeUpdater) {
    throw new Error("The Anybox Android updater is unavailable in this build.")
  }
  return nativeUpdater
}

export const isAndroidUpdaterAvailable = nativeUpdater !== null

export function downloadApk(options: DownloadApkOptions) {
  return requireUpdater().downloadApk(options)
}

export function cancelDownload() {
  return requireUpdater().cancelDownload()
}

export function canRequestPackageInstalls() {
  return requireUpdater().canRequestPackageInstalls()
}

export function openInstallPermissionSettings() {
  return requireUpdater().openInstallPermissionSettings()
}

export function installApk(fileUri: string) {
  return requireUpdater().installApk(fileUri)
}

export function verifyDetachedSignature(payload: string, signature: string) {
  return requireUpdater().verifyDetachedSignature(payload, signature)
}

export function clearStaleDownloads() {
  return requireUpdater().clearStaleDownloads()
}

export function addDownloadProgressListener(listener: (event: DownloadProgress) => void) {
  return requireUpdater().addListener("onDownloadProgress", listener)
}
