import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Color from "colorjs.io"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const packageDirectory = path.resolve(scriptDirectory, "..")
const manifestPath = path.join(packageDirectory, "src", "shared", "appearance-token-manifest.json")
const configFileName = "appearance-theme.json"
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

function getDefaultConfigCandidates() {
  const candidates = []
  const explicitPath = process.argv[2] || process.env.APPEARANCE_THEME_SOURCE
  if (explicitPath) {
    candidates.push(path.resolve(explicitPath))
  }

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

async function findConfigPath() {
  const candidates = getDefaultConfigCandidates()
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
      "Pass an explicit path: pnpm run appearance:promote -- C:\\path\\to\\appearance-theme.json",
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
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {}
  }

  const tokenNameSet = new Set(tokenNames)
  const normalized = {}
  for (const tokenName of tokenNames) {
    const value = normalizeTokenValue(input[tokenName], tokenNameSet)
    if (value) normalized[tokenName] = value
  }

  return normalized
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

const configPath = await findConfigPath()
const config = JSON.parse(await fs.readFile(configPath, "utf8"))
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
const tokenNames = manifest.groups.flatMap((group) =>
  group.rows.flatMap((row) => [row.lightToken, row.darkToken]),
)
const overrides = normalizeTokenMap(config.overrides, tokenNames)

if (Object.keys(overrides).length === 0) {
  throw new Error("The selected appearance config has no valid overrides.")
}

const defaultTheme = manifest.themes.find((theme) => theme.id === manifest.defaultThemeId)
if (!defaultTheme) {
  throw new Error(`Could not find default theme ${manifest.defaultThemeId} in the token manifest.`)
}

defaultTheme.overrides = overrides
if (config.brandTheme === "terra" || config.brandTheme === "sage") {
  defaultTheme.brandTheme = config.brandTheme
}
if (config.colorMode === "system" || config.colorMode === "light" || config.colorMode === "dark") {
  defaultTheme.colorMode = config.colorMode
}
if (["default", "system", "segoe", "microsoft-yahei", "pingfang"].includes(config.fontFamily)) {
  defaultTheme.fontFamily = config.fontFamily
}

await writeJsonAtomic(manifestPath, manifest)

console.log(`Promoted appearance defaults from ${configPath}`)
console.log(`Updated ${path.relative(process.cwd(), manifestPath)} (${defaultTheme.id})`)
console.log(`Overrides: ${Object.keys(overrides).length}`)
