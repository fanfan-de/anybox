import { describe, expect, it } from "vitest"
import {
  ToolCallEventSchema,
  ToolCallFailureSchema,
  ToolCallSnapshotSchema,
  applyToolCallEvent,
  isSameToolCallSettlement,
  parseToolCallSnapshot,
  type ToolCallEvent,
  type ToolCallSnapshot,
} from "./tool-call"

function pendingCall(): ToolCallSnapshot {
  return ToolCallSnapshotSchema.parse({
    schemaVersion: 3,
    callID: "call-1",
    sessionID: "session-1",
    turnID: "turn-1",
    messageID: "message-1",
    executionID: "execution-1",
    tool: "shell",
    input: { raw: "" },
    source: { kind: "model", providerID: "openai", modelID: "gpt-5" },
    retry: { attempt: 1 },
    revision: 0,
    timestamps: { createdAt: 10 },
    state: { phase: "pending" },
  })
}

function apply(call: ToolCallSnapshot | undefined, event: ToolCallEvent) {
  const result = applyToolCallEvent(call, event)
  expect(result.applied).toBe(true)
  if (!result.applied) throw new Error(result.reason)
  return result.call
}

const returnedNegativePartial = {
  kind: "returned",
  result: "negative",
  completeness: "partial",
  output: { stderr: "lint failed", exitCode: 1 },
  execution: { sideEffect: "possible", retry: "unknown" },
} as const

const continueModel = { mode: "continue-model" } as const
const recoverableRuntimeFailure = {
  stage: "transport",
  source: "runtime",
  code: "TRANSPORT_DISCONNECTED",
  message: "transport disconnected",
  handlerExecuted: true,
  retryable: true,
  severity: "recoverable",
} as const

describe("ToolCall v3 contract", () => {
  it("extracts snapshots from v3 message parts without accepting legacy status records", () => {
    const call = pendingCall()
    expect(parseToolCallSnapshot({ id: "part-1", type: "tool", ...call })).toEqual(call)
    expect(parseToolCallSnapshot({
      id: "part-legacy",
      type: "tool",
      callID: call.callID,
      state: { status: "completed", output: "done" },
    })).toBeUndefined()
  })

  it("distinguishes a compacted settlement from a conflicting second settlement", () => {
    const running = apply(pendingCall(), {
      type: "tool.call.phase_changed",
      callID: "call-1",
      revision: 1,
      timestamp: 11,
      state: { phase: "running" },
    })
    const first = apply(running, {
      type: "tool.call.settled",
      callID: "call-1",
      revision: 2,
      timestamp: 12,
      outcome: returnedNegativePartial,
      control: continueModel,
    })
    const compacted = ToolCallSnapshotSchema.parse({
      ...first,
      revision: 3,
      state: {
        ...first.state,
        outcome: {
          ...(first.state.phase === "settled" ? first.state.outcome : returnedNegativePartial),
          output: "[compacted]",
        },
      },
    })
    const conflicting = ToolCallSnapshotSchema.parse({
      ...first,
      revision: 3,
      state: {
        phase: "settled",
        outcome: {
          kind: "failed",
          error: { ...recoverableRuntimeFailure, message: "late failure" },
          execution: { sideEffect: "unknown", retry: "unknown" },
        },
        control: { mode: "fail-turn" },
      },
    })
    const conflictingFailureDetail = ToolCallSnapshotSchema.parse({
      ...conflicting,
      state: {
        ...conflicting.state,
        outcome: {
          ...(conflicting.state.phase === "settled" ? conflicting.state.outcome : returnedNegativePartial),
          error: { ...recoverableRuntimeFailure, message: "different late failure" },
        },
      },
    })

    expect(isSameToolCallSettlement(first, compacted)).toBe(true)
    expect(isSameToolCallSettlement(first, conflicting)).toBe(false)
    expect(isSameToolCallSettlement(conflicting, conflictingFailureDetail)).toBe(false)
  })

  it("rejects the removed single-layer status contract", () => {
    const legacy = {
      ...pendingCall(),
      state: { status: "pending", input: {}, raw: "" },
    }

    expect(ToolCallSnapshotSchema.safeParse(legacy).success).toBe(false)
    expect(ToolCallEventSchema.safeParse({ type: "tool.call.completed", call: legacy }).success).toBe(false)
  })

  it("keeps lifecycle, result semantics, and turn control independent", () => {
    let call = apply(undefined, { type: "tool.call.created", call: pendingCall() })
    call = apply(call, {
      type: "tool.call.input_delta",
      callID: call.callID,
      revision: 1,
      timestamp: 11,
      delta: '{"cmd":"pnpm test"}',
      value: { cmd: "pnpm test" },
    })
    call = apply(call, {
      type: "tool.call.phase_changed",
      callID: call.callID,
      revision: 2,
      timestamp: 12,
      state: { phase: "waiting-approval", approval: { id: "approval-1" } },
    })
    call = apply(call, {
      type: "tool.call.phase_changed",
      callID: call.callID,
      revision: 3,
      timestamp: 13,
      state: { phase: "running" },
    })
    call = apply(call, {
      type: "tool.call.progress",
      callID: call.callID,
      revision: 4,
      timestamp: 14,
      progress: { message: "running tests", current: 3, total: 10, unit: "test" },
    })
    call = apply(call, {
      type: "tool.call.settled",
      callID: call.callID,
      revision: 5,
      timestamp: 15,
      outcome: returnedNegativePartial,
      control: continueModel,
    })

    expect(call.state).toEqual({
      phase: "settled",
      outcome: returnedNegativePartial,
      control: continueModel,
    })
    expect(call.input).toEqual({ raw: '{"cmd":"pnpm test"}', value: { cmd: "pnpm test" } })
    expect(call.timestamps).toEqual({
      createdAt: 10,
      inputUpdatedAt: 11,
      approvalRequestedAt: 12,
      startedAt: 13,
      settledAt: 15,
    })
  })

  it("accepts only the first valid settlement", () => {
    let call = apply(undefined, { type: "tool.call.created", call: pendingCall() })
    call = apply(call, {
      type: "tool.call.phase_changed",
      callID: call.callID,
      revision: 1,
      timestamp: 11,
      state: { phase: "running" },
    })
    call = apply(call, {
      type: "tool.call.settled",
      callID: call.callID,
      revision: 2,
      timestamp: 12,
      outcome: returnedNegativePartial,
      control: continueModel,
    })

    const second = applyToolCallEvent(call, {
      type: "tool.call.settled",
      callID: call.callID,
      revision: 3,
      timestamp: 13,
      outcome: {
        kind: "failed",
        error: { ...recoverableRuntimeFailure, message: "late transport error" },
        execution: { sideEffect: "unknown", retry: "unknown" },
      },
      control: { mode: "fail-turn" },
    })

    expect(second).toEqual({ applied: false, call, reason: "already-settled" })
  })

  it("rejects invalid phases, revision gaps, and timestamp regressions", () => {
    const call = pendingCall()
    expect(
      applyToolCallEvent(call, {
        type: "tool.call.settled",
        callID: call.callID,
        revision: 1,
        timestamp: 11,
        outcome: returnedNegativePartial,
        control: continueModel,
      }),
    ).toMatchObject({ applied: false, reason: "invalid-transition" })

    expect(
      applyToolCallEvent(call, {
        type: "tool.call.phase_changed",
        callID: call.callID,
        revision: 2,
        timestamp: 11,
        state: { phase: "running" },
      }),
    ).toMatchObject({ applied: false, reason: "revision-gap" })

    expect(
      applyToolCallEvent(call, {
        type: "tool.call.phase_changed",
        callID: call.callID,
        revision: 1,
        timestamp: 9,
        state: { phase: "running" },
      }),
    ).toMatchObject({ applied: false, reason: "timestamp-regression" })
  })

  it("allows an approval deadline to settle as timeout", () => {
    let call = apply(undefined, { type: "tool.call.created", call: pendingCall() })
    call = apply(call, {
      type: "tool.call.phase_changed",
      callID: call.callID,
      revision: 1,
      timestamp: 11,
      state: { phase: "waiting-approval", approval: { id: "approval-timeout" } },
    })
    call = apply(call, {
      type: "tool.call.settled",
      callID: call.callID,
      revision: 2,
      timestamp: 12,
      outcome: {
        kind: "timeout",
        reason: "Approval deadline exceeded.",
        timeoutMs: 30_000,
        execution: { sideEffect: "none", retry: "safe" },
      },
      control: continueModel,
    })

    expect(call.state).toMatchObject({
      phase: "settled",
      outcome: { kind: "timeout", timeoutMs: 30_000 },
    })
  })

  it("keeps framework failure protocol-safe and free of turn-fatal flags", () => {
    expect(
      ToolCallFailureSchema.safeParse({
        ...recoverableRuntimeFailure,
        turnFatal: true,
      }).success,
    ).toBe(false)
  })
})
