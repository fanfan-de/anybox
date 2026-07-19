import type { BrowserExtensionCommandContext } from "@anybox/chrome-shared/browser-extension"

const LEASE_STORAGE_KEY = "anybox.browser.tabLeases.v2"
const DEFAULT_LEASE_TTL_MS = 30 * 60_000

export type TabLeaseSource = "user" | "agent"
export type TabLeaseState = "active" | "deliverable" | "handoff" | "released"

export type TabLease = {
  tabId: number
  source: TabLeaseSource
  sessionID: string
  turnID: string
  state: TabLeaseState
  retained?: boolean
  extensionInstanceID: string
  openerTabId?: number
  createdAt: number
  updatedAt: number
  expiresAt: number
}

type LeaseMap = Record<string, TabLease>
type LeaseCleanupPlan = {
  closeTabIds: number[]
  releaseTabIds: number[]
  retainTabIds: number[]
}

let leaseMutationTail: Promise<void> = Promise.resolve()

function isLease(value: unknown): value is TabLease {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const lease = value as Partial<TabLease>
  return Number.isInteger(lease.tabId)
    && Number(lease.tabId) > 0
    && (lease.source === "user" || lease.source === "agent")
    && typeof lease.sessionID === "string"
    && Boolean(lease.sessionID)
    && typeof lease.turnID === "string"
    && Boolean(lease.turnID)
    && (
      lease.state === "active"
      || lease.state === "deliverable"
      || lease.state === "handoff"
      || lease.state === "released"
    )
    && typeof lease.extensionInstanceID === "string"
    && Boolean(lease.extensionInstanceID)
    && (
      lease.retained === undefined
      || typeof lease.retained === "boolean"
    )
    && typeof lease.createdAt === "number"
    && typeof lease.updatedAt === "number"
    && typeof lease.expiresAt === "number"
}

async function readLeaseMapRaw(): Promise<LeaseMap> {
  const stored = await chrome.storage.session.get(LEASE_STORAGE_KEY)
  const raw = stored[LEASE_STORAGE_KEY]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw)
      .filter((entry): entry is [string, TabLease] => isLease(entry[1])),
  )
}

async function writeLeaseMap(leases: LeaseMap) {
  await chrome.storage.session.set({ [LEASE_STORAGE_KEY]: leases })
}

async function readLeaseMap(): Promise<LeaseMap> {
  await leaseMutationTail
  return readLeaseMapRaw()
}

async function mutateLeaseMap<T>(
  mutate: (leases: LeaseMap) => T | Promise<T>,
): Promise<T> {
  const operation = leaseMutationTail.then(async () => {
    const leases = await readLeaseMapRaw()
    const result = await mutate(leases)
    await writeLeaseMap(leases)
    return result
  })
  leaseMutationTail = operation.then(
    () => undefined,
    () => undefined,
  )
  return operation
}

function requireContext(
  context: BrowserExtensionCommandContext | undefined,
): asserts context is BrowserExtensionCommandContext & {
  sessionID: string
  turnID: string
  extensionInstanceID: string
} {
  if (
    !context?.sessionID
    || !context.turnID
    || !context.extensionInstanceID
  ) {
    throw Object.assign(
      new Error(
        "Browser Contract v2 requires sessionID, turnID, and extensionInstanceID for tab leases.",
      ),
      { code: "SESSION_REQUIRED", retryable: false },
    )
  }
}

export async function listLeases() {
  return Object.values(await readLeaseMap())
}

export async function getLease(tabId: number) {
  return (await readLeaseMap())[String(tabId)]
}

export async function createLease(input: {
  tabId: number
  source: TabLeaseSource
  context: BrowserExtensionCommandContext
  extensionInstanceID: string
  openerTabId?: number
  ttlMs?: number
}) {
  requireContext({
    ...input.context,
    extensionInstanceID: input.extensionInstanceID,
  })
  const now = Date.now()
  return mutateLeaseMap((leases) => {
    const existing = leases[String(input.tabId)]
    if (
      existing
      && (
        (
          existing.state !== "released"
          && (
            existing.sessionID !== input.context.sessionID
            || existing.extensionInstanceID !== input.extensionInstanceID
          )
        )
        || (
          existing.source === "agent"
          && existing.retained !== true
          && (
            existing.sessionID !== input.context.sessionID
            || existing.extensionInstanceID !== input.extensionInstanceID
          )
        )
      )
    ) {
      throw Object.assign(
        new Error(`Tab ${input.tabId} belongs to a different browser session.`),
        { code: "TAB_NOT_OWNED", retryable: false },
      )
    }
    const lease: TabLease = {
      tabId: input.tabId,
      source: existing?.source ?? input.source,
      sessionID: input.context.sessionID!,
      turnID: input.context.turnID!,
      state: "active",
      retained: existing?.retained,
      extensionInstanceID: input.extensionInstanceID,
      openerTabId: input.openerTabId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt: now + Math.max(input.ttlMs ?? DEFAULT_LEASE_TTL_MS, 60_000),
    }
    leases[String(input.tabId)] = lease
    return lease
  })
}

function ownedLease(
  leases: LeaseMap,
  tabId: number,
  context: BrowserExtensionCommandContext | undefined,
) {
  requireContext(context)
  const lease = leases[String(tabId)]
  if (!lease || lease.state === "released") {
    throw Object.assign(
      new Error(`Tab ${tabId} must be claimed before it can be controlled.`),
      { code: "TAB_CLAIM_REQUIRED", retryable: false },
    )
  }
  if (
    lease.sessionID !== context.sessionID
    || lease.extensionInstanceID !== context.extensionInstanceID
  ) {
    throw Object.assign(
      new Error(`Tab ${tabId} belongs to a different browser session.`),
      { code: "TAB_NOT_OWNED", retryable: false },
    )
  }
  if (lease.expiresAt <= Date.now()) {
    throw Object.assign(
      new Error(`The lease for tab ${tabId} has expired.`),
      { code: "LEASE_EXPIRED", retryable: false },
    )
  }
  return { lease, context }
}

export async function requireLease(
  tabId: number,
  context: BrowserExtensionCommandContext | undefined,
) {
  return mutateLeaseMap((leases) => {
    const owned = ownedLease(leases, tabId, context)
    const lease = owned.lease
    const activeContext = owned.context
    const now = Date.now()
    const next = {
      ...lease,
      turnID: activeContext.turnID,
      updatedAt: now,
      expiresAt: now + DEFAULT_LEASE_TTL_MS,
    }
    leases[String(tabId)] = next
    return next
  })
}

export async function markDeliverable(
  tabId: number,
  context: BrowserExtensionCommandContext | undefined,
) {
  return mutateLeaseMap((leases) => {
    const { lease } = ownedLease(leases, tabId, context)
    const next: TabLease = {
      ...lease,
      state: "deliverable",
      retained: true,
      updatedAt: Date.now(),
    }
    leases[String(tabId)] = next
    return next
  })
}

export async function releaseLease(
  tabId: number,
  context: BrowserExtensionCommandContext | undefined,
) {
  return mutateLeaseMap((leases) => {
    const { lease } = ownedLease(leases, tabId, context)
    leases[String(tabId)] = {
      ...lease,
      state: "released",
      updatedAt: Date.now(),
      expiresAt: Date.now(),
    }
    return lease
  })
}

function finalizeSelectedLeases(
  leases: LeaseMap,
  selected: TabLease[],
): LeaseCleanupPlan {
  const closeTabIds: number[] = []
  const releaseTabIds: number[] = []
  const retainTabIds: number[] = []
  const now = Date.now()
  for (const lease of selected) {
    if (
      lease.retained === true
      || lease.state === "deliverable"
      || lease.state === "handoff"
    ) {
      retainTabIds.push(lease.tabId)
      leases[String(lease.tabId)] = {
        ...lease,
        state: "released",
        retained: true,
        updatedAt: now,
        expiresAt: now,
      }
    } else if (lease.source === "agent") {
      closeTabIds.push(lease.tabId)
      delete leases[String(lease.tabId)]
    } else {
      releaseTabIds.push(lease.tabId)
      leases[String(lease.tabId)] = {
        ...lease,
        state: "released",
        updatedAt: now,
        expiresAt: now,
      }
    }
  }
  return { closeTabIds, releaseTabIds, retainTabIds }
}

export async function finalizeSessionLeases(sessionID: string) {
  return mutateLeaseMap((leases) => finalizeSelectedLeases(
    leases,
    Object.values(leases).filter(
      (lease) =>
        lease.sessionID === sessionID
        && (
          lease.state !== "released"
          || (lease.source === "agent" && lease.retained !== true)
        ),
    ),
  ))
}

export async function finalizeTurnLeases(sessionID: string, turnID: string) {
  return mutateLeaseMap((leases) => finalizeSelectedLeases(
    leases,
    Object.values(leases).filter(
      (lease) =>
        lease.sessionID === sessionID
        && lease.turnID === turnID
        && (
          lease.state !== "released"
          || (lease.source === "agent" && lease.retained !== true)
        ),
    ),
  ))
}

export async function finalizeExpiredLeases(now = Date.now()) {
  return mutateLeaseMap((leases) => {
    const result = finalizeSelectedLeases(
      leases,
      Object.values(leases).filter(
        (lease) =>
          lease.expiresAt <= now
          && (
            lease.state !== "released"
            || (lease.source === "agent" && lease.retained !== true)
          ),
      ),
    )
    for (const [key, lease] of Object.entries(leases)) {
      if (lease.state === "released" && now - lease.updatedAt > 60 * 60_000) {
        delete leases[key]
      }
    }
    return result
  })
}

export async function finalizeAllLeases() {
  return mutateLeaseMap((leases) => finalizeSelectedLeases(
    leases,
    Object.values(leases).filter(
      (lease) =>
        lease.state !== "released"
        || (lease.source === "agent" && lease.retained !== true),
    ),
  ))
}

export function installLeaseInheritance(extensionInstanceID: () => Promise<string>) {
  chrome.tabs.onCreated.addListener((tab: any) => {
    if (
      typeof tab?.id !== "number"
      || typeof tab?.openerTabId !== "number"
    ) {
      return
    }
    void (async () => {
      const opener = await getLease(tab.openerTabId)
      if (!opener || opener.state === "released" || opener.expiresAt <= Date.now()) {
        return
      }
      const currentExtensionInstanceID = await extensionInstanceID()
      if (currentExtensionInstanceID !== opener.extensionInstanceID) return
      await createLease({
        tabId: tab.id,
        source: opener.source,
        context: {
          sessionID: opener.sessionID,
          turnID: opener.turnID,
          extensionInstanceID: opener.extensionInstanceID,
        },
        extensionInstanceID: currentExtensionInstanceID,
        openerTabId: tab.openerTabId,
      })
    })()
  })
  chrome.tabs.onRemoved.addListener((tabId: number) => {
    void mutateLeaseMap((leases) => {
      if (!leases[String(tabId)]) return
      delete leases[String(tabId)]
    })
  })
}

export function getLeaseStorageKey() {
  return LEASE_STORAGE_KEY
}
