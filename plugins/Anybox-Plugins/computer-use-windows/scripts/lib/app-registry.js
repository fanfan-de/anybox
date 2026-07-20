"use strict"

const { WINDOW_TTL_MS } = require("./build-info")
const { cuError } = require("./errors")
const { makeRef } = require("./state-registry")

class AppRegistry {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? Math.min(WINDOW_TTL_MS, 2 * 60 * 1000)
    this.now = options.now ?? Date.now
    this.makeRef = options.makeRef ?? makeRef
    this.byRef = new Map()
    this.refById = new Map()
  }

  upsert(rawApp) {
    if (
      !rawApp
      || typeof rawApp !== "object"
      || typeof rawApp.appId !== "string"
      || !rawApp.appId
      || typeof rawApp.catalogRef !== "string"
      || !rawApp.catalogRef
    ) {
      throw cuError("CU_PROTOCOL_MISMATCH", "Helper returned an invalid application catalog entry.")
    }
    let appRef = this.refById.get(rawApp.appId)
    if (!appRef) {
      appRef = this.makeRef("app")
      this.refById.set(rawApp.appId, appRef)
    }
    const record = {
      appRef,
      appId: rawApp.appId,
      catalogRef: rawApp.catalogRef,
      displayName: String(rawApp.displayName || rawApp.appId),
      kind: rawApp.kind === "packaged" ? "packaged" : "win32",
      processName: String(rawApp.processName || ""),
      isRunning: Boolean(rawApp.isRunning),
      canLaunch: Boolean(rawApp.canLaunch),
      blocked: Boolean(rawApp.blocked),
      blockReason: rawApp.blockReason ? String(rawApp.blockReason) : undefined,
      windows: Array.isArray(rawApp.windows) ? rawApp.windows : [],
      updatedAt: this.now(),
    }
    this.byRef.set(appRef, record)
    this.cleanup()
    return record
  }

  resolve(input = {}) {
    const appRef = typeof input.appRef === "string" && input.appRef.trim()
      ? input.appRef.trim()
      : undefined
    const appId = typeof input.appId === "string" && input.appId.trim()
      ? input.appId.trim()
      : undefined
    if (Boolean(appRef) === Boolean(appId)) {
      throw cuError("CU_INVALID_ARGUMENT", "Use exactly one application selector: appRef or appId.")
    }
    const resolvedRef = appRef ?? this.refById.get(appId)
    const record = resolvedRef ? this.byRef.get(resolvedRef) : undefined
    if (!record || this.now() - record.updatedAt > this.ttlMs) {
      throw cuError(
        "CU_APP_APPROVAL_REQUIRED",
        "The application catalog entry expired. Call list_apps before launching.",
      )
    }
    if (appId && record.appId !== appId) {
      throw cuError("CU_APP_APPROVAL_REQUIRED", "The application ID is not in the current catalog.")
    }
    return record
  }

  publicApp(record, windows) {
    return {
      appRef: record.appRef,
      appId: record.appId,
      displayName: record.displayName,
      kind: record.kind,
      isRunning: record.isRunning,
      canLaunch: record.canLaunch,
      blocked: record.blocked,
      blockReason: record.blockReason,
      windows,
    }
  }

  cleanup() {
    const cutoff = this.now() - this.ttlMs
    for (const [appRef, record] of this.byRef.entries()) {
      if (record.updatedAt >= cutoff) continue
      this.byRef.delete(appRef)
      if (this.refById.get(record.appId) === appRef) this.refById.delete(record.appId)
    }
  }
}

module.exports = {
  AppRegistry,
}
