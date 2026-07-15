import { describe, expect, it, vi } from "vitest"
import {
  createThreadPresentationStore,
  resolveProcessDisclosureExpanded,
  selectProcessDisclosurePreference,
  selectThreadPresentationEntry,
} from "./thread-presentation-store"

describe("thread presentation store", () => {
  it("defaults to auto and isolates overrides by scope and group", () => {
    const store = createThreadPresentationStore()

    expect(store.getState().getProcessDisclosurePreference("main", "turn-1")).toBe("auto")

    store.getState().setProcessDisclosurePreference("main", "turn-1", "expanded")
    store.getState().setProcessDisclosurePreference("side-chat", "turn-1", "collapsed")
    store.getState().setProcessDisclosurePreference("main", "turn-2", "collapsed")

    expect(store.getState().getProcessDisclosurePreference("main", "turn-1")).toBe("expanded")
    expect(store.getState().getProcessDisclosurePreference("side-chat", "turn-1")).toBe("collapsed")
    expect(store.getState().getProcessDisclosurePreference("main", "turn-2")).toBe("collapsed")
  })

  it("uses collision-safe compound keys", () => {
    const store = createThreadPresentationStore()

    store.getState().setProcessDisclosurePreference("a", "bc", "expanded")
    store.getState().setProcessDisclosurePreference("ab", "c", "collapsed")

    expect(store.getState().getProcessDisclosurePreference("a", "bc")).toBe("expanded")
    expect(store.getState().getProcessDisclosurePreference("ab", "c")).toBe("collapsed")
  })

  it("toggles from the effective auto state and then between explicit overrides", () => {
    const store = createThreadPresentationStore()

    expect(store.getState().toggleProcessDisclosure("main", "running", true)).toBe("collapsed")
    expect(store.getState().toggleProcessDisclosure("main", "running", true)).toBe("expanded")

    expect(store.getState().toggleProcessDisclosure("main", "completed", false)).toBe("expanded")
    expect(store.getState().toggleProcessDisclosure("main", "completed", false)).toBe("collapsed")
  })

  it("removes an explicit override when restored to auto", () => {
    const store = createThreadPresentationStore()
    store.getState().setProcessDisclosurePreference("main", "turn-1", "expanded")

    store.getState().setProcessDisclosurePreference("main", "turn-1", "auto")

    expect(store.getState().getProcessDisclosurePreference("main", "turn-1")).toBe("auto")
    expect(store.getState().entries.size).toBe(0)
  })

  it("clears one scope without disturbing another", () => {
    const store = createThreadPresentationStore()
    store.getState().setProcessDisclosurePreference("main", "turn-1", "expanded")
    store.getState().setProcessDisclosurePreference("main", "turn-2", "collapsed")
    store.getState().setProcessDisclosurePreference("side-chat", "turn-1", "expanded")

    store.getState().clearScope("main")

    expect(store.getState().getProcessDisclosurePreference("main", "turn-1")).toBe("auto")
    expect(store.getState().getProcessDisclosurePreference("main", "turn-2")).toBe("auto")
    expect(store.getState().getProcessDisclosurePreference("side-chat", "turn-1")).toBe("expanded")
  })

  it("keeps selector results stable across unrelated updates", () => {
    const store = createThreadPresentationStore()
    store.getState().setProcessDisclosurePreference("main", "turn-1", "expanded")
    const entry = selectThreadPresentationEntry(store.getState(), "main", "turn-1")

    store.getState().setProcessDisclosurePreference("side-chat", "turn-2", "collapsed")

    expect(selectThreadPresentationEntry(store.getState(), "main", "turn-1")).toBe(entry)
    expect(selectProcessDisclosurePreference(store.getState(), "main", "turn-1")).toBe("expanded")
  })

  it("does not notify subscribers for no-op updates", () => {
    const store = createThreadPresentationStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().setProcessDisclosurePreference("main", "turn-1", "auto")
    store.getState().setProcessDisclosurePreference("main", "turn-1", "expanded")
    store.getState().setProcessDisclosurePreference("main", "turn-1", "expanded")
    store.getState().clearScope("missing")
    store.getState().clearAll()
    store.getState().clearAll()

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("retains overrides for the lifetime of one store only", () => {
    const mountedStore = createThreadPresentationStore()
    mountedStore.getState().setProcessDisclosurePreference("main", "turn-1", "expanded")

    expect(mountedStore.getState().getProcessDisclosurePreference("main", "turn-1")).toBe("expanded")
    expect(createThreadPresentationStore().getState().getProcessDisclosurePreference("main", "turn-1")).toBe("auto")
  })

  it("resolves auto and explicit expansion consistently", () => {
    expect(resolveProcessDisclosureExpanded("auto", true)).toBe(true)
    expect(resolveProcessDisclosureExpanded("auto", false)).toBe(false)
    expect(resolveProcessDisclosureExpanded("expanded", false)).toBe(true)
    expect(resolveProcessDisclosureExpanded("collapsed", true)).toBe(false)
  })
})
