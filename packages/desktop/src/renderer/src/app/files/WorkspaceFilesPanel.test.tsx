import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { WorkspaceFileReviewState } from "../types"
import type { CodeHighlightTheme } from "../code-theme"
import { WorkspaceFilesPanel } from "./WorkspaceFilesPanel"

function createFileReviewState(overrides: Partial<WorkspaceFileReviewState> = {}): WorkspaceFileReviewState {
  return {
    comments: [],
    errorMessage: null,
    linkedLineRange: null,
    pendingComment: null,
    query: "",
    results: [],
    scopeDirectory: "C:/workspace",
    treeEntriesByDirectoryPath: {},
    treeErrorByDirectoryPath: {},
    treeExpandedDirectoryPaths: [],
    treeLoadingDirectoryPaths: [],
    selectedFileContent: null,
    selectedFileExtension: null,
    selectedFileKind: null,
    selectedFileMimeType: null,
    selectedFilePreviewUrl: null,
    selectedFileSize: null,
    selectedFilePath: null,
    status: "idle",
    ...overrides,
  }
}

function renderWorkspaceFilesPanel(
  state: WorkspaceFileReviewState,
  handlers: Partial<{
    onDirectoryLoad: (path: string) => void
    onDirectoryToggle: (path: string) => void
    onQueryChange: (value: string) => void
    onSelectFile: (path: string, options?: { linkedLineRange?: { startLineNumber: number; endLineNumber: number } | null }) => void
    onTreeInvalidate: (paths: string[]) => void
    codeTheme: CodeHighlightTheme
  }> = {},
) {
  return render(
    <WorkspaceFilesPanel
      canInsertCommentsIntoDraft={true}
      codeTheme={handlers.codeTheme ?? "github-light"}
      scopeDirectory="C:/workspace"
      scopeName="Workspace"
      state={state}
      onDirectoryLoad={handlers.onDirectoryLoad ?? vi.fn()}
      onDirectoryToggle={handlers.onDirectoryToggle ?? vi.fn()}
      onPendingCommentCancel={vi.fn()}
      onPendingCommentChange={vi.fn()}
      onPendingCommentConfirm={vi.fn()}
      onPendingCommentStart={vi.fn()}
      onQueryChange={handlers.onQueryChange ?? vi.fn()}
      onSelectFile={handlers.onSelectFile ?? vi.fn()}
      onTreeInvalidate={handlers.onTreeInvalidate ?? vi.fn()}
    />,
  )
}

function readRightSidebarStyles() {
  return readFileSync(resolve(process.cwd(), "src/renderer/src/styles/right-sidebar.css"), "utf8")
}

describe("WorkspaceFilesPanel", () => {
  it("renders the Codex-style open-file empty state and requests the root tree", () => {
    const onDirectoryLoad = vi.fn()

    renderWorkspaceFilesPanel(createFileReviewState(), { onDirectoryLoad })

    expect(screen.getByText("打开文件")).toBeVisible()
    expect(screen.getByText("从工作区目录树中选择文件")).toBeVisible()
    expect(screen.getByRole("searchbox", { name: "Filter workspace files" })).toBeVisible()
    expect(onDirectoryLoad).toHaveBeenCalledWith("")
  })

  it("shows a loading title instead of an open failure while reading a selected file", () => {
    renderWorkspaceFilesPanel(
      createFileReviewState({
        selectedFilePath: "README.md",
        status: "reading",
      }),
    )

    expect(screen.getByText("正在加载文件")).toBeVisible()
    expect(screen.getByText("Loading file preview.")).toBeVisible()
    expect(screen.queryByText("无法打开文件")).not.toBeInTheDocument()
  })

  it("renders a persistent file tree and toggles directories lazily", () => {
    const onDirectoryToggle = vi.fn()
    const onSelectFile = vi.fn()

    renderWorkspaceFilesPanel(
      createFileReviewState({
        treeEntriesByDirectoryPath: {
          "": [
            {
              path: "src",
              name: "src",
              kind: "directory",
              extension: null,
              hasChildren: true,
            },
            {
              path: "README.md",
              name: "README.md",
              kind: "file",
              extension: "md",
              hasChildren: false,
            },
          ],
        },
      }),
      { onDirectoryToggle, onSelectFile },
    )

    fireEvent.click(screen.getByRole("button", { name: /src/ }))
    expect(onDirectoryToggle).toHaveBeenCalledWith("src")

    fireEvent.click(screen.getByRole("button", { name: /README\.md/ }))
    expect(onSelectFile).toHaveBeenCalledWith("README.md")
  })

  it("collapses and restores the file filter panel from the path bar", () => {
    renderWorkspaceFilesPanel(
      createFileReviewState({
        treeEntriesByDirectoryPath: {
          "": [
            {
              path: "README.md",
              name: "README.md",
              kind: "file",
              extension: "md",
              hasChildren: false,
            },
          ],
        },
      }),
    )

    expect(screen.getByRole("searchbox", { name: "Filter workspace files" })).toBeVisible()
    expect(screen.getByRole("separator", { name: "Resize file filter panel" })).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Hide file filters" }))

    expect(screen.queryByRole("searchbox", { name: "Filter workspace files" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Show file filters" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("separator", { name: "Resize file filter panel" })).not.toBeInTheDocument()
    expect(document.querySelector(".workspace-files-split-handle")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Show file filters" }))

    expect(screen.getByRole("searchbox", { name: "Filter workspace files" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Hide file filters" })).toHaveAttribute("aria-expanded", "true")
  })

  it("resizes the file filter panel from the split separator", () => {
    const { container } = renderWorkspaceFilesPanel(
      createFileReviewState({
        treeEntriesByDirectoryPath: {
          "": [
            {
              path: "README.md",
              name: "README.md",
              kind: "file",
              extension: "md",
              hasChildren: false,
            },
          ],
        },
      }),
    )
    const split = container.querySelector<HTMLElement>(".workspace-files-split")
    expect(split).not.toBeNull()
    vi.spyOn(split!, "getBoundingClientRect").mockReturnValue({
      bottom: 600,
      height: 600,
      left: 0,
      right: 1000,
      toJSON: () => ({}),
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
    } as DOMRect)

    const separator = screen.getByRole("separator", { name: "Resize file filter panel" })
    fireEvent.pointerDown(separator, { button: 0, clientX: 620 })

    expect(split!.style.getPropertyValue("--workspace-files-tree-width")).toBe("380px")
    expect(separator).toHaveAttribute("aria-valuenow", "380")

    fireEvent.keyDown(separator, { key: "ArrowLeft" })

    expect(split!.style.getPropertyValue("--workspace-files-tree-width")).toBe("404px")
    expect(separator).toHaveAttribute("aria-valuenow", "404")
  })

  it("filters the loaded tree without rendering a result dropdown", () => {
    const onQueryChange = vi.fn()

    renderWorkspaceFilesPanel(
      createFileReviewState({
        query: "read",
        treeEntriesByDirectoryPath: {
          "": [
            {
              path: "src",
              name: "src",
              kind: "directory",
              extension: null,
              hasChildren: true,
            },
            {
              path: "README.md",
              name: "README.md",
              kind: "file",
              extension: "md",
              hasChildren: false,
            },
          ],
        },
      }),
      { onQueryChange },
    )

    expect(screen.queryByRole("button", { name: /src/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /README\.md/ })).toBeVisible()
    expect(screen.queryByLabelText("Workspace file search results")).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter workspace files" }), {
      target: { value: "src" },
    })
    expect(onQueryChange).toHaveBeenCalledWith("src")
  })

  it("renders selected text file lines in the reader with Shiki tokens", async () => {
    const { container } = renderWorkspaceFilesPanel(
      createFileReviewState({
        selectedFileContent: "const camera = { x: 0, y: 0 };\n\nfunction updateCamera() {\n  return camera.x;\n}",
        selectedFileExtension: ".js",
        selectedFileKind: "text",
        selectedFilePath: "src/camera.js",
        status: "ready",
      }),
      { codeTheme: "dracula" },
    )

    expect(screen.getByText("src/camera.js")).toBeVisible()
    const firstLine = screen.getByTestId("workspace-file-line-1")
    expect(firstLine).toHaveTextContent("const camera = { x: 0, y: 0 };")
    expect(screen.getByTestId("workspace-file-line-4")).toHaveTextContent("return camera.x;")
    await waitFor(() => {
      expect(firstLine.querySelector(".code-highlight-token")).not.toBeNull()
    })
    const tokenTexts = Array.from(firstLine.querySelectorAll(".code-highlight-token")).map((token) => token.textContent)
    expect(tokenTexts).toContain("const")
    expect(tokenTexts).toContain("0")
    expect(firstLine.querySelector(".code-highlight-raw-line")).toHaveTextContent("const camera = { x: 0, y: 0 };")
    const codeContainer = container.querySelector<HTMLElement>(".workspace-files-code")
    expect(codeContainer).toHaveAttribute("data-theme", "dracula")
    expect(codeContainer?.style.getPropertyValue("--code-highlight-bg")).not.toBe("")
    expect(codeContainer?.style.getPropertyValue("--code-highlight-fg")).not.toBe("")
  })

  it("virtualizes large source files and renders distant lines after scrolling", () => {
    const content = Array.from({ length: 500 }, (_, index) => `line ${index + 1}`).join("\n")
    const { container } = renderWorkspaceFilesPanel(
      createFileReviewState({
        selectedFileContent: content,
        selectedFileExtension: ".txt",
        selectedFileKind: "text",
        selectedFilePath: "notes/large.txt",
        status: "ready",
      }),
    )

    const codeContainer = container.querySelector<HTMLElement>(".workspace-files-code")
    expect(codeContainer).not.toBeNull()
    expect(codeContainer).toHaveAttribute("data-virtualized", "true")
    expect(codeContainer).toHaveAttribute("data-line-count", "500")
    expect(container.querySelectorAll(".workspace-files-line").length).toBeLessThan(90)
    expect(screen.queryByTestId("workspace-file-line-200")).not.toBeInTheDocument()

    codeContainer!.scrollTop = 200 * 24
    fireEvent.scroll(codeContainer!)

    expect(screen.getByTestId("workspace-file-line-200")).toHaveTextContent("line 200")
    expect(screen.queryByTestId("workspace-file-line-1")).not.toBeInTheDocument()
    expect(container.querySelectorAll(".workspace-files-line").length).toBeLessThan(90)
  })

  it("renders Markdown files by default and can switch back to source", () => {
    renderWorkspaceFilesPanel(
      createFileReviewState({
        selectedFileContent: "# Guide\n\n**Ready**",
        selectedFileExtension: "md",
        selectedFileKind: "text",
        selectedFilePath: "README.md",
        status: "ready",
      }),
    )

    expect(screen.getByRole("heading", { name: "Guide" })).toBeVisible()
    expect(screen.queryByTestId("workspace-file-line-1")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Source/ }))

    expect(screen.getByTestId("workspace-file-line-1")).toHaveTextContent("# Guide")
    expect(screen.queryByRole("heading", { name: "Guide" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Rendered/ }))

    expect(screen.getByRole("heading", { name: "Guide" })).toBeVisible()
  })

  it("resolves Markdown relative links and images from the current file directory", () => {
    const onSelectFile = vi.fn()

    renderWorkspaceFilesPanel(
      createFileReviewState({
        selectedFileContent: "![Logo](./assets/logo.png)\n\n[Setup](../setup.md#L4-L6)",
        selectedFileExtension: "md",
        selectedFileKind: "text",
        selectedFilePath: "docs/guides/README.md",
        status: "ready",
      }),
      { onSelectFile },
    )

    expect(screen.getByRole("img", { name: "Logo" })).toHaveAttribute(
      "src",
      `anybox-local-image://image?source=${encodeURIComponent("C:/workspace/docs/guides/assets/logo.png")}`,
    )

    fireEvent.click(screen.getByRole("link", { name: "Setup" }))

    expect(onSelectFile).toHaveBeenCalledWith("docs/setup.md", {
      linkedLineRange: {
        startLineNumber: 4,
        endLineNumber: 6,
      },
    })
  })

  it("renders image files with preview metadata", () => {
    renderWorkspaceFilesPanel(
      createFileReviewState({
        selectedFileExtension: "png",
        selectedFileKind: "image",
        selectedFileMimeType: "image/png",
        selectedFilePath: "assets/logo.png",
        selectedFilePreviewUrl: "anybox-local-image://image?source=C%3A%5Cworkspace%5Cassets%5Clogo.png",
        selectedFileSize: 2048,
        status: "ready",
      }),
    )

    expect(screen.getByText("image/png")).toBeVisible()
    expect(screen.getByText("2.00 KB")).toBeVisible()
    expect(screen.getByRole("img", { name: "assets/logo.png" })).toHaveAttribute(
      "src",
      "anybox-local-image://image?source=C%3A%5Cworkspace%5Cassets%5Clogo.png",
    )

    expect(screen.getByRole("button", { name: "Fit" })).toHaveClass("is-active")
    fireEvent.click(screen.getByRole("button", { name: "100%" }))
    expect(screen.getByRole("button", { name: "100%" })).toHaveClass("is-active")
    fireEvent.click(screen.getByRole("button", { name: "Zoom in image" }))
    expect(screen.getByText("125%")).toBeVisible()
  })

  it("renders video files with native controls and preview metadata", () => {
    const { container } = renderWorkspaceFilesPanel(
      createFileReviewState({
        selectedFileExtension: "mp4",
        selectedFileKind: "video",
        selectedFileMimeType: "video/mp4",
        selectedFilePath: "assets/demo.mp4",
        selectedFilePreviewUrl: "anybox-local-video://video?source=C%3A%5Cworkspace%5Cassets%5Cdemo.mp4",
        selectedFileSize: 4194304,
        status: "ready",
      }),
    )

    expect(screen.getByText("video/mp4")).toBeVisible()
    expect(screen.getByText("4.00 MB")).toBeVisible()

    const video = container.querySelector("video.workspace-files-video")
    expect(video).toHaveAttribute(
      "src",
      "anybox-local-video://video?source=C%3A%5Cworkspace%5Cassets%5Cdemo.mp4",
    )
    expect(video).toHaveAttribute("controls")
    expect(video).toHaveAttribute("preload", "metadata")
  })

  it("highlights linked line ranges without opening a comment draft", () => {
    renderWorkspaceFilesPanel(
      createFileReviewState({
        linkedLineRange: {
          startLineNumber: 2,
          endLineNumber: 3,
        },
        selectedFileContent: "const a = 1\nconst b = 2\nconst c = 3",
        selectedFileExtension: ".ts",
        selectedFileKind: "text",
        selectedFilePath: "src/linked.ts",
        status: "ready",
      }),
    )

    expect(screen.getByTestId("workspace-file-line-2")).toHaveClass("is-linked", "is-selected")
    expect(screen.getByTestId("workspace-file-line-3")).toHaveClass("is-linked", "is-selected")
    expect(screen.queryByRole("textbox", { name: "File comment on lines 2-3" })).not.toBeInTheDocument()
  })

  it("scrolls the virtual source reader to linked line ranges outside the initial window", async () => {
    const content = Array.from({ length: 320 }, (_, index) => `const value${index + 1} = ${index + 1}`).join("\n")
    const { container } = renderWorkspaceFilesPanel(
      createFileReviewState({
        linkedLineRange: {
          startLineNumber: 220,
          endLineNumber: 222,
        },
        selectedFileContent: content,
        selectedFileExtension: ".ts",
        selectedFileKind: "text",
        selectedFilePath: "src/large-linked.ts",
        status: "ready",
      }),
    )

    const codeContainer = container.querySelector<HTMLElement>(".workspace-files-code")
    expect(codeContainer).not.toBeNull()

    await waitFor(() => {
      expect(codeContainer!.scrollTop).toBeGreaterThan(0)
      expect(screen.getByTestId("workspace-file-line-220")).toHaveClass("is-linked", "is-selected")
      expect(screen.getByTestId("workspace-file-line-222")).toHaveClass("is-linked", "is-selected")
    })
    expect(screen.queryByTestId("workspace-file-line-1")).not.toBeInTheDocument()
  })

  it("lets the file workspace reveal the right sidebar surface", () => {
    const styles = readRightSidebarStyles()

    expect(styles).toMatch(
      /\.right-sidebar-main-stack\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-panel\s*\{[^}]*height:\s*100%;[^}]*flex:\s*1 1 auto;[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[^}]*align-content:\s*stretch;[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.right-sidebar-view-host\.is-preview,\s*\.right-sidebar-view-host\.is-files,\s*\.right-sidebar-view-host\.is-changes,\s*\.right-sidebar-view-host\.is-terminal,\s*\.right-sidebar-view-host\.is-message-inspector,\s*\.right-sidebar-view-host\.is-branch-thread\s*\{[^}]*scrollbar-gutter:\s*auto;[^}]*padding-right:\s*0;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-reader\s*\{[^}]*height:\s*100%;[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-split\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) 8px var\(--workspace-files-tree-width,\s*clamp\(320px,\s*44%,\s*520px\)\);[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-pathbar\s*\{[^}]*border-bottom:\s*1px solid var\(--seg-border\);[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-tree-toggle\s*\{[^}]*width:\s*24px;[^}]*margin-left:\s*auto;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*display:\s*inline-flex;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-splitter\s*\{[^}]*min-width:\s*8px;[^}]*height:\s*100%;[^}]*background:\s*transparent;[^}]*cursor:\s*col-resize;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-splitter:hover::before,\s*\.workspace-files-splitter:focus-visible::before,\s*\.workspace-files-split\.is-resizing\s+\.workspace-files-splitter::before\s*\{[^}]*background:\s*var\(--seg-accent-strong\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-split\.is-tree-collapsed\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-tree-search\s*\{[^}]*height:\s*28px;[^}]*grid-template-columns:\s*16px minmax\(0,\s*1fr\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-tree\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-tree-row\s*\{[^}]*min-height:\s*24px;[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-sidebar-tree-row-text\);[^}]*grid-template-columns:\s*14px 18px minmax\(0,\s*1fr\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-tree-row:hover,\s*\.workspace-files-tree-row:focus-visible\s*\{[^}]*background:\s*var\(--semantic-sidebar-tree-row-surface-hover\);[^}]*color:\s*var\(--semantic-sidebar-tree-row-text-hover\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-tree-row\.is-active\s*\{[^}]*background:\s*var\(--semantic-sidebar-tree-row-surface-active\);[^}]*color:\s*var\(--semantic-sidebar-tree-row-text-active\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-tree-row\.is-active \.workspace-files-tree-chevron,\s*\.workspace-files-tree-row\.is-active \.workspace-files-tree-icon,\s*\.workspace-files-tree-row\.is-active \.workspace-files-tree-file-badge\s*\{[^}]*color:\s*var\(--semantic-sidebar-tree-row-leading-active\);/s,
    )
    expect(styles).not.toMatch(
      /\.workspace-files-tree-row(?:\s*|:hover,\s*\.workspace-files-tree-row:focus-visible\s*|\.is-active\s*)\{[^}]*(?:--seg-text-|--surface-panel-muted|--text-primary|--brand-primary-soft-active|--brand-primary-strong)/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-markdown-stage\s*\{[^}]*background:\s*transparent;[^}]*scrollbar-color:\s*var\(--semantic-scrollbar-thumb-surface-hover\) transparent;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-markdown-stage::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(styles).not.toContain(".workspace-files-results-dropdown")
    expect(styles).toMatch(
      /\.workspace-files-code\s*\{[^}]*background:\s*var\(--code-highlight-bg,\s*var\(--seg-panel\)\);[^}]*color:\s*var\(--code-highlight-fg,\s*var\(--seg-text-1\)\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-code\s*\{[^}]*scrollbar-color:\s*var\(--right-sidebar-scrollbar-thumb\) transparent;[^}]*scrollbar-width:\s*thin;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-code-spacer\s*\{[^}]*pointer-events:\s*none;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-tree-scroll\s*\{[^}]*scrollbar-color:\s*var\(--right-sidebar-scrollbar-thumb\) transparent;[^}]*scrollbar-width:\s*thin;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-code::-webkit-scrollbar-track,\s*\.workspace-files-tree-scroll::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-code::-webkit-scrollbar-thumb,\s*\.workspace-files-tree-scroll::-webkit-scrollbar-thumb\s*\{[^}]*border:\s*3px solid transparent;[^}]*border-radius:\s*999px;[^}]*background:\s*var\(--right-sidebar-scrollbar-thumb\);[^}]*background-clip:\s*content-box;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-line-content,\s*\.workspace-files-line-content code\s*\{[^}]*color:\s*var\(--code-highlight-fg,\s*var\(--seg-text-1\)\);/s,
    )
    expect(styles).toMatch(/\.workspace-files-line:hover\s*\{[^}]*background:/s)
    expect(styles).toMatch(
      /\.workspace-files-line:hover\s+\.workspace-files-line-comment-button,\s*\.workspace-files-line:focus-within\s+\.workspace-files-line-comment-button,\s*\.workspace-files-line\.is-commenting\s+\.workspace-files-line-comment-button\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;[^}]*visibility:\s*visible;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-line-comment-button\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-line-comment-button:hover,\s*\.workspace-files-line-comment-button:focus-visible\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--seg-accent-strong\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-code\.is-selecting-lines\s+\.workspace-files-line-comment-button\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;[^}]*visibility:\s*hidden;/s,
    )
    expect(styles).not.toContain(".workspace-files-line.is-hovered")
    expect(styles).not.toMatch(
      /\.workspace-files-line-content,\s*\.workspace-files-line-content code\s*\{[^}]*color:\s*var\(--text-on-dark\);/s,
    )
  })
})
