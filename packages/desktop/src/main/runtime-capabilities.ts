import { app } from "electron"
import type { DesktopRuntimeCapabilities } from "../shared/desktop-ipc-contract"

export const DESKTOP_DEVELOPMENT_FEATURES_ENV = "ANYBOX_DESKTOP_DEVELOPMENT_FEATURES"

export function resolveDesktopRuntimeCapabilities(input: {
  developmentFeaturesFlag?: string
  isPackaged: boolean
}): DesktopRuntimeCapabilities {
  const developmentFeaturesEnabled =
    !input.isPackaged && input.developmentFeaturesFlag === "1"

  return {
    developmentFeaturesEnabled,
    appearanceAuthoringEnabled: developmentFeaturesEnabled,
  }
}

export function getDesktopRuntimeCapabilities(): DesktopRuntimeCapabilities {
  return resolveDesktopRuntimeCapabilities({
    developmentFeaturesFlag: process.env[DESKTOP_DEVELOPMENT_FEATURES_ENV],
    isPackaged: app.isPackaged,
  })
}
