import { z } from "zod"

export const TOOL_CALL_PROTOCOL_VERSION = 3 as const

const NonEmptyStringSchema = z.string().trim().min(1)
const MetadataSchema = z.record(z.string(), z.unknown())

export const ToolCallPhaseSchema = z.enum(["pending", "waiting-approval", "running", "settled"])
export type ToolCallPhase = z.infer<typeof ToolCallPhaseSchema>

export const ToolCallResultPolaritySchema = z.enum(["success", "negative"])
export type ToolCallResultPolarity = z.infer<typeof ToolCallResultPolaritySchema>

export const ToolCallResultCompletenessSchema = z.enum(["complete", "partial"])
export type ToolCallResultCompleteness = z.infer<typeof ToolCallResultCompletenessSchema>

export const ToolCallSideEffectCertaintySchema = z.enum(["none", "possible", "confirmed", "unknown"])
export type ToolCallSideEffectCertainty = z.infer<typeof ToolCallSideEffectCertaintySchema>

export const ToolCallRetrySafetySchema = z.enum(["safe", "unsafe", "unknown"])
export type ToolCallRetrySafety = z.infer<typeof ToolCallRetrySafetySchema>

export const ToolCallExecutionSemanticsSchema = z
  .object({
    sideEffect: ToolCallSideEffectCertaintySchema,
    retry: ToolCallRetrySafetySchema,
  })
  .strict()
export type ToolCallExecutionSemantics = z.infer<typeof ToolCallExecutionSemanticsSchema>

export const ToolCallTurnControlModeSchema = z.enum([
  "continue-model",
  "wait-user",
  "restart-loop",
  "finish-turn",
  "cancel-turn",
  "fail-turn",
])
export type ToolCallTurnControlMode = z.infer<typeof ToolCallTurnControlModeSchema>

export const ToolCallTurnControlSchema = z
  .object({
    mode: ToolCallTurnControlModeSchema,
    reason: z.string().optional(),
  })
  .strict()
export type ToolCallTurnControl = z.infer<typeof ToolCallTurnControlSchema>

const OutcomeBaseShape = {
  execution: ToolCallExecutionSemanticsSchema,
  metadata: MetadataSchema.optional(),
}

export const ToolCallReturnedOutcomeSchema = z
  .object({
    kind: z.literal("returned"),
    result: ToolCallResultPolaritySchema,
    completeness: ToolCallResultCompletenessSchema,
    output: z.unknown(),
    modelOutput: z.unknown().optional(),
    title: z.string().optional(),
    attachments: z.array(z.unknown()).optional(),
    ...OutcomeBaseShape,
  })
  .strict()
export type ToolCallReturnedOutcome = z.infer<typeof ToolCallReturnedOutcomeSchema>

export const ToolCallBlockedOutcomeSchema = z
  .object({
    kind: z.literal("blocked"),
    reason: NonEmptyStringSchema,
    code: z.string().optional(),
    output: z.unknown().optional(),
    ...OutcomeBaseShape,
  })
  .strict()
export type ToolCallBlockedOutcome = z.infer<typeof ToolCallBlockedOutcomeSchema>

export const ToolCallDeniedOutcomeSchema = z
  .object({
    kind: z.literal("denied"),
    reason: NonEmptyStringSchema,
    approvalID: z.string().optional(),
    ...OutcomeBaseShape,
  })
  .strict()
export type ToolCallDeniedOutcome = z.infer<typeof ToolCallDeniedOutcomeSchema>

export const ToolCallCancelledOutcomeSchema = z
  .object({
    kind: z.literal("cancelled"),
    reason: NonEmptyStringSchema,
    by: z.enum(["user", "framework", "provider", "shutdown", "superseded", "unknown"]),
    ...OutcomeBaseShape,
  })
  .strict()
export type ToolCallCancelledOutcome = z.infer<typeof ToolCallCancelledOutcomeSchema>

export const ToolCallTimeoutOutcomeSchema = z
  .object({
    kind: z.literal("timeout"),
    reason: NonEmptyStringSchema,
    timeoutMs: z.number().int().positive().optional(),
    partialOutput: z.unknown().optional(),
    ...OutcomeBaseShape,
  })
  .strict()
export type ToolCallTimeoutOutcome = z.infer<typeof ToolCallTimeoutOutcomeSchema>

export const ToolCallFailureStageSchema = z.enum([
  "validation",
  "authorization",
  "dispatch",
  "execution",
  "transport",
  "protocol",
  "result-processing",
  "internal",
])
export type ToolCallFailureStage = z.infer<typeof ToolCallFailureStageSchema>

export const ToolCallFailureSourceSchema = z.enum(["model", "runtime", "provider", "tool"])
export type ToolCallFailureSource = z.infer<typeof ToolCallFailureSourceSchema>

export const ToolCallFailureSeveritySchema = z.enum(["recoverable", "turn-fatal"])
export type ToolCallFailureSeverity = z.infer<typeof ToolCallFailureSeveritySchema>

export const ToolCallFailureSchema = z
  .object({
    stage: ToolCallFailureStageSchema,
    source: ToolCallFailureSourceSchema,
    code: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
    handlerExecuted: z.boolean(),
    retryable: z.boolean(),
    severity: ToolCallFailureSeveritySchema,
    details: MetadataSchema.optional(),
  })
  .strict()
export type ToolCallFailure = z.infer<typeof ToolCallFailureSchema>

export const ToolCallFailedOutcomeSchema = z
  .object({
    kind: z.literal("failed"),
    error: ToolCallFailureSchema,
    partialOutput: z.unknown().optional(),
    ...OutcomeBaseShape,
  })
  .strict()
export type ToolCallFailedOutcome = z.infer<typeof ToolCallFailedOutcomeSchema>

export const ToolCallOutcomeSchema = z.discriminatedUnion("kind", [
  ToolCallReturnedOutcomeSchema,
  ToolCallBlockedOutcomeSchema,
  ToolCallDeniedOutcomeSchema,
  ToolCallCancelledOutcomeSchema,
  ToolCallTimeoutOutcomeSchema,
  ToolCallFailedOutcomeSchema,
])
export type ToolCallOutcome = z.infer<typeof ToolCallOutcomeSchema>

export const ToolCallApprovalSchema = z
  .object({
    id: NonEmptyStringSchema,
    reason: z.string().optional(),
    metadata: MetadataSchema.optional(),
  })
  .strict()
export type ToolCallApproval = z.infer<typeof ToolCallApprovalSchema>

export const ToolCallPendingStateSchema = z.object({ phase: z.literal("pending") }).strict()
export type ToolCallPendingState = z.infer<typeof ToolCallPendingStateSchema>
export const ToolCallWaitingApprovalStateSchema = z
  .object({
    phase: z.literal("waiting-approval"),
    approval: ToolCallApprovalSchema,
  })
  .strict()
export type ToolCallWaitingApprovalState = z.infer<typeof ToolCallWaitingApprovalStateSchema>
export const ToolCallRunningStateSchema = z.object({ phase: z.literal("running") }).strict()
export type ToolCallRunningState = z.infer<typeof ToolCallRunningStateSchema>
export const ToolCallSettledStateSchema = z
  .object({
    phase: z.literal("settled"),
    outcome: ToolCallOutcomeSchema,
    control: ToolCallTurnControlSchema,
  })
  .strict()
export type ToolCallSettledState = z.infer<typeof ToolCallSettledStateSchema>

export const ToolCallStateSchema = z.discriminatedUnion("phase", [
  ToolCallPendingStateSchema,
  ToolCallWaitingApprovalStateSchema,
  ToolCallRunningStateSchema,
  ToolCallSettledStateSchema,
])
export type ToolCallState = z.infer<typeof ToolCallStateSchema>

export const ToolCallSourceSchema = z
  .object({
    kind: z.enum(["model", "provider", "framework"]),
    providerID: z.string().optional(),
    modelID: z.string().optional(),
    metadata: MetadataSchema.optional(),
  })
  .strict()
export type ToolCallSource = z.infer<typeof ToolCallSourceSchema>

export const ToolCallInputSchema = z
  .object({
    raw: z.string(),
    value: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
export type ToolCallInput = z.infer<typeof ToolCallInputSchema>

export const ToolCallRetrySchema = z
  .object({
    attempt: z.number().int().positive(),
    previousCallID: z.string().optional(),
  })
  .strict()
export type ToolCallRetry = z.infer<typeof ToolCallRetrySchema>

export const ToolCallTimestampsSchema = z
  .object({
    createdAt: z.number().int().nonnegative(),
    inputUpdatedAt: z.number().int().nonnegative().optional(),
    approvalRequestedAt: z.number().int().nonnegative().optional(),
    startedAt: z.number().int().nonnegative().optional(),
    settledAt: z.number().int().nonnegative().optional(),
    compactedAt: z.number().int().nonnegative().optional(),
  })
  .strict()
export type ToolCallTimestamps = z.infer<typeof ToolCallTimestampsSchema>

export const ToolCallProgressSchema = z
  .object({
    message: z.string().optional(),
    current: z.number().nonnegative().optional(),
    total: z.number().positive().optional(),
    unit: z.string().optional(),
    metadata: MetadataSchema.optional(),
  })
  .strict()
  .refine(
    (progress) => progress.current === undefined || progress.total === undefined || progress.current <= progress.total,
    { message: "Tool call progress cannot exceed its total." },
  )
export type ToolCallProgress = z.infer<typeof ToolCallProgressSchema>

export const ToolCallPresentationSchema = z
  .object({
    title: z.string().optional(),
    metadata: MetadataSchema.optional(),
  })
  .strict()
export type ToolCallPresentation = z.infer<typeof ToolCallPresentationSchema>

export const ToolCallSnapshotSchema = z
  .object({
    schemaVersion: z.literal(TOOL_CALL_PROTOCOL_VERSION),
    callID: NonEmptyStringSchema,
    sessionID: NonEmptyStringSchema,
    turnID: NonEmptyStringSchema,
    messageID: NonEmptyStringSchema,
    executionID: z.string().optional(),
    tool: NonEmptyStringSchema,
    input: ToolCallInputSchema,
    source: ToolCallSourceSchema,
    parentCallID: z.string().optional(),
    retry: ToolCallRetrySchema,
    revision: z.number().int().nonnegative(),
    timestamps: ToolCallTimestampsSchema,
    progress: ToolCallProgressSchema.optional(),
    presentation: ToolCallPresentationSchema.optional(),
    state: ToolCallStateSchema,
  })
  .strict()
  .superRefine((call, context) => {
    if (call.state.phase === "waiting-approval" && call.timestamps.approvalRequestedAt === undefined) {
      context.addIssue({
        code: "custom",
        path: ["timestamps", "approvalRequestedAt"],
        message: "A waiting tool call must record when approval was requested.",
      })
    }
    if (call.state.phase === "running" && call.timestamps.startedAt === undefined) {
      context.addIssue({
        code: "custom",
        path: ["timestamps", "startedAt"],
        message: "A running tool call must record when execution started.",
      })
    }
    if (call.state.phase === "settled" && call.timestamps.settledAt === undefined) {
      context.addIssue({
        code: "custom",
        path: ["timestamps", "settledAt"],
        message: "A settled tool call must record when it settled.",
      })
    }
  })
export type ToolCallSnapshot = z.infer<typeof ToolCallSnapshotSchema>

/**
 * Extracts the strict ToolCall v3 snapshot from either a standalone snapshot
 * or a persisted message part. Message parts add transport fields (`id`,
 * `type`), so validating the whole object against the strict snapshot schema
 * would reject an otherwise valid call. Legacy status-shaped records still
 * fail because every canonical v3 field is required here.
 */
export function parseToolCallSnapshot(value: unknown): ToolCallSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const result = ToolCallSnapshotSchema.safeParse({
    schemaVersion: record.schemaVersion,
    callID: record.callID,
    sessionID: record.sessionID,
    turnID: record.turnID,
    messageID: record.messageID,
    executionID: record.executionID,
    tool: record.tool,
    input: record.input,
    source: record.source,
    parentCallID: record.parentCallID,
    retry: record.retry,
    revision: record.revision,
    timestamps: record.timestamps,
    progress: record.progress,
    presentation: record.presentation,
    state: record.state,
  })
  return result.success ? result.data : undefined
}

export const ToolCallCreatedEventSchema = z
  .object({
    type: z.literal("tool.call.created"),
    call: ToolCallSnapshotSchema,
  })
  .strict()

const ToolCallMutationEventBaseShape = {
  callID: NonEmptyStringSchema,
  revision: z.number().int().positive(),
  timestamp: z.number().int().nonnegative(),
}

export const ToolCallInputDeltaEventSchema = z
  .object({
    type: z.literal("tool.call.input_delta"),
    ...ToolCallMutationEventBaseShape,
    delta: z.string(),
    value: z.record(z.string(), z.unknown()).optional(),
    presentation: ToolCallPresentationSchema.optional(),
    source: ToolCallSourceSchema.optional(),
  })
  .strict()

export const ToolCallProgressEventSchema = z
  .object({
    type: z.literal("tool.call.progress"),
    ...ToolCallMutationEventBaseShape,
    progress: ToolCallProgressSchema,
  })
  .strict()

export const ToolCallPhaseChangedEventSchema = z
  .object({
    type: z.literal("tool.call.phase_changed"),
    ...ToolCallMutationEventBaseShape,
    state: z.discriminatedUnion("phase", [ToolCallWaitingApprovalStateSchema, ToolCallRunningStateSchema]),
    presentation: ToolCallPresentationSchema.optional(),
    source: ToolCallSourceSchema.optional(),
  })
  .strict()

export const ToolCallSettledEventSchema = z
  .object({
    type: z.literal("tool.call.settled"),
    ...ToolCallMutationEventBaseShape,
    outcome: ToolCallOutcomeSchema,
    control: ToolCallTurnControlSchema,
    presentation: ToolCallPresentationSchema.optional(),
  })
  .strict()

export const ToolCallEventSchema = z.discriminatedUnion("type", [
  ToolCallCreatedEventSchema,
  ToolCallInputDeltaEventSchema,
  ToolCallProgressEventSchema,
  ToolCallPhaseChangedEventSchema,
  ToolCallSettledEventSchema,
])
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>

export type ToolCallTransitionRejection =
  | "already-created"
  | "missing-created"
  | "call-id-mismatch"
  | "stale-revision"
  | "revision-gap"
  | "timestamp-regression"
  | "already-settled"
  | "invalid-transition"

export type ToolCallTransitionResult =
  | { applied: true; call: ToolCallSnapshot }
  | { applied: false; call: ToolCallSnapshot | undefined; reason: ToolCallTransitionRejection }

function latestTimestamp(call: ToolCallSnapshot) {
  return Math.max(...Object.values(call.timestamps).filter((value): value is number => typeof value === "number"))
}

function rejectTransition(
  call: ToolCallSnapshot | undefined,
  reason: ToolCallTransitionRejection,
): ToolCallTransitionResult {
  return { applied: false, call, reason }
}

function canSettleFromPhase(phase: Exclude<ToolCallPhase, "settled">, outcome: ToolCallOutcome) {
  if (outcome.kind === "returned") return phase === "running"
  if (outcome.kind === "timeout") return phase === "waiting-approval" || phase === "running"
  if (outcome.kind === "denied") return phase === "waiting-approval" || phase === "running"
  return true
}

export function applyToolCallEvent(
  current: ToolCallSnapshot | undefined,
  event: ToolCallEvent,
): ToolCallTransitionResult {
  if (event.type === "tool.call.created") {
    if (current) return rejectTransition(current, "already-created")
    if (event.call.revision !== 0 || event.call.state.phase !== "pending") {
      return rejectTransition(undefined, "invalid-transition")
    }
    return { applied: true, call: event.call }
  }

  if (!current) return rejectTransition(undefined, "missing-created")
  if (event.callID !== current.callID) return rejectTransition(current, "call-id-mismatch")
  if (current.state.phase === "settled") return rejectTransition(current, "already-settled")
  if (event.revision <= current.revision) return rejectTransition(current, "stale-revision")
  if (event.revision !== current.revision + 1) return rejectTransition(current, "revision-gap")
  if (event.timestamp < latestTimestamp(current)) return rejectTransition(current, "timestamp-regression")

  if (event.type === "tool.call.input_delta") {
    if (current.state.phase !== "pending") return rejectTransition(current, "invalid-transition")
    return {
      applied: true,
      call: {
        ...current,
        revision: event.revision,
        input: {
          raw: `${current.input.raw}${event.delta}`,
          value: event.value ?? current.input.value,
        },
        presentation: event.presentation ?? current.presentation,
        source: event.source ?? current.source,
        timestamps: { ...current.timestamps, inputUpdatedAt: event.timestamp },
      },
    }
  }

  if (event.type === "tool.call.progress") {
    if (current.state.phase !== "running") return rejectTransition(current, "invalid-transition")
    return {
      applied: true,
      call: {
        ...current,
        revision: event.revision,
        progress: event.progress,
      },
    }
  }

  if (event.type === "tool.call.phase_changed") {
    const nextPhase = event.state.phase
    const valid =
      (current.state.phase === "pending" && (nextPhase === "waiting-approval" || nextPhase === "running")) ||
      (current.state.phase === "waiting-approval" && nextPhase === "running")
    if (!valid) return rejectTransition(current, "invalid-transition")

    return {
      applied: true,
      call: {
        ...current,
        revision: event.revision,
        state: event.state,
        presentation: event.presentation ?? current.presentation,
        source: event.source ?? current.source,
        timestamps:
          nextPhase === "waiting-approval"
            ? { ...current.timestamps, approvalRequestedAt: event.timestamp }
            : { ...current.timestamps, startedAt: event.timestamp },
      },
    }
  }

  if (!canSettleFromPhase(current.state.phase, event.outcome)) {
    return rejectTransition(current, "invalid-transition")
  }

  return {
    applied: true,
    call: {
      ...current,
      revision: event.revision,
      presentation: event.presentation ?? current.presentation,
      state: {
        phase: "settled",
        outcome: event.outcome,
        control: event.control,
      },
      timestamps: { ...current.timestamps, settledAt: event.timestamp },
    },
  }
}

export function isToolCallActive(call: ToolCallSnapshot) {
  return call.state.phase !== "settled"
}

export function isToolCallReturned(call: ToolCallSnapshot): call is ToolCallSnapshot & {
  state: z.infer<typeof ToolCallSettledStateSchema> & { outcome: ToolCallReturnedOutcome }
} {
  return call.state.phase === "settled" && call.state.outcome.kind === "returned"
}

/**
 * Compares the immutable semantic identity of two settled snapshots. Payloads
 * may later be compacted, but a different outcome or turn-control decision is
 * a second settlement and must not replace the first one in a client cache.
 */
export function isSameToolCallSettlement(left: ToolCallSnapshot, right: ToolCallSnapshot) {
  if (left.callID !== right.callID) return false
  if (left.state.phase !== "settled" || right.state.phase !== "settled") return false
  if (left.state.control.mode !== right.state.control.mode) return false
  const leftOutcome = left.state.outcome
  const rightOutcome = right.state.outcome
  if (leftOutcome.kind !== rightOutcome.kind) return false
  if (
    leftOutcome.execution.sideEffect !== rightOutcome.execution.sideEffect ||
    leftOutcome.execution.retry !== rightOutcome.execution.retry
  ) {
    return false
  }

  if (leftOutcome.kind === "returned" && rightOutcome.kind === "returned") {
    return leftOutcome.result === rightOutcome.result && leftOutcome.completeness === rightOutcome.completeness
  }
  if (leftOutcome.kind === "blocked" && rightOutcome.kind === "blocked") {
    return leftOutcome.code === rightOutcome.code && leftOutcome.reason === rightOutcome.reason
  }
  if (leftOutcome.kind === "denied" && rightOutcome.kind === "denied") {
    return leftOutcome.approvalID === rightOutcome.approvalID && leftOutcome.reason === rightOutcome.reason
  }
  if (leftOutcome.kind === "cancelled" && rightOutcome.kind === "cancelled") {
    return leftOutcome.by === rightOutcome.by && leftOutcome.reason === rightOutcome.reason
  }
  if (leftOutcome.kind === "timeout" && rightOutcome.kind === "timeout") {
    return leftOutcome.timeoutMs === rightOutcome.timeoutMs && leftOutcome.reason === rightOutcome.reason
  }
  if (leftOutcome.kind === "failed" && rightOutcome.kind === "failed") {
    const leftError = leftOutcome.error
    const rightError = rightOutcome.error
    return (
      leftError.stage === rightError.stage &&
      leftError.source === rightError.source &&
      leftError.code === rightError.code &&
      leftError.message === rightError.message &&
      leftError.handlerExecuted === rightError.handlerExecuted &&
      leftError.retryable === rightError.retryable &&
      leftError.severity === rightError.severity
    )
  }

  return false
}
