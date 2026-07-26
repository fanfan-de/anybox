import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_APPEARANCE_THEME_ID } from "../shared/appearance-themes"
import { parseAppearanceColorLiteral } from "../shared/appearance-color"

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
  renameAppearanceTheme,
  saveAppearanceTheme,
  setActiveAppearanceTheme,
} from "./appearance-themes-config"

let tempDirectory = ""

function colorLiteral(value: string) {
  const literal = parseAppearanceColorLiteral(value)
  if (!literal) throw new Error(`Invalid test color: ${value}`)
  return literal
}

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
        version: 2,
        activeThemeID: DEFAULT_APPEARANCE_THEME_ID,
        userThemes: [],
      },
      builtInThemes: [
        { id: DEFAULT_APPEARANCE_THEME_ID, readonly: true },
        { id: "built-in:transparent-frosted", readonly: true },
        { id: "built-in:sage-slate", readonly: true },
        { id: "built-in:night-workbench", readonly: true },
        { id: "built-in:soft-light", readonly: true },
      ],
    })
  })

  it("backs up and migrates a v1 theme library", async () => {
    const filePath = path.join(tempDirectory, "appearance-themes.json")
    const legacy = {
      version: 1,
      activeThemeID: "user:legacy",
      userThemes: [
        {
          id: "user:legacy",
          name: "Legacy",
          source: "user",
          readonly: false,
          createdAt: 1,
          updatedAt: 2,
          colorMode: "light",
          brandTheme: "terra",
          fontFamily: "default",
          codeThemePreference: "auto",
          overrides: {
            "surface-app-light": "#123456",
          },
        },
      ],
    }
    const raw = `${JSON.stringify(legacy, null, 2)}\n`
    await writeFile(filePath, raw, "utf8")

    const snapshot = await readAppearanceThemesSnapshot()

    expect(snapshot.document.version).toBe(2)
    expect(snapshot.document.userThemes[0].overrides).toEqual({
      "surface-app-light": colorLiteral("#123456"),
    })
    expect(snapshot.document.userThemes[0].foreignDtcg).toEqual({})
    await expect(readFile(
      path.join(tempDirectory, "appearance-themes.v1.backup.json"),
      "utf8",
    )).resolves.toBe(raw)
    await expect(readFile(filePath, "utf8").then(JSON.parse)).resolves.toMatchObject({
      version: 2,
    })
  })

  it("surfaces corrupt and invalid current theme libraries", async () => {
    const filePath = path.join(tempDirectory, "appearance-themes.json")
    await writeFile(filePath, "{not-json", "utf8")
    await expect(readAppearanceThemesSnapshot()).rejects.toThrow()
    await expect(readFile(filePath, "utf8")).resolves.toBe("{not-json")

    await writeFile(filePath, JSON.stringify({
      version: 2,
      activeThemeID: DEFAULT_APPEARANCE_THEME_ID,
      userThemes: [
        {
          id: "user:broken",
          name: "Broken",
          overrides: {},
        },
      ],
    }), "utf8")
    await expect(readAppearanceThemesSnapshot()).rejects.toThrow(
      /Appearance config is missing/,
    )
  })

  it("saves and reads user themes", async () => {
    const result = await saveAppearanceTheme({
      id: "user:work",
      name: "Work",
      colorMode: "dark",
      brandTheme: "sage",
      fontFamily: "default",
      codeThemePreference: "dracula",
      overrides: {
        "surface-panel-dark": colorLiteral("#111111"),
      },
    })

    expect(result.theme).toMatchObject({
      id: "user:work",
      name: "Work",
      source: "user",
      readonly: false,
      codeThemePreference: "dracula",
      overrides: {
        "surface-panel-dark": colorLiteral("#111111"),
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

  it("saves with existing themes that use renamed settings list-detail tokens", async () => {
    const filePath = path.join(tempDirectory, "appearance-themes.json")
    const legacyToken = "semantic-settings-list-detail-row-surface-hover-light"
    const currentToken = "semantic-list-detail-row-surface-hover-light"
    const legacyValue = colorLiteral("#c4c4c4")
    const userThemes = Array.from({ length: 4 }, (_, index) => ({
      id: `user:legacy-${index + 1}`,
      name: `Legacy ${index + 1}`,
      source: "user",
      readonly: false,
      createdAt: index + 1,
      updatedAt: index + 1,
      colorMode: "light",
      brandTheme: "terra",
      fontFamily: "default",
      codeThemePreference: "auto",
      overrides: {
        [legacyToken]: legacyValue,
      },
      foreignDtcg: {},
    }))
    await writeFile(filePath, JSON.stringify({
      version: 2,
      activeThemeID: DEFAULT_APPEARANCE_THEME_ID,
      userThemes,
    }), "utf8")

    const result = await saveAppearanceTheme({
      id: "user:current",
      name: "Current",
      colorMode: "light",
      brandTheme: "terra",
      fontFamily: "default",
      codeThemePreference: "auto",
      overrides: {},
    })

    expect(result.snapshot.activeThemeID).toBe("user:current")
    expect(result.snapshot.document.userThemes).toHaveLength(5)
    for (const theme of result.snapshot.document.userThemes.slice(0, 4)) {
      expect(theme.overrides).not.toHaveProperty(legacyToken)
      expect(theme.overrides).toHaveProperty(currentToken, legacyValue)
    }

    const persisted = JSON.parse(await readFile(filePath, "utf8"))
    expect(persisted.userThemes).toHaveLength(5)
    for (const theme of persisted.userThemes.slice(0, 4)) {
      expect(theme.overrides).not.toHaveProperty(legacyToken)
      expect(theme.overrides).toHaveProperty(currentToken, legacyValue)
    }
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
      overrides: {},
    })

    const snapshot = await deleteAppearanceTheme("user:work")

    expect(snapshot.activeThemeID).toBe(DEFAULT_APPEARANCE_THEME_ID)
    expect(snapshot.document.userThemes).toEqual([])
  })

  it("does not delete built-in themes", async () => {
    await expect(deleteAppearanceTheme(DEFAULT_APPEARANCE_THEME_ID)).rejects.toThrow("Built-in themes cannot be deleted.")
  })

  it("renames user themes without changing the active theme", async () => {
    await saveAppearanceTheme({
      id: "user:active",
      name: "Active",
      colorMode: "light",
      brandTheme: "terra",
      fontFamily: "default",
      codeThemePreference: "auto",
      overrides: {},
    })
    await saveAppearanceTheme({
      id: "user:target",
      name: "Target",
      colorMode: "dark",
      brandTheme: "sage",
      fontFamily: "default",
      codeThemePreference: "auto",
      overrides: {
        "surface-panel-dark": colorLiteral("#111111"),
      },
    })
    await setActiveAppearanceTheme("user:active")

    const result = await renameAppearanceTheme({
      themeID: "user:target",
      name: "  Renamed   Target  ",
    })

    expect(result.theme).toMatchObject({
      id: "user:target",
      name: "Renamed Target",
      colorMode: "dark",
      brandTheme: "sage",
      overrides: {
        "surface-panel-dark": colorLiteral("#111111"),
      },
    })
    expect(result.snapshot.activeThemeID).toBe("user:active")
    await expect(readAppearanceThemesSnapshot()).resolves.toMatchObject({
      activeThemeID: "user:active",
      document: {
        userThemes: expect.arrayContaining([
          expect.objectContaining({
            id: "user:target",
            name: "Renamed Target",
          }),
        ]),
      },
    })
  })

  it("does not rename built-in themes", async () => {
    await expect(renameAppearanceTheme({
      themeID: DEFAULT_APPEARANCE_THEME_ID,
      name: "Renamed",
    })).rejects.toThrow("Built-in themes cannot be renamed.")
  })

  it("sets active theme ids for built-in and user themes", async () => {
    await saveAppearanceTheme({
      id: "user:work",
      name: "Work",
      colorMode: "light",
      brandTheme: "terra",
      fontFamily: "default",
      codeThemePreference: "auto",
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
