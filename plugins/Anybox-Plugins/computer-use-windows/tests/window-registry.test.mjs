import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { WindowRegistry } = require("../scripts/lib/window-registry")

function rawWindow(overrides = {}) {
  const { identity: identityOverrides = {}, ...windowOverrides } = overrides
  return {
    identity: {
      hwnd: "100",
      pid: 42,
      processStartTime: "638887000000000000",
      rootOwnerHwnd: "100",
      executableIdentity: "c:\\windows\\notepad.exe",
      sessionId: 1,
      ...identityOverrides,
    },
    title: "Untitled - Notepad",
    processName: "notepad.exe",
    appId: "process:notepad.exe",
    bounds: { x: 10, y: 20, width: 800, height: 600 },
    clientBounds: { x: 0, y: 32, width: 800, height: 568 },
    dpiScale: 1,
    minimized: false,
    ...windowOverrides,
  }
}

test("keeps a stable opaque ref while identity is stable and increments revision on change", () => {
  let sequence = 0
  const registry = new WindowRegistry({ makeRef: () => `win_${++sequence}` })
  const first = registry.upsert(rawWindow())
  const same = registry.upsert(rawWindow())
  const changed = registry.upsert(rawWindow({ title: "Saved - Notepad" }))

  assert.equal(same.windowRef, first.windowRef)
  assert.equal(same.revision, 0)
  assert.equal(changed.windowRef, first.windowRef)
  assert.equal(changed.revision, 1)
})

test("does not reuse a windowRef when Windows reuses an HWND for another process instance", () => {
  let sequence = 0
  const registry = new WindowRegistry({ makeRef: () => `win_${++sequence}` })
  const first = registry.upsert(rawWindow())
  const replacement = registry.upsert(rawWindow({
    identity: {
      processStartTime: "638887999999999999",
    },
  }))

  assert.notEqual(replacement.windowRef, first.windowRef)
  assert.throws(
    () => registry.get(first.windowRef),
    (error) => error.code === "CU_WINDOW_CHANGED",
  )
})

test("public window output does not expose native identity or executable path", () => {
  const registry = new WindowRegistry()
  const record = registry.upsert(rawWindow())
  const value = registry.publicWindow(record)
  assert.equal(value.windowRef, record.windowRef)
  assert.equal("identity" in value, false)
  assert.equal("pid" in value, false)
  assert.equal("executableIdentity" in value, false)
})
