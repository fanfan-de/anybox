import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createDefaultAppearanceConfigDocument } from "../shared/appearance"
import { parseAppearanceColorLiteral } from "../shared/appearance-color"
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
  assertConsumerAppearanceThemeID,
  constrainConsumerAppearanceDocument,
  createConsumerAppearanceThemeSnapshot,
  migratePackagedAppearanceState,
  resolveConsumerAppearanceTheme,
} from "./appearance-consumer-policy"
import { writeAppearanceConfigSnapshot } from "./appearance-config"
import {
  readAppearanceThemesSnapshot,
  saveAppearanceTheme,
} from "./appearance-themes-config"

let tempDirectory = ""

function colorLiteral(value: string) {
  const literal = parseAppearanceColorLiteral(value)
  if (!literal) throw new Error(`Invalid test color: ${value}`)
  return literal
}

async function createActiveCustomTheme() {
  return saveAppearanceTheme({
    id: "user:legacy-active",
    name: "Legacy Active",
    source: "imported",
    colorMode: "light",
    brandTheme: "sage",
    fontFamily: "system",
    codeThemePreference: "dracula",
    overrides: {
      "surface-app-light": colorLiteral("#123456"),
    },
  })
}

beforeEach(async () => {
  tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "anybox-appearance-consumer-"))
  userDataPathMock.value = tempDirectory
})

afterEach(async () => {
  await fs.rm(tempDirectory, { force: true, recursive: true })
})

describe("consumer appearance policy", () => {
  it("accepts only built-in theme ids at the consumer IPC boundary", () => {
    expect(() => assertConsumerAppearanceThemeID(DEFAULT_APPEARANCE_THEME_ID)).not.toThrow()
    expect(() => assertConsumerAppearanceThemeID("user:private")).toThrow(
      "Consumer builds can only activate built-in appearance themes.",
    )
  })

  it("exposes only built-in themes and an empty user-theme document", async () => {
    await createActiveCustomTheme()
    const snapshot = createConsumerAppearanceThemeSnapshot(
      await readAppearanceThemesSnapshot(),
    )

    expect(snapshot.activeThemeID).toBe(DEFAULT_APPEARANCE_THEME_ID)
    expect(snapshot.document.userThemes).toEqual([])
    expect(snapshot.themes.length).toBe(snapshot.builtInThemes.length)
    expect(snapshot.themes.every((theme) => theme.source === "built-in")).toBe(true)
  })

  it("locks theme-owned fields while preserving color mode and font", async () => {
    const themes = await readAppearanceThemesSnapshot()
    const activeTheme = resolveConsumerAppearanceTheme(themes)
    const constrained = constrainConsumerAppearanceDocument({
      ...createDefaultAppearanceConfigDocument(),
      brandTheme: "sage",
      colorMode: "dark",
      fontFamily: "microsoft-yahei",
      overrides: {
        "surface-app-light": colorLiteral("#abcdef"),
      },
      foreignDtcg: {
        thirdParty: true,
      },
    }, activeTheme)

    expect(constrained).toMatchObject({
      brandTheme: activeTheme.brandTheme,
      colorMode: "dark",
      fontFamily: "microsoft-yahei",
      overrides: activeTheme.overrides,
      foreignDtcg: activeTheme.foreignDtcg,
    })
  })

  it("backs up legacy authoring state, falls back to the default built-in theme, and is idempotent", async () => {
    await createActiveCustomTheme()
    await writeAppearanceConfigSnapshot({
      ...createDefaultAppearanceConfigDocument(),
      brandTheme: "sage",
      colorMode: "dark",
      fontFamily: "segoe",
      overrides: {
        "surface-app-light": colorLiteral("#654321"),
      },
      foreignDtcg: {
        imported: {
          value: "kept in backup",
        },
      },
    })
    const configPath = path.join(tempDirectory, "appearance-theme.json")
    const themesPath = path.join(tempDirectory, "appearance-themes.json")
    const rawConfig = await fs.readFile(configPath, "utf8")
    const rawThemes = await fs.readFile(themesPath, "utf8")

    const result = await migratePackagedAppearanceState()

    expect(result.migrated).toBe(true)
    expect(result.themeSnapshot.activeThemeID).toBe(DEFAULT_APPEARANCE_THEME_ID)
    expect(result.themeSnapshot.document.userThemes).toHaveLength(1)
    expect(result.configSnapshot.document.colorMode).toBe("dark")
    expect(result.configSnapshot.document.fontFamily).toBe("segoe")
    const activeTheme = resolveConsumerAppearanceTheme(result.themeSnapshot)
    expect(result.configSnapshot.document.brandTheme).toBe(activeTheme.brandTheme)
    expect(result.configSnapshot.document.overrides).toEqual(activeTheme.overrides)
    expect(result.configSnapshot.document.foreignDtcg).toEqual(activeTheme.foreignDtcg)
    await expect(fs.readFile(
      path.join(tempDirectory, "appearance-theme.v2.backup.json"),
      "utf8",
    )).resolves.toBe(rawConfig)
    await expect(fs.readFile(
      path.join(tempDirectory, "appearance-themes.v2.backup.json"),
      "utf8",
    )).resolves.toBe(rawThemes)

    await expect(migratePackagedAppearanceState()).resolves.toMatchObject({
      migrated: false,
    })
  })

  it("does not overwrite an existing one-time backup", async () => {
    const backupPath = path.join(tempDirectory, "appearance-theme.v2.backup.json")
    await fs.writeFile(backupPath, "sentinel backup", "utf8")
    await writeAppearanceConfigSnapshot({
      ...createDefaultAppearanceConfigDocument(),
      overrides: {
        "surface-app-light": colorLiteral("#222222"),
      },
    })

    await migratePackagedAppearanceState()

    await expect(fs.readFile(backupPath, "utf8")).resolves.toBe("sentinel backup")
  })

  it("rolls back the active-theme write when config normalization fails", async () => {
    await createActiveCustomTheme()
    await writeAppearanceConfigSnapshot({
      ...createDefaultAppearanceConfigDocument(),
      brandTheme: "sage",
      overrides: {
        "surface-app-light": colorLiteral("#333333"),
      },
    })
    const configPath = path.join(tempDirectory, "appearance-theme.json")
    const themesPath = path.join(tempDirectory, "appearance-themes.json")
    const rawConfig = await fs.readFile(configPath, "utf8")
    const rawThemes = await fs.readFile(themesPath, "utf8")

    await expect(migratePackagedAppearanceState({
      writeConfigSnapshot: vi.fn(async (document) => {
        await writeAppearanceConfigSnapshot(document)
        throw new Error("disk full")
      }),
    })).rejects.toThrow("disk full")

    await expect(fs.readFile(configPath, "utf8")).resolves.toBe(rawConfig)
    await expect(fs.readFile(themesPath, "utf8")).resolves.toBe(rawThemes)
  })
})
