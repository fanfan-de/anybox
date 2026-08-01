import { describe, expect, it } from "vitest"
import type {
  ComposerCommentReference,
  ComposerMcpOption,
  ComposerPluginOption,
  ComposerSkillOption,
  ComposerToolModuleOption,
} from "../types"
import {
  appendComposerTagToDraftState,
  appendTextToComposerDraftState,
  compileComposerSubmission,
  createComposerCommentTagData,
  createComposerDraftStateFromPlainText,
  createComposerFileTagData,
  createComposerLongTextTagData,
  createComposerMcpTagData,
  createComposerPluginTagData,
  createComposerSkillTagData,
  createComposerToolModuleTagData,
  createEmptyComposerDraftState,
  readTaggedPluginIDsFromDraftState,
  readComposerTagsFromDraftState,
  removeComposerTagFromDraftState,
  updateComposerLongTextTagInDraftState,
} from "./draft-state"

const SKILL_OPTION: ComposerSkillOption = {
  value: "build-web-apps:react-best-practices",
  label: "React Best Practices",
  description: "Review React component structure and performance",
}

const MCP_OPTIONS: ComposerMcpOption[] = [
  {
    value: "filesystem",
    label: "Filesystem",
    description: "Browse and inspect local files",
  },
  {
    value: "browser",
    label: "Browser",
    description: "Automate browser verification",
  },
]

const PLUGIN_OPTION: ComposerPluginOption = {
  value: "build-web-apps",
  label: "Build Web Apps",
  description: "Frontend app tools and skills",
}

const TOOL_MODULE_OPTION: ComposerToolModuleOption = {
  value: "planner.core",
  label: "计划",
  description: "Load Planner tools for this message only",
}

function createCommentReference(): ComposerCommentReference {
  return {
    source: "file",
    id: "comment-1",
    filePath: "src/App.tsx",
    startLineNumber: 10,
    endLineNumber: 14,
    label: "App.tsx:10-14",
    title: "src/App.tsx (lines 10-14)",
    prompt: "Review the selected lines before making changes.",
  }
}

function createPreviewInteractionReference(): ComposerCommentReference {
  return {
    source: "preview",
    id: "preview-interaction-1",
    label: "preview:localhost:5174#1",
    title: "button.cta - http://localhost:5174/",
    prompt: "Preview feedback for http://localhost:5174/",
    pageUrl: "http://localhost:5174/",
    interaction: {
      createdAt: 1,
      id: "preview-interaction-1",
      pluginID: "web.comment",
      renderer: "url-webview",
      targetKey: "http://localhost:5174/",
      payload: {
        kind: "web-comment",
        pageUrl: "http://localhost:5174/",
        x: 42,
        y: 35,
        text: "The CTA overlaps the header.",
        frame: "iframe",
        nodePosition: "42%, 35%; target rect 120, 80, 240x48",
        screenshotPath: "C:\\Users\\codex\\preview-comment-screenshots\\marker.png",
        anchor: {
          type: "element",
          label: "button.cta",
          selector: "button.cta",
          path: "html > body > main > button:nth-of-type(1)",
          rect: {
            height: 48,
            left: 120,
            top: 80,
            width: 240,
          },
          tagName: "button",
          text: "Launch",
        },
      },
    },
  }
}

describe("composer draft-state", () => {
  it("serializes tags and plain text into a compiled submission", () => {
    let draftState = createComposerDraftStateFromPlainText("Implement the composer with Lexical.")
    draftState = appendComposerTagToDraftState(draftState, createComposerFileTagData("src/app/components.tsx"))
    draftState = appendComposerTagToDraftState(draftState, createComposerCommentTagData(createCommentReference()))
    draftState = appendComposerTagToDraftState(draftState, createComposerSkillTagData(SKILL_OPTION))
    draftState = appendComposerTagToDraftState(draftState, createComposerMcpTagData(MCP_OPTIONS[0]!))
    draftState = appendComposerTagToDraftState(draftState, createComposerPluginTagData(PLUGIN_OPTION))
    draftState = appendComposerTagToDraftState(draftState, createComposerToolModuleTagData(TOOL_MODULE_OPTION))

    const compiled = compileComposerSubmission({
      draftState,
      selectedSkillIDs: ["existing-skill"],
    })

    expect(compiled.displayText).toContain("Implement the composer with Lexical.")
    expect(compiled.displayText).toContain("@src/app/components.tsx")
    expect(compiled.displayText).toContain("@App.tsx:10-14")
    expect(compiled.taggedFilePaths).toEqual(["src/app/components.tsx"])
    expect(compiled.taggedMcpServerIDs).toEqual(["filesystem"])
    expect(compiled.taggedPluginIDs).toEqual(["build-web-apps"])
    expect(compiled.taggedToolModuleIDs).toEqual(["planner.core"])
    expect(compiled.transportText).not.toContain("@计划")
    expect(compiled.commentReferences).toHaveLength(1)
    expect(compiled.userReferences).toEqual([
      {
        id: "file:src/app/components.tsx",
        kind: "file",
        label: "src/app/components.tsx",
        title: "src/app/components.tsx",
      },
      {
        id: "comment-1",
        kind: "comment",
        label: "App.tsx:10-14",
        title: "src/App.tsx (lines 10-14)",
      },
    ])
    expect(compiled.selectedSkillIDs).toEqual(["existing-skill", SKILL_OPTION.value])
    expect(compiled.transportText).toContain("Referenced files:\n- src/app/components.tsx")
    expect(compiled.transportText).toContain("Review the selected lines before making changes.")
  })

  it("compiles explicit Planner shortcuts into a turn-scoped tool module", () => {
    for (const shortcut of ["@计划", "/计划", "/planner"]) {
      const compiled = compileComposerSubmission({
        draftState: createComposerDraftStateFromPlainText(`${shortcut} 安排今天的待办`),
      })

      expect(compiled.taggedToolModuleIDs).toEqual(["planner.core"])
      expect(compiled.transportText).toBe("安排今天的待办")
      expect(compiled.displayText).toContain(shortcut)
    }
  })

  it("reads plugin tags from the composer draft state", () => {
    let draftState = createComposerDraftStateFromPlainText("Use this integration.")
    draftState = appendComposerTagToDraftState(draftState, createComposerPluginTagData(PLUGIN_OPTION))

    expect(readTaggedPluginIDsFromDraftState(draftState)).toEqual(["build-web-apps"])
    expect(draftState.plainText).toContain("@Build Web Apps")
  })

  it("compiles long text tags into full display and transport text", () => {
    const longText = Array.from({ length: 20 }, (_, index) => `Line ${index + 1}: pasted implementation notes`).join("\n")
    let draftState = createComposerDraftStateFromPlainText("Use this context:")
    draftState = appendComposerTagToDraftState(draftState, createComposerLongTextTagData(longText, "long-text:test"))

    const compiled = compileComposerSubmission({ draftState })

    expect(draftState.plainText).toContain("@Long text")
    expect(draftState.plainText).not.toContain("Line 20: pasted implementation notes")
    expect(compiled.displayText).toContain("Use this context:")
    expect(compiled.displayText).toContain(longText)
    expect(compiled.displayText).not.toContain("@Long text")
    expect(compiled.transportText).toContain(longText)
  })

  it("updates and removes long text tags without affecting other tags", () => {
    const firstLongText = Array.from({ length: 18 }, (_, index) => `Original line ${index + 1}`).join("\n")
    const nextLongText = "Shorter edited pasted text."
    let draftState = createEmptyComposerDraftState()
    draftState = appendComposerTagToDraftState(draftState, createComposerSkillTagData(SKILL_OPTION))
    draftState = appendComposerTagToDraftState(draftState, createComposerLongTextTagData(firstLongText, "long-text:test"))

    const updatedDraftState = updateComposerLongTextTagInDraftState(draftState, "long-text:test", nextLongText)
    const updatedTags = readComposerTagsFromDraftState(updatedDraftState)

    expect(updatedTags).toHaveLength(2)
    expect(updatedTags[0]).toMatchObject({ kind: "skill", skillID: SKILL_OPTION.value })
    expect(updatedTags[1]).toMatchObject({
      kind: "long-text",
      id: "long-text:test",
      text: nextLongText,
      characterCount: nextLongText.length,
    })

    const removedDraftState = removeComposerTagFromDraftState(updatedDraftState, "long-text:test")
    const remainingTags = readComposerTagsFromDraftState(removedDraftState)
    expect(remainingTags).toHaveLength(1)
    expect(remainingTags[0]).toMatchObject({ kind: "skill", skillID: SKILL_OPTION.value })
  })

  it("compiles preview comment tags into browser context while stripping the visible token from the request", () => {
    const previewReference = createPreviewInteractionReference()
    let draftState = createComposerDraftStateFromPlainText("Please fix the header.")
    draftState = appendComposerTagToDraftState(draftState, createComposerCommentTagData(previewReference))

    const compiled = compileComposerSubmission({ draftState })

    expect(compiled.displayText).toContain("@preview:localhost:5174#1")
    expect(compiled.transportText).not.toContain("@preview:localhost:5174#1")
    expect(compiled.transportText).toContain("# Diff comments:")
    expect(compiled.transportText).toContain("Node position: 42%, 35%; target rect 120, 80, 240x48")
    expect(compiled.transportText).toContain("Page URL: http://localhost:5174/")
    expect(compiled.transportText).toContain("Frame: iframe")
    expect(compiled.transportText).toContain("Target: button.cta")
    expect(compiled.transportText).toContain("Target selector: button.cta")
    expect(compiled.transportText).toContain("Target path: html > body > main > button:nth-of-type(1)")
    expect(compiled.transportText).toContain(
      "Saved marker screenshot: C:\\Users\\codex\\preview-comment-screenshots\\marker.png",
    )
    expect(compiled.transportText).toContain("Comment:\nThe CTA overlaps the header.")
    expect(compiled.transportText).toContain("# In app browser:")
    expect(compiled.transportText).toContain("- Current URL: http://localhost:5174/")
    expect(compiled.transportText).toContain("## User request:\nPlease fix the header.")
  })

  it("keeps file tag labels short while compiling absolute file paths into transport text", () => {
    const absolutePath = "C:\\Projects\\Atlas\\frontend\\src\\angry-birds.js"
    let draftState = createEmptyComposerDraftState()
    draftState = appendComposerTagToDraftState(draftState, createComposerFileTagData(absolutePath, "src/angry-birds.js"))

    const compiled = compileComposerSubmission({ draftState })

    expect(compiled.displayText).toContain("@src/angry-birds.js")
    expect(compiled.taggedFilePaths).toEqual([absolutePath])
    expect(compiled.userReferences).toEqual([
      {
        id: `file:${absolutePath}`,
        kind: "file",
        label: "src/angry-birds.js",
        title: absolutePath,
      },
    ])
    expect(compiled.transportText).toContain(`Referenced files:\n- ${absolutePath}`)
  })

  it("adds plain text in a new paragraph without dropping existing tags", () => {
    let draftState = createEmptyComposerDraftState()
    draftState = appendComposerTagToDraftState(draftState, createComposerSkillTagData(SKILL_OPTION))
    draftState = appendTextToComposerDraftState(draftState, "Add command menus next.")

    const tags = readComposerTagsFromDraftState(draftState)
    expect(tags).toHaveLength(1)
    expect(tags[0]).toMatchObject({
      kind: "skill",
      skillID: SKILL_OPTION.value,
    })
    expect(draftState.plainText).toContain("@React Best Practices")
    expect(draftState.plainText).toContain("Add command menus next.")
  })

  it("preserves trailing spaces while editing but trims them when compiling", () => {
    const draftState = createComposerDraftStateFromPlainText("Prompt before space ")
    const compiled = compileComposerSubmission({ draftState })

    expect(draftState.plainText).toBe("Prompt before space ")
    expect(compiled.displayText).toBe("Prompt before space")
  })

  it("removes a comment tag by reference id", () => {
    const commentReference = createCommentReference()
    let draftState = createComposerDraftStateFromPlainText("Need feedback.")
    draftState = appendComposerTagToDraftState(draftState, createComposerCommentTagData(commentReference))

    const nextDraftState = removeComposerTagFromDraftState(draftState, commentReference.id)

    expect(readComposerTagsFromDraftState(nextDraftState)).toEqual([])
    expect(nextDraftState.plainText).toBe("Need feedback.")
  })

})
