import { useState } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DesktopIpcOutput } from "../../../../shared/desktop-ipc-contract"
import { I18nProvider } from "../i18n/I18nProvider"
import { SessionBagSubmissionDialog } from "./WorkbenchPaneSurface"

type SessionBagPrepareResult = DesktopIpcOutput<"desktop:prepare-session-bag-submission">

const prepare: SessionBagPrepareResult = {
  account: {
    email: "dev@example.com",
    workspaceName: "Anybox Admin",
    planLabel: "Pro",
  },
  baseURL: "https://api.anybox.test",
  filename: "anybox-bag-session-1-20260619-180614.zip",
  fileCount: 45,
  generatedAt: "2026-06-19T10:06:14.000Z",
  projectID: "project-1",
  recordCount: 29,
  redaction: {
    enabled: true,
    maxStringLength: 20000,
    redactedKeyPattern: "apiKey|token|secret|authorization",
  },
  sessionID: "session-1",
  sha256: "sha256",
  sizeBytes: 159500,
  submissionID: "bag-1",
}

function renderSessionBagDialog({
  initialDescription = "",
  onCancel = vi.fn(),
  onClose = vi.fn(),
  onSubmit = vi.fn(),
  state = { stage: "confirm", prepare } as const,
}: Partial<Parameters<typeof SessionBagSubmissionDialog>[0]> & {
  initialDescription?: string
} = {}) {
  function Harness() {
    const [description, setDescription] = useState(initialDescription)

    return (
      <I18nProvider>
        <SessionBagSubmissionDialog
          description={description}
          state={state}
          onDescriptionChange={setDescription}
          onCancel={onCancel}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      </I18nProvider>
    )
  }

  return render(<Harness />)
}

describe("SessionBagSubmissionDialog", () => {
  beforeEach(() => {
    window.localStorage.setItem("desktop.locale", "en-US")
  })

  it("edits the optional problem description and enforces the 2000 character limit", () => {
    const onSubmit = vi.fn()
    renderSessionBagDialog({ onSubmit })

    const dialog = screen.getByRole("dialog", { name: "Submit diagnostic report" })
    const description = within(dialog).getByRole("textbox", {
      name: "Problem description (optional)",
    })

    expect(description).toHaveValue("")
    expect(within(dialog).getByText("0 / 2000 chars")).toBeInTheDocument()

    const longDescription = "The app stopped after submitting a prompt. ".repeat(60)
    fireEvent.change(description, { target: { value: longDescription } })

    expect(description).toHaveValue(longDescription.slice(0, 2000))
    expect(within(dialog).getByText("2000 / 2000 chars")).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole("button", { name: "Submit report" }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("keeps the problem description editable while retrying after an upload error", () => {
    renderSessionBagDialog({
      initialDescription: "The terminal panel froze.",
      state: {
        stage: "error",
        prepare,
        message: "Upload failed.",
      },
    })

    const description = screen.getByRole("textbox", {
      name: "Problem description (optional)",
    })
    expect(description).toBeEnabled()
    expect(description).toHaveValue("The terminal panel froze.")
  })

  it("disables the problem description while uploading and hides it after success", () => {
    const { rerender } = renderSessionBagDialog({
      initialDescription: "The model selector disappeared.",
      state: {
        stage: "uploading",
        prepare,
      },
    })

    expect(screen.getByRole("textbox", { name: "Problem description (optional)" })).toBeDisabled()

    function SuccessHarness() {
      return (
        <I18nProvider>
          <SessionBagSubmissionDialog
            description="The model selector disappeared."
            state={{
              stage: "success",
              prepare,
              result: {
                bagID: "bag-1",
                url: "https://api.anybox.test/bags/bag-1",
              },
            }}
            onDescriptionChange={vi.fn()}
            onCancel={vi.fn()}
            onClose={vi.fn()}
            onSubmit={vi.fn()}
          />
        </I18nProvider>
      )
    }

    rerender(<SuccessHarness />)
    expect(screen.queryByRole("textbox", { name: "Problem description (optional)" })).toBeNull()
  })
})
