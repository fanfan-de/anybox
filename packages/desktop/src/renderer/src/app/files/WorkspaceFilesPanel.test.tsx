import { fireEvent, render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { WorkspaceFileReviewState } from "../types"
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
  }> = {},
) {
  return render(
    <WorkspaceFilesPanel
      canInsertCommentsIntoDraft={true}
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

  it("collapses and restores the file tree from the path bar", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Collapse file tree" }))

    expect(screen.queryByRole("searchbox", { name: "Filter workspace files" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Expand file tree" })).toHaveAttribute("aria-expanded", "false")

    fireEvent.click(screen.getByRole("button", { name: "Expand file tree" }))

    expect(screen.getByRole("searchbox", { name: "Filter workspace files" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Collapse file tree" })).toHaveAttribute("aria-expanded", "true")
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

  it("renders selected text file lines in the reader", () => {
    renderWorkspaceFilesPanel(
      createFileReviewState({
        selectedFileContent: "const camera = { x: 0, y: 0 };\n\nfunction updateCamera() {\n  return camera.x;\n}",
        selectedFileExtension: ".js",
        selectedFileKind: "text",
        selectedFilePath: "src/camera.js",
        status: "ready",
      }),
    )

    expect(screen.getByText("src/camera.js")).toBeVisible()
    expect(screen.getByTestId("workspace-file-line-1")).toHaveTextContent("const camera = { x: 0, y: 0 };")
    expect(screen.getByTestId("workspace-file-line-4")).toHaveTextContent("return camera.x;")
    expect(screen.getByTestId("workspace-file-line-1").querySelector(".code-highlight-token.is-keyword")).toHaveTextContent("const")
    expect(screen.getByTestId("workspace-file-line-1").querySelector(".code-highlight-token.is-number")).toHaveTextContent("0")
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

  it("highlights and scrolls to linked line ranges without opening a comment draft", () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })

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
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
    })
  })

  it("keeps file reader text on readable panel colors", () => {
    const styles = readRightSidebarStyles()

    expect(styles).toMatch(
      /\.workspace-files-panel\s*\{[^}]*height:\s*100%;[^}]*flex:\s*1 1 auto;[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[^}]*align-content:\s*stretch;/s,
    )
    expect(styles).toMatch(
      /\.right-sidebar-view-host\.is-preview,\s*\.right-sidebar-view-host\.is-files,\s*\.right-sidebar-view-host\.is-changes,\s*\.right-sidebar-view-host\.is-terminal,\s*\.right-sidebar-view-host\.is-message-tree,\s*\.right-sidebar-view-host\.is-side-chat\s*\{[^}]*scrollbar-gutter:\s*auto;[^}]*padding-right:\s*0;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-reader\s*\{[^}]*height:\s*100%;[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-split\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) clamp\(320px,\s*44%,\s*520px\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-tree-toggle\s*\{[^}]*width:\s*24px;[^}]*margin-left:\s*auto;[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-split\.is-tree-collapsed\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-tree-search\s*\{[^}]*height:\s*28px;[^}]*grid-template-columns:\s*16px minmax\(0,\s*1fr\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-tree-row\s*\{[^}]*min-height:\s*24px;[^}]*grid-template-columns:\s*14px 18px minmax\(0,\s*1fr\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-markdown-stage\s*\{[^}]*scrollbar-color:\s*var\(--mix-seg-text-3-54-transparent-46\) var\(--seg-panel\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-markdown-stage::-webkit-scrollbar-track\s*\{[^}]*background:\s*var\(--seg-panel\);/s,
    )
    expect(styles).not.toContain(".workspace-files-results-dropdown")
    expect(styles).toMatch(
      /\.workspace-files-code\s*\{[^}]*background:\s*var\(--seg-panel\);[^}]*color:\s*var\(--seg-text-1\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-line-content,\s*\.workspace-files-line-content code\s*\{[^}]*color:\s*var\(--seg-text-1\);/s,
    )
    expect(styles).not.toMatch(
      /\.workspace-files-line-content,\s*\.workspace-files-line-content code\s*\{[^}]*color:\s*var\(--text-on-dark\);/s,
    )
  })
})
