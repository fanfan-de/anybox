"use strict"

const ERROR_DEFINITIONS = Object.freeze({
  CU_UNSUPPORTED_PLATFORM: { retryable: false, requiresFreshState: false },
  CU_HELPER_MISSING: { retryable: false, requiresFreshState: false },
  CU_PROTOCOL_MISMATCH: { retryable: false, requiresFreshState: false },
  CU_APP_BLOCKED: { retryable: false, requiresFreshState: false },
  CU_APP_APPROVAL_REQUIRED: { retryable: true, requiresFreshState: false },
  CU_WINDOW_NOT_FOUND: { retryable: true, requiresFreshState: false },
  CU_WINDOW_CHANGED: { retryable: true, requiresFreshState: true },
  CU_STATE_EXPIRED: { retryable: true, requiresFreshState: true },
  CU_STATE_CONSUMED: { retryable: true, requiresFreshState: true },
  CU_SCREENSHOT_MISMATCH: { retryable: true, requiresFreshState: true },
  CU_UIA_STALE: { retryable: true, requiresFreshState: true },
  CU_POINT_OUTSIDE_TARGET: { retryable: true, requiresFreshState: true },
  CU_USER_INPUT_DETECTED: { retryable: true, requiresFreshState: true },
  CU_WINDOW_NOT_FOREGROUND: { retryable: true, requiresFreshState: true },
  CU_HIGHER_INTEGRITY_TARGET: { retryable: false, requiresFreshState: false },
  CU_DESKTOP_LOCKED: { retryable: true, requiresFreshState: true },
  CU_OVERLAY_UNAVAILABLE: { retryable: true, requiresFreshState: true },
  CU_INTERRUPTED: { retryable: false, requiresFreshState: false },
  CU_BUSY: { retryable: true, requiresFreshState: false },
  CU_TIMEOUT: { retryable: true, requiresFreshState: true },
  CU_INVALID_ARGUMENT: { retryable: false, requiresFreshState: false },
  CU_INTERNAL_ERROR: { retryable: true, requiresFreshState: false },
})

class ComputerUseError extends Error {
  constructor(code, message, options = {}) {
    const definition = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.CU_INTERNAL_ERROR
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = "ComputerUseError"
    this.code = ERROR_DEFINITIONS[code] ? code : "CU_INTERNAL_ERROR"
    this.retryable = options.retryable ?? definition.retryable
    this.requiresFreshState = options.requiresFreshState ?? definition.requiresFreshState
    this.effectMayHaveOccurred = options.effectMayHaveOccurred ?? false
  }
}

function cuError(code, message, options) {
  return new ComputerUseError(code, message, options)
}

function asComputerUseError(error, fallbackCode = "CU_INTERNAL_ERROR") {
  if (error instanceof ComputerUseError) return error
  const message = error instanceof Error ? error.message : String(error)
  return cuError(fallbackCode, message, { cause: error })
}

function errorPayload(error) {
  const normalized = asComputerUseError(error)
  return {
    code: normalized.code,
    message: normalized.message,
    retryable: normalized.retryable,
    requiresFreshState: normalized.requiresFreshState,
    effectMayHaveOccurred: normalized.effectMayHaveOccurred,
  }
}

module.exports = {
  ComputerUseError,
  ERROR_DEFINITIONS,
  asComputerUseError,
  cuError,
  errorPayload,
}
