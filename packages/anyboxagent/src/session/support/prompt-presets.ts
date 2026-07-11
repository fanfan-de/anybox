import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import matter from "gray-matter"
import * as Config from "#config/config.ts"
import { getProcessEnvValue } from "#env/compat.ts"
import PROMPT_ANTHROPIC from "../prompt/anthropic.md" with { type: "text" }
import PROMPT_BEAST from "../prompt/beast.md" with { type: "text" }
import PROMPT_CINEMA_TEXT_GENERATION from "../prompt/cinema-text-generation.md" with { type: "text" }
import PROMPT_CODEX from "../prompt/codex.md" with { type: "text" }
import PROMPT_CODEXSYSTEM from "../prompt/codexsystem.md" with { type: "text" }
import PROMPT_CODEXSYSTEM_ZH_HANS from "../prompt/codexsystem.zh-hans.md" with { type: "text" }
import PROMPT_DEFAULT from "../prompt/default.md" with { type: "text" }
import PROMPT_GEMINI from "../prompt/gemini.md" with { type: "text" }
import PROMPT_GIT_COMMIT_MESSAGE from "../prompt/git-commit-message.md" with { type: "text" }
import PROMPT_GPT from "../prompt/gpt.md" with { type: "text" }
import PROMPT_KIMI from "../prompt/kimi.md" with { type: "text" }
import PROMPT_PLAN_REMINDER_ANTHROPIC from "../prompt/plan-reminder-anthropic.md" with { type: "text" }
import PROMPT_PLAN from "../prompt/plan.md" with { type: "text" }
import PROMPT_SIDE_CHAT from "../prompt/side-chat.md" with { type: "text" }
import PROMPT_TRINITY from "../prompt/trinity.md" with { type: "text" }

export type PromptPresetSource = "bundled" | "custom"
export type PromptPresetTarget = "system" | "plan" | "side-chat" | "git-commit"

export interface PromptPresetSelection {
  systemPromptPresetID: string
  planModePromptPresetID: string
  sideChatPromptPresetID: string
  gitCommitPromptPresetID: string
  cinemaTextGenerationPromptPresetID: string
}

export interface PromptPresetSummary {
  id: string
  label: string
  description: string
  source: PromptPresetSource
  editable: boolean
  hasOverride: boolean
  sourcePath?: string
  filePath?: string
  root?: string
}

export interface PromptPresetDocument extends PromptPresetSummary {
  content: string
}

export interface PromptPresetCreateInput {
  label?: string
  content?: string
  description?: string
}

export interface PromptPresetUpdateInput {
  label?: string
  content: string
  description?: string
}

interface PromptPresetDefinition {
  id: string
  label: string
  description: string
  sourcePath: string
  bundledContent: string
}

interface PromptPresetRecord extends PromptPresetDocument {
  seedHash?: string
}

interface PromptFileMetadata {
  id: string
  label: string
  description?: string
  source: PromptPresetSource
  seedHash?: string
}

export class PromptPresetStoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "PromptPresetStoreError"
  }
}

const PROMPT_ROOT_ENV = "ANYBOX_PROMPTS_ROOT"
const BUNDLED_PROMPT_DIRECTORY = "bundled"
const CUSTOM_PROMPT_DIRECTORY = "custom"
const PROMPT_FILE_EXTENSION = ".md"

const DEFAULT_PROMPT_PRESET_SELECTION: PromptPresetSelection = {
  systemPromptPresetID: "system-codex",
  planModePromptPresetID: "plan-mode",
  sideChatPromptPresetID: "side-chat",
  gitCommitPromptPresetID: "git-commit-message",
  cinemaTextGenerationPromptPresetID: "cinema-text-generation",
}

const PROMPT_PRESET_DEFINITIONS: PromptPresetDefinition[] = [
  {
    id: "system-default",
    label: "System prompt",
    description: "Base instructions applied to every session turn.",
    sourcePath: "src/session/prompt/default.md",
    bundledContent: PROMPT_DEFAULT,
  },
  {
    id: "system-codex",
    label: "codexsystem prompt",
    description: "Codex-style default system instructions for coding sessions.",
    sourcePath: "src/session/prompt/codexsystem.md",
    bundledContent: PROMPT_CODEXSYSTEM,
  },
  {
    id: "system-codex-zh-hans",
    label: "codexsystem prompt - 简体中文",
    description: "Simplified Chinese version of the Codex-style default system instructions.",
    sourcePath: "src/session/prompt/codexsystem.zh-hans.md",
    bundledContent: PROMPT_CODEXSYSTEM_ZH_HANS,
  },
  {
    id: "plan-mode",
    label: "Plan mode prompt",
    description: "Additional instructions appended when the plan agent is active.",
    sourcePath: "src/session/prompt/plan.md",
    bundledContent: PROMPT_PLAN,
  },
  {
    id: "side-chat",
    label: "Side chat prompt",
    description: "Additional instructions appended when a side chat session is active.",
    sourcePath: "src/session/prompt/side-chat.md",
    bundledContent: PROMPT_SIDE_CHAT,
  },
  {
    id: "git-commit-message",
    label: "Git commit message prompt",
    description: "Instructions used when auto-generating Git commit subjects.",
    sourcePath: "src/session/prompt/git-commit-message.md",
    bundledContent: PROMPT_GIT_COMMIT_MESSAGE,
  },
  {
    id: "cinema-text-generation",
    label: "Cinema text generation prompt",
    description: "System instructions used when generating content for Cinema text nodes.",
    sourcePath: "src/session/prompt/cinema-text-generation.md",
    bundledContent: PROMPT_CINEMA_TEXT_GENERATION,
  },
  {
    id: "provider-anthropic",
    label: "Anthropic Provider Prompt",
    description: "Reserved provider-specific prompt for Anthropic models.",
    sourcePath: "src/session/prompt/anthropic.md",
    bundledContent: PROMPT_ANTHROPIC,
  },
  {
    id: "provider-beast",
    label: "Beast Provider Prompt",
    description: "Reserved provider-specific prompt for Beast-style model routing.",
    sourcePath: "src/session/prompt/beast.md",
    bundledContent: PROMPT_BEAST,
  },
  {
    id: "provider-gemini",
    label: "Gemini Provider Prompt",
    description: "Reserved provider-specific prompt for Gemini models.",
    sourcePath: "src/session/prompt/gemini.md",
    bundledContent: PROMPT_GEMINI,
  },
  {
    id: "provider-gpt",
    label: "GPT Provider Prompt",
    description: "Reserved provider-specific prompt for GPT-family models.",
    sourcePath: "src/session/prompt/gpt.md",
    bundledContent: PROMPT_GPT,
  },
  {
    id: "provider-kimi",
    label: "Kimi Provider Prompt",
    description: "Reserved provider-specific prompt for Kimi models.",
    sourcePath: "src/session/prompt/kimi.md",
    bundledContent: PROMPT_KIMI,
  },
  {
    id: "provider-codex",
    label: "Codex Provider Prompt",
    description: "Reserved provider-specific prompt for Codex models.",
    sourcePath: "src/session/prompt/codex.md",
    bundledContent: PROMPT_CODEX,
  },
  {
    id: "provider-trinity",
    label: "Trinity Provider Prompt",
    description: "Reserved provider-specific prompt for Trinity models.",
    sourcePath: "src/session/prompt/trinity.md",
    bundledContent: PROMPT_TRINITY,
  },
  {
    id: "helper-plan-reminder-anthropic",
    label: "Anthropic Plan Reminder",
    description: "Helper prompt reserved for provider-specific planning reminders.",
    sourcePath: "src/session/prompt/plan-reminder-anthropic.md",
    bundledContent: PROMPT_PLAN_REMINDER_ANTHROPIC,
  },
]

function getPromptPresetDefinition(presetID: string) {
  const normalizedPresetID = presetID.trim()
  return PROMPT_PRESET_DEFINITIONS.find((preset) => preset.id === normalizedPresetID)
}

function requirePromptPresetDefinition(presetID: string) {
  const preset = getPromptPresetDefinition(presetID)
  if (!preset) {
    throw new Error(`Unknown prompt preset '${presetID}'.`)
  }

  return preset
}

function ensurePathInsideRoot(root: string, input: string) {
  const resolvedRoot = resolve(root)
  const candidate = resolve(input)
  const relativePath = relative(resolvedRoot, candidate)

  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return candidate
  }

  throw new PromptPresetStoreError(
    "INVALID_PROMPT_PATH",
    `Prompt path '${input}' is outside the prompts root.`,
  )
}

async function pathExists(path: string) {
  return Boolean(await stat(path).catch(() => null))
}

function getPromptPresetSeedHash(content: string) {
  return createHash("sha256").update(content).digest("hex")
}

function slugifyPromptPresetLabel(label: string) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug || "preset"
}

function sanitizePromptPresetDescription(description: string | undefined) {
  return description?.trim() || undefined
}

function sanitizePromptPresetLabel(label: string | undefined) {
  return label?.trim() || ""
}

function createCustomPromptPresetID(label: string, existingPresetIDs: Set<string>) {
  const baseID = `custom-${slugifyPromptPresetLabel(label)}`
  let candidateID = baseID
  let suffix = 2

  while (existingPresetIDs.has(candidateID)) {
    candidateID = `${baseID}-${suffix}`
    suffix += 1
  }

  return candidateID
}

function createPromptFileNameFromID(presetID: string) {
  const slug = slugifyPromptPresetLabel(presetID)
  return `${slug}${PROMPT_FILE_EXTENSION}`
}

export function getPromptPresetRoot() {
  const configuredRoot = getProcessEnvValue(PROMPT_ROOT_ENV)?.trim()
  return configuredRoot ? resolve(configuredRoot) : join(homedir(), ".anybox", "prompts")
}

function getBundledPromptDirectory(root: string) {
  return join(root, BUNDLED_PROMPT_DIRECTORY)
}

function getCustomPromptDirectory(root: string) {
  return join(root, CUSTOM_PROMPT_DIRECTORY)
}

function getBundledPromptFilePath(root: string, presetID: string) {
  return join(getBundledPromptDirectory(root), `${presetID}${PROMPT_FILE_EXTENSION}`)
}

async function getCustomPromptFilePath(root: string, presetID: string) {
  const customRoot = getCustomPromptDirectory(root)
  let candidate = join(customRoot, createPromptFileNameFromID(presetID))
  let suffix = 2

  while (await pathExists(candidate)) {
    candidate = join(customRoot, `${slugifyPromptPresetLabel(presetID)}-${suffix}${PROMPT_FILE_EXTENSION}`)
    suffix += 1
  }

  return candidate
}

function buildPromptFile(metadata: PromptFileMetadata, content: string) {
  const frontmatter = matter.stringify("", Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  )).trimEnd()

  return `${frontmatter}\n${content}`
}

async function writePromptFile(filePath: string, root: string, metadata: PromptFileMetadata, content: string) {
  const resolvedPath = ensurePathInsideRoot(root, filePath)
  await mkdir(dirname(resolvedPath), { recursive: true })
  await writeFile(resolvedPath, buildPromptFile(metadata, content), "utf8")

  return resolvedPath
}

function readStringFrontmatter(
  value: Record<string, unknown>,
  key: string,
  filePath: string,
  options?: {
    required?: boolean
  },
) {
  const raw = value[key]
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (trimmed || !options?.required) return trimmed
  }

  if (options?.required) {
    throw new PromptPresetStoreError(
      "INVALID_PROMPT_FILE",
      `Prompt file '${filePath}' must define a non-empty '${key}' frontmatter field.`,
    )
  }

  return undefined
}

function readPromptSourceFrontmatter(value: Record<string, unknown>, filePath: string) {
  const source = readStringFrontmatter(value, "source", filePath, { required: true })
  if (source === "bundled" || source === "custom") {
    return source
  }

  throw new PromptPresetStoreError(
    "INVALID_PROMPT_FILE",
    `Prompt file '${filePath}' must use source 'bundled' or 'custom'.`,
  )
}

async function readPromptFile(filePath: string, root: string): Promise<PromptPresetRecord> {
  const resolvedPath = ensurePathInsideRoot(root, filePath)
  const raw = await readFile(resolvedPath, "utf8")
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>
  const id = readStringFrontmatter(data, "id", resolvedPath, { required: true })!
  const label = readStringFrontmatter(data, "label", resolvedPath, { required: true })!
  const source = readPromptSourceFrontmatter(data, resolvedPath)
  const description = readStringFrontmatter(data, "description", resolvedPath)
  const seedHash = readStringFrontmatter(data, "seedHash", resolvedPath)

  return {
    id,
    label,
    description: description ?? "Custom prompt preset.",
    source,
    editable: true,
    hasOverride: false,
    sourcePath: resolvedPath,
    filePath: resolvedPath,
    root,
    content: parsed.content,
    seedHash,
  }
}

async function writeBundledPromptFile(root: string, preset: PromptPresetDefinition, content: string) {
  return writePromptFile(
    getBundledPromptFilePath(root, preset.id),
    root,
    {
      id: preset.id,
      label: preset.label,
      description: preset.description,
      source: "bundled",
      seedHash: getPromptPresetSeedHash(preset.bundledContent),
    },
    content,
  )
}

async function writeCustomPromptFile(
  root: string,
  filePath: string,
  presetID: string,
  preset: Config.CustomPromptPreset,
) {
  return writePromptFile(
    filePath,
    root,
    {
      id: presetID,
      label: preset.label,
      description: preset.description,
      source: "custom",
    },
    preset.content,
  )
}

async function readCustomPromptPresetRecordsInDirectory(
  root: string,
  directory: string,
): Promise<PromptPresetRecord[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  })
  const records = await Promise.all(entries
    .filter((entry) => !entry.name.startsWith("."))
    .map(async (entry) => {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        return readCustomPromptPresetRecordsInDirectory(root, entryPath)
      }

      if (!entry.isFile() || !entry.name.endsWith(PROMPT_FILE_EXTENSION)) return []
      const record = await readPromptFile(entryPath, root)
      if (record.source !== "custom") {
        throw new PromptPresetStoreError(
          "INVALID_PROMPT_FILE",
          `Custom prompt file '${entryPath}' must use source 'custom'.`,
        )
      }

      return [record]
    }))

  return records.flat()
}

async function readCustomPromptPresetRecords(root: string) {
  return (await readCustomPromptPresetRecordsInDirectory(root, getCustomPromptDirectory(root)))
    .toSorted((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
}

async function getLegacyCustomPromptPresetRecords(configID = Config.GLOBAL_CONFIG_ID) {
  const customPromptPresets = await Config.getCustomPromptPresets(configID)

  return Object.fromEntries(
    Object.entries(customPromptPresets).filter(([presetID]) => !getPromptPresetDefinition(presetID)),
  )
}

async function ensurePromptRoot(configID = Config.GLOBAL_CONFIG_ID) {
  const root = getPromptPresetRoot()
  const bundledRoot = getBundledPromptDirectory(root)
  const customRoot = getCustomPromptDirectory(root)
  await mkdir(bundledRoot, { recursive: true })
  await mkdir(customRoot, { recursive: true })

  const [legacyOverrides, legacyCustomPresets] = await Promise.all([
    Config.getPromptOverrides(configID),
    getLegacyCustomPromptPresetRecords(configID),
  ])

  for (const preset of PROMPT_PRESET_DEFINITIONS) {
    const filePath = getBundledPromptFilePath(root, preset.id)
    const hasLegacyOverride = Object.prototype.hasOwnProperty.call(legacyOverrides, preset.id)
    if (hasLegacyOverride || !await pathExists(filePath)) {
      await writeBundledPromptFile(
        root,
        preset,
        hasLegacyOverride ? (legacyOverrides[preset.id] ?? "") : preset.bundledContent,
      )
    }
  }

  const existingCustomRecords = await readCustomPromptPresetRecords(root)
  const existingCustomByID = new Map(existingCustomRecords.map((record) => [record.id, record]))
  for (const [presetID, preset] of Object.entries(legacyCustomPresets)) {
    const filePath = existingCustomByID.get(presetID)?.filePath ?? await getCustomPromptFilePath(root, presetID)
    await writeCustomPromptFile(root, filePath, presetID, preset)
  }

  if (Object.keys(legacyOverrides).length > 0 || Object.keys(legacyCustomPresets).length > 0) {
    await Config.clearPromptPresetLegacyStorage(configID)
  }

  return root
}

async function readBundledPromptPresetRecords(root: string) {
  const records: PromptPresetRecord[] = []

  for (const preset of PROMPT_PRESET_DEFINITIONS) {
    const filePath = getBundledPromptFilePath(root, preset.id)
    const record = await readPromptFile(filePath, root)
    if (record.source !== "bundled" || record.id !== preset.id) {
      throw new PromptPresetStoreError(
        "INVALID_PROMPT_FILE",
        `Bundled prompt file '${filePath}' must use id '${preset.id}' and source 'bundled'.`,
      )
    }

    const seedHash = getPromptPresetSeedHash(preset.bundledContent)
    records.push({
      ...record,
      label: preset.label,
      description: record.description || preset.description,
      hasOverride: getPromptPresetSeedHash(record.content) !== seedHash,
      seedHash,
    })
  }

  return records
}

async function readPromptPresetIndex(configID = Config.GLOBAL_CONFIG_ID) {
  const root = await ensurePromptRoot(configID)
  const bundledRecords = await readBundledPromptPresetRecords(root)
  const customRecords = await readCustomPromptPresetRecords(root)
  const recordsByID = new Map<string, PromptPresetRecord>()

  for (const record of [...bundledRecords, ...customRecords]) {
    if (recordsByID.has(record.id)) {
      throw new PromptPresetStoreError(
        "DUPLICATE_PROMPT_PRESET",
        `Prompt preset id '${record.id}' is defined more than once.`,
      )
    }

    recordsByID.set(record.id, record)
  }

  return {
    root,
    records: [...bundledRecords, ...customRecords],
    recordsByID,
  }
}

function toPromptPresetSummary(record: PromptPresetRecord): PromptPresetSummary {
  return {
    id: record.id,
    label: record.label,
    description: record.description,
    source: record.source,
    editable: record.editable,
    hasOverride: record.hasOverride,
    sourcePath: record.sourcePath,
    filePath: record.filePath,
    root: record.root,
  }
}

function normalizePromptPresetSelectionValue(
  presetID: string | undefined | null,
  availablePresetIDs: Set<string>,
  fallbackPresetID: string,
) {
  const normalizedPresetID = presetID?.trim()
  if (normalizedPresetID && availablePresetIDs.has(normalizedPresetID)) {
    return normalizedPresetID
  }

  return fallbackPresetID
}

async function listAvailablePromptPresetIDs(configID = Config.GLOBAL_CONFIG_ID) {
  const index = await readPromptPresetIndex(configID)
  return new Set<string>(index.records.map((record) => record.id))
}

async function persistPromptPresetSelection(
  selection: PromptPresetSelection,
  configID = Config.GLOBAL_CONFIG_ID,
) {
  await Config.setSelectedPromptPresetIDs(configID, selection)
  return selection
}

export function getBundledPromptPresetContent(presetID: string) {
  return requirePromptPresetDefinition(presetID).bundledContent
}

export async function getResolvedPromptPresetContent(
  presetID: string,
  configID = Config.GLOBAL_CONFIG_ID,
) {
  const index = await readPromptPresetIndex(configID)
  const record = index.recordsByID.get(presetID.trim())
  if (!record) {
    throw new Error(`Unknown prompt preset '${presetID}'.`)
  }

  return record.content
}

export async function getPromptPresetSelection(
  configID = Config.GLOBAL_CONFIG_ID,
): Promise<PromptPresetSelection> {
  const [
    availablePresetIDs,
    selectedSystemPromptPresetID,
    selectedPlanModePromptPresetID,
    selectedSideChatPromptPresetID,
    selectedGitCommitPromptPresetID,
    selectedCinemaTextGenerationPromptPresetID,
  ] = await Promise.all([
    listAvailablePromptPresetIDs(configID),
    Config.getSelectedSystemPromptPresetID(configID),
    Config.getSelectedPlanModePromptPresetID(configID),
    Config.getSelectedSideChatPromptPresetID(configID),
    Config.getSelectedGitCommitPromptPresetID(configID),
    Config.getSelectedCinemaTextGenerationPromptPresetID(configID),
  ])

  return {
    systemPromptPresetID: normalizePromptPresetSelectionValue(
      selectedSystemPromptPresetID,
      availablePresetIDs,
      DEFAULT_PROMPT_PRESET_SELECTION.systemPromptPresetID,
    ),
    planModePromptPresetID: normalizePromptPresetSelectionValue(
      selectedPlanModePromptPresetID,
      availablePresetIDs,
      DEFAULT_PROMPT_PRESET_SELECTION.planModePromptPresetID,
    ),
    sideChatPromptPresetID: normalizePromptPresetSelectionValue(
      selectedSideChatPromptPresetID,
      availablePresetIDs,
      DEFAULT_PROMPT_PRESET_SELECTION.sideChatPromptPresetID,
    ),
    gitCommitPromptPresetID: normalizePromptPresetSelectionValue(
      selectedGitCommitPromptPresetID,
      availablePresetIDs,
      DEFAULT_PROMPT_PRESET_SELECTION.gitCommitPromptPresetID,
    ),
    cinemaTextGenerationPromptPresetID: normalizePromptPresetSelectionValue(
      selectedCinemaTextGenerationPromptPresetID,
      availablePresetIDs,
      DEFAULT_PROMPT_PRESET_SELECTION.cinemaTextGenerationPromptPresetID,
    ),
  }
}

export async function updatePromptPresetSelection(
  selection: PromptPresetSelection,
  configID = Config.GLOBAL_CONFIG_ID,
) {
  const availablePresetIDs = await listAvailablePromptPresetIDs(configID)
  const normalizedSelection: PromptPresetSelection = {
    systemPromptPresetID: selection.systemPromptPresetID.trim(),
    planModePromptPresetID: selection.planModePromptPresetID.trim(),
    sideChatPromptPresetID: selection.sideChatPromptPresetID.trim(),
    gitCommitPromptPresetID: selection.gitCommitPromptPresetID.trim(),
    cinemaTextGenerationPromptPresetID: selection.cinemaTextGenerationPromptPresetID.trim(),
  }

  if (!availablePresetIDs.has(normalizedSelection.systemPromptPresetID)) {
    throw new Error(`Unknown prompt preset '${selection.systemPromptPresetID}'.`)
  }

  if (!availablePresetIDs.has(normalizedSelection.planModePromptPresetID)) {
    throw new Error(`Unknown prompt preset '${selection.planModePromptPresetID}'.`)
  }

  if (!availablePresetIDs.has(normalizedSelection.sideChatPromptPresetID)) {
    throw new Error(`Unknown prompt preset '${selection.sideChatPromptPresetID}'.`)
  }

  if (!availablePresetIDs.has(normalizedSelection.gitCommitPromptPresetID)) {
    throw new Error(`Unknown prompt preset '${selection.gitCommitPromptPresetID}'.`)
  }

  if (!availablePresetIDs.has(normalizedSelection.cinemaTextGenerationPromptPresetID)) {
    throw new Error(`Unknown prompt preset '${selection.cinemaTextGenerationPromptPresetID}'.`)
  }

  return persistPromptPresetSelection(normalizedSelection, configID)
}

export async function listPromptPresetSummaries(
  configID = Config.GLOBAL_CONFIG_ID,
): Promise<PromptPresetSummary[]> {
  const index = await readPromptPresetIndex(configID)
  return index.records.map(toPromptPresetSummary)
}

export async function readPromptPresetDocument(
  presetID: string,
  configID = Config.GLOBAL_CONFIG_ID,
): Promise<PromptPresetDocument> {
  const index = await readPromptPresetIndex(configID)
  const record = index.recordsByID.get(presetID.trim())
  if (!record) {
    throw new Error(`Unknown prompt preset '${presetID}'.`)
  }

  return record
}

export async function createPromptPreset(
  input: PromptPresetCreateInput,
  configID = Config.GLOBAL_CONFIG_ID,
) {
  const label = sanitizePromptPresetLabel(input.label) || "Untitled preset"
  const index = await readPromptPresetIndex(configID)
  const existingPresetIDs = new Set(index.records.map((record) => record.id))
  const presetID = createCustomPromptPresetID(label, existingPresetIDs)
  const filePath = await getCustomPromptFilePath(index.root, presetID)
  await writeCustomPromptFile(index.root, filePath, presetID, {
    label,
    content: input.content ?? "",
    description: sanitizePromptPresetDescription(input.description),
  })

  return readPromptPresetDocument(presetID, configID)
}

export async function updatePromptPreset(
  presetID: string,
  input: PromptPresetUpdateInput,
  configID = Config.GLOBAL_CONFIG_ID,
) {
  const normalizedPresetID = presetID.trim()
  const bundledPreset = getPromptPresetDefinition(normalizedPresetID)
  if (bundledPreset) {
    const root = await ensurePromptRoot(configID)
    await writeBundledPromptFile(root, bundledPreset, input.content)
    return readPromptPresetDocument(bundledPreset.id, configID)
  }

  const index = await readPromptPresetIndex(configID)
  const customPromptPreset = index.recordsByID.get(normalizedPresetID)
  if (!customPromptPreset || customPromptPreset.source !== "custom") {
    throw new Error(`Unknown prompt preset '${presetID}'.`)
  }

  const label = sanitizePromptPresetLabel(input.label) || customPromptPreset.label
  await writeCustomPromptFile(index.root, customPromptPreset.filePath!, customPromptPreset.id, {
    label,
    content: input.content,
    description: sanitizePromptPresetDescription(input.description) ?? customPromptPreset.description,
  })

  return readPromptPresetDocument(customPromptPreset.id, configID)
}

export async function resetPromptPreset(
  presetID: string,
  configID = Config.GLOBAL_CONFIG_ID,
) {
  const preset = getPromptPresetDefinition(presetID)
  if (!preset) {
    throw new Error(`Prompt preset '${presetID}' cannot be reset.`)
  }

  const root = await ensurePromptRoot(configID)
  await writeBundledPromptFile(root, preset, preset.bundledContent)
  return readPromptPresetDocument(preset.id, configID)
}

export async function deletePromptPreset(
  presetID: string,
  configID = Config.GLOBAL_CONFIG_ID,
) {
  if (getPromptPresetDefinition(presetID)) {
    throw new Error(`Prompt preset '${presetID}' cannot be deleted.`)
  }

  const index = await readPromptPresetIndex(configID)
  const customPromptPreset = index.recordsByID.get(presetID.trim())
  if (!customPromptPreset || customPromptPreset.source !== "custom") {
    throw new Error(`Unknown prompt preset '${presetID}'.`)
  }

  const filePath = ensurePathInsideRoot(index.root, customPromptPreset.filePath!)
  await rm(filePath, { force: false })
  const resolvedSelection = await getPromptPresetSelection(configID)
  const nextSelection: PromptPresetSelection = {
    systemPromptPresetID:
      resolvedSelection.systemPromptPresetID === presetID
        ? DEFAULT_PROMPT_PRESET_SELECTION.systemPromptPresetID
        : resolvedSelection.systemPromptPresetID,
    planModePromptPresetID:
      resolvedSelection.planModePromptPresetID === presetID
        ? DEFAULT_PROMPT_PRESET_SELECTION.planModePromptPresetID
        : resolvedSelection.planModePromptPresetID,
    sideChatPromptPresetID:
      resolvedSelection.sideChatPromptPresetID === presetID
        ? DEFAULT_PROMPT_PRESET_SELECTION.sideChatPromptPresetID
        : resolvedSelection.sideChatPromptPresetID,
    gitCommitPromptPresetID:
      resolvedSelection.gitCommitPromptPresetID === presetID
        ? DEFAULT_PROMPT_PRESET_SELECTION.gitCommitPromptPresetID
        : resolvedSelection.gitCommitPromptPresetID,
    cinemaTextGenerationPromptPresetID:
      resolvedSelection.cinemaTextGenerationPromptPresetID === presetID
        ? DEFAULT_PROMPT_PRESET_SELECTION.cinemaTextGenerationPromptPresetID
        : resolvedSelection.cinemaTextGenerationPromptPresetID,
  }

  return persistPromptPresetSelection(nextSelection, configID)
}
