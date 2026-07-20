import { createHmac, randomBytes } from "node:crypto"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "computer-use.security" })
const digestKey = randomBytes(32)
const SAFE_TOKEN = /^[a-z0-9._:-]{1,96}$/i

export interface ComputerUseTelemetryInput {
  sessionID: string
  turnID: string
  toolCallID: string
  toolName: string
  operation: string
  appID?: string
  windowRef?: string
  stateRef?: string
  durationMs: number
  resultCode: string
  helperVersion?: string
  effectMayHaveOccurred?: boolean
}

export interface ComputerUseTelemetryFields {
  sessionDigest: string
  turnDigest: string
  toolCallDigest: string
  toolName: string
  operation: string
  appDigest?: string
  windowDigest?: string
  stateDigest?: string
  durationMs: number
  resultCode: string
  helperVersion?: string
  effectMayHaveOccurred?: boolean
}

function digest(namespace: string, value: string) {
  return createHmac("sha256", digestKey)
    .update(namespace)
    .update("\0")
    .update(value)
    .digest("hex")
    .slice(0, 20)
}

function safeToken(value: string, fallback: string) {
  const normalized = value.trim()
  return SAFE_TOKEN.test(normalized) ? normalized : fallback
}

export function buildComputerUseTelemetry(
  input: ComputerUseTelemetryInput,
): ComputerUseTelemetryFields {
  return {
    sessionDigest: digest("session", input.sessionID),
    turnDigest: digest("turn", input.turnID),
    toolCallDigest: digest("tool-call", input.toolCallID),
    toolName: safeToken(input.toolName, "unknown"),
    operation: safeToken(input.operation, "unknown"),
    ...(input.appID ? { appDigest: digest("app", input.appID) } : {}),
    ...(input.windowRef ? { windowDigest: digest("window", input.windowRef) } : {}),
    ...(input.stateRef ? { stateDigest: digest("state", input.stateRef) } : {}),
    durationMs: Math.max(0, Math.round(input.durationMs)),
    resultCode: safeToken(input.resultCode, "CU_INTERNAL_ERROR"),
    ...(input.helperVersion
      ? { helperVersion: safeToken(input.helperVersion, "unknown") }
      : {}),
    ...(input.effectMayHaveOccurred
      ? { effectMayHaveOccurred: true }
      : {}),
  }
}

export function recordComputerUseTelemetry(input: ComputerUseTelemetryInput) {
  const fields = buildComputerUseTelemetry(input)
  log.info("Computer Use operation completed.", fields)
  return fields
}
