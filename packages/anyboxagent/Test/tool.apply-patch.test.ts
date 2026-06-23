import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import "./sqlite.cleanup.ts"
import { Instance } from "#project/instance.ts"
import { ApplyPatchTool } from "#tool/apply-patch.ts"

const EXPECTED_APPLY_PATCH_FORMAT = [
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

async function withApplyPatchTool(
  fn: (input: {
    root: string
    executePatch: (patch: string) => Promise<unknown>
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), "anybox-apply-patch-"))

  try {
    await Instance.provide({
      directory: root,
      async fn() {
        const runtime = await ApplyPatchTool.init()
        const ctx = {
          sessionID: "session-apply-patch",
          messageID: "message-apply-patch",
        }

        await fn({
          root,
          executePatch: async (patch) => await runtime.execute({ patch }, ctx),
        })
      },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe("apply_patch Begin Patch format", () => {
  it("keeps the top-level tool description compact and schema field description detailed", async () => {
    const runtime = await ApplyPatchTool.init()
    const patchDescription = runtime.parameters.shape.patch.description

    expect(runtime.description).toBe("Use a single patch block for related, reviewable file changes.")
    expect(runtime.description).not.toContain("replace_text")
    expect(runtime.description).not.toContain("Lark grammar")
    expect(runtime.description).not.toContain("start: begin_patch")
    expect(patchDescription).toBe(EXPECTED_APPLY_PATCH_FORMAT)
  })

  it("updates a file using context instead of line numbers", async () => {
    await withApplyPatchTool(async ({ root, executePatch }) => {
      const target = path.join(root, "notes.txt")
      await writeFile(target, "alpha\nbeta\ngamma\n", "utf8")

      const result = await executePatch([
        "*** Begin Patch",
        "*** Update File: notes.txt",
        "@@ greeting block",
        " alpha",
        "-beta",
        "+bravo",
        " gamma",
        "*** End Patch",
      ].join("\n"))

      expect(await readFile(target, "utf8")).toBe("alpha\nbravo\ngamma\n")
      expect(result).toMatchObject({
        title: "Applied patch",
      })
    })
  })

  it("applies multiple hunks in order", async () => {
    await withApplyPatchTool(async ({ root, executePatch }) => {
      const target = path.join(root, "list.txt")
      await writeFile(target, "one\ntwo\nthree\nfour\n", "utf8")

      await executePatch([
        "*** Begin Patch",
        "*** Update File: list.txt",
        "@@ first item",
        "-one",
        "+ONE",
        " two",
        "@@ later item",
        " three",
        "-four",
        "+FOUR",
        "*** End Patch",
      ].join("\n"))

      expect(await readFile(target, "utf8")).toBe("ONE\ntwo\nthree\nFOUR\n")
    })
  })

  it("updates the first match when context repeats", async () => {
    await withApplyPatchTool(async ({ root, executePatch }) => {
      const target = path.join(root, "repeat.txt")
      await writeFile(target, "start\nold\nend\nstart\nold\nend\n", "utf8")

      await executePatch([
        "*** Begin Patch",
        "*** Update File: repeat.txt",
        "@@ repeated block",
        " start",
        "-old",
        "+new",
        " end",
        "*** End Patch",
      ].join("\n"))

      expect(await readFile(target, "utf8")).toBe("start\nnew\nend\nstart\nold\nend\n")
    })
  })

  it("creates files with Add File", async () => {
    await withApplyPatchTool(async ({ root, executePatch }) => {
      const target = path.join(root, "generated.txt")

      await executePatch([
        "*** Begin Patch",
        "*** Add File: generated.txt",
        "+alpha",
        "+beta",
        "*** End Patch",
      ].join("\n"))

      expect(await readFile(target, "utf8")).toBe("alpha\nbeta\n")
    })
  })

  it("creates files without a final newline using End of File", async () => {
    await withApplyPatchTool(async ({ root, executePatch }) => {
      const target = path.join(root, "no-newline.txt")

      await executePatch([
        "*** Begin Patch",
        "*** Add File: no-newline.txt",
        "+alpha",
        "*** End of File",
        "*** End Patch",
      ].join("\n"))

      expect(await readFile(target, "utf8")).toBe("alpha")
    })
  })

  it("deletes files with Delete File", async () => {
    await withApplyPatchTool(async ({ root, executePatch }) => {
      const target = path.join(root, "obsolete.txt")
      await writeFile(target, "remove me\n", "utf8")

      await executePatch([
        "*** Begin Patch",
        "*** Delete File: obsolete.txt",
        "*** End Patch",
      ].join("\n"))

      expect(existsSync(target)).toBe(false)
    })
  })

  it("moves and edits files in one patch", async () => {
    await withApplyPatchTool(async ({ root, executePatch }) => {
      const oldTarget = path.join(root, "old.txt")
      const newTarget = path.join(root, "new.txt")
      await writeFile(oldTarget, "before\nkeep\n", "utf8")

      await executePatch([
        "*** Begin Patch",
        "*** Update File: old.txt",
        "*** Move to: new.txt",
        "@@ moved content",
        "-before",
        "+after",
        " keep",
        "*** End Patch",
      ].join("\n"))

      expect(existsSync(oldTarget)).toBe(false)
      expect(await readFile(newTarget, "utf8")).toBe("after\nkeep\n")
    })
  })

  it("rejects old Git unified diff input", async () => {
    await withApplyPatchTool(async ({ executePatch }) => {
      await expect(executePatch([
        "diff --git a/notes.txt b/notes.txt",
        "--- a/notes.txt",
        "+++ b/notes.txt",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"))).rejects.toThrow("Patch must start with *** Begin Patch.")
    })
  })

  it("explains Add File lines must use + prefixes", async () => {
    await withApplyPatchTool(async ({ executePatch }) => {
      await expect(executePatch([
        "*** Begin Patch",
        "*** Add File: go.html",
        "<!DOCTYPE html>",
        "*** End Patch",
      ].join("\n"))).rejects.toThrow('Add File content lines must start with "+"')
    })
  })

  it("rejects patches without an end marker", async () => {
    await withApplyPatchTool(async ({ executePatch }) => {
      await expect(executePatch([
        "*** Begin Patch",
        "*** Update File: notes.txt",
        "@@",
        "-old",
        "+new",
      ].join("\n"))).rejects.toThrow("Patch must end with *** End Patch.")
    })
  })

  it("rejects multiple Begin Patch wrappers with an actionable message", async () => {
    await withApplyPatchTool(async ({ executePatch }) => {
      await expect(executePatch([
        "*** Begin Patch",
        "*** Add File: one.txt",
        "+one",
        "*** End Patch",
        "*** Begin Patch",
        "*** Add File: two.txt",
        "+two",
        "*** End Patch",
      ].join("\n"))).rejects.toThrow("accepts exactly one *** Begin Patch / *** End Patch wrapper per call")
    })
  })

  it("rejects add-only update hunks", async () => {
    await withApplyPatchTool(async ({ root, executePatch }) => {
      await writeFile(path.join(root, "notes.txt"), "alpha\n", "utf8")

      await expect(executePatch([
        "*** Begin Patch",
        "*** Update File: notes.txt",
        "@@",
        "+inserted",
        "*** End Patch",
      ].join("\n"))).rejects.toThrow("must include at least one context or removal line")
    })
  })

  it("rejects Delete File patch content", async () => {
    await withApplyPatchTool(async ({ executePatch }) => {
      await expect(executePatch([
        "*** Begin Patch",
        "*** Delete File: notes.txt",
        "@@",
        "-old",
        "*** End Patch",
      ].join("\n"))).rejects.toThrow("does not accept hunks")
    })
  })

  it("rejects missing update context", async () => {
    await withApplyPatchTool(async ({ root, executePatch }) => {
      await writeFile(path.join(root, "notes.txt"), "alpha\n", "utf8")

      await expect(executePatch([
        "*** Begin Patch",
        "*** Update File: notes.txt",
        "@@ missing",
        "-beta",
        "+bravo",
        "*** End Patch",
      ].join("\n"))).rejects.toThrow("Patch context mismatch")
    })
  })
})
