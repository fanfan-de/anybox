import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  SemanticTokenInspection,
  SemanticTokenInspectorEvent,
  SemanticTokenInspectorInspectInput,
  SemanticTokenInspectorInspectResult,
  SemanticTokenInspectorStopResult,
} from "../../../../shared/semantic-token-inspector"
import { ToastProvider } from "../toast"
import { SemanticTokenInspectorOverlay } from "./SemanticTokenInspectorOverlay"

const inspection: SemanticTokenInspection = {
  target: {
    tagName: "BUTTON",
    id: "target-button",
    classes: ["plugin-market-tag"],
    borderQuad: [10, 20, 150, 20, 150, 52, 10, 52],
  },
  properties: [
    {
      property: "background-color",
      authoredProperty: "background-color",
      authoredValue: "var(--semantic-plugin-market-tag-surface)",
      computedValue: "rgb(242, 214, 214)",
      confidence: "exact",
      diagnosis: "semantic-runtime",
      severity: "pass",
      summary: "组件使用已登记的 runtime token",
      scope: "direct",
      source: {
        selector: ".plugin-market-tag",
        origin: "regular",
        sourceURL: "settings.css",
        line: 21,
        column: 3,
        editRef: "opaque-background-edit",
        ruleRef: "opaque-background-rule",
      },
      tokens: [
        {
          name: "--semantic-plugin-market-tag-surface",
          depth: 0,
          kind: "semantic-runtime",
          value: "var(--semantic-plugin-market-tag-surface-light)",
        },
        {
          name: "--semantic-plugin-market-tag-surface-light",
          depth: 1,
          kind: "semantic-mode",
          value: "#f2d6d6",
          mode: "light",
        },
      ],
    },
  ],
  channels: [
    {
      id: "background-color",
      kind: "background",
      label: "背景",
      cssProperty: "background-color",
      authoredProperty: "background-color",
      authoredValue: "var(--semantic-plugin-market-tag-surface)",
      computedColor: "rgb(242, 214, 214)",
      visibility: "visible",
      currentRuntimeToken: "semantic-plugin-market-tag-surface",
      state: "default",
      stateLabel: "Default",
      scopeDescription: "当前命中 selector 的 author rule",
      previewable: true,
      writable: true,
      editRef: "opaque-background-edit",
      insertionRules: [],
    },
  ],
  warnings: [],
}

describe("SemanticTokenInspectorOverlay", () => {
  let inspectorEventListener: ((event: SemanticTokenInspectorEvent) => void) | null
  let inspectAtPoint: ReturnType<typeof vi.fn<
    (input: SemanticTokenInspectorInspectInput) => Promise<SemanticTokenInspectorInspectResult>
  >>
  let stopInspector: ReturnType<typeof vi.fn<() => Promise<SemanticTokenInspectorStopResult>>>

  beforeEach(() => {
    inspectorEventListener = null
    inspectAtPoint = vi.fn(async (input: SemanticTokenInspectorInspectInput): Promise<SemanticTokenInspectorInspectResult> => ({
      status: "ok" as const,
      requestID: input.requestID,
      inspection,
    }))
    stopInspector = vi.fn(async (): Promise<SemanticTokenInspectorStopResult> => ({ status: "inactive" }))
    window.desktop = {
      platform: "win32",
      versions: {},
      getInfo: vi.fn().mockResolvedValue({
        platform: "win32",
        electron: "42",
        chrome: "142",
        node: "24",
      }),
      startSemanticTokenInspector: vi.fn().mockResolvedValue({ status: "active" }),
      inspectSemanticTokenAtPoint: inspectAtPoint,
      stopSemanticTokenInspector: stopInspector,
      prepareSemanticTokenAuthoringCommit: vi.fn().mockResolvedValue({
        status: "prepared",
        transactionID: "transaction-1",
        files: [{
          path: "src/renderer/src/styles/settings.css",
          kind: "css",
          diff: "- background-color: old;\n+ background-color: var(--semantic-plugin-market-tag-surface);",
          additions: 1,
          deletions: 1,
        }],
        summary: {
          bindingEdits: 1,
          tokenValueEdits: 0,
          tokenCreations: 0,
          generatedFiles: [],
        },
      }),
      commitSemanticTokenAuthoringCommit: vi.fn().mockResolvedValue({
        status: "committed",
        files: ["src/renderer/src/styles/settings.css"],
        generatedFiles: [],
        verification: "pending-hmr",
      }),
      discardSemanticTokenAuthoringCommit: vi.fn().mockResolvedValue({
        status: "discarded",
      }),
      onSemanticTokenInspectorEvent: vi.fn((listener) => {
        inspectorEventListener = listener
        return () => {
          inspectorEventListener = null
        }
      }),
    }
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 0)
    window.cancelAnimationFrame = (id) => window.clearTimeout(id)
  })

  it("keeps normal clicks interactive, pins from the native Alt event, copies a token, and exits with Escape", async () => {
    const targetClick = vi.fn()
    const onEnabledChange = vi.fn()
    render(
      <ToastProvider>
        <button id="target-button" className="plugin-market-tag" onClick={targetClick}>Target</button>
        <SemanticTokenInspectorOverlay
          enabled
          resolvedColorMode="light"
          onEnabledChange={onEnabledChange}
        />
      </ToastProvider>,
    )
    const target = screen.getByRole("button", { name: "Target" })
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    })

    await waitFor(() => {
      expect(window.desktop?.startSemanticTokenInspector).toHaveBeenCalledTimes(1)
      expect(document.querySelector(".semantic-token-inspector-overlay.is-active")).toBeInTheDocument()
    })
    await waitFor(() => {
      fireEvent.pointerMove(target, { clientX: 80, clientY: 90 })
      expect(inspectAtPoint).toHaveBeenCalledWith(expect.objectContaining({
        x: 80,
        y: 90,
        ancestorDepth: 0,
        resolvedColorMode: "light",
      }))
      expect(screen.getByText("--semantic-plugin-market-tag-surface")).toBeInTheDocument()
    })

    fireEvent.pointerDown(target, { clientX: 80, clientY: 90, button: 0 })
    fireEvent.click(target)
    expect(targetClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog", { name: "Semantic token inspection details" })).not.toBeInTheDocument()

    expect(inspectorEventListener).not.toBeNull()
    act(() => {
      inspectorEventListener?.({ type: "pin-current" })
    })
    expect(screen.getByRole("dialog", { name: "Semantic token inspection details" })).toBeInTheDocument()
    expect(screen.getByText("Alt 固定当前")).toBeInTheDocument()
    expect(targetClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("dialog", { name: "Semantic token inspection details" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("tab", { name: "检查" }))
    fireEvent.click(screen.getByTitle("Copy --semantic-plugin-market-tag-surface"))
    await waitFor(() => {
      expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith("--semantic-plugin-market-tag-surface")
    })

    fireEvent.click(screen.getByTitle("Resume hover inspection"))
    expect(screen.queryByRole("dialog", { name: "Semantic token inspection details" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "固定详情" }))
    expect(screen.getByRole("dialog", { name: "Semantic token inspection details" })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: "Escape" })
    expect(onEnabledChange).toHaveBeenCalledWith(false)
  })

  it("keeps a hot-reloaded renderer usable when the running main process returns a legacy inspection", async () => {
    const legacyInspection = { ...inspection } as Partial<SemanticTokenInspection>
    delete legacyInspection.channels
    inspectAtPoint.mockImplementation(async (input) => ({
      status: "ok",
      requestID: input.requestID,
      inspection: legacyInspection as SemanticTokenInspection,
    }))
    render(
      <ToastProvider>
        <button id="legacy-target">Legacy target</button>
        <SemanticTokenInspectorOverlay
          enabled
          resolvedColorMode="light"
          onEnabledChange={vi.fn()}
        />
      </ToastProvider>,
    )
    const target = screen.getByRole("button", { name: "Legacy target" })
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    })

    await waitFor(() => {
      fireEvent.pointerMove(target, { clientX: 64, clientY: 72 })
      expect(screen.getByText("--semantic-plugin-market-tag-surface")).toBeInTheDocument()
    })
    fireEvent.click(document.querySelector(".semantic-token-inspector-property-summary")!)

    expect(screen.getByRole("dialog", { name: "Semantic token inspection details" })).toBeVisible()
    expect(screen.getByText("没有可检测的颜色通道。")).toBeVisible()
  })

  it("turns itself off when Electron reports a debugger detach", async () => {
    const onEnabledChange = vi.fn()
    render(
      <ToastProvider>
        <SemanticTokenInspectorOverlay
          enabled
          resolvedColorMode="dark"
          onEnabledChange={onEnabledChange}
        />
      </ToastProvider>,
    )

    await waitFor(() => expect(inspectorEventListener).not.toBeNull())
    act(() => {
      inspectorEventListener?.({
        type: "detached",
        reason: "devtools-opened",
        message: "Semantic Token Inspector stopped because DevTools was opened.",
      })
    })

    await waitFor(() => {
      expect(onEnabledChange).toHaveBeenCalledWith(false)
      expect(screen.getByRole("alert")).toHaveTextContent("Semantic Token Inspector stopped because DevTools was opened.")
    })
  })

  it("reports activation failure and does not leave the preference enabled", async () => {
    vi.mocked(window.desktop!.startSemanticTokenInspector!).mockResolvedValueOnce({
      status: "blocked",
      reason: "devtools-open",
      message: "Close DevTools before enabling Semantic Token Inspector.",
    })
    const onEnabledChange = vi.fn()
    render(
      <ToastProvider>
        <SemanticTokenInspectorOverlay
          enabled
          resolvedColorMode="light"
          onEnabledChange={onEnabledChange}
        />
      </ToastProvider>,
    )

    await waitFor(() => {
      expect(onEnabledChange).toHaveBeenCalledWith(false)
      expect(screen.getByRole("alert")).toHaveTextContent("Close DevTools before enabling Semantic Token Inspector.")
    })
    expect(inspectAtPoint).not.toHaveBeenCalled()
  })

  it("opens Style from a hover color row, previews a binding, and commits the review transaction", async () => {
    vi.mocked(window.desktop!.startSemanticTokenInspector!).mockResolvedValueOnce({
      status: "active",
      authoring: {
        status: "available",
        sessionID: "authoring-session-1",
        defaultSourceThemeID: "built-in:classic",
        sourceThemes: [{ id: "built-in:classic", name: "经典" }],
      },
    })
    const onEnabledChange = vi.fn()
    const onAuthoringCommitted = vi.fn()
    render(
      <ToastProvider>
        <button id="target-button" className="plugin-market-tag">Target</button>
        <SemanticTokenInspectorOverlay
          enabled
          resolvedColorMode="light"
          onEnabledChange={onEnabledChange}
          onAuthoringCommitted={onAuthoringCommitted}
        />
      </ToastProvider>,
    )
    const target = screen.getByRole("button", { name: "Target" })
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    })

    await waitFor(() => {
      fireEvent.pointerMove(target, { clientX: 70, clientY: 80 })
      expect(screen.getByText("--semantic-plugin-market-tag-surface")).toBeInTheDocument()
    })
    fireEvent.click(document.querySelector(".semantic-token-inspector-property-summary")!)
    expect(screen.getByRole("tab", { name: "样式" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("颜色通道")).toBeInTheDocument()
    expect(screen.getByText("选择要绑定或调色的视觉属性")).toBeInTheDocument()
    expect(screen.getByText("绑定 Semantic Token")).toBeInTheDocument()
    const targetContext = screen.getByText("当前元素").closest("details")
    expect(targetContext).not.toHaveAttribute("open")
    expect(targetContext?.querySelector("nav[aria-label='DOM ancestors']")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /背景.*background-color/ })).toBeInTheDocument()

    const tokenSearch = screen.getByRole("combobox", {
      name: "搜索 背景 Semantic Token",
    })
    fireEvent.change(tokenSearch, {
      target: { value: "semantic-plugin-market-tag-surface" },
    })
    const option = await screen.findByRole("option", {
      name: /semantic-plugin-market-tag-surface/,
    })
    fireEvent.click(option)

    await waitFor(() => {
      expect(screen.getByText("1 项未保存修改")).toBeInTheDocument()
      expect(target).toHaveAttribute("data-semantic-token-authoring-target")
      expect(document.querySelector("style[data-semantic-token-authoring-preview]")?.textContent)
        .toContain("background-color: var(--semantic-plugin-market-tag-surface) !important")
    })

    fireEvent.click(screen.getByRole("button", { name: "撤销" }))
    await waitFor(() => expect(screen.queryByText("1 项未保存修改")).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "重做" }))
    await waitFor(() => expect(screen.getByText("1 项未保存修改")).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: "审阅变更" }))
    expect(await screen.findByRole("dialog", { name: "审阅 Semantic Token 修改" })).toBeInTheDocument()
    expect(window.desktop?.prepareSemanticTokenAuthoringCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "authoring-session-1",
        draft: expect.objectContaining({
          sourceThemeID: "built-in:classic",
          operations: [expect.objectContaining({
            kind: "binding-edit",
            editRef: "opaque-background-edit",
            runtimeToken: "semantic-plugin-market-tag-surface",
          })],
        }),
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "确认写回源码" }))
    await waitFor(() => {
      expect(window.desktop?.commitSemanticTokenAuthoringCommit).toHaveBeenCalledWith({
        transactionID: "transaction-1",
      })
      expect(target).not.toHaveAttribute("data-semantic-token-authoring-target")
      expect(onAuthoringCommitted).toHaveBeenCalledWith(expect.objectContaining({
        sourceThemeID: "built-in:classic",
        operations: [expect.objectContaining({
          kind: "binding-edit",
          runtimeToken: "semantic-plugin-market-tag-surface",
        })],
      }))
    })
  })
})
