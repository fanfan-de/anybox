import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { AppRegistry } = require("../scripts/lib/app-registry")

test("application refs resolve only current catalog entries and hide helper launch tokens", () => {
  let now = 100
  const registry = new AppRegistry({
    now: () => now,
    ttlMs: 50,
    makeRef: () => "app_test",
  })
  const record = registry.upsert({
    catalogRef: "catalog_secret",
    appId: "win32:fixture.exe:0123456789abcdef",
    displayName: "Fixture",
    kind: "win32",
    processName: "fixture.exe",
    isRunning: true,
    canLaunch: true,
    blocked: false,
    windows: [],
  })
  assert.equal(registry.resolve({ appRef: "app_test" }), record)
  assert.equal(registry.resolve({ appId: record.appId }), record)
  const publicApp = registry.publicApp(record, [])
  assert.equal(publicApp.appRef, "app_test")
  assert.equal(JSON.stringify(publicApp).includes("catalog_secret"), false)

  assert.throws(
    () => registry.resolve({ appRef: "app_test", appId: record.appId }),
    (error) => error.code === "CU_INVALID_ARGUMENT",
  )
  assert.throws(
    () => registry.resolve({ appId: "win32:forged.exe:0000000000000000" }),
    (error) => error.code === "CU_APP_APPROVAL_REQUIRED",
  )
  now = 151
  assert.throws(
    () => registry.resolve({ appRef: "app_test" }),
    (error) => error.code === "CU_APP_APPROVAL_REQUIRED",
  )
})
