const PLUGIN_PREVIEW_PROTOCOL = "anybox-preview:"
const APP_RUNTIME_PREFIX = "/__anybox_runtime__/"

export function resolveCinemaRuntimeBaseURL(input: {
  explicitBaseURL?: string | null
  location?: Pick<Location, "origin" | "protocol">
}) {
  const explicit = input.explicitBaseURL?.trim().replace(/\/$/, "")
  if (explicit) return explicit
  const currentLocation = input.location ?? window.location
  if (currentLocation.protocol === PLUGIN_PREVIEW_PROTOCOL) {
    return `${currentLocation.origin}${APP_RUNTIME_PREFIX}`
  }
  return currentLocation.origin
}

export function resolveCinemaRuntimeURL(baseURL: string, pathname: string) {
  const normalizedBaseURL = baseURL.trim()
  const parsedBaseURL = new URL(normalizedBaseURL.endsWith("/") ? normalizedBaseURL : `${normalizedBaseURL}/`)
  if (parsedBaseURL.pathname.endsWith(APP_RUNTIME_PREFIX)) {
    return new URL(pathname.replace(/^\/+/, ""), parsedBaseURL).toString()
  }
  return new URL(pathname, parsedBaseURL).toString()
}

export function isCinemaPluginRuntimeBaseURL(baseURL: string) {
  try {
    const parsed = new URL(baseURL)
    return parsed.protocol === PLUGIN_PREVIEW_PROTOCOL && parsed.pathname.endsWith(APP_RUNTIME_PREFIX)
  } catch {
    return false
  }
}

