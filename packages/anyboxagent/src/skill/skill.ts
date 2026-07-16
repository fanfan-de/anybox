import { readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import matter from "gray-matter"
import z from "zod"
import * as Config from "#config/config.ts"
import * as Plugin from "#plugin/plugin.ts"
import { Instance } from "#project/instance.ts"
import { listEnabledManagedRegistrySkillRoots } from "#skill/registry/managed-store.ts"
import * as Filesystem from "#util/filesystem.ts"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "skill" })
const SKILL_FILENAME = "SKILL.md"
const skillSessionState = Instance.state(() => new Map<string, {
  allowedSkillIDs: string[] | null
  loadedSkillIDs: Set<string>
}>())

export const SkillScope = z.enum(["project", "user", "plugin", "registry"]).meta({
  ref: "SkillScope",
})
export type SkillScope = z.infer<typeof SkillScope>

export const SkillInfo = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    path: z.string(),
    scope: SkillScope,
  })
  .meta({
    ref: "SkillInfo",
  })
export type SkillInfo = z.infer<typeof SkillInfo>

export interface SkillDocument extends SkillInfo {
  body: string
}

export interface SkillDiscoveryOptions {
  pluginIDs?: string[] | null
}

const SkillFrontmatter = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough()

function normalizeSkillPathID(root: string, directoryPath: string) {
  const relativePath = relative(root, directoryPath).replace(/\\/g, "/")
  return relativePath || basename(directoryPath)
}

function buildSkillID(scope: SkillScope, skillPathID: string) {
  return `${scope}:${skillPathID}`
}

function buildPluginSkillID(pluginID: string, directoryName: string) {
  return `plugin:${pluginID}:${directoryName}`
}

function firstParagraph(markdown: string) {
  for (const section of markdown.split(/\r?\n\s*\r?\n/)) {
    const collapsed = section
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/^#+\s*/, "")
      .trim()
    if (collapsed) return collapsed
  }

  return ""
}

function skillRoots(projectRoot: string) {
  return [
    {
      scope: "project" as const,
      root: join(projectRoot, ".anybox", "skills"),
    },
    {
      scope: "user" as const,
      root: join(homedir(), ".anybox", "skills"),
    },
  ]
}

function userSkillRoot() {
  return join(homedir(), ".anybox", "skills")
}

function normalizeSkillIDs(skillIDs: string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const skillID of skillIDs) {
    const trimmed = skillID.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

function toSkillInfo(skill: SkillDocument): SkillInfo {
  const { body: _body, ...info } = skill
  return info
}

function getSessionSkillState(sessionID: string) {
  const state = skillSessionState()
  let entry = state.get(sessionID)
  if (!entry) {
    entry = {
      allowedSkillIDs: null,
      loadedSkillIDs: new Set<string>(),
    }
    state.set(sessionID, entry)
  }

  return entry
}

function isSkillAllowed(skillID: string, allowedSkillIDs: string[] | null | undefined) {
  if (!allowedSkillIDs || allowedSkillIDs.length === 0) return true
  return allowedSkillIDs.includes(skillID)
}

function ensureRelativeSkillResourcePath(inputPath: string) {
  const trimmed = inputPath.trim()
  if (!trimmed) {
    throw new Error("Skill resource path must not be empty.")
  }
  if (isAbsolute(trimmed)) {
    throw new Error("Skill resource path must be relative to the skill directory.")
  }

  return trimmed
}

function toPromptSkillSummary(skill: SkillInfo) {
  return [
    `<skill_summary id="${skill.id}" name="${skill.name}" scope="${skill.scope}">`,
    `description: ${skill.description}`,
    `path: ${skill.path}`,
    `</skill_summary>`,
  ].join("\n")
}

async function readSkillDocument(
  scope: SkillScope,
  directoryPath: string,
  options?: {
    pluginID?: string
    root?: string
    skillID?: string
  },
): Promise<SkillDocument | undefined> {
  const path = join(directoryPath, SKILL_FILENAME)
  if (!(await Filesystem.exists(path))) return undefined

  const raw = await Filesystem.readText(path)
  const parsed = matter(raw)
  const frontmatter = SkillFrontmatter.parse(parsed.data ?? {})
  const directoryName = basename(directoryPath)
  const skillPathID = options?.root ? normalizeSkillPathID(options.root, directoryPath) : directoryName
  const body = parsed.content.trim()
  const description = (frontmatter.description?.trim() || firstParagraph(body) || directoryName).trim()

  return {
    id: options?.skillID ?? (scope === "plugin" && options?.pluginID
      ? buildPluginSkillID(options.pluginID, skillPathID)
      : buildSkillID(scope, skillPathID)),
    name: (frontmatter.name?.trim() || directoryName).trim(),
    description,
    path,
    scope,
    body,
  }
}

async function discoverInDirectory(scope: SkillScope, root: string, directory: string): Promise<SkillDocument[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const documents = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map(async (entry) => {
        const directoryPath = join(directory, entry.name)
        const document = await readSkillDocument(scope, directoryPath, { root })
        if (document) return [document]
        return discoverInDirectory(scope, root, directoryPath)
      }),
  )

  return documents.flat()
}

async function discoverInRoot(scope: SkillScope, root: string): Promise<SkillDocument[]> {
  if (!(await Filesystem.isDir(root))) return []
  return discoverInDirectory(scope, root, root)
}

async function discoverPluginDocuments(options?: SkillDiscoveryOptions): Promise<SkillDocument[]> {
  const roots = Plugin.listInstalledPluginSkillRoots(options?.pluginIDs)
  const items = await Promise.all(
    roots.map(async (root) => {
      if (!(await Filesystem.isDir(root.root))) return []

      const entries = await readdir(root.root, { withFileTypes: true })
      const documents = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => readSkillDocument("plugin", join(root.root, entry.name), {
            pluginID: root.pluginID,
          })),
      )

      return documents.filter((item): item is SkillDocument => Boolean(item))
    }),
  )

  return items.flat()
}

async function discoverRegistryDocuments(): Promise<SkillDocument[]> {
  const roots = await listEnabledManagedRegistrySkillRoots()
  const documents = await Promise.all(roots.map(async (root) => {
    try {
      return await readSkillDocument("registry", root.packageRoot, { skillID: root.id })
    } catch (error) {
      log.warn("managed registry skill could not be read", {
        skillID: root.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }))
  return documents.filter((item): item is SkillDocument => Boolean(item))
}

async function discoverDocuments(projectRoot: string, options?: SkillDiscoveryOptions): Promise<SkillDocument[]> {
  const roots = skillRoots(projectRoot)
  const items = await Promise.all([
    ...roots.map((item) => discoverInRoot(item.scope, item.root)),
    discoverPluginDocuments(options),
    discoverRegistryDocuments(),
  ])

  return items
    .flat()
    .toSorted((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

export async function list(projectRoot: string, options?: SkillDiscoveryOptions): Promise<SkillInfo[]> {
  return (await discoverDocuments(projectRoot, options)).map(toSkillInfo)
}

export async function listGlobal(): Promise<SkillInfo[]> {
  return (await discoverInRoot("user", userSkillRoot())).map(toSkillInfo)
}

export async function getSelected(
  projectRoot: string,
  skillIDs: string[],
  options?: SkillDiscoveryOptions,
): Promise<SkillDocument[]> {
  if (skillIDs.length === 0) return []

  const all = await discoverDocuments(projectRoot, options)
  const byID = new Map(all.map((item) => [item.id, item] as const))
  const result: SkillDocument[] = []
  const seen = new Set<string>()

  for (const id of skillIDs) {
    if (seen.has(id)) continue
    seen.add(id)

    const item = byID.get(id)
    if (!item) {
      log.warn("selected skill not found", {
        projectRoot,
        skillID: id,
      })
      continue
    }

    result.push(item)
  }

  return result
}

export async function resolveSelectedSkillIDs(
  projectRoot: string,
  skillIDs: string[],
  options?: SkillDiscoveryOptions,
): Promise<string[]> {
  return (await getSelected(projectRoot, skillIDs, options)).map((skill) => skill.id)
}

export async function resolveTurnSkillIDs(input: {
  projectID: string
  projectRoot: string
  requestedSkillIDs?: string[]
}): Promise<string[]> {
  const pluginIDs = await Config.getSelectedPluginIDs(input.projectID)
  const requestedSkillIDs = input.requestedSkillIDs ?? await Config.getSelectedSkillIDs(input.projectID)
  return await resolveSelectedSkillIDs(input.projectRoot, requestedSkillIDs, { pluginIDs })
}

export function configureSessionSkills(sessionID: string, skillIDs: string[]) {
  const state = getSessionSkillState(sessionID)
  const normalized = normalizeSkillIDs(skillIDs)
  state.allowedSkillIDs = normalized.length > 0 ? normalized : null
  state.loadedSkillIDs.clear()
}

export function getAllowedSkillIDs(sessionID: string) {
  const allowedSkillIDs = getSessionSkillState(sessionID).allowedSkillIDs
  return allowedSkillIDs ? [...allowedSkillIDs] : null
}

export function markSkillLoaded(sessionID: string, skillID: string) {
  getSessionSkillState(sessionID).loadedSkillIDs.add(skillID)
}

export function isSkillLoaded(sessionID: string, skillID: string) {
  return getSessionSkillState(sessionID).loadedSkillIDs.has(skillID)
}

export async function listForPrompt(
  projectRoot: string,
  skillIDs: string[],
  options?: SkillDiscoveryOptions,
): Promise<SkillInfo[]> {
  const selected = skillIDs.length === 0
    ? await discoverDocuments(projectRoot, options)
    : await getSelected(projectRoot, skillIDs, options)

  return selected.map(toSkillInfo)
}

export async function loadPromptCatalogSections(
  projectRoot: string,
  skillIDs: string[],
  options?: SkillDiscoveryOptions,
): Promise<string[]> {
  const selected = await listForPrompt(projectRoot, skillIDs, options)
  if (selected.length === 0) return []

  const selectedOnly = skillIDs.length > 0
  return [[
    `<skills progressive="true" mode="${selectedOnly ? "selected" : "discoverable"}">`,
    "Skills are loaded progressively. Do not assume a skill's full workflow from metadata alone.",
    "Use the load_skill tool to read a skill's SKILL.md before following that skill's instructions.",
    "Use the read_skill_resource tool only after load_skill, and only for relative files referenced by that skill.",
    selectedOnly
      ? "The user preselected the following skills for this turn. Stay within this set unless the user changes it."
      : "The following skills are available for this turn. Load one only when it clearly matches the task.",
    "",
    ...selected.map(toPromptSkillSummary),
    `</skills>`,
  ].join("\n")]
}

export async function loadByID(
  projectRoot: string,
  skillID: string,
  options?: {
    allowedSkillIDs?: string[] | null
    pluginIDs?: string[] | null
  },
): Promise<SkillDocument | undefined> {
  const normalizedID = skillID.trim()
  if (!normalizedID) return undefined
  if (!isSkillAllowed(normalizedID, options?.allowedSkillIDs)) return undefined

  return (await getSelected(projectRoot, [normalizedID], { pluginIDs: options?.pluginIDs }))[0]
}

export async function resolveResourcePath(
  projectRoot: string,
  skillID: string,
  resourcePath: string,
  options?: {
    allowedSkillIDs?: string[] | null
    pluginIDs?: string[] | null
  },
): Promise<{
  skill: SkillDocument
  resourcePath: string
}> {
  const skill = await loadByID(projectRoot, skillID, options)
  if (!skill) {
    throw new Error(`Skill '${skillID}' was not found or is not available for this turn.`)
  }

  const trimmedResourcePath = ensureRelativeSkillResourcePath(resourcePath)
  const skillDirectory = dirname(skill.path)
  const resolvedPath = Filesystem.normalizePath(resolve(skillDirectory, trimmedResourcePath))
  const relativePath = relative(skillDirectory, resolvedPath)

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Skill resource '${resourcePath}' is outside the skill directory.`)
  }
  if (!(await Filesystem.exists(resolvedPath))) {
    throw new Error(`Skill resource '${resourcePath}' does not exist for skill '${skillID}'.`)
  }
  if (await Filesystem.isDir(resolvedPath)) {
    throw new Error(`Skill resource '${resourcePath}' must be a file, not a directory.`)
  }

  return {
    skill,
    resourcePath: resolvedPath,
  }
}
