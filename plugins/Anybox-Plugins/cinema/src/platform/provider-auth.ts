import { ApiError } from "#server/error.ts"
import { callNativeHelper } from "./native-helper.ts"

const SERVICE = "com.anybox.cinema"
const sessionCredentials = new Map<string, string>()

function account(providerID: string) {
  return `provider.${providerID}.api-key`
}

async function keychainGet(providerID: string) {
  const result = await callNativeHelper<{ value: string | null }>("credential.get", {
    service: SERVICE,
    account: account(providerID),
  })
  return result.value?.trim() || undefined
}

export async function readProviderApiKey(providerID: string) {
  try {
    const persistent = await keychainGet(providerID)
    if (persistent) return { value: persistent, source: "system-keychain" as const }
  } catch {
    // A session-only credential remains available when the OS keychain cannot be used.
  }
  const session = sessionCredentials.get(providerID)
  return session ? { value: session, source: "session" as const } : undefined
}

export async function resolveProviderRuntimeAuth(
  providerID: string,
  _settings?: unknown,
  _options?: unknown,
) {
  const credential = await readProviderApiKey(providerID)
  return {
    apiKey: credential?.value,
    credentialKind: "api_key" as const,
    credentialSource: credential?.source ?? "none",
    authState: {
      status: credential ? "connected" as const : "not_connected" as const,
      connectionLabel: credential?.source === "session" ? "Session only" : credential ? "System keychain" : undefined,
      lastError: undefined as string | undefined,
    },
  }
}

export async function saveProviderApiKey(
  providerID: string,
  apiKey: string | null | undefined,
  options: { allowSession?: boolean } = {},
) {
  const normalized = apiKey?.trim()
  if (!normalized) {
    sessionCredentials.delete(providerID)
    await callNativeHelper("credential.delete", { service: SERVICE, account: account(providerID) }).catch(() => undefined)
    return { persistence: "none" as const }
  }
  try {
    await callNativeHelper("credential.set", { service: SERVICE, account: account(providerID), value: normalized })
    sessionCredentials.delete(providerID)
    return { persistence: "system-keychain" as const }
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "KEYCHAIN_UNAVAILABLE") throw error
    if (!options.allowSession) {
      throw new ApiError(
        503,
        "KEYCHAIN_UNAVAILABLE",
        "The operating-system keychain is unavailable. Choose the explicitly temporary session credential option to continue without persistence.",
      )
    }
    sessionCredentials.set(providerID, normalized)
    return { persistence: "session" as const }
  }
}

export function clearSessionCredentials() {
  sessionCredentials.clear()
}
