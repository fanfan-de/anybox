import { useEffect, useState } from "react"
import type { DesktopRuntimeCapabilities } from "../../../shared/desktop-ipc-contract"

const DISABLED_RUNTIME_CAPABILITIES: DesktopRuntimeCapabilities = {
  developmentFeaturesEnabled: false,
  appearanceAuthoringEnabled: false,
}

let runtimeCapabilitiesPromise: Promise<DesktopRuntimeCapabilities> | null = null
let runtimeCapabilitiesLoader:
  | (() => Promise<DesktopRuntimeCapabilities>)
  | undefined
let currentRuntimeCapabilities = DISABLED_RUNTIME_CAPABILITIES

function normalizeRendererRuntimeCapabilities(
  capabilities: DesktopRuntimeCapabilities,
): DesktopRuntimeCapabilities {
  if (!import.meta.env.DEV) return DISABLED_RUNTIME_CAPABILITIES

  const developmentFeaturesEnabled = capabilities.developmentFeaturesEnabled === true
  return {
    developmentFeaturesEnabled,
    appearanceAuthoringEnabled:
      developmentFeaturesEnabled && capabilities.appearanceAuthoringEnabled === true,
  }
}

export function getRendererRuntimeCapabilities(): Promise<DesktopRuntimeCapabilities> {
  const loader = window.desktop?.getRuntimeCapabilities
  if (loader !== runtimeCapabilitiesLoader) {
    runtimeCapabilitiesLoader = loader
    currentRuntimeCapabilities = DISABLED_RUNTIME_CAPABILITIES
    runtimeCapabilitiesPromise = loader
      ? loader()
        .then(normalizeRendererRuntimeCapabilities)
        .then((capabilities) => {
          currentRuntimeCapabilities = capabilities
          return capabilities
        })
        .catch(() => DISABLED_RUNTIME_CAPABILITIES)
      : Promise.resolve(DISABLED_RUNTIME_CAPABILITIES)
  }

  return runtimeCapabilitiesPromise ?? Promise.resolve(DISABLED_RUNTIME_CAPABILITIES)
}

export function areRendererDevelopmentFeaturesEnabled() {
  return import.meta.env.DEV && currentRuntimeCapabilities.developmentFeaturesEnabled
}

export function useDesktopRuntimeCapabilities() {
  const [capabilities, setCapabilities] = useState<DesktopRuntimeCapabilities>(
    DISABLED_RUNTIME_CAPABILITIES,
  )
  const [runtimeCapabilitiesReady, setRuntimeCapabilitiesReady] = useState(false)

  useEffect(() => {
    let mounted = true

    void getRendererRuntimeCapabilities().then((nextCapabilities) => {
      if (!mounted) return
      setCapabilities(nextCapabilities)
      setRuntimeCapabilitiesReady(true)
    })

    return () => {
      mounted = false
    }
  }, [])

  return {
    ...capabilities,
    runtimeCapabilitiesReady,
  }
}
