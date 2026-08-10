import { describe, expect, it } from "vitest"
import {
  isCinemaPluginRuntimeBaseURL,
  resolveCinemaRuntimeBaseURL,
  resolveCinemaRuntimeURL,
} from "./runtimeUrl"

describe("Cinema runtime URL resolution", () => {
  it("uses the same-origin App Runtime Gateway inside a Plugin View", () => {
    const baseURL = resolveCinemaRuntimeBaseURL({
      location: {
        origin: "anybox-preview://view-token",
        protocol: "anybox-preview:",
      },
    })

    expect(baseURL).toBe("anybox-preview://view-token/__anybox_runtime__/")
    expect(resolveCinemaRuntimeURL(baseURL, "/api/cinema/projects/project-1")).toBe(
      "anybox-preview://view-token/__anybox_runtime__/api/cinema/projects/project-1",
    )
    expect(isCinemaPluginRuntimeBaseURL(baseURL)).toBe(true)
  })

  it("preserves explicit standalone Agent URLs", () => {
    const baseURL = resolveCinemaRuntimeBaseURL({
      explicitBaseURL: "http://127.0.0.1:4096/",
      location: { origin: "anybox-preview://ignored", protocol: "anybox-preview:" },
    })

    expect(baseURL).toBe("http://127.0.0.1:4096")
    expect(resolveCinemaRuntimeURL(baseURL, "/api/cinema/projects")).toBe(
      "http://127.0.0.1:4096/api/cinema/projects",
    )
    expect(isCinemaPluginRuntimeBaseURL(baseURL)).toBe(false)
  })
})
