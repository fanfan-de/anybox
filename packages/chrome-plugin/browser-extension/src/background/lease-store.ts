import type {
  BrowserExtensionCommandContext,
} from "@anybox/chrome-shared/browser-extension"

const LEASE_STORAGE_KEY = "anybox.browser.tabLeases.v4"
const LEGACY_LEASE_STORAGE_KEY = "anybox.browser.tabLeases"
const DEFAULT_LEASE_TTL_MS = 30 * 60_000

export type TabLeaseSource = "user" | "agent"
export type TabLeaseState = "active" | "handoff"
export type TabLeaseMark = "deliverable" | "handoff"

export type TabLease = {
  tabId: number
  source: TabLeaseSource
  sessionID: string
  turnID: string
  state: TabLeaseState
  mark?: TabLeaseMark
  extensionInstanceID: string
  openerTabId?: number
  createdAt: number
  updatedAt: number
  expiresAt: number
}

export type FinalizeKeepEntry = {
  tabId: number
  status: TabLeaseMark
}

export type LeaseCleanupPlan = {
  closeTabIds: number[]
  releaseTabIds: number[]
  deliverableTabIds: number[]
  handoffTabIds: number[]
  ungroupTabIds: number[]
}

type LeaseMap = Record<string, TabLease>
type CleanupExecutor = (plan: LeaseCleanupPlan) => void | Promise<void>

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
    && (lease.state === "active" || lease.state === "handoff")
    && (
      lease.mark === undefined
      || lease.mark === "deliverable"
      || lease.mark === "handoff"
    )
    && typeof lease.extensionInstanceID === "string"
    && Boolean(lease.extensionInstanceID)
    && typeof lease.createdAt === "number"
    && typeof lease.updatedAt === "number"
    && typeof lease.expiresAt === "number"
}

async function clearLegacyLeaseMap() {
  const legacy = await chrome.storage.session.get(LEGACY_LEASE_STORAGE_KEY)
  if (legacy[LEGACY_LEASE_STORAGE_KEY] === undefined) return
  if (typeof chrome.storage.session.remove === "function") {
    await chrome.storage.session.remove(LEGACY_LEASE_STORAGE_KEY)
  } else {
    await chrome.storage.session.set({ [LEGACY_LEASE_STORAGE_KEY]: {} })
  }
}

async function readLeaseMapRaw(): Promise<LeaseMap> {
  await clearLegacyLeaseMap()
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
        "Browser Contract v4 requires sessionID, turnID, and extensionInstanceID for tab leases.",
      ),
      { code: "SESSION_REQUIRED", retryable: false },
    )
  }
}

function stableLeaseError(
  message: string,
  code: "TAB_CLAIM_REQUIRED" | "TAB_NOT_OWNED" | "LEASE_EXPIRED" | "TURN_ENDED" | "INVALID_COMMAND_PARAMS",
) {
  return Object.assign(new Error(message), { code, retryable: false })
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
        existing.sessionID !== input.context.sessionID
        || existing.extensionInstanceID !== input.extensionInstanceID
      )
    ) {
      throw stableLeaseError(
        `Tab ${input.tabId} belongs to a different browser session.`,
        "TAB_NOT_OWNED",
      )
    }
    const lease: TabLease = {
      tabId: input.tabId,
      source: existing?.source ?? input.source,
      sessionID: input.context.sessionID!,
      turnID: input.context.turnID!,
      state: "active",
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
  if (!lease) {
    throw stableLeaseError(
      `Tab ${tabId} must be claimed before it can be controlled.`,
      "TAB_CLAIM_REQUIRED",
    )
  }
  if (
    lease.sessionID !== context.sessionID
    || lease.extensionInstanceID !== context.extensionInstanceID
  ) {
    throw stableLeaseError(
      `Tab ${tabId} belongs to a different browser session.`,
      "TAB_NOT_OWNED",
    )
  }
  if (lease.expiresAt <= Date.now()) {
    throw stableLeaseError(
      `The lease for tab ${tabId} has expired.`,
      "LEASE_EXPIRED",
    )
  }
  return { lease, context }
}

function resumeLeaseForTurn(
  lease: TabLease,
  context: BrowserExtensionCommandContext & {
    sessionID: string
    turnID: string
    extensionInstanceID: string
  },
) {
  if (lease.state === "handoff" && lease.turnID === context.turnID) {
    throw stableLeaseError(
      `Turn '${context.turnID}' has already finalized tab ${lease.tabId}.`,
      "TURN_ENDED",
    )
  }
  const now = Date.now()
  return {
    ...lease,
    turnID: context.turnID,
    state: "active" as const,
    mark: lease.turnID === context.turnID ? lease.mark : undefined,
    updatedAt: now,
    expiresAt: now + DEFAULT_LEASE_TTL_MS,
  }
}

export async function requireLease(
  tabId: number,
  context: BrowserExtensionCommandContext | undefined,
) {
  return mutateLeaseMap((leases) => {
    const owned = ownedLease(leases, tabId, context)
    const next = resumeLeaseForTurn(owned.lease, owned.context)
    leases[String(tabId)] = next
    return next
  })
}

async function markLease(
  tabId: number,
  mark: TabLeaseMark,
  context: BrowserExtensionCommandContext | undefined,
) {
  return mutateLeaseMap((leases) => {
    const owned = ownedLease(leases, tabId, context)
    const active = resumeLeaseForTurn(owned.lease, owned.context)
    const next: TabLease = {
      ...active,
      mark,
      updatedAt: Date.now(),
    }
    leases[String(tabId)] = next
    return next
  })
}

export async function markDeliverable(
  tabId: number,
  context: BrowserExtensionCommandContext | undefined,
) {
  return markLease(tabId, "deliverable", context)
}

export async function markHandoff(
  tabId: number,
  context: BrowserExtensionCommandContext | undefined,
) {
  return markLease(tabId, "handoff", context)
}

export async function releaseLease(
  tabId: number,
  context: BrowserExtensionCommandContext | undefined,
) {
  return mutateLeaseMap((leases) => {
    const { lease } = ownedLease(leases, tabId, context)
    delete leases[String(tabId)]
    return lease
  })
}

function emptyPlan(): LeaseCleanupPlan {
  return {
    closeTabIds: [],
    releaseTabIds: [],
    deliverableTabIds: [],
    handoffTabIds: [],
    ungroupTabIds: [],
  }
}

function validateKeepList(
  leases: LeaseMap,
  keep: readonly FinalizeKeepEntry[],
  context: BrowserExtensionCommandContext & {
    sessionID: string
    turnID: string
    extensionInstanceID: string
  },
) {
  const result = new Map<number, TabLeaseMark>()
  for (const entry of keep) {
    if (result.has(entry.tabId)) {
      throw stableLeaseError(
        `Tab ${entry.tabId} appears more than once in the final keep list.`,
        "INVALID_COMMAND_PARAMS",
      )
    }
    const lease = leases[String(entry.tabId)]
    if (
      !lease
      || lease.sessionID !== context.sessionID
      || lease.extensionInstanceID !== context.extensionInstanceID
    ) {
      throw stableLeaseError(
        `Tab ${entry.tabId} does not belong to the current browser session.`,
        "TAB_NOT_OWNED",
      )
    }
    if (lease.turnID !== context.turnID || lease.state !== "active") {
      throw stableLeaseError(
        `Tab ${entry.tabId} does not belong to the current turn.`,
        "TURN_ENDED",
      )
    }
    if (lease.expiresAt <= Date.now()) {
      throw stableLeaseError(
        `The lease for tab ${entry.tabId} has expired.`,
        "LEASE_EXPIRED",
      )
    }
    result.set(entry.tabId, entry.status)
  }
  return result
}

function planTurnCleanup(
  leases: LeaseMap,
  keep: ReadonlyMap<number, TabLeaseMark>,
  context: BrowserExtensionCommandContext & {
    sessionID: string
    turnID: string
    extensionInstanceID: string
  },
) {
  const plan = emptyPlan()
  const selected = Object.values(leases).filter((lease) =>
    lease.sessionID === context.sessionID
    && lease.extensionInstanceID === context.extensionInstanceID
    && lease.turnID === context.turnID
    && lease.state === "active"
  )
  for (const lease of selected) {
    if (lease.source === "user") {
      plan.releaseTabIds.push(lease.tabId)
      continue
    }
    const status = keep.get(lease.tabId)
    if (status === "deliverable") {
      plan.deliverableTabIds.push(lease.tabId)
      plan.ungroupTabIds.push(lease.tabId)
    } else if (status === "handoff") {
      plan.handoffTabIds.push(lease.tabId)
    } else {
      plan.closeTabIds.push(lease.tabId)
    }
  }
  return plan
}

function planTerminalCleanup(selected: readonly TabLease[]) {
  const plan = emptyPlan()
  for (const lease of selected) {
    if (lease.source === "user") {
      plan.releaseTabIds.push(lease.tabId)
    } else if (lease.state === "handoff") {
      plan.releaseTabIds.push(lease.tabId)
      plan.ungroupTabIds.push(lease.tabId)
    } else {
      plan.closeTabIds.push(lease.tabId)
    }
  }
  return plan
}

function commitCleanup(
  leases: LeaseMap,
  plan: LeaseCleanupPlan,
) {
  for (const tabId of [
    ...plan.closeTabIds,
    ...plan.releaseTabIds,
    ...plan.deliverableTabIds,
  ]) {
    delete leases[String(tabId)]
  }
  const now = Date.now()
  for (const tabId of plan.handoffTabIds) {
    const lease = leases[String(tabId)]
    if (!lease) continue
    leases[String(tabId)] = {
      ...lease,
      state: "handoff",
      mark: undefined,
      updatedAt: now,
      expiresAt: now + DEFAULT_LEASE_TTL_MS,
    }
  }
}

async function finalizeSelectedLeases(
  selectAndPlan: (leases: LeaseMap) => LeaseCleanupPlan,
  cleanup: CleanupExecutor = async () => undefined,
) {
  return mutateLeaseMap(async (leases) => {
    const plan = selectAndPlan(leases)
    await cleanup(plan)
    commitCleanup(leases, plan)
    return plan
  })
}

export async function finalizeTurnLeases(
  context: BrowserExtensionCommandContext | undefined,
  keep: readonly FinalizeKeepEntry[] = [],
  cleanup?: CleanupExecutor,
) {
  requireContext(context)
  return finalizeSelectedLeases((leases) => {
    const validatedKeep = validateKeepList(leases, keep, context)
    return planTurnCleanup(leases, validatedKeep, context)
  }, cleanup)
}

export async function finalizeSessionLeases(
  sessionID: string,
  extensionInstanceID?: string,
  cleanup?: CleanupExecutor,
) {
  return finalizeSelectedLeases(
    (leases) => planTerminalCleanup(
      Object.values(leases).filter((lease) =>
        lease.sessionID === sessionID
        && (
          extensionInstanceID === undefined
          || lease.extensionInstanceID === extensionInstanceID
        )
      ),
    ),
    cleanup,
  )
}

export async function finalizeExpiredLeases(
  now = Date.now(),
  cleanup?: CleanupExecutor,
) {
  return finalizeSelectedLeases(
    (leases) => planTerminalCleanup(
      Object.values(leases).filter((lease) => lease.expiresAt <= now),
    ),
    cleanup,
  )
}

export async function finalizeAllLeases(cleanup?: CleanupExecutor) {
  return finalizeSelectedLeases(
    (leases) => planTerminalCleanup(Object.values(leases)),
    cleanup,
  )
}

export function installLeaseInheritance(
  extensionInstanceID: () => Promise<string>,
  groupChildTab?: (
    tabId: number,
    context: BrowserExtensionCommandContext,
  ) => Promise<unknown>,
) {
  chrome.tabs.onCreated.addListener((tab: any) => {
    if (
      typeof tab?.id !== "number"
      || typeof tab?.openerTabId !== "number"
    ) {
      return
    }
    void (async () => {
      const opener = await getLease(tab.openerTabId)
      if (
        !opener
        || opener.state !== "active"
        || opener.expiresAt <= Date.now()
      ) {
        return
      }
      const currentExtensionInstanceID = await extensionInstanceID()
      if (currentExtensionInstanceID !== opener.extensionInstanceID) return
      const childContext = {
        sessionID: opener.sessionID,
        turnID: opener.turnID,
        extensionInstanceID: opener.extensionInstanceID,
      }
      await createLease({
        tabId: tab.id,
        source: "agent",
        context: childContext,
        extensionInstanceID: currentExtensionInstanceID,
        openerTabId: tab.openerTabId,
      })
      await groupChildTab?.(tab.id, childContext)
    })().catch(() => {
      // Child tabs remain leased when Chrome rejects grouping. Finalization
      // will still close or release them safely.
    })
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

export function getLegacyLeaseStorageKey() {
  return LEGACY_LEASE_STORAGE_KEY
}
