import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type { z } from "zod"
import * as Global from "#global/global.ts"

interface CacheEntry<Value> {
  value: Value
  expiresAt: number
}

const CACHE_RECORD_VERSION = 1

interface PersistentCacheRecord {
  version: number
  createdAt: number
  expiresAt: number
  value: unknown
}

export interface PersistentCacheRead<Value> {
  value: Value
  stale: boolean
}

export class RegistryPersistentCache<Schema extends z.ZodType> {
  private readonly directory: string
  private readonly pending = new Map<string, Promise<z.output<Schema>>>()

  constructor(
    namespace: string,
    private readonly schema: Schema,
    private readonly ttlMs: number,
    private readonly options: {
      maxEntries?: number
      now?: () => number
      root?: string
    } = {},
  ) {
    const safeNamespace = namespace.replace(/[^a-z0-9_-]/gi, "-")
    this.directory = path.join(options.root ?? Global.Path.cache, "skill-registry", safeNamespace)
  }

  private now() {
    return (this.options.now ?? Date.now)()
  }

  private filePath(key: string) {
    const digest = createHash("sha256").update(key).digest("hex")
    return path.join(this.directory, `${digest}.json`)
  }

  private async readRecord(key: string): Promise<PersistentCacheRead<z.output<Schema>> | undefined> {
    let raw: unknown
    try {
      raw = JSON.parse(await fs.readFile(this.filePath(key), "utf8"))
    } catch {
      return undefined
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
    const record = raw as Partial<PersistentCacheRecord>
    if (
      record.version !== CACHE_RECORD_VERSION ||
      typeof record.expiresAt !== "number" ||
      typeof record.createdAt !== "number"
    ) return undefined
    const parsed = this.schema.safeParse(record.value)
    if (!parsed.success) {
      await fs.rm(this.filePath(key), { force: true }).catch(() => undefined)
      return undefined
    }
    return {
      value: parsed.data,
      stale: record.expiresAt <= this.now(),
    }
  }

  async get(key: string, allowStale = false) {
    const record = await this.readRecord(key)
    if (!record || (!allowStale && record.stale)) return undefined
    return record
  }

  async set(key: string, value: z.output<Schema>, ttlMs = this.ttlMs) {
    const parsed = this.schema.parse(value)
    const now = this.now()
    const record: PersistentCacheRecord = {
      version: CACHE_RECORD_VERSION,
      createdAt: now,
      expiresAt: now + ttlMs,
      value: parsed,
    }
    await fs.mkdir(this.directory, { recursive: true })
    const target = this.filePath(key)
    const temporary = `${target}.${randomUUID()}.tmp`
    await fs.writeFile(temporary, JSON.stringify(record), { encoding: "utf8", mode: 0o600 })
    await fs.rename(temporary, target).catch(async (error) => {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    })
    await this.prune().catch(() => undefined)
    return parsed
  }

  async getOrLoad(
    key: string,
    load: () => Promise<z.output<Schema>>,
    options: { ttlMs?: number; staleIfError?: boolean; signal?: AbortSignal } = {},
  ) {
    const cached = await this.get(key)
    if (cached) return cached.value
    // Signal-bound loads must remain independently cancellable. Sharing the first
    // request's promise would let one caller's abort cancel unrelated callers.
    const sharesPendingLoad = !options.signal
    const active = sharesPendingLoad ? this.pending.get(key) : undefined
    if (active) return await active

    const promise = load()
      .then(async (value) => {
        const parsed = this.schema.parse(value)
        await this.set(key, parsed, options.ttlMs).catch(() => undefined)
        return parsed
      })
      .catch(async (error) => {
        if (options.staleIfError && !options.signal?.aborted) {
          const stale = await this.get(key, true)
          if (stale) return stale.value
        }
        throw error
      })
      .finally(() => {
        if (sharesPendingLoad) this.pending.delete(key)
      })
    if (sharesPendingLoad) this.pending.set(key, promise)
    return await promise
  }

  async clear() {
    this.pending.clear()
    await fs.rm(this.directory, { recursive: true, force: true })
  }

  private async prune() {
    const maxEntries = this.options.maxEntries ?? 250
    const entries = await fs.readdir(this.directory, { withFileTypes: true })
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => ({
        path: path.join(this.directory, entry.name),
        modifiedAt: (await fs.stat(path.join(this.directory, entry.name))).mtimeMs,
      })))
    files.sort((left, right) => right.modifiedAt - left.modifiedAt)
    await Promise.all(files.slice(maxEntries).map((entry) => fs.rm(entry.path, { force: true })))
  }
}

export class RegistryMemoryCache<Value> {
  private readonly entries = new Map<string, CacheEntry<Value>>()
  private readonly pending = new Map<string, Promise<Value>>()

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string) {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: Value, ttlMs = this.ttlMs) {
    this.entries.set(key, {
      value,
      expiresAt: this.now() + ttlMs,
    })
    return value
  }

  async getOrLoad(key: string, load: () => Promise<Value>, ttlMs = this.ttlMs) {
    const cached = this.get(key)
    if (cached !== undefined) return cached
    const active = this.pending.get(key)
    if (active) return await active

    const promise = load()
      .then((value) => this.set(key, value, ttlMs))
      .finally(() => this.pending.delete(key))
    this.pending.set(key, promise)
    return await promise
  }

  clear() {
    this.entries.clear()
    this.pending.clear()
  }
}
