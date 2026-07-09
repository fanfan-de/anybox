import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n/I18nProvider"
import { Composer } from "./Composer"
import {
  appendComposerTagToDraftState,
  createComposerDraftStateFromPlainText,
  createComposerFileTagData,
  createComposerLongTextTagData,
  readComposerTagsFromDraftState,
} from "./draft-state"

function renderComposer(input: Partial<Parameters<typeof Composer>[0]> & { withI18n?: boolean } = {}) {
  const { withI18n, ...props } = input
  const ui = (
    <Composer
      attachments={[]}
      attachmentButtonTitle="Add attachments"
      attachmentDisabledReason={null}
      attachmentError={null}
      canSend
      draftState={createComposerDraftStateFromPlainText("")}
      hasPendingPermissionRequests={false}
      isSending={false}
      mcpOptions={[]}
      modelOptions={[]}
      onDraftStateChange={vi.fn()}
      onModelChange={vi.fn()}
      onPickAttachments={vi.fn()}
      onReasoningEffortChange={vi.fn()}
      onRemoveAttachment={vi.fn()}
      onSend={vi.fn()}
      reasoningEffortOptions={[]}
      selectedMcpServerIDs={[]}
      selectedModel={null}
      selectedModelLabel="Server default"
      selectedReasoningEffort={null}
      selectedReasoningEffortLabel=""
      selectedSkillIDs={[]}
      skillOptions={[]}
      unsupportedAttachmentPaths={[]}
      workspaceDirectory={null}
      {...props}
    />
  )

  return render(withI18n ? <I18nProvider>{ui}</I18nProvider> : ui)
}

function createLongPastedText(prefix = "Pasted implementation notes") {
  return Array.from({ length: 20 }, (_, index) => `${prefix} line ${index + 1}`).join("\n")
}

describe("Composer", () => {
  it("renders the empty-state placeholder inside the editor shell", () => {
    const { container } = render(
      <Composer
        attachments={[]}
        attachmentButtonTitle="Add attachments"
        attachmentDisabledReason={null}
        attachmentError={null}
        canSend
        draftState={createComposerDraftStateFromPlainText("")}
        hasPendingPermissionRequests={false}
        isSending={false}
        mcpOptions={[]}
        modelOptions={[]}
        onDraftStateChange={vi.fn()}
        onModelChange={vi.fn()}
        onPickAttachments={vi.fn()}
        onReasoningEffortChange={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onSend={vi.fn()}
        reasoningEffortOptions={[]}
        selectedMcpServerIDs={[]}
        selectedModel={null}
        selectedModelLabel="Server default"
        selectedReasoningEffort={null}
        selectedReasoningEffortLabel=""
        selectedSkillIDs={[]}
        skillOptions={[]}
        unsupportedAttachmentPaths={[]}
        workspaceDirectory={null}
      />,
    )

    const editorShell = container.querySelector(".composer-editor-shell")

    expect(editorShell).not.toBeNull()
    expect(editorShell?.querySelector(".composer-editor-input")).not.toBeNull()
    expect(editorShell?.querySelector(".composer-editor-placeholder")).not.toBeNull()
    expect(screen.getByText("Ask anything")).toBeInTheDocument()
  })

  it("localizes the default placeholder through i18n", () => {
    window.localStorage.removeItem("desktop.locale")

    renderComposer({ withI18n: true })

    expect(screen.getByText("随心输入")).toBeInTheDocument()
  })

  it("renders a custom placeholder when provided", () => {
    render(
      <Composer
        attachments={[]}
        attachmentButtonTitle="Add attachments"
        attachmentDisabledReason={null}
        attachmentError={null}
        canSend
        draftState={createComposerDraftStateFromPlainText("")}
        hasPendingPermissionRequests={false}
        isSending={false}
        mcpOptions={[]}
        modelOptions={[]}
        onDraftStateChange={vi.fn()}
        onModelChange={vi.fn()}
        onPickAttachments={vi.fn()}
        onReasoningEffortChange={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onSend={vi.fn()}
        placeholder="Ask a follow-up about this reply."
        reasoningEffortOptions={[]}
        selectedMcpServerIDs={[]}
        selectedModel={null}
        selectedModelLabel="Server default"
        selectedReasoningEffort={null}
        selectedReasoningEffortLabel=""
        selectedSkillIDs={[]}
        skillOptions={[]}
        unsupportedAttachmentPaths={[]}
        workspaceDirectory={null}
      />,
    )

    expect(screen.getByText("Ask a follow-up about this reply.")).toBeInTheDocument()
  })

  it("explains why attachments are unavailable without opening the picker", () => {
    const onPickAttachments = vi.fn()
    const disabledReason = "DeepSeek V4 Pro does not support image or PDF input."

    renderComposer({
      attachmentButtonTitle: disabledReason,
      attachmentDisabledReason: disabledReason,
      onPickAttachments,
    })

    const attachmentButton = screen.getByRole("button", { name: "Add attachments" })
    expect(attachmentButton).not.toBeDisabled()
    expect(attachmentButton).toHaveAttribute("aria-disabled", "true")

    fireEvent.click(attachmentButton)

    expect(onPickAttachments).not.toHaveBeenCalled()
    const popover = screen.getByRole("dialog", { name: "Attachments unavailable" })
    expect(popover).toBeInTheDocument()
    expect(screen.getByText(disabledReason)).toBeInTheDocument()
    expect(within(popover).queryByRole("button")).not.toBeInTheDocument()

    fireEvent.click(attachmentButton)
    expect(screen.queryByRole("dialog", { name: "Attachments unavailable" })).not.toBeInTheDocument()
  })

  it("localizes the unavailable attachment popover in Chinese", () => {
    window.localStorage.removeItem("desktop.locale")

    const disabledReason = "DeepSeek V4 Pro does not support image or PDF input."

    renderComposer({
      withI18n: true,
      attachmentButtonTitle: disabledReason,
      attachmentDisabledReason: disabledReason,
    })

    const attachmentButton = screen.getByRole("button", { name: "添加附件" })
    expect(attachmentButton).toHaveAttribute("title", "DeepSeek V4 Pro 不支持图片或 PDF 输入。")

    fireEvent.click(attachmentButton)

    const popover = screen.getByRole("dialog", { name: "附件不可用" })
    expect(popover).toBeInTheDocument()
    expect(screen.getByText("DeepSeek V4 Pro 不支持图片或 PDF 输入。")).toBeInTheDocument()
    expect(within(popover).queryByRole("button")).not.toBeInTheDocument()

    fireEvent.click(attachmentButton)
    expect(screen.queryByRole("dialog", { name: "附件不可用" })).not.toBeInTheDocument()
  })

  it("closes the unavailable attachment popover from outside click and Escape", () => {
    const disabledReason = "Loading model capabilities..."

    renderComposer({
      attachmentButtonTitle: disabledReason,
      attachmentDisabledReason: disabledReason,
    })

    const attachmentButton = screen.getByRole("button", { name: "Add attachments" })

    fireEvent.click(attachmentButton)
    expect(screen.getByRole("dialog", { name: "Attachments unavailable" })).toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("dialog", { name: "Attachments unavailable" })).not.toBeInTheDocument()

    fireEvent.click(attachmentButton)
    expect(screen.getByRole("dialog", { name: "Attachments unavailable" })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: "Attachments unavailable" })).not.toBeInTheDocument()
  })

  it("opens the attachment picker when attachments are available", () => {
    const onPickAttachments = vi.fn()

    renderComposer({ onPickAttachments })

    const attachmentButton = screen.getByRole("button", { name: "Add attachments" })
    expect(attachmentButton).not.toHaveAttribute("aria-disabled")

    fireEvent.click(attachmentButton)

    expect(onPickAttachments).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog", { name: "Attachments unavailable" })).not.toBeInTheDocument()
  })

  it("supports two-level provider and model selection in the model menu", () => {
    renderComposer({
      modelOptions: [
        {
          value: "openai/gpt-4o-mini",
          label: "GPT-4o mini",
          providerID: "openai",
          providerLabel: "OpenAI",
        },
        {
          value: "openrouter/gpt-4o-mini",
          label: "GPT-4o mini",
          providerID: "openrouter",
          providerLabel: "OpenRouter",
        },
      ],
      selectedModel: "openai/gpt-4o-mini",
      selectedModelLabel: "GPT-4o mini",
    })

    fireEvent.click(screen.getByRole("button", { name: "Select model: GPT-4o mini" }))

    const providerList = screen.getByRole("listbox", { name: "Model providers" })
    const modelList = screen.getByRole("listbox", { name: "Model selection" })

    expect(within(providerList).getByRole("option", { name: "OpenAI" })).toBeInTheDocument()
    expect(within(providerList).getByRole("option", { name: "OpenRouter" })).toBeInTheDocument()
    expect(within(modelList).getByRole("option", { name: "GPT-4o mini OpenAI" })).toBeInTheDocument()
    expect(within(modelList).queryByRole("option", { name: "GPT-4o mini OpenRouter" })).not.toBeInTheDocument()

    fireEvent.click(within(providerList).getByRole("option", { name: "OpenRouter" }))
    expect(within(modelList).getByRole("option", { name: "GPT-4o mini OpenRouter" })).toBeInTheDocument()
  })

  it("opens the model menu on the provider matching a bare selected model id", async () => {
    renderComposer({
      modelOptions: [
        {
          value: "openai/gpt-4o-mini",
          label: "GPT-4o mini",
          providerID: "openai",
          providerLabel: "OpenAI",
        },
        {
          value: "anybox/deepseek-v4-flash",
          label: "deepseek-v4-flash",
          providerID: "anybox",
          providerLabel: "Anybox",
        },
      ],
      selectedModel: "deepseek-v4-flash",
      selectedModelLabel: "deepseek-v4-flash",
    })

    fireEvent.click(screen.getByRole("button", { name: "Select model: deepseek-v4-flash" }))

    const providerList = screen.getByRole("listbox", { name: "Model providers" })
    const modelList = screen.getByRole("listbox", { name: "Model selection" })

    await waitFor(() => {
      expect(within(providerList).getByRole("option", { name: "Anybox" })).toHaveAttribute("aria-selected", "true")
    })
    expect(within(modelList).queryByRole("option", { name: "GPT-4o mini OpenAI" })).not.toBeInTheDocument()
    expect(within(modelList).getByRole("option", { name: "deepseek-v4-flash Anybox" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  it("scrolls the selected model into view when opening the model menu", async () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    const scrollIntoView = vi.fn()

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })

    try {
      renderComposer({
        modelOptions: [
          {
            value: "openai/gpt-4o-mini",
            label: "GPT-4o mini",
            providerID: "openai",
            providerLabel: "OpenAI",
          },
          {
            value: "anybox/deepseek-v4-flash",
            label: "deepseek-v4-flash",
            providerID: "anybox",
            providerLabel: "Anybox",
          },
        ],
        selectedModel: "anybox/deepseek-v4-flash",
        selectedModelLabel: "deepseek-v4-flash",
      })

      fireEvent.click(screen.getByRole("button", { name: "Select model: deepseek-v4-flash" }))

      await waitFor(() => {
        expect(
          scrollIntoView.mock.contexts.some(
            (element) =>
              element instanceof HTMLElement &&
              element.getAttribute("aria-label") === "deepseek-v4-flash Anybox",
          ),
        ).toBe(true)
      })
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" })
    } finally {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      })
    }
  })

  it("keeps the active model provider while the parent rerenders", () => {
    const createModelOptions = () => [
      {
        value: "deepseek/deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        providerID: "deepseek",
        providerLabel: "DeepSeek",
      },
      {
        value: "openrouter/claude-opus-4.5",
        label: "Claude Opus 4.5",
        providerID: "openrouter",
        providerLabel: "OpenRouter",
      },
    ]

    function Harness({ modelOptions }: { modelOptions: ReturnType<typeof createModelOptions> }) {
      return (
        <Composer
          attachments={[]}
          attachmentButtonTitle="Add attachments"
          attachmentDisabledReason={null}
          attachmentError={null}
          canSend
          draftState={createComposerDraftStateFromPlainText("")}
          hasPendingPermissionRequests={false}
          isSending={false}
          mcpOptions={[]}
          modelOptions={modelOptions}
          onDraftStateChange={vi.fn()}
          onModelChange={vi.fn()}
          onPickAttachments={vi.fn()}
          onReasoningEffortChange={vi.fn()}
          onRemoveAttachment={vi.fn()}
          onSend={vi.fn()}
          reasoningEffortOptions={[]}
          selectedMcpServerIDs={[]}
          selectedModel="deepseek/deepseek-v4-pro"
          selectedModelLabel="DeepSeek V4 Pro"
          selectedReasoningEffort={null}
          selectedReasoningEffortLabel=""
          selectedSkillIDs={[]}
          skillOptions={[]}
          unsupportedAttachmentPaths={[]}
          workspaceDirectory={null}
        />
      )
    }

    const { rerender } = render(<Harness modelOptions={createModelOptions()} />)

    fireEvent.click(screen.getByRole("button", { name: "Select model: DeepSeek V4 Pro" }))
    fireEvent.click(
      within(screen.getByRole("listbox", { name: "Model providers" })).getByRole("option", { name: "OpenRouter" }),
    )
    expect(
      within(screen.getByRole("listbox", { name: "Model selection" })).getByRole("option", {
        name: "Claude Opus 4.5 OpenRouter",
      }),
    ).toBeInTheDocument()

    rerender(<Harness modelOptions={createModelOptions()} />)

    expect(
      within(screen.getByRole("listbox", { name: "Model selection" })).getByRole("option", {
        name: "Claude Opus 4.5 OpenRouter",
      }),
    ).toBeInTheDocument()
  })

  it("renders composer tags as non-editable DOM tokens", () => {
    const draftState = appendComposerTagToDraftState(
      createComposerDraftStateFromPlainText(""),
      createComposerFileTagData("C:\\Projects\\Atlas\\games\\plants-vs-zombies.html", "plants-vs-zombies.html"),
    )

    render(
      <Composer
        attachments={[]}
        attachmentButtonTitle="Add attachments"
        attachmentDisabledReason={null}
        attachmentError={null}
        canSend
        draftState={draftState}
        hasPendingPermissionRequests={false}
        isSending={false}
        mcpOptions={[]}
        modelOptions={[]}
        onDraftStateChange={vi.fn()}
        onModelChange={vi.fn()}
        onPickAttachments={vi.fn()}
        onReasoningEffortChange={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onSend={vi.fn()}
        reasoningEffortOptions={[]}
        selectedMcpServerIDs={[]}
        selectedModel={null}
        selectedModelLabel="Server default"
        selectedReasoningEffort={null}
        selectedReasoningEffortLabel=""
        selectedSkillIDs={[]}
        skillOptions={[]}
        unsupportedAttachmentPaths={[]}
        workspaceDirectory={null}
      />,
    )

    const tag = screen.getByText("@plants-vs-zombies.html")

    expect(tag).toHaveClass("composer-inline-tag", "is-file")
    expect(tag).toHaveProperty("contentEditable", "false")
    expect(tag).toHaveProperty("tabIndex", -1)
  })

  it("leaves plain space insertion to the editor input pipeline", () => {
    const { container } = renderComposer({
      draftState: createComposerDraftStateFromPlainText("Prompt before space"),
    })
    const editor = container.querySelector(".composer-editor-input")

    expect(editor).toBeInstanceOf(HTMLElement)
    expect(
      fireEvent.keyDown(editor as HTMLElement, {
        key: " ",
        code: "Space",
        charCode: 32,
      }),
    ).toBe(true)
  })

  it("passes pasted image files to the attachment handler", async () => {
    const onPasteImageAttachments = vi.fn()
    const { container } = renderComposer({
      canPasteImageAttachments: true,
      onPasteImageAttachments,
    })
    const editor = container.querySelector(".composer-editor-input")
    const imageFile = new File(["image"], "screenshot.png", { type: "image/png" })

    expect(editor).toBeInstanceOf(HTMLElement)
    expect(
      fireEvent.paste(editor as HTMLElement, {
        clipboardData: {
          items: [
            {
              kind: "file",
              type: "image/png",
              getAsFile: () => imageFile,
            },
          ],
          files: [],
        },
      }),
    ).toBe(false)

    await waitFor(() => expect(onPasteImageAttachments).toHaveBeenCalledTimes(1))
    expect(onPasteImageAttachments.mock.calls[0]?.[0]).toEqual([
      {
        dataUrl: "data:image/png;base64,aW1hZ2U=",
        mimeType: "image/png",
        name: "screenshot.png",
      },
    ])
  })

  it("turns pasted long text into a compact composer tag", async () => {
    const onDraftStateChange = vi.fn()
    const longText = createLongPastedText()
    const { container } = renderComposer({ onDraftStateChange })
    const editor = container.querySelector(".composer-editor-input")

    expect(editor).toBeInstanceOf(HTMLElement)
    expect(
      fireEvent.paste(editor as HTMLElement, {
        clipboardData: {
          getData: (type: string) => (type === "text/plain" ? longText : ""),
          items: [],
          files: [],
        },
      }),
    ).toBe(false)

    const tag = await screen.findByRole("button", { name: /Edit Long text/ })
    expect(tag).toHaveClass("composer-inline-tag", "is-long-text")
    expect(tag).not.toHaveTextContent("line 20")

    await waitFor(() => expect(onDraftStateChange).toHaveBeenCalled())
    const nextDraftState = onDraftStateChange.mock.calls.at(-1)?.[0]
    expect(nextDraftState?.plainText).toContain("@Long text")
    expect(nextDraftState?.plainText).not.toContain("line 20")
  })

  it("lets short pasted text flow through the normal editor paste pipeline", () => {
    const onDraftStateChange = vi.fn()
    const { container } = renderComposer({ onDraftStateChange })
    const editor = container.querySelector(".composer-editor-input")

    expect(editor).toBeInstanceOf(HTMLElement)
    expect(
      fireEvent.paste(editor as HTMLElement, {
        clipboardData: {
          getData: (type: string) => (type === "text/plain" ? "Short pasted text" : ""),
          items: [],
          files: [],
        },
      }),
    ).toBe(true)
    expect(screen.queryByRole("button", { name: /Edit Long text/ })).toBeNull()
  })

  it("edits a long text tag from the dialog", async () => {
    const onDraftStateChange = vi.fn()
    const initialText = createLongPastedText("Original")
    const nextText = "Edited pasted text that stays stored inside the tag."
    const draftState = appendComposerTagToDraftState(
      createComposerDraftStateFromPlainText(""),
      createComposerLongTextTagData(initialText, "long-text:test"),
    )

    renderComposer({ draftState, onDraftStateChange })

    fireEvent.click(screen.getByRole("button", { name: /Edit Long text/ }))
    const dialog = screen.getByRole("dialog", { name: "Edit long pasted text" })
    const textarea = within(dialog).getByRole("textbox", { name: "Long pasted text" })
    expect(textarea).toHaveValue(initialText)

    fireEvent.change(textarea, { target: { value: nextText } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))

    await waitFor(() => expect(onDraftStateChange).toHaveBeenCalled())
    const nextDraftState = onDraftStateChange.mock.calls.at(-1)?.[0]
    const longTextTag = readComposerTagsFromDraftState(nextDraftState)
      .find((tag) => tag.kind === "long-text")

    expect(longTextTag).toMatchObject({
      id: "long-text:test",
      text: nextText,
      characterCount: nextText.length,
    })
    expect(nextDraftState.plainText).toContain("@Long text")
    expect(nextDraftState.plainText).not.toContain(nextText)
    expect(screen.queryByRole("dialog", { name: "Edit long pasted text" })).toBeNull()
  })

  it("cancels and removes a long text tag from the dialog", async () => {
    const onDraftStateChange = vi.fn()
    const initialText = createLongPastedText("Removable")
    const draftState = appendComposerTagToDraftState(
      createComposerDraftStateFromPlainText(""),
      createComposerLongTextTagData(initialText, "long-text:test"),
    )

    renderComposer({ draftState, onDraftStateChange })

    fireEvent.click(screen.getByRole("button", { name: /Edit Long text/ }))
    fireEvent.change(screen.getByRole("textbox", { name: "Long pasted text" }), {
      target: { value: "Cancelled edit" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onDraftStateChange).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: /Edit Long text/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Edit Long text/ }))
    fireEvent.click(screen.getByRole("button", { name: "Remove" }))

    await waitFor(() => expect(onDraftStateChange).toHaveBeenCalled())
    const nextDraftState = onDraftStateChange.mock.calls.at(-1)?.[0]
    expect(readComposerTagsFromDraftState(nextDraftState)).toEqual([])
    expect(screen.queryByRole("button", { name: /Edit Long text/ })).toBeNull()
  })

  it("switches the send button to stop while sending with an empty draft", () => {
    const onCancelSend = vi.fn()
    const onSend = vi.fn()

    renderComposer({
      draftState: createComposerDraftStateFromPlainText(""),
      isSending: true,
      onCancelSend,
      onSend,
    })

    const button = screen.getByRole("button", { name: "Stop task" })

    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onCancelSend).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it("shows queue and stop controls while sending when the draft has text", () => {
    const onCancelSend = vi.fn()
    const onSend = vi.fn()

    renderComposer({
      draftState: createComposerDraftStateFromPlainText("Steer the current task"),
      isSending: true,
      onCancelSend,
      onSend,
    })

    const sendButton = screen.getByRole("button", { name: "Queue message" })
    const stopButton = screen.getByRole("button", { name: "Stop task" })

    expect(sendButton).toBeEnabled()
    expect(stopButton).toBeEnabled()

    fireEvent.click(sendButton)
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onCancelSend).not.toHaveBeenCalled()
  })

  it("switches from stop-only to queue after text is typed during a running task", async () => {
    const onCancelSend = vi.fn()
    const onSend = vi.fn()
    const { container } = renderComposer({
      draftState: createComposerDraftStateFromPlainText(""),
      isSending: true,
      onCancelSend,
      onSend,
    })
    const editor = container.querySelector(".composer-editor-input")

    expect(editor).toBeInstanceOf(HTMLElement)
    expect(screen.getByRole("button", { name: "Stop task" })).toBeEnabled()

    fireEvent(
      editor as HTMLElement,
      new CustomEvent("desktop-composer-change", {
        detail: { value: "Steer the current task" },
      }),
    )

    const sendButton = await screen.findByRole("button", { name: "Queue message" })
    expect(sendButton).toBeEnabled()

    fireEvent.click(sendButton)
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onCancelSend).not.toHaveBeenCalled()
  })

  it("shows queue and stop while sending with attachments but no draft text", () => {
    const onCancelSend = vi.fn()
    const onSend = vi.fn()

    renderComposer({
      attachments: [{ name: "screenshot.png", path: "C:\\Temp\\screenshot.png" }],
      draftState: createComposerDraftStateFromPlainText(""),
      isSending: true,
      onCancelSend,
      onSend,
    })

    const sendButton = screen.getByRole("button", { name: "Queue message" })
    const stopButton = screen.getByRole("button", { name: "Stop task" })

    expect(sendButton).toBeEnabled()
    expect(stopButton).toBeEnabled()
    fireEvent.click(stopButton)
    expect(onCancelSend).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it("renders raster image attachments as thumbnails and keeps the remove action", () => {
    const onRemoveAttachment = vi.fn()
    const imagePath = "C:\\Temp\\screenshot.png"

    renderComposer({
      attachments: [{ name: "screenshot.png", path: imagePath }],
      onRemoveAttachment,
    })

    const image = screen.getByRole("img", { name: "screenshot.png" })

    expect(image).toHaveClass("composer-attachment-thumbnail")
    expect(image).toHaveAttribute(
      "src",
      `anybox-local-image://image?source=${encodeURIComponent(imagePath)}`,
    )

    fireEvent.click(screen.getByRole("button", { name: "Remove screenshot.png" }))

    expect(onRemoveAttachment).toHaveBeenCalledWith(imagePath)
  })

  it("keeps PDF and SVG attachments as file chips", () => {
    renderComposer({
      attachments: [
        { name: "brief.pdf", path: "C:\\Refs\\brief.pdf" },
        { name: "icon.svg", path: "C:\\Refs\\icon.svg" },
      ],
    })

    expect(screen.getByText("brief.pdf")).toHaveClass("composer-attachment-name")
    expect(screen.getByText("icon.svg")).toHaveClass("composer-attachment-name")
    expect(screen.queryByRole("img", { name: "brief.pdf" })).not.toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "icon.svg" })).not.toBeInTheDocument()
  })

  it("falls back to a file chip when an image thumbnail fails to load", async () => {
    renderComposer({
      attachments: [{ name: "screenshot.png", path: "C:\\Temp\\screenshot.png" }],
    })

    fireEvent.error(screen.getByRole("img", { name: "screenshot.png" }))

    expect(await screen.findByText("screenshot.png")).toHaveClass("composer-attachment-name")
    expect(screen.queryByRole("img", { name: "screenshot.png" })).not.toBeInTheDocument()
  })

  it("keeps invalid state on image attachment thumbnails", () => {
    const imagePath = "C:\\Temp\\screenshot.png"
    const { container } = renderComposer({
      attachments: [{ name: "screenshot.png", path: imagePath }],
      unsupportedAttachmentPaths: [imagePath],
    })

    const chip = container.querySelector(".composer-attachment-chip.is-image-preview")

    expect(chip).toHaveClass("is-invalid")
    expect(chip).toContainElement(screen.getByRole("img", { name: "screenshot.png" }))
  })

  it("uses Enter to stop while sending with an empty draft", () => {
    const onCancelSend = vi.fn()
    const onSend = vi.fn()
    const { container } = renderComposer({
      draftState: createComposerDraftStateFromPlainText(""),
      isSending: true,
      onCancelSend,
      onSend,
    })
    const editor = container.querySelector(".composer-editor-input")

    expect(editor).toBeInstanceOf(HTMLElement)
    fireEvent.keyDown(editor as HTMLElement, { key: "Enter", code: "Enter" })
    expect(onCancelSend).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it("uses Enter to queue while sending with draft text", () => {
    const onCancelSend = vi.fn()
    const onSend = vi.fn()
    const { container } = renderComposer({
      draftState: createComposerDraftStateFromPlainText("Steer the current task"),
      isSending: true,
      onCancelSend,
      onSend,
    })
    const editor = container.querySelector(".composer-editor-input")

    expect(editor).toBeInstanceOf(HTMLElement)
    fireEvent.keyDown(editor as HTMLElement, { key: "Enter", code: "Enter" })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onCancelSend).not.toHaveBeenCalled()
  })
})
