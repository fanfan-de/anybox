import { fireEvent, render, screen, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"
import { PromptPresetsPage } from "./PromptPresetsPage"

type PromptPresetsPageProps = ComponentProps<typeof PromptPresetsPage>

const LONG_PROMPT_LABEL =
  "Custom system prompt - Simplified Chinese - very long title that should wrap instead of being clipped by editor toolbar actions"

function createPromptPreset(overrides: Partial<PromptPresetsPageProps["selectedPromptPreset"]> = {}) {
  return {
    id: "custom-long-title",
    label: LONG_PROMPT_LABEL,
    description: "Custom prompt preset",
    source: "custom" as const,
    hasOverride: false,
    editable: true,
    sourcePath: "custom/long-title.md",
    filePath: "C:/Users/19128/.anybox/prompts/custom/long-title.md",
    root: "C:/Users/19128/.anybox/prompts",
    content: "<prompt>\nPrompt content.\n</prompt>",
    ...overrides,
  }
}

function createProps(overrides: Partial<PromptPresetsPageProps> = {}): PromptPresetsPageProps {
  const selectedPromptPreset = createPromptPreset()

  return {
    deletingPromptPresetID: null,
    hideNavigator: true,
    isCreatingPromptPreset: false,
    isInstallingPromptUrlPrompts: false,
    isLoadingPromptPreset: false,
    isLoadingPrompts: false,
    isPreviewingPromptUrlInstall: false,
    isPromptDirty: false,
    isPromptUrlInstallDialogOpen: false,
    isSavingPromptPresetSelection: false,
    isTranslatingPromptPreset: false,
    models: [],
    promptDraftContent: selectedPromptPreset.content,
    promptDraftLabel: selectedPromptPreset.label,
    promptLoadError: null,
    promptPresets: [selectedPromptPreset],
    promptPresetSelection: {
      systemPromptPresetID: selectedPromptPreset.id,
      planModePromptPresetID: selectedPromptPreset.id,
      gitCommitPromptPresetID: selectedPromptPreset.id,
      cinemaTextGenerationPromptPresetID: selectedPromptPreset.id,
    },
    promptUrlInstallMessage: null,
    promptUrlInstallPreview: null,
    promptUrlInstallSource: "",
    resettingPromptPresetID: null,
    savingPromptPresetID: null,
    selectedPromptPreset,
    selectedPromptUrlInstallIDs: [],
    onCreatePromptPreset: vi.fn(() => true),
    onDeletePromptPreset: vi.fn(() => true),
    onInstallPromptsFromUrl: vi.fn(() => true),
    onOpenPromptFile: vi.fn(() => true),
    onPreviewPromptUrlInstall: vi.fn(() => true),
    onPromptDraftChange: vi.fn(),
    onPromptDraftLabelChange: vi.fn(),
    onPromptPresetSelect: vi.fn(() => true),
    onPromptPresetSelectionChange: vi.fn(() => true),
    onPromptUrlInstallDialogClose: vi.fn(),
    onPromptUrlInstallPromptToggle: vi.fn(),
    onPromptUrlInstallSourceChange: vi.fn(),
    onResetPromptPreset: vi.fn(() => true),
    onSavePromptPreset: vi.fn(() => true),
    onTranslatePromptPreset: vi.fn(() => true),
    ...overrides,
  }
}

describe("PromptPresetsPage", () => {
  it("omits the repeated document icon from prompt navigator rows", () => {
    render(<PromptPresetsPage {...createProps({ hideNavigator: false })} />)

    const promptRow = screen.getByRole("button", { name: LONG_PROMPT_LABEL })

    expect(promptRow.querySelector("svg")).toBeNull()
  })

  it("removes the navigator toolbar actions and exposes row actions in a context menu", () => {
    const onDeletePromptPreset = vi.fn(() => true)
    const onOpenPromptFile = vi.fn(() => true)
    render(<PromptPresetsPage {...createProps({
      hideNavigator: false,
      onDeletePromptPreset,
      onOpenPromptFile,
    })} />)

    expect(screen.queryByRole("button", { name: "Open prompts folder" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Install prompt" })).not.toBeInTheDocument()
    const promptSearch = screen.getByRole("search", { name: "Prompt presets search" })
    const promptList = screen.getByRole("list", { name: "Prompt presets" })
    expect(promptList).not.toContainElement(promptSearch)
    expect(promptSearch.nextElementSibling).toBe(promptList)

    const promptRow = screen.getByRole("button", { name: LONG_PROMPT_LABEL })
    fireEvent.contextMenu(promptRow, { clientX: 48, clientY: 64 })

    const menu = screen.getByRole("menu", { name: LONG_PROMPT_LABEL })
    const menuItems = within(menu).getAllByRole("menuitem")
    expect(menuItems[0]).toHaveTextContent("Open local file")
    expect(menuItems[1]).toHaveTextContent("Delete")
    expect(menuItems[1]).toHaveAttribute("data-variant", "danger")

    fireEvent.click(menuItems[0])
    expect(onOpenPromptFile).toHaveBeenCalledWith("C:/Users/19128/.anybox/prompts/custom/long-title.md")
    expect(screen.queryByRole("menu", { name: LONG_PROMPT_LABEL })).not.toBeInTheDocument()

    fireEvent.contextMenu(promptRow, { clientX: 48, clientY: 64 })
    fireEvent.click(within(screen.getByRole("menu", { name: LONG_PROMPT_LABEL })).getByRole("menuitem", { name: "Delete" }))
    expect(onDeletePromptPreset).toHaveBeenCalledWith("custom-long-title")
  })

  it("opens a bundled prompt context menu from the keyboard and restores row focus with Escape", () => {
    const bundledPrompt = createPromptPreset({
      id: "system-default",
      label: "System prompt",
      source: "bundled",
      editable: false,
    })
    render(<PromptPresetsPage {...createProps({
      hideNavigator: false,
      promptDraftContent: bundledPrompt.content,
      promptDraftLabel: bundledPrompt.label,
      promptPresets: [bundledPrompt],
      selectedPromptPreset: bundledPrompt,
    })} />)

    const promptRow = screen.getByRole("button", { name: "System prompt" })
    fireEvent.keyDown(promptRow, { key: "F10", shiftKey: true })

    const menu = screen.getByRole("menu", { name: "System prompt" })
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(1)
    expect(within(menu).queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("menu", { name: "System prompt" })).not.toBeInTheDocument()
    expect(promptRow).toHaveFocus()
  })

  it("omits status badges from prompt navigator rows", () => {
    const bundledPrompt = createPromptPreset({
      id: "system-default",
      label: "System prompt",
      source: "bundled",
      hasOverride: true,
      editable: false,
    })

    render(<PromptPresetsPage {...createProps({
      hideNavigator: false,
      promptDraftContent: bundledPrompt.content,
      promptDraftLabel: bundledPrompt.label,
      promptPresets: [bundledPrompt],
      promptPresetSelection: {
        systemPromptPresetID: bundledPrompt.id,
        planModePromptPresetID: bundledPrompt.id,
        gitCommitPromptPresetID: bundledPrompt.id,
        cinemaTextGenerationPromptPresetID: bundledPrompt.id,
      },
      selectedPromptPreset: bundledPrompt,
    })} />)

    const promptRow = screen.getByRole("button", { name: "System prompt" })

    expect(promptRow.querySelector(".settings-badge")).toBeNull()
    expect(screen.getByText("Edited")).toBeInTheDocument()
  })

  it("keeps bundled prompts read-only until a custom copy is created", () => {
    const bundledPrompt = createPromptPreset({
      id: "system-default",
      label: "System prompt",
      description: "Bundled system prompt.",
      source: "bundled",
      editable: false,
      content: "Bundled prompt content.",
    })
    const onCreatePromptPreset = vi.fn(() => true)

    render(<PromptPresetsPage {...createProps({
      promptDraftContent: bundledPrompt.content,
      promptDraftLabel: bundledPrompt.label,
      promptPresets: [bundledPrompt],
      selectedPromptPreset: bundledPrompt,
      onCreatePromptPreset,
    })} />)

    expect(screen.getByRole("textbox", { name: "System prompt content" })).toHaveAttribute("readonly")
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument()
    expect(screen.getByText("Bundled prompts are read-only. Make a custom copy before editing.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Make custom copy" }))

    expect(onCreatePromptPreset).toHaveBeenCalledWith({
      label: "System prompt (Custom)",
      content: "Bundled prompt content.",
      description: "Bundled system prompt.",
      replaceAssignmentsFromPresetID: "system-default",
    })
  })

  it("uses a wrapping textarea for custom prompt titles", () => {
    render(<PromptPresetsPage {...createProps()} />)

    const titleField = screen.getByRole("textbox", { name: "Preset name" })

    expect(titleField.tagName).toBe("TEXTAREA")
    expect(titleField).toHaveAttribute("rows", "1")
    expect(titleField).toHaveValue(LONG_PROMPT_LABEL)
    expect(screen.getByText("Git commit")).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Cinema text generation prompt preset" })).toBeInTheDocument()
    expect(screen.getByText("Cinema text generation")).toBeInTheDocument()
  })

  it("keeps custom prompt titles single-line in state", () => {
    const onPromptDraftLabelChange = vi.fn()
    render(<PromptPresetsPage {...createProps({ onPromptDraftLabelChange })} />)

    fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), {
      target: { value: "First line\nSecond line\r\nThird line" },
    })

    expect(onPromptDraftLabelChange).toHaveBeenCalledWith("First line Second line Third line")
  })

  it("uses the danger button variant for deleting custom prompt presets", () => {
    render(<PromptPresetsPage {...createProps()} />)

    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("secondary-button", "is-danger")
  })
})
