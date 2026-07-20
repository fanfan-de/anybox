"use strict"

const crypto = require("node:crypto")
const { WINDOW_TTL_MS } = require("./build-info")
const { cuError } = require("./errors")
const { makeRef } = require("./state-registry")

function normalizeProcessName(value) {
  const raw = String(value || "").trim().toLowerCase()
  if (!raw) return ""
  return raw.endsWith(".exe") ? raw : `${raw}.exe`
}

function normalizeBounds(value) {
  if (!value || typeof value !== "object") return { x: 0, y: 0, width: 0, height: 0 }
  return {
    x: Number(value.x ?? value.left ?? 0),
    y: Number(value.y ?? value.top ?? 0),
    width: Number(value.width ?? 0),
    height: Number(value.height ?? 0),
  }
}

function identityForWindow(window) {
  const identity = window?.identity && typeof window.identity === "object"
    ? window.identity
    : {}
  return {
    hwnd: String(identity.hwnd ?? window?.hwnd ?? ""),
    pid: Number(identity.pid ?? window?.pid ?? 0),
    processStartTime: String(identity.processStartTime ?? window?.processStartTime ?? ""),
    rootOwnerHwnd: String(identity.rootOwnerHwnd ?? window?.rootOwnerHwnd ?? window?.hwnd ?? ""),
    executableIdentity: String(
      identity.executableIdentity
      ?? window?.executableIdentity
      ?? window?.processPath
      ?? normalizeProcessName(window?.processName),
    ).toLowerCase(),
    sessionId: Number(identity.sessionId ?? window?.sessionId ?? 0),
    integrityLevel: String(identity.integrityLevel ?? window?.integrityLevel ?? "unknown").toLowerCase(),
  }
}

function digestIdentity(identity) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([
      identity.hwnd,
      identity.pid,
      identity.processStartTime,
      identity.rootOwnerHwnd,
      identity.executableIdentity,
      identity.sessionId,
      identity.integrityLevel,
    ]))
    .digest("hex")
}

function mutableFingerprint(window) {
  return JSON.stringify([
    window.title || "",
    normalizeBounds(window.bounds),
    Number(window.dpiScale ?? 1),
    Boolean(window.minimized),
  ])
}

class WindowRegistry {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? WINDOW_TTL_MS
    this.now = options.now ?? Date.now
    this.makeRef = options.makeRef ?? makeRef
    this.windowsByRef = new Map()
    this.refByIdentity = new Map()
    this.refByHwnd = new Map()
  }

  upsert(rawWindow) {
    if (!rawWindow || typeof rawWindow !== "object") {
      throw cuError("CU_PROTOCOL_MISMATCH", "Helper returned an invalid window object.")
    }
    const identity = identityForWindow(rawWindow)
    if (!identity.hwnd || !identity.pid || !identity.processStartTime) {
      throw cuError("CU_PROTOCOL_MISMATCH", "Helper returned an incomplete window identity.")
    }
    const identityDigest = digestIdentity(identity)
    const replacedRef = this.refByHwnd.get(identity.hwnd)
    if (replacedRef) {
      const replaced = this.windowsByRef.get(replacedRef)
      if (replaced && replaced.identityDigest !== identityDigest) {
        replaced.invalidated = true
        this.refByIdentity.delete(replaced.identityDigest)
      }
    }

    let windowRef = this.refByIdentity.get(identityDigest)
    if (!windowRef) {
      windowRef = this.makeRef("win")
      this.refByIdentity.set(identityDigest, windowRef)
    }

    const previous = this.windowsByRef.get(windowRef)
    const normalizedWindow = {
      ...rawWindow,
      processName: normalizeProcessName(rawWindow.processName),
      appId: rawWindow.appId || `process:${normalizeProcessName(rawWindow.processName)}`,
      bounds: normalizeBounds(rawWindow.bounds),
      clientBounds: normalizeBounds(rawWindow.clientBounds),
      identity,
    }
    const fingerprint = mutableFingerprint(normalizedWindow)
    const record = {
      windowRef,
      identity,
      identityDigest,
      window: normalizedWindow,
      revision: previous
        ? previous.revision + (previous.fingerprint === fingerprint ? 0 : 1)
        : 0,
      fingerprint,
      updatedAt: this.now(),
      invalidated: false,
    }
    this.windowsByRef.set(windowRef, record)
    this.refByHwnd.set(identity.hwnd, windowRef)
    this.cleanup()
    return record
  }

  get(windowRef) {
    if (!windowRef || typeof windowRef !== "string") {
      throw cuError("CU_INVALID_ARGUMENT", "A valid windowRef is required.")
    }
    const record = this.windowsByRef.get(windowRef)
    if (!record || record.invalidated) {
      throw cuError("CU_WINDOW_CHANGED", "The selected window is no longer the same window.")
    }
    if (this.now() - record.updatedAt > this.ttlMs) {
      throw cuError("CU_WINDOW_NOT_FOUND", "The windowRef expired. List windows again.")
    }
    return record
  }

  publicWindow(record, policyResult = {}) {
    return {
      windowRef: record.windowRef,
      appId: record.window.appId,
      title: record.window.title || "",
      processName: record.window.processName || "",
      bounds: record.window.bounds,
      clientBounds: record.window.clientBounds,
      dpiScale: Number(record.window.dpiScale ?? 1),
      minimized: Boolean(record.window.minimized),
      blocked: Boolean(policyResult.blocked),
      blockReason: policyResult.reason || undefined,
      updatedAt: record.updatedAt,
    }
  }

  cleanup() {
    const cutoff = this.now() - this.ttlMs
    for (const [windowRef, record] of this.windowsByRef.entries()) {
      if (record.updatedAt >= cutoff && !record.invalidated) continue
      this.windowsByRef.delete(windowRef)
      if (this.refByIdentity.get(record.identityDigest) === windowRef) {
        this.refByIdentity.delete(record.identityDigest)
      }
      if (this.refByHwnd.get(record.identity.hwnd) === windowRef) {
        this.refByHwnd.delete(record.identity.hwnd)
      }
    }
  }
}

module.exports = {
  WindowRegistry,
  digestIdentity,
  identityForWindow,
  normalizeBounds,
  normalizeProcessName,
}
