import Constants from "expo-constants"
import type { MobileDesktopPlatform, MobilePairResult } from "@/api/mobile-api"

export const DEFAULT_ACCOUNT_RELAY_BASE_URL = "https://anybox.com.cn"

export interface MobileAccountUser {
  id: string
  email: string
  username?: string | null
  name?: string
  displayName?: string | null
  avatarUrl?: string | null
  role?: string
  status?: string
  emailVerifiedAt?: string
  createdAt?: number
}

export interface MobileAccountWorkspace {
  id: string
  name: string
  status?: string
}

export interface MobileAccountSubscription {
  id?: string | null
  workspaceId?: string
  planCode: string
  status: string
  source?: string | null
  currentPeriodStart?: number | null
  currentPeriodEnd?: number | null
  cancelAtPeriodEnd: boolean
}

export interface MobileAccountEntitlements {
  modelGatewayEnabled?: boolean
  relayEnabled?: boolean
  maxDesktopDevices?: number
  maxMobileDevices?: number
}

export interface MobileAccountSession {
  baseUrl: string
  token: string
  refreshToken: string
  expiresAt?: number
  refreshExpiresAt?: number
  user: MobileAccountUser
  workspace?: MobileAccountWorkspace
  planType?: string
  planLabel?: string
  subscription?: MobileAccountSubscription | null
  entitlements?: MobileAccountEntitlements
}

export interface MobileAccountRegistration {
  user: MobileAccountUser
  workspace?: MobileAccountWorkspace
  verificationEmailSent?: boolean
  emailVerificationRequired?: boolean
}

export interface MobileAccountRelayDesktop {
  id: string
  name: string
  appVersion?: string
  platform?: MobileDesktopPlatform
  platformVersion?: string
  arch?: string
  online: boolean
  capabilities: string[]
  pairingExpiresAt: number | null
  connectedAt?: number
  lastSeenAt: number
  accountBound?: boolean
}

interface AccountAuthInput {
  baseUrl: string
  email: string
  password: string
  name?: string
}

type AccountEnvelope<T> =
  | {
      success: true
      data: T
    }
  | {
      success: false
      error?: {
        code?: string
        message?: string
      }
    }

export class AccountApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message)
    this.name = "AccountApiError"
  }
}

export function getDefaultAccountRelayBaseUrl() {
  const configured = readString(readRecord(Constants.expoConfig?.extra)?.anyboxRelayUrl)
  return configured ? normalizeAccountRelayBaseUrl(configured) : DEFAULT_ACCOUNT_RELAY_BASE_URL
}

export function normalizeAccountRelayBaseUrl(value: string) {
  const raw = value.trim()
  if (!raw) throw new Error("Relay URL is required.")
  const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(raw) ? raw : `https://${raw}`
  const parsed = new URL(candidate)
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Relay URL must start with https:// or http://.")
  }
  return parsed.origin
}

export async function registerAccountWithEmail(input: AccountAuthInput) {
  const baseUrl = normalizeAccountRelayBaseUrl(input.baseUrl)
  const value = await requestAccount<unknown>(baseUrl, "/api/agent/password/register", {
    method: "POST",
    body: JSON.stringify({
      email: input.email.trim(),
      password: input.password,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    }),
  })
  return normalizeAccountRegistration(value)
}

export async function loginAccountWithEmail(input: AccountAuthInput) {
  const baseUrl = normalizeAccountRelayBaseUrl(input.baseUrl)
  const value = await requestAccount<unknown>(baseUrl, "/api/agent/password/login", {
    method: "POST",
    body: JSON.stringify({
      email: input.email.trim(),
      password: input.password,
      deviceName: "Anybox Mobile",
      clientId: "anybox-agent",
    }),
  })
  return normalizeAccountSession(baseUrl, value)
}

export async function getAccountProfile(baseUrlInput: string, token: string) {
  const baseUrl = normalizeAccountRelayBaseUrl(baseUrlInput)
  const value = await requestAccount<unknown>(baseUrl, "/api/agent/me", {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })
  const record = readRecord(value)
  return {
    user: normalizeAccountUser(record?.user),
    workspace: normalizeAccountWorkspace(record?.workspace),
    ...normalizeAccountMetadata(record),
  }
}

export async function refreshAccountSession(baseUrlInput: string, refreshToken: string) {
  const baseUrl = normalizeAccountRelayBaseUrl(baseUrlInput)
  const value = await requestAccount<unknown>(baseUrl, "/api/agent/oauth/refresh", {
    method: "POST",
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: "anybox-agent",
      refresh_token: refreshToken,
    }),
  })
  return normalizeAccountSession(baseUrl, value)
}

export async function logoutAccount(baseUrlInput: string, token: string) {
  const baseUrl = normalizeAccountRelayBaseUrl(baseUrlInput)
  await requestAccount<unknown>(baseUrl, "/api/agent/oauth/revoke", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
    },
  })
}

export async function updateAccountProfile(
  account: MobileAccountSession,
  input: { displayName?: string | null; username?: string | null; avatarUrl?: string | null },
) {
  const value = await requestAccount<unknown>(account.baseUrl, "/api/client/me", {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${account.token}`,
    },
    body: JSON.stringify({
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.username !== undefined ? { username: input.username } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    }),
  })
  const record = readRecord(value)
  const user = normalizeAccountUser(record?.user)
  if (!user) {
    throw new AccountApiError("Profile response did not include a user.", 0, "INVALID_ACCOUNT_RESPONSE")
  }
  return {
    ...account,
    user,
    ...(normalizeAccountWorkspace(record?.workspace) ? { workspace: normalizeAccountWorkspace(record?.workspace)! } : {}),
    ...normalizeAccountMetadata(record),
  }
}

export async function listAccountRelayDesktops(account: MobileAccountSession) {
  const value = await requestAccount<unknown>(account.baseUrl, "/api/relay/desktops", {
    headers: {
      authorization: `Bearer ${account.token}`,
    },
  })
  return normalizeAccountRelayDesktops(value)
}

export async function connectAccountRelayDesktop(account: MobileAccountSession, desktopID: string, name = "Anybox Mobile") {
  const value = await requestAccount<unknown>(account.baseUrl, `/api/relay/desktops/${encodeURIComponent(desktopID)}/connect`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${account.token}`,
    },
    body: JSON.stringify({ name }),
  })
  return normalizeAccountRelayPairResult(value)
}

async function requestAccount<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...init?.headers,
    },
  }).catch((error: unknown) => {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : ""
    throw new AccountApiError(`Unable to reach ${baseUrl}.${detail}`, 0)
  })

  const text = await response.text()
  const value = parseJson(text)

  if (!response.ok) {
    const envelope = isAccountEnvelope<unknown>(value) ? value : undefined
    const message = envelope?.success === false ? envelope.error?.message : readErrorMessage(value)
    const code = envelope?.success === false ? envelope.error?.code : readErrorCode(value)
    throw new AccountApiError(message || `Account request failed with HTTP ${response.status}.`, response.status, code)
  }

  if (isAccountEnvelope<T>(value)) {
    if (value.success) return value.data
    throw new AccountApiError(value.error?.message || "Account request failed.", response.status, value.error?.code)
  }

  return value as T
}

function normalizeAccountSession(baseUrl: string, value: unknown): MobileAccountSession {
  const record = readRecord(value)
  const session = readRecord(record?.session)
  const account = readRecord(record?.account)
  const token = readString(record?.accessToken) ?? readString(record?.access_token) ?? readString(record?.token) ?? readString(session?.token)
  const refreshToken = readString(record?.refreshToken) ?? readString(record?.refresh_token)
  const user = normalizeAccountUser(record?.user ?? account)
  const workspace = normalizeAccountWorkspace(record?.workspace ?? account)
  if (!token || !refreshToken || !user) {
    throw new AccountApiError("Account response did not include agent tokens and user.", 0, "INVALID_ACCOUNT_RESPONSE")
  }
  return {
    baseUrl,
    token,
    refreshToken,
    ...(readTimestamp(record?.expiresAt) ? { expiresAt: readTimestamp(record?.expiresAt) } : {}),
    ...(readTimestamp(record?.refreshExpiresAt) ? { refreshExpiresAt: readTimestamp(record?.refreshExpiresAt) } : {}),
    user,
    ...(workspace ? { workspace } : {}),
    ...normalizeAccountMetadata(record),
  }
}

function normalizeAccountMetadata(value: unknown) {
  const record = readRecord(value)
  const account = readRecord(record?.account)
  const subscription = normalizeAccountSubscription(readNestedValue(record, account, "subscription"))
  const entitlements = normalizeAccountEntitlements(readNestedValue(record, account, "entitlements"))
  const planType =
    readString(account?.planType) ??
    readString(account?.plan_type) ??
    readString(record?.planType) ??
    readString(record?.plan_type) ??
    subscription?.planCode
  const planLabel =
    readString(account?.planLabel) ??
    readString(account?.plan_label) ??
    readString(record?.planLabel) ??
    readString(record?.plan_label) ??
    (planType ? formatPlanLabel(planType) : undefined)

  return {
    ...(planType ? { planType } : {}),
    ...(planLabel ? { planLabel } : {}),
    ...(subscription !== undefined ? { subscription } : {}),
    ...(entitlements ? { entitlements } : {}),
  }
}

function normalizeAccountSubscription(value: unknown): MobileAccountSubscription | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const record = readRecord(value)
  if (!record) return undefined
  const planCode = readString(record?.planCode) ?? readString(record?.plan_code)
  const status = readString(record?.status)
  if (!planCode || !status) return undefined
  const currentPeriodStart = readTimestamp(record?.currentPeriodStart) ?? readTimestamp(record?.current_period_start)
  const currentPeriodEnd = readTimestamp(record?.currentPeriodEnd) ?? readTimestamp(record?.current_period_end)
  return {
    id: readString(record?.id) ?? null,
    ...(readString(record?.workspaceId) ?? readString(record?.workspace_id)
      ? { workspaceId: readString(record?.workspaceId) ?? readString(record?.workspace_id) }
      : {}),
    planCode,
    status,
    source: readString(record?.source) ?? null,
    currentPeriodStart: currentPeriodStart ?? null,
    currentPeriodEnd: currentPeriodEnd ?? null,
    cancelAtPeriodEnd: readBoolean(record?.cancelAtPeriodEnd) ?? readBoolean(record?.cancel_at_period_end) ?? false,
  }
}

function normalizeAccountEntitlements(value: unknown): MobileAccountEntitlements | undefined {
  const record = readRecord(value)
  if (!record) return undefined
  const entitlements: MobileAccountEntitlements = {}
  const modelGatewayEnabled = readBoolean(record?.modelGatewayEnabled) ?? readBoolean(record?.model_gateway_enabled)
  const relayEnabled = readBoolean(record?.relayEnabled) ?? readBoolean(record?.relay_enabled)
  const maxDesktopDevices = readNumber(record?.maxDesktopDevices) ?? readNumber(record?.max_desktop_devices)
  const maxMobileDevices = readNumber(record?.maxMobileDevices) ?? readNumber(record?.max_mobile_devices)

  if (modelGatewayEnabled !== undefined) entitlements.modelGatewayEnabled = modelGatewayEnabled
  if (relayEnabled !== undefined) entitlements.relayEnabled = relayEnabled
  if (maxDesktopDevices !== undefined) entitlements.maxDesktopDevices = maxDesktopDevices
  if (maxMobileDevices !== undefined) entitlements.maxMobileDevices = maxMobileDevices

  return Object.keys(entitlements).length ? entitlements : undefined
}

function normalizeAccountRegistration(value: unknown): MobileAccountRegistration {
  const record = readRecord(value)
  const account = readRecord(record?.account)
  const user = normalizeAccountUser(record?.user ?? account)
  if (!user) {
    throw new AccountApiError("Registration response did not include a user.", 0, "INVALID_ACCOUNT_RESPONSE")
  }
  const workspace = normalizeAccountWorkspace(record?.workspace ?? account)
  return {
    user,
    ...(workspace ? { workspace } : {}),
    ...(typeof record?.verificationEmailSent === "boolean" ? { verificationEmailSent: record.verificationEmailSent } : {}),
    ...(typeof record?.emailVerificationRequired === "boolean" ? { emailVerificationRequired: record.emailVerificationRequired } : {}),
  }
}

function normalizeAccountRelayDesktops(value: unknown): MobileAccountRelayDesktop[] {
  const rows = Array.isArray(value) ? value : []
  return rows
    .map((row) => normalizeAccountRelayDesktop(row))
    .filter((desktop): desktop is MobileAccountRelayDesktop => Boolean(desktop))
}

function normalizeAccountRelayDesktop(value: unknown): MobileAccountRelayDesktop | null {
  const record = readRecord(value)
  const id = readString(record?.id)
  const name = readString(record?.name)
  if (!id || !name) return null
  const appVersion = readString(record?.appVersion)
  const platform = normalizeDesktopPlatform(record?.platform)
  const platformVersion = readString(record?.platformVersion)
  const arch = readString(record?.arch)
  const capabilities = Array.isArray(record?.capabilities)
    ? record.capabilities.filter((capability): capability is string => typeof capability === "string" && capability.trim().length > 0)
    : []
  return {
    id,
    name,
    ...(appVersion ? { appVersion } : {}),
    ...(platform ? { platform } : {}),
    ...(platformVersion ? { platformVersion } : {}),
    ...(arch ? { arch } : {}),
    online: record?.online === true,
    capabilities,
    pairingExpiresAt: typeof record?.pairingExpiresAt === "number" ? record.pairingExpiresAt : null,
    ...(typeof record?.connectedAt === "number" ? { connectedAt: record.connectedAt } : {}),
    lastSeenAt: typeof record?.lastSeenAt === "number" ? record.lastSeenAt : 0,
    ...(typeof record?.accountBound === "boolean" ? { accountBound: record.accountBound } : {}),
  }
}

function normalizeAccountRelayPairResult(value: unknown): MobilePairResult {
  const record = readRecord(value)
  const token = readString(record?.token)
  const device = readRecord(record?.device)
  const desktop = normalizeAccountRelayDesktop(record?.desktop)
  const deviceID = readString(device?.id)
  const deviceName = readString(device?.name)
  if (!token || !deviceID || !desktop) {
    throw new AccountApiError("Relay connection response did not include a mobile token, device, and desktop.", 0, "INVALID_RELAY_RESPONSE")
  }
  return {
    token,
    desktopID: desktop.id,
    desktop,
    device: {
      id: deviceID,
      name: deviceName ?? "Anybox Mobile",
      createdAt: typeof device?.createdAt === "number" ? device.createdAt : Date.now(),
      lastSeenAt: typeof device?.lastSeenAt === "number" ? device.lastSeenAt : Date.now(),
      capabilities: Array.isArray(device?.capabilities)
        ? device.capabilities.filter((capability): capability is string => typeof capability === "string" && capability.trim().length > 0)
        : desktop.capabilities,
    },
  }
}

export function normalizeAccountUser(value: unknown): MobileAccountUser | null {
  const record = readRecord(value)
  const email = readString(record?.email)
  if (!email) return null
  const id = readString(record?.id) ?? readString(record?.accountID) ?? readString(record?.account_id) ?? email
  const username = readString(record?.username)
  const name = readString(record?.name)
  const displayName = readString(record?.displayName) ?? readString(record?.display_name) ?? name
  const avatarUrl = readString(record?.avatarUrl) ?? readString(record?.avatar_url)
  const role = readString(record?.role)
  const status = readString(record?.status)
  const emailVerifiedAt = readString(record?.emailVerifiedAt) ?? readString(record?.email_verified_at)
  const createdAt = typeof record?.createdAt === "number" ? record.createdAt : undefined
  return {
    id,
    email,
    ...(username ? { username } : {}),
    ...(name ? { name } : {}),
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    ...(emailVerifiedAt ? { emailVerifiedAt } : {}),
    ...(createdAt ? { createdAt } : {}),
  }
}

function normalizeAccountWorkspace(value: unknown): MobileAccountWorkspace | null {
  const record = readRecord(value)
  const id = readString(record?.id) ?? readString(record?.workspaceID) ?? readString(record?.workspace_id)
  const name = readString(record?.name) ?? readString(record?.workspaceName) ?? readString(record?.workspace_name)
  if (!id || !name) return null
  const status = readString(record?.status) ?? readString(record?.workspaceStatus) ?? readString(record?.workspace_status)
  return {
    id,
    name,
    ...(status ? { status } : {}),
  }
}

function parseJson(text: string) {
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function readErrorMessage(value: unknown) {
  const record = readRecord(value)
  const error = readRecord(record?.error)
  return readString(error?.message)
}

function readErrorCode(value: unknown) {
  const record = readRecord(value)
  const error = readRecord(record?.error)
  return readString(error?.code)
}

function isAccountEnvelope<T>(value: unknown): value is AccountEnvelope<T> {
  return Boolean(value && typeof value === "object" && "success" in value)
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readNestedValue(record: Record<string, unknown> | null, account: Record<string, unknown> | null, key: string) {
  if (account && key in account) return account[key]
  return record ? record[key] : undefined
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeDesktopPlatform(value: unknown): MobileDesktopPlatform | undefined {
  return value === "windows" || value === "macos" || value === "linux" || value === "unknown"
    ? value
    : undefined
}

function readBoolean(value: unknown) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["true", "1", "yes"].includes(normalized)) return true
    if (["false", "0", "no"].includes(normalized)) return false
  }
  return undefined
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const stringValue = readString(value)
  if (!stringValue) return undefined
  const parsed = Number(stringValue)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const stringValue = readString(value)
  if (!stringValue) return undefined
  const parsed = Date.parse(stringValue)
  return Number.isFinite(parsed) ? parsed : undefined
}

function formatPlanLabel(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1).toLocaleLowerCase()}`)
    .join(" ")
}
