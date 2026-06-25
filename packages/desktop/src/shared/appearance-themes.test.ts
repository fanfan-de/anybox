import { describe, expect, it } from "vitest"
import {
  BUILT_IN_APPEARANCE_THEME_PRESETS,
  DEFAULT_APPEARANCE_THEME_ID,
  createAppearanceThemeLibrarySnapshot,
  createDefaultAppearanceThemeDocument,
  normalizeAppearanceThemeDocument,
  normalizeAppearanceThemeSaveInput,
} from "./appearance-themes"

describe("appearance theme library", () => {
  it("keeps built-in theme ids stable and readonly", () => {
    expect(BUILT_IN_APPEARANCE_THEME_PRESETS.map((theme) => theme.id)).toEqual([
      "built-in:anybox-terra",
      "built-in:sage-slate",
      "built-in:night-workbench",
      "built-in:soft-light",
    ])
    expect(BUILT_IN_APPEARANCE_THEME_PRESETS.every((theme) => theme.readonly)).toBe(true)
  })

  it("normalizes theme library documents and drops invalid user themes", () => {
    expect(normalizeAppearanceThemeDocument({
      version: 99,
      activeThemeID: "user:one",
      userThemes: [
        {
          id: "user:one",
          name: "  Custom   Theme  ",
          source: "imported",
          readonly: true,
          createdAt: 12,
          updatedAt: 34,
          colorMode: "dark",
          brandTheme: "sage",
          fontFamily: "microsoft-yahei",
          codeThemePreference: "dracula",
          htmlBackgroundConfig: {
            blurPx: 99,
            dim: -1,
            enabled: true,
            html: "<main>background</main>",
            opacity: 2,
            paused: true,
            renderMode: "dynamic",
            surfaceOpacity: 0,
          },
          overrides: {
            "surface-app-light": " #123456 ",
            unknown: "#ffffff",
          },
        },
        {
          id: "built-in:anybox-terra",
          name: "Invalid",
        },
      ],
    })).toEqual({
      version: 1,
      activeThemeID: "user:one",
      userThemes: [
        {
          id: "user:one",
          name: "Custom Theme",
          source: "imported",
          readonly: false,
          createdAt: 12,
          updatedAt: 34,
          colorMode: "dark",
          brandTheme: "sage",
          fontFamily: "microsoft-yahei",
          codeThemePreference: "dracula",
          htmlBackgroundConfig: {
            blurPx: 24,
            dim: 0,
            enabled: true,
            html: "<main>background</main>",
            opacity: 1,
            paused: true,
            renderMode: "dynamic",
            surfaceOpacity: 0.36,
          },
          overrides: {
            "surface-app-light": "#123456",
          },
        },
      ],
    })
  })

  it("falls back to the default built-in theme when the active id is invalid", () => {
    expect(normalizeAppearanceThemeDocument({
      activeThemeID: "missing",
      userThemes: [],
    }).activeThemeID).toBe(DEFAULT_APPEARANCE_THEME_ID)
  })

  it("combines built-in presets and user themes in snapshots", () => {
    const document = normalizeAppearanceThemeDocument({
      activeThemeID: "user:one",
      userThemes: [
        {
          id: "user:one",
          name: "Saved",
          colorMode: "light",
          brandTheme: "terra",
          fontFamily: "default",
          codeThemePreference: "auto",
          htmlBackgroundConfig: {},
          overrides: {},
        },
      ],
    })

    const snapshot = createAppearanceThemeLibrarySnapshot({
      path: "appearance-themes.json",
      exists: true,
      document,
    })

    expect(snapshot.activeThemeID).toBe("user:one")
    expect(snapshot.builtInThemes).toHaveLength(4)
    expect(snapshot.themes.map((theme) => theme.id)).toContain("user:one")
  })

  it("creates normalized user themes from save input", () => {
    expect(normalizeAppearanceThemeSaveInput({
      name: "Saved",
      colorMode: "dark",
      brandTheme: "sage",
      fontFamily: "pingfang",
      codeThemePreference: "nord",
      htmlBackgroundConfig: {
        enabled: true,
        html: "<style>body{background:red}</style>",
      },
      overrides: {
        "surface-panel-dark": "#111111",
      },
    }, {
      fallbackID: "user:new",
      now: 100,
    })).toMatchObject({
      id: "user:new",
      name: "Saved",
      source: "user",
      readonly: false,
      createdAt: 100,
      updatedAt: 100,
      colorMode: "dark",
      brandTheme: "sage",
      fontFamily: "pingfang",
      codeThemePreference: "nord",
      htmlBackgroundConfig: {
        enabled: true,
        html: "<style>body{background:red}</style>",
      },
      overrides: {
        "surface-panel-dark": "#111111",
      },
    })
  })

  it("creates an empty document by default", () => {
    expect(createDefaultAppearanceThemeDocument()).toEqual({
      version: 1,
      activeThemeID: DEFAULT_APPEARANCE_THEME_ID,
      userThemes: [],
    })
  })
})
