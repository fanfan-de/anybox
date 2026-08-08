import fs from "fs/promises"
import os from "os"
import path from "path"
import { createHash } from "node:crypto"
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http"
import z from "zod"
import * as Auth from "#auth/auth.ts"
import * as AnyboxHTTP from "#provider/anybox-http.ts"
import * as Log from "#util/log.ts"
import { getProcessEnvValue } from "#env/compat.ts"

const log = Log.create({ service: "provider-auth" })

const OPENAI_PROVIDER_ID = "openai"
const ANYBOX_PROVIDER_ID = "anybox"
const OPENAI_AUTH_ISSUER = "https://auth.openai.com"
const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"
const OPENAI_DEVICE_AUTH_BASE_URL = `${OPENAI_AUTH_ISSUER}/api/accounts`
const OPENAI_DEVICE_AUTH_VERIFICATION_URL = `${OPENAI_AUTH_ISSUER}/codex/device`
const OPENAI_LOCAL_CALLBACK_PATH = "/auth/callback"
const DEFAULT_OPENAI_LOCAL_CALLBACK_PORT = 1455
const ANYBOX_BROWSER_METHOD = "anybox-browser"
const ANYBOX_CLIENT_ID = getProcessEnvValue("ANYBOX_CLIENT_ID")?.trim() || "anybox-agent"
const ANYBOX_OAUTH_SCOPE = "openid profile email offline_access"
const OPENAI_OAUTH_CLIENT_ID = getProcessEnvValue("ANYBOX_OPENAI_CODEX_CLIENT_ID")?.trim() || "app_EMoamEEZ73f0CkXaXp7hrann"
const OPENAI_OAUTH_SCOPE = "openid profile email offline_access"
const OPENAI_ORIGINATOR =
  getProcessEnvValue("ANYBOX_OPENAI_CODEX_ORIGINATOR")?.trim() ||
  process.env["CODEX_INTERNAL_ORIGINATOR_OVERRIDE"]?.trim() ||
  "Codex Desktop"
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000
const OPENAI_FLOW_TIMEOUT_MS = 15 * 60 * 1000

const CodexAuthCache = z
  .object({
    auth_mode: z.string().optional(),
    OPENAI_API_KEY: z.string().optional().nullable(),
    tokens: z
      .object({
        access_token: z.string().optional(),
        refresh_token: z.string().optional(),
        id_token: z.string().optional(),
        account_id: z.string().optional(),
      })
      .passthrough()
      .optional(),
    last_refresh: z.number().optional(),
  })
  .passthrough()
type CodexAuthCache = z.infer<typeof CodexAuthCache>

const ProviderAuthScope = z.literal("global")
export type ProviderAuthScope = z.infer<typeof ProviderAuthScope>

const ProviderAuthPrompt = z.enum(["login", "select_account"])
export type ProviderAuthPrompt = z.infer<typeof ProviderAuthPrompt>

export const ProviderAuthCapability = z
  .object({
    method: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    kind: z.enum(["browser_oauth", "device_code", "api_key"]),
    recommended: z.boolean().optional(),
    supportsPolling: z.boolean().optional(),
    supportsRefresh: z.boolean().optional(),
    supportsDisconnect: z.boolean().optional(),
  })
  .meta({ ref: "ProviderAuthCapability" })
export type ProviderAuthCapability = z.infer<typeof ProviderAuthCapability>

export const ProviderAuthAccountSummary = z
  .object({
    accountID: z.string().optional(),
    userID: z.string().optional(),
    email: z.string().optional(),
    planType: z.string().optional(),
    planLabel: z.string().optional(),
    subscription: Auth.WorkspaceSubscription.nullable().optional(),
    entitlements: Auth.WorkspaceEntitlements.optional(),
    workspaceID: z.string().optional(),
    workspaceName: z.string().optional(),
    balanceMicrocents: z.number().optional(),
    currency: z.string().optional(),
    rechargeUrl: z.string().optional(),
    label: z.string().optional(),
  })
  .meta({ ref: "ProviderAuthAccountSummary" })
export type ProviderAuthAccountSummary = z.infer<typeof ProviderAuthAccountSummary>

export const ProviderAuthFlow = z
  .object({
    id: z.string().min(1),
    providerID: z.string().min(1),
    method: z.string().min(1),
    kind: z.enum(["browser_oauth", "device_code", "api_key"]),
    status: z.enum(["pending", "waiting_user", "authorizing", "connected", "error", "expired", "cancelled"]),
    startedAt: z.number(),
    updatedAt: z.number(),
    expiresAt: z.number().optional(),
    authorizationURL: z.string().optional(),
    verificationURI: z.string().optional(),
    userCode: z.string().optional(),
    errorMessage: z.string().optional(),
    errorCode: z.string().optional(),
    diagnostics: z.record(z.string(), z.any()).optional(),
    connectionLabel: z.string().optional(),
    account: ProviderAuthAccountSummary.optional(),
  })
  .meta({ ref: "ProviderAuthFlow" })
export type ProviderAuthFlow = z.infer<typeof ProviderAuthFlow>

export const ProviderAuthState = z
  .object({
    providerID: z.string().min(1),
    scope: ProviderAuthScope,
    activeMethod: z.string().optional(),
    status: z.enum(["connected", "pending", "expired", "error", "not_connected"]),
    connectionLabel: z.string().optional(),
    lastError: z.string().optional(),
    expiresAt: z.number().optional(),
    account: ProviderAuthAccountSummary.optional(),
    capabilities: z.array(ProviderAuthCapability),
    credentials: z.array(Auth.ProviderCredentialDescriptor),
    flow: ProviderAuthFlow.optional(),
  })
  .meta({ ref: "ProviderAuthState" })
export type ProviderAuthState = z.infer<typeof ProviderAuthState>

export type ProviderRuntimeAuth = {
  credentialKind?: Auth.CredentialRecord["kind"]
  credentialSource?: Auth.ProviderCredentialDescriptor["source"]
  activeMethod?: string | null
  apiKey?: string
  runtimeBaseURL?: string
  runtimeHeaders?: Record<string, string>
  authMode: "api" | "codex"
  authCapabilities: ProviderAuthCapability[]
  authState: ProviderAuthState
}

type ProviderAuthFallbacks = {
  configApiKey?: string
  envApiKey?: string
  providerBaseURL?: string
}

export type ProviderRuntimeCredentialMode = "active" | "manual" | "environment"

export type ProviderRuntimeAuthOptions = {
  method?: string
  credentialMode?: ProviderRuntimeCredentialMode
  transientApiKey?: string | null
  forceRefresh?: boolean
}

export type GenericOAuthTokenEndpointAuthMethod = "none" | "client_secret_post" | "client_secret_basic"
export type GenericOAuthTokenRequestFormat = "form" | "json"
export type GenericOAuthProviderDialect = "standard" | "bilibili"

export type GenericOAuthDynamicClientRegistrationConfig = {
  registrationURL: string
  initialAccessToken?: string
  metadata?: Record<string, unknown>
}

export type GenericOAuthProviderConfig = {
  label?: string
  clientID?: string
  clientSecret?: string
  authorizationURL: string
  tokenURL: string
  refreshURL?: string
  scopes: string[]
  revocationURL?: string
  authorizationParams?: Record<string, string>
  tokenParams?: Record<string, string>
  tokenEndpointAuthMethod?: GenericOAuthTokenEndpointAuthMethod
  tokenRequestFormat?: GenericOAuthTokenRequestFormat
  dialect?: GenericOAuthProviderDialect
  registration?: GenericOAuthDynamicClientRegistrationConfig
}

const OPTIONAL_IDENTITY_OAUTH_SCOPES = new Set(["openid", "email", "profile", "offline_access"])

type ProviderFlowContext = {
  providerID: string
  method: string
  serverBaseURL: string
  providerBaseURL?: string
  prompt?: ProviderAuthPrompt
}

type InternalFlow = ProviderAuthFlow & {
  state?: string
  redirectURI?: string
  codeVerifier?: string
  deviceAuthID?: string
  intervalSeconds?: number
  cancelSignal?: AbortController
  timeoutHandle?: ReturnType<typeof setTimeout>
  providerBaseURL?: string
  genericOAuth?: GenericOAuthProviderConfig & { clientID: string }
}

const flowState = new Map<string, InternalFlow>()

type OpenAILocalCallbackServer = {
  server: HttpServer
  host: string
  port: number
  redirectURI: string
}

let openAILocalCallbackServer: OpenAILocalCallbackServer | undefined
let openAILocalCallbackServerPromise: Promise<OpenAILocalCallbackServer> | undefined

const apiKeyCapability: ProviderAuthCapability = {
  method: "api-key",
  label: "API key",
  description: "Usage-based access via a provider API key.",
  kind: "api_key",
  supportsDisconnect: true,
}

const openaiCapabilities: ProviderAuthCapability[] = [
  {
    method: "chatgpt-browser",
    label: "ChatGPT Pro/Plus (browser)",
    description: "Sign in with ChatGPT in your system browser.",
    kind: "browser_oauth",
    recommended: true,
    supportsPolling: true,
    supportsRefresh: true,
    supportsDisconnect: true,
  },
  {
    method: "chatgpt-headless",
    label: "ChatGPT Pro/Plus (headless)",
    description: "Use a device code on another browser or machine.",
    kind: "device_code",
    supportsPolling: true,
    supportsRefresh: true,
    supportsDisconnect: true,
  },
  apiKeyCapability,
]

const anyboxCapabilities: ProviderAuthCapability[] = [
  {
    method: ANYBOX_BROWSER_METHOD,
    label: "Anybox account",
    description: "Sign in with your Anybox account.",
    kind: "browser_oauth",
    recommended: true,
    supportsPolling: true,
    supportsRefresh: true,
    supportsDisconnect: true,
  },
]

function now() {
  return Date.now()
}

function normalizeString(value: unknown) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function getCapabilities(providerID: string): ProviderAuthCapability[] {
  if (providerID === OPENAI_PROVIDER_ID) return openaiCapabilities
  if (providerID === ANYBOX_PROVIDER_ID) return anyboxCapabilities
  return [apiKeyCapability]
}

export function getProviderAuthCapabilities(providerID: string): ProviderAuthCapability[] {
  return getCapabilities(providerID)
}

function getCapability(providerID: string, method: string) {
  return getCapabilities(providerID).find((item) => item.method === method)
}

function isOpenAIChatGPTMethod(method: string | undefined) {
  return method === "chatgpt-browser" || method === "chatgpt-headless"
}

function createFlowID() {
  return crypto.randomUUID()
}

function base64UrlEncode(input: Uint8Array) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function parseNumeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["true", "1", "yes"].includes(normalized)) return true
    if (["false", "0", "no"].includes(normalized)) return false
  }
  return undefined
}

function parseTimestamp(value: unknown) {
  const numeric = parseNumeric(value)
  if (numeric !== undefined) return numeric
  const stringValue = normalizeString(value)
  if (!stringValue) return undefined
  const parsed = Date.parse(stringValue)
  return Number.isFinite(parsed) ? parsed : undefined
}

function getOpenAILocalCallbackHost() {
  return normalizeString(getProcessEnvValue("ANYBOX_OPENAI_CODEX_CALLBACK_HOST")) ?? "localhost"
}

function getOpenAILocalCallbackBindHost() {
  return normalizeString(getProcessEnvValue("ANYBOX_OPENAI_CODEX_CALLBACK_HOST"))
}

function getOpenAILocalCallbackPort() {
  const configured = parseNumeric(getProcessEnvValue("ANYBOX_OPENAI_CODEX_CALLBACK_PORT"))
  if (configured === undefined) return DEFAULT_OPENAI_LOCAL_CALLBACK_PORT
  return Math.max(0, Math.floor(configured))
}

export function getLocalBrowserCallbackURL() {
  return `http://${getOpenAILocalCallbackHost()}:${getOpenAILocalCallbackPort()}${OPENAI_LOCAL_CALLBACK_PATH}`
}

function resolveCodexAuthFilepath() {
  const codexHome = normalizeString(process.env["CODEX_HOME"]) ?? path.join(os.homedir(), ".codex")
  return path.join(codexHome, "auth.json")
}

async function readCodexAuthCache(): Promise<CodexAuthCache | undefined> {
  try {
    const raw = await fs.readFile(resolveCodexAuthFilepath(), "utf8")
    return CodexAuthCache.parse(JSON.parse(raw))
  } catch {
    return undefined
  }
}

async function createPkcePair() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32))
  const codeVerifier = base64UrlEncode(verifierBytes)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier))
  const codeChallenge = base64UrlEncode(new Uint8Array(digest))
  return {
    codeVerifier,
    codeChallenge,
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".")
  if (parts.length < 2) return undefined

  try {
    const normalized = parts[1]!.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    const text = Buffer.from(padded, "base64").toString("utf8")
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function readJwtExpiry(token: string | undefined) {
  if (!token) return undefined
  const payload = decodeJwtPayload(token)
  const exp = parseNumeric(payload?.exp)
  return exp ? exp * 1000 : undefined
}

function summarizeOAuthAccount(credential: Auth.OAuthSessionCredential): ProviderAuthAccountSummary | undefined {
  const label = credential.email ?? credential.workspaceName ?? credential.planType
  if (
    !credential.accountID &&
    !credential.userID &&
    !credential.email &&
    !credential.planType &&
    !credential.planLabel &&
    !credential.subscription &&
    !credential.entitlements &&
    !credential.workspaceID &&
    !credential.workspaceName &&
    credential.balanceMicrocents === undefined &&
    !credential.currency &&
    !credential.rechargeUrl &&
    !label
  ) {
    return undefined
  }

  return {
    accountID: credential.accountID,
    userID: credential.userID,
    email: credential.email,
    planType: credential.planType,
    planLabel: credential.planLabel,
    subscription: credential.subscription,
    entitlements: credential.entitlements,
    workspaceID: credential.workspaceID,
    workspaceName: credential.workspaceName,
    balanceMicrocents: credential.balanceMicrocents,
    currency: credential.currency,
    rechargeUrl: credential.rechargeUrl,
    label,
  }
}

function methodLabel(providerID: string, method: string | undefined) {
  if (!method) return undefined
  return getCapability(providerID, method)?.label ?? method
}

function connectionLabelForCredential(
  providerID: string,
  method: string | undefined,
  credential: Auth.CredentialRecord | undefined,
  source: Auth.ProviderCredentialDescriptor["source"] = "credential_store",
) {
  if (!credential) return undefined

  if (credential.kind === "oauth_session") {
    const planLabel = normalizeString(credential.planLabel) ?? normalizeString(credential.planType)?.toUpperCase()
    const baseLabel =
      providerID === ANYBOX_PROVIDER_ID
        ? "Connected via Anybox account"
        : source === "external_cache" && providerID === OPENAI_PROVIDER_ID
          ? "Connected via ChatGPT login (Codex cache)"
          : `Connected via ${methodLabel(providerID, method)}`
    return planLabel ? `${baseLabel} (${planLabel})` : baseLabel
  }

  if (source === "environment") return "Connected via API key (environment)"
  if (source === "legacy_config") return "Connected via API key (legacy config)"
  if (source === "external_cache" && providerID === OPENAI_PROVIDER_ID) return "Connected via API key (Codex cache)"
  return `Connected via ${methodLabel(providerID, method)}`
}

function flowPublicView(flow: InternalFlow): ProviderAuthFlow {
  return {
    id: flow.id,
    providerID: flow.providerID,
    method: flow.method,
    kind: flow.kind,
    status: flow.status,
    startedAt: flow.startedAt,
    updatedAt: flow.updatedAt,
    expiresAt: flow.expiresAt,
    authorizationURL: flow.authorizationURL,
    verificationURI: flow.verificationURI,
    userCode: flow.userCode,
    errorMessage: flow.errorMessage,
    errorCode: flow.errorCode,
    diagnostics: flow.diagnostics,
    connectionLabel: flow.connectionLabel,
    account: flow.account,
  }
}

function isTerminalFlowStatus(status: ProviderAuthFlow["status"]) {
  return status === "connected" || status === "error" || status === "expired" || status === "cancelled"
}

function isOpenAIBrowserFlow(flow: InternalFlow) {
  return flow.providerID === OPENAI_PROVIDER_ID && flow.method === "chatgpt-browser"
}

function isAnyboxBrowserFlow(flow: InternalFlow) {
  return flow.providerID === ANYBOX_PROVIDER_ID && flow.method === ANYBOX_BROWSER_METHOD
}

function isGenericOAuthBrowserFlow(flow: InternalFlow) {
  return Boolean(flow.genericOAuth)
}

function isLocalBrowserCallbackFlow(flow: InternalFlow) {
  return isOpenAIBrowserFlow(flow) || isAnyboxBrowserFlow(flow) || isGenericOAuthBrowserFlow(flow)
}

function clearFlowTimeout(flow: InternalFlow) {
  if (!flow.timeoutHandle) return
  clearTimeout(flow.timeoutHandle)
  flow.timeoutHandle = undefined
}

function hasActiveOpenAIBrowserFlows() {
  return Array.from(flowState.values()).some((flow) => isLocalBrowserCallbackFlow(flow) && !isTerminalFlowStatus(flow.status))
}

function getLatestProviderFlow(providerID: string) {
  const flows = Array.from(flowState.values()).filter((flow) => flow.providerID === providerID)
  if (flows.length === 0) return undefined
  flows.sort((left, right) => right.updatedAt - left.updatedAt)
  return flows[0]
}

export function getLatestProviderAuthFlow(providerID: string) {
  const flow = getLatestProviderFlow(providerID)
  return flow ? flowPublicView(flow) : undefined
}

function upsertFlow(flow: InternalFlow) {
  flow.updatedAt = now()
  flowState.set(flow.id, flow)
  return flow
}

async function closeOpenAILocalCallbackServer() {
  const current = openAILocalCallbackServer
  openAILocalCallbackServer = undefined
  openAILocalCallbackServerPromise = undefined
  if (!current) return

  await new Promise<void>((resolve) => {
    current.server.close(() => resolve())
  })
}

async function closeOpenAILocalCallbackServerIfIdle() {
  if (hasActiveOpenAIBrowserFlows()) return
  await closeOpenAILocalCallbackServer()
}

async function settleOpenAIBrowserFlow(flow: InternalFlow, options?: { deferServerClose?: boolean }) {
  if (!isLocalBrowserCallbackFlow(flow)) return
  clearFlowTimeout(flow)

  if (options?.deferServerClose) {
    if (!hasActiveOpenAIBrowserFlows()) {
      setTimeout(() => {
        void closeOpenAILocalCallbackServerIfIdle()
      }, 0)
    }
    return
  }

  await closeOpenAILocalCallbackServerIfIdle()
}

async function expireOpenAIBrowserFlow(flowID: string) {
  const flow = flowState.get(flowID)
  if (!flow || !isLocalBrowserCallbackFlow(flow) || isTerminalFlowStatus(flow.status)) return

  flow.status = "expired"
  flow.errorMessage = "Browser sign-in timed out after 15 minutes."
  clearFlowTimeout(flow)
  upsertFlow(flow)
  await Auth.setProviderLastError(flow.providerID, flow.errorMessage)
  await settleOpenAIBrowserFlow(flow)
}

async function handleOpenAILocalCallbackRequest(req: IncomingMessage, res: ServerResponse) {
  const fallbackOrigin = openAILocalCallbackServer
    ? `http://${openAILocalCallbackServer.host}:${openAILocalCallbackServer.port}`
    : `http://${getOpenAILocalCallbackHost()}:${getOpenAILocalCallbackPort()}`
  const origin = normalizeString(req.headers.host) ? `http://${req.headers.host}` : fallbackOrigin
  const url = new URL(req.url ?? "/", origin)

  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "text/html; charset=utf-8" })
    res.end(
      renderProviderAuthCallbackPage({
        ok: false,
        title: "Sign-in failed",
        message: "This callback only accepts GET requests.",
      }),
    )
    return
  }

  if (url.pathname !== OPENAI_LOCAL_CALLBACK_PATH) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" })
    res.end(
      renderProviderAuthCallbackPage({
        ok: false,
        title: "Sign-in failed",
        message: "This callback URL is not recognized.",
      }),
    )
    return
  }

  try {
    const state = normalizeString(url.searchParams.get("state"))
    const flow = Array.from(flowState.values()).find(
      (candidate) => isLocalBrowserCallbackFlow(candidate) && candidate.state === state,
    )
    if (!flow) {
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" })
      res.end(
        renderProviderAuthCallbackPage({
          ok: false,
          title: "Sign-in failed",
          message: "The authentication flow could not be matched. Start the login flow again from the app.",
        }),
      )
      return
    }

    const result = await completeProviderBrowserCallback({
      providerID: flow.providerID,
      url,
    })

    res.writeHead(result.status, { "content-type": "text/html; charset=utf-8" })
    res.end(
      renderProviderAuthCallbackPage({
        ok: result.ok,
        title: result.title,
        message: result.message,
      }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.writeHead(500, { "content-type": "text/html; charset=utf-8" })
    res.end(
      renderProviderAuthCallbackPage({
        ok: false,
        title: "Sign-in failed",
        message,
      }),
    )
  }
}

async function ensureOpenAILocalCallbackServer() {
  if (openAILocalCallbackServer) return openAILocalCallbackServer
  if (openAILocalCallbackServerPromise) return await openAILocalCallbackServerPromise

  const requestedPort = getOpenAILocalCallbackPort()
  const requestedHost = getOpenAILocalCallbackHost()
  const bindHost = getOpenAILocalCallbackBindHost()

  openAILocalCallbackServerPromise = new Promise<OpenAILocalCallbackServer>((resolve, reject) => {
    const server = createServer((req, res) => {
      void handleOpenAILocalCallbackRequest(req, res)
    })

    const fail = (error: NodeJS.ErrnoException) => {
      server.removeAllListeners()
      const message =
        error.code === "EADDRINUSE"
          ? `OpenAI browser sign-in could not start because ${(bindHost ?? requestedHost)}:${requestedPort} is already in use.`
          : error.message
      reject(new Error(message))
    }

    server.once("error", fail)
    server.listen(bindHost ? { host: bindHost, port: requestedPort } : { port: requestedPort }, () => {
      server.off("error", fail)
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("OpenAI browser sign-in could not determine a localhost callback port."))
        })
        return
      }

      const host =
        bindHost === "0.0.0.0" || bindHost === "::" || bindHost === "[::]" ? "localhost" : requestedHost
      const serverState: OpenAILocalCallbackServer = {
        server,
        host,
        port: address.port,
        redirectURI: `http://${host}:${address.port}${OPENAI_LOCAL_CALLBACK_PATH}`,
      }

      openAILocalCallbackServer = serverState
      resolve(serverState)
    })
  })

  try {
    return await openAILocalCallbackServerPromise
  } catch (error) {
    openAILocalCallbackServerPromise = undefined
    throw error
  }
}

async function buildFallbackCredential(
  providerID: string,
  fallbacks: ProviderAuthFallbacks,
): Promise<
  | {
      method: string
      credential: Auth.CredentialRecord
      source: Auth.ProviderCredentialDescriptor["source"]
    }
  | undefined
> {
  if (fallbacks.configApiKey) {
    return {
      method: "api-key",
      credential: {
        kind: "api_key",
        apiKey: fallbacks.configApiKey,
      },
      source: "legacy_config",
    }
  }

  if (fallbacks.envApiKey) {
    return {
      method: "api-key",
      credential: {
        kind: "api_key",
        apiKey: fallbacks.envApiKey,
      },
      source: "environment",
    }
  }

  if (providerID === OPENAI_PROVIDER_ID) {
    const cache = await readCodexAuthCache()
    const authMode = normalizeString(cache?.auth_mode)?.toLowerCase()

    if (authMode === "chatgpt" || (!authMode && cache?.tokens)) {
      const accessToken = normalizeString(cache?.tokens?.access_token)
      const refreshToken = normalizeString(cache?.tokens?.refresh_token)
      const idToken = normalizeString(cache?.tokens?.id_token)

      if (accessToken && refreshToken) {
        const parsed = parseOpenAIIdToken(idToken)
        return {
          method: "chatgpt-browser",
          credential: {
            kind: "oauth_session",
            accessToken,
            refreshToken,
            expiresAt: computeTokenExpiry({
              accessToken,
              idToken,
            }),
            idToken,
            accountID: normalizeString(cache?.tokens?.account_id) ?? parsed.accountID,
            userID: parsed.userID,
            email: parsed.email,
            planType: parsed.planType,
            workspaceID: parsed.workspaceID,
            workspaceName: parsed.workspaceName,
            originator: OPENAI_ORIGINATOR,
            updatedAt: cache?.last_refresh,
          },
          source: "external_cache",
        }
      }
    }

    const codexApiKey = normalizeString(cache?.OPENAI_API_KEY)
    if (authMode === "api" && codexApiKey) {
      return {
        method: "api-key",
        credential: {
          kind: "api_key",
          apiKey: codexApiKey,
          updatedAt: cache?.last_refresh,
        },
        source: "external_cache",
      }
    }
  }

  return undefined
}

function makeDescriptor(
  method: string,
  credential: Auth.CredentialRecord,
  source: Auth.ProviderCredentialDescriptor["source"],
): Auth.ProviderCredentialDescriptor {
  if (credential.kind === "api_key") {
    return {
      method,
      kind: "api_key",
      source,
      configured: true,
      label: credential.label,
    }
  }

  return {
    method,
    kind: "oauth_session",
    source,
    configured: true,
    expiresAt: credential.expiresAt,
    email: credential.email,
    planType: credential.planType,
    planLabel: credential.planLabel,
    subscription: credential.subscription,
    entitlements: credential.entitlements,
    workspaceID: credential.workspaceID,
    workspaceName: credential.workspaceName,
    balanceMicrocents: credential.balanceMicrocents,
    currency: credential.currency,
    rechargeUrl: credential.rechargeUrl,
    label: credential.email ?? credential.workspaceName ?? credential.planType,
  }
}

async function buildProviderAuthState(
  providerID: string,
  fallbacks: ProviderAuthFallbacks = {},
): Promise<ProviderAuthState> {
  const capabilities = getCapabilities(providerID)
  const record = await Auth.getProviderRecord(providerID)
  const flow = getLatestProviderFlow(providerID)
  const fallback = await buildFallbackCredential(providerID, fallbacks)
  const credentials = await Auth.listCredentialDescriptors(providerID)
  if (fallback && !credentials.some((item) => item.method === fallback.method && item.source === fallback.source)) {
    credentials.push(makeDescriptor(fallback.method, fallback.credential, fallback.source))
  }

  const activeStored = record?.activeMethod ? record.credentials[record.activeMethod] : undefined
  const activeMethod = record?.activeMethod ?? fallback?.method
  const activeCredential = activeStored ?? fallback?.credential
  const activeSource: Auth.ProviderCredentialDescriptor["source"] = activeStored ? "credential_store" : fallback?.source ?? "credential_store"
  const expired =
    activeCredential?.kind === "oauth_session" ? activeCredential.expiresAt <= now() : false

  let status: ProviderAuthState["status"] = "not_connected"
  if (flow && !["connected", "cancelled", "expired", "error"].includes(flow.status)) status = "pending"
  else if (activeCredential && expired) status = "expired"
  else if (activeCredential) status = "connected"
  else if (record?.lastError) status = "error"

  const connectionLabel =
    flow && status === "pending"
      ? flow.connectionLabel ?? `Waiting for ${methodLabel(providerID, flow.method)}`
      : connectionLabelForCredential(providerID, activeMethod, activeCredential, activeSource)

  return {
    providerID,
    scope: "global",
    activeMethod: activeMethod ?? undefined,
    status,
    connectionLabel,
    lastError: record?.lastError ?? undefined,
    expiresAt: activeCredential?.kind === "oauth_session" ? activeCredential.expiresAt : undefined,
    account: activeCredential?.kind === "oauth_session" ? summarizeOAuthAccount(activeCredential) : undefined,
    capabilities,
    credentials,
    flow: flow ? flowPublicView(flow) : undefined,
  }
}

function parseOpenAIIdToken(idToken: string | undefined) {
  const payload = decodeJwtPayload(idToken ?? "")
  const auth = payload?.["https://api.openai.com/auth"]
  const profile = payload?.["https://api.openai.com/profile"]
  const authRecord = auth && typeof auth === "object" ? (auth as Record<string, unknown>) : {}
  const profileRecord = profile && typeof profile === "object" ? (profile as Record<string, unknown>) : {}

  return {
    accountID: normalizeString(authRecord.chatgpt_account_id),
    userID: normalizeString(authRecord.chatgpt_user_id) ?? normalizeString(authRecord.user_id),
    email: normalizeString(payload?.email) ?? normalizeString(profileRecord.email),
    planType: normalizeString(authRecord.chatgpt_plan_type),
    workspaceID: normalizeString(authRecord.chatgpt_workspace_id),
    workspaceName: normalizeString(authRecord.chatgpt_workspace_name),
  }
}

function computeTokenExpiry(input: { accessToken?: string; idToken?: string; expiresIn?: unknown }) {
  const explicit = parseNumeric(input.expiresIn)
  if (explicit && explicit > 0) {
    return now() + explicit * 1000
  }

  return readJwtExpiry(input.accessToken) ?? readJwtExpiry(input.idToken) ?? now() + DEFAULT_TOKEN_TTL_MS
}

function normalizeAnyboxRootURL(baseURL?: string) {
  return AnyboxHTTP.normalizeAnyboxRootURL(baseURL)
}

function normalizeAnyboxApiURL(baseURL?: string) {
  return AnyboxHTTP.normalizeAnyboxApiURL(baseURL)
}

function anyboxURL(baseURL: string | undefined, pathname: string) {
  return AnyboxHTTP.anyboxURL(baseURL, pathname)
}

function readAnyboxAccount(payload: unknown) {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
  const account =
    record.account && typeof record.account === "object"
      ? (record.account as Record<string, unknown>)
      : record.user && typeof record.user === "object"
        ? (record.user as Record<string, unknown>)
        : record
  const workspace =
    account.workspace && typeof account.workspace === "object"
      ? (account.workspace as Record<string, unknown>)
      : record.workspace && typeof record.workspace === "object"
        ? (record.workspace as Record<string, unknown>)
        : {}
  const billing =
    account.billing && typeof account.billing === "object"
      ? (account.billing as Record<string, unknown>)
      : record.billing && typeof record.billing === "object"
        ? (record.billing as Record<string, unknown>)
        : {}
  const subscription = readAnyboxSubscription(readNestedRecordValue(record, account, "subscription"))
  const entitlements = readAnyboxEntitlements(readNestedRecordValue(record, account, "entitlements"))
  const planType =
    normalizeString(account.plan_type) ??
    normalizeString(account.planType) ??
    normalizeString(record.plan_type) ??
    normalizeString(record.planType) ??
    subscription?.planCode

  return {
    accountID: normalizeString(account.account_id) ?? normalizeString(account.accountID) ?? normalizeString(account.id),
    userID: normalizeString(account.user_id) ?? normalizeString(account.userID) ?? normalizeString(account.id),
    email: normalizeString(account.email),
    planType,
    planLabel:
      normalizeString(account.plan_label) ??
      normalizeString(account.planLabel) ??
      normalizeString(record.plan_label) ??
      normalizeString(record.planLabel) ??
      (planType ? formatAnyboxPlanLabel(planType) : undefined),
    subscription,
    entitlements,
    workspaceID:
      normalizeString(account.workspace_id) ??
      normalizeString(account.workspaceID) ??
      normalizeString(workspace.id),
    workspaceName:
      normalizeString(account.workspace_name) ??
      normalizeString(account.workspaceName) ??
      normalizeString(workspace.name),
    balanceMicrocents:
      parseNumeric(account.balance_microcents) ??
      parseNumeric(account.balanceMicrocents) ??
      parseNumeric(billing.balance_microcents) ??
      parseNumeric(billing.balanceMicrocents),
    currency:
      normalizeString(account.currency) ??
      normalizeString(billing.currency),
    rechargeUrl:
      normalizeString(account.recharge_url) ??
      normalizeString(account.rechargeUrl) ??
      normalizeString(billing.recharge_url) ??
      normalizeString(billing.rechargeUrl),
  }
}

function readNestedRecordValue(record: Record<string, unknown>, account: Record<string, unknown>, key: string) {
  return key in account ? account[key] : record[key]
}

function readAnyboxSubscription(value: unknown): Auth.WorkspaceSubscription | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const record = readOptionalRecord(value)
  if (!record) return undefined
  const planCode = normalizeString(record.planCode) ?? normalizeString(record.plan_code)
  const status = normalizeString(record.status)
  if (!planCode && !status) return undefined
  return {
    id: normalizeString(record.id) ?? null,
    workspaceId: normalizeString(record.workspaceId) ?? normalizeString(record.workspace_id),
    planCode,
    status,
    source: normalizeString(record.source) ?? null,
    currentPeriodStart: parseTimestamp(record.currentPeriodStart) ?? parseTimestamp(record.current_period_start) ?? null,
    currentPeriodEnd: parseTimestamp(record.currentPeriodEnd) ?? parseTimestamp(record.current_period_end) ?? null,
    cancelAtPeriodEnd: parseBoolean(record.cancelAtPeriodEnd) ?? parseBoolean(record.cancel_at_period_end) ?? false,
  }
}

function readAnyboxEntitlements(value: unknown): Auth.WorkspaceEntitlements | undefined {
  const record = readOptionalRecord(value)
  if (!record) return undefined
  const entitlements: Auth.WorkspaceEntitlements = {}
  const modelGatewayEnabled = parseBoolean(record.modelGatewayEnabled) ?? parseBoolean(record.model_gateway_enabled)
  const relayEnabled = parseBoolean(record.relayEnabled) ?? parseBoolean(record.relay_enabled)
  const maxDesktopDevices = parseNumeric(record.maxDesktopDevices) ?? parseNumeric(record.max_desktop_devices)
  const maxMobileDevices = parseNumeric(record.maxMobileDevices) ?? parseNumeric(record.max_mobile_devices)
  if (modelGatewayEnabled !== undefined) entitlements.modelGatewayEnabled = modelGatewayEnabled
  if (relayEnabled !== undefined) entitlements.relayEnabled = relayEnabled
  if (maxDesktopDevices !== undefined) entitlements.maxDesktopDevices = maxDesktopDevices
  if (maxMobileDevices !== undefined) entitlements.maxMobileDevices = maxMobileDevices
  return Object.keys(entitlements).length ? entitlements : undefined
}

function formatAnyboxPlanLabel(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1).toLocaleLowerCase()}`)
    .join(" ")
}

function readOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function parseAnyboxIdToken(idToken: string | undefined) {
  const payload = decodeJwtPayload(idToken ?? "")
  if (!payload) return readAnyboxAccount(undefined)

  const auth =
    readOptionalRecord(payload["https://anybox.com.cn/auth"]) ??
    readOptionalRecord(payload["https://anybox.com/auth"]) ??
    readOptionalRecord(payload.anybox) ??
    {}
  const profile =
    readOptionalRecord(payload["https://anybox.com.cn/profile"]) ??
    readOptionalRecord(payload.profile) ??
    {}

  return readAnyboxAccount({
    account: {
      account_id: auth.anybox_account_id ?? auth.account_id,
      user_id: auth.anybox_user_id ?? auth.user_id ?? payload.sub,
      id: payload.sub,
      email: payload.email ?? profile.email,
      name: profile.name ?? payload.name,
      plan_type: auth.anybox_plan_type ?? auth.plan_type,
      plan_label: auth.anybox_plan_label ?? auth.plan_label,
      subscription: auth.subscription,
      entitlements: auth.entitlements,
      workspace_id: auth.anybox_workspace_id ?? auth.workspace_id,
      workspace_name: auth.anybox_workspace_name ?? auth.workspace_name,
      balance_microcents: auth.balance_microcents,
      currency: auth.currency,
      recharge_url: auth.recharge_url,
    },
    workspace: auth.workspace,
    billing: auth.billing,
  })
}

function mergeAnyboxAccount(
  primary: ReturnType<typeof readAnyboxAccount>,
  secondary: ReturnType<typeof readAnyboxAccount>,
  fallback?: Partial<Auth.OAuthSessionCredential>,
) {
  return {
    accountID: primary.accountID ?? secondary.accountID ?? fallback?.accountID,
    userID: primary.userID ?? secondary.userID ?? fallback?.userID,
    email: primary.email ?? secondary.email ?? fallback?.email,
    planType: primary.planType ?? secondary.planType ?? fallback?.planType,
    planLabel: primary.planLabel ?? secondary.planLabel ?? fallback?.planLabel,
    subscription: primary.subscription ?? secondary.subscription ?? fallback?.subscription,
    entitlements: primary.entitlements ?? secondary.entitlements ?? fallback?.entitlements,
    workspaceID: primary.workspaceID ?? secondary.workspaceID ?? fallback?.workspaceID,
    workspaceName: primary.workspaceName ?? secondary.workspaceName ?? fallback?.workspaceName,
    balanceMicrocents: primary.balanceMicrocents ?? secondary.balanceMicrocents ?? fallback?.balanceMicrocents,
    currency: primary.currency ?? secondary.currency ?? fallback?.currency,
    rechargeUrl: primary.rechargeUrl ?? secondary.rechargeUrl ?? fallback?.rechargeUrl,
  }
}

function readAnyboxTokenAccount(
  payload: Record<string, unknown>,
  idToken: string | undefined,
  fallback?: Partial<Auth.OAuthSessionCredential>,
) {
  return mergeAnyboxAccount(readAnyboxAccount(payload), parseAnyboxIdToken(idToken), fallback)
}

async function ensureAnyboxOkResponse(
  response: Response,
  prefix: string,
  url: string,
) {
  if (response.ok) return response
  const payload = await parseJsonResponse(response)
  const detail = errorMessageFromPayload(payload) ?? normalizeString(await response.text().catch(() => "")) ?? `HTTP ${response.status}`
  throw new AnyboxHTTP.AnyboxHTTPError(
    "http_error",
    `${prefix}: ${detail}`,
    await AnyboxHTTP.createAnyboxDiagnostics(url),
  )
}

async function parseJsonResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) return undefined
  return await response.json().catch(() => undefined)
}

function errorMessageFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined
  const record = payload as Record<string, unknown>
  const direct = normalizeString(record.message) ?? normalizeString(record.error_description)
  if (direct) return direct

  const error = record.error
  if (typeof error === "string") return normalizeString(error)
  if (error && typeof error === "object") {
    const nested = error as Record<string, unknown>
    return normalizeString(nested.message) ?? normalizeString(nested.error)
  }

  return undefined
}

async function ensureOkResponse(response: Response, prefix: string) {
  if (response.ok) return response
  const payload = await parseJsonResponse(response)
  const detail = errorMessageFromPayload(payload) ?? normalizeString(await response.text().catch(() => "")) ?? `HTTP ${response.status}`
  throw new Error(`${prefix}: ${detail}`)
}

function buildOpenAIBrowserAuthorizeURL(input: {
  redirectURI: string
  codeChallenge: string
  state: string
}) {
  const url = new URL(`${OPENAI_AUTH_ISSUER}/oauth/authorize`)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", OPENAI_OAUTH_CLIENT_ID)
  url.searchParams.set("redirect_uri", input.redirectURI)
  url.searchParams.set("scope", OPENAI_OAUTH_SCOPE)
  url.searchParams.set("code_challenge", input.codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("id_token_add_organizations", "true")
  url.searchParams.set("codex_cli_simplified_flow", "true")
  url.searchParams.set("state", input.state)
  url.searchParams.set("originator", OPENAI_ORIGINATOR)
  return url.toString()
}

async function exchangeOpenAIAuthorizationCode(input: {
  authorizationCode: string
  codeVerifier: string
  redirectURI: string
}) {
  const body = new URLSearchParams()
  body.set("grant_type", "authorization_code")
  body.set("client_id", OPENAI_OAUTH_CLIENT_ID)
  body.set("redirect_uri", input.redirectURI)
  body.set("code", input.authorizationCode)
  body.set("code_verifier", input.codeVerifier)

  const response = await fetch(`${OPENAI_AUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      originator: OPENAI_ORIGINATOR,
      "user-agent": OPENAI_ORIGINATOR,
    },
    body,
  })

  await ensureOkResponse(response, "OpenAI token exchange failed")
  return (await response.json()) as Record<string, unknown>
}

async function refreshOpenAISession(credential: Auth.OAuthSessionCredential) {
  const body = new URLSearchParams()
  body.set("grant_type", "refresh_token")
  body.set("client_id", OPENAI_OAUTH_CLIENT_ID)
  body.set("refresh_token", credential.refreshToken)

  const response = await fetch(`${OPENAI_AUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      originator: OPENAI_ORIGINATOR,
      "user-agent": OPENAI_ORIGINATOR,
    },
    body,
  })

  await ensureOkResponse(response, "OpenAI token refresh failed")
  const payload = (await response.json()) as Record<string, unknown>
  const parsed = parseOpenAIIdToken(normalizeString(payload.id_token) ?? credential.idToken)

  return {
    kind: "oauth_session",
    accessToken: normalizeString(payload.access_token) ?? credential.accessToken,
    refreshToken: normalizeString(payload.refresh_token) ?? credential.refreshToken,
    expiresAt: computeTokenExpiry({
      accessToken: normalizeString(payload.access_token) ?? credential.accessToken,
      idToken: normalizeString(payload.id_token) ?? credential.idToken,
      expiresIn: payload.expires_in,
    }),
    tokenType: normalizeString(payload.token_type) ?? credential.tokenType,
    idToken: normalizeString(payload.id_token) ?? credential.idToken,
    scope: normalizeString(payload.scope) ?? credential.scope,
    accountID: parsed.accountID ?? credential.accountID,
    userID: parsed.userID ?? credential.userID,
    email: parsed.email ?? credential.email,
    planType: parsed.planType ?? credential.planType,
    planLabel: credential.planLabel,
    subscription: credential.subscription,
    entitlements: credential.entitlements,
    workspaceID: parsed.workspaceID ?? credential.workspaceID,
    workspaceName: parsed.workspaceName ?? credential.workspaceName,
    originator: credential.originator ?? OPENAI_ORIGINATOR,
    createdAt: credential.createdAt,
  } satisfies Auth.OAuthSessionCredential
}

async function saveOpenAITokens(method: string, payload: Record<string, unknown>) {
  const idToken = normalizeString(payload.id_token)
  const parsed = parseOpenAIIdToken(idToken)
  const credential: Auth.OAuthSessionCredential = {
    kind: "oauth_session",
    accessToken: normalizeString(payload.access_token) ?? "",
    refreshToken: normalizeString(payload.refresh_token) ?? "",
    expiresAt: computeTokenExpiry({
      accessToken: normalizeString(payload.access_token),
      idToken,
      expiresIn: payload.expires_in,
    }),
    tokenType: normalizeString(payload.token_type),
    idToken,
    scope: normalizeString(payload.scope),
    accountID: parsed.accountID,
    userID: parsed.userID,
    email: parsed.email,
    planType: parsed.planType,
    workspaceID: parsed.workspaceID,
    workspaceName: parsed.workspaceName,
    originator: OPENAI_ORIGINATOR,
  }

  await Auth.setProviderCredential(OPENAI_PROVIDER_ID, method, credential, {
    activate: true,
    lastError: null,
  })

  return credential
}

function buildAnyboxBrowserAuthorizeURL(input: {
  baseURL?: string
  redirectURI: string
  codeChallenge: string
  state: string
  prompt?: ProviderAuthPrompt
}) {
  const url = new URL(anyboxURL(input.baseURL, "/api/agent/oauth/authorize"))
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", ANYBOX_CLIENT_ID)
  url.searchParams.set("redirect_uri", input.redirectURI)
  url.searchParams.set("scope", ANYBOX_OAUTH_SCOPE)
  url.searchParams.set("state", input.state)
  url.searchParams.set("code_challenge", input.codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  if (input.prompt) {
    url.searchParams.set("prompt", input.prompt)
  }
  return url.toString()
}

async function exchangeAnyboxAuthorizationCode(input: {
  baseURL?: string
  authorizationCode: string
  codeVerifier: string
  redirectURI: string
}) {
  const body = new URLSearchParams()
  body.set("grant_type", "authorization_code")
  body.set("client_id", ANYBOX_CLIENT_ID)
  body.set("code", input.authorizationCode)
  body.set("code_verifier", input.codeVerifier)
  body.set("redirect_uri", input.redirectURI)

  const url = anyboxURL(input.baseURL, "/api/agent/oauth/token")
  const response = await AnyboxHTTP.anyboxFetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  })

  await ensureAnyboxOkResponse(response, "Anybox token exchange failed", url)
  return (await response.json()) as Record<string, unknown>
}

async function refreshAnyboxSession(
  credential: Auth.OAuthSessionCredential,
  baseURL?: string,
) {
  const resolvedBaseURL = baseURL ?? credential.originator
  const body = new URLSearchParams()
  body.set("grant_type", "refresh_token")
  body.set("client_id", ANYBOX_CLIENT_ID)
  body.set("refresh_token", credential.refreshToken)

  const url = anyboxURL(resolvedBaseURL, "/api/agent/oauth/refresh")
  const response = await AnyboxHTTP.anyboxFetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  })

  await ensureAnyboxOkResponse(response, "Anybox token refresh failed", url)
  const payload = (await response.json()) as Record<string, unknown>
  const accessToken = normalizeString(payload.access_token) ?? credential.accessToken
  const idToken = normalizeString(payload.id_token) ?? credential.idToken
  const account = readAnyboxTokenAccount(payload, idToken, credential)

  return {
    kind: "oauth_session",
    accessToken,
    refreshToken: normalizeString(payload.refresh_token) ?? credential.refreshToken,
    expiresAt: computeTokenExpiry({
      accessToken,
      idToken,
      expiresIn: payload.expires_in,
    }),
    tokenType: normalizeString(payload.token_type) ?? credential.tokenType,
    idToken,
    scope: normalizeString(payload.scope) ?? credential.scope,
    accountID: account.accountID,
    userID: account.userID,
    email: account.email,
    planType: account.planType,
    planLabel: account.planLabel,
    subscription: account.subscription,
    entitlements: account.entitlements,
    workspaceID: account.workspaceID,
    workspaceName: account.workspaceName,
    balanceMicrocents: account.balanceMicrocents,
    currency: account.currency,
    rechargeUrl: account.rechargeUrl,
    originator: normalizeAnyboxRootURL(resolvedBaseURL),
    createdAt: credential.createdAt,
  } satisfies Auth.OAuthSessionCredential
}

async function saveAnyboxTokens(
  method: string,
  payload: Record<string, unknown>,
  baseURL?: string,
) {
  const accessToken = normalizeString(payload.access_token) ?? ""
  const idToken = normalizeString(payload.id_token)
  const account = readAnyboxTokenAccount(payload, idToken)

  const credential: Auth.OAuthSessionCredential = {
    kind: "oauth_session",
    accessToken,
    refreshToken: normalizeString(payload.refresh_token) ?? "",
    expiresAt: computeTokenExpiry({
      accessToken,
      idToken,
      expiresIn: payload.expires_in,
    }),
    tokenType: normalizeString(payload.token_type),
    idToken,
    scope: normalizeString(payload.scope),
    accountID: account.accountID,
    userID: account.userID,
    email: account.email,
    planType: account.planType,
    planLabel: account.planLabel,
    subscription: account.subscription,
    entitlements: account.entitlements,
    workspaceID: account.workspaceID,
    workspaceName: account.workspaceName,
    balanceMicrocents: account.balanceMicrocents,
    currency: account.currency,
    rechargeUrl: account.rechargeUrl,
    originator: normalizeAnyboxRootURL(baseURL),
  }

  await Auth.setProviderCredential(ANYBOX_PROVIDER_ID, method, credential, {
    activate: true,
    lastError: null,
  })

  return credential
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`,
    ).join(",")}}`
  }

  return JSON.stringify(value) ?? "null"
}

function genericOAuthRegistrationCacheKey(oauth: GenericOAuthProviderConfig) {
  if (!oauth.registration) return undefined
  return createHash("sha256")
    .update(stableJsonStringify({
      registrationURL: oauth.registration.registrationURL,
      metadata: oauth.registration.metadata ?? {},
      scopes: oauth.scopes,
    }))
    .digest("hex")
}

function normalizeMetadataStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
  }

  const single = normalizeString(value)
  return single ? [single] : []
}

function normalizeUnixSeconds(value: unknown) {
  const numeric = parseNumeric(value)
  if (numeric === undefined) return undefined
  return Math.max(0, Math.floor(numeric))
}

function normalizeTokenEndpointAuthMethod(
  value: unknown,
  context: string,
): GenericOAuthTokenEndpointAuthMethod | undefined {
  const method = normalizeString(value)
  if (!method) return undefined
  if (method === "none" || method === "client_secret_post" || method === "client_secret_basic") {
    return method
  }

  throw new Error(`${context} uses unsupported token_endpoint_auth_method '${method}'.`)
}

function isRegistrationClientSecretExpired(registration: Auth.OAuthClientRegistrationRecord) {
  if (!registration.clientSecret || registration.clientSecretExpiresAt === undefined) return false
  if (registration.clientSecretExpiresAt === 0) return false
  return registration.clientSecretExpiresAt * 1000 <= now() + TOKEN_REFRESH_THRESHOLD_MS
}

function isUsableOAuthClientRegistration(
  registration: Auth.OAuthClientRegistrationRecord,
  redirectURI?: string,
) {
  if (isRegistrationClientSecretExpired(registration)) return false
  if (!redirectURI) return true
  return registration.redirectURIs.length === 0 || registration.redirectURIs.includes(redirectURI)
}

function buildGenericOAuthClientRegistrationMetadata(input: {
  oauth: GenericOAuthProviderConfig
  redirectURI: string
}) {
  const metadata: Record<string, unknown> = {
    ...(input.oauth.registration?.metadata ?? {}),
  }

  const redirectURIs = new Set(normalizeMetadataStringArray(metadata.redirect_uris))
  redirectURIs.add(input.redirectURI)
  metadata.redirect_uris = [...redirectURIs]

  if (!normalizeString(metadata.scope)) {
    metadata.scope = input.oauth.scopes.join(" ")
  }

  if (normalizeMetadataStringArray(metadata.grant_types).length === 0) {
    metadata.grant_types = ["authorization_code", "refresh_token"]
  }

  if (normalizeMetadataStringArray(metadata.response_types).length === 0) {
    metadata.response_types = ["code"]
  }

  if (!normalizeString(metadata.token_endpoint_auth_method)) {
    metadata.token_endpoint_auth_method = "none"
  }

  if (!normalizeString(metadata.client_name) && input.oauth.label) {
    metadata.client_name = input.oauth.label
  }

  return metadata
}

function oauthConfigForClientRegistration(
  oauth: GenericOAuthProviderConfig,
  registration: Auth.OAuthClientRegistrationRecord,
): GenericOAuthProviderConfig & { clientID: string } {
  const tokenEndpointAuthMethod =
    normalizeTokenEndpointAuthMethod(registration.tokenEndpointAuthMethod, "Stored OAuth client registration") ??
    oauth.tokenEndpointAuthMethod

  return {
    ...oauth,
    clientID: registration.clientID,
    clientSecret: registration.clientSecret,
    tokenEndpointAuthMethod,
  }
}

async function registerGenericOAuthClient(input: {
  providerID: string
  cacheKey: string
  oauth: GenericOAuthProviderConfig
  redirectURI: string
}) {
  const registration = input.oauth.registration
  if (!registration) {
    throw new Error("OAuth dynamic client registration is not configured.")
  }

  const metadata = buildGenericOAuthClientRegistrationMetadata({
    oauth: input.oauth,
    redirectURI: input.redirectURI,
  })
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  }
  if (registration.initialAccessToken) {
    headers.authorization = `Bearer ${registration.initialAccessToken}`
  }

  const response = await fetch(registration.registrationURL, {
    method: "POST",
    headers,
    body: JSON.stringify(metadata),
  })
  await ensureOkResponse(response, "OAuth client registration failed")
  const payload = (await response.json()) as Record<string, unknown>
  const clientID = normalizeString(payload.client_id)
  if (!clientID) {
    throw new Error("OAuth client registration response did not include a client_id.")
  }

  const clientSecret = normalizeString(payload.client_secret)
  const tokenEndpointAuthMethod =
    normalizeTokenEndpointAuthMethod(payload.token_endpoint_auth_method, "OAuth client registration response") ??
    normalizeTokenEndpointAuthMethod(metadata.token_endpoint_auth_method, "OAuth client registration metadata") ??
    (clientSecret ? "client_secret_basic" : "none")
  const record: Auth.OAuthClientRegistrationRecord = {
    clientID,
    clientSecret,
    clientIDIssuedAt: normalizeUnixSeconds(payload.client_id_issued_at),
    clientSecretExpiresAt: normalizeUnixSeconds(payload.client_secret_expires_at),
    registrationAccessToken: normalizeString(payload.registration_access_token),
    registrationClientURI: normalizeString(payload.registration_client_uri),
    tokenEndpointAuthMethod,
    redirectURIs: normalizeMetadataStringArray(metadata.redirect_uris),
    scope: normalizeString(payload.scope) ?? normalizeString(metadata.scope),
    registrationURL: registration.registrationURL,
  }

  await Auth.setOAuthClientRegistration(input.providerID, input.cacheKey, record)
  return record
}

async function resolveGenericOAuthClient(input: {
  providerID: string
  method: string
  oauth: GenericOAuthProviderConfig
  redirectURI?: string
}): Promise<GenericOAuthProviderConfig & { clientID: string }> {
  if (input.oauth.clientID) {
    return {
      ...input.oauth,
      clientID: input.oauth.clientID,
    }
  }

  const cacheKey = genericOAuthRegistrationCacheKey(input.oauth)
  if (!cacheKey || !input.oauth.registration) {
    throw new Error("OAuth client ID is missing and dynamic client registration is not configured.")
  }

  const existing = await Auth.getOAuthClientRegistration(input.providerID, cacheKey)
  if (existing && isUsableOAuthClientRegistration(existing, input.redirectURI)) {
    return oauthConfigForClientRegistration(input.oauth, existing)
  }

  if (!input.redirectURI) {
    throw new Error("OAuth client registration is missing or expired. Reconnect this app connector.")
  }

  const registered = await registerGenericOAuthClient({
    providerID: input.providerID,
    cacheKey,
    oauth: input.oauth,
    redirectURI: input.redirectURI,
  })
  return oauthConfigForClientRegistration(input.oauth, registered)
}

function applyGenericOAuthClientAuthentication(input: {
  setBodyParam: (key: string, value: string) => void
  headers: Record<string, string>
  oauth: GenericOAuthProviderConfig & { clientID: string }
}) {
  const method = input.oauth.tokenEndpointAuthMethod ?? (input.oauth.clientSecret ? "client_secret_basic" : "none")

  if (method === "client_secret_basic") {
    if (!input.oauth.clientSecret) {
      throw new Error("OAuth token endpoint requires client_secret_basic but no client secret is available.")
    }
    input.headers.authorization = `Basic ${Buffer.from(`${input.oauth.clientID}:${input.oauth.clientSecret}`).toString("base64")}`
    return
  }

  input.setBodyParam("client_id", input.oauth.clientID)
  if (method === "client_secret_post") {
    if (!input.oauth.clientSecret) {
      throw new Error("OAuth token endpoint requires client_secret_post but no client secret is available.")
    }
    input.setBodyParam("client_secret", input.oauth.clientSecret)
  }
}

function buildGenericOAuthAuthorizeURL(input: {
  oauth: GenericOAuthProviderConfig & { clientID: string }
  redirectURI: string
  codeChallenge: string
  state: string
}) {
  const url = new URL(input.oauth.authorizationURL)
  url.searchParams.set("client_id", input.oauth.clientID)
  url.searchParams.set("state", input.state)

  if (input.oauth.dialect === "bilibili") {
    url.searchParams.set("gourl", input.redirectURI)
  } else {
    url.searchParams.set("response_type", "code")
    url.searchParams.set("redirect_uri", input.redirectURI)
    url.searchParams.set("scope", input.oauth.scopes.join(" "))
    url.searchParams.set("code_challenge", input.codeChallenge)
    url.searchParams.set("code_challenge_method", "S256")
  }

  for (const [key, value] of Object.entries(input.oauth.authorizationParams ?? {})) {
    url.searchParams.set(key, value)
  }

  return url.toString()
}

async function exchangeGenericOAuthAuthorizationCode(input: {
  oauth: GenericOAuthProviderConfig & { clientID: string }
  authorizationCode: string
  codeVerifier: string
  redirectURI: string
}) {
  const request = buildGenericOAuthTokenRequest(input.oauth)
  for (const [key, value] of Object.entries(input.oauth.tokenParams ?? {})) {
    request.setBodyParam(key, value)
  }
  request.setBodyParam("grant_type", "authorization_code")
  request.setBodyParam("code", input.authorizationCode)
  if (input.oauth.dialect !== "bilibili") {
    request.setBodyParam("redirect_uri", input.redirectURI)
    request.setBodyParam("code_verifier", input.codeVerifier)
  }
  applyGenericOAuthClientAuthentication({
    setBodyParam: request.setBodyParam,
    headers: request.headers,
    oauth: input.oauth,
  })

  const response = await fetch(input.oauth.tokenURL, {
    method: "POST",
    headers: request.headers,
    body: request.body(),
  })

  return await readGenericOAuthTokenResponse(response, "OAuth token exchange failed")
}

function buildGenericOAuthTokenRequest(oauth: GenericOAuthProviderConfig) {
  const format = oauth.tokenRequestFormat ?? "form"
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": format === "json" ? "application/json" : "application/x-www-form-urlencoded",
  }

  if (format === "json") {
    const body: Record<string, string> = {}
    return {
      headers,
      setBodyParam: (key: string, value: string) => {
        body[key] = value
      },
      body: () => JSON.stringify(body),
    }
  }

  const body = new URLSearchParams()
  return {
    headers,
    setBodyParam: (key: string, value: string) => body.set(key, value),
    body: () => body,
  }
}

async function readGenericOAuthTokenResponse(response: Response, context: string) {
  await ensureOkResponse(response, context)
  const payload = (await response.json()) as Record<string, unknown>
  const code = parseNumeric(payload.code)
  if (code !== undefined && code !== 0) {
    throw new Error(errorMessageFromPayload(payload) ?? `${context}: OAuth provider returned code ${code}.`)
  }

  if (!normalizeString(payload.access_token) && payload.data && typeof payload.data === "object") {
    return payload.data as Record<string, unknown>
  }

  return payload
}

function readGenericOAuthTokenAccount(
  payload: Record<string, unknown>,
  idToken?: string,
  fallback?: Auth.OAuthSessionCredential,
) {
  const jwtPayload = idToken ? decodeJwtPayload(idToken) : undefined
  const subject = normalizeString(jwtPayload?.sub) ?? fallback?.userID ?? fallback?.accountID
  return {
    accountID: normalizeString(payload.account_id) ?? subject,
    userID: normalizeString(payload.user_id) ?? subject,
    email: normalizeString(jwtPayload?.email) ?? normalizeString(payload.email) ?? fallback?.email,
  }
}

function parseOAuthScopeSet(scope?: string) {
  return new Set((scope ?? "").split(/\s+/).map((item) => item.trim()).filter(Boolean))
}

function readGenericOAuthScope(payload: Record<string, unknown>, fallback?: string) {
  const scope = normalizeString(payload.scope)
  if (scope) return scope

  if (Array.isArray(payload.scopes)) {
    const scopes = payload.scopes.map(normalizeString).filter((item): item is string => Boolean(item))
    if (scopes.length > 0) return scopes.join(" ")
  }

  return fallback
}

function computeGenericOAuthTokenExpiry(
  payload: Record<string, unknown>,
  oauth: GenericOAuthProviderConfig | undefined,
  input: { accessToken?: string; idToken?: string },
) {
  const explicit = parseNumeric(payload.expires_in)
  if (oauth?.dialect === "bilibili" && explicit && explicit > 0) {
    return explicit * 1000
  }

  return computeTokenExpiry({
    ...input,
    expiresIn: payload.expires_in,
  })
}

function requiredGenericOAuthScopes(oauth?: GenericOAuthProviderConfig) {
  return (oauth?.scopes ?? []).filter((scope) => !OPTIONAL_IDENTITY_OAUTH_SCOPES.has(scope))
}

function assertGenericOAuthScopes(scope: string | undefined, oauth?: GenericOAuthProviderConfig) {
  if (!scope || !oauth) return

  const granted = parseOAuthScopeSet(scope)
  const missing = requiredGenericOAuthScopes(oauth).filter((requiredScope) => !granted.has(requiredScope))
  if (missing.length === 0) return

  throw new Error(
    `OAuth token is missing required scope${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Reconnect and grant the requested permissions.`,
  )
}

function buildGenericOAuthCredential(
  payload: Record<string, unknown>,
  oauth?: GenericOAuthProviderConfig,
  fallback?: Auth.OAuthSessionCredential,
): Auth.OAuthSessionCredential {
  const accessToken = normalizeString(payload.access_token) ?? fallback?.accessToken ?? ""
  const refreshToken = normalizeString(payload.refresh_token) ?? fallback?.refreshToken ?? ""
  const idToken = normalizeString(payload.id_token) ?? fallback?.idToken
  const account = readGenericOAuthTokenAccount(payload, idToken, fallback)
  const scope = readGenericOAuthScope(payload, fallback?.scope)

  if (!accessToken) {
    throw new Error("OAuth token response did not include an access token.")
  }

  if (!refreshToken) {
    throw new Error("OAuth token response did not include a refresh token.")
  }

  assertGenericOAuthScopes(scope, oauth)

  return {
    kind: "oauth_session",
    accessToken,
    refreshToken,
    expiresAt: computeGenericOAuthTokenExpiry(payload, oauth, {
      accessToken,
      idToken,
    }),
    tokenType: normalizeString(payload.token_type) ?? fallback?.tokenType,
    idToken,
    scope,
    accountID: account.accountID,
    userID: account.userID,
    email: account.email,
    createdAt: fallback?.createdAt,
  }
}

async function saveGenericOAuthTokens(
  providerID: string,
  method: string,
  payload: Record<string, unknown>,
  oauth?: GenericOAuthProviderConfig,
) {
  const credential = buildGenericOAuthCredential(payload, oauth)
  await Auth.setProviderCredential(providerID, method, credential, {
    activate: true,
    lastError: null,
  })
  return credential
}

export async function refreshGenericOAuthSession(
  credential: Auth.OAuthSessionCredential,
  oauth: GenericOAuthProviderConfig & { clientID: string },
) {
  const request = buildGenericOAuthTokenRequest(oauth)
  for (const [key, value] of Object.entries(oauth.tokenParams ?? {})) {
    request.setBodyParam(key, value)
  }
  request.setBodyParam("grant_type", "refresh_token")
  request.setBodyParam("refresh_token", credential.refreshToken)
  applyGenericOAuthClientAuthentication({
    setBodyParam: request.setBodyParam,
    headers: request.headers,
    oauth,
  })

  const response = await fetch(oauth.refreshURL ?? oauth.tokenURL, {
    method: "POST",
    headers: request.headers,
    body: request.body(),
  })

  const payload = await readGenericOAuthTokenResponse(response, "OAuth token refresh failed")
  return buildGenericOAuthCredential(payload, oauth, credential)
}

export async function resolveGenericOAuthCredential(
  providerID: string,
  method: string,
  oauth: GenericOAuthProviderConfig,
  options: { forceRefresh?: boolean } = {},
) {
  const credential = await Auth.getProviderCredential(providerID, method)
  if (credential?.kind !== "oauth_session") return undefined

  if (!options.forceRefresh && credential.expiresAt > now() + TOKEN_REFRESH_THRESHOLD_MS) {
    return credential
  }

  try {
    const resolvedOAuth = await resolveGenericOAuthClient({
      providerID,
      method,
      oauth,
    })
    const refreshed = await refreshGenericOAuthSession(credential, resolvedOAuth)
    await Auth.setProviderCredential(providerID, method, refreshed, {
      activate: true,
      lastError: null,
    })
    return refreshed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await Auth.setProviderLastError(providerID, message)
    log.warn("generic-oauth-session-refresh-failed", {
      providerID,
      method,
      message,
    })
    if (options.forceRefresh || credential.expiresAt <= now()) return undefined
    return credential
  }
}

async function revokeGenericOAuthSession(
  credential: Auth.OAuthSessionCredential,
  oauth: GenericOAuthProviderConfig & { clientID: string },
) {
  if (!oauth.revocationURL) return

  const body = new URLSearchParams()
  body.set("token", credential.refreshToken || credential.accessToken)
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  }
  applyGenericOAuthClientAuthentication({
    setBodyParam: (key, value) => body.set(key, value),
    headers,
    oauth,
  })
  await fetch(oauth.revocationURL, {
    method: "POST",
    headers,
    body,
  }).catch(() => undefined)
}

export async function deleteGenericOAuthSession(
  providerID: string,
  method: string,
  oauth?: GenericOAuthProviderConfig,
) {
  const previousRecord = await Auth.getProviderRecord(providerID)
  if (oauth && previousRecord?.credentials[method]?.kind === "oauth_session") {
    const resolvedOAuth = await resolveGenericOAuthClient({
      providerID,
      method,
      oauth,
    }).catch(() => undefined)
    if (resolvedOAuth) {
      await revokeGenericOAuthSession(previousRecord.credentials[method], resolvedOAuth)
    }
  }
  const removed = await Auth.removeProviderCredential(providerID, method)
  await Auth.setProviderLastError(providerID, null)
  return removed
}

async function revokeAnyboxSession(credential: Auth.OAuthSessionCredential) {
  await AnyboxHTTP.anyboxFetch(anyboxURL(credential.originator, "/api/agent/oauth/revoke"), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${credential.accessToken}`,
    },
    body: JSON.stringify({
      token: credential.refreshToken,
    }),
  }).catch(() => undefined)
}

async function startOpenAIBrowserFlow(input: ProviderFlowContext) {
  const capability = getCapability(input.providerID, input.method)
  if (!capability) throw new Error(`Provider '${input.providerID}' does not support auth method '${input.method}'`)

  const callbackServer = await ensureOpenAILocalCallbackServer()
  const id = createFlowID()
  const { codeChallenge, codeVerifier } = await createPkcePair()
  const state = createFlowID()
  const redirectURI = callbackServer.redirectURI
  const authorizationURL = buildOpenAIBrowserAuthorizeURL({
    redirectURI,
    codeChallenge,
    state,
  })

  const flow: InternalFlow = {
    id,
    providerID: input.providerID,
    method: input.method,
    kind: capability.kind,
    status: "waiting_user",
    startedAt: now(),
    updatedAt: now(),
    expiresAt: now() + OPENAI_FLOW_TIMEOUT_MS,
    authorizationURL,
    connectionLabel: `Waiting for ${capability.label}`,
    state,
    redirectURI,
    codeVerifier,
    timeoutHandle: setTimeout(() => {
      void expireOpenAIBrowserFlow(id)
    }, OPENAI_FLOW_TIMEOUT_MS),
  }

  upsertFlow(flow)
  return flowPublicView(flow)
}

async function startAnyboxBrowserFlow(input: ProviderFlowContext) {
  const capability = getCapability(input.providerID, input.method)
  if (!capability) throw new Error(`Provider '${input.providerID}' does not support auth method '${input.method}'`)

  const providerBaseURL = normalizeAnyboxRootURL(input.providerBaseURL)

  const callbackServer = await ensureOpenAILocalCallbackServer()
  const id = createFlowID()
  const { codeChallenge, codeVerifier } = await createPkcePair()
  const state = createFlowID()
  const redirectURI = callbackServer.redirectURI
  const authorizationURL = buildAnyboxBrowserAuthorizeURL({
    baseURL: providerBaseURL,
    redirectURI,
    codeChallenge,
    state,
    prompt: input.prompt,
  })

  const flow: InternalFlow = {
    id,
    providerID: input.providerID,
    method: input.method,
    kind: capability.kind,
    status: "waiting_user",
    startedAt: now(),
    updatedAt: now(),
    expiresAt: now() + OPENAI_FLOW_TIMEOUT_MS,
    authorizationURL,
    connectionLabel: `Waiting for ${capability.label}`,
    state,
    redirectURI,
    codeVerifier,
    providerBaseURL,
    timeoutHandle: setTimeout(() => {
      void expireOpenAIBrowserFlow(id)
    }, OPENAI_FLOW_TIMEOUT_MS),
  }

  upsertFlow(flow)
  return flowPublicView(flow)
}

export async function startGenericOAuthFlow(input: ProviderFlowContext & {
  oauth: GenericOAuthProviderConfig
}) {
  const callbackServer = await ensureOpenAILocalCallbackServer()
  const id = createFlowID()
  const { codeChallenge, codeVerifier } = await createPkcePair()
  const state = createFlowID()
  const redirectURI = callbackServer.redirectURI
  const oauth = await resolveGenericOAuthClient({
    providerID: input.providerID,
    method: input.method,
    oauth: input.oauth,
    redirectURI,
  })
  const authorizationURL = buildGenericOAuthAuthorizeURL({
    oauth,
    redirectURI,
    codeChallenge,
    state,
  })
  const label = oauth.label ?? input.method

  const flow: InternalFlow = {
    id,
    providerID: input.providerID,
    method: input.method,
    kind: "browser_oauth",
    status: "waiting_user",
    startedAt: now(),
    updatedAt: now(),
    expiresAt: now() + OPENAI_FLOW_TIMEOUT_MS,
    authorizationURL,
    connectionLabel: `Waiting for ${label}`,
    state,
    redirectURI,
    codeVerifier,
    genericOAuth: oauth,
    timeoutHandle: setTimeout(() => {
      void expireOpenAIBrowserFlow(id)
    }, OPENAI_FLOW_TIMEOUT_MS),
  }

  upsertFlow(flow)
  return flowPublicView(flow)
}

async function requestOpenAIDeviceCode() {
  const response = await fetch(`${OPENAI_DEVICE_AUTH_BASE_URL}/deviceauth/usercode`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      originator: OPENAI_ORIGINATOR,
      "user-agent": OPENAI_ORIGINATOR,
    },
    body: JSON.stringify({
      client_id: OPENAI_OAUTH_CLIENT_ID,
    }),
  })

  await ensureOkResponse(response, "OpenAI device code request failed")
  const payload = (await response.json()) as Record<string, unknown>

  return {
    deviceAuthID: normalizeString(payload.device_auth_id) ?? "",
    userCode: normalizeString(payload.user_code) ?? normalizeString(payload.usercode) ?? "",
    intervalSeconds: parseNumeric(payload.interval) ?? 5,
  }
}

async function pollOpenAIDeviceCode(flowID: string) {
  const flow = flowState.get(flowID)
  if (!flow || !flow.deviceAuthID || !flow.userCode) return

  const timeoutAt = flow.expiresAt ?? now() + OPENAI_FLOW_TIMEOUT_MS

  while (now() < timeoutAt) {
    if (flow.cancelSignal?.signal.aborted) {
      flow.status = "cancelled"
      flow.errorMessage = "Authentication cancelled."
      upsertFlow(flow)
      return
    }

    const response = await fetch(`${OPENAI_DEVICE_AUTH_BASE_URL}/deviceauth/token`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        originator: OPENAI_ORIGINATOR,
        "user-agent": OPENAI_ORIGINATOR,
      },
      body: JSON.stringify({
        device_auth_id: flow.deviceAuthID,
        user_code: flow.userCode,
      }),
      signal: flow.cancelSignal?.signal,
    }).catch((error) => {
      throw error instanceof Error ? error : new Error(String(error))
    })

    if (response.ok) {
      const payload = (await response.json()) as Record<string, unknown>
      const authorizationCode = normalizeString(payload.authorization_code)
      const codeVerifier = normalizeString(payload.code_verifier)
      if (!authorizationCode || !codeVerifier) {
        flow.status = "error"
        flow.errorMessage = "Device authorization response was incomplete."
        upsertFlow(flow)
        await Auth.setProviderLastError(flow.providerID, flow.errorMessage)
        return
      }

      flow.status = "authorizing"
      upsertFlow(flow)

      try {
        const tokens = await exchangeOpenAIAuthorizationCode({
          authorizationCode,
          codeVerifier,
          redirectURI: `${OPENAI_AUTH_ISSUER}/deviceauth/callback`,
        })
        const credential = await saveOpenAITokens(flow.method, tokens)
        flow.status = "connected"
        flow.connectionLabel = connectionLabelForCredential(flow.providerID, flow.method, credential)
        flow.account = summarizeOAuthAccount(credential)
        flow.errorMessage = undefined
        upsertFlow(flow)
      } catch (error) {
        flow.status = "error"
        flow.errorMessage = error instanceof Error ? error.message : String(error)
        upsertFlow(flow)
        await Auth.setProviderLastError(flow.providerID, flow.errorMessage)
      }
      return
    }

    if (response.status !== 403 && response.status !== 404) {
      const payload = await parseJsonResponse(response)
      flow.status = "error"
      flow.errorMessage = errorMessageFromPayload(payload) ?? `Device authorization failed (${response.status}).`
      upsertFlow(flow)
      await Auth.setProviderLastError(flow.providerID, flow.errorMessage)
      return
    }

    await Bun.sleep((flow.intervalSeconds ?? 5) * 1000)
  }

  flow.status = "expired"
  flow.errorMessage = "Device authorization timed out after 15 minutes."
  upsertFlow(flow)
  await Auth.setProviderLastError(flow.providerID, flow.errorMessage)
}

async function startOpenAIDeviceCodeFlow(input: ProviderFlowContext) {
  const capability = getCapability(input.providerID, input.method)
  if (!capability) throw new Error(`Provider '${input.providerID}' does not support auth method '${input.method}'`)

  const deviceCode = await requestOpenAIDeviceCode()
  const flow: InternalFlow = {
    id: createFlowID(),
    providerID: input.providerID,
    method: input.method,
    kind: capability.kind,
    status: "waiting_user",
    startedAt: now(),
    updatedAt: now(),
    expiresAt: now() + OPENAI_FLOW_TIMEOUT_MS,
    verificationURI: OPENAI_DEVICE_AUTH_VERIFICATION_URL,
    userCode: deviceCode.userCode,
    connectionLabel: `Waiting for ${capability.label}`,
    deviceAuthID: deviceCode.deviceAuthID,
    intervalSeconds: deviceCode.intervalSeconds,
    cancelSignal: new AbortController(),
  }

  upsertFlow(flow)
  void pollOpenAIDeviceCode(flow.id).catch(async (error) => {
    const current = flowState.get(flow.id)
    if (!current) return
    current.status = "error"
    current.errorMessage = error instanceof Error ? error.message : String(error)
    upsertFlow(current)
    await Auth.setProviderLastError(current.providerID, current.errorMessage)
  })
  return flowPublicView(flow)
}

export async function startProviderAuthFlow(input: ProviderFlowContext) {
  if (input.providerID === OPENAI_PROVIDER_ID && input.method === "chatgpt-browser") {
    return await startOpenAIBrowserFlow(input)
  }

  if (input.providerID === OPENAI_PROVIDER_ID && input.method === "chatgpt-headless") {
    return await startOpenAIDeviceCodeFlow(input)
  }

  if (input.providerID === ANYBOX_PROVIDER_ID && input.method === ANYBOX_BROWSER_METHOD) {
    return await startAnyboxBrowserFlow(input)
  }

  throw new Error(`Provider '${input.providerID}' does not support interactive auth flow '${input.method}'`)
}

export async function getProviderFlow(providerID: string, flowID: string) {
  const flow = flowState.get(flowID)
  if (!flow || flow.providerID !== providerID) return undefined
  return flowPublicView(flow)
}

export async function cancelProviderAuthFlow(providerID: string, flowID: string) {
  const flow = flowState.get(flowID)
  if (!flow || flow.providerID !== providerID) return undefined

  flow.cancelSignal?.abort()
  if (!["connected", "error", "expired", "cancelled"].includes(flow.status)) {
    flow.status = "cancelled"
    flow.errorMessage = "Authentication cancelled."
    clearFlowTimeout(flow)
    upsertFlow(flow)
  }

  await settleOpenAIBrowserFlow(flow)

  return flowPublicView(flow)
}

export async function completeProviderBrowserCallback(input: {
  providerID: string
  url: URL
}) {
  const state = normalizeString(input.url.searchParams.get("state"))
  const code = normalizeString(input.url.searchParams.get("code"))
  const errorCode = normalizeString(input.url.searchParams.get("error"))
  const errorDescription = normalizeString(input.url.searchParams.get("error_description"))

  const flow = Array.from(flowState.values()).find(
    (candidate) =>
      candidate.providerID === input.providerID &&
      isLocalBrowserCallbackFlow(candidate) &&
      candidate.state === state,
  )

  if (!flow) {
    return {
      ok: false,
      status: 400,
      title: "Sign-in failed",
      message: "The authentication flow could not be matched. Start the login flow again from the app.",
    }
  }

  if (errorCode) {
    flow.status = "error"
    flow.errorMessage = errorDescription ? `${errorCode}: ${errorDescription}` : errorCode
    clearFlowTimeout(flow)
    upsertFlow(flow)
    await Auth.setProviderLastError(flow.providerID, flow.errorMessage)
    await settleOpenAIBrowserFlow(flow, { deferServerClose: true })
    return {
      ok: false,
      status: 400,
      title: "Sign-in failed",
      message: flow.errorMessage,
    }
  }

  if (!code || !flow.codeVerifier || !flow.redirectURI) {
    flow.status = "error"
    flow.errorMessage = "Missing authorization code."
    clearFlowTimeout(flow)
    upsertFlow(flow)
    await Auth.setProviderLastError(flow.providerID, flow.errorMessage)
    await settleOpenAIBrowserFlow(flow, { deferServerClose: true })
    return {
      ok: false,
      status: 400,
      title: "Sign-in failed",
      message: flow.errorMessage,
    }
  }

  flow.status = "authorizing"
  upsertFlow(flow)

  try {
    const tokens = flow.genericOAuth
      ? await exchangeGenericOAuthAuthorizationCode({
          oauth: flow.genericOAuth,
          authorizationCode: code,
          codeVerifier: flow.codeVerifier,
          redirectURI: flow.redirectURI,
        })
      : isAnyboxBrowserFlow(flow)
        ? await exchangeAnyboxAuthorizationCode({
            baseURL: flow.providerBaseURL,
            authorizationCode: code,
            codeVerifier: flow.codeVerifier,
            redirectURI: flow.redirectURI,
          })
        : await exchangeOpenAIAuthorizationCode({
            authorizationCode: code,
            codeVerifier: flow.codeVerifier,
            redirectURI: flow.redirectURI,
          })
    const credential = flow.genericOAuth
      ? await saveGenericOAuthTokens(flow.providerID, flow.method, tokens, flow.genericOAuth)
      : isAnyboxBrowserFlow(flow)
        ? await saveAnyboxTokens(flow.method, tokens, flow.providerBaseURL)
        : await saveOpenAITokens(flow.method, tokens)
    flow.status = "connected"
    flow.errorMessage = undefined
    flow.errorCode = undefined
    flow.diagnostics = undefined
    flow.connectionLabel = connectionLabelForCredential(flow.providerID, flow.method, credential)
    flow.account = summarizeOAuthAccount(credential)
    clearFlowTimeout(flow)
    upsertFlow(flow)
    await settleOpenAIBrowserFlow(flow, { deferServerClose: true })

    return {
      ok: true,
      status: 200,
      title: "Sign-in complete",
      message: "You can return to the app. This window can be closed.",
    }
  } catch (error) {
    flow.status = "error"
    flow.errorMessage = error instanceof Error ? error.message : String(error)
    if (error instanceof AnyboxHTTP.AnyboxHTTPError) {
      flow.errorCode = error.code
      flow.diagnostics = error.diagnostics
    }
    clearFlowTimeout(flow)
    upsertFlow(flow)
    await Auth.setProviderLastError(flow.providerID, flow.errorMessage)
    await settleOpenAIBrowserFlow(flow, { deferServerClose: true })
    return {
      ok: false,
      status: 500,
      title: "Sign-in failed",
      message: flow.errorMessage,
    }
  }
}

export function renderProviderAuthCallbackPage(input: {
  ok: boolean
  title: string
  message?: string
}) {
  const escapedTitle = escapeHtml(input.title)
  const escapedMessage = escapeHtml(input.message ?? "")
  const tone = input.ok ? "#0c7c59" : "#b42318"

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0b1020;
        color: #f5f7fa;
        font: 15px/1.5 ui-sans-serif, system-ui, sans-serif;
      }
      article {
        width: min(480px, calc(100vw - 32px));
        padding: 28px;
        border-radius: 18px;
        background: rgba(14, 21, 40, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
      }
      h1 { margin: 0 0 10px; font-size: 22px; }
      p { margin: 0; color: rgba(245, 247, 250, 0.82); }
      .status {
        display: inline-block;
        margin-bottom: 14px;
        padding: 4px 10px;
        border-radius: 999px;
        background: ${tone};
        color: white;
        font-size: 12px;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <article>
      <span class="status">${input.ok ? "Connected" : "Error"}</span>
      <h1>${escapedTitle}</h1>
      <p>${escapedMessage}</p>
    </article>
  </body>
</html>`
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export async function saveProviderApiKey(providerID: string, apiKey: string | null | undefined) {
  const normalized = normalizeString(apiKey)
  if (!normalized) {
    await Auth.removeProviderCredential(providerID, "api-key").catch(() => undefined)
    if ((await Auth.getProviderRecord(providerID))?.activeMethod === "api-key") {
      await Auth.setActiveMethod(providerID, null)
    }
    await Auth.setProviderLastError(providerID, null)
    return
  }

  await Auth.setProviderCredential(
    providerID,
    "api-key",
    {
      kind: "api_key",
      apiKey: normalized,
    },
    {
      activate: true,
      lastError: null,
    },
  )
}

export async function deleteProviderSession(providerID: string) {
  const previousRecord = await Auth.getProviderRecord(providerID)
  if (providerID === ANYBOX_PROVIDER_ID && previousRecord) {
    await Promise.all(
      Object.values(previousRecord.credentials)
        .filter((credential): credential is Auth.OAuthSessionCredential => credential.kind === "oauth_session")
        .map((credential) => revokeAnyboxSession(credential)),
    )
  }

  const removed = await Auth.removeProviderCredentials(providerID, ({ credential }) => credential.kind === "oauth_session")
  const record = await Auth.getProviderRecord(providerID)
  if (record?.activeMethod && (isOpenAIChatGPTMethod(record.activeMethod) || providerID === ANYBOX_PROVIDER_ID)) {
    await Auth.setActiveMethod(providerID, "api-key" in record.credentials ? "api-key" : null)
  }
  await Auth.setProviderLastError(providerID, null)
  return removed
}

export async function getProviderAuthState(
  providerID: string,
  fallbacks: ProviderAuthFallbacks = {},
) {
  return await buildProviderAuthState(providerID, fallbacks)
}

export function createDisconnectedProviderAuthState(providerID: string): ProviderAuthState {
  return {
    providerID,
    scope: "global",
    status: "not_connected",
    capabilities: getCapabilities(providerID),
    credentials: [],
  }
}

export async function resolveProviderRuntimeAuth(
  providerID: string,
  fallbacks: ProviderAuthFallbacks = {},
  options: ProviderRuntimeAuthOptions = {},
): Promise<ProviderRuntimeAuth> {
  const capabilities = getCapabilities(providerID)
  const record = await Auth.getProviderRecord(providerID)
  const requestedMethod = normalizeString(options.method)
  const credentialMode = options.credentialMode ?? "active"
  const transientApiKey = normalizeString(options.transientApiKey)

  let activeMethod: string | undefined
  let credential: Auth.CredentialRecord | undefined
  let credentialSource: Auth.ProviderCredentialDescriptor["source"] | undefined

  if (credentialMode === "manual") {
    activeMethod = requestedMethod ?? "api-key"
    if (activeMethod === "api-key" && transientApiKey) {
      credential = {
        kind: "api_key",
        apiKey: transientApiKey,
      }
      credentialSource = "credential_store"
    } else {
      credential = activeMethod ? record?.credentials[activeMethod] : undefined
      credentialSource = credential ? "credential_store" : undefined
    }
  } else if (credentialMode === "environment") {
    activeMethod = requestedMethod ?? "api-key"
    const envFallback = fallbacks.envApiKey
      ? await buildFallbackCredential(providerID, { envApiKey: fallbacks.envApiKey })
      : undefined
    if (envFallback && (!activeMethod || envFallback.method === activeMethod)) {
      activeMethod = envFallback.method
      credential = envFallback.credential
      credentialSource = envFallback.source
    }
  } else if (requestedMethod) {
    activeMethod = requestedMethod
    credential = record?.credentials[activeMethod]
    credentialSource = credential ? "credential_store" : undefined

    if (!credential) {
      const fallback = await buildFallbackCredential(providerID, fallbacks)
      if (fallback?.method === activeMethod) {
        credential = fallback.credential
        credentialSource = fallback.source
      }
    }
  } else {
    const fallback = await buildFallbackCredential(providerID, fallbacks)
    activeMethod = record?.activeMethod ?? undefined
    credential = activeMethod ? record?.credentials[activeMethod] : undefined
    credentialSource = credential ? "credential_store" : undefined

    if (!credential && fallback) {
      activeMethod = fallback.method
      credential = fallback.credential
      credentialSource = fallback.source
    }
  }

  if (providerID === OPENAI_PROVIDER_ID && credential?.kind === "oauth_session" && credential.expiresAt <= now() + TOKEN_REFRESH_THRESHOLD_MS) {
    try {
      const refreshed = await refreshOpenAISession(credential)
      if (activeMethod) {
        await Auth.setProviderCredential(providerID, activeMethod, refreshed, {
          activate: true,
          lastError: null,
        })
        credentialSource = "credential_store"
      }
      credential = refreshed
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await Auth.setProviderLastError(providerID, message)
      log.warn("oauth-session-refresh-failed", {
        providerID,
        activeMethod,
        message,
      })
    }
  }

  if (providerID === ANYBOX_PROVIDER_ID && credential?.kind === "oauth_session") {
    if (options.forceRefresh || credential.expiresAt <= now() + TOKEN_REFRESH_THRESHOLD_MS) {
      try {
        const refreshed = await refreshAnyboxSession(credential, fallbacks.providerBaseURL)
        if (activeMethod) {
          await Auth.setProviderCredential(providerID, activeMethod, refreshed, {
            activate: true,
            lastError: null,
          })
          credentialSource = "credential_store"
        }
        credential = refreshed
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await Auth.setProviderLastError(providerID, message)
        if (options.forceRefresh || credential.expiresAt <= now()) credential = undefined
        log.warn("oauth-session-refresh-failed", {
          providerID,
          activeMethod,
          message,
        })
      }
    }
  }

  const authState = await buildProviderAuthState(providerID, fallbacks)

  if (!credential) {
    return {
      authMode: "api",
      authCapabilities: capabilities,
      authState,
    }
  }

  if (credential.kind === "api_key") {
    return {
      credentialKind: credential.kind,
      credentialSource,
      activeMethod,
      apiKey: credential.apiKey,
      authMode: "api",
      authCapabilities: capabilities,
      authState,
    }
  }

  if (providerID === OPENAI_PROVIDER_ID && isOpenAIChatGPTMethod(activeMethod)) {
    const headers: Record<string, string> = {
      originator: credential.originator ?? OPENAI_ORIGINATOR,
      "user-agent": credential.originator ?? OPENAI_ORIGINATOR,
    }

    if (credential.accountID) {
      headers["ChatGPT-Account-ID"] = credential.accountID
    }

    return {
      credentialKind: credential.kind,
      credentialSource,
      activeMethod,
      apiKey: credential.accessToken,
      runtimeBaseURL: OPENAI_CODEX_BASE_URL,
      runtimeHeaders: headers,
      authMode: "codex",
      authCapabilities: capabilities,
      authState,
    }
  }

  if (providerID === ANYBOX_PROVIDER_ID) {
    return {
      credentialKind: credential.kind,
      credentialSource,
      activeMethod,
      apiKey: credential.accessToken,
      runtimeBaseURL: normalizeAnyboxApiURL(fallbacks.providerBaseURL ?? credential.originator),
      authMode: "api",
      authCapabilities: capabilities,
      authState,
    }
  }

  return {
    credentialKind: credential.kind,
    credentialSource,
    activeMethod,
    apiKey: credential.accessToken,
    authMode: "api",
    authCapabilities: capabilities,
    authState,
  }
}
