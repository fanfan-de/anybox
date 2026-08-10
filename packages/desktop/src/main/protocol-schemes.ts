import { LOCAL_IMAGE_PROTOCOL_SCHEMES } from "./local-image-protocol"
import { LOCAL_PREVIEW_PROTOCOL_SCHEMES } from "./preview-targets"

interface DesktopProtocolSchemeRegistrar {
  registerSchemesAsPrivileged(schemes: Array<{
    scheme: string
    privileges: {
      standard?: boolean
      secure?: boolean
      supportFetchAPI?: boolean
      stream?: boolean
    }
  }>): void
}

export function registerDesktopProtocolSchemes(protocolRegistrar: DesktopProtocolSchemeRegistrar) {
  // Electron only accepts one pre-ready privileged-scheme registration call.
  protocolRegistrar.registerSchemesAsPrivileged([
    ...LOCAL_IMAGE_PROTOCOL_SCHEMES,
    ...LOCAL_PREVIEW_PROTOCOL_SCHEMES,
  ])
}
