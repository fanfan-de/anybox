type AgentEnvelope<T> =
  | {
      success: true
      data: T
    }
  | {
      success: false
      error?: {
        message?: string
      }
    }

const FALLBACK_AGENT_BASE_URL = "http://127.0.0.1:4096"
const AGENT_REQUEST_TIMEOUT_MS = 15_000

async function resolveAgentBaseURL() {
  if (typeof window !== "undefined") {
    const config = await window.desktop?.getAgentConfig?.().catch(() => undefined)
    if (config?.baseURL) return config.baseURL
  }

  return FALLBACK_AGENT_BASE_URL
}

function resolveAgentURL(pathname: string, baseURL: string) {
  const normalizedBaseURL = baseURL.endsWith("/") ? baseURL : `${baseURL}/`
  return new URL(pathname, normalizedBaseURL).toString()
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function requestAgentJSON<T>(pathname: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), AGENT_REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(resolveAgentURL(pathname, await resolveAgentBaseURL()), {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Local agent API timed out after ${AGENT_REQUEST_TIMEOUT_MS / 1000}s.`)
    }
    throw new Error(`Local agent API could not be reached. ${formatError(error)}`)
  } finally {
    globalThis.clearTimeout(timeout)
  }

  const envelope = (await response.json().catch(() => null)) as AgentEnvelope<T> | null
  if (!response.ok || !envelope) {
    throw new Error(`Agent API request failed (${response.status}).`)
  }
  if (envelope.success !== true) {
    throw new Error(envelope.error?.message || `Agent API request failed (${response.status}).`)
  }

  return envelope.data
}

export function jsonRequestInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: {
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}
