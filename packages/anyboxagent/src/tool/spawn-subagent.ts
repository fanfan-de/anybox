import z from "zod"
import type { JSONValue } from "@ai-sdk/provider"
import * as Tool from "#tool/tool.ts"
import * as Subtask from "#session/tasks/subtask.ts"
import * as Orchestrator from "#session/runtime/orchestrator.ts"
import { renderSubtaskText, toSubtaskModelValue } from "#tool/subagent-shared.ts"

const SpawnSubagentParameters = z.object({
  title: z.string().min(1).max(120).optional().describe("Optional short title for the child session."),
  prompt: z.string().min(1).describe("Delegated task for the subagent."),
  agent: z.string().min(1).optional().describe("Agent profile to use. Defaults to 'default'."),
  model: z
    .object({
      providerID: z.string(),
      modelID: z.string(),
    })
    .optional()
    .describe("Optional provider/model override for the child session."),
  runInBackground: z.boolean().optional().describe("Run asynchronously and return immediately."),
  system: z.string().optional().describe("Extra system guidance appended to the default subagent instructions."),
  skills: z.array(z.string()).optional().describe("Optional skill ids requested for the child session."),
})

export const SpawnSubagentTool = Tool.define(
  "spawn_subagent",
  async () => {
    return {
      title: "Spawn Subagent",
      description: "Create a child session that runs another agent on a delegated task and returns its status or final summary.",
      parameters: SpawnSubagentParameters,
      describeApproval: (parameters) => ({
        title: parameters.title?.trim() || "Spawn subagent",
        summary: `Start a child agent session using '${parameters.agent?.trim() || "default"}'.`,
        details: {
          body: parameters.prompt,
        },
      }),
      execute: async (parameters, ctx) => {
        const task = await Subtask.startSubtask({
          parentSessionID: ctx.sessionID,
          parentMessageID: ctx.messageID,
          parentToolCallID: ctx.toolCallID,
          title: parameters.title,
          prompt: parameters.prompt,
          agent: parameters.agent ?? "default",
          model: parameters.model,
          runInBackground: parameters.runInBackground,
          system: parameters.system,
          skills: parameters.skills,
        }, {
          onStarted: (subtask) => {
            Orchestrator.activeTurn(ctx.sessionID, ctx.turnID)?.emit("subagent.created", {
              taskID: subtask.id,
              childSessionID: subtask.childSessionID,
              title: subtask.title,
              agent: subtask.agent,
              status: subtask.status,
              updatedAt: subtask.updatedAt,
            })
          },
        })

        return {
          title: task.title,
          text: renderSubtaskText(task),
          metadata: {
            ...toSubtaskModelValue(task, {
              action: "spawn",
              instruction:
                task.runInBackground && task.status === "running"
                  ? "You may continue other work. Use wait_subagent when you need the result, or read_subagent to inspect progress. A <runtime_event type=\"subagent.completed\"> notification will also arrive when the background subagent completes."
                  : undefined,
            }),
          },
        }
      },
      toModelOutput: async (result) => ({
        type: "json",
        value: {
          ...(result.metadata as Record<string, unknown>),
        } as JSONValue,
      }),
    }
  },
  {
    title: "Spawn Subagent",
    aliases: ["spawn-subagent"],
    capabilities: {
      kind: "delegation",
      readOnly: false,
      destructive: false,
      concurrency: "safe",
    },
  },
)
