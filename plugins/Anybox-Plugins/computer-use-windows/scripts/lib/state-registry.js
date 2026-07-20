"use strict"

const crypto = require("node:crypto")
const { STATE_TTL_MS } = require("./build-info")
const { cuError } = require("./errors")

function makeRef(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
}

class StateRegistry {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? STATE_TTL_MS
    this.now = options.now ?? Date.now
    this.makeRef = options.makeRef ?? makeRef
    this.states = new Map()
  }

  create(input) {
    const createdAt = this.now()
    const stateRef = this.makeRef("state")
    const state = {
      ...input,
      stateRef,
      screenshotIds: new Set(input.screenshotIds ?? []),
      accessibilityElementIndexes: new Set(input.accessibilityElementIndexes ?? []),
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      consumed: false,
      invalidated: false,
    }
    this.states.set(stateRef, state)
    this.cleanup()
    return state
  }

  validate(input) {
    const stateRef = String(input?.stateRef || "")
    if (!stateRef) {
      throw cuError("CU_INVALID_ARGUMENT", "A stateRef from get_window_state is required.")
    }
    const state = this.states.get(stateRef)
    if (!state || state.invalidated || this.now() > state.expiresAt) {
      throw cuError("CU_STATE_EXPIRED", "The observed window state expired. Capture a fresh state before acting.")
    }
    if (state.consumed) {
      throw cuError("CU_STATE_CONSUMED", "The observed window state already performed an action. Capture a fresh state.")
    }
    if (state.windowRef !== input.windowRef) {
      throw cuError("CU_WINDOW_CHANGED", "The stateRef does not belong to the selected windowRef.")
    }
    if (input.identityDigest && state.identityDigest !== input.identityDigest) {
      throw cuError("CU_WINDOW_CHANGED", "The selected window identity changed after observation.")
    }
    if (
      input.windowRevision !== undefined
      && state.windowRevision !== input.windowRevision
    ) {
      throw cuError("CU_WINDOW_CHANGED", "The selected window changed after observation.")
    }
    if (input.screenshotId && !state.screenshotIds.has(input.screenshotId)) {
      throw cuError("CU_SCREENSHOT_MISMATCH", "The screenshotId does not belong to this stateRef.")
    }
    if (
      input.elementIndex !== undefined
      && !state.accessibilityElementIndexes.has(input.elementIndex)
    ) {
      throw cuError("CU_UIA_STALE", "The UI Automation element does not belong to this stateRef.")
    }
    if (
      input.currentInputEpoch !== undefined
      && state.inputEpoch !== input.currentInputEpoch
    ) {
      throw cuError("CU_USER_INPUT_DETECTED", "User input occurred after observation. Capture a fresh state.")
    }
    return state
  }

  consume(input) {
    const state = this.validate(input)
    state.consumed = true
    for (const sibling of this.states.values()) {
      if (sibling.stateRef !== state.stateRef && sibling.windowRef === state.windowRef) {
        sibling.invalidated = true
      }
    }
    return state
  }

  invalidateWindow(windowRef) {
    for (const state of this.states.values()) {
      if (state.windowRef === windowRef) state.invalidated = true
    }
  }

  invalidateAll() {
    for (const state of this.states.values()) state.invalidated = true
  }

  cleanup() {
    const cutoff = this.now() - this.ttlMs
    for (const [stateRef, state] of this.states.entries()) {
      if (state.expiresAt < cutoff) this.states.delete(stateRef)
    }
  }
}

module.exports = {
  StateRegistry,
  makeRef,
}
