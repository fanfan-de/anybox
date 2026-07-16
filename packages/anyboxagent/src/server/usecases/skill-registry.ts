import {
  RegistryFileRefSchema,
  RegistrySearchInputSchema,
  RegistrySkillRefSchema,
  RegistryUpdatePreviewSchema,
  RegistryVersionRefSchema,
  type RegistryFileRef,
  type RegistryFile,
  type RegistrySearchInput,
  type RegistrySkillRef,
  type RegistryUpdateFileChange,
  type RegistryVersionRef,
} from "@anybox/shared/skill-registry"
import z from "zod"
import { ApiError } from "#server/error.ts"
import {
  getDefaultSkillRegistryCatalog,
  type SkillRegistryCatalog,
} from "#skill/registry/catalog.ts"
import {
  isRegistryProviderRequestError,
  type RegistryProviderRequestError,
} from "#skill/registry/provider.ts"
import { RegistryArchiveError } from "#skill/registry/archive.ts"
import {
  downloadManagedRegistrySkill,
  RegistryDownloadError,
  updateManagedRegistrySkill,
} from "#skill/registry/download.ts"
import {
  deleteManagedRegistrySkill,
  forkManagedRegistrySkillToUser,
  getManagedRegistrySkill,
  listManagedRegistrySkillFiles,
  listManagedRegistrySkills,
  ManagedRegistryError,
  previewManagedRegistryUpdate,
  readManagedRegistrySkillFile,
  rollbackManagedRegistrySkill,
  setManagedRegistrySkillEnabled,
} from "#skill/registry/managed-store.ts"

export {
  RegistryFileRefSchema as ReadRegistryFileBody,
  RegistrySearchInputSchema as SearchRegistryBody,
  RegistrySkillRefSchema as RegistrySkillBody,
  RegistryVersionRefSchema as RegistryVersionBody,
}

const TrimmedString = z.string().trim().min(1).refine((value) => !value.includes("\0"), "String must not contain NUL")

export const DownloadRegistrySkillBody = RegistryVersionRefSchema

export const UpdateDownloadedRegistrySkillBody = z.object({
  enabled: z.boolean(),
  acknowledgeRisk: z.boolean().optional(),
}).strict()

export const DownloadedRegistrySkillVersionBody = z.object({
  version: TrimmedString.optional(),
})

export const ReadDownloadedRegistrySkillFileBody = DownloadedRegistrySkillVersionBody.extend({
  path: TrimmedString.default("SKILL.md"),
})

export const ForkDownloadedRegistrySkillBody = z.object({
  name: TrimmedString.optional(),
})

function catalog(input?: SkillRegistryCatalog) {
  return input ?? getDefaultSkillRegistryCatalog()
}

function statusForProviderError(error: RegistryProviderRequestError) {
  switch (error.code) {
    case "INVALID_REQUEST": return 400 as const
    case "NOT_FOUND": return 404 as const
    case "NOT_CONFIGURED": return 409 as const
    case "NOT_SUPPORTED": return 501 as const
    case "RATE_LIMITED": return 429 as const
    case "TIMEOUT": return 504 as const
    case "INVALID_RESPONSE":
    case "UPSTREAM_ERROR": return 502 as const
    case "UNAVAILABLE": return 503 as const
  }
}

async function providerCall<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    if (!isRegistryProviderRequestError(error)) throw error
    throw new ApiError(
      statusForProviderError(error),
      `SKILL_REGISTRY_${error.code}`,
      error.message,
      error.retryAfterMs === undefined ? undefined : { retryAfterMs: error.retryAfterMs },
    )
  }
}

export function managedErrorStatus(code: string) {
  if (["NOT_FOUND", "VERSION_NOT_FOUND", "FILE_NOT_FOUND"].includes(code)) return 404 as const
  if (code === "RATE_LIMITED") return 429 as const
  if (code === "TIMEOUT") return 504 as const
  if (code === "CANCELLED") return 503 as const
  if (code === "FILE_TOO_LARGE" || code === "DOWNLOAD_TOO_LARGE") return 413 as const
  if (code === "BINARY_FILE") return 415 as const
  if (["UPSTREAM_BLOCKED", "ENABLE_BLOCKED"].includes(code)) return 403 as const
  if ([
    "PACKAGE_CONFLICT",
    "PACKAGE_TAMPERED",
    "VERSION_IMMUTABILITY_VIOLATION",
    "ROLLBACK_UNAVAILABLE",
    "FORK_CONFLICT",
  ].includes(code)) return 409 as const
  if (["STORE_CORRUPT", "FORK_FAILED"].includes(code)) return 500 as const
  if ([
    "DOWNLOAD_FAILED",
    "DNS_FAILED",
    "HASH_MISMATCH",
    "INVALID_SIGNATURE",
    "INVALID_HANDOFF",
    "INVALID_GITHUB_HANDOFF",
    "INVALID_ARCHIVE",
    "INVALID_PACKAGE",
    "INVALID_REDIRECT",
    "TOO_MANY_REDIRECTS",
    "UNSAFE_URL",
    "UNSAFE_PORT",
    "UNSAFE_HOST",
    "PRIVATE_ADDRESS",
    "IDENTITY_MISMATCH",
  ].includes(code)) return 502 as const
  return 400 as const
}

async function managedCall<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof RegistryDownloadError || error instanceof ManagedRegistryError) {
      throw new ApiError(
        managedErrorStatus(error.code),
        `SKILL_REGISTRY_${error.code}`,
        error.message,
        error instanceof RegistryDownloadError && error.retryAfterMs !== undefined
          ? { retryAfterMs: error.retryAfterMs }
          : undefined,
      )
    }
    if (error instanceof RegistryArchiveError) {
      throw new ApiError(502, "SKILL_REGISTRY_INVALID_ARCHIVE", error.message)
    }
    throw error
  }
}

export async function listProviders(registry?: SkillRegistryCatalog) {
  return await catalog(registry).listProviders()
}

export async function searchRegistry(input: RegistrySearchInput, registry?: SkillRegistryCatalog, signal?: AbortSignal) {
  return await catalog(registry).search(input, signal)
}

export async function getRegistrySkillDetail(input: RegistrySkillRef, registry?: SkillRegistryCatalog, signal?: AbortSignal) {
  return await providerCall(() => catalog(registry).getDetail(input, signal))
}

export async function listRegistrySkillVersions(input: RegistrySkillRef, registry?: SkillRegistryCatalog, signal?: AbortSignal) {
  return await providerCall(() => catalog(registry).listVersions(input, signal))
}

export async function listRegistrySkillFiles(input: RegistryVersionRef, registry?: SkillRegistryCatalog, signal?: AbortSignal) {
  return await providerCall(() => catalog(registry).listFiles(input, signal))
}

export async function readRegistrySkillFile(input: RegistryFileRef, registry?: SkillRegistryCatalog, signal?: AbortSignal) {
  return await providerCall(() => catalog(registry).readFile(input, signal))
}

export async function getRegistrySkillSecurity(input: RegistryVersionRef, registry?: SkillRegistryCatalog, signal?: AbortSignal) {
  return await providerCall(() => catalog(registry).getSecurity(input, signal))
}

export async function resolveRegistrySkillDownload(input: RegistryVersionRef, registry?: SkillRegistryCatalog, signal?: AbortSignal) {
  return await providerCall(() => catalog(registry).resolveDownload(input, signal))
}

async function resolveManagedDownloadInput(
  input: RegistryVersionRef,
  registry?: SkillRegistryCatalog,
  signal?: AbortSignal,
  options: { allowUnavailableSecurity?: boolean } = {},
) {
  const detail = await getRegistrySkillDetail({ provider: input.provider, remoteId: input.remoteId }, registry, signal)
  const version = input.version ?? detail.version ?? detail.latestVersion?.version
  if (!version) {
    throw new ApiError(404, "SKILL_REGISTRY_VERSION_NOT_FOUND", "Registry skill has no published version")
  }
  const target = {
    provider: detail.provider,
    remoteId: detail.remoteId,
    version,
  }
  const [descriptor, security] = await Promise.all([
    resolveRegistrySkillDownload(target, registry, signal),
    getRegistrySkillSecurity(target, registry, signal).catch((error) => {
      if (options.allowUnavailableSecurity) return undefined
      throw error
    }),
  ])
  return { detail, descriptor, security }
}

async function resolveInstalledUpdateInput(
  id: string,
  version: string | undefined,
  registry?: SkillRegistryCatalog,
  signal?: AbortSignal,
  options: { allowUnavailableSecurity?: boolean } = {},
) {
  const installed = await managedCall(() => getManagedRegistrySkill(id))
  if (!installed) throw new ApiError(404, "SKILL_REGISTRY_NOT_FOUND", `Managed registry skill '${id}' was not found`)
  const detail = await getRegistrySkillDetail({
    provider: installed.provider,
    remoteId: installed.remoteId,
  }, registry, signal)
  const targetVersion = version ?? detail.version
  if (!targetVersion) {
    throw new ApiError(404, "SKILL_REGISTRY_VERSION_NOT_FOUND", "Registry skill has no published version")
  }
  return await resolveManagedDownloadInput({
    provider: installed.provider,
    remoteId: installed.remoteId,
    version: targetVersion,
  }, registry, signal, options)
}

export function compareRegistryFiles(current: RegistryFile[], target: RegistryFile[]): RegistryUpdateFileChange[] | undefined {
  if (target.some((file) => !file.sha256)) return undefined
  if (new Set(target.map((file) => file.path)).size !== target.length) return undefined
  const currentByPath = new Map(current.map((file) => [file.path, file]))
  const targetByPath = new Map(target.map((file) => [file.path, file]))
  const paths = [...new Set([...currentByPath.keys(), ...targetByPath.keys()])].sort((left, right) => left.localeCompare(right))
  return paths.flatMap((path): RegistryUpdateFileChange[] => {
    const before = currentByPath.get(path)
    const after = targetByPath.get(path)
    if (!before && after) {
      return [{
        path,
        status: "added",
        targetSha256: after.sha256,
        targetSize: after.size,
      }]
    }
    if (before && !after) {
      return [{
        path,
        status: "removed",
        currentSha256: before.sha256,
        currentSize: before.size,
      }]
    }
    if (!before || !after || before.sha256?.toLowerCase() === after.sha256?.toLowerCase()) return []
    return [{
      path,
      status: "changed",
      currentSha256: before.sha256,
      targetSha256: after.sha256,
      currentSize: before.size,
      targetSize: after.size,
    }]
  })
}

async function previewRegistryFileChanges(
  id: string,
  target: RegistryVersionRef & { version: string },
  registry?: SkillRegistryCatalog,
  signal?: AbortSignal,
) {
  const current = await listDownloadedRegistrySkillFiles(id)
  try {
    const descriptor = await catalog(registry).getProviderDescriptor(target.provider)
    if (!descriptor.capabilities.files) return undefined
    const files = await listRegistrySkillFiles(target, registry, signal)
    return compareRegistryFiles(current, files)
  } catch (error) {
    if (signal?.aborted) throw error
    return undefined
  }
}

export async function downloadRegistrySkill(
  input: RegistryVersionRef,
  registry?: SkillRegistryCatalog,
  signal?: AbortSignal,
) {
  const resolved = await resolveManagedDownloadInput(input, registry, signal)
  return await managedCall(() => downloadManagedRegistrySkill(resolved, { signal }))
}

export async function listDownloadedRegistrySkills() {
  return await managedCall(() => listManagedRegistrySkills())
}

export async function getDownloadedRegistrySkill(id: string) {
  const skill = await managedCall(() => getManagedRegistrySkill(id))
  if (!skill) throw new ApiError(404, "SKILL_REGISTRY_NOT_FOUND", `Managed registry skill '${id}' was not found`)
  return skill
}

export async function updateDownloadedRegistrySkillEnabled(
  id: string,
  input: z.infer<typeof UpdateDownloadedRegistrySkillBody>,
) {
  return await managedCall(() => setManagedRegistrySkillEnabled(id, input.enabled, {
    acknowledgeRisk: input.acknowledgeRisk,
  }))
}

export async function removeDownloadedRegistrySkill(id: string) {
  return await managedCall(() => deleteManagedRegistrySkill(id))
}

export async function listDownloadedRegistrySkillFiles(id: string, version?: string) {
  return await managedCall(() => listManagedRegistrySkillFiles(id, version))
}

export async function readDownloadedRegistrySkillFile(
  id: string,
  input: z.infer<typeof ReadDownloadedRegistrySkillFileBody>,
) {
  return await managedCall(() => readManagedRegistrySkillFile(id, input.path, input.version))
}

export async function previewDownloadedRegistrySkillUpdate(
  id: string,
  version: string | undefined,
  registry?: SkillRegistryCatalog,
  signal?: AbortSignal,
) {
  const resolved = await resolveInstalledUpdateInput(id, version, registry, signal, {
    allowUnavailableSecurity: true,
  })
  const preview = await managedCall(() => previewManagedRegistryUpdate(id, resolved.descriptor))
  const fileChanges = await previewRegistryFileChanges(id, {
    provider: resolved.descriptor.provider,
    remoteId: resolved.descriptor.remoteId,
    version: resolved.descriptor.version,
  }, registry, signal)
  return RegistryUpdatePreviewSchema.parse({
    ...preview,
    blocked: preview.blocked || Boolean(
      resolved.security?.blocked || resolved.security?.status === "malicious",
    ),
    fileChanges,
    upstreamSecurity: resolved.security,
  })
}

export async function updateDownloadedRegistrySkill(
  id: string,
  version: string | undefined,
  registry?: SkillRegistryCatalog,
  signal?: AbortSignal,
) {
  const resolved = await resolveInstalledUpdateInput(id, version, registry, signal)
  return await managedCall(() => updateManagedRegistrySkill(id, resolved, { signal }))
}

export async function rollbackDownloadedRegistrySkill(id: string, version?: string) {
  return await managedCall(() => rollbackManagedRegistrySkill(id, version))
}

export async function forkDownloadedRegistrySkill(id: string, name?: string) {
  return await managedCall(() => forkManagedRegistrySkillToUser(id, name))
}
