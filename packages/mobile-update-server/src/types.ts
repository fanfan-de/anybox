export const MOBILE_UPDATE_CHANNELS = ["preview", "production"] as const
export type MobileUpdateChannel = (typeof MOBILE_UPDATE_CHANNELS)[number]

export interface MobileOtaChannelPointer {
  schemaVersion: 1
  type: "update" | "rollback"
  channel: MobileUpdateChannel
  platform: "android"
  runtimeVersion: string
  updateId: string
  createdAt: string
  manifestUrl: string
  signature: string
  keyId: "anybox-mobile-2026"
  sourceCommit: string
  message: string
  nativeFingerprint: string
}

export interface ExpoUpdateAsset {
  hash: string
  key: string
  contentType: string
  fileExtension?: string
  url: string
}

export interface ExpoUpdateManifest {
  id: string
  createdAt: string
  runtimeVersion: string
  launchAsset: ExpoUpdateAsset
  assets: ExpoUpdateAsset[]
  metadata: Record<string, string>
  extra: {
    anybox?: {
      channel?: string
      message?: string
      nativeFingerprint?: string
      sourceCommit?: string
    }
    [key: string]: unknown
  }
}

export interface ExpoUpdateDirective {
  type: "rollBackToEmbedded"
  parameters: {
    commitTime: string
  }
  extra?: Record<string, unknown>
}

export interface VerifiedUpdate {
  kind: "update"
  pointer: MobileOtaChannelPointer
  rawBody: string
  manifest: ExpoUpdateManifest
}

export interface VerifiedRollback {
  kind: "rollback"
  pointer: MobileOtaChannelPointer
  rawBody: string
  directive: ExpoUpdateDirective
}

export type VerifiedArtifact = VerifiedUpdate | VerifiedRollback
