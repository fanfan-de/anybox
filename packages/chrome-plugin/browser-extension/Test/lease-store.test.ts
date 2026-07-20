import { beforeEach, describe, expect, test } from "bun:test"
import {
  createLease,
  finalizeAllLeases,
  finalizeExpiredLeases,
  finalizeTurnLeases,
  getLease,
  getLeaseStorageKey,
  getLegacyLeaseStorageKey,
  installLeaseInheritance,
  listLeases,
  markDeliverable,
  markHandoff,
  releaseLease,
  requireLease,
} from "../src/background/lease-store.ts"

let sessionStorage: Record<string, unknown>
let createdListener: ((tab: unknown) => void) | undefined
let removedListener: ((tabId: number) => void) | undefined

function context(sessionID = "session-a", turnID = "turn-a") {
  return {
    sessionID,
    turnID,
    extensionInstanceID: "extension-a",
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 1_000
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for lease state.")
    await Bun.sleep(5)
  }
}

beforeEach(() => {
  sessionStorage = {}
  createdListener = undefined
  removedListener = undefined
  ;(globalThis as any).chrome = {
    storage: {
      session: {
        async get(key: string) {
          return { [key]: structuredClone(sessionStorage[key]) }
        },
        async set(value: Record<string, unknown>) {
          Object.assign(sessionStorage, structuredClone(value))
        },
        async remove(key: string) {
          delete sessionStorage[key]
        },
      },
    },
    tabs: {
      onCreated: {
        addListener(listener: (tab: unknown) => void) {
          createdListener = listener
        },
      },
      onRemoved: {
        addListener(listener: (tabId: number) => void) {
          removedListener = listener
        },
      },
    },
  }
})

describe("Browser Contract v4 tab lease store", () => {
  test("serializes concurrent storage.session updates", async () => {
    await Promise.all([
      createLease({
        tabId: 7,
        source: "agent",
        context: context(),
        extensionInstanceID: "extension-a",
      }),
      createLease({
        tabId: 8,
        source: "agent",
        context: context(),
        extensionInstanceID: "extension-a",
      }),
    ])

    expect((await listLeases()).map((lease) => lease.tabId).sort())
      .toEqual([7, 8])
  })

  test("keeps marks turn-scoped and lets the latest mark win", async () => {
    await createLease({
      tabId: 7,
      source: "agent",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    await markDeliverable(7, context())
    expect(await getLease(7)).toMatchObject({ mark: "deliverable" })
    await markHandoff(7, context())
    expect(await getLease(7)).toMatchObject({ mark: "handoff" })

    await requireLease(7, context("session-a", "turn-b"))
    expect(await getLease(7)).toMatchObject({
      turnID: "turn-b",
      state: "active",
    })
    expect((await getLease(7))?.mark).toBeUndefined()
  })

  test("atomically classifies temporary, user, deliverable, and handoff tabs", async () => {
    for (const [tabId, source] of [
      [7, "agent"],
      [8, "user"],
      [9, "agent"],
      [10, "agent"],
    ] as const) {
      await createLease({
        tabId,
        source,
        context: context(),
        extensionInstanceID: "extension-a",
      })
    }
    await markHandoff(9, context())
    await markDeliverable(10, context())

    let leasesDuringCleanup = 0
    const result = await finalizeTurnLeases(context(), [
      { tabId: 9, status: "deliverable" },
      { tabId: 10, status: "handoff" },
    ], async () => {
      leasesDuringCleanup = Object.keys(
        sessionStorage[getLeaseStorageKey()] as Record<string, unknown>,
      ).length
    })

    expect(leasesDuringCleanup).toBe(4)
    expect(result).toEqual({
      closeTabIds: [7],
      releaseTabIds: [8],
      deliverableTabIds: [9],
      handoffTabIds: [10],
      ungroupTabIds: [9],
    })
    expect(await getLease(7)).toBeUndefined()
    expect(await getLease(8)).toBeUndefined()
    expect(await getLease(9)).toBeUndefined()
    expect(await getLease(10)).toMatchObject({
      state: "handoff",
      turnID: "turn-a",
    })
    expect((await getLease(10))?.mark).toBeUndefined()
  })

  test("rejects the entire keep list before cleanup or mutation", async () => {
    await createLease({
      tabId: 7,
      source: "agent",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    await createLease({
      tabId: 8,
      source: "agent",
      context: context("session-a", "turn-b"),
      extensionInstanceID: "extension-a",
    })
    let cleanupCalls = 0
    const cleanup = async () => {
      cleanupCalls += 1
    }

    await expect(finalizeTurnLeases(context(), [
      { tabId: 7, status: "deliverable" },
      { tabId: 7, status: "handoff" },
    ], cleanup)).rejects.toMatchObject({ code: "INVALID_COMMAND_PARAMS" })
    await expect(finalizeTurnLeases(context(), [
      { tabId: 99, status: "deliverable" },
    ], cleanup)).rejects.toMatchObject({ code: "TAB_NOT_OWNED" })
    await expect(finalizeTurnLeases(context(), [
      { tabId: 8, status: "handoff" },
    ], cleanup)).rejects.toMatchObject({ code: "TURN_ENDED" })

    expect(cleanupCalls).toBe(0)
    expect((await listLeases()).map((lease) => lease.tabId).sort())
      .toEqual([7, 8])
  })

  test("resumes a handoff only in the next turn and finalization is idempotent", async () => {
    await createLease({
      tabId: 7,
      source: "agent",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    await finalizeTurnLeases(context(), [
      { tabId: 7, status: "handoff" },
    ])
    await expect(requireLease(7, context())).rejects.toMatchObject({
      code: "TURN_ENDED",
    })
    await expect(finalizeTurnLeases(context())).resolves.toEqual({
      closeTabIds: [],
      releaseTabIds: [],
      deliverableTabIds: [],
      handoffTabIds: [],
      ungroupTabIds: [],
    })

    await expect(requireLease(7, context("session-a", "turn-b")))
      .resolves.toMatchObject({
        state: "active",
        turnID: "turn-b",
      })
    await expect(finalizeTurnLeases(context("session-a", "turn-b")))
      .resolves.toMatchObject({ closeTabIds: [7] })
    expect(await getLease(7)).toBeUndefined()
  })

  test("terminal cleanup preserves and releases handoff pages", async () => {
    await createLease({
      tabId: 8,
      source: "agent",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    await createLease({
      tabId: 9,
      source: "user",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    await finalizeTurnLeases(context(), [
      { tabId: 8, status: "handoff" },
    ])
    await createLease({
      tabId: 7,
      source: "agent",
      context: context("session-a", "turn-b"),
      extensionInstanceID: "extension-a",
    })
    await createLease({
      tabId: 9,
      source: "user",
      context: context("session-a", "turn-b"),
      extensionInstanceID: "extension-a",
    })
    const leases = sessionStorage[getLeaseStorageKey()] as
      Record<string, Record<string, unknown>>
    leases["7"]!.expiresAt = 1
    leases["8"]!.expiresAt = 1
    leases["9"]!.expiresAt = 1

    await expect(finalizeExpiredLeases(2)).resolves.toEqual({
      closeTabIds: [7],
      releaseTabIds: [8, 9],
      deliverableTabIds: [],
      handoffTabIds: [],
      ungroupTabIds: [8],
    })
    expect(await listLeases()).toEqual([])
  })

  test("clears legacy v3 leases without closing their existing pages", async () => {
    sessionStorage[getLegacyLeaseStorageKey()] = {
      "7": {
        tabId: 7,
        source: "agent",
        sessionID: "legacy",
        turnID: "legacy-turn",
        state: "active",
      },
    }
    let cleanupPlan: unknown
    await finalizeAllLeases((plan) => {
      cleanupPlan = plan
    })

    expect(sessionStorage[getLegacyLeaseStorageKey()]).toBeUndefined()
    expect(await listLeases()).toEqual([])
    expect(cleanupPlan).toMatchObject({
      closeTabIds: [],
      releaseTabIds: [],
    })
  })

  test("treats opener-created tabs as Agent tabs even for a claimed user opener", async () => {
    await createLease({
      tabId: 7,
      source: "user",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    const grouped: number[] = []
    installLeaseInheritance(
      async () => "extension-a",
      async (tabId) => {
        grouped.push(tabId)
        throw new Error("Chrome grouping failed")
      },
    )
    createdListener?.({ id: 9, openerTabId: 7 })
    await waitFor(async () => Boolean(await getLease(9)))

    expect(await getLease(9)).toMatchObject({
      source: "agent",
      sessionID: "session-a",
      openerTabId: 7,
    })
    expect(grouped).toEqual([9])
    removedListener?.(9)
    await waitFor(async () => !(await getLease(9)))
  })

  test("rejects cross-session use and deletes an explicitly released lease", async () => {
    await createLease({
      tabId: 7,
      source: "user",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    await expect(requireLease(7, context("session-b", "turn-b")))
      .rejects.toMatchObject({ code: "TAB_NOT_OWNED" })
    await releaseLease(7, context())
    expect(await getLease(7)).toBeUndefined()
  })
})
