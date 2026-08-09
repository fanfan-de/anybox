import type { JSONValue } from "@ai-sdk/provider"
import z from "zod"
import * as Tool from "#tool/tool.ts"
import { readResolvedTextFileRange, resolveReadableTextFilePath, statResolvedPath, toDisplayPath } from "#tool/shared.ts"
import { Instance } from "#project/instance.ts"

const DEFAULT_MAX_LINES = 250
const MAX_LINES = 2000
const DEFAULT_MAX_OUTPUT_CHARS = 25_000
const MAX_OUTPUT_CHARS = 50_000
const RESERVED_MULTIMODAL_KINDS = ["image", "pdf", "notebook", "parts"] as const

const ReadFileParameters = z.object({
  file_path: z.string().min(1).optional().describe("Absolute or project-relative file path."),
  path: z.string().min(1).optional().describe("Deprecated alias for file_path."),
  startLine: z.number().int().positive().optional().describe("First line to read, starting at 1."),
  endLine: z.number().int().positive().optional().describe("Last line to read, starting at 1."),
  maxLines: z.number().int().positive().max(MAX_LINES).optional().describe("Maximum lines to return."),
  maxOutputChars: z.number().int().positive().max(MAX_OUTPUT_CHARS).optional().describe("Maximum content characters to return."),
}).superRefine((value, ctx) => {
  if (!value.file_path && !value.path) {
    ctx.addIssue({
      code: "custom",
      path: ["file_path"],
      message: "file_path is required.",
    })
  }

  if (value.file_path && value.path && value.file_path !== value.path) {
    ctx.addIssue({
      code: "custom",
      path: ["file_path"],
      message: "file_path and path must match when both are provided.",
    })
  }

  if (value.startLine != null && value.endLine != null && value.endLine < value.startLine) {
    ctx.addIssue({
      code: "custom",
      path: ["endLine"],
      message: "endLine must be greater than or equal to startLine.",
    })
  }
})

type ReadFileParameters = z.infer<typeof ReadFileParameters>

function displayPath(resolvedPath: string) {
  return Instance.containsPath(resolvedPath) ? toDisplayPath(resolvedPath) : resolvedPath
}

function normalizeParameters(parameters: ReadFileParameters) {
  return {
    filePath: parameters.file_path ?? parameters.path ?? "",
    startLine: parameters.startLine ?? 1,
    requestedEndLine: parameters.endLine,
    maxLines: parameters.maxLines,
    maxOutputChars: parameters.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS,
  }
}

function computeEffectiveEndLine(parameters: ReturnType<typeof normalizeParameters>) {
  const defaultEndLine = parameters.startLine + DEFAULT_MAX_LINES - 1
  const requestedEndLine = parameters.requestedEndLine ?? defaultEndLine
  const lineBudget = Math.min(parameters.maxLines ?? MAX_LINES, MAX_LINES)
  const budgetEndLine = parameters.startLine + lineBudget - 1
  return Math.min(requestedEndLine, budgetEndLine)
}

function truncateContent(content: string, maxChars: number) {
  if (content.length <= maxChars) {
    return {
      content,
      truncated: false,
    }
  }

  return {
    content: content.slice(0, maxChars),
    truncated: true,
  }
}

export const ReadFileTool = Tool.define(
  "read_file",
  async () => {
    return {
      title: "Read File",
      description: "Read a text file or a line range. Supports absolute paths and project-relative paths.",
      parameters: ReadFileParameters,
      describeApproval: (parameters, ctx) => {
        const normalized = normalizeParameters(parameters)
        const resolved = resolveReadableTextFilePath(normalized.filePath)
        const lines = parameters.startLine != null
          ? parameters.endLine != null
            ? `lines ${parameters.startLine}-${parameters.endLine}`
            : `starting at line ${parameters.startLine}`
          : "file contents"

        return {
          title: `Read ${displayPath(resolved)}`,
          summary: `Read ${lines} from ${displayPath(resolved)}.`,
          details: {
            paths: [displayPath(resolved)],
            workdir: ctx.cwd,
          },
        }
      },
      execute: async (parameters): Promise<Tool.ToolOutput<Record<string, unknown>, Record<string, unknown>>> => {
        const normalized = normalizeParameters(parameters)
        const resolved = resolveReadableTextFilePath(normalized.filePath)
        const startLine = normalized.startLine
        const hasExplicitEndLine = normalized.requestedEndLine != null
        const requestedEndLine = normalized.requestedEndLine ?? startLine + DEFAULT_MAX_LINES - 1
        const endLine = computeEffectiveEndLine(normalized)
        const excerpt = await readResolvedTextFileRange(resolved, startLine, endLine)
        const info = await statResolvedPath(resolved)
        const hasMoreLinesAfterRange = !excerpt.outOfRange && excerpt.totalLines > excerpt.endLine
        const truncatedByLineBudget = requestedEndLine > endLine || (!hasExplicitEndLine && hasMoreLinesAfterRange)
        const truncatedContent = truncateContent(excerpt.rendered || "", normalized.maxOutputChars)
        const truncated = truncatedByLineBudget || truncatedContent.truncated
        const display = displayPath(resolved)
        const data = {
          kind: "text",
          path: resolved,
          displayPath: display,
          file: {
            sizeBytes: info.size,
            mtimeMs: info.mtimeMs,
          },
          range: {
            startLine: excerpt.startLine,
            endLine: excerpt.endLine,
            requestedEndLine,
            totalLines: excerpt.totalLines,
            hasMoreLinesAfterRange,
            outOfRange: excerpt.outOfRange,
          },
          budget: {
            maxLines: Math.min(normalized.maxLines ?? MAX_LINES, MAX_LINES),
            maxOutputChars: normalized.maxOutputChars,
            outputChars: truncatedContent.content.length,
            truncated,
            truncatedByLineBudget,
            truncatedByCharBudget: truncatedContent.truncated,
            resultPersistence: "disabled",
          },
          contentFormat: "numbered-lines",
          content: truncatedContent.content || (excerpt.outOfRange ? "" : "(empty file)"),
          supportedKinds: ["text"],
          reservedKinds: RESERVED_MULTIMODAL_KINDS,
        }

        return {
          title: `Read ${display}`,
          text: [
            `Path: ${display}`,
            `Lines: ${excerpt.startLine}-${excerpt.endLine} of ${excerpt.totalLines}`,
            excerpt.outOfRange ? "Note: the requested line range starts beyond the end of the file." : undefined,
            truncatedByLineBudget ? "Note: line output was truncated. Use startLine/endLine/maxLines to inspect more." : undefined,
            truncatedContent.truncated ? "Note: content output was truncated by maxOutputChars." : undefined,
            "",
            data.content,
          ].filter(Boolean).join("\n"),
          metadata: data,
          data,
          result: excerpt.outOfRange ? "negative" : "success",
          completeness: truncated ? "partial" : "complete",
          sideEffect: "none",
          retry: "safe",
        }
      },
      toModelOutput: (result) => ({
        type: "json" as const,
        value: (result.data ?? result.metadata ?? { text: result.text }) as JSONValue,
      }),
    }
  },
  {
    title: "Read File",
    aliases: ["read-file"],
    maxResultSizeChars: Infinity,
    capabilities: {
      kind: "read",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    },
  },
)
