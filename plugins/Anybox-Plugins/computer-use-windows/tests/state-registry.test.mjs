import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { StateRegistry } = require("../scripts/lib/state-registry")

function input(overrides = {}) {
  return {
    windowRef: "win_1",
    identityDigest: "identity",
    windowRevision: 2,
    inputEpoch: 4,
    imageWidth: 800,
    imageHeight: 600,
    screenshotIds: ["shot_1"],
    accessibilityElementIndexes: [1, 2],
    ...overrides,
  }
}

function validation(state, overrides = {}) {
  return {
    stateRef: state.stateRef,
    windowRef: state.windowRef,
    identityDigest: state.identityDigest,
    windowRevision: state.windowRevision,
    currentInputEpoch: state.inputEpoch,
    ...overrides,
  }
}

test("a state can be consumed exactly once and invalidates sibling states", () => {
  let sequence = 0
  const registry = new StateRegistry({
    makeRef: () => `state_${++sequence}`,
  })
  const state = registry.create(input())
  const sibling = registry.create(input({ screenshotIds: ["shot_2"] }))

  registry.consume(validation(state, { screenshotId: "shot_1" }))
  assert.throws(
    () => registry.validate(validation(state)),
    (error) => error.code === "CU_STATE_CONSUMED",
  )
  assert.throws(
    () => registry.validate(validation(sibling)),
    (error) => error.code === "CU_STATE_EXPIRED",
  )
})

test("rejects expired, mismatched screenshot, stale element, and changed input epoch", () => {
  let now = 1000
  const registry = new StateRegistry({ now: () => now, ttlMs: 30 })
  const screenshotState = registry.create(input())
  assert.throws(
    () => registry.validate(validation(screenshotState, { screenshotId: "shot_other" })),
    (error) => error.code === "CU_SCREENSHOT_MISMATCH",
  )
  assert.throws(
    () => registry.validate(validation(screenshotState, { elementIndex: 9 })),
    (error) => error.code === "CU_UIA_STALE",
  )
  assert.throws(
    () => registry.validate(validation(screenshotState, { currentInputEpoch: 5 })),
    (error) => error.code === "CU_USER_INPUT_DETECTED",
  )
  now += 31
  assert.throws(
    () => registry.validate(validation(screenshotState)),
    (error) => error.code === "CU_STATE_EXPIRED",
  )
})

test("an action failure cannot revive a consumed state", () => {
  const registry = new StateRegistry()
  const state = registry.create(input())
  registry.consume(validation(state))
  assert.equal(state.consumed, true)
  assert.throws(
    () => registry.consume(validation(state)),
    (error) => error.code === "CU_STATE_CONSUMED",
  )
})
