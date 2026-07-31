import { afterAll, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const testRoot = mkdtempSync(path.join(tmpdir(), "anybox-anybox-provider-"))
process.env.ANYBOX_AGENT_DATA_DIR = testRoot
process.env.ANYBOX_BASE_URL = "https://anybox.test"
process.env.ANYBOX_OPENAI_CODEX_CALLBACK_PORT = "0"

const Auth = await import("#auth/auth.ts")
const AnyboxHTTP = await import("#provider/anybox-http.ts")
const ProviderAuth = await import("#auth/provider-auth.ts")
const Provider = await import("#provider/provider.ts")
const { Instance } = await import("#project/instance.ts")
const Sqlite = await import("#database/Sqlite.ts")

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

function parseRequestBody(init?: FetchInit): Record<string, unknown> {
  const body = init?.body
  if (!body) return {}
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries())
  if (typeof body !== "string") return {}

  try {
    return JSON.parse(body) as Record<string, unknown>
  } catch {
    return Object.fromEntries(new URLSearchParams(body).entries())
  }
}

afterAll(() => {
  Sqlite.closeDatabase()
  rmSync(testRoot, { recursive: true, force: true })
})

beforeEach(async () => {
  await Auth.clearProvider("anybox")
})

test("anybox is visible in catalog without API key capability before login", async () => {
  const restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
    getModelsDev: async () => ({}) as never,
    getConfig: async () => ({}) as never,
    getEnvAll: () => ({}),
    importPackage: async () => {
      throw new Error("Anybox catalog visibility should not import SDK packages")
    },
  })

  try {
    const catalog = await Provider.catalog()
    const anybox = catalog.find((provider) => provider.id === "anybox")

    expect(anybox).toBeDefined()
    expect(anybox?.configured).toBe(false)
    expect(anybox?.available).toBe(false)
    expect(anybox?.baseURL).toBe("https://anybox.test/v1")
    expect(anybox?.authCapabilities.map((capability) => capability.kind)).toEqual(["browser_oauth"])
    expect(anybox?.authCapabilities.some((capability) => capability.kind === "api_key")).toBe(false)
    expect(anybox?.authState.status).toBe("not_connected")
  } finally {
    restoreProvider()
  }
})

test("anybox browser login starts without Anybox connectivity preflight", async () => {
  const restoreHTTP = AnyboxHTTP.setAnyboxHTTPDependenciesForTesting({
    env: {
      HTTPS_PROXY: "http://unreachable-proxy.test:8080",
    },
    fetch: (async () => {
      throw new Error("Anybox browser login should not fetch Anybox before opening the browser")
    }) as unknown as typeof fetch,
  })

  try {
    const flow = await ProviderAuth.startProviderAuthFlow({
      providerID: "anybox",
      method: "anybox-browser",
      serverBaseURL: "http://localhost",
      providerBaseURL: "https://anybox.test/v1",
    })

    expect(flow).toMatchObject({
      providerID: "anybox",
      method: "anybox-browser",
      kind: "browser_oauth",
      status: "waiting_user",
    })

    const authorizationURL = new URL(flow.authorizationURL ?? "")
    expect(authorizationURL.origin).toBe("https://anybox.test")
    expect(authorizationURL.pathname).toBe("/api/agent/oauth/authorize")
    expect(authorizationURL.searchParams.get("client_id")).toBe("anybox-agent")
    expect(authorizationURL.searchParams.get("prompt")).toBeNull()

    await ProviderAuth.cancelProviderAuthFlow("anybox", flow.id)
  } finally {
    restoreHTTP()
  }
})

test("anybox browser login can request account selection", async () => {
  const flow = await ProviderAuth.startProviderAuthFlow({
    providerID: "anybox",
    method: "anybox-browser",
    serverBaseURL: "http://localhost",
    providerBaseURL: "https://anybox.test/v1",
    prompt: "select_account",
  })

  try {
    const authorizationURL = new URL(flow.authorizationURL ?? "")

    expect(authorizationURL.pathname).toBe("/api/agent/oauth/authorize")
    expect(authorizationURL.searchParams.get("prompt")).toBe("select_account")
  } finally {
    await ProviderAuth.cancelProviderAuthFlow("anybox", flow.id)
  }
})

test("anybox model payload requires sdk and endpoint", async () => {
  const originalFetch = globalThis.fetch
  let modelPayload: Record<string, unknown> = {
    id: "missing-sdk",
    endpoint: "/api/models/missing-sdk/chat",
  }

  await Auth.setProviderCredential(
    "anybox",
    "anybox-browser",
    {
      kind: "oauth_session",
      accessToken: "contract-access",
      refreshToken: "contract-refresh",
      expiresAt: Date.now() + 60 * 60 * 1000,
      email: "contract@anybox.test",
      originator: "https://anybox.test",
    },
    {
      activate: true,
      lastError: null,
    },
  )

  globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const headers = new Headers(init?.headers)

    if (url === "https://anybox.test/api/agent/me") {
      expect(headers.get("authorization")).toBe("Bearer contract-access")
      return Response.json({
        account: {
          email: "contract@anybox.test",
        },
      })
    }

    if (url === "https://anybox.test/v1/models") {
      expect(headers.get("authorization")).toBe("Bearer contract-access")
      return Response.json({
        data: [modelPayload],
      })
    }

    return originalFetch(input, init)
  }) as typeof fetch

  const restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
    getModelsDev: async () => ({}) as never,
    getConfig: async () =>
      ({
        provider: {
          anybox: {
            name: "Anybox",
            options: {
              baseURL: "https://anybox.test",
            },
          },
        },
      }) as never,
    getEnvAll: () => ({}),
    importPackage: async () => {
      throw new Error("Validating Anybox model payload should not import SDK packages")
    },
  })

  try {
    await expect(Provider.listModels()).rejects.toThrow("Anybox model 'missing-sdk' is missing required sdk information")

    modelPayload = {
      id: "missing-endpoint",
      sdk: "@ai-sdk/openai-compatible",
    }
    await expect(Provider.listModels()).rejects.toThrow("Anybox model 'missing-endpoint' is missing required endpoint")
  } finally {
    restoreProvider()
    globalThis.fetch = originalFetch
  }
})

test("anybox browser login stores oauth session and runtime uses openai-compatible with access token", async () => {
  const anyboxLanguageModel = {
    doGenerate() {},
    doStream() {},
  }
  const capturedFactoryInputs: Array<Record<string, unknown>> = []
  const originalFetch = globalThis.fetch
  const seenRequests: Array<{ url: string; authorization?: string; body?: Record<string, unknown>; proxy?: string }> = []
  const restoreHTTP = AnyboxHTTP.setAnyboxHTTPDependenciesForTesting({
    env: {},
  })

  globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const headers = new Headers(init?.headers)
    const proxy = (init as FetchInit & { proxy?: string } | undefined)?.proxy

    if (url === "https://anybox.test/livez") throw new Error("Anybox browser login should not preflight /livez")

    if (url === "https://anybox.test/api/agent/oauth/token") {
      const body = parseRequestBody(init)
      seenRequests.push({ url, body, proxy })
      expect(body).toMatchObject({
        grant_type: "authorization_code",
        client_id: "anybox-agent",
        code: "anybox-auth-code",
        redirect_uri: expect.stringContaining("/auth/callback"),
      })
      expect(body.code_verifier).toBeString()
      return Response.json({
        access_token: "anybox-access-1",
        refresh_token: "anybox-refresh-1",
        expires_in: 3600,
        token_type: "Bearer",
        account: {
          id: "user_anybox",
          user_id: "user_anybox",
          email: "agent-user@anybox.test",
          plan_type: "pro",
          plan_label: "Pro",
          subscription: {
            plan_code: "pro",
            status: "active",
            source: "system_migration",
            cancel_at_period_end: false,
          },
          entitlements: {
            model_gateway_enabled: true,
            relay_enabled: true,
            max_desktop_devices: 3,
            max_mobile_devices: 5,
          },
          workspace: {
            id: "ws_anybox",
            name: "Anybox Workspace",
          },
          billing: {
            balance_microcents: 123_000_000,
            currency: "CNY",
            recharge_url: "https://anybox.test/billing/recharge",
          },
        },
      })
    }

    if (url === "https://anybox.test/api/agent/me") {
      throw new Error("Anybox browser login should not fetch /api/agent/me")
    }

    if (url === "https://anybox.test/v1/models") {
      seenRequests.push({ url, authorization: headers.get("authorization") ?? undefined, proxy })
      expect(headers.get("authorization")).toBe("Bearer anybox-access-1")
      return Response.json({
        object: "list",
        data: [
          {
            id: "claude-opus",
            name: "Claude Opus",
            sdk: "@ai-sdk/openai-compatible",
            endpoint: "/api/models/claude-opus/chat",
            context_window: 200_000,
            max_output_tokens: 32_000,
          },
          {
            id: "vision-model",
            sdk: "@ai-sdk/openai-compatible",
            endpoint: "/api/models/vision-model/chat",
            capabilities: {
              vision: true,
              pdf: true,
              reasoning: true,
            },
          },
        ],
      })
    }

    return originalFetch(input, init)
  }) as typeof fetch

  const restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
    getModelsDev: async () => ({}) as never,
    getConfig: async () =>
      ({
        provider: {
          anybox: {
            name: "Anybox",
            options: {
              baseURL: "https://anybox.test",
            },
          },
        },
      }) as never,
    getEnvAll: () => ({}),
    importPackage: async (pkg: string, version?: string) => {
      expect(pkg).toBe("@ai-sdk/openai-compatible")
      expect(version).toBe("3.0.18")

      return {
        name: pkg,
        version: version ?? "test-version",
        entry: `${pkg}/index.js`,
        root: pkg,
        module: {
          createOpenAICompatible(options: Record<string, unknown>) {
            capturedFactoryInputs.push(options)
            return {
              languageModel() {
                return anyboxLanguageModel
              },
            }
          },
        },
      }
    },
  })

  try {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const flow = await ProviderAuth.startProviderAuthFlow({
          providerID: "anybox",
          method: "anybox-browser",
          serverBaseURL: "http://localhost",
          providerBaseURL: "https://anybox.test/v1",
        })

        const authorizationURL = new URL(flow.authorizationURL ?? "")
        expect(authorizationURL.origin).toBe("https://anybox.test")
        expect(authorizationURL.pathname).toBe("/api/agent/oauth/authorize")
        expect(authorizationURL.searchParams.get("client_id")).toBe("anybox-agent")
        expect(authorizationURL.searchParams.get("code_challenge_method")).toBe("S256")
        expect(authorizationURL.searchParams.get("code_challenge")).toBeString()
        expect(authorizationURL.searchParams.get("redirect_uri")).toBeString()

        const state = authorizationURL.searchParams.get("state")
        const redirectURI = authorizationURL.searchParams.get("redirect_uri")
        const callbackResponse = await fetch(
          `${redirectURI}?code=anybox-auth-code&state=${encodeURIComponent(state ?? "")}`,
        )
        const callbackHtml = await callbackResponse.text()
        expect(callbackResponse.status).toBe(200)
        expect(callbackHtml).toContain("Sign-in complete")
        await Bun.sleep(20)

        const authState = await ProviderAuth.getProviderAuthState("anybox")
        expect(authState).toMatchObject({
          providerID: "anybox",
          activeMethod: "anybox-browser",
          status: "connected",
          account: {
            email: "agent-user@anybox.test",
            planType: "pro",
            planLabel: "Pro",
            subscription: {
              planCode: "pro",
              status: "active",
              source: "system_migration",
              cancelAtPeriodEnd: false,
            },
            entitlements: {
              modelGatewayEnabled: true,
              relayEnabled: true,
              maxDesktopDevices: 3,
              maxMobileDevices: 5,
            },
            workspaceName: "Anybox Workspace",
            balanceMicrocents: 123_000_000,
            currency: "CNY",
            rechargeUrl: "https://anybox.test/billing/recharge",
          },
        })
        expect(seenRequests.map((request) => request.url)).toEqual(["https://anybox.test/api/agent/oauth/token"])

        const catalog = await Provider.catalog()
        const anybox = catalog.find((provider) => provider.id === "anybox")
        expect(anybox?.available).toBe(true)
        expect(anybox?.modelCount).toBe(2)
        expect(anybox?.apiKeyConfigured).toBe(false)

        const model = await Provider.getModel("anybox", "claude-opus")
        expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
        expect(model.api.url).toBe("https://anybox.test/api/models/claude-opus/chat")
        expect(model.capabilities.input.text).toBe(true)
        expect(model.capabilities.input.image).toBe(false)
        expect(model.capabilities.toolcall).toBe(true)

        const visionModel = await Provider.getModel("anybox", "vision-model")
        expect(visionModel.capabilities.input.image).toBe(true)
        expect(visionModel.capabilities.input.pdf).toBe(true)
        expect(visionModel.capabilities.reasoning).toBe(true)

        const language = await Provider.getLanguage(model)
        expect(language as unknown).toBe(anyboxLanguageModel)
        expect(capturedFactoryInputs).toEqual([
          {
            name: "anybox",
            apiKey: "anybox-access-1",
            baseURL: "https://anybox.test/api/models/claude-opus/chat",
            headers: undefined,
            fetch: expect.any(Function),
          },
        ])
      },
    })

    expect(seenRequests.some((request) => request.url === "https://anybox.test/livez")).toBe(false)
    expect(seenRequests.some((request) => request.url === "https://anybox.test/api/agent/oauth/token")).toBe(true)
    expect(seenRequests.some((request) => request.url === "https://anybox.test/api/agent/me")).toBe(false)
    expect(seenRequests.some((request) => request.url === "https://anybox.test/v1/models")).toBe(true)
    expect(seenRequests.every((request) => request.proxy === undefined)).toBe(true)
  } finally {
    restoreHTTP()
    restoreProvider()
    globalThis.fetch = originalFetch
  }
})

test("anybox model payload can select sdk package and API URL per model", async () => {
  const anyboxLanguageModel = {
    doGenerate() {},
    doStream() {},
  }
  const capturedFactoryInputs: Array<Record<string, unknown>> = []
  const originalFetch = globalThis.fetch

  await Auth.setProviderCredential(
    "anybox",
    "anybox-browser",
    {
      kind: "oauth_session",
      accessToken: "anybox-access-sdk",
      refreshToken: "anybox-refresh-sdk",
      expiresAt: Date.now() + 60 * 60 * 1000,
      email: "sdk@anybox.test",
      originator: "https://anybox.test",
    },
    {
      activate: true,
      lastError: null,
    },
  )

  globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const headers = new Headers(init?.headers)

    if (url === "https://anybox.test/api/agent/me") {
      expect(headers.get("authorization")).toBe("Bearer anybox-access-sdk")
      return Response.json({
        account: {
          email: "sdk@anybox.test",
          workspace_name: "SDK Workspace",
        },
      })
    }

    if (url === "https://anybox.test/v1/models") {
      expect(headers.get("authorization")).toBe("Bearer anybox-access-sdk")
      return Response.json({
        data: [
          {
            id: "anthropic-opus",
            name: "Anthropic Opus",
            sdk: "@ai-sdk/anthropic",
            endpoint: "/api/models/anthropic-opus/chat",
          },
        ],
      })
    }

    return originalFetch(input, init)
  }) as typeof fetch

  const restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
    getModelsDev: async () => ({}) as never,
    getConfig: async () =>
      ({
        provider: {
          anybox: {
            name: "Anybox",
            options: {
              baseURL: "https://anybox.test",
            },
          },
        },
      }) as never,
    getEnvAll: () => ({}),
    importPackage: async (pkg: string, version?: string) => {
      expect(pkg).toBe("@ai-sdk/anthropic")
      expect(version).toBe("4.0.25")

      return {
        name: pkg,
        version: version ?? "test-version",
        entry: `${pkg}/index.js`,
        root: pkg,
        module: {
          createAnthropic(options: Record<string, unknown>) {
            capturedFactoryInputs.push(options)
            return {
              languageModel(modelID: string) {
                expect(modelID).toBe("anthropic-opus")
                return anyboxLanguageModel
              },
            }
          },
        },
      }
    },
  })

  try {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const model = await Provider.getModel("anybox", "anthropic-opus")
        expect(model.api.npm).toBe("@ai-sdk/anthropic")
        expect(model.api.url).toBe("https://anybox.test/api/models/anthropic-opus/chat")

        const language = await Provider.getLanguage(model)
        expect(language as unknown).toBe(anyboxLanguageModel)
        expect(capturedFactoryInputs).toEqual([
          {
            apiKey: "anybox-access-sdk",
            baseURL: "https://anybox.test/api/models/anthropic-opus/chat",
            headers: undefined,
            fetch: expect.any(Function),
          },
        ])
      },
    })
  } finally {
    restoreProvider()
    globalThis.fetch = originalFetch
  }
})

test("anybox model list uses oauth originator when project has no explicit anybox base URL", async () => {
  const originalFetch = globalThis.fetch
  const seenModelURLs: string[] = []

  await Auth.setProviderCredential(
    "anybox",
    "anybox-browser",
    {
      kind: "oauth_session",
      accessToken: "origin-access",
      refreshToken: "origin-refresh",
      expiresAt: Date.now() + 60 * 60 * 1000,
      email: "origin@anybox.test",
      originator: "https://credential-origin.anybox.test",
    },
    {
      activate: true,
      lastError: null,
    },
  )

  globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const headers = new Headers(init?.headers)

    if (url === "https://credential-origin.anybox.test/api/agent/me") {
      expect(headers.get("authorization")).toBe("Bearer origin-access")
      return Response.json({
        account: {
          email: "origin@anybox.test",
          workspace_name: "Origin Workspace",
        },
      })
    }

    if (url === "https://credential-origin.anybox.test/v1/models") {
      seenModelURLs.push(url)
      expect(headers.get("authorization")).toBe("Bearer origin-access")
      return Response.json({
        data: [
          {
            id: "origin-model",
            name: "Origin Model",
            sdk: "@ai-sdk/openai-compatible",
            endpoint: "/api/models/origin-model/chat",
          },
        ],
      })
    }

    if (url.includes("anybox.test")) {
      throw new Error(`Unexpected Anybox URL: ${url}`)
    }

    return originalFetch(input, init)
  }) as typeof fetch

  const restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
    getModelsDev: async () => ({}) as never,
    getConfig: async () => ({}) as never,
    getEnvAll: () => ({}),
    importPackage: async () => {
      throw new Error("Listing Anybox models should not import SDK packages")
    },
  })

  try {
    const models = await Provider.listModels("project-without-anybox-config")

    expect(seenModelURLs).toEqual(["https://credential-origin.anybox.test/v1/models"])
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      providerID: "anybox",
      id: "origin-model",
      available: true,
    })
  } finally {
    restoreProvider()
    globalThis.fetch = originalFetch
  }
})

test("anybox runtime fetch refreshes and retries chat completion after 401", async () => {
  const capturedFactoryInputs: Array<Record<string, unknown>> = []
  const chatAuthorizations: string[] = []
  const chatProxies: Array<string | undefined> = []
  const originalFetch = globalThis.fetch
  const restoreHTTP = AnyboxHTTP.setAnyboxHTTPDependenciesForTesting({
    env: {},
  })

  await Auth.setProviderCredential(
    "anybox",
    "anybox-browser",
    {
      kind: "oauth_session",
      accessToken: "old-anybox-access",
      refreshToken: "old-anybox-refresh",
      expiresAt: Date.now() + 60 * 60 * 1000,
      email: "agent-user@anybox.test",
      originator: "https://anybox.test",
    },
    {
      activate: true,
      lastError: null,
    },
  )

  globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const headers = new Headers(init?.headers)
    const authorization = headers.get("authorization") ?? ""

    if (url === "https://anybox.test/api/agent/me") throw new Error("Anybox runtime auth should not fetch /api/agent/me")

    if (url === "https://anybox.test/v1/models") {
      expect(authorization).toBe("Bearer old-anybox-access")
      return Response.json({
        data: [
          {
            id: "retry-model",
            name: "Retry Model",
            sdk: "@ai-sdk/openai-compatible",
            endpoint: "/api/models/retry-model/chat",
          },
        ],
      })
    }

    if (url === "https://anybox.test/api/agent/oauth/refresh") {
      return Response.json({
        access_token: "new-anybox-access",
        refresh_token: "new-anybox-refresh",
        expires_in: 3600,
        account: {
          email: "fresh@anybox.test",
          plan_type: "pro",
          plan_label: "Pro",
          workspace_name: "Anybox Workspace",
          subscription: {
            plan_code: "pro",
            status: "active",
            source: "manual_admin",
            cancel_at_period_end: false,
          },
          entitlements: {
            model_gateway_enabled: true,
            relay_enabled: true,
            max_desktop_devices: 3,
            max_mobile_devices: 5,
          },
        },
      })
    }

    if (url === "https://anybox.test/api/models/retry-model/chat/disabled") {
      return Response.json({
        success: false,
        error: {
          code: "model_gateway_disabled",
          message: "This workspace does not have access to the model gateway",
        },
      }, { status: 403 })
    }

    if (url === "https://anybox.test/api/models/retry-model/chat/chat/completions") {
      chatAuthorizations.push(authorization)
      chatProxies.push((init as FetchInit & { proxy?: string } | undefined)?.proxy)
      if (authorization === "Bearer old-anybox-access") {
        return Response.json({ error: { message: "expired" } }, { status: 401 })
      }

      return Response.json({ id: "chatcmpl_retry", choices: [] })
    }

    return originalFetch(input, init)
  }) as typeof fetch

  const restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
    getModelsDev: async () => ({}) as never,
    getConfig: async () =>
      ({
        provider: {
          anybox: {
            name: "Anybox",
            options: {
              baseURL: "https://anybox.test",
            },
          },
        },
      }) as never,
    getEnvAll: () => ({}),
    importPackage: async (pkg: string, version?: string) => ({
      name: pkg,
      version: version ?? "test-version",
      entry: `${pkg}/index.js`,
      root: pkg,
      module: {
        createOpenAICompatible(options: Record<string, unknown>) {
          capturedFactoryInputs.push(options)
          return {
            languageModel() {
              return {
                doGenerate() {},
                doStream() {},
              }
            },
          }
        },
      },
    }),
  })

  try {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const model = await Provider.getModel("anybox", "retry-model")
        await Provider.getLanguage(model)

        const runtimeFetch = capturedFactoryInputs[0]?.fetch
        expect(typeof runtimeFetch).toBe("function")

        const response = await (runtimeFetch as typeof fetch)("https://anybox.test/api/models/retry-model/chat/chat/completions", {
          method: "POST",
          headers: {
            authorization: "Bearer old-anybox-access",
            "content-type": "application/json",
          },
          body: "{}",
        })

        expect(response.status).toBe(200)
        expect(chatAuthorizations).toEqual(["Bearer old-anybox-access", "Bearer new-anybox-access"])
        expect(chatProxies).toEqual([undefined, undefined])
        await expect(
          (runtimeFetch as typeof fetch)("https://anybox.test/api/models/retry-model/chat/disabled", {
            method: "POST",
            headers: {
              authorization: "Bearer new-anybox-access",
              "content-type": "application/json",
            },
            body: "{}",
          }),
        ).rejects.toThrow("模型网关权限")

        const active = await Auth.getActiveProviderCredential("anybox")
        expect(active?.credential).toMatchObject({
          kind: "oauth_session",
          accessToken: "new-anybox-access",
          refreshToken: "new-anybox-refresh",
          email: "fresh@anybox.test",
          planLabel: "Pro",
          subscription: {
            planCode: "pro",
            status: "active",
            source: "manual_admin",
            cancelAtPeriodEnd: false,
          },
          entitlements: {
            modelGatewayEnabled: true,
            relayEnabled: true,
            maxDesktopDevices: 3,
            maxMobileDevices: 5,
          },
        })
      },
    })
  } finally {
    restoreHTTP()
    restoreProvider()
    globalThis.fetch = originalFetch
  }
})

test("anybox runtime auth refreshes near-expired access tokens", async () => {
  const originalFetch = globalThis.fetch
  const seenRefreshBodies: Record<string, unknown>[] = []

  await Auth.setProviderCredential(
    "anybox",
    "anybox-browser",
    {
      kind: "oauth_session",
      accessToken: "old-anybox-access",
      refreshToken: "old-anybox-refresh",
      expiresAt: Date.now() + 1000,
      email: "old@anybox.test",
      originator: "https://anybox.test",
    },
    {
      activate: true,
      lastError: null,
    },
  )

  globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

    if (url === "https://anybox.test/api/agent/oauth/refresh") {
      const body = parseRequestBody(init)
      seenRefreshBodies.push(body)
      return Response.json({
        access_token: "new-anybox-access",
        refresh_token: "new-anybox-refresh",
        expires_in: 3600,
        account: {
          email: "fresh@anybox.test",
          workspace_name: "Fresh Workspace",
        },
      })
    }

    if (url === "https://anybox.test/api/agent/me") throw new Error("Anybox runtime auth should not fetch /api/agent/me")

    return originalFetch(input, init)
  }) as typeof fetch

  try {
    const runtimeAuth = await ProviderAuth.resolveProviderRuntimeAuth("anybox", {
      providerBaseURL: "https://anybox.test",
    })

    expect(runtimeAuth.apiKey).toBe("new-anybox-access")
    expect(runtimeAuth.runtimeBaseURL).toBe("https://anybox.test/v1")
    expect(runtimeAuth.authMode).toBe("api")
    expect(runtimeAuth.authState.status).toBe("connected")
    expect(runtimeAuth.authState.account?.email).toBe("fresh@anybox.test")
    expect(seenRefreshBodies).toEqual([
      {
        grant_type: "refresh_token",
        client_id: "anybox-agent",
        refresh_token: "old-anybox-refresh",
      },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})
