import fs from "node:fs/promises"
import {
  createDefaultAppearanceConfigDocument,
  normalizeAppearanceConfigDocument,
  type AppearanceConfigDocument,
  type AppearanceConfigSnapshot,
  type AppearanceRuntimeState,
} from "../shared/appearance"
import {
  DEFAULT_APPEARANCE_THEME_ID,
  createAppearanceThemeLibrarySnapshot,
  findAppearanceThemeByID,
  isBuiltInAppearanceThemeID,
  type AppearanceTheme,
  type AppearanceThemeLibrarySnapshot,
} from "../shared/appearance-themes"
import {
  getAppearanceConfigPath,
  readAppearanceConfigSnapshot,
  writeAppearanceConfigSnapshot,
} from "./appearance-config"
import {
  getAppearanceThemesPath,
  readAppearanceThemesSnapshot,
  writeAppearanceThemesSnapshot,
} from "./appearance-themes-config"
import {
  preserveVersionedJsonBackup,
  writeTextFileAtomic,
} from "./atomic-json-file"

export interface PackagedAppearanceMigrationResult {
  configSnapshot: AppearanceConfigSnapshot
  migrated: boolean
  themeSnapshot: AppearanceThemeLibrarySnapshot
}

export interface PackagedAppearanceMigrationIO {
  readConfigSnapshot: typeof readAppearanceConfigSnapshot
  readThemeSnapshot: typeof readAppearanceThemesSnapshot
  writeConfigSnapshot: typeof writeAppearanceConfigSnapshot
  writeThemeSnapshot: typeof writeAppearanceThemesSnapshot
}

interface RawFileSnapshot {
  exists: boolean
  raw: string
}

function cloneTheme(theme: AppearanceTheme): AppearanceTheme {
  return {
    ...theme,
    overrides: { ...theme.overrides },
    foreignDtcg: structuredClone(theme.foreignDtcg),
  }
}

export function resolveConsumerAppearanceTheme(
  snapshot: AppearanceThemeLibrarySnapshot,
): AppearanceTheme {
  const activeBuiltIn = snapshot.builtInThemes.find(
    (theme) => theme.id === snapshot.activeThemeID,
  )
  const defaultBuiltIn = findAppearanceThemeByID(
    snapshot.builtInThemes,
    DEFAULT_APPEARANCE_THEME_ID,
  )
  const fallback = activeBuiltIn ?? defaultBuiltIn ?? snapshot.builtInThemes[0]
  if (!fallback) {
    throw new Error("No built-in appearance themes are available.")
  }
  return cloneTheme(fallback)
}

export function createConsumerAppearanceThemeSnapshot(
  snapshot: AppearanceThemeLibrarySnapshot,
): AppearanceThemeLibrarySnapshot {
  const activeTheme = resolveConsumerAppearanceTheme(snapshot)
  return createAppearanceThemeLibrarySnapshot({
    path: snapshot.path,
    exists: snapshot.exists,
    document: {
      version: 2,
      activeThemeID: activeTheme.id,
      userThemes: [],
    },
  })
}

export function assertConsumerAppearanceThemeID(themeID: string) {
  if (!isBuiltInAppearanceThemeID(themeID)) {
    throw new Error("Consumer builds can only activate built-in appearance themes.")
  }
}

export function constrainConsumerAppearanceDocument(
  input: AppearanceConfigDocument,
  activeTheme: AppearanceTheme,
): AppearanceConfigDocument {
  const normalizedInput = normalizeAppearanceConfigDocument(input)
  return normalizeAppearanceConfigDocument({
    version: 2,
    brandTheme: activeTheme.brandTheme,
    colorMode: normalizedInput.colorMode,
    fontFamily: normalizedInput.fontFamily,
    codeFontFamily: normalizedInput.codeFontFamily,
    overrides: activeTheme.overrides,
    foreignDtcg: activeTheme.foreignDtcg,
    updatedAt: normalizedInput.updatedAt,
  })
}

export function constrainConsumerAppearanceRuntimeState(
  input: AppearanceRuntimeState,
  activeTheme: AppearanceTheme,
): AppearanceRuntimeState {
  return {
    document: constrainConsumerAppearanceDocument(input.document, activeTheme),
    codeThemePreference: activeTheme.codeThemePreference,
  }
}

function hasConsumerThemeOwnedConfig(
  document: AppearanceConfigDocument,
  activeTheme: AppearanceTheme,
) {
  return (
    document.brandTheme === activeTheme.brandTheme &&
    JSON.stringify(document.overrides) === JSON.stringify(activeTheme.overrides) &&
    JSON.stringify(document.foreignDtcg) === JSON.stringify(activeTheme.foreignDtcg)
  )
}

async function readRawFileSnapshot(filePath: string): Promise<RawFileSnapshot> {
  try {
    return {
      exists: true,
      raw: await fs.readFile(filePath, "utf8"),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        exists: false,
        raw: "",
      }
    }
    throw error
  }
}

async function restoreRawFile(filePath: string, snapshot: RawFileSnapshot) {
  if (!snapshot.exists) {
    await fs.rm(filePath, { force: true })
    return
  }
  await writeTextFileAtomic(filePath, snapshot.raw)
}

export async function migratePackagedAppearanceState(
  overrides: Partial<PackagedAppearanceMigrationIO> = {},
): Promise<PackagedAppearanceMigrationResult> {
  const io: PackagedAppearanceMigrationIO = {
    readConfigSnapshot: overrides.readConfigSnapshot ?? readAppearanceConfigSnapshot,
    readThemeSnapshot: overrides.readThemeSnapshot ?? readAppearanceThemesSnapshot,
    writeConfigSnapshot: overrides.writeConfigSnapshot ?? writeAppearanceConfigSnapshot,
    writeThemeSnapshot: overrides.writeThemeSnapshot ?? writeAppearanceThemesSnapshot,
  }
  const [configSnapshot, themeSnapshot] = await Promise.all([
    io.readConfigSnapshot(),
    io.readThemeSnapshot(),
  ])
  const activeTheme = resolveConsumerAppearanceTheme(themeSnapshot)
  const mustFallbackToBuiltIn = !isBuiltInAppearanceThemeID(themeSnapshot.activeThemeID)
  const mustNormalizeConfig = !hasConsumerThemeOwnedConfig(
    configSnapshot.document,
    activeTheme,
  )

  if (!mustFallbackToBuiltIn && !mustNormalizeConfig) {
    return {
      configSnapshot,
      migrated: false,
      themeSnapshot,
    }
  }

  const configPath = getAppearanceConfigPath()
  const themesPath = getAppearanceThemesPath()
  const [rawConfig, rawThemes] = await Promise.all([
    readRawFileSnapshot(configPath),
    readRawFileSnapshot(themesPath),
  ])

  await Promise.all([
    rawConfig.exists
      ? preserveVersionedJsonBackup(configPath, rawConfig.raw, 2)
      : Promise.resolve(),
    rawThemes.exists
      ? preserveVersionedJsonBackup(themesPath, rawThemes.raw, 2)
      : Promise.resolve(),
  ])

  let wroteConfig = false
  let wroteThemes = false
  try {
    let nextThemeSnapshot = themeSnapshot
    if (mustFallbackToBuiltIn) {
      wroteThemes = true
      nextThemeSnapshot = await io.writeThemeSnapshot({
        ...themeSnapshot.document,
        activeThemeID: activeTheme.id,
      })
    }

    let nextConfigSnapshot = configSnapshot
    if (mustNormalizeConfig) {
      wroteConfig = true
      nextConfigSnapshot = await io.writeConfigSnapshot(
        constrainConsumerAppearanceDocument(configSnapshot.document, activeTheme),
      )
    }

    return {
      configSnapshot: nextConfigSnapshot,
      migrated: true,
      themeSnapshot: nextThemeSnapshot,
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    if (wroteConfig) {
      await restoreRawFile(configPath, rawConfig).catch((rollbackError) => {
        rollbackErrors.push(rollbackError)
      })
    }
    if (wroteThemes) {
      await restoreRawFile(themesPath, rawThemes).catch((rollbackError) => {
        rollbackErrors.push(rollbackError)
      })
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Packaged appearance migration failed and could not be fully rolled back.",
      )
    }
    throw error
  }
}

export function createSafeConsumerAppearanceState(): {
  configSnapshot: AppearanceConfigSnapshot
  themeSnapshot: AppearanceThemeLibrarySnapshot
} {
  const configPath = getAppearanceConfigPath()
  const themeSnapshot = createAppearanceThemeLibrarySnapshot({
    path: getAppearanceThemesPath(),
    exists: false,
    document: {
      version: 2,
      activeThemeID: DEFAULT_APPEARANCE_THEME_ID,
      userThemes: [],
    },
  })
  const activeTheme = resolveConsumerAppearanceTheme(themeSnapshot)
  return {
    configSnapshot: {
      path: configPath,
      exists: false,
      document: constrainConsumerAppearanceDocument(
        createDefaultAppearanceConfigDocument(),
        activeTheme,
      ),
    },
    themeSnapshot,
  }
}
