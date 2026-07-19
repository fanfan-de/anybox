import { beforeEach, describe, expect, test } from "bun:test"
import {
  createLease,
  finalizeExpiredLeases,
  finalizeSessionLeases,
  finalizeTurnLeases,
  getLease,
  getLeaseStorageKey,
  installLeaseInheritance,
  listLeases,
  markDeliverable,
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
    await new Promise((resolve) => setTimeout(resolve, 5))
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

describe("Browser tab lease store", () => {
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

  test("persists ownership and rejects cross-session use", async () => {
    await createLease({
      tabId: 7,
      source: "user",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    await expect(requireLease(7, context("session-b", "turn-b")))
      .rejects.toMatchObject({
        code: "TAB_NOT_OWNED",
      })
    expect(await getLease(7)).toMatchObject({
      source: "user",
      sessionID: "session-a",
      state: "active",
    })

    await releaseLease(7, context())
    await expect(requireLease(7, context())).rejects.toMatchObject({
      code: "TAB_CLAIM_REQUIRED",
    })
  })

  test("finalizes Agent, user, and deliverable tabs safely", async () => {
    await createLease({
      tabId: 7,
      source: "agent",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    await createLease({
      tabId: 8,
      source: "user",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    await createLease({
      tabId: 9,
      source: "agent",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    await markDeliverable(9, context())
    await releaseLease(7, context())

    await expect(finalizeSessionLeases("session-a")).resolves.toEqual({
      closeTabIds: [7],
      releaseTabIds: [8],
      retainTabIds: [9],
    })
    expect(await getLease(7)).toBeUndefined()
    expect(await getLease(8)).toMatchObject({ state: "released" })
    expect(await getLease(9)).toMatchObject({
      state: "released",
      retained: true,
    })
    await expect(finalizeExpiredLeases(Date.now() + 60 * 60_000))
      .resolves.toEqual({
        closeTabIds: [],
        releaseTabIds: [],
        retainTabIds: [],
      })
  })

  test("limits turn finalization to leases from the completed turn", async () => {
    await createLease({
      tabId: 7,
      source: "agent",
      context: context("session-a", "turn-a"),
      extensionInstanceID: "extension-a",
    })
    await createLease({
      tabId: 8,
      source: "agent",
      context: context("session-a", "turn-b"),
      extensionInstanceID: "extension-a",
    })

    await expect(finalizeTurnLeases("session-a", "turn-a")).resolves.toEqual({
      closeTabIds: [7],
      releaseTabIds: [],
      retainTabIds: [],
    })
    expect(await getLease(7)).toBeUndefined()
    expect(await getLease(8)).toMatchObject({
      sessionID: "session-a",
      turnID: "turn-b",
      state: "active",
    })
  })

  test("does not let another session turn a released Agent tab into a user tab", async () => {
    await createLease({
      tabId: 7,
      source: "agent",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    await releaseLease(7, context())

    await expect(createLease({
      tabId: 7,
      source: "user",
      context: context("session-b", "turn-b"),
      extensionInstanceID: "extension-a",
    })).rejects.toMatchObject({
      code: "TAB_NOT_OWNED",
    })
    expect(await getLease(7)).toMatchObject({
      source: "agent",
      state: "released",
      sessionID: "session-a",
    })
  })

  test("expires leases with the same user-protection rules", async () => {
    await createLease({
      tabId: 7,
      source: "agent",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    await createLease({
      tabId: 8,
      source: "user",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    const key = getLeaseStorageKey()
    const leases = sessionStorage[key] as Record<string, Record<string, unknown>>
    leases["7"]!.expiresAt = 1
    leases["8"]!.expiresAt = 1

    await expect(finalizeExpiredLeases(2)).resolves.toEqual({
      closeTabIds: [7],
      releaseTabIds: [8],
      retainTabIds: [],
    })
  })

  test("inherits the opener lease without changing a user tab into an Agent tab", async () => {
    await createLease({
      tabId: 7,
      source: "user",
      context: context(),
      extensionInstanceID: "extension-a",
    })
    installLeaseInheritance(async () => "extension-a")
    createdListener?.({ id: 9, openerTabId: 7 })
    await waitFor(async () => Boolean(await getLease(9)))

    expect(await getLease(9)).toMatchObject({
      source: "user",
      sessionID: "session-a",
      openerTabId: 7,
    })
    removedListener?.(9)
    await waitFor(async () => !(await getLease(9)))
  })
})
