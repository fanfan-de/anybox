import { z } from "zod"
import { randomUUID } from "node:crypto"
import {
  RegistryFileContentSchema,
  RegistryFileSchema,
  RegistrySearchInputSchema,
  RegistrySearchPageSchema,
  RegistrySecuritySnapshotSchema,
  RegistrySkillDetailSchema,
  RegistryVersionSchema,
  type RegistryDownloadDescriptor,
  type RegistryFile,
  type RegistryFileContent,
  type RegistryProviderDescriptor,
  type RegistryProviderError,
  type RegistrySearchInput,
  type RegistrySearchPage,
  type RegistrySecuritySnapshot,
  type RegistrySkillDetail,
  type RegistrySkillRef,
  type RegistrySkillSummary,
  type RegistryVersion,
  type RegistryVersionRef,
  type RegistryFileRef,
} from "@anybox/shared/skill-registry"
import { ClawHubProvider } from "./clawhub.ts"
import { RegistryMemoryCache, RegistryPersistentCache } from "./cache.ts"
import { RegistryProviderRequestError, toRegistryProviderError } from "./provider.ts"
import { SkillHubProvider } from "./skillhub.ts"
import type { SkillRegistryProvider } from "./types.ts"

const SEARCH_TTL_MS = 15 * 60 * 1000
const DETAIL_TTL_MS = 60 * 60 * 1000
const VERSION_TTL_MS = 60 * 60 * 1000
const IMMUTABLE_FILE_TTL_MS = 365 * 24 * 60 * 60 * 1000
const PARTIAL_SEARCH_TTL_MS = 30 * 1000
const AGGREGATE_CURSOR_TTL_MS = 15 * 60 * 1000
const AGGREGATE_CURSOR_KEY = "$anybox"
const MAX_PROVIDER_PAGE_ROUNDS = 10
// Bump whenever a provider keeps its stable ID but changes upstream contracts.
// Version 2 replaces the former third-party catalog with Tencent SkillHub, so
// no response from the old upstream may survive in memory or on disk.
const REGISTRY_CACHE_SCHEMA_VERSION = 2

const RegistryVersionListSchema = z.array(RegistryVersionSchema)
const RegistryFileListSchema = z.array(RegistryFileSchema)

export interface SkillRegistryCatalogOptions {
  providers?: SkillRegistryProvider[]
  cacheRoot?: string
}

function cacheKey(input: unknown) {
  const serialized = JSON.stringify(input, (_key, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
  })
  return `v${REGISTRY_CACHE_SCHEMA_VERSION}:${serialized}`
}

function dedupeKey(item: RegistrySkillSummary) {
  const source = item.source
  if (source?.repository && source.commit && source.path) {
    return `source:${source.repository.toLowerCase()}|${source.commit}|${source.path}`
  }
  return `id:${item.id}`
}

interface AggregateProviderState {
  pending: RegistrySkillSummary[]
  cursor?: string
  exhausted: boolean
  rankOffset: number
}

interface AggregateCursorState {
  fingerprint: string
  providers: Record<string, AggregateProviderState>
  seenKeys: string[]
  expiresAt: number
}

function cloneProviderState(state: AggregateProviderState): AggregateProviderState {
  return {
    pending: state.pending.map((item) => ({ ...item })),
    cursor: state.cursor,
    exhausted: state.exhausted,
    rankOffset: state.rankOffset,
  }
}

function throwIfAborted(signal: AbortSignal | undefined, provider = "registry") {
  if (!signal?.aborted) return
  throw new RegistryProviderRequestError(provider, "UNAVAILABLE", `${provider} request cancelled`)
}

class FailedRegistryProvider implements SkillRegistryProvider {
  readonly capabilities = {
    search: false,
    browse: false,
    detail: false,
    versions: false,
    files: false,
    download: false,
    security: false,
  }

  constructor(readonly id: string, private readonly failure: unknown) {}

  private fail(): never {
    if (this.failure instanceof RegistryProviderRequestError) throw this.failure
    throw new RegistryProviderRequestError(this.id, "NOT_CONFIGURED", `${this.id} provider configuration is invalid`)
  }

  async getDescriptor(): Promise<RegistryProviderDescriptor> { return this.fail() }
  async search(): Promise<never> { return this.fail() }
  async getDetail(): Promise<never> { return this.fail() }
  async listVersions(): Promise<never> { return this.fail() }
  async listFiles(): Promise<never> { return this.fail() }
  async readFile(): Promise<never> { return this.fail() }
  async resolveDownload(): Promise<never> { return this.fail() }
  async getSecurity(): Promise<never> { return this.fail() }
}

function defaultRegistryProviders(): SkillRegistryProvider[] {
  let skillHub: SkillRegistryProvider
  try {
    skillHub = new SkillHubProvider()
  } catch (error) {
    skillHub = new FailedRegistryProvider("skillhub", error)
  }
  return [new ClawHubProvider(), skillHub]
}

export class SkillRegistryCatalog {
  private readonly providers: Map<string, SkillRegistryProvider>
  private readonly searchMemory = new RegistryMemoryCache<RegistrySearchPage>(SEARCH_TTL_MS)
  private readonly detailMemory = new RegistryMemoryCache<RegistrySkillDetail>(DETAIL_TTL_MS)
  private readonly searchDisk: RegistryPersistentCache<typeof RegistrySearchPageSchema>
  private readonly detailDisk: RegistryPersistentCache<typeof RegistrySkillDetailSchema>
  private readonly versionsDisk: RegistryPersistentCache<typeof RegistryVersionListSchema>
  private readonly filesDisk: RegistryPersistentCache<typeof RegistryFileListSchema>
  private readonly fileDisk: RegistryPersistentCache<typeof RegistryFileContentSchema>
  private readonly cursorStates = new Map<string, AggregateCursorState>()

  constructor(options: SkillRegistryCatalogOptions = {}) {
    const providers = options.providers ?? defaultRegistryProviders()
    this.providers = new Map(providers.map((provider) => [provider.id, provider]))
    const persistentOptions = { root: options.cacheRoot }
    this.searchDisk = new RegistryPersistentCache("search", RegistrySearchPageSchema, SEARCH_TTL_MS, {
      ...persistentOptions,
      maxEntries: 150,
    })
    this.detailDisk = new RegistryPersistentCache("detail", RegistrySkillDetailSchema, DETAIL_TTL_MS, {
      ...persistentOptions,
      maxEntries: 300,
    })
    this.versionsDisk = new RegistryPersistentCache("versions", RegistryVersionListSchema, VERSION_TTL_MS, {
      ...persistentOptions,
      maxEntries: 300,
    })
    this.filesDisk = new RegistryPersistentCache("files", RegistryFileListSchema, IMMUTABLE_FILE_TTL_MS, {
      ...persistentOptions,
      maxEntries: 600,
    })
    this.fileDisk = new RegistryPersistentCache("file-content", RegistryFileContentSchema, IMMUTABLE_FILE_TTL_MS, {
      ...persistentOptions,
      maxEntries: 1_000,
    })
  }

  private async describeProviders(): Promise<Array<{
    provider: string
    descriptor?: RegistryProviderDescriptor
    error?: RegistryProviderError
  }>> {
    const providers = [...this.providers.values()]
    const settled = await Promise.allSettled(providers.map((provider) => provider.getDescriptor()))
    return settled.map((result, index) => result.status === "fulfilled"
      ? { provider: providers[index]!.id, descriptor: result.value }
      : { provider: providers[index]!.id, error: toRegistryProviderError(result.reason, providers[index]!.id) })
  }

  async listProviders() {
    return (await this.describeProviders()).flatMap((result) =>
      result.descriptor ? [result.descriptor] : [])
  }

  private requireProvider(id: string) {
    const provider = this.providers.get(id)
    if (!provider) {
      throw new RegistryProviderRequestError(id, "NOT_SUPPORTED", `Unknown skill registry provider '${id}'`)
    }
    return provider
  }

  async search(rawInput: RegistrySearchInput, signal?: AbortSignal): Promise<RegistrySearchPage> {
    throwIfAborted(signal)
    const input = RegistrySearchInputSchema.parse(rawInput)
    const described = await this.describeProviders()
    const descriptors = new Map(described.flatMap((result) =>
      result.descriptor ? [[result.descriptor.id, result.descriptor] as const] : []))
    const descriptorFailures = new Map(described.flatMap((result) =>
      result.error ? [[result.provider, result.error] as const] : []))
    const requestedIds = [...new Set(input.providers ?? [
      ...[...descriptors.values()].filter((descriptor) => descriptor.enabled).map((descriptor) => descriptor.id),
      ...descriptorFailures.keys(),
    ])]
    const fingerprint = cacheKey({
      query: input.query,
      providers: requestedIds,
      limit: input.limit,
      sort: input.sort,
      category: input.category,
      safeOnly: input.safeOnly,
    })
    const aggregateToken = input.cursor?.[AGGREGATE_CURSOR_KEY]
    const isFirstPage = !input.cursor || Object.keys(input.cursor).length === 0
    const firstPageKey = fingerprint
    if (isFirstPage) {
      const memory = this.searchMemory.get(firstPageKey)
      if (memory && !memory.nextCursor) return memory
      const disk = await this.searchDisk.get(firstPageKey)
      if (disk && !disk.value.nextCursor) return this.searchMemory.set(firstPageKey, disk.value)
    }

    const now = Date.now()
    for (const [token, state] of this.cursorStates) {
      if (state.expiresAt <= now) this.cursorStates.delete(token)
    }
    const saved = aggregateToken ? this.cursorStates.get(aggregateToken) : undefined
    if (aggregateToken && (!saved || saved.expiresAt <= now || saved.fingerprint !== fingerprint)) {
      throw new RegistryProviderRequestError("registry", "INVALID_REQUEST", "Registry search cursor is invalid or expired")
    }

    const immediateErrors: RegistryProviderError[] = []
    const selected = new Map<string, SkillRegistryProvider>()
    for (const providerId of requestedIds) {
      const descriptorFailure = descriptorFailures.get(providerId)
      if (descriptorFailure) {
        immediateErrors.push(descriptorFailure)
        continue
      }
      const descriptor = descriptors.get(providerId)
      const provider = this.providers.get(providerId)
      if (!descriptor || !provider) {
        immediateErrors.push({
          provider: providerId,
          code: "NOT_SUPPORTED",
          message: `Unknown skill registry provider '${providerId}'`,
        })
        continue
      }
      if (!descriptor.enabled) {
        immediateErrors.push({
          provider: providerId,
          code: "NOT_CONFIGURED",
          message: `${descriptor.name} is not configured or is disabled`,
        })
        continue
      }
      selected.set(providerId, provider)
    }

    const hasLegacyCursor = Boolean(input.cursor && !aggregateToken && Object.keys(input.cursor).length > 0)
    const providerStates: Record<string, AggregateProviderState> = saved
      ? Object.fromEntries(requestedIds.map((providerId) => [
          providerId,
          cloneProviderState(saved.providers[providerId] ?? {
            pending: [], cursor: undefined, exhausted: true, rankOffset: 0,
          }),
        ]))
      : Object.fromEntries(requestedIds.map((providerId) => [providerId, {
          pending: [],
          cursor: input.cursor?.[providerId],
          exhausted: hasLegacyCursor && !input.cursor?.[providerId],
          rankOffset: 0,
        }]))
    for (const providerId of requestedIds) {
      if (!selected.has(providerId)) providerStates[providerId]!.exhausted = true
    }
    const seenKeys = new Set(saved?.seenKeys ?? [])
    const errors = [...immediateErrors]
    const failed = new Set<string>()
    let succeeded = 0

    const availableCount = () => new Set(Object.values(providerStates)
      .flatMap((state) => state.pending)
      .map(dedupeKey)
      .filter((key) => !seenKeys.has(key))).size

    for (let round = 0; round < MAX_PROVIDER_PAGE_ROUNDS && availableCount() < input.limit; round += 1) {
      throwIfAborted(signal)
      const fetchable = [...selected.values()].filter((provider) => {
        const state = providerStates[provider.id]
        return state && !state.exhausted && !failed.has(provider.id)
      })
      if (fetchable.length === 0) break
      const settled = await Promise.all(fetchable.map(async (provider) => {
        try {
          const state = providerStates[provider.id]!
          const page = await provider.search({
            query: input.query,
            limit: input.limit,
            cursor: state.cursor,
            sort: input.sort,
            category: input.category,
            safeOnly: input.safeOnly,
          }, signal)
          return { provider: provider.id, page }
        } catch (error) {
          if (signal?.aborted) throw error
          return { provider: provider.id, error: toRegistryProviderError(error, provider.id) }
        }
      }))
      let added = 0
      for (const result of settled) {
        if ("error" in result) {
          failed.add(result.provider)
          errors.push(result.error!)
          continue
        }
        succeeded += 1
        const state = providerStates[result.provider]!
        const ranked = result.page.items.map((item, index) => ({
          ...item,
          score: 1 / (state.rankOffset + index + 1),
        }))
        state.rankOffset += result.page.items.length
        state.pending.push(...ranked)
        state.cursor = result.page.nextCursor
        state.exhausted = !result.page.nextCursor
        errors.push(...(result.page.errors ?? []))
        added += ranked.length
      }
      if (added === 0) break
    }
    throwIfAborted(signal)

    const candidates = new Map<string, RegistrySkillSummary>()
    for (const state of Object.values(providerStates)) {
      for (const item of state.pending) {
        const key = dedupeKey(item)
        if (seenKeys.has(key)) continue
        const existing = candidates.get(key)
        if (!existing || (item.score ?? 0) > (existing.score ?? 0)) candidates.set(key, item)
      }
    }
    const items = [...candidates.values()]
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.displayName.localeCompare(right.displayName))
      .slice(0, input.limit)
    const emittedKeys = new Set(items.map(dedupeKey))
    for (const key of emittedKeys) seenKeys.add(key)
    for (const state of Object.values(providerStates)) {
      state.pending = state.pending.filter((item) => {
        const key = dedupeKey(item)
        return !seenKeys.has(key) && candidates.get(key) === item
      })
    }

    const canContinue = Object.values(providerStates).some((state) => state.pending.length > 0 || !state.exhausted)
    let nextCursor: Record<string, string> | undefined
    if (canContinue && items.length > 0) {
      const token = randomUUID()
      this.cursorStates.set(token, {
        fingerprint,
        providers: Object.fromEntries(Object.entries(providerStates).map(([providerId, state]) => [
          providerId,
          cloneProviderState(state),
        ])),
        seenKeys: [...seenKeys],
        expiresAt: now + AGGREGATE_CURSOR_TTL_MS,
      })
      nextCursor = { [AGGREGATE_CURSOR_KEY]: token }
      if (this.cursorStates.size > 500) {
        const oldest = [...this.cursorStates.entries()]
          .sort(([, left], [, right]) => left.expiresAt - right.expiresAt)
          .slice(0, this.cursorStates.size - 500)
        for (const [oldToken] of oldest) this.cursorStates.delete(oldToken)
      }
    }

    const page: RegistrySearchPage = {
      items,
      nextCursor,
      errors,
    }

    if (isFirstPage && !nextCursor && (succeeded > 0 || selected.size === 0)) {
      const ttlMs = errors.length > 0 ? PARTIAL_SEARCH_TTL_MS : SEARCH_TTL_MS
      await this.searchDisk.set(firstPageKey, page, ttlMs).catch(() => undefined)
      return this.searchMemory.set(firstPageKey, page, ttlMs)
    }

    if (isFirstPage && items.length === 0 && succeeded === 0) {
      throwIfAborted(signal)
      const stale = await this.searchDisk.get(firstPageKey, true)
      if (!stale) return page
      const fallback = { ...stale.value, errors }
      return this.searchMemory.set(firstPageKey, fallback, PARTIAL_SEARCH_TTL_MS)
    }
    return page
  }

  async getDetail(input: RegistrySkillRef, signal?: AbortSignal): Promise<RegistrySkillDetail> {
    throwIfAborted(signal, input.provider)
    const key = cacheKey(input)
    const memory = this.detailMemory.get(key)
    if (memory) return memory
    const disk = await this.detailDisk.get(key)
    if (disk) return this.detailMemory.set(key, disk.value)
    const provider = this.requireProvider(input.provider)
    try {
      const detail = await provider.getDetail(input, signal)
      throwIfAborted(signal, input.provider)
      await this.detailDisk.set(key, detail).catch(() => undefined)
      return this.detailMemory.set(key, detail)
    } catch (error) {
      if (signal?.aborted) throw error
      const stale = await this.detailDisk.get(key, true)
      if (stale) return this.detailMemory.set(key, stale.value, 30_000)
      throw error
    }
  }

  async listVersions(input: RegistrySkillRef, signal?: AbortSignal): Promise<RegistryVersion[]> {
    throwIfAborted(signal, input.provider)
    const key = cacheKey(input)
    return await this.versionsDisk.getOrLoad(
      key,
      () => this.requireProvider(input.provider).listVersions(input, signal),
      { staleIfError: true, signal },
    )
  }

  async listFiles(input: RegistryVersionRef, signal?: AbortSignal): Promise<RegistryFile[]> {
    throwIfAborted(signal, input.provider)
    const key = cacheKey(input)
    return await this.filesDisk.getOrLoad(
      key,
      () => this.requireProvider(input.provider).listFiles(input, signal),
      {
        ttlMs: input.version ? IMMUTABLE_FILE_TTL_MS : DETAIL_TTL_MS,
        staleIfError: true,
        signal,
      },
    )
  }

  async readFile(input: RegistryFileRef, signal?: AbortSignal): Promise<RegistryFileContent> {
    throwIfAborted(signal, input.provider)
    const provider = this.requireProvider(input.provider)
    let manifestSha256: string | undefined
    if (input.version && provider.capabilities.files) {
      const manifest = await this.listFiles(input, signal)
      manifestSha256 = manifest.find((file) => file.path === input.path)?.sha256?.toLowerCase()
    }
    const immutable = Boolean(input.version && manifestSha256)
    const key = cacheKey({ ...input, contentSha256: manifestSha256 })
    return await this.fileDisk.getOrLoad(
      key,
      async () => {
        const content = await provider.readFile(input, signal)
        if (manifestSha256 && content.sha256?.toLowerCase() !== manifestSha256) {
          throw new RegistryProviderRequestError(
            input.provider,
            "INVALID_RESPONSE",
            `${input.provider} file content does not match its immutable manifest hash`,
          )
        }
        return content
      },
      {
        ttlMs: immutable ? IMMUTABLE_FILE_TTL_MS : DETAIL_TTL_MS,
        staleIfError: true,
        signal,
      },
    )
  }

  async getSecurity(input: RegistryVersionRef, signal?: AbortSignal): Promise<RegistrySecuritySnapshot> {
    throwIfAborted(signal, input.provider)
    return await this.requireProvider(input.provider).getSecurity(input, signal)
  }

  async resolveDownload(input: RegistryVersionRef, signal?: AbortSignal): Promise<RegistryDownloadDescriptor> {
    throwIfAborted(signal, input.provider)
    return await this.requireProvider(input.provider).resolveDownload(input, signal)
  }

  async getProviderDescriptor(id: string): Promise<RegistryProviderDescriptor> {
    return await this.requireProvider(id).getDescriptor()
  }

  async invalidateProvider(id: string) {
    const provider = this.providers.get(id)
    await Promise.resolve(provider?.invalidateCache?.()).catch(() => undefined)
    this.searchMemory.clear()
    this.detailMemory.clear()
    this.cursorStates.clear()
    await Promise.all([
      this.searchDisk.clear(),
      this.detailDisk.clear(),
      this.versionsDisk.clear(),
      this.filesDisk.clear(),
      this.fileDisk.clear(),
    ].map((operation) => operation.catch(() => undefined)))
  }
}

let defaultCatalog: SkillRegistryCatalog | undefined

export function getDefaultSkillRegistryCatalog() {
  defaultCatalog ??= new SkillRegistryCatalog()
  return defaultCatalog
}

export function resetDefaultSkillRegistryCatalogForTests() {
  defaultCatalog = undefined
}
