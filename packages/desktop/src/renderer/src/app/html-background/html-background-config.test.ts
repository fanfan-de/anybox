import { describe, expect, it } from "vitest"
import { DEFAULT_HTML_BACKGROUND_CONFIG, normalizeHtmlBackgroundConfig } from "./html-background-config"

describe("normalizeHtmlBackgroundConfig", () => {
  it("migrates the old low-visibility visual defaults", () => {
    expect(normalizeHtmlBackgroundConfig({
      blurPx: 0,
      dim: 0.34,
      enabled: true,
      html: "<main>Background</main>",
      opacity: 0.64,
      paused: false,
      surfaceOpacity: 0.82,
    })).toEqual({
      ...DEFAULT_HTML_BACKGROUND_CONFIG,
      enabled: true,
      html: "<main>Background</main>",
    })
  })

  it("keeps customized visual values", () => {
    expect(normalizeHtmlBackgroundConfig({
      blurPx: 2,
      dim: 0.34,
      enabled: true,
      html: "<main>Background</main>",
      opacity: 0.64,
      paused: true,
      renderMode: "dynamic",
      surfaceOpacity: 0.7,
    })).toEqual({
      blurPx: 2,
      dim: 0.34,
      enabled: true,
      html: "<main>Background</main>",
      opacity: 0.64,
      paused: true,
      renderMode: "dynamic",
      surfaceOpacity: 0.7,
    })
  })
})
