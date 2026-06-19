import type { LexicalEditor } from "lexical"
import { describe, expect, it, vi } from "vitest"
import {
  buildMenuStyle,
  createComposerPastedImageAttachments,
  formatComposerAbsoluteFilePath,
  getVisibleComposerCommandLabels,
  getComposerKeyAction,
  handleComposerCommandMenuMouseDown,
  readComposerClipboardImageFiles,
  readComposerBeforeTextForCommandMenu,
  shouldApplyExternalComposerDraftState,
} from "./Composer"
import { createComposerDraftStateFromPlainText } from "./draft-state"

function createEditorStateMock(lexicalJSON: string) {
  const json = JSON.parse(lexicalJSON)

  return {
    getEditorState() {
      return {
        toJSON() {
          return json
        },
      }
    },
  } as Pick<LexicalEditor, "getEditorState">
}

describe("shouldApplyExternalComposerDraftState", () => {
  it("skips reapplying a draft state that already matches the current editor contents", () => {
    const draftState = createComposerDraftStateFromPlainText("Keep the local composer selection intact")

    expect(shouldApplyExternalComposerDraftState(createEditorStateMock(draftState.lexicalJSON), draftState.lexicalJSON)).toBe(false)
  })

  it("skips local draft echoes before comparing editor contents", () => {
    const staleEditorState = createComposerDraftStateFromPlainText("Prompt before space")
    const localDraftState = createComposerDraftStateFromPlainText("Prompt before space ")
    const localEchoes = new Set([localDraftState.lexicalJSON])

    expect(
      shouldApplyExternalComposerDraftState(
        createEditorStateMock(staleEditorState.lexicalJSON),
        localDraftState.lexicalJSON,
        { localDraftEchoes: localEchoes },
      ),
    ).toBe(false)
    expect(localEchoes.has(localDraftState.lexicalJSON)).toBe(true)
  })

  it("skips the latest local editor draft even if the current editor snapshot is stale", () => {
    const staleEditorState = createComposerDraftStateFromPlainText("Prompt before space")
    const localDraftState = createComposerDraftStateFromPlainText("Prompt before space ")

    expect(
      shouldApplyExternalComposerDraftState(
        createEditorStateMock(staleEditorState.lexicalJSON),
        localDraftState.lexicalJSON,
        { localLexicalJSON: localDraftState.lexicalJSON },
      ),
    ).toBe(false)
  })

  it("applies external draft changes when the serialized editor state differs", () => {
    const currentDraftState = createComposerDraftStateFromPlainText("Current draft")
    const nextDraftState = createComposerDraftStateFromPlainText("Current draft plus external update")

    expect(shouldApplyExternalComposerDraftState(createEditorStateMock(currentDraftState.lexicalJSON), nextDraftState.lexicalJSON)).toBe(true)
  })
})

describe("buildMenuStyle", () => {
  it("positions the command menu above the active composer selection", () => {
    const anchorRect = {
      left: 196,
      top: 412,
    } as DOMRect
    const containerRect = {
      left: 140,
      bottom: 620,
    } as DOMRect

    expect(buildMenuStyle(anchorRect, containerRect)).toEqual({
      left: "56px",
      bottom: "218px",
    })
  })
})

describe("readComposerBeforeTextForCommandMenu", () => {
  it("returns the visible prefix for regular text nodes", () => {
    const anchorNode = {
      getTextContent() {
        return "@world-of-goo.js"
      },
      isToken() {
        return false
      },
    }

    expect(readComposerBeforeTextForCommandMenu(anchorNode, "@world-of-goo.js".length)).toBe("@world-of-goo.js")
  })

  it("ignores token nodes so tag boundary selections do not keep menus open", () => {
    const anchorNode = {
      getTextContent() {
        return "@world-of-goo.js"
      },
      isToken() {
        return true
      },
    }

    expect(readComposerBeforeTextForCommandMenu(anchorNode, "@world-of-goo.js".length)).toBeNull()
  })
})

describe("formatComposerAbsoluteFilePath", () => {
  it("preserves the absolute file path for menu display", () => {
    expect(formatComposerAbsoluteFilePath("C:\\Projects\\Atlas\\games\\angry-birds.html")).toBe(
      "C:\\Projects\\Atlas\\games\\angry-birds.html",
    )
  })
})

describe("readComposerClipboardImageFiles", () => {
  it("extracts image files from clipboard items before falling back to file lists", () => {
    const imageFile = new File(["image"], "screenshot.png", { type: "image/png" })
    const fallbackImageFile = new File(["fallback"], "fallback.jpg", { type: "image/jpeg" })

    const files = readComposerClipboardImageFiles({
      items: [
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => imageFile,
        },
      ] as unknown as DataTransferItemList,
      files: [fallbackImageFile] as unknown as FileList,
    })

    expect(files).toEqual([imageFile])
  })

  it("converts pasted image files into data-url attachments", async () => {
    const imageFile = new File(["image"], "screenshot.png", { type: "image/png" })

    await expect(createComposerPastedImageAttachments([imageFile])).resolves.toEqual([
      {
        dataUrl: "data:image/png;base64,aW1hZ2U=",
        mimeType: "image/png",
        name: "screenshot.png",
      },
    ])
  })
})

describe("getComposerKeyAction", () => {
  it("uses Enter to select the active command when the menu has options", () => {
    expect(
      getComposerKeyAction({
        key: "Enter",
        isSubmitKeyEvent: true,
        hasCommandMenu: true,
        commandMenuItemCount: 4,
      }),
    ).toEqual({
      type: "select-active",
      preventDefault: true,
    })
  })

  it("blocks Enter from sending while a visible menu has no available options", () => {
    expect(
      getComposerKeyAction({
        key: "Enter",
        isSubmitKeyEvent: true,
        hasCommandMenu: true,
        commandMenuItemCount: 0,
      }),
    ).toEqual({
      type: "noop",
      preventDefault: true,
    })
  })

  it("keeps arrow navigation passive when the visible menu is empty", () => {
    expect(
      getComposerKeyAction({
        key: "ArrowDown",
        isSubmitKeyEvent: false,
        hasCommandMenu: true,
        commandMenuItemCount: 0,
      }),
    ).toEqual({
      type: "noop",
      preventDefault: false,
    })
  })

  it("preserves Enter-to-send when no command menu is visible", () => {
    expect(
      getComposerKeyAction({
        key: "Enter",
        isSubmitKeyEvent: true,
        hasCommandMenu: false,
        commandMenuItemCount: 0,
      }),
    ).toEqual({
      type: "send",
      preventDefault: true,
    })
  })
})

describe("getVisibleComposerCommandLabels", () => {
  it("shows ~plan when plan mode toggling is available", () => {
    expect(getVisibleComposerCommandLabels({ hasPlanModeToggle: true })).toContain("~plan")
  })

  it("hides ~plan when plan mode toggling is unavailable", () => {
    expect(getVisibleComposerCommandLabels({ hasPlanModeToggle: false })).not.toContain("~plan")
  })

  it("shows ~report when report submission is available", () => {
    expect(getVisibleComposerCommandLabels({ hasBagSubmit: true })).toContain("~report")
    expect(getVisibleComposerCommandLabels({ hasBagSubmit: true })).not.toContain("~bag")
  })

  it("hides ~report when report submission is unavailable", () => {
    expect(getVisibleComposerCommandLabels({ hasBagSubmit: false })).not.toContain("~report")
  })

  it("shows project plugin commands only when project tag commands are enabled", () => {
    expect(getVisibleComposerCommandLabels({ showProjectTagCommands: true })).toContain("~plugin")
    expect(getVisibleComposerCommandLabels({ showProjectTagCommands: false })).not.toContain("~plugin")
  })
})

describe("handleComposerCommandMenuMouseDown", () => {
  it("selects the menu item on primary-button mouse down", () => {
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const onSelect = vi.fn()

    expect(
      handleComposerCommandMenuMouseDown(
        {
          button: 0,
          preventDefault,
          stopPropagation,
        },
        onSelect,
      ),
    ).toBe(true)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it("ignores non-primary mouse buttons", () => {
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const onSelect = vi.fn()

    expect(
      handleComposerCommandMenuMouseDown(
        {
          button: 2,
          preventDefault,
          stopPropagation,
        },
        onSelect,
      ),
    ).toBe(false)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })
})
