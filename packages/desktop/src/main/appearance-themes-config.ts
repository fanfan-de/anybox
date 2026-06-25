import { app } from "electron"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import {
  DEFAULT_APPEARANCE_THEME_ID,
  createAppearanceThemeLibrarySnapshot,
  createDefaultAppearanceThemeDocument,
  findAppearanceThemeByID,
  isBuiltInAppearanceThemeID,
  normalizeAppearanceThemeDocument,
  normalizeAppearanceThemeID,
  normalizeAppearanceThemeSaveInput,
  type AppearanceTheme,
  type AppearanceThemeDocument,
  type AppearanceThemeDuplicateInput,
  type AppearanceThemeLibrarySnapshot,
  type AppearanceThemeMutationResult,
  type AppearanceThemeSaveInput,
} from "../shared/appearance-themes"

const APPEARANCE_THEMES_FILE_NAME = "appearance-themes.json"

export function getAppearanceThemesPath() {
  return path.join(app.getPath("userData"), APPEARANCE_THEMES_FILE_NAME)
}

function createUserThemeID() {
  return `user:${randomUUID()}`
}

async function writeAppearanceThemeDocument(
  configPath: string,
  input: AppearanceThemeDocument,
): Promise<AppearanceThemeDocument> {
  const document = normalizeAppearanceThemeDocument(input)
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  await fs.writeFile(configPath, `${JSON.stringify(document, null, 2)}\n`, "utf8")
  return document
}

export async function readAppearanceThemesSnapshot(): Promise<AppearanceThemeLibrarySnapshot> {
  const configPath = getAppearanceThemesPath()

  try {
    const raw = await fs.readFile(configPath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    return createAppearanceThemeLibrarySnapshot({
      path: configPath,
      exists: true,
      document: normalizeAppearanceThemeDocument(parsed),
    })
  } catch {
    return createAppearanceThemeLibrarySnapshot({
      path: configPath,
      exists: false,
      document: createDefaultAppearanceThemeDocument(),
    })
  }
}

export async function writeAppearanceThemesSnapshot(
  input: AppearanceThemeDocument,
): Promise<AppearanceThemeLibrarySnapshot> {
  const configPath = getAppearanceThemesPath()
  const document = await writeAppearanceThemeDocument(configPath, input)

  return createAppearanceThemeLibrarySnapshot({
    path: configPath,
    exists: true,
    document,
  })
}

export async function saveAppearanceTheme(
  input: AppearanceThemeSaveInput,
): Promise<AppearanceThemeMutationResult> {
  const snapshot = await readAppearanceThemesSnapshot()
  const requestedID = normalizeAppearanceThemeID(input.id)
  const existingTheme = requestedID
    ? snapshot.document.userThemes.find((theme) => theme.id === requestedID)
    : null
  const theme = normalizeAppearanceThemeSaveInput(input, {
    fallbackID: existingTheme?.id ?? createUserThemeID(),
    existingTheme: existingTheme ?? undefined,
  })
  const userThemes = existingTheme
    ? snapshot.document.userThemes.map((item) => item.id === existingTheme.id ? theme : item)
    : [...snapshot.document.userThemes, theme]
  const nextSnapshot = await writeAppearanceThemesSnapshot({
    ...snapshot.document,
    activeThemeID: theme.id,
    userThemes,
  })

  return {
    snapshot: nextSnapshot,
    theme: findAppearanceThemeByID(nextSnapshot.themes, theme.id),
  }
}

export async function duplicateAppearanceTheme(
  input: AppearanceThemeDuplicateInput,
): Promise<AppearanceThemeMutationResult> {
  const snapshot = await readAppearanceThemesSnapshot()
  const sourceTheme = findAppearanceThemeByID(snapshot.themes, input.themeID)
  if (!sourceTheme) {
    throw new Error("Theme not found.")
  }

  const theme = normalizeAppearanceThemeSaveInput({
    ...sourceTheme,
    id: createUserThemeID(),
    name: input.name?.trim() || `${sourceTheme.name} Copy`,
    source: "user",
  }, {
    fallbackID: createUserThemeID(),
  })
  const nextSnapshot = await writeAppearanceThemesSnapshot({
    ...snapshot.document,
    userThemes: [...snapshot.document.userThemes, theme],
  })

  return {
    snapshot: nextSnapshot,
    theme: findAppearanceThemeByID(nextSnapshot.themes, theme.id),
  }
}

export async function deleteAppearanceTheme(themeID: string): Promise<AppearanceThemeLibrarySnapshot> {
  if (isBuiltInAppearanceThemeID(themeID)) {
    throw new Error("Built-in themes cannot be deleted.")
  }

  const snapshot = await readAppearanceThemesSnapshot()
  const userThemes = snapshot.document.userThemes.filter((theme) => theme.id !== themeID)
  const activeThemeID = snapshot.document.activeThemeID === themeID
    ? DEFAULT_APPEARANCE_THEME_ID
    : snapshot.document.activeThemeID

  return writeAppearanceThemesSnapshot({
    ...snapshot.document,
    activeThemeID,
    userThemes,
  })
}

export async function setActiveAppearanceTheme(themeID: string): Promise<AppearanceThemeLibrarySnapshot> {
  const snapshot = await readAppearanceThemesSnapshot()
  const theme = findAppearanceThemeByID(snapshot.themes, themeID)
  if (!theme) {
    throw new Error("Theme not found.")
  }

  return writeAppearanceThemesSnapshot({
    ...snapshot.document,
    activeThemeID: theme.id,
  })
}

export function createAppearanceThemeSaveInputFromTheme(theme: AppearanceTheme): AppearanceThemeSaveInput {
  return {
    id: theme.id,
    name: theme.name,
    source: theme.source,
    colorMode: theme.colorMode,
    brandTheme: theme.brandTheme,
    fontFamily: theme.fontFamily,
    codeThemePreference: theme.codeThemePreference,
    htmlBackgroundConfig: { ...theme.htmlBackgroundConfig },
    overrides: { ...theme.overrides },
  }
}
