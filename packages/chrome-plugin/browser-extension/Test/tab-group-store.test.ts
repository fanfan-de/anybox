import { beforeEach, describe, expect, test } from "bun:test"
import {
  CHROME_TAB_GROUP_COLORS,
  finishBrowserSession,
  getDefaultSessionName,
  getSessionGroupWindow,
  getTabGroupStorageKey,
  groupAgentTab,
  initializeManagedTabGroups,
  installTabGroupLifecycle,
  nameBrowserSession,
  ungroupManagedTabs,
} from "../src/background/tab-group-store.ts"

type FakeTab = {
  id: number
  windowId: number
  groupId: number
}

type FakeGroup = {
  id: number
  windowId: number
  title?: string
  color?: string
  collapsed?: boolean
}

let localStorage: Record<string, unknown>
let tabs: Map<number, FakeTab>
let groups: Map<number, FakeGroup>
let nextGroupId: number
let removedGroupListener: ((group: FakeGroup) => void) | undefined

function context(sessionID = "session-a") {
  return {
    sessionID,
    turnID: "turn-a",
    extensionInstanceID: "extension-a",
  }
}

beforeEach(() => {
  localStorage = {}
  tabs = new Map([
    [7, { id: 7, windowId: 2, groupId: -1 }],
    [8, { id: 8, windowId: 2, groupId: -1 }],
    [9, { id: 9, windowId: 3, groupId: -1 }],
  ])
  groups = new Map()
  nextGroupId = 10
  removedGroupListener = undefined

  const removeEmptyGroup = (groupId: number) => {
    if ([...tabs.values()].some((tab) => tab.groupId === groupId)) return
    const group = groups.get(groupId)
    groups.delete(groupId)
    if (group) removedGroupListener?.(group)
  }

  ;(globalThis as any).chrome = {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: structuredClone(localStorage[key]) }
        },
        async set(value: Record<string, unknown>) {
          Object.assign(localStorage, structuredClone(value))
        },
      },
    },
    tabs: {
      async get(tabId: number) {
        const tab = tabs.get(tabId)
        if (!tab) throw new Error("Tab not found")
        return structuredClone(tab)
      },
      async group(input: { groupId?: number; tabIds: number[] }) {
        const first = tabs.get(input.tabIds[0]!)
        if (!first) throw new Error("Tab not found")
        const groupId = input.groupId ?? nextGroupId++
        const existing = groups.get(groupId)
        if (input.groupId !== undefined && !existing) {
          throw new Error("Group not found")
        }
        const windowId = existing?.windowId ?? first.windowId
        groups.set(groupId, existing ?? { id: groupId, windowId })
        for (const tabId of input.tabIds) {
          const tab = tabs.get(tabId)
          if (!tab) throw new Error("Tab not found")
          tab.groupId = groupId
          tab.windowId = windowId
        }
        return groupId
      },
      async ungroup(tabId: number) {
        const tab = tabs.get(tabId)
        if (!tab) throw new Error("Tab not found")
        const oldGroupId = tab.groupId
        tab.groupId = -1
        if (oldGroupId >= 0) removeEmptyGroup(oldGroupId)
      },
      async query(query: { groupId?: number }) {
        return [...tabs.values()]
          .filter((tab) =>
            query.groupId === undefined || tab.groupId === query.groupId
          )
          .map((tab) => structuredClone(tab))
      },
    },
    tabGroups: {
      async get(groupId: number) {
        const group = groups.get(groupId)
        if (!group) throw new Error("Group not found")
        return structuredClone(group)
      },
      async update(groupId: number, update: Partial<FakeGroup>) {
        const group = groups.get(groupId)
        if (!group) throw new Error("Group not found")
        Object.assign(group, update)
        return structuredClone(group)
      },
      onRemoved: {
        addListener(listener: (group: FakeGroup) => void) {
          removedGroupListener = listener
        },
      },
    },
  }
})

describe("Anybox managed Chrome tab groups", () => {
  test("names the first group, chooses a legal random color, and reuses it", async () => {
    await expect(nameBrowserSession("  ✍️ Publish Zhihu update  ", context()))
      .resolves.toEqual({ name: "✍️ Publish Zhihu update" })
    const first = await groupAgentTab(7, context())
    const second = await groupAgentTab(8, context())

    expect(second.groupId).toBe(first.groupId)
    expect(tabs.get(7)?.groupId).toBe(first.groupId)
    expect(tabs.get(8)?.groupId).toBe(first.groupId)
    expect(groups.get(first.groupId)).toMatchObject({
      title: "✍️ Publish Zhihu update",
      collapsed: false,
    })
    expect(CHROME_TAB_GROUP_COLORS).toContain(
      groups.get(first.groupId)?.color as never,
    )
    expect(await getSessionGroupWindow(context())).toBe(2)
  })

  test("uses Anybox by default and renames an existing group", async () => {
    const created = await groupAgentTab(7, context())
    expect(groups.get(created.groupId)?.title).toBe(getDefaultSessionName())

    await nameBrowserSession("Research sources", context())
    expect(groups.get(created.groupId)).toMatchObject({
      title: "Research sources",
      collapsed: false,
    })
  })

  test("isolates parallel sessions into different groups and windows", async () => {
    const first = await groupAgentTab(7, context("session-a"))
    const second = await groupAgentTab(9, context("session-b"))

    expect(first.groupId).not.toBe(second.groupId)
    expect(first.windowId).toBe(2)
    expect(second.windowId).toBe(3)
    const stored = localStorage[getTabGroupStorageKey()] as
      Record<string, unknown>
    expect(Object.keys(stored).sort()).toEqual(["session-a", "session-b"])
  })

  test("does not regroup a manually ungrouped tab and creates a fresh group", async () => {
    const first = await groupAgentTab(7, context())
    await (globalThis as any).chrome.tabs.ungroup(7)
    const second = await groupAgentTab(8, context())

    expect(tabs.get(7)?.groupId).toBe(-1)
    expect(second.groupId).not.toBe(first.groupId)
    expect(tabs.get(8)?.groupId).toBe(second.groupId)
  })

  test("drops stale group IDs after a Chrome restart", async () => {
    localStorage[getTabGroupStorageKey()] = {
      "stale-session": {
        sessionID: "stale-session",
        extensionInstanceID: "extension-a",
        name: "Stale",
        groupId: 777,
        windowId: 4,
        color: "blue",
        updatedAt: Date.now(),
      },
    }

    await initializeManagedTabGroups()
    expect(localStorage[getTabGroupStorageKey()]).toEqual({})
  })

  test("ungroups only tabs that are still inside the managed group", async () => {
    const managed = await groupAgentTab(7, context())
    await groupAgentTab(9, context())
    tabs.get(8)!.groupId = 99
    groups.set(99, { id: 99, windowId: 2, title: "User group" })

    await expect(ungroupManagedTabs([7, 8], context())).resolves.toEqual({
      ungroupedTabIds: [7],
      failedTabIds: [],
    })
    expect(tabs.get(7)?.groupId).toBe(-1)
    expect(tabs.get(8)?.groupId).toBe(99)
    expect(tabs.get(9)?.groupId).toBe(managed.groupId)

    await finishBrowserSession(context())
    expect(
      (localStorage[getTabGroupStorageKey()] as Record<string, unknown>)
        ["session-a"],
    ).toBeDefined()
  })

  test("cleans persisted ownership when Chrome removes the group", async () => {
    installTabGroupLifecycle()
    const created = await groupAgentTab(7, context())
    await (globalThis as any).chrome.tabs.ungroup(7)
    await Bun.sleep(0)

    const record = (
      localStorage[getTabGroupStorageKey()] as Record<
        string,
        Record<string, unknown>
      >
    )["session-a"]
    expect(record?.groupId).toBeUndefined()
    expect(groups.has(created.groupId)).toBe(false)
  })
})
