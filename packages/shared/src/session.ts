import { z } from "zod"
import { ReasoningEffortSchema } from "./reasoning"
import { ToolModuleIDSchema } from "./tool-module"

export const SessionAttachmentBodySchema = z.object({
  path: z.string().min(1),
  name: z.string().optional(),
})

export const SessionQuestionAnswerBodySchema = z.object({
  questionID: z.string().min(1),
  selectedOptions: z.array(z.string().min(1)).optional(),
  freeformText: z.string().optional(),
})

export const AgentModelReferenceSchema = z.object({
  providerID: z.string(),
  modelID: z.string(),
})

export const AgentThreadTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("active-thread"),
    parentMessageID: z.string().min(1).nullable().optional(),
  }),
  z.object({
    kind: z.literal("detached-branch"),
    parentMessageID: z.string().min(1),
  }),
])

export const SessionMessageQuoteBodySchema = z.object({
  sourceMessageID: z.string().min(1),
  text: z.string().trim().min(1),
})

export const CreateSessionBodySchema = z.object({
  directory: z.string().min(1),
})

export const RollbackSessionBodySchema = z.object({
  targetMessageID: z.string().min(1),
  reason: z.string().min(1),
  correctivePrompt: z.string().min(1),
  restoreWorkspace: z.boolean().optional(),
})

export const UpdateSessionWorkflowBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("enter-plan"),
  }),
  z.object({
    action: z.literal("leave-plan"),
  }),
  z.object({
    action: z.literal("approve-plan"),
    proposedPlanMarkdown: z.string().min(1),
  }),
])

export const StreamSessionMessageBodySchema = z
  .object({
    text: z.string().optional(),
    displayText: z.string().optional(),
    parentMessageID: z.string().min(1).nullable().optional(),
    clientTurnID: z.string().min(1).optional(),
    executionID: z.string().min(1).optional(),
    threadTarget: AgentThreadTargetSchema.optional(),
    quotes: z.array(SessionMessageQuoteBodySchema).optional(),
    attachments: z.array(SessionAttachmentBodySchema).optional(),
    questionAnswer: SessionQuestionAnswerBodySchema.optional(),
    concurrentInputMode: z.enum(["queue", "steer"]).optional(),
    system: z.string().optional(),
    agent: z.string().optional(),
    skills: z.array(z.string()).optional(),
    turnMcpServerIDs: z.array(z.string()).optional(),
    turnToolModuleIDs: z.array(ToolModuleIDSchema).optional(),
    reasoningEffort: ReasoningEffortSchema.optional(),
    model: AgentModelReferenceSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasText = typeof value.text === "string" && value.text.trim().length > 0
    const hasQuotes = Array.isArray(value.quotes) && value.quotes.length > 0
    const hasAttachments = Array.isArray(value.attachments) && value.attachments.length > 0
    const hasQuestionAnswer =
      Boolean(value.questionAnswer?.questionID.trim()) &&
      (Boolean(value.questionAnswer?.freeformText?.trim()) ||
        Boolean(value.questionAnswer?.selectedOptions?.length))

    if (!hasText && !hasQuotes && !hasAttachments && !hasQuestionAnswer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Body must include text, a message quote, a structured question answer, or at least one attachment",
        path: ["text"],
      })
    }

    if (
      value.threadTarget?.kind === "detached-branch" &&
      value.parentMessageID !== undefined &&
      value.parentMessageID !== value.threadTarget.parentMessageID
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Detached branch parentMessageID must match threadTarget.parentMessageID",
        path: ["parentMessageID"],
      })
    }

    if (
      value.threadTarget?.kind === "detached-branch" &&
      value.executionID?.trim() === "active-thread"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Detached branches cannot use the active-thread execution ID",
        path: ["executionID"],
      })
    }
  })

export const SessionEventSchema = z.object({
  event: z.string().min(1),
  data: z.unknown(),
  id: z.string().min(1).optional(),
})

export const AgentRouteSchemas = {
  sessions: {
    create: {
      body: CreateSessionBodySchema,
    },
    rollback: {
      body: RollbackSessionBodySchema,
    },
    streamMessage: {
      body: StreamSessionMessageBodySchema,
    },
    answerQuestion: {
      body: SessionQuestionAnswerBodySchema,
    },
    updateWorkflow: {
      body: UpdateSessionWorkflowBodySchema,
    },
  },
} as const

export type SessionAttachmentBody = z.infer<typeof SessionAttachmentBodySchema>
export type SessionQuestionAnswerBody = z.infer<typeof SessionQuestionAnswerBodySchema>
export type AgentThreadTarget = z.infer<typeof AgentThreadTargetSchema>
export type SessionMessageQuoteBody = z.infer<typeof SessionMessageQuoteBodySchema>
export type CreateSessionBody = z.infer<typeof CreateSessionBodySchema>
export type RollbackSessionBody = z.infer<typeof RollbackSessionBodySchema>
export type UpdateSessionWorkflowBody = z.infer<typeof UpdateSessionWorkflowBodySchema>
export type StreamSessionMessageBody = z.infer<typeof StreamSessionMessageBodySchema>
export type SessionEvent = z.infer<typeof SessionEventSchema>
