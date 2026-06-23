import z from "zod"
import * as Tool from "#tool/tool.ts"
import {
  readTextFile,
  removeResolvedFile,
  resolveToolPath,
  statResolvedPath,
  toDisplayPath,
  writeTextFile,
} from "#tool/shared.ts"

type HunkLine = {
  type: "context" | "add" | "remove"
  text: string
}

type Hunk = {
  anchor?: string
  lines: HunkLine[]
}

type FilePatch = {
  oldPath: string | null
  newPath: string | null
  hunks: Hunk[]
  oldNoNewlineAtEnd?: boolean
  newNoNewlineAtEnd?: boolean
}

type ApplyAction =
  | { kind: "created"; path: string; additions: number; deletions: number }
  | { kind: "updated"; path: string; additions: number; deletions: number }
  | { kind: "deleted"; path: string; additions: number; deletions: number }
  | { kind: "moved"; from: string; to: string; additions: number; deletions: number }
  | { kind: "unchanged"; path: string; additions: number; deletions: number }

type SplitContent = {
  lines: string[]
  newline: "\n" | "\r\n"
  hasFinalNewline: boolean
}

const APPLY_PATCH_FORMAT = [
  "`patch` is a string and must strictly follow this Begin Patch format.",
  "Each tool call accepts exactly one *** Begin Patch / *** End Patch wrapper. Put multiple file changes inside the same wrapper.",
  "",
  "Lark grammar:",
  'start: begin_patch hunk+ end_patch',
  'begin_patch: "*** Begin Patch" LF',
  'end_patch: "*** End Patch" LF?',
  "",
  "hunk: add_hunk | delete_hunk | update_hunk",
  'add_hunk: "*** Add File: " filename LF add_line+',
  'delete_hunk: "*** Delete File: " filename LF',
  'update_hunk: "*** Update File: " filename LF change_move? change?',
  "",
  "filename: /(.+)/",
  'add_line: "+" /(.*)/ LF -> line',
  "",
  'change_move: "*** Move to: " filename LF',
  "change: (change_context | change_line)+ eof_line?",
  'change_context: ("@@" | "@@ " /(.+)/) LF',
  'change_line: ("+" | "-" | " ") /(.*)/ LF',
  'eof_line: "*** End of File" LF',
  "",
  "%import common.LF",
  "",
  "Additional rules:",
  "- The first non-empty line must be *** Begin Patch; the last non-empty line must be *** End Patch.",
  "- Do not output multiple *** Begin Patch blocks in one tool call.",
  "- Every Add File content line must start with +, including blank lines as +.",
  "- Every Update File change line must start with a space, -, or +.",
  "- Update File hunks must include at least one context or removed line; they cannot contain only added lines.",
  "- Delete File does not accept hunks or file content.",
  "- Move files with *** Update File: old/path followed by *** Move to: new/path.",
  "- If the new file should not end with a newline, place *** End of File after the final change line.",
  "- Do not use Git diff syntax: no diff --git, ---, +++, or @@ -1 +1 @@.",
].join("\n")

const APPLY_PATCH_TOOL_DESCRIPTION =
  "Use a single patch block for related, reviewable file changes."

function parsePatchPath(raw: string): string | null {
  let value = raw.trim()

  const tabIndex = value.indexOf("\t")
  if (tabIndex >= 0) {
    value = value.slice(0, tabIndex)
  }

  if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) {
    value = value
      .slice(1, -1)
      .replaceAll("\\\\", "\\")
      .replaceAll("\\\"", "\"")
  }

  if (value === "/dev/null") return null
  if (value.startsWith("a/") || value.startsWith("b/")) value = value.slice(2)

  if (!value) {
    throw new Error("Patch contains an empty file path.")
  }

  return value
}

function oldSequenceOf(hunk: Hunk) {
  return hunk.lines
    .filter((line) => line.type === "context" || line.type === "remove")
    .map((line) => line.text)
}

function newSequenceOf(hunk: Hunk) {
  return hunk.lines
    .filter((line) => line.type === "context" || line.type === "add")
    .map((line) => line.text)
}

function addedLinesOf(hunks: Hunk[]) {
  return hunks.flatMap((hunk) =>
    hunk.lines.filter((line) => line.type === "add").map((line) => line.text)
  )
}

function parsePatchHunkHeader(line: string): Hunk {
  const anchor = line.slice(2).trim()
  return {
    anchor: anchor || undefined,
    lines: [],
  }
}

function parseBeginPatch(patch: string): FilePatch[] {
  type PatchKind = "add" | "update" | "delete"
  type MutableFilePatch = {
    kind: PatchKind
    oldPath: string | null
    newPath: string | null
    hunks: Hunk[]
    oldNoNewlineAtEnd?: boolean
    newNoNewlineAtEnd?: boolean
  }

  const normalized = patch.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")
  const files: FilePatch[] = []

  let index = lines.findIndex((line) => line.trim().length > 0)
  let current: MutableFilePatch | undefined
  let hunk: Hunk | undefined
  let lastLineType: HunkLine["type"] | undefined
  let sawEnd = false

  if (index === -1 || lines[index] !== "*** Begin Patch") {
    throw new Error("Patch must start with *** Begin Patch.")
  }
  index += 1

  const requireCurrent = () => {
    if (!current) {
      throw new Error("Patch content appeared before a file directive.")
    }
    return current
  }

  const finalizeHunk = () => {
    if (!hunk) return
    const filePatch = requireCurrent()

    if (filePatch.kind === "delete") {
      throw new Error(`Delete File for ${filePatch.oldPath} does not accept hunks.`)
    }

    if (filePatch.kind === "add") {
      const invalidLine = hunk.lines.find((line) => line.type !== "add")
      if (invalidLine) {
        throw new Error(`Add File for ${filePatch.newPath} only accepts + lines.`)
      }
    } else if (oldSequenceOf(hunk).length === 0) {
      throw new Error(`Update hunk for ${filePatch.oldPath} must include at least one context or removal line.`)
    }

    filePatch.hunks.push(hunk)
    hunk = undefined
    lastLineType = undefined
  }

  const finalizeFile = () => {
    if (!current) return
    finalizeHunk()

    if (current.kind === "update" && current.oldPath === current.newPath && current.hunks.length === 0) {
      throw new Error(`Update File for ${current.oldPath} must include at least one hunk or a Move to directive.`)
    }

    files.push({
      oldPath: current.oldPath,
      newPath: current.newPath,
      hunks: current.hunks,
      oldNoNewlineAtEnd: current.oldNoNewlineAtEnd,
      newNoNewlineAtEnd: current.newNoNewlineAtEnd,
    })

    current = undefined
  }

  const startFile = (filePatch: MutableFilePatch) => {
    finalizeFile()
    current = filePatch
  }

  while (index < lines.length) {
    const line = lines[index]!

    if (line === "*** End Patch") {
      finalizeFile()
      sawEnd = true
      index += 1
      break
    }

    if (line.startsWith("*** Add File: ")) {
      const path = parsePatchPath(line.slice("*** Add File: ".length))
      if (path === null) throw new Error("Add File directive cannot target /dev/null.")
      startFile({
        kind: "add",
        oldPath: null,
        newPath: path,
        hunks: [],
      })
      hunk = { lines: [] }
      index += 1
      continue
    }

    if (line.startsWith("*** Delete File: ")) {
      const path = parsePatchPath(line.slice("*** Delete File: ".length))
      if (path === null) throw new Error("Delete File directive cannot target /dev/null.")
      startFile({
        kind: "delete",
        oldPath: path,
        newPath: null,
        hunks: [],
      })
      index += 1
      continue
    }

    if (line.startsWith("*** Update File: ")) {
      const path = parsePatchPath(line.slice("*** Update File: ".length))
      if (path === null) throw new Error("Update File directive cannot target /dev/null.")
      startFile({
        kind: "update",
        oldPath: path,
        newPath: path,
        hunks: [],
      })
      index += 1
      continue
    }

    if (line.startsWith("*** Move to: ")) {
      const filePatch = requireCurrent()
      if (filePatch.kind !== "update") {
        throw new Error("*** Move to may only follow an Update File directive.")
      }
      finalizeHunk()
      const path = parsePatchPath(line.slice("*** Move to: ".length))
      if (path === null) throw new Error("Move to directive cannot target /dev/null.")
      if (filePatch.newPath !== filePatch.oldPath) {
        throw new Error(`Patch already contains a move target for ${filePatch.oldPath}.`)
      }
      filePatch.newPath = path
      index += 1
      continue
    }

    if (line === "@@" || line.startsWith("@@ ")) {
      const filePatch = requireCurrent()
      if (filePatch.kind === "add") {
        throw new Error(`Add File for ${filePatch.newPath} does not accept hunk headers.`)
      }
      if (filePatch.kind === "delete") {
        throw new Error(`Delete File for ${filePatch.oldPath} does not accept hunks.`)
      }
      finalizeHunk()
      hunk = parsePatchHunkHeader(line)
      index += 1
      continue
    }

    if (line === "*** End of File" || line === "\\ No newline at end of file") {
      const filePatch = requireCurrent()
      if (!lastLineType) {
        throw new Error(`No newline marker in ${filePatch.oldPath ?? filePatch.newPath} is not attached to a hunk line.`)
      }
      if (lastLineType === "add") filePatch.newNoNewlineAtEnd = true
      else if (lastLineType === "remove") filePatch.oldNoNewlineAtEnd = true
      else {
        filePatch.oldNoNewlineAtEnd = true
        filePatch.newNoNewlineAtEnd = true
      }
      index += 1
      continue
    }

    if (current?.kind === "delete") {
      if (!line.trim()) {
        index += 1
        continue
      }
      throw new Error(`Delete File for ${current.oldPath} does not accept patch content.`)
    }

    if (!hunk) {
      if (!line.trim()) {
        index += 1
        continue
      }
      throw new Error(`Patch line appeared outside a hunk: ${line}`)
    }

    if (line.startsWith(" ")) {
      hunk.lines.push({ type: "context", text: line.slice(1) })
      lastLineType = "context"
      index += 1
      continue
    }
    if (line.startsWith("+")) {
      hunk.lines.push({ type: "add", text: line.slice(1) })
      lastLineType = "add"
      index += 1
      continue
    }
    if (line.startsWith("-")) {
      hunk.lines.push({ type: "remove", text: line.slice(1) })
      lastLineType = "remove"
      index += 1
      continue
    }

    if (current?.kind === "add") {
      throw new Error(`Add File content lines must start with "+", including blank lines as "+". Raw line found: ${line || "<empty line>"}`)
    }

    if (current?.kind === "update") {
      throw new Error(`Update File change lines must start with " ", "-", or "+". Raw line found: ${line || "<empty line>"}`)
    }

    throw new Error(`Invalid patch hunk line: ${line}`)
  }

  if (!sawEnd) {
    throw new Error("Patch must end with *** End Patch.")
  }

  for (; index < lines.length; index += 1) {
    if (lines[index]!.trim()) {
      if (lines[index]!.trim() === "*** Begin Patch") {
        throw new Error("apply_patch accepts exactly one *** Begin Patch / *** End Patch wrapper per call. Put multiple file directives inside one wrapper, or call apply_patch again.")
      }
      throw new Error("Patch contains content after *** End Patch. apply_patch accepts exactly one wrapper per call.")
    }
  }

  if (files.length === 0) {
    throw new Error("Patch does not contain any file changes.")
  }

  return files
}

function splitContent(text: string): SplitContent {
  const newline: "\n" | "\r\n" = text.includes("\r\n") ? "\r\n" : "\n"
  const normalized = text.replace(/\r\n/g, "\n")

  if (!normalized.length) {
    return {
      lines: [],
      newline,
      hasFinalNewline: false,
    }
  }

  const hasFinalNewline = normalized.endsWith("\n")
  const lines = normalized.split("\n")
  if (hasFinalNewline) {
    lines.pop()
  }

  return {
    lines,
    newline,
    hasFinalNewline,
  }
}

function joinContent(content: SplitContent): string {
  if (!content.lines.length) {
    return content.hasFinalNewline ? content.newline : ""
  }

  const body = content.lines.join(content.newline)
  return content.hasFinalNewline ? `${body}${content.newline}` : body
}

function findSequence(sourceLines: string[], sequence: string[], startIndex: number): number {
  for (let index = startIndex; index <= sourceLines.length - sequence.length; index += 1) {
    let matched = true
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (sourceLines[index + offset] !== sequence[offset]) {
        matched = false
        break
      }
    }
    if (matched) return index
  }

  return -1
}

function applyHunks(sourceLines: string[], hunks: Hunk[], label: string): string[] {
  if (hunks.length === 0) return sourceLines.slice()

  const output = sourceLines.slice()
  let cursor = 0

  for (const hunk of hunks) {
    const oldSequence = oldSequenceOf(hunk)
    const newSequence = newSequenceOf(hunk)
    const matchIndex = findSequence(output, oldSequence, cursor)

    if (matchIndex < 0) {
      const anchor = hunk.anchor ? ` near "${hunk.anchor}"` : ""
      throw new Error(`Patch context mismatch in ${label}${anchor}. Could not find expected lines.`)
    }

    output.splice(matchIndex, oldSequence.length, ...newSequence)
    cursor = matchIndex + newSequence.length
  }

  return output
}

function additionsOf(hunks: Hunk[]) {
  return hunks.reduce((count, hunk) => count + hunk.lines.filter((line) => line.type === "add").length, 0)
}

function deletionsOf(hunks: Hunk[]) {
  return hunks.reduce((count, hunk) => count + hunk.lines.filter((line) => line.type === "remove").length, 0)
}

async function pathExists(filepath: string): Promise<boolean> {
  return await statResolvedPath(filepath).then(() => true).catch(() => false)
}

function samePath(left: string, right: string) {
  if (process.platform === "win32") {
    return left.toLowerCase() === right.toLowerCase()
  }
  return left === right
}

function formatAction(action: ApplyAction): string {
  const diffStat = `(+${action.additions} -${action.deletions})`

  if (action.kind === "created") {
    return `created ${action.path} ${diffStat}`
  }
  if (action.kind === "updated") {
    return `updated ${action.path} ${diffStat}`
  }
  if (action.kind === "deleted") {
    return `deleted ${action.path} ${diffStat}`
  }
  if (action.kind === "unchanged") {
    return `unchanged ${action.path} ${diffStat}`
  }
  return `moved ${action.from} -> ${action.to} ${diffStat}`
}

export const ApplyPatchTool = Tool.define(
  "apply_patch",
  async () => {
    return {
      title: "Apply Patch",
      description: APPLY_PATCH_TOOL_DESCRIPTION,
      parameters: z.object({
        patch: z.string().min(1).describe(APPLY_PATCH_FORMAT),
      }),
      describeApproval: (parameters, ctx) => {
        const filePatches = parseBeginPatch(parameters.patch)
        const touched = filePatches.flatMap((filePatch) => [filePatch.oldPath, filePatch.newPath])
          .filter((value): value is string => typeof value === "string" && value.length > 0)
        const uniquePaths = [...new Set(touched)]

        return {
          title: "Apply patch",
          summary: `Apply a patch touching ${uniquePaths.length} file(s).`,
          details: {
            paths: uniquePaths,
            workdir: ctx.cwd,
          },
        }
      },
      execute: async (parameters) => {
        const filePatches = parseBeginPatch(parameters.patch)
        const actions: ApplyAction[] = []

        for (const filePatch of filePatches) {
          if (filePatch.oldPath === null && filePatch.newPath === null) {
            throw new Error("Patch contains an invalid file header with both paths set to /dev/null.")
          }

          if (filePatch.oldPath === null) {
            const targetResolved = resolveToolPath(filePatch.newPath!)
            if (await pathExists(targetResolved)) {
              throw new Error(`Cannot create ${toDisplayPath(targetResolved)} because it already exists.`)
            }

            const updatedLines = addedLinesOf(filePatch.hunks)
            const content: SplitContent = {
              lines: updatedLines,
              newline: "\n",
              hasFinalNewline: filePatch.newNoNewlineAtEnd ? false : updatedLines.length > 0,
            }

            await writeTextFile(filePatch.newPath!, joinContent(content))
            actions.push({
              kind: "created",
              path: toDisplayPath(targetResolved),
              additions: updatedLines.length,
              deletions: 0,
            })
            continue
          }

          if (filePatch.newPath === null) {
            const sourceResolved = resolveToolPath(filePatch.oldPath)
            const originalText = await readTextFile(filePatch.oldPath)
            const source = splitContent(originalText)

            await removeResolvedFile(sourceResolved)
            actions.push({
              kind: "deleted",
              path: toDisplayPath(sourceResolved),
              additions: 0,
              deletions: source.lines.length,
            })
            continue
          }

          const additions = additionsOf(filePatch.hunks)
          const deletions = deletionsOf(filePatch.hunks)
          const sourceResolved = resolveToolPath(filePatch.oldPath)
          const targetResolved = resolveToolPath(filePatch.newPath)
          const rename = !samePath(sourceResolved, targetResolved)

          if (rename && await pathExists(targetResolved)) {
            throw new Error(`Cannot move to ${toDisplayPath(targetResolved)} because it already exists.`)
          }

          const originalText = await readTextFile(filePatch.oldPath)
          const source = splitContent(originalText)
          const updatedLines = applyHunks(source.lines, filePatch.hunks, toDisplayPath(sourceResolved))

          const content: SplitContent = {
            lines: updatedLines,
            newline: source.newline,
            hasFinalNewline: filePatch.newNoNewlineAtEnd ? false : source.hasFinalNewline,
          }
          const updatedText = joinContent(content)

          if (rename) {
            await writeTextFile(filePatch.newPath, updatedText)
            await removeResolvedFile(sourceResolved)
            actions.push({
              kind: "moved",
              from: toDisplayPath(sourceResolved),
              to: toDisplayPath(targetResolved),
              additions,
              deletions,
            })
            continue
          }

          if (updatedText === originalText) {
            actions.push({
              kind: "unchanged",
              path: toDisplayPath(targetResolved),
              additions,
              deletions,
            })
            continue
          }

          await writeTextFile(filePatch.newPath, updatedText)
          actions.push({
            kind: "updated",
            path: toDisplayPath(targetResolved),
            additions,
            deletions,
          })
        }

        return {
          title: "Applied patch",
          text: [
            `Applied patch to ${actions.length} file(s).`,
            "",
            ...actions.map((action) => `- ${formatAction(action)}`),
          ].join("\n"),
        }
      },
    }
  },
  {
    title: "Apply Patch",
    aliases: ["apply-patch"],
    capabilities: {
      kind: "write",
      readOnly: false,
      destructive: true,
      concurrency: "exclusive",
    },
  },
)
