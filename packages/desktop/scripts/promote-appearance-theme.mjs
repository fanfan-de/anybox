import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Color from "colorjs.io"

const scriptPath = fileURLToPath(import.meta.url)
const scriptDirectory = path.dirname(scriptPath)
const packageDirectory = path.resolve(scriptDirectory, "..")
const workspaceDirectory = path.resolve(packageDirectory, "..", "..")
const manifestPath = path.join(packageDirectory, "src", "shared", "appearance-token-manifest.json")
const generatedArtifactPaths = [
  manifestPath,
  path.join(packageDirectory, "src", "shared", "appearance-tokens.generated.ts"),
  path.join(packageDirectory, "src", "renderer", "src", "styles", "appearance-tokens.generated.css"),
  path.join(workspaceDirectory, "docs", "desktop-semantic-token-catalog.md"),
]
const configFileName = "appearance-theme.json"
const VALID_COLOR_MODES = new Set(["system", "light", "dark"])
const VALID_BRAND_THEMES = new Set(["terra", "sage"])
const VALID_FONT_FAMILIES = new Set(["default", "system", "segoe", "microsoft-yahei", "pingfang"])
const VALID_CODE_THEMES = new Set([
  "auto",
  "github-light",
  "github-dark",
  "vitesse-light",
  "vitesse-dark",
  "nord",
  "dracula",
])
const BUILT_IN_THEME_ID_PATTERN = /^built-in:[a-z0-9][a-z0-9-]*$/
const DTCG_TO_COLOR_JS_SPACE = {
  "srgb": "srgb",
  "srgb-linear": "srgb-linear",
  "hsl": "hsl",
  "hwb": "hwb",
  "lab": "lab",
  "lch": "lch",
  "oklab": "oklab",
  "oklch": "oklch",
  "display-p3": "p3",
  "a98-rgb": "a98rgb",
  "prophoto-rgb": "prophoto",
  "rec2020": "rec2020",
  "xyz-d65": "xyz-d65",
  "xyz-d50": "xyz-d50",
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`)
  }
  return value
}

export function parsePromotionArguments(argv) {
  const options = {
    libraryPath: null,
    sourceThemeID: null,
    targetID: null,
    name: null,
    setDefault: false,
    legacyConfigPath: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--set-default") {
      options.setDefault = true
      continue
    }

    const option = [
      ["--library", "libraryPath"],
      ["--source-theme-id", "sourceThemeID"],
      ["--target-id", "targetID"],
      ["--name", "name"],
    ].find(([name]) => argument === name || argument.startsWith(`${name}=`))
    if (option) {
      const [optionName, key] = option
      const value = argument.startsWith(`${optionName}=`)
        ? argument.slice(optionName.length + 1)
        : readOptionValue(argv, index++, optionName)
      if (!value.trim()) throw new Error(`${optionName} requires a non-empty value.`)
      options[key] = value
      continue
    }

    if (argument.startsWith("--")) {
      throw new Error(`Unknown option "${argument}".`)
    }
    if (options.legacyConfigPath) {
      throw new Error("Only one legacy appearance config path may be provided.")
    }
    options.legacyConfigPath = argument
  }

  const usesLibraryMode = Boolean(
    options.libraryPath ||
    options.sourceThemeID ||
    options.targetID ||
    options.name ||
    options.setDefault,
  )
  if (usesLibraryMode) {
    for (const [key, optionName] of [
      ["libraryPath", "--library"],
      ["sourceThemeID", "--source-theme-id"],
      ["targetID", "--target-id"],
    ]) {
      if (!options[key]) throw new Error(`${optionName} is required in library promotion mode.`)
    }
    if (options.legacyConfigPath) {
      throw new Error("The legacy appearance config path cannot be combined with library promotion options.")
    }
  }

  return {
    ...options,
    mode: usesLibraryMode ? "library" : "legacy",
  }
}

function getDefaultConfigCandidates(explicitPath) {
  const candidates = []
  const configuredPath = explicitPath || process.env.APPEARANCE_THEME_SOURCE
  if (configuredPath) candidates.push(path.resolve(configuredPath))

  const appData = process.env.APPDATA
  if (appData) {
    candidates.push(path.join(appData, "anybox-desktop-agent", configFileName))
    candidates.push(path.join(appData, "Anybox", configFileName))
  }

  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) {
    candidates.push(path.join(localAppData, "anybox-desktop-agent", configFileName))
    candidates.push(path.join(localAppData, "Anybox", configFileName))
  }

  const homeDirectory = os.homedir()
  if (homeDirectory) {
    candidates.push(path.join(homeDirectory, "Library", "Application Support", "anybox-desktop-agent", configFileName))
    candidates.push(path.join(homeDirectory, "Library", "Application Support", "Anybox", configFileName))
    candidates.push(path.join(homeDirectory, ".config", "anybox-desktop-agent", configFileName))
    candidates.push(path.join(homeDirectory, ".config", "Anybox", configFileName))
  }

  return [...new Set(candidates)]
}

async function findConfigPath(explicitPath) {
  const candidates = getDefaultConfigCandidates(explicitPath)
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile()) return candidate
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
  }

  throw new Error(
    [
      `Could not find ${configFileName}.`,
      "Pass an explicit path: pnpm appearance:promote -- C:\\path\\to\\appearance-theme.json",
      "Or set APPEARANCE_THEME_SOURCE.",
    ].join("\n"),
  )
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value, precision = 6) {
  return Number(value.toFixed(precision))
}

function toHexChannel(value) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")
}

function colorToLiteral(color) {
  const srgb = color.to("srgb").toGamut({ space: "srgb", method: "clip" })
  const components = srgb.coords.map((component) =>
    round(clamp(typeof component === "number" ? component : 0, 0, 1)),
  )
  const channels = components.map((component) => Math.round(component * 255))

  return {
    type: "literal",
    value: {
      colorSpace: "srgb",
      components,
      alpha: round(clamp(typeof srgb.alpha === "number" ? srgb.alpha : 1, 0, 1)),
      hex: `#${channels.map(toHexChannel).join("")}`,
    },
  }
}

function normalizeTokenValue(input, tokenNameSet) {
  if (typeof input === "string") {
    const trimmed = input.trim()
    const alias = trimmed.match(/^var\(\s*--([a-zA-Z0-9_-]+)\s*\)$/)
    if (alias) {
      return tokenNameSet.has(alias[1])
        ? { type: "alias", token: alias[1] }
        : null
    }
    if (!trimmed) return null

    try {
      return colorToLiteral(new Color(trimmed))
    } catch {
      return null
    }
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null

  if (
    input.type === "alias" &&
    typeof input.token === "string" &&
    tokenNameSet.has(input.token)
  ) {
    return { type: "alias", token: input.token }
  }
  if (
    input.type !== "literal" ||
    !input.value ||
    typeof input.value !== "object" ||
    Array.isArray(input.value)
  ) {
    return null
  }

  const { colorSpace, components, alpha } = input.value
  if (
    typeof colorSpace !== "string" ||
    !Object.hasOwn(DTCG_TO_COLOR_JS_SPACE, colorSpace) ||
    !Array.isArray(components) ||
    components.length !== 3 ||
    components.some((component) => typeof component !== "number" || !Number.isFinite(component)) ||
    (alpha !== undefined && (typeof alpha !== "number" || !Number.isFinite(alpha)))
  ) {
    return null
  }

  try {
    return colorToLiteral(
      new Color(
        DTCG_TO_COLOR_JS_SPACE[colorSpace],
        components,
        typeof alpha === "number" ? alpha : 1,
      ),
    )
  } catch {
    return null
  }
}

function normalizeTokenMap(input, tokenNames) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}

  const tokenNameSet = new Set(tokenNames)
  const normalized = {}
  for (const tokenName of tokenNames) {
    const value = normalizeTokenValue(input[tokenName], tokenNameSet)
    if (value) normalized[tokenName] = value
  }
  return normalized
}

function hasForeignDtcg(input) {
  if (input === undefined || input === null) return false
  if (typeof input !== "object" || Array.isArray(input)) return true
  return Object.keys(input).length > 0
}

function requireEnumValue(value, allowed, label) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`${label} "${String(value)}" is unsupported.`)
  }
  return value
}

function getManifestTokenNames(manifest) {
  if (!Array.isArray(manifest.groups)) {
    throw new Error("Appearance token manifest groups must be an array.")
  }
  return manifest.groups.flatMap((group) =>
    group.rows.flatMap((row) => [row.lightToken, row.darkToken]),
  )
}

export function promoteLibraryTheme(manifest, library, options) {
  if (!Array.isArray(manifest.themes)) {
    throw new Error("Appearance token manifest themes must be an array.")
  }
  if (!BUILT_IN_THEME_ID_PATTERN.test(options.targetID)) {
    throw new Error(`--target-id must use the form "built-in:<slug>"; received "${options.targetID}".`)
  }
  if (!library || typeof library !== "object" || !Array.isArray(library.userThemes)) {
    throw new Error("Appearance theme library must contain a userThemes array.")
  }

  const sourceTheme = library.userThemes.find((theme) => theme?.id === options.sourceThemeID)
  if (!sourceTheme) {
    throw new Error(`Source theme "${options.sourceThemeID}" was not found in the appearance theme library.`)
  }
  if (sourceTheme.source !== "user" && sourceTheme.source !== "imported") {
    throw new Error(`Source theme "${options.sourceThemeID}" must be a user or imported theme.`)
  }
  if (hasForeignDtcg(sourceTheme.foreignDtcg)) {
    throw new Error(
      `Source theme "${options.sourceThemeID}" contains foreign DTCG data that cannot be promoted without loss.`,
    )
  }

  const existingIndex = manifest.themes.findIndex((theme) => theme.id === options.targetID)
  const existingTheme = existingIndex >= 0 ? manifest.themes[existingIndex] : null
  const requestedName = options.name?.trim()
  if (!existingTheme && !requestedName) {
    throw new Error("--name is required when creating a new built-in theme.")
  }

  const tokenNames = getManifestTokenNames(manifest)
  const promotedTheme = {
    id: options.targetID,
    name: requestedName || existingTheme.name,
    colorMode: requireEnumValue(sourceTheme.colorMode, VALID_COLOR_MODES, "Theme colorMode"),
    brandTheme: requireEnumValue(sourceTheme.brandTheme, VALID_BRAND_THEMES, "Theme brandTheme"),
    fontFamily: requireEnumValue(sourceTheme.fontFamily, VALID_FONT_FAMILIES, "Theme fontFamily"),
    codeThemePreference: requireEnumValue(
      sourceTheme.codeThemePreference,
      VALID_CODE_THEMES,
      "Theme codeThemePreference",
    ),
    overrides: normalizeTokenMap(sourceTheme.overrides, tokenNames),
  }

  if (existingIndex >= 0) {
    manifest.themes[existingIndex] = promotedTheme
  } else {
    manifest.themes.push(promotedTheme)
  }
  if (options.setDefault) {
    manifest.defaultThemeId = options.targetID
  }

  return {
    action: existingTheme ? "updated" : "created",
    sourceThemeID: sourceTheme.id,
    targetTheme: promotedTheme,
  }
}

export function promoteLegacyConfig(manifest, config) {
  const defaultTheme = manifest.themes?.find((theme) => theme.id === manifest.defaultThemeId)
  if (!defaultTheme) {
    throw new Error(`Could not find default theme ${manifest.defaultThemeId} in the token manifest.`)
  }

  const overrides = normalizeTokenMap(config.overrides, getManifestTokenNames(manifest))
  if (Object.keys(overrides).length === 0) {
    throw new Error("The selected appearance config has no valid overrides.")
  }

  defaultTheme.overrides = overrides
  if (VALID_BRAND_THEMES.has(config.brandTheme)) defaultTheme.brandTheme = config.brandTheme
  if (VALID_COLOR_MODES.has(config.colorMode)) defaultTheme.colorMode = config.colorMode
  if (VALID_FONT_FAMILIES.has(config.fontFamily)) defaultTheme.fontFamily = config.fontFamily

  return {
    action: "updated",
    sourceThemeID: null,
    targetTheme: defaultTheme,
  }
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const rollbackPath = `${filePath}.${process.pid}.${Date.now()}.rollback`
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  try {
    await fs.rename(temporaryPath, filePath)
    return
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") {
      await fs.rm(temporaryPath, { force: true })
      throw error
    }
  }

  await fs.rename(filePath, rollbackPath)
  try {
    await fs.rename(temporaryPath, filePath)
    await fs.rm(rollbackPath, { force: true })
  } catch (error) {
    await fs.rename(rollbackPath, filePath)
    await fs.rm(temporaryPath, { force: true })
    throw error
  }
}

async function snapshotFiles(filePaths) {
  return Promise.all(filePaths.map(async (filePath) => {
    try {
      return {
        filePath,
        exists: true,
        contents: await fs.readFile(filePath),
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
      return {
        filePath,
        exists: false,
        contents: null,
      }
    }
  }))
}

async function restoreFiles(snapshots) {
  const errors = []
  for (const snapshot of snapshots) {
    try {
      if (snapshot.exists) {
        await fs.writeFile(snapshot.filePath, snapshot.contents)
      } else {
        await fs.rm(snapshot.filePath, { force: true })
      }
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to restore appearance promotion files.")
  }
}

function runGenerator(scriptName) {
  const result = spawnSync(process.execPath, [path.join(scriptDirectory, scriptName)], {
    cwd: packageDirectory,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${scriptName} failed with exit code ${result.status ?? "unknown"}.`)
  }
}

async function generateDefaultArtifacts() {
  runGenerator("generate-appearance-tokens.mjs")
  runGenerator("generate-semantic-token-catalog.mjs")
}

export async function promoteAppearanceTheme(options) {
  const targetManifestPath = options.manifestPath ?? manifestPath
  const manifest = JSON.parse(await fs.readFile(targetManifestPath, "utf8"))
  let sourcePath
  let result

  if (options.mode === "library") {
    sourcePath = path.resolve(options.libraryPath)
    const library = JSON.parse(await fs.readFile(sourcePath, "utf8"))
    result = promoteLibraryTheme(manifest, library, options)
  } else {
    sourcePath = await findConfigPath(options.legacyConfigPath)
    const config = JSON.parse(await fs.readFile(sourcePath, "utf8"))
    result = promoteLegacyConfig(manifest, config)
  }

  const artifactPaths = options.artifactPaths ?? [targetManifestPath]
  const snapshots = await snapshotFiles(artifactPaths)
  try {
    await writeJsonAtomic(targetManifestPath, manifest)
    await (options.generateArtifacts?.() ?? Promise.resolve())
  } catch (error) {
    try {
      await restoreFiles(snapshots)
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Appearance promotion failed and generated files could not be fully restored.",
      )
    }
    throw error
  }

  return {
    ...result,
    manifestPath: targetManifestPath,
    sourcePath,
  }
}

async function main() {
  const options = parsePromotionArguments(process.argv.slice(2))
  const result = await promoteAppearanceTheme({
    ...options,
    artifactPaths: generatedArtifactPaths,
    generateArtifacts: generateDefaultArtifacts,
    manifestPath,
  })

  console.log(`Promoted appearance theme from ${result.sourcePath}`)
  console.log(
    `${result.action === "created" ? "Created" : "Updated"} ${
      path.relative(process.cwd(), result.manifestPath)
    } (${result.targetTheme.id})`,
  )
  console.log(`Overrides: ${Object.keys(result.targetTheme.overrides).length}`)
  if (options.setDefault) {
    console.log(`Default theme: ${result.targetTheme.id}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  await main()
}
