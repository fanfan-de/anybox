interface CacheEntry<T> {
  value: T
  verifiedAt: number
}

export class VerifiedArtifactCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()

  constructor(
    private readonly freshTtlMs: number,
    private readonly staleTtlMs: number,
    private readonly now: () => number,
    private readonly maximumEntries = 256,
  ) {}

  getFresh(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry || this.now() - entry.verifiedAt > this.freshTtlMs) return undefined
    return entry.value
  }

  getStale(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry || this.now() - entry.verifiedAt > this.staleTtlMs) return undefined
    return entry.value
  }

  set(key: string, value: T) {
    const currentTime = this.now()
    for (const [cachedKey, entry] of this.entries) {
      if (currentTime - entry.verifiedAt > this.staleTtlMs) {
        this.entries.delete(cachedKey)
      }
    }
    this.entries.delete(key)
    while (this.entries.size >= this.maximumEntries) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey === undefined) break
      this.entries.delete(oldestKey)
    }
    this.entries.set(key, { value, verifiedAt: currentTime })
  }
}
