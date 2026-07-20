import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  assertWindowAllowed,
  classifyWindow,
  validateSafety,
} = require("../scripts/lib/policy")

test("blocks terminal, Anybox, credential, and security targets", () => {
  for (const processName of ["cmd.exe", "powershell.exe", "anybox.exe", "1password.exe"]) {
    assert.equal(classifyWindow({ processName, title: "Window" }).blocked, true)
    assert.throws(
      () => assertWindowAllowed({ processName, title: "Window" }),
      (error) => error.code === "CU_APP_BLOCKED",
    )
  }
  assert.equal(classifyWindow({ processName: "browser.exe", title: "Windows Security" }).blocked, true)
})

test("safety is an intent hint and hard-reject categories cannot be automated", () => {
  assert.deepEqual(validateSafety({ safety: "delete" }), {
    safety: "delete",
    elevatedReview: true,
  })
  assert.throws(
    () => validateSafety({ safety: "finance" }),
    (error) => error.code === "CU_APP_BLOCKED",
  )
  assert.throws(
    () => validateSafety({ safety: "made_up" }),
    (error) => error.code === "CU_INVALID_ARGUMENT",
  )
})
