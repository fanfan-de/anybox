import { createHash, randomUUID } from "node:crypto"
import { cp, lstat, readFile, rename, rm, stat } from "node:fs/promises"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import type {
  DownloadedRegistrySkill,
  RegistryDownloadDescriptor,
  RegistryFile,
  RegistryFileContent,
  RegistryLocalScanReport,
  RegistrySecuritySnapshot,
  RegistrySkillDetail,
} from "@anybox/shared/skill-registry"
import {
  DownloadedRegistrySkillIconUrlSchema,
  RegistryDownloadDescriptorSchema,
  RegistryLocalScanReportSchema,
  RegistrySecuritySnapshotSchema,
} from "@anybox/shared/skill-registry"
import matter from "gray-matter"
import z from "zod"
import * as Config from "#config/config.ts"
import * as db from "#database/Sqlite.ts"
import { toCreateTableSQL, withPrimaryKey, zodObjectToColumnDefs } from "#database/parser.ts"
import * as Global from "#global/global.ts"
import { ensureGlobalSkillRoot } from "#skill/manage.ts"
import { digestRegistrySkillTree, REGISTRY_SCANNER_VERSION } from "#skill/registry/scanner.ts"

const REGISTRY_SKILLS_TABLE = "registry_skills"
const REGISTRY_SKILL_VERSIONS_TABLE = "registry_skill_versions"
const ManagedIdentifierSchema = z.string().min(1).refine((value) => !value.includes("\0"), "Identifier must not contain NUL")

const ManagedVersionRecordSchema = z.object({
  version: ManagedIdentifierSchema,
  packageDirectory: z.string().min(1),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  treeHash: z.string().regex(/^[a-f0-9]{64}$/i),
  installedAt: z.number().int().nonnegative(),
  source: z.object({
    kind: z.enum(["registry", "archive", "github"]),
    repo: z.string().optional(),
    commit: z.string().optional(),
    path: z.string().optional(),
    contentHash: z.string().optional(),
    contentHashAlgorithm: z.literal("skillhub-v1").optional(),
    signatureKeyId: z.string().optional(),
    signatureVerified: z.boolean().optional(),
  }),
  security: RegistrySecuritySnapshotSchema.optional(),
  localScan: RegistryLocalScanReportSchema,
})

const ManagedSkillRowSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  remoteId: ManagedIdentifierSchema,
  slug: z.string().min(1),
  displayName: z.string().min(1),
  iconUrl: DownloadedRegistrySkillIconUrlSchema.optional(),
  authorHandle: z.string().min(1).optional(),
  authorDisplayName: z.string().optional(),
  description: z.string(),
  os: z.array(z.string()).optional(),
  systems: z.array(z.string()).optional(),
  canonicalUrl: z.string().url(),
  activeVersion: ManagedIdentifierSchema,
  enabled: z.boolean(),
  downloadedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

const ManagedVersionRowSchema = ManagedVersionRecordSchema.omit({ source: true }).extend({
  key: z.string().min(1),
  skillId: z.string().min(1),
  sourceKind: z.enum(["registry", "archive", "github"]).optional(),
  repo: z.string().optional(),
  commit: z.string().optional(),
  subpath: z.string().optional(),
  contentHash: z.string().optional(),
  contentHashAlgorithm: z.literal("skillhub-v1").optional(),
  signatureKeyId: z.string().optional(),
  signatureVerified: z.boolean().optional(),
})

const ManagedVersionReadRowSchema = ManagedVersionRowSchema.extend({
  // Only present in databases created before source metadata was flattened.
  source: ManagedVersionRecordSchema.shape.source.optional(),
})

type ManagedVersionRecord = z.infer<typeof ManagedVersionRecordSchema>
type ManagedSkillRow = z.infer<typeof ManagedSkillRowSchema>
type ManagedVersionRow = z.infer<typeof ManagedVersionRowSchema>
type ManagedSkillRecord = ManagedSkillRow & { versions: ManagedVersionRecord[] }
type ManagedStore = { skills: ManagedSkillRecord[] }

export interface ManagedRegistryVersion {
  version: string
  packageRoot: string
  artifactSha256: string
  treeHash: string
  installedAt: number
  source: ManagedVersionRecord["source"]
  security?: RegistrySecuritySnapshot
  localScan: RegistryLocalScanReport
}

export interface ManagedRegistrySkill extends DownloadedRegistrySkill {
  description: string
  os?: string[]
  systems?: string[]
  author: {
    handle: string
    displayName?: string
  }
  localScan: RegistryLocalScanReport
  versions: ManagedRegistryVersion[]
}

export interface RegisterManagedRegistryVersionInput {
  detail: RegistrySkillDetail
  descriptor: RegistryDownloadDescriptor
  /** A locally cached, inert raster data URL. Remote detail.iconUrl values must not be persisted here. */
  cachedIconUrl?: string
  packageRoot: string
  artifactSha256: string
  treeHash: string
  localScan: RegistryLocalScanReport
  security?: RegistrySecuritySnapshot
  /** Set only by the download pipeline after cryptographic verification succeeds. */
  integrityVerified?: boolean
}

export interface ManagedRegistryUpdatePreview {
  id: string
  currentVersion: string
  targetVersion: string
  updateAvailable: boolean
  alreadyDownloaded: boolean
  currentTreeHash: string
  targetTreeHash?: string
  blocked: boolean
}

export class ManagedRegistryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ManagedRegistryError"
  }
}

export const ManagedRegistryEnableInputSchema = z.object({
  enabled: z.boolean(),
  acknowledgeRisk: z.boolean().optional(),
}).strict()

export const ManagedRegistryVersionInputSchema = z.object({
  version: ManagedIdentifierSchema.transform((value) => value.trim()).pipe(ManagedIdentifierSchema).optional(),
}).strict()

export const ManagedRegistryUpdatePreviewInputSchema = z.object({
  descriptor: RegistryDownloadDescriptorSchema,
}).strict()

export const ManagedRegistryFileInputSchema = ManagedRegistryVersionInputSchema.extend({
  path: z.string().trim().min(1).default("SKILL.md"),
}).strict()

export const ManagedRegistryForkInputSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
}).strict()

let mutationQueue: Promise<void> = Promise.resolve()
let registryTablesGeneration = -1

function withMutationLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(fn, fn)
  mutationQueue = run.then(() => undefined, () => undefined)
  return run
}

export function managedRegistryRoot() {
  const override = process.env.ANYBOX_TEST_SKILL_REGISTRY_ROOT?.trim()
  return resolve(override || join(Global.Path.data, "skills", "registry"))
}

export function managedRegistryCacheRoot() {
  const override = process.env.ANYBOX_TEST_SKILL_REGISTRY_CACHE_ROOT?.trim()
  return resolve(override || join(Global.Path.cache, "skill-registry"))
}

function emptyStore(): ManagedStore {
  return { skills: [] }
}

function ensureRegistryTables() {
  const generation = db.getDatabaseGeneration()
  if (registryTablesGeneration === generation && generation > 0) return

  if (db.tableExists(REGISTRY_SKILLS_TABLE)) {
    db.syncTableColumnsWithZodObject(REGISTRY_SKILLS_TABLE, ManagedSkillRowSchema)
  } else {
    const columns = zodObjectToColumnDefs(ManagedSkillRowSchema)
    columns.id = withPrimaryKey(columns.id)
    db.db.run(toCreateTableSQL(REGISTRY_SKILLS_TABLE, columns))
  }

  if (db.tableExists(REGISTRY_SKILL_VERSIONS_TABLE)) {
    db.syncTableColumnsWithZodObject(REGISTRY_SKILL_VERSIONS_TABLE, ManagedVersionRowSchema)
  } else {
    const columns = zodObjectToColumnDefs(ManagedVersionRowSchema)
    columns.key = withPrimaryKey(columns.key)
    db.db.run(toCreateTableSQL(REGISTRY_SKILL_VERSIONS_TABLE, columns))
  }
  db.db.run(
    `CREATE INDEX IF NOT EXISTS registry_skill_versions_skill_id ON ${REGISTRY_SKILL_VERSIONS_TABLE}(skillId);`,
  )
  db.db.run(
    `CREATE INDEX IF NOT EXISTS registry_skill_versions_tree_hash ON ${REGISTRY_SKILL_VERSIONS_TABLE}(treeHash);`,
  )
  db.db.run(
    `CREATE INDEX IF NOT EXISTS registry_skill_versions_source_ref ON ${REGISTRY_SKILL_VERSIONS_TABLE}("repo", "commit", "subpath");`,
  )
  migrateLegacyVersionSources()
  registryTablesGeneration = db.getDatabaseGeneration()
}

function registryVersionTableColumns() {
  return new Set(
    (db.db.prepare(`PRAGMA table_info("${REGISTRY_SKILL_VERSIONS_TABLE}");`).all() as Array<{ name?: string }>)
      .flatMap((row) => typeof row.name === "string" ? [row.name] : []),
  )
}

function migrateLegacyVersionSources() {
  const columns = registryVersionTableColumns()
  if (!columns.has("source") || !columns.has("sourceKind")) return

  const rows = db.db.prepare(
    `SELECT key, source FROM ${REGISTRY_SKILL_VERSIONS_TABLE} WHERE sourceKind IS NULL AND source IS NOT NULL;`,
  ).all() as Array<{ key?: unknown; source?: unknown }>
  const update = db.db.prepare(
    `UPDATE ${REGISTRY_SKILL_VERSIONS_TABLE}
       SET "sourceKind" = ?, "repo" = ?, "commit" = ?, "subpath" = ?, "contentHash" = ?,
           "contentHashAlgorithm" = ?, "signatureKeyId" = ?, "signatureVerified" = ?
     WHERE key = ?;`,
  )
  const transaction = db.db.transaction(() => {
    for (const row of rows) {
      if (typeof row.key !== "string" || typeof row.source !== "string") continue
      try {
        const source = ManagedVersionRecordSchema.shape.source.parse(JSON.parse(row.source))
        update.run(
          source.kind,
          source.repo ?? null,
          source.commit ?? null,
          source.path ?? null,
          source.contentHash ?? null,
          source.contentHashAlgorithm ?? null,
          source.signatureKeyId ?? null,
          source.signatureVerified ?? null,
          row.key,
        )
      } catch {
        // Leave malformed legacy rows untouched; readStore will surface a
        // STORE_CORRUPT error instead of silently inventing source provenance.
      }
    }
  })
  transaction()
}

async function readStore(): Promise<ManagedStore> {
  ensureRegistryTables()
  const skills = db.findMany(REGISTRY_SKILLS_TABLE, ManagedSkillRowSchema)
  if (skills.length === 0) return emptyStore()
  const versions = db.findMany(REGISTRY_SKILL_VERSIONS_TABLE, ManagedVersionReadRowSchema)
  const versionsBySkill = new Map<string, ManagedVersionRecord[]>()
  for (const row of versions) {
    const {
      key: _key,
      skillId,
      sourceKind,
      repo,
      commit,
      subpath,
      contentHash,
      contentHashAlgorithm,
      signatureKeyId,
      signatureVerified,
      source: legacySource,
      ...version
    } = row
    const source = sourceKind
      ? {
          kind: sourceKind,
          repo,
          commit,
          path: subpath,
          contentHash,
          contentHashAlgorithm,
          signatureKeyId,
          signatureVerified,
        }
      : legacySource
    if (!source) {
      throw new ManagedRegistryError("STORE_CORRUPT", `Managed skill version '${row.key}' has no source provenance.`)
    }
    const items = versionsBySkill.get(skillId) ?? []
    items.push(ManagedVersionRecordSchema.parse({ ...version, source }))
    versionsBySkill.set(skillId, items)
  }

  return {
    skills: skills.map((skill) => ({
      ...skill,
      versions: (versionsBySkill.get(skill.id) ?? []).toSorted((left, right) => left.installedAt - right.installedAt),
    })),
  }
}

function prepareStoreRows(store: ManagedStore) {
  ensureRegistryTables()
  const parsedSkills = store.skills.map((record) => {
    const { versions: _versions, ...skill } = record
    return ManagedSkillRowSchema.parse(skill)
  })
  const parsedVersions: Array<{
    row: ManagedVersionRow
    legacySource: ManagedVersionRecord["source"]
  }> = store.skills.flatMap((record) =>
    record.versions.map((version) => {
      const { source, ...storedVersion } = version
      return {
        row: ManagedVersionRowSchema.parse({
          ...storedVersion,
          key: `${record.id}\0${version.version}`,
          skillId: record.id,
          sourceKind: source.kind,
          repo: source.repo,
          commit: source.commit,
          subpath: source.path,
          contentHash: source.contentHash,
          contentHashAlgorithm: source.contentHashAlgorithm,
          signatureKeyId: source.signatureKeyId,
          signatureVerified: source.signatureVerified,
        }),
        legacySource: source,
      }
    }),
  )
  const retainLegacySourceColumn = registryVersionTableColumns().has("source")

  return { parsedSkills, parsedVersions, retainLegacySourceColumn }
}

function writeStoreInCurrentTransaction(store: ManagedStore) {
  const { parsedSkills, parsedVersions, retainLegacySourceColumn } = prepareStoreRows(store)

  db.deleteAll(REGISTRY_SKILL_VERSIONS_TABLE)
  db.deleteAll(REGISTRY_SKILLS_TABLE)
  for (const skill of parsedSkills) db.upsert(REGISTRY_SKILLS_TABLE, skill, ["id"])
  for (const version of parsedVersions) {
    upsertManagedVersionRow(version.row, retainLegacySourceColumn ? version.legacySource : undefined)
  }
}

async function writeStore(store: ManagedStore) {
  ensureRegistryTables()
  const transaction = db.db.transaction(() => {
    writeStoreInCurrentTransaction(store)
  })
  transaction()
}

function writeStoreAndCleanupSelections(store: ManagedStore, skillID: string) {
  ensureRegistryTables()
  const transaction = db.db.transaction(() => {
    writeStoreInCurrentTransaction(store)
    return Config.removeSelectedSkillIDFromAllProjectsInCurrentTransaction(skillID)
  })
  return transaction()
}

function upsertManagedVersionRow(
  version: ManagedVersionRow,
  legacySource?: ManagedVersionRecord["source"],
) {
  const record = db.toSQLiteValue({
    ...version,
    ...(legacySource ? { source: legacySource } : {}),
  } as unknown as Record<string, unknown>)
  const columns = Object.keys(record)
  const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`
  const updates = columns
    .filter((column) => column !== "key")
    .map((column) => `${quote(column)} = excluded.${quote(column)}`)
    .join(", ")
  const sql = `INSERT INTO ${quote(REGISTRY_SKILL_VERSIONS_TABLE)} (${columns.map(quote).join(", ")})
    VALUES (${columns.map(() => "?").join(", ")})
    ON CONFLICT(${quote("key")}) DO UPDATE SET ${updates};`
  db.db.prepare(sql).run(...columns.map((column) => record[column] ?? null))
}

function stableSkillID(provider: string, remoteId: string) {
  return `registry:${provider}:${remoteId}`
}

function normalizeRequirementList(values: string[] | undefined) {
  if (!values) return undefined
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const item = value.trim()
    if (!item) continue
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(item)
  }
  return normalized.length > 0 ? normalized : undefined
}

function conciseManagedDescription(value: string) {
  const description = value.trim()
  if (!/^---[\t ]*(?:\r?\n)/.test(description)) return description

  try {
    const parsed = matter(description)
    const frontmatterDescription = parsed.data?.description
    return typeof frontmatterDescription === "string" ? frontmatterDescription.trim() : ""
  } catch {
    // Legacy records may contain an entire malformed SKILL.md. Never expose that
    // document as the short description shown above the file preview.
    return ""
  }
}

function managedDescriptionForDetail(detail: RegistrySkillDetail) {
  const summary = detail.summary.trim()
  if (summary) return summary
  return conciseManagedDescription(detail.description ?? "")
}

function pathSegment(input: string, fallback: string) {
  const normalized = input
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
  return normalized || fallback
}

function shortHash(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 12)
}

export function managedRegistryVersionDirectory(input: {
  provider: string
  remoteId: string
  slug?: string
  version: string
}) {
  const provider = pathSegment(input.provider, "provider")
  const skill = `${pathSegment(input.slug || input.remoteId, "skill")}-${shortHash(input.remoteId)}`
  const version = `${pathSegment(input.version, "version")}-${shortHash(input.version).slice(0, 8)}`
  return join(managedRegistryRoot(), provider, skill, version)
}

function toRelativePackageDirectory(packageRoot: string) {
  const root = managedRegistryRoot()
  const resolved = resolve(packageRoot)
  const relativePath = relative(root, resolved)
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new ManagedRegistryError("INVALID_PACKAGE_ROOT", "Managed skill package root must be inside the registry data directory.")
  }
  return relativePath.replace(/\\/g, "/")
}

function resolvePackageDirectory(relativeDirectory: string) {
  const root = managedRegistryRoot()
  const resolved = resolve(root, relativeDirectory)
  const relativePath = relative(root, resolved)
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new ManagedRegistryError("STORE_CORRUPT", "A managed skill package path is outside the registry data directory.")
  }
  return resolved
}

function activeVersionFor(record: ManagedSkillRecord) {
  const version = record.versions.find((item) => item.version === record.activeVersion)
  if (!version) {
    throw new ManagedRegistryError("STORE_CORRUPT", `Managed skill '${record.id}' does not have its active version.`)
  }
  return version
}

function hasCurrentRegistryScan(version: Pick<ManagedVersionRecord, "localScan">) {
  return version.localScan.scannerVersion === REGISTRY_SCANNER_VERSION
}

function toManagedVersion(version: ManagedVersionRecord): ManagedRegistryVersion {
  return {
    ...version,
    packageRoot: resolvePackageDirectory(version.packageDirectory),
  }
}

function toManagedSkill(record: ManagedSkillRecord): ManagedRegistrySkill {
  const active = activeVersionFor(record)
  return {
    id: record.id,
    provider: record.provider,
    remoteId: record.remoteId,
    slug: record.slug,
    displayName: record.displayName,
    iconUrl: record.iconUrl,
    author: {
      handle: record.authorHandle ?? "unknown",
      displayName: record.authorDisplayName,
    },
    description: conciseManagedDescription(record.description),
    os: record.os,
    systems: record.systems,
    canonicalUrl: record.canonicalUrl,
    activeVersion: record.activeVersion,
    enabled: record.enabled && hasCurrentRegistryScan(active),
    packageRoot: resolvePackageDirectory(active.packageDirectory),
    artifactSha256: active.artifactSha256,
    treeHash: active.treeHash,
    downloadedAt: record.downloadedAt,
    updatedAt: record.updatedAt,
    security: active.security,
    upstreamSecurity: active.security,
    localScan: active.localScan,
    versions: record.versions.map(toManagedVersion),
  }
}

function sourceForDescriptor(
  descriptor: RegistryDownloadDescriptor,
  integrityVerified = false,
): ManagedVersionRecord["source"] {
  if (descriptor.kind === "github") {
    return {
      kind: descriptor.kind,
      repo: descriptor.repo,
      commit: descriptor.commit,
      path: descriptor.path,
      contentHash: descriptor.contentHash,
    }
  }
  if (descriptor.kind === "archive" && descriptor.integrity && integrityVerified) {
    return {
      kind: descriptor.kind,
      contentHash: descriptor.contentHash,
      contentHashAlgorithm: descriptor.contentHashAlgorithm,
      signatureKeyId: descriptor.integrity.keyId,
      signatureVerified: true,
    }
  }
  return { kind: descriptor.kind }
}

export async function listManagedRegistrySkills(): Promise<ManagedRegistrySkill[]> {
  const store = await readStore()
  return store.skills
    .map(toManagedSkill)
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id))
}

export async function getManagedRegistrySkill(id: string): Promise<ManagedRegistrySkill | undefined> {
  const record = (await readStore()).skills.find((item) => item.id === id)
  return record ? toManagedSkill(record) : undefined
}

export async function getManagedRegistrySkillByRemote(provider: string, remoteId: string) {
  return getManagedRegistrySkill(stableSkillID(provider, remoteId))
}

export async function findVerifiedManagedRegistryPackageRootByTreeHash(
  treeHash: string,
): Promise<string | undefined> {
  if (!/^[a-f0-9]{64}$/i.test(treeHash)) {
    throw new ManagedRegistryError("INVALID_TREE_HASH", "Managed registry tree hash must be a SHA-256 digest.")
  }

  const expectedTreeHash = treeHash.toLowerCase()
  const inspectedDirectories = new Set<string>()
  for (const skill of (await readStore()).skills) {
    for (const version of skill.versions) {
      if (version.treeHash.toLowerCase() !== expectedTreeHash) continue

      let packageRoot: string
      try {
        packageRoot = resolvePackageDirectory(version.packageDirectory)
      } catch {
        continue
      }
      const directoryKey = process.platform === "win32" ? packageRoot.toLowerCase() : packageRoot
      if (inspectedDirectories.has(directoryKey)) continue
      inspectedDirectories.add(directoryKey)

      const skillFile = await stat(join(packageRoot, "SKILL.md")).catch(() => undefined)
      if (!skillFile?.isFile()) continue
      const digest = await digestRegistrySkillTree(packageRoot).catch(() => undefined)
      if (digest?.treeHash.toLowerCase() === expectedTreeHash) return packageRoot
    }
  }
  return undefined
}

export async function listEnabledManagedRegistrySkillRoots(): Promise<Array<{
  id: string
  packageRoot: string
}>> {
  const result: Array<{ id: string; packageRoot: string }> = []
  for (const skill of await listManagedRegistrySkills()) {
    if (!skill.enabled) continue
    if (skill.localScan.scannerVersion !== REGISTRY_SCANNER_VERSION) continue
    const skillFile = join(skill.packageRoot, "SKILL.md")
    const info = await stat(skillFile).catch(() => undefined)
    if (!info?.isFile()) continue
    const digest = await digestRegistrySkillTree(skill.packageRoot).catch(() => undefined)
    if (!digest || digest.treeHash !== skill.treeHash) continue
    result.push({ id: skill.id, packageRoot: skill.packageRoot })
  }
  return result
}

function selectedManagedVersion(skill: ManagedRegistrySkill, version?: string) {
  const selected = version
    ? skill.versions.find((item) => item.version === version)
    : skill.versions.find((item) => item.version === skill.activeVersion)
  if (!selected) {
    throw new ManagedRegistryError("VERSION_NOT_FOUND", `Managed registry skill version '${version}' was not found.`)
  }
  return selected
}

function safeManagedRelativePath(packageRoot: string, input: string) {
  const trimmed = input.trim().replace(/\\/g, "/")
  if (!trimmed || isAbsolute(trimmed) || /^[A-Za-z]:/.test(trimmed)) {
    throw new ManagedRegistryError("INVALID_FILE_PATH", "Managed registry skill file path must be relative.")
  }
  const resolved = resolve(packageRoot, trimmed)
  const relativePath = relative(packageRoot, resolved)
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new ManagedRegistryError("INVALID_FILE_PATH", "Managed registry skill file path is outside its package root.")
  }
  return { resolved, relativePath: relativePath.replace(/\\/g, "/") }
}

export async function listManagedRegistrySkillFiles(id: string, version?: string): Promise<RegistryFile[]> {
  const skill = await getManagedRegistrySkill(id)
  if (!skill) throw new ManagedRegistryError("NOT_FOUND", `Managed registry skill '${id}' was not found.`)
  const selected = selectedManagedVersion(skill, version)
  const digest = await digestRegistrySkillTree(selected.packageRoot)
  if (digest.treeHash !== selected.treeHash) {
    throw new ManagedRegistryError("PACKAGE_TAMPERED", "The managed skill package changed after it was downloaded.")
  }
  return digest.files.map((file) => ({
    provider: skill.provider,
    remoteId: skill.remoteId,
    version: selected.version,
    path: file.path,
    name: basename(file.path),
    size: file.size,
    sha256: file.sha256,
  }))
}

export async function readManagedRegistrySkillFile(
  id: string,
  path = "SKILL.md",
  version?: string,
): Promise<RegistryFileContent> {
  const skill = await getManagedRegistrySkill(id)
  if (!skill) throw new ManagedRegistryError("NOT_FOUND", `Managed registry skill '${id}' was not found.`)
  const selected = selectedManagedVersion(skill, version)
  const target = safeManagedRelativePath(selected.packageRoot, path)
  const info = await lstat(target.resolved).catch(() => undefined)
  if (!info?.isFile() || info.isSymbolicLink()) {
    throw new ManagedRegistryError("FILE_NOT_FOUND", `Managed registry skill file '${path}' was not found.`)
  }
  if (info.size > 1024 * 1024) {
    throw new ManagedRegistryError("FILE_TOO_LARGE", "Managed registry skill text files are limited to 1 MB.")
  }
  const bytes = await readFile(target.resolved)
  let content: string
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new ManagedRegistryError("BINARY_FILE", "Managed registry skill file is not valid UTF-8 text.")
  }
  const actualHash = createHash("sha256").update(bytes).digest("hex")
  const expected = (await listManagedRegistrySkillFiles(id, selected.version))
    .find((file) => file.path === target.relativePath)
  if (!expected || expected.sha256 !== actualHash) {
    throw new ManagedRegistryError("PACKAGE_TAMPERED", "The managed skill file changed after it was downloaded.")
  }
  return {
    provider: skill.provider,
    remoteId: skill.remoteId,
    version: selected.version,
    path: target.relativePath,
    name: basename(target.relativePath),
    size: bytes.length,
    sha256: actualHash,
    content,
    encoding: "utf8",
  }
}

export async function registerManagedRegistryVersion(
  input: RegisterManagedRegistryVersionInput,
): Promise<ManagedRegistrySkill> {
  return withMutationLock(async () => {
    const cachedIconUrl = input.cachedIconUrl === undefined
      ? undefined
      : DownloadedRegistrySkillIconUrlSchema.parse(input.cachedIconUrl)
    if (input.detail.provider !== input.descriptor.provider || input.detail.remoteId !== input.descriptor.remoteId) {
      throw new ManagedRegistryError("IDENTITY_MISMATCH", "Registry detail and download descriptor identify different skills.")
    }
    if (input.security?.blocked || input.security?.status === "malicious") {
      throw new ManagedRegistryError("UPSTREAM_BLOCKED", "The upstream registry has blocked this skill version.")
    }

    const packageDirectory = toRelativePackageDirectory(input.packageRoot)
    const packageSkillFile = await stat(join(input.packageRoot, "SKILL.md")).catch(() => undefined)
    if (!packageSkillFile?.isFile()) {
      throw new ManagedRegistryError("PACKAGE_TAMPERED", "The managed skill package no longer contains SKILL.md.")
    }
    const packageDigest = await digestRegistrySkillTree(input.packageRoot).catch(() => undefined)
    if (!packageDigest || packageDigest.treeHash.toLowerCase() !== input.treeHash.toLowerCase()) {
      throw new ManagedRegistryError(
        "PACKAGE_TAMPERED",
        "The managed skill package changed before its version record could be saved.",
      )
    }
    const now = Date.now()
    const store = await readStore()
    const id = stableSkillID(input.detail.provider, input.detail.remoteId)
    let record = store.skills.find((item) => item.id === id)
    let cleanupSelections = false
    const nextVersion: ManagedVersionRecord = {
      version: input.descriptor.version,
      packageDirectory,
      artifactSha256: input.artifactSha256,
      treeHash: input.treeHash,
      installedAt: now,
      source: sourceForDescriptor(input.descriptor, input.integrityVerified),
      security: input.security,
      localScan: input.localScan,
    }

    if (!record) {
      record = {
        id,
        provider: input.detail.provider,
        remoteId: input.detail.remoteId,
        slug: input.detail.slug,
        displayName: input.detail.displayName,
        iconUrl: cachedIconUrl,
        authorHandle: input.detail.author.handle,
        authorDisplayName: input.detail.author.displayName,
        description: managedDescriptionForDetail(input.detail),
        os: normalizeRequirementList(input.detail.os),
        systems: normalizeRequirementList(input.detail.systems),
        canonicalUrl: input.detail.canonicalUrl,
        activeVersion: nextVersion.version,
        enabled: false,
        downloadedAt: now,
        updatedAt: now,
        versions: [nextVersion],
      }
      store.skills.push(record)
      cleanupSelections = true
    } else {
      const existingVersionIndex = record.versions.findIndex((item) => item.version === nextVersion.version)
      const existingVersion = existingVersionIndex >= 0 ? record.versions[existingVersionIndex] : undefined
      if (existingVersion && existingVersion.treeHash !== nextVersion.treeHash) {
        throw new ManagedRegistryError(
          "VERSION_IMMUTABILITY_VIOLATION",
          `Registry skill version '${nextVersion.version}' changed after it was downloaded.`,
        )
      }

      record.slug = input.detail.slug
      record.displayName = input.detail.displayName
      if (cachedIconUrl !== undefined) record.iconUrl = cachedIconUrl
      record.authorHandle = input.detail.author.handle
      record.authorDisplayName = input.detail.author.displayName
      record.description = managedDescriptionForDetail(input.detail)
      record.os = normalizeRequirementList(input.detail.os)
      record.systems = normalizeRequirementList(input.detail.systems)
      record.canonicalUrl = input.detail.canonicalUrl
      const activeVersionChanged = record.activeVersion !== nextVersion.version
      record.updatedAt = now
      if (existingVersion) {
        record.versions[existingVersionIndex] = nextVersion
      } else {
        record.versions.push(nextVersion)
      }

      const assessmentRequiresReview =
        !hasCurrentRegistryScan(nextVersion) ||
        input.localScan.blocked ||
        input.security?.status === "suspicious"
      if (activeVersionChanged && record.enabled && assessmentRequiresReview) {
        // Keep the last explicitly enabled safe version active. The risky update is
        // retained for inspection and can only become active through an explicit
        // rollback followed by the developer-risk override.
      } else {
        record.activeVersion = nextVersion.version
      }
      if (!activeVersionChanged && record.enabled && assessmentRequiresReview) {
        record.enabled = false
        cleanupSelections = true
      }
    }

    if (cleanupSelections) writeStoreAndCleanupSelections(store, record.id)
    else await writeStore(store)
    return toManagedSkill(record)
  })
}

export async function setManagedRegistrySkillEnabled(
  id: string,
  enabled: boolean,
  options?: { acknowledgeRisk?: boolean },
): Promise<ManagedRegistrySkill & { affectedProjectIDs: string[]; affectedProjectCount: number }> {
  return withMutationLock(async () => {
    const store = await readStore()
    const record = store.skills.find((item) => item.id === id)
    if (!record) throw new ManagedRegistryError("NOT_FOUND", `Managed registry skill '${id}' was not found.`)

    const active = activeVersionFor(record)
    const trustedDeveloperMode = process.env.ANYBOX_SKILL_REGISTRY_DEVELOPER_MODE === "1"
    const riskOverride = trustedDeveloperMode && options?.acknowledgeRisk === true
    const upstreamBlocked = active.security?.blocked || active.security?.status === "malicious"
    if (enabled && upstreamBlocked) {
      throw new ManagedRegistryError(
        "ENABLE_BLOCKED",
        "This skill version is blocked by its upstream security assessment and cannot be enabled.",
      )
    }
    if (
      enabled &&
      active.security?.status === "suspicious" &&
      !riskOverride
    ) {
      throw new ManagedRegistryError(
        "ENABLE_BLOCKED",
        "This skill version is suspicious according to its upstream assessment. Developer mode and an explicit risk acknowledgement are required.",
      )
    }
    if (enabled && !hasCurrentRegistryScan(active)) {
      throw new ManagedRegistryError(
        "RESCAN_REQUIRED",
        "This skill was assessed by an outdated scanner and must be downloaded or scanned again before it can be enabled.",
      )
    }
    if (enabled && active.localScan.blocked && !riskOverride) {
      throw new ManagedRegistryError(
        "ENABLE_BLOCKED",
        "This skill version is blocked by the Anybox local assessment. Developer mode and an explicit risk acknowledgement are required.",
      )
    }

    if (enabled) {
      const packageRoot = resolvePackageDirectory(active.packageDirectory)
      const skillFile = await stat(join(packageRoot, "SKILL.md")).catch(() => undefined)
      if (!skillFile?.isFile()) {
        throw new ManagedRegistryError("PACKAGE_TAMPERED", "The managed skill package no longer contains SKILL.md.")
      }
      const digest = await digestRegistrySkillTree(packageRoot)
      if (digest.treeHash !== active.treeHash) {
        throw new ManagedRegistryError(
          "PACKAGE_TAMPERED",
          "The managed skill package changed after it was downloaded and must be reinstalled before it can be enabled.",
        )
      }
    }

    record.enabled = enabled
    record.updatedAt = Date.now()
    const affected = enabled
      ? (await writeStore(store), { affectedProjectIDs: [], affectedCount: 0 })
      : writeStoreAndCleanupSelections(store, id)
    return {
      ...toManagedSkill(record),
      affectedProjectIDs: affected.affectedProjectIDs,
      affectedProjectCount: affected.affectedCount,
    }
  })
}

export async function deleteManagedRegistrySkill(id: string): Promise<{
  id: string
  deleted: true
  affectedProjectIDs: string[]
  affectedProjectCount: number
}> {
  return withMutationLock(async () => {
    const store = await readStore()
    const index = store.skills.findIndex((item) => item.id === id)
    if (index < 0) throw new ManagedRegistryError("NOT_FOUND", `Managed registry skill '${id}' was not found.`)
    const record = store.skills[index]!
    const packageDirectories = new Set(record.versions.map((item) => item.packageDirectory))
    store.skills.splice(index, 1)
    const remainingPackageDirectories = new Set(
      store.skills.flatMap((skill) => skill.versions.map((version) => version.packageDirectory)),
    )
    const affected = writeStoreAndCleanupSelections(store, id)

    for (const packageDirectory of packageDirectories) {
      if (remainingPackageDirectories.has(packageDirectory)) continue
      await rm(resolvePackageDirectory(packageDirectory), { recursive: true, force: true }).catch(() => undefined)
    }
    return {
      id,
      deleted: true,
      affectedProjectIDs: affected.affectedProjectIDs,
      affectedProjectCount: affected.affectedCount,
    }
  })
}

export async function previewManagedRegistryUpdate(
  id: string,
  descriptor: RegistryDownloadDescriptor,
): Promise<ManagedRegistryUpdatePreview> {
  const skill = await getManagedRegistrySkill(id)
  if (!skill) throw new ManagedRegistryError("NOT_FOUND", `Managed registry skill '${id}' was not found.`)
  if (skill.provider !== descriptor.provider || skill.remoteId !== descriptor.remoteId) {
    throw new ManagedRegistryError("IDENTITY_MISMATCH", "Update descriptor identifies a different registry skill.")
  }

  const target = skill.versions.find((item) => item.version === descriptor.version)
  return {
    id,
    currentVersion: skill.activeVersion,
    targetVersion: descriptor.version,
    updateAvailable: descriptor.version !== skill.activeVersion,
    alreadyDownloaded: Boolean(target),
    currentTreeHash: skill.treeHash,
    targetTreeHash: target?.treeHash,
    blocked: Boolean(target?.localScan.blocked || target?.security?.blocked || target?.security?.status === "malicious"),
  }
}

export async function rollbackManagedRegistrySkill(
  id: string,
  version?: string,
): Promise<ManagedRegistrySkill & { affectedProjectIDs: string[]; affectedProjectCount: number }> {
  return withMutationLock(async () => {
    const store = await readStore()
    const record = store.skills.find((item) => item.id === id)
    if (!record) throw new ManagedRegistryError("NOT_FOUND", `Managed registry skill '${id}' was not found.`)

    const target = version
      ? record.versions.find((item) => item.version === version)
      : record.versions
        .filter((item) => item.version !== record.activeVersion)
        .toSorted((left, right) => right.installedAt - left.installedAt)[0]
    if (!target) {
      throw new ManagedRegistryError("ROLLBACK_UNAVAILABLE", "No downloaded registry skill version is available for rollback.")
    }

    record.activeVersion = target.version
    record.enabled = false
    record.updatedAt = Date.now()
    const affected = writeStoreAndCleanupSelections(store, id)
    return {
      ...toManagedSkill(record),
      affectedProjectIDs: affected.affectedProjectIDs,
      affectedProjectCount: affected.affectedCount,
    }
  })
}

export async function forkManagedRegistrySkillToUser(
  id: string,
  name?: string,
): Promise<{
  id: string
  sourceSkillID: string
  directory: string
  filePath: string
}> {
  const skill = await getManagedRegistrySkill(id)
  if (!skill) throw new ManagedRegistryError("NOT_FOUND", `Managed registry skill '${id}' was not found.`)
  const active = selectedManagedVersion(skill)
  const digest = await digestRegistrySkillTree(active.packageRoot)
  if (digest.treeHash !== active.treeHash) {
    throw new ManagedRegistryError("PACKAGE_TAMPERED", "The managed skill package changed after it was downloaded.")
  }

  const directoryName = (name?.trim() || skill.slug)
  if (
    !directoryName ||
    directoryName === "." ||
    directoryName === ".." ||
    /[\\/:*?"<>|\u0000-\u001f]/.test(directoryName) ||
    /[. ]$/.test(directoryName) ||
    directoryName.length > 100 ||
    /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu.test(directoryName)
  ) {
    throw new ManagedRegistryError("INVALID_FORK_NAME", "Forked skill folder name is invalid.")
  }

  const root = await ensureGlobalSkillRoot()
  const directory = join(root, directoryName)
  if (await stat(directory).catch(() => undefined)) {
    throw new ManagedRegistryError("FORK_CONFLICT", `A user skill named '${directoryName}' already exists.`)
  }
  const staging = join(root, `.${directoryName}.stage-${randomUUID()}`)

  try {
    await cp(active.packageRoot, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    })
    const copiedDigest = await digestRegistrySkillTree(staging)
    if (copiedDigest.treeHash !== active.treeHash) {
      throw new ManagedRegistryError("FORK_FAILED", "Forked skill content did not match its managed source.")
    }
    await rename(staging, directory)
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }

  return {
    id: `user:${directoryName}`,
    sourceSkillID: id,
    directory,
    filePath: join(directory, "SKILL.md"),
  }
}
