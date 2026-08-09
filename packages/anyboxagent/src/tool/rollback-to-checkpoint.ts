import z from "zod"
import { Instance } from "#project/instance.ts"
import * as Session from "#session/core/session.ts"
import * as SessionRollback from "#session/core/rollback.ts"
import * as Tool from "#tool/tool.ts"

const Parameters = z.object({
  targetMessageID: z.string().min(1).describe("Message id to branch from. The message must belong to the current session."),
  reason: z.string().min(1).describe("Why the current direction is wrong and should be abandoned."),
  correctivePrompt: z.string().min(1).describe("Instruction that should guide the agent on the new branch."),
  restoreWorkspace: z.boolean().optional().describe(
    "When true, restore tracked workspace files to the nearest snapshot on the rollback path before creating the branch.",
  ),
})

type Parameters = z.infer<typeof Parameters>

function restoreWorkspaceEnabled(parameters: Parameters) {
  return parameters.restoreWorkspace === true
}

function readCurrentTurnID(ctx: Tool.Context) {
  const currentMessage = Session.DataBaseRead("messages", ctx.messageID) as
    | { turnID?: string }
    | null
  return currentMessage?.turnID
}

export const RollbackToCheckpointTool = Tool.define(
  "rollback_to_checkpoint",
  async () => {
    return {
      title: "Rollback to Checkpoint",
      description:
        "Create a corrective conversation branch from an earlier message. Optionally restores workspace files to the nearest recorded snapshot before restarting the loop. If you do not know the exact targetMessageID, first call list_rollback_checkpoints and choose a checkpoint from its returned messageID values.",
      parameters: Parameters,
      validate: (parameters, ctx) => {
        const session = Session.DataBaseRead("sessions", ctx.sessionID) as Session.SessionInfo | null
        if (!session) {
          return `Session '${ctx.sessionID}' was not found.`
        }

        const target = Session.DataBaseRead("messages", parameters.targetMessageID)
        if (!target) {
          return `Rollback target message '${parameters.targetMessageID}' was not found.`
        }

        if (target.sessionID !== ctx.sessionID) {
          return "Rollback target message must belong to the current session."
        }

        if (target.role === "user" && target.internal) {
          return "Internal messages cannot be used as rollback targets."
        }

        if (target.role === "system") {
          return "System messages cannot be used as rollback targets."
        }
      },
      assessPermission: (parameters, ctx) => {
        if (!restoreWorkspaceEnabled(parameters)) {
          return {
            action: "allow",
            risk: "low",
            reason: "Creating a corrective branch only changes the session's active conversation state.",
            allowInPlanning: true,
          }
        }

        return {
          action: "ask",
          risk: "high",
          reason: "Restoring a rollback checkpoint may overwrite or delete tracked workspace files.",
          forceAsk: true,
          resource: {
            workdir: ctx.cwd ?? Instance.directory,
            paths: [ctx.worktree ?? Instance.worktree],
            body: [
              `Target message: ${parameters.targetMessageID}`,
              `Rollback reason: ${parameters.reason.trim()}`,
              `Corrective prompt: ${parameters.correctivePrompt.trim()}`,
            ].join("\n"),
          },
        }
      },
      describeApproval: (parameters, ctx) => ({
        title: "Restore rollback checkpoint",
        summary: "Restore tracked workspace files before creating a corrective conversation branch.",
        details: {
          workdir: ctx.cwd ?? Instance.directory,
          paths: [ctx.worktree ?? Instance.worktree],
          body: [
            `Target message: ${parameters.targetMessageID}`,
            `Rollback reason: ${parameters.reason.trim()}`,
            `Corrective prompt: ${parameters.correctivePrompt.trim()}`,
          ].join("\n"),
        },
      }),
      execute: async (parameters, ctx) => {
        const restoreWorkspace = restoreWorkspaceEnabled(parameters)
        const restore = restoreWorkspace
          ? await SessionRollback.restoreWorkspaceToRollbackSnapshot({
              sessionID: ctx.sessionID,
              targetMessageID: parameters.targetMessageID,
            })
          : undefined

        const branch = await SessionRollback.createCorrectiveBranch({
          sessionID: ctx.sessionID,
          targetMessageID: parameters.targetMessageID,
          reason: parameters.reason,
          correctivePrompt: parameters.correctivePrompt,
          restoreWorkspace: restore,
          turnID: readCurrentTurnID(ctx),
        })

        return {
          title: "Rollback branch created",
          text: [
            "Created a corrective branch and moved the active session head to it.",
            `Target message: ${branch.targetMessage.id}`,
            `Corrective assistant message: ${branch.assistantMessage.id}`,
            restoreWorkspace
              ? `Workspace restored: ${restore?.restoredFiles.length ?? 0} file(s) affected.`
              : "Workspace restore was not requested.",
            "The loop will restart from the corrective branch.",
          ].join("\n"),
          metadata: {
            kind: "workflow-control",
            action: "rollback-to-checkpoint",
            restartLoop: true,
            targetMessageID: branch.targetMessage.id,
            correctiveMessageID: branch.assistantMessage.id,
            restoreWorkspace,
            targetSnapshot: restore?.targetSnapshot,
            preRestoreSnapshot: restore?.preRestoreSnapshot,
            restoredFiles: restore?.restoredFiles ?? [],
          },
          control: {
            mode: "restart-loop",
            reason: "The active session head moved to a corrective branch.",
          },
        }
      },
      toModelOutput: async (result) => {
        const metadata = (result.metadata ?? {}) as Record<string, unknown>
        return {
          type: "json",
          value: {
            kind: "workflow-control",
            action: "rollback-to-checkpoint",
            restartLoop: true,
            targetMessageID:
              typeof metadata.targetMessageID === "string" ? metadata.targetMessageID : undefined,
            correctiveMessageID:
              typeof metadata.correctiveMessageID === "string" ? metadata.correctiveMessageID : undefined,
            restoreWorkspace: metadata.restoreWorkspace === true,
            targetSnapshot:
              typeof metadata.targetSnapshot === "string" ? metadata.targetSnapshot : undefined,
            preRestoreSnapshot:
              typeof metadata.preRestoreSnapshot === "string" ? metadata.preRestoreSnapshot : undefined,
            restoredFiles: Array.isArray(metadata.restoredFiles) ? metadata.restoredFiles : [],
            message: result.text,
          },
        }
      },
    }
  },
  {
    title: "Rollback to Checkpoint",
    aliases: ["rollback-to-checkpoint", "RollbackToCheckpoint"],
    capabilities: {
      kind: "workflow",
      readOnly: false,
      destructive: false,
      concurrency: "exclusive",
    },
  },
)
