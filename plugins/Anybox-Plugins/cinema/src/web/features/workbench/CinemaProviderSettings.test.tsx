/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../../i18n"
import { CinemaProviderSettings } from "./CinemaProviderSettings"

function jsonResponse(data: unknown) {
  return Promise.resolve(new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("CinemaProviderSettings", () => {
  it("loads OpenAI-compatible settings and saves model configuration without replacing a stored key", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const pathname = new URL(String(input)).pathname
      if (pathname.endsWith("/credential")) {
        return await jsonResponse({ configured: true, persistence: "system-keychain" })
      }
      if (pathname.endsWith("/settings") && init?.method === "PUT") return await jsonResponse({})
      if (pathname.endsWith("/settings")) {
        return await jsonResponse({
          baseURL: "https://api.example.com/v1",
          defaultModel: "model-a",
          models: [{ id: "model-a" }],
          textGenerationPrompt: "Keep shots concise.",
        })
      }
      throw new Error(`Unexpected request: ${pathname}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <I18nProvider locale="en-US">
        <CinemaProviderSettings initialProviderID="openai-compatible" />
      </I18nProvider>,
    )

    expect(await screen.findByRole("heading", { name: "OpenAI Compatible" })).toBeVisible()
    expect(await screen.findByDisplayValue("https://api.example.com/v1")).toBeVisible()
    expect(screen.getByText("Connected · System keychain")).toBeVisible()

    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://new.example.com/v1" } })
    fireEvent.change(screen.getByLabelText("Default model"), { target: { value: "model-b" } })
    fireEvent.change(screen.getByLabelText("Models"), { target: { value: "model-a\nmodel-c" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText("Provider settings saved.")).toBeVisible()
    const settingsWrite = fetchMock.mock.calls.find(([input, init]) => (
      new URL(String(input)).pathname.endsWith("/settings") && init?.method === "PUT"
    ))
    expect(settingsWrite).toBeDefined()
    expect(JSON.parse(String(settingsWrite?.[1]?.body))).toEqual({
      baseURL: "https://new.example.com/v1",
      defaultModel: "model-b",
      models: [{ id: "model-b" }, { id: "model-a" }, { id: "model-c" }],
      textGenerationPrompt: "Keep shots concise.",
    })
    expect(fetchMock.mock.calls.some(([input, init]) => (
      new URL(String(input)).pathname.endsWith("/credential") && init?.method === "PUT"
    ))).toBe(false)
  })

  it("stores a Google key for the session before testing the connection", async () => {
    let configured = false
    let persistence = "none"
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const pathname = new URL(String(input)).pathname
      if (pathname.endsWith("/settings")) return await jsonResponse({})
      if (pathname.endsWith("/credential") && init?.method === "PUT") {
        configured = true
        persistence = JSON.parse(String(init.body)).persistence
        return await jsonResponse({ configured, persistence })
      }
      if (pathname.endsWith("/credential")) return await jsonResponse({ configured, persistence })
      if (pathname.endsWith("/test")) {
        return await jsonResponse({ ok: true, status: "working", message: "Connection test succeeded." })
      }
      throw new Error(`Unexpected request: ${pathname}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <I18nProvider locale="en-US">
        <CinemaProviderSettings initialProviderID="google-ai-sdk" />
      </I18nProvider>,
    )

    const keyInput = await screen.findByLabelText("API key")
    fireEvent.change(keyInput, { target: { value: "google-secret" } })
    fireEvent.click(screen.getByRole("radio", { name: "This session" }))
    fireEvent.click(screen.getByRole("button", { name: "Save & test" }))

    expect(await screen.findByText("Connection test succeeded.")).toBeVisible()
    expect(screen.getByText("Connected · This session")).toBeVisible()
    expect(keyInput).toHaveValue("")
    const credentialWrite = fetchMock.mock.calls.find(([input, init]) => (
      new URL(String(input)).pathname.endsWith("/credential") && init?.method === "PUT"
    ))
    expect(JSON.parse(String(credentialWrite?.[1]?.body))).toEqual({
      apiKey: "google-secret",
      persistence: "session",
    })
    expect(fetchMock.mock.calls.some(([input, init]) => (
      new URL(String(input)).pathname.endsWith("/test") && init?.method === "POST"
    ))).toBe(true)
  })

  it("requires a credential for a disconnected remote provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname
      return await jsonResponse(pathname.endsWith("/credential")
        ? { configured: false, persistence: "none" }
        : {})
    }))

    render(
      <I18nProvider locale="en-US">
        <CinemaProviderSettings initialProviderID="klingai-cn" />
      </I18nProvider>,
    )

    await screen.findByLabelText("Credential")
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a provider credential before saving.")
  })

  it("keeps provider navigation disabled while the active settings are loading", async () => {
    let resolveSettings: ((response: Response) => void) | undefined
    vi.stubGlobal("fetch", vi.fn(async () => await new Promise<Response>((resolve) => {
      resolveSettings = resolve
    })))

    render(
      <I18nProvider locale="en-US">
        <CinemaProviderSettings />
      </I18nProvider>,
    )

    expect(screen.getByRole("button", { name: /Google Gemini Image/ })).toBeDisabled()
    resolveSettings?.(await jsonResponse({}))
    await waitFor(() => expect(screen.getByRole("button", { name: /Google Gemini Image/ })).toBeEnabled())
  })

  it("has no structural accessibility violations after provider settings load", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname
      return await jsonResponse(pathname.endsWith("/credential")
        ? { configured: false, persistence: "none" }
        : { baseURL: "https://api.example.com/v1", models: [{ id: "model-a" }] })
    }))

    const { container } = render(
      <I18nProvider locale="en-US">
        <CinemaProviderSettings initialProviderID="openai-compatible" />
      </I18nProvider>,
    )

    await screen.findByLabelText("Default model")
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(result.violations).toEqual([])
  })
})
