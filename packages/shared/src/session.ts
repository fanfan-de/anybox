import { z } from "zod"
import { ReasoningEffortSchema } from "./reasoning"

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
    attachments: z.array(SessionAttachmentBodySchema).optional(),
    questionAnswer: SessionQuestionAnswerBodySchema.optional(),
    concurrentInputMode: z.enum(["queue", "steer"]).optional(),
    system: z.string().optional(),
    agent: z.string().optional(),
    skills: z.array(z.string()).optional(),
    turnMcpServerIDs: z.array(z.string()).optional(),
    reasoningEffort: ReasoningEffortSchema.optional(),
    model: AgentModelReferenceSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasText = typeof value.text === "string" && value.text.trim().length > 0
    const hasAttachments = Array.isArray(value.attachments) && value.attachments.length > 0
    const hasQuestionAnswer =
      Boolean(value.questionAnswer?.questionID.trim()) &&
      (Boolean(value.questionAnswer?.freeformText?.trim()) ||
        Boolean(value.questionAnswer?.selectedOptions?.length))

    if (!hasText && !hasAttachments && !hasQuestionAnswer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Body must include a non-empty 'text', a structured question answer, or at least one attachment",
        path: ["text"],
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
export type CreateSessionBody = z.infer<typeof CreateSessionBodySchema>
export type RollbackSessionBody = z.infer<typeof RollbackSessionBodySchema>
export type UpdateSessionWorkflowBody = z.infer<typeof UpdateSessionWorkflowBodySchema>
export type StreamSessionMessageBody = z.infer<typeof StreamSessionMessageBodySchema>
export type SessionEvent = z.infer<typeof SessionEventSchema>
