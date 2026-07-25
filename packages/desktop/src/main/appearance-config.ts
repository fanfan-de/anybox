import { app } from "electron"
import fs from "node:fs/promises"
import path from "node:path"
import {
  createDefaultAppearanceConfigDocument,
  normalizeAppearanceConfigDocument,
  validateAppearanceConfigDocumentStructure,
  type AppearanceConfigDocument,
  type AppearanceConfigSnapshot,
} from "../shared/appearance"
import { preserveVersionedJsonBackup, writeJsonFileAtomic } from "./atomic-json-file"

const APPEARANCE_CONFIG_FILE_NAME = "appearance-theme.json"

export function getAppearanceConfigPath() {
  return path.join(app.getPath("userData"), APPEARANCE_CONFIG_FILE_NAME)
}

function createTimestampedAppearanceDocument(
  input: AppearanceConfigDocument,
): AppearanceConfigDocument {
  return {
    ...input,
    updatedAt: Date.now(),
  }
}

async function writeAppearanceConfigDocumentToPath(
  configPath: string,
  input: AppearanceConfigDocument,
): Promise<AppearanceConfigDocument> {
  const errors = validateAppearanceConfigDocumentStructure(input, {
    requireComplete: true,
  })
  if (errors.length > 0) {
    throw new Error(`Invalid appearance config:\n${errors.join("\n")}`)
  }

  const normalized = normalizeAppearanceConfigDocument(input)
  const document = createTimestampedAppearanceDocument(normalized)
  await writeJsonFileAtomic(configPath, document)
  return document
}

function isLegacyAppearanceConfig(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  return (input as { version?: unknown }).version !== 2
}

export async function readAppearanceConfigSnapshot(): Promise<AppearanceConfigSnapshot> {
  const configPath = getAppearanceConfigPath()

  try {
    const raw = await fs.readFile(configPath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    const errors = validateAppearanceConfigDocumentStructure(parsed, {
      requireComplete: !isLegacyAppearanceConfig(parsed),
    })
    if (errors.length > 0) {
      throw new Error(`Invalid appearance config:\n${errors.join("\n")}`)
    }

    const document = normalizeAppearanceConfigDocument(parsed)
    if (isLegacyAppearanceConfig(parsed)) {
      await preserveVersionedJsonBackup(configPath, raw, 1)
      await writeJsonFileAtomic(configPath, document)
    }

    return {
      path: configPath,
      exists: true,
      document,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {
        path: configPath,
        exists: false,
        document: createDefaultAppearanceConfigDocument(),
      }
    }

    throw error
  }
}

export async function writeAppearanceConfigSnapshot(
  input: AppearanceConfigDocument,
): Promise<AppearanceConfigSnapshot> {
  const configPath = getAppearanceConfigPath()
  const document = await writeAppearanceConfigDocumentToPath(configPath, input)

  return {
    path: configPath,
    exists: true,
    document,
  }
}
