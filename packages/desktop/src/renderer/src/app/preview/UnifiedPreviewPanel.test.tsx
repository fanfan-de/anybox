import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { DesktopLocalPreviewService } from "../../../../shared/desktop-ipc-contract"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_WORKSPACE_PREVIEW_STATE } from "../agent-workspace/review-preview-state"
import { CODE_HIGHLIGHT_MAX_INPUT_LENGTH, CodeBlockPreview } from "../code-highlight"
import { I18nProvider } from "../i18n/I18nProvider"
import { ToastProvider } from "../toast"
import type { PreviewInteractionRecord, WorkspacePreviewState } from "../types"
import { UnifiedPreviewPanel } from "./UnifiedPreviewPanel"

const workspaceRoot = "C:\\Projects\\Project 2"

function createPreviewState(overrides: Partial<WorkspacePreviewState> = {}): WorkspacePreviewState {
  return {
    ...DEFAULT_WORKSPACE_PREVIEW_STATE,
    ...overrides,
  }
}

function renderUnifiedPreviewPanel(
  overrides: Partial<ComponentProps<typeof UnifiedPreviewPanel>> & { withI18n?: boolean } = {},
) {
  const { codeTheme = "github-light", withI18n, ...panelOverrides } = overrides
  const ui = (
    <ToastProvider>
      <UnifiedPreviewPanel
        codeTheme={codeTheme}
        state={createPreviewState()}
        workspaceRoot={workspaceRoot}
        onActiveInteractionChange={vi.fn()}
        onBack={vi.fn()}
        onCommitInteraction={vi.fn()}
        onDraftUrlChange={vi.fn()}
        onForward={vi.fn()}
        onOpen={vi.fn()}
        onOpenExternal={vi.fn()}
        onOpenUrl={vi.fn()}
        onReload={vi.fn()}
        {...panelOverrides}
      />
    </ToastProvider>
  )

  return render(withI18n ? <I18nProvider>{ui}</I18nProvider> : ui)
}

function createWebCommentRecord(
  overrides: Partial<PreviewInteractionRecord> & {
    id: string
    text: string
    x: number
    y: number
  },
): PreviewInteractionRecord {
  const { id, text, x, y, ...recordOverrides } = overrides
  return {
    createdAt: 1,
    id,
    pluginID: "web.comment",
    renderer: "url-webview",
    targetKey: "http://localhost:5173/",
    payload: {
      kind: "web-comment",
      pageUrl: "http://localhost:5173/",
      text,
      x,
      y,
    },
    ...recordOverrides,
  }
}

describe("UnifiedPreviewPanel", () => {
  beforeEach(() => {
    window.desktop = {
      detectLocalPreviewServices: vi.fn().mockResolvedValue([]),
      readPreviewText: vi.fn().mockResolvedValue({
        content: "",
        path: `${workspaceRoot}\\README.md`,
      }),
    } as unknown as Window["desktop"]
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the empty state and opens quick localhost targets", () => {
    const onOpenUrl = vi.fn()
    renderUnifiedPreviewPanel({ onOpenUrl })

    expect(screen.getByRole("heading", { name: "Open a preview target" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "http://localhost:5173" }))

    expect(onOpenUrl).toHaveBeenCalledWith("http://localhost:5173")
  })

  it("localizes the empty preview target state in Chinese", async () => {
    window.localStorage.removeItem("desktop.locale")
    window.desktop!.detectLocalPreviewServices = vi.fn(() => new Promise<DesktopLocalPreviewService[]>(() => undefined))

    renderUnifiedPreviewPanel({ withI18n: true })

    expect(screen.getByRole("heading", { name: "打开预览目标" })).toBeInTheDocument()
    expect(screen.getByText(/输入 URL、/)).toBeInTheDocument()
    expect(screen.getByText("agent://artifact/id")).toBeInTheDocument()
    expect(screen.getByText(/或当前工作区中的文件路径。/)).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "快速预览目标" })).toBeInTheDocument()
    const scanButton = await screen.findByRole("button", { name: "扫描中..." })
    expect(scanButton).toBeDisabled()
    expect(scanButton).toHaveAttribute("aria-busy", "true")
    expect(scanButton.querySelector(".unified-preview-scan-spinner")).toBeInTheDocument()
  })

  it("reads and renders markdown artifact previews", async () => {
    window.desktop!.readPreviewText = vi.fn().mockResolvedValue({
      content: "# Report\n\nArtifact body.",
      path: `${workspaceRoot}\\artifacts\\report-1\\report.md`,
    })

    renderUnifiedPreviewPanel({
      state: createPreviewState({
        activeTargetInput: "agent://artifact/report-1",
        draftTarget: "agent://artifact/report-1",
        resolvedTarget: {
          artifactID: "report-1",
          artifactType: "markdown",
          entry: `${workspaceRoot}\\artifacts\\report-1\\report.md`,
          externalOpenTarget: {
            kind: "path",
            value: `${workspaceRoot}\\artifacts\\report-1\\report.md`,
          },
          input: "agent://artifact/report-1",
          kind: "artifact",
          mime: "text/markdown; charset=utf-8",
          normalizedInput: "agent://artifact/report-1",
          path: `${workspaceRoot}\\artifacts\\report-1\\report.md`,
          renderer: "markdown-preview",
          textReadable: true,
          title: "Report",
          workspaceRoot,
        },
        status: "ready",
      }),
    })

    await waitFor(() => {
      expect(window.desktop!.readPreviewText).toHaveBeenCalledWith({
        path: `${workspaceRoot}\\artifacts\\report-1\\report.md`,
        workspaceRoot,
      })
    })
    expect(await screen.findByRole("heading", { name: "Report" })).toBeInTheDocument()
    expect(screen.getByText("Artifact body.")).toBeInTheDocument()
  })

  it("renders HTML targets in a sandboxed frame", async () => {
    renderUnifiedPreviewPanel({
      state: createPreviewState({
        activeTargetInput: "agent://artifact/html-1",
        draftTarget: "agent://artifact/html-1",
        resolvedTarget: {
          artifactID: "html-1",
          entry: `${workspaceRoot}\\artifacts\\html-1\\index.html`,
          externalOpenTarget: {
            kind: "path",
            value: `${workspaceRoot}\\artifacts\\html-1\\index.html`,
          },
          input: "agent://artifact/html-1",
          kind: "artifact",
          mime: "text/html; charset=utf-8",
          normalizedInput: "agent://artifact/html-1",
          path: `${workspaceRoot}\\artifacts\\html-1\\index.html`,
          renderer: "html-preview",
          safePreviewUrl: "anybox-preview://preview/token/index.html",
          textReadable: false,
          title: "index.html",
          workspaceRoot,
        },
        status: "ready",
      }),
    })

    const frame = await screen.findByTitle("Preview of index.html")
    expect(frame).toHaveAttribute("sandbox", "allow-forms allow-popups allow-same-origin allow-scripts")
    expect(frame).toHaveAttribute("src", "anybox-preview://preview/token/index.html")
    const commentButton = screen.getByRole("button", { name: "Comment" })
    expect(commentButton).toBeInTheDocument()
    expect(commentButton.textContent).toBe("")
  })

  it("opens Local ComfyUI settings only for a message from the active preview frame", async () => {
    const onOpenCinemaProviderSettings = vi.fn()
    renderUnifiedPreviewPanel({
      onOpenCinemaProviderSettings,
      state: createPreviewState({
        activeTargetInput: "agent://artifact/html-1",
        draftTarget: "agent://artifact/html-1",
        resolvedTarget: {
          artifactID: "html-1",
          entry: `${workspaceRoot}\\artifacts\\html-1\\index.html`,
          externalOpenTarget: {
            kind: "path",
            value: `${workspaceRoot}\\artifacts\\html-1\\index.html`,
          },
          input: "agent://artifact/html-1",
          kind: "artifact",
          mime: "text/html; charset=utf-8",
          normalizedInput: "agent://artifact/html-1",
          path: `${workspaceRoot}\\artifacts\\html-1\\index.html`,
          renderer: "html-preview",
          safePreviewUrl: "anybox-preview://preview/token/index.html",
          textReadable: false,
          title: "index.html",
          workspaceRoot,
        },
        status: "ready",
      }),
    })

    const frame = await screen.findByTitle<HTMLIFrameElement>("Preview of index.html")
    const unrelatedMessage = new MessageEvent("message", {
      data: {
        type: "anybox:open-cinema-provider-settings",
        providerID: "comfyui-local",
      },
    })
    window.dispatchEvent(unrelatedMessage)
    expect(onOpenCinemaProviderSettings).not.toHaveBeenCalled()

    const previewMessage = new MessageEvent("message", {
      data: {
        type: "anybox:open-cinema-provider-settings",
        providerID: "comfyui-local",
      },
    })
    Object.defineProperty(previewMessage, "source", { value: frame.contentWindow })
    window.dispatchEvent(previewMessage)
    expect(onOpenCinemaProviderSettings).toHaveBeenCalledWith("comfyui-local")
  })

  it("renders browser navigation controls and delegates clicks", () => {
    const onBack = vi.fn()
    const onForward = vi.fn()
    const onReload = vi.fn()
    renderUnifiedPreviewPanel({
      onBack,
      onForward,
      onReload,
      state: createPreviewState({
        navigationHistory: ["http://localhost:3000/", "http://localhost:5173/"],
        navigationIndex: 0,
      }),
    })

    const backButton = screen.getByRole("button", { name: "Back" })
    const forwardButton = screen.getByRole("button", { name: "Forward" })
    const reloadButton = screen.getByRole("button", { name: "Reload preview" })

    expect(backButton).toBeDisabled()
    expect(forwardButton).toBeEnabled()
    fireEvent.click(forwardButton)
    fireEvent.click(reloadButton)

    expect(onBack).not.toHaveBeenCalled()
    expect(onForward).toHaveBeenCalledTimes(1)
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it("uses the Electron webview preload for HTML targets when available", () => {
    vi.spyOn(globalThis.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Electron/39")
    window.desktop!.previewGuestPreloadPath = "file:///C:/Projects/anybox/packages/desktop/out/preload/preview-webview.mjs"

    const { container } = renderUnifiedPreviewPanel({
      state: createPreviewState({
        activeTargetInput: "agent://artifact/html-1",
        draftTarget: "agent://artifact/html-1",
        resolvedTarget: {
          artifactID: "html-1",
          entry: `${workspaceRoot}\\artifacts\\html-1\\index.html`,
          externalOpenTarget: {
            kind: "path",
            value: `${workspaceRoot}\\artifacts\\html-1\\index.html`,
          },
          input: "agent://artifact/html-1",
          kind: "artifact",
          mime: "text/html; charset=utf-8",
          normalizedInput: "agent://artifact/html-1",
          path: `${workspaceRoot}\\artifacts\\html-1\\index.html`,
          renderer: "html-preview",
          safePreviewUrl: "anybox-preview://preview/token/index.html",
          textReadable: false,
          title: "index.html",
          workspaceRoot,
        },
        status: "ready",
      }),
    })

    const webview = container.querySelector("webview.preview-webview")
    expect(webview).toBeInTheDocument()
    expect(webview).toHaveAttribute("preload", window.desktop!.previewGuestPreloadPath)
    expect(webview).toHaveAttribute("src", "anybox-preview://preview/token/index.html")
    expect(screen.queryByTitle("Preview of index.html")).toBeNull()
    expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument()
  })

  it("does not show interaction controls for non-web previews", () => {
    renderUnifiedPreviewPanel({
      state: createPreviewState({
        activeTargetInput: "README.md",
        draftTarget: "README.md",
        resolvedTarget: {
          entry: `${workspaceRoot}\\README.md`,
          externalOpenTarget: {
            kind: "path",
            value: `${workspaceRoot}\\README.md`,
          },
          input: "README.md",
          kind: "file",
          mime: "text/markdown; charset=utf-8",
          normalizedInput: "README.md",
          path: `${workspaceRoot}\\README.md`,
          renderer: "markdown-preview",
          textReadable: true,
          title: "README.md",
          workspaceRoot,
        },
        status: "ready",
      }),
    })

    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull()
  })

  it("syntax highlights code file previews with Shiki tokens", async () => {
    window.desktop!.readPreviewText = vi.fn().mockResolvedValue({
      content: "const camera = 1\nconst message = `ready\nnow`",
      path: `${workspaceRoot}\\src\\camera.ts`,
    })

    const { container } = renderUnifiedPreviewPanel({
      codeTheme: "vitesse-dark",
      state: createPreviewState({
        activeTargetInput: "src/camera.ts",
        draftTarget: "src/camera.ts",
        resolvedTarget: {
          entry: `${workspaceRoot}\\src\\camera.ts`,
          externalOpenTarget: {
            kind: "path",
            value: `${workspaceRoot}\\src\\camera.ts`,
          },
          input: "src/camera.ts",
          kind: "file",
          mime: "text/typescript; charset=utf-8",
          normalizedInput: "src/camera.ts",
          path: `${workspaceRoot}\\src\\camera.ts`,
          renderer: "code-viewer",
          textReadable: true,
          title: "camera.ts",
          workspaceRoot,
        },
        status: "ready",
      }),
    })

    await waitFor(() => {
      expect(container.querySelector(".code-highlight-token")).not.toBeNull()
    })
    expect(container.querySelector(".unified-preview-code")).toHaveAttribute("data-theme", "vitesse-dark")
    expect(container.querySelector(".code-highlight-line-number")).toHaveTextContent("1")
    expect(container.querySelector(".code-highlight-row")).toHaveTextContent("const camera = 1")
    expect(container.querySelector(".code-highlight-raw-line")).toHaveTextContent("const camera = 1")
    expect(container.querySelector(".code-highlight-token")).not.toHaveClass("is-keyword")
  })

  it("uses Shiki token lines for multiline HTML code", async () => {
    window.desktop!.readPreviewText = vi.fn().mockResolvedValue({
      content: "<script>\nconst value = `ready\nnow`\n</script>",
      path: `${workspaceRoot}\\src\\index.html`,
    })

    const { container } = renderUnifiedPreviewPanel({
      state: createPreviewState({
        activeTargetInput: "src/index.html",
        draftTarget: "src/index.html",
        resolvedTarget: {
          entry: `${workspaceRoot}\\src\\index.html`,
          externalOpenTarget: {
            kind: "path",
            value: `${workspaceRoot}\\src\\index.html`,
          },
          input: "src/index.html",
          kind: "file",
          mime: "text/html; charset=utf-8",
          normalizedInput: "src/index.html",
          path: `${workspaceRoot}\\src\\index.html`,
          renderer: "code-viewer",
          textReadable: true,
          title: "index.html",
          workspaceRoot,
        },
        status: "ready",
      }),
    })

    await waitFor(() => {
      expect(container.querySelectorAll(".code-highlight-token").length).toBeGreaterThan(0)
    })
    expect(container.querySelectorAll(".code-highlight-row")).toHaveLength(4)
    expect(container.querySelectorAll(".code-highlight-row")[2]).toHaveTextContent("now`")
    expect(container.querySelector(".unified-preview-code")).toHaveAttribute("data-theme", "github-light")
  })

  it("applies the selected Shiki theme foreground and background to code blocks", async () => {
    const { container } = render(<CodeBlockPreview content="const value = 1" language="typescript" theme="dracula" />)
    const codeBlock = container.querySelector<HTMLElement>(".code-highlight")

    await waitFor(() => {
      expect(container.querySelector(".code-highlight-token")).not.toBeNull()
      expect(codeBlock).toHaveAttribute("data-theme", "dracula")
    })
    expect(codeBlock?.style.backgroundColor).not.toBe("")
    expect(codeBlock?.style.color).not.toBe("")
  })

  it("falls back to plain text for unsupported code languages", () => {
    const { container } = render(<CodeBlockPreview content="custom value" language="not-a-language" />)

    expect(container.querySelector(".code-highlight-token")).toBeNull()
    expect(container.querySelector(".code-highlight-row")).toHaveTextContent("custom value")
    expect(container.querySelector(".code-highlight-raw-line")).toHaveTextContent("custom value")
  })

  it("falls back to plain text for large code blocks", () => {
    const content = `const value = 1;\n${"x".repeat(CODE_HIGHLIGHT_MAX_INPUT_LENGTH)}`
    const { container } = render(<CodeBlockPreview content={content} language="typescript" />)

    expect(container.querySelector(".code-highlight-token")).toBeNull()
    expect(container.querySelector(".code-highlight-row")).toHaveTextContent("const value = 1;")
  })

  it("routes web comment toolbar toggles through the active interaction callback", () => {
    const onActiveInteractionChange = vi.fn()
    renderUnifiedPreviewPanel({
      onActiveInteractionChange,
      state: createPreviewState({
        activeTargetInput: "http://localhost:5173",
        committedUrl: "http://localhost:5173/",
        draftTarget: "http://localhost:5173/",
        resolvedTarget: {
          externalOpenTarget: {
            kind: "url",
            value: "http://localhost:5173/",
          },
          input: "http://localhost:5173",
          kind: "url",
          mime: "text/html",
          normalizedInput: "http://localhost:5173/",
          renderer: "url-webview",
          safePreviewUrl: "http://localhost:5173/",
          textReadable: false,
          title: "localhost:5173",
        },
        status: "ready",
      }),
    })

    fireEvent.click(screen.getByRole("button", { name: "Comment" }))

    expect(onActiveInteractionChange).toHaveBeenCalledWith("web.comment")
  })

  it("captures the current preview area from the toolbar shortcut", async () => {
    const capturePreviewScreenshot = vi.fn().mockResolvedValue({
      copiedToClipboard: true,
      path: "C:\\Users\\codex\\preview-comment-screenshots\\capture.png",
    })
    window.desktop!.capturePreviewScreenshot = capturePreviewScreenshot

    const { container } = renderUnifiedPreviewPanel({
      state: createPreviewState({
        activeTargetInput: "http://localhost:5173",
        committedUrl: "http://localhost:5173/",
        draftTarget: "http://localhost:5173/",
        resolvedTarget: {
          externalOpenTarget: {
            kind: "url",
            value: "http://localhost:5173/",
          },
          input: "http://localhost:5173",
          kind: "url",
          mime: "text/html",
          normalizedInput: "http://localhost:5173/",
          renderer: "url-webview",
          safePreviewUrl: "http://localhost:5173/",
          textReadable: false,
          title: "localhost:5173",
        },
        status: "ready",
      }),
    })
    const previewStack = container.querySelector(".unified-preview-stack") as HTMLElement
    vi.spyOn(previewStack, "getBoundingClientRect").mockReturnValue({
      bottom: 280.8,
      height: 240.2,
      left: 12.4,
      right: 332.8,
      top: 40.6,
      width: 320.4,
      x: 12.4,
      y: 40.6,
      toJSON: () => ({}),
    })

    fireEvent.click(screen.getByRole("button", { name: "Capture screenshot" }))

    await waitFor(() => {
      expect(capturePreviewScreenshot).toHaveBeenCalledWith({
        bounds: {
          height: 240,
          width: 320,
          x: 12,
          y: 41,
        },
        copyToClipboard: true,
        url: "http://localhost:5173/",
      })
    })
    expect(await screen.findByText("Screenshot saved and copied to clipboard.")).toBeInTheDocument()
    expect(container.querySelector(".unified-preview-status-message")).toBeNull()
  })


  it("commits web comment interactions through the preview interaction host", async () => {
    const onCommitInteraction = vi.fn()
    renderUnifiedPreviewPanel({
      onCommitInteraction,
      state: createPreviewState({
        activeInteractionID: "web.comment",
        activeTargetInput: "http://localhost:5173",
        committedUrl: "http://localhost:5173/",
        draftTarget: "http://localhost:5173/",
        resolvedTarget: {
          externalOpenTarget: {
            kind: "url",
            value: "http://localhost:5173/",
          },
          input: "http://localhost:5173",
          kind: "url",
          mime: "text/html",
          normalizedInput: "http://localhost:5173/",
          renderer: "url-webview",
          safePreviewUrl: "http://localhost:5173/",
          textReadable: false,
          title: "localhost:5173",
        },
        status: "ready",
      }),
    })

    fireEvent.click(screen.getByTestId("preview-interaction-overlay"), {
      clientX: 20,
      clientY: 20,
    })
    fireEvent.change(await screen.findByLabelText("Comment text"), {
      target: { value: "Fix the hero spacing." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(onCommitInteraction).toHaveBeenCalledWith(expect.objectContaining({
        pluginID: "web.comment",
        renderer: "url-webview",
        targetKey: "http://localhost:5173/",
        payload: expect.objectContaining({
          kind: "web-comment",
          pageUrl: "http://localhost:5173/",
          text: "Fix the hero spacing.",
        }),
      }))
    })
  })

  it("renders saved web comment markers for the current preview target", () => {
    const { container } = renderUnifiedPreviewPanel({
      state: createPreviewState({
        activeInteractionID: null,
        activeTargetInput: "http://localhost:5173",
        committedUrl: "http://localhost:5173/",
        draftTarget: "http://localhost:5173/",
        interactions: [
          createWebCommentRecord({
            id: "comment-1",
            text: "Tighten the hero spacing.",
            x: 18,
            y: 21,
          }),
          createWebCommentRecord({
            id: "comment-2",
            text: "Make the card label clearer.",
            x: 47,
            y: 36,
          }),
          createWebCommentRecord({
            id: "comment-other-target",
            targetKey: "http://localhost:3000/",
            text: "This marker belongs to another page.",
            x: 80,
            y: 80,
          }),
        ],
        resolvedTarget: {
          externalOpenTarget: {
            kind: "url",
            value: "http://localhost:5173/",
          },
          input: "http://localhost:5173",
          kind: "url",
          mime: "text/html",
          normalizedInput: "http://localhost:5173/",
          renderer: "url-webview",
          safePreviewUrl: "http://localhost:5173/",
          textReadable: false,
          title: "localhost:5173",
        },
        status: "ready",
      }),
    })

    const markers = container.querySelectorAll(".preview-comment-marker")
    expect(markers).toHaveLength(2)
    expect(markers[0]).toHaveTextContent("1")
    expect(markers[0]).toHaveStyle({ left: "18%", top: "21%" })
    expect(markers[0]).toHaveAttribute("aria-label", "Comment 1: Tighten the hero spacing.")
    expect(markers[1]).toHaveTextContent("2")
    expect(markers[1]).toHaveStyle({ left: "47%", top: "36%" })
    expect(screen.queryByText("3")).toBeNull()
  })

  it("keeps the preview toolbar focused on navigation and the target input", () => {
    const { container } = renderUnifiedPreviewPanel({
      state: createPreviewState({
        activeTargetInput: "heroes.csv",
        draftTarget: "heroes.csv",
        resolvedTarget: {
          entry: `${workspaceRoot}\\heroes.csv`,
          externalOpenTarget: {
            kind: "path",
            value: `${workspaceRoot}\\heroes.csv`,
          },
          input: "heroes.csv",
          kind: "file",
          mime: "text/csv",
          normalizedInput: "heroes.csv",
          path: `${workspaceRoot}\\heroes.csv`,
          renderer: "table-preview",
          textReadable: true,
          title: "heroes.csv",
          workspaceRoot,
        },
        status: "ready",
      }),
    })

    const toolbar = screen.getByRole("textbox", { name: "Preview target" }).closest(".unified-preview-toolbar")
    const address = screen.getByRole("textbox", { name: "Preview target" }).closest(".preview-toolbar-address")
    expect(toolbar).not.toBeNull()
    expect(address).not.toBeNull()
    expect(container.querySelector(".unified-preview-title-row")).toBeNull()
    expect(container.querySelector(".unified-preview-target-summary")).toBeNull()
    expect(container.querySelector(".unified-preview-meta")).toBeNull()
    expect(screen.getAllByDisplayValue("heroes.csv")).toHaveLength(1)
    expect(within(address as HTMLElement).getByRole("button", { name: "Open externally" })).toBeInTheDocument()
    expect(within(toolbar as HTMLElement).queryByText("CSV")).toBeNull()
    expect(within(toolbar as HTMLElement).queryByText("file")).toBeNull()
    expect(within(toolbar as HTMLElement).queryByText("text/csv")).toBeNull()
    expect(within(toolbar as HTMLElement).queryByRole("button", { name: "Open" })).toBeNull()
  })

  it("shows the system-open fallback and delegates external opening", () => {
    const onOpenExternal = vi.fn()
    renderUnifiedPreviewPanel({
      onOpenExternal,
      state: createPreviewState({
        activeTargetInput: "archive.zip",
        draftTarget: "archive.zip",
        resolvedTarget: {
          entry: `${workspaceRoot}\\archive.zip`,
          externalOpenTarget: {
            kind: "path",
            value: `${workspaceRoot}\\archive.zip`,
          },
          input: "archive.zip",
          kind: "file",
          mime: "application/octet-stream",
          normalizedInput: "archive.zip",
          path: `${workspaceRoot}\\archive.zip`,
          renderer: "system-open",
          textReadable: false,
          title: "archive.zip",
          workspaceRoot,
        },
        status: "ready",
      }),
    })

    const fallback = screen.getByText("No inline renderer").closest(".unified-preview-message")
    expect(fallback).not.toBeNull()
    fireEvent.click(within(fallback as HTMLElement).getByRole("button", { name: "Open externally" }))

    expect(onOpenExternal).toHaveBeenCalledTimes(1)
  })
})
