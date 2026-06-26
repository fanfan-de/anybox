import { fireEvent, render, screen } from "@testing-library/react"
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
    promptRoot: "C:/Users/19128/.anybox/prompts",
    promptPresets: [selectedPromptPreset],
    promptPresetSelection: {
      systemPromptPresetID: selectedPromptPreset.id,
      planModePromptPresetID: selectedPromptPreset.id,
      sideChatPromptPresetID: selectedPromptPreset.id,
      gitCommitPromptPresetID: selectedPromptPreset.id,
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
    onOpenPromptFolder: vi.fn(() => true),
    onPreviewPromptUrlInstall: vi.fn(() => true),
    onPromptDraftChange: vi.fn(),
    onPromptDraftLabelChange: vi.fn(),
    onPromptPresetSelect: vi.fn(() => true),
    onPromptPresetSelectionChange: vi.fn(() => true),
    onPromptUrlInstallDialogClose: vi.fn(),
    onPromptUrlInstallDialogOpen: vi.fn(),
    onPromptUrlInstallPromptToggle: vi.fn(),
    onPromptUrlInstallSourceChange: vi.fn(),
    onResetPromptPreset: vi.fn(() => true),
    onSavePromptPreset: vi.fn(() => true),
    onTranslatePromptPreset: vi.fn(() => true),
    ...overrides,
  }
}

describe("PromptPresetsPage", () => {
  it("uses a wrapping textarea for custom prompt titles", () => {
    render(<PromptPresetsPage {...createProps()} />)

    const titleField = screen.getByRole("textbox", { name: "Preset name" })

    expect(titleField.tagName).toBe("TEXTAREA")
    expect(titleField).toHaveAttribute("rows", "1")
    expect(titleField).toHaveValue(LONG_PROMPT_LABEL)
    expect(screen.getByText("Git commit")).toBeInTheDocument()
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
