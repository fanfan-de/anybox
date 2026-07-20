import type {
  BrowserExtensionCommandContext,
} from "@anybox/chrome-shared/browser-extension"

const TAB_GROUP_STORAGE_KEY = "anybox.browser.tabGroups.v4"
const DEFAULT_SESSION_NAME = "Anybox"

export const CHROME_TAB_GROUP_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
] as const

export type ChromeTabGroupColor = (typeof CHROME_TAB_GROUP_COLORS)[number]

type ManagedSessionGroup = {
  sessionID: string
  extensionInstanceID: string
  name: string
  groupId?: number
  windowId?: number
  color?: ChromeTabGroupColor
  updatedAt: number
}

type TabGroupStore = Record<string, ManagedSessionGroup>

let groupMutationTail: Promise<void> = Promise.resolve()

function requireGroupContext(
  context: BrowserExtensionCommandContext | undefined,
): asserts context is BrowserExtensionCommandContext & {
  sessionID: string
  extensionInstanceID: string
} {
  if (!context?.sessionID || !context.extensionInstanceID) {
    throw Object.assign(
      new Error(
        "Browser Contract v4 requires sessionID and extensionInstanceID for tab groups.",
      ),
      { code: "SESSION_REQUIRED", retryable: false },
    )
  }
}

function isManagedSessionGroup(
  value: unknown,
): value is ManagedSessionGroup {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Partial<ManagedSessionGroup>
  return typeof record.sessionID === "string"
    && Boolean(record.sessionID)
    && typeof record.extensionInstanceID === "string"
    && Boolean(record.extensionInstanceID)
    && typeof record.name === "string"
    && Boolean(record.name.trim())
    && (
      record.groupId === undefined
      || (Number.isInteger(record.groupId) && Number(record.groupId) >= 0)
    )
    && (
      record.windowId === undefined
      || Number.isInteger(record.windowId)
    )
    && (
      record.color === undefined
      || CHROME_TAB_GROUP_COLORS.includes(record.color)
    )
    && typeof record.updatedAt === "number"
}

async function readStoreRaw(): Promise<TabGroupStore> {
  const stored = await chrome.storage.local.get(TAB_GROUP_STORAGE_KEY)
  const raw = stored[TAB_GROUP_STORAGE_KEY]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw)
      .filter(
        (entry): entry is [string, ManagedSessionGroup] =>
          isManagedSessionGroup(entry[1]),
      ),
  )
}

async function writeStore(store: TabGroupStore) {
  await chrome.storage.local.set({ [TAB_GROUP_STORAGE_KEY]: store })
}

async function mutateStore<T>(
  mutate: (store: TabGroupStore) => T | Promise<T>,
): Promise<T> {
  const operation = groupMutationTail.then(async () => {
    const store = await readStoreRaw()
    const result = await mutate(store)
    await writeStore(store)
    return result
  })
  groupMutationTail = operation.then(
    () => undefined,
    () => undefined,
  )
  return operation
}

function sessionRecord(
  store: TabGroupStore,
  context: BrowserExtensionCommandContext & {
    sessionID: string
    extensionInstanceID: string
  },
) {
  const existing = store[context.sessionID]
  if (
    existing
    && existing.extensionInstanceID !== context.extensionInstanceID
  ) {
    throw Object.assign(
      new Error(
        `Browser session '${context.sessionID}' belongs to another extension instance.`,
      ),
      { code: "TAB_NOT_OWNED", retryable: false },
    )
  }
  const record = existing ?? {
    sessionID: context.sessionID,
    extensionInstanceID: context.extensionInstanceID,
    name: DEFAULT_SESSION_NAME,
    updatedAt: Date.now(),
  }
  store[context.sessionID] = record
  return record
}

async function validateGroup(record: ManagedSessionGroup) {
  if (record.groupId === undefined) return false
  try {
    const group = await chrome.tabGroups.get(record.groupId)
    if (
      !group
      || typeof group.id !== "number"
      || typeof group.windowId !== "number"
    ) {
      throw new Error("Chrome returned an invalid tab group.")
    }
    record.windowId = group.windowId
    return true
  } catch {
    delete record.groupId
    delete record.windowId
    delete record.color
    record.updatedAt = Date.now()
    return false
  }
}

function randomGroupColor(): ChromeTabGroupColor {
  return CHROME_TAB_GROUP_COLORS[
    Math.floor(Math.random() * CHROME_TAB_GROUP_COLORS.length)
  ] ?? "grey"
}

export async function nameBrowserSession(
  name: string,
  context?: BrowserExtensionCommandContext,
) {
  requireGroupContext(context)
  const normalized = name.trim()
  if (!normalized) {
    throw Object.assign(
      new Error("browser.nameSession requires a non-empty name."),
      { code: "INVALID_COMMAND_PARAMS", retryable: false },
    )
  }
  return mutateStore(async (store) => {
    const record = sessionRecord(store, context)
    record.name = normalized
    record.updatedAt = Date.now()
    if (await validateGroup(record)) {
      try {
        await chrome.tabGroups.update(record.groupId, {
          title: normalized,
          collapsed: false,
        })
      } catch {
        delete record.groupId
        delete record.windowId
        delete record.color
      }
    }
    return { name: normalized }
  })
}

export async function getSessionGroupWindow(
  context?: BrowserExtensionCommandContext,
) {
  requireGroupContext(context)
  return mutateStore(async (store) => {
    const record = sessionRecord(store, context)
    return await validateGroup(record) ? record.windowId : undefined
  })
}

export async function groupAgentTab(
  tabId: number,
  context?: BrowserExtensionCommandContext,
) {
  requireGroupContext(context)
  return mutateStore(async (store) => {
    const record = sessionRecord(store, context)
    if (await validateGroup(record)) {
      await chrome.tabs.group({
        groupId: record.groupId,
        tabIds: [tabId],
      })
      record.updatedAt = Date.now()
      return {
        groupId: record.groupId!,
        windowId: record.windowId!,
        name: record.name,
        color: record.color,
      }
    }

    const color = randomGroupColor()
    const groupId = await chrome.tabs.group({ tabIds: [tabId] })
    try {
      const group = await chrome.tabGroups.update(groupId, {
        title: record.name,
        color,
        collapsed: false,
      })
      const tab = await chrome.tabs.get(tabId)
      record.groupId = groupId
      record.windowId = typeof group?.windowId === "number"
        ? group.windowId
        : tab.windowId
      record.color = color
      record.updatedAt = Date.now()
      return {
        groupId,
        windowId: record.windowId!,
        name: record.name,
        color,
      }
    } catch (error) {
      await chrome.tabs.ungroup(tabId).catch(() => undefined)
      throw error
    }
  })
}

export async function ungroupManagedTabs(
  tabIds: readonly number[],
  context?: BrowserExtensionCommandContext,
) {
  requireGroupContext(context)
  if (tabIds.length === 0) return { ungroupedTabIds: [], failedTabIds: [] }
  return mutateStore(async (store) => {
    const record = sessionRecord(store, context)
    if (!(await validateGroup(record))) {
      return { ungroupedTabIds: [], failedTabIds: [] }
    }
    const matching: number[] = []
    for (const tabId of tabIds) {
      const tab = await chrome.tabs.get(tabId).catch(() => undefined)
      if (tab?.groupId === record.groupId) matching.push(tabId)
    }
    const ungroupedTabIds: number[] = []
    const failedTabIds: number[] = []
    for (const tabId of matching) {
      try {
        await chrome.tabs.ungroup(tabId)
        ungroupedTabIds.push(tabId)
      } catch {
        failedTabIds.push(tabId)
      }
    }
    record.updatedAt = Date.now()
    return { ungroupedTabIds, failedTabIds }
  })
}

export async function ungroupAnyManagedTabs(
  tabIds: readonly number[],
) {
  if (tabIds.length === 0) return { ungroupedTabIds: [], failedTabIds: [] }
  return mutateStore(async (store) => {
    const managedGroupIds = new Set<number>()
    for (const record of Object.values(store)) {
      if (await validateGroup(record)) managedGroupIds.add(record.groupId!)
    }
    const ungroupedTabIds: number[] = []
    const failedTabIds: number[] = []
    for (const tabId of tabIds) {
      const tab = await chrome.tabs.get(tabId).catch(() => undefined)
      if (
        typeof tab?.groupId !== "number"
        || !managedGroupIds.has(tab.groupId)
      ) {
        continue
      }
      try {
        await chrome.tabs.ungroup(tabId)
        ungroupedTabIds.push(tabId)
      } catch {
        failedTabIds.push(tabId)
      }
    }
    return { ungroupedTabIds, failedTabIds }
  })
}

export async function finishBrowserSession(
  context?: BrowserExtensionCommandContext,
) {
  requireGroupContext(context)
  return mutateStore(async (store) => {
    const record = store[context.sessionID]
    if (!record) return
    if (record.extensionInstanceID !== context.extensionInstanceID) return
    if (!(await validateGroup(record))) {
      delete store[context.sessionID]
      return
    }
    const tabs = await chrome.tabs.query({ groupId: record.groupId })
    if (tabs.length === 0) delete store[context.sessionID]
  })
}

export async function finishAllBrowserSessions() {
  return mutateStore(async (store) => {
    for (const [sessionID, record] of Object.entries(store)) {
      if (!(await validateGroup(record))) {
        delete store[sessionID]
        continue
      }
      const tabs = await chrome.tabs.query({ groupId: record.groupId })
      if (tabs.length === 0) delete store[sessionID]
    }
  })
}

export async function initializeManagedTabGroups() {
  return mutateStore(async (store) => {
    for (const [sessionID, record] of Object.entries(store)) {
      if (!(await validateGroup(record))) {
        delete store[sessionID]
      }
    }
  })
}

export function installTabGroupLifecycle() {
  chrome.tabGroups.onRemoved.addListener((group: any) => {
    if (typeof group?.id !== "number") return
    void mutateStore((store) => {
      for (const record of Object.values(store)) {
        if (record.groupId !== group.id) continue
        delete record.groupId
        delete record.windowId
        delete record.color
        record.updatedAt = Date.now()
      }
    })
  })
}

export function getTabGroupStorageKey() {
  return TAB_GROUP_STORAGE_KEY
}

export function getDefaultSessionName() {
  return DEFAULT_SESSION_NAME
}
