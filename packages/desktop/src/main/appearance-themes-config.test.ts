import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_APPEARANCE_THEME_ID } from "../shared/appearance-themes"

const userDataPathMock = vi.hoisted(() => ({
  value: "",
}))

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => userDataPathMock.value),
  },
}))

import {
  deleteAppearanceTheme,
  duplicateAppearanceTheme,
  readAppearanceThemesSnapshot,
  saveAppearanceTheme,
  setActiveAppearanceTheme,
} from "./appearance-themes-config"

let tempDirectory = ""

beforeEach(async () => {
  tempDirectory = await mkdtemp(path.join(os.tmpdir(), "anybox-appearance-themes-"))
  userDataPathMock.value = tempDirectory
})

afterEach(async () => {
  await rm(tempDirectory, { force: true, recursive: true })
})

describe("appearance theme library persistence", () => {
  it("returns an empty user library when no persisted file exists", async () => {
    await expect(readAppearanceThemesSnapshot()).resolves.toMatchObject({
      exists: false,
      activeThemeID: DEFAULT_APPEARANCE_THEME_ID,
      document: {
        version: 1,
        activeThemeID: DEFAULT_APPEARANCE_THEME_ID,
        userThemes: [],
      },
      builtInThemes: [
        { id: DEFAULT_APPEARANCE_THEME_ID, readonly: true },
        { id: "built-in:sage-slate", readonly: true },
        { id: "built-in:night-workbench", readonly: true },
        { id: "built-in:soft-light", readonly: true },
      ],
    })
  })

  it("saves and reads user themes", async () => {
    const result = await saveAppearanceTheme({
      id: "user:work",
      name: "Work",
      colorMode: "dark",
      brandTheme: "sage",
      fontFamily: "default",
      codeThemePreference: "dracula",
      htmlBackgroundConfig: {
        blurPx: 4,
        dim: 0.2,
        enabled: true,
        html: "<main>background</main>",
        opacity: 0.8,
        paused: false,
        renderMode: "static",
        surfaceOpacity: 0.72,
      },
      overrides: {
        "surface-panel-dark": "#111111",
      },
    })

    expect(result.theme).toMatchObject({
      id: "user:work",
      name: "Work",
      source: "user",
      readonly: false,
      codeThemePreference: "dracula",
      htmlBackgroundConfig: {
        enabled: true,
        html: "<main>background</main>",
      },
      overrides: {
        "surface-panel-dark": "#111111",
      },
    })
    expect(result.snapshot.activeThemeID).toBe("user:work")

    await expect(readAppearanceThemesSnapshot()).resolves.toMatchObject({
      exists: true,
      activeThemeID: "user:work",
      document: {
        userThemes: [
          {
            id: "user:work",
            name: "Work",
          },
        ],
      },
    })
  })

  it("duplicates built-in themes as user themes", async () => {
    const result = await duplicateAppearanceTheme({
      themeID: "built-in:sage-slate",
      name: "Sage Copy",
    })

    expect(result.theme).toMatchObject({
      name: "Sage Copy",
      source: "user",
      readonly: false,
      brandTheme: "sage",
    })
    expect(result.theme?.id.startsWith("user:")).toBe(true)
    expect(result.snapshot.document.userThemes).toHaveLength(1)
  })

  it("deletes active user themes and falls back to the default built-in theme", async () => {
    await saveAppearanceTheme({
      id: "user:work",
      name: "Work",
      colorMode: "dark",
      brandTheme: "sage",
      fontFamily: "default",
      codeThemePreference: "auto",
      htmlBackgroundConfig: {
        blurPx: 0,
        dim: 0.18,
        enabled: false,
        html: "",
        opacity: 0.78,
        paused: false,
        renderMode: "static",
        surfaceOpacity: 0.68,
      },
      overrides: {},
    })

    const snapshot = await deleteAppearanceTheme("user:work")

    expect(snapshot.activeThemeID).toBe(DEFAULT_APPEARANCE_THEME_ID)
    expect(snapshot.document.userThemes).toEqual([])
  })

  it("does not delete built-in themes", async () => {
    await expect(deleteAppearanceTheme(DEFAULT_APPEARANCE_THEME_ID)).rejects.toThrow("Built-in themes cannot be deleted.")
  })

  it("sets active theme ids for built-in and user themes", async () => {
    await saveAppearanceTheme({
      id: "user:work",
      name: "Work",
      colorMode: "light",
      brandTheme: "terra",
      fontFamily: "default",
      codeThemePreference: "auto",
      htmlBackgroundConfig: {
        blurPx: 0,
        dim: 0.18,
        enabled: false,
        html: "",
        opacity: 0.78,
        paused: false,
        renderMode: "static",
        surfaceOpacity: 0.68,
      },
      overrides: {},
    })

    await expect(setActiveAppearanceTheme("built-in:soft-light")).resolves.toMatchObject({
      activeThemeID: "built-in:soft-light",
    })
    await expect(setActiveAppearanceTheme("user:work")).resolves.toMatchObject({
      activeThemeID: "user:work",
    })
  })
})
