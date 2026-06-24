import { describe, expect, it } from "vitest"
import {
  DEFAULT_HTML_BACKGROUND_CONFIG,
  normalizeHtmlBackgroundConfig,
  resolveHtmlBackgroundAppearance,
} from "./html-background-config"

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

describe("resolveHtmlBackgroundAppearance", () => {
  it("uses the default solid profile without an enabled HTML background", () => {
    expect(resolveHtmlBackgroundAppearance(DEFAULT_HTML_BACKGROUND_CONFIG)).toEqual({
      backgroundMode: "default",
      contentOpacityPercent: "82%",
      hasHtmlBackground: false,
      surfaceOpacityPercent: "68%",
      surfaceProfile: "solid",
    })
  })

  it("keeps the default solid profile when enabled HTML is empty", () => {
    expect(resolveHtmlBackgroundAppearance({
      ...DEFAULT_HTML_BACKGROUND_CONFIG,
      enabled: true,
      html: "   ",
    })).toEqual({
      backgroundMode: "default",
      contentOpacityPercent: "82%",
      hasHtmlBackground: false,
      surfaceOpacityPercent: "68%",
      surfaceProfile: "solid",
    })
  })

  it("uses the translucent custom HTML profile when enabled HTML is present", () => {
    expect(resolveHtmlBackgroundAppearance({
      ...DEFAULT_HTML_BACKGROUND_CONFIG,
      enabled: true,
      html: "<main>Background</main>",
      surfaceOpacity: 0.7,
    })).toEqual({
      backgroundMode: "custom-html",
      contentOpacityPercent: "84%",
      hasHtmlBackground: true,
      surfaceOpacityPercent: "70%",
      surfaceProfile: "translucent",
    })
  })

  it("caps content opacity at 92 percent", () => {
    expect(resolveHtmlBackgroundAppearance({
      ...DEFAULT_HTML_BACKGROUND_CONFIG,
      enabled: true,
      html: "<main>Background</main>",
      surfaceOpacity: 0.95,
    })).toMatchObject({
      contentOpacityPercent: "92%",
      surfaceOpacityPercent: "95%",
    })
  })
})
