import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n/I18nProvider"
import { TerminalPanel } from "./TerminalPanel"
import type { TerminalSessionRecord } from "./types"

const baseSession: TerminalSessionRecord = {
  ptyID: "pty-1",
  sessionID: "session-1",
  terminalKey: "interactive",
  purpose: "interactive",
  title: "Terminal",
  cwd: "/tmp/project",
  shell: "/bin/zsh",
  rows: 24,
  cols: 80,
  status: "running",
  exitCode: null,
  createdAt: 1,
  updatedAt: 1,
  cursor: 0,
  buffer: "",
  scrollTop: 0,
  transportState: "connected",
}

async function flushFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}

afterEach(() => {
  window.localStorage.removeItem("desktop.locale")
})

describe("TerminalPanel", () => {
  it("shows terminal creation errors and lets the user retry", () => {
    const onCreateTerminal = vi.fn()
    render(
      <TerminalPanel
        activeSession={null}
        brandTheme="terra"
        colorMode="light"
        creationError="node-pty spawn helper is not executable"
        isOpen={true}
        panelHeight={280}
        sessions={[]}
        onCloseTerminal={vi.fn()}
        onCreateTerminal={onCreateTerminal}
        onCreateTerminalForShellProfile={vi.fn()}
        onTerminalInitialDimensions={vi.fn()}
        onTerminalInitialDimensionsError={vi.fn()}
        onPanelHeightChange={vi.fn()}
        onShellProfileChange={vi.fn()}
        onSelectTerminal={vi.fn()}
        selectedShellProfileID="default"
        shellProfiles={[
          {
            id: "default",
            label: "Default",
            shell: null,
          },
        ]}
        onTerminalInput={vi.fn()}
        onTerminalResize={vi.fn()}
        onTerminalSnapshotChange={vi.fn()}
        onTogglePanel={vi.fn()}
        subscribeToTerminalStream={() => () => {}}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent("node-pty spawn helper is not executable")

    fireEvent.click(screen.getByRole("button", { name: "Retry" }))

    expect(onCreateTerminal).toHaveBeenCalledTimes(1)
  })

  it("renders the initial dimension probe while creating the first terminal", async () => {
    const onTerminalInitialDimensions = vi.fn()

    render(
      <TerminalPanel
        activeSession={null}
        brandTheme="terra"
        colorMode="light"
        isCreatingTerminal={true}
        isOpen={true}
        panelHeight={280}
        pendingCreateRequestID={4}
        sessions={[]}
        onCloseTerminal={vi.fn()}
        onCreateTerminal={vi.fn()}
        onCreateTerminalForShellProfile={vi.fn()}
        onTerminalInitialDimensions={onTerminalInitialDimensions}
        onTerminalInitialDimensionsError={vi.fn()}
        onPanelHeightChange={vi.fn()}
        onShellProfileChange={vi.fn()}
        onSelectTerminal={vi.fn()}
        selectedShellProfileID="default"
        shellProfiles={[
          {
            id: "default",
            label: "Default",
            shell: null,
          },
        ]}
        onTerminalInput={vi.fn()}
        onTerminalResize={vi.fn()}
        onTerminalSnapshotChange={vi.fn()}
        onTogglePanel={vi.fn()}
        subscribeToTerminalStream={() => () => {}}
      />,
    )

    expect(screen.queryByText("No terminal session is open.")).toBeNull()
    await waitFor(() => {
      expect(onTerminalInitialDimensions).toHaveBeenCalledWith(4, {
        rows: 24,
        cols: 80,
      })
    })
  })

  it("hides the create-terminal control when a session already exists", () => {
    render(
      <TerminalPanel
        activeSession={baseSession}
        brandTheme="terra"
        colorMode="light"
        isOpen={true}
        panelHeight={280}
        sessions={[baseSession]}
        onCloseTerminal={vi.fn()}
        onCreateTerminal={vi.fn()}
        onCreateTerminalForShellProfile={vi.fn()}
        onTerminalInitialDimensions={vi.fn()}
        onTerminalInitialDimensionsError={vi.fn()}
        onPanelHeightChange={vi.fn()}
        onShellProfileChange={vi.fn()}
        onSelectTerminal={vi.fn()}
        selectedShellProfileID="default"
        shellProfiles={[
          {
            id: "default",
            label: "Default",
            shell: null,
          },
        ]}
        onTerminalInput={vi.fn()}
        onTerminalResize={vi.fn()}
        onTerminalSnapshotChange={vi.fn()}
        onTogglePanel={vi.fn()}
        subscribeToTerminalStream={() => () => {}}
      />,
    )

    expect(screen.queryByRole("button", { name: /Create terminal/i })).toBeNull()
    expect(screen.getByRole("combobox", { name: "Terminal shell profile" })).toBeDisabled()
  })

  it("uses the outer sidebar chrome instead of rendering nested tabs in fill layout", () => {
    const { container } = render(
      <TerminalPanel
        activeSession={baseSession}
        brandTheme="terra"
        colorMode="light"
        floatingActions={<button type="button">Terminal actions</button>}
        isOpen={true}
        layout="fill"
        panelHeight={280}
        sessions={[baseSession]}
        onCloseTerminal={vi.fn()}
        onCreateTerminal={vi.fn()}
        onCreateTerminalForShellProfile={vi.fn()}
        onTerminalInitialDimensions={vi.fn()}
        onTerminalInitialDimensionsError={vi.fn()}
        onPanelHeightChange={vi.fn()}
        onShellProfileChange={vi.fn()}
        onSelectTerminal={vi.fn()}
        selectedShellProfileID="default"
        shellProfiles={[{ id: "default", label: "Default", shell: null }]}
        onTerminalInput={vi.fn()}
        onTerminalResize={vi.fn()}
        onTerminalSnapshotChange={vi.fn()}
        onTogglePanel={vi.fn()}
        subscribeToTerminalStream={() => () => {}}
      />,
    )

    expect(container.querySelector(".terminal-tabs")).toBeNull()
    expect(container.querySelector(".terminal-panel-floating-actions")).toContainElement(
      screen.getByRole("button", { name: "Terminal actions" }),
    )
    expect(screen.queryByRole("combobox", { name: "Terminal shell profile" })).toBeNull()
    expect(screen.getByRole("tabpanel", { name: "Terminal" })).toBeInTheDocument()
  })

  it("shows the shell selector only in the fill-layout empty state", () => {
    const onCreateTerminalForShellProfile = vi.fn()
    render(
      <TerminalPanel
        activeSession={null}
        brandTheme="terra"
        colorMode="light"
        isOpen={true}
        layout="fill"
        panelHeight={280}
        sessions={[]}
        onCloseTerminal={vi.fn()}
        onCreateTerminal={vi.fn()}
        onCreateTerminalForShellProfile={onCreateTerminalForShellProfile}
        onTerminalInitialDimensions={vi.fn()}
        onTerminalInitialDimensionsError={vi.fn()}
        onPanelHeightChange={vi.fn()}
        onShellProfileChange={vi.fn()}
        onSelectTerminal={vi.fn()}
        selectedShellProfileID="pwsh"
        shellProfiles={[
          { id: "default", label: "Default", shell: null },
          { id: "pwsh", label: "PowerShell 7", shell: "pwsh.exe" },
        ]}
        onTerminalInput={vi.fn()}
        onTerminalResize={vi.fn()}
        onTerminalSnapshotChange={vi.fn()}
        onTogglePanel={vi.fn()}
        subscribeToTerminalStream={() => () => {}}
      />,
    )

    expect(screen.getByRole("combobox", { name: "Terminal shell profile" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Create terminal" }))
    expect(onCreateTerminalForShellProfile).toHaveBeenCalledWith("pwsh")
  })

  it("localizes the fill-layout empty launcher and shell picker", () => {
    window.localStorage.setItem("desktop.locale", "zh-CN")

    render(
      <I18nProvider>
        <TerminalPanel
          activeSession={null}
          brandTheme="terra"
          colorMode="light"
          isOpen={true}
          layout="fill"
          panelHeight={280}
          sessions={[]}
          onCloseTerminal={vi.fn()}
          onCreateTerminal={vi.fn()}
          onCreateTerminalForShellProfile={vi.fn()}
          onTerminalInitialDimensions={vi.fn()}
          onTerminalInitialDimensionsError={vi.fn()}
          onPanelHeightChange={vi.fn()}
          onShellProfileChange={vi.fn()}
          onSelectTerminal={vi.fn()}
          selectedShellProfileID="default"
          shellProfiles={[{ id: "default", label: "Default", shell: null }]}
          onTerminalInput={vi.fn()}
          onTerminalResize={vi.fn()}
          onTerminalSnapshotChange={vi.fn()}
          onTogglePanel={vi.fn()}
          subscribeToTerminalStream={() => () => {}}
        />
      </I18nProvider>,
    )

    expect(screen.getByText("当前没有打开的终端会话。")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "创建终端" })).toBeInTheDocument()

    const shellPicker = screen.getByRole("combobox", { name: "终端 Shell 配置" })
    expect(shellPicker.querySelector("svg")).not.toBeNull()
    fireEvent.click(shellPicker)
    const listbox = screen.getByRole("listbox", { name: "终端 Shell 配置" })
    expect(listbox).toBeInTheDocument()
    expect(within(listbox).getByRole("option", { name: "默认" })).toBeInTheDocument()
  })

  it("renders the shell picker as a styled listbox and selects a profile", () => {
    const onShellProfileChange = vi.fn()

    render(
      <TerminalPanel
        activeSession={null}
        brandTheme="terra"
        colorMode="light"
        isOpen={true}
        panelHeight={280}
        sessions={[]}
        onCloseTerminal={vi.fn()}
        onCreateTerminal={vi.fn()}
        onCreateTerminalForShellProfile={vi.fn()}
        onTerminalInitialDimensions={vi.fn()}
        onTerminalInitialDimensionsError={vi.fn()}
        onPanelHeightChange={vi.fn()}
        onShellProfileChange={onShellProfileChange}
        onSelectTerminal={vi.fn()}
        selectedShellProfileID="default"
        shellProfiles={[
          {
            id: "default",
            label: "Default",
            shell: null,
          },
          {
            id: "bash",
            label: "Bash",
            shell: "bash",
          },
        ]}
        onTerminalInput={vi.fn()}
        onTerminalResize={vi.fn()}
        onTerminalSnapshotChange={vi.fn()}
        onTogglePanel={vi.fn()}
        subscribeToTerminalStream={() => () => {}}
      />,
    )

    fireEvent.click(screen.getByRole("combobox", { name: "Terminal shell profile" }))

    const listbox = screen.getByRole("listbox", { name: "Terminal shell profile" })
    fireEvent.click(within(listbox).getByRole("option", { name: "Bash" }))

    expect(onShellProfileChange).toHaveBeenCalledTimes(1)
    expect(onShellProfileChange).toHaveBeenCalledWith("bash")
  })

  it("keeps resize preview local until pointerup commits the height", async () => {
    const onPanelHeightChange = vi.fn()
    const { container } = render(
      <TerminalPanel
        activeSession={null}
        brandTheme="terra"
        colorMode="light"
        isOpen={true}
        panelHeight={280}
        sessions={[]}
        onCloseTerminal={vi.fn()}
        onCreateTerminal={vi.fn()}
        onCreateTerminalForShellProfile={vi.fn()}
        onTerminalInitialDimensions={vi.fn()}
        onTerminalInitialDimensionsError={vi.fn()}
        onPanelHeightChange={onPanelHeightChange}
        onShellProfileChange={vi.fn()}
        onSelectTerminal={vi.fn()}
        selectedShellProfileID="default"
        shellProfiles={[
          {
            id: "default",
            label: "Default",
            shell: null,
          },
        ]}
        onTerminalInput={vi.fn()}
        onTerminalResize={vi.fn()}
        onTerminalSnapshotChange={vi.fn()}
        onTogglePanel={vi.fn()}
        subscribeToTerminalStream={() => () => {}}
      />,
    )

    const panel = container.querySelector(".terminal-panel")
    const resizer = container.querySelector(".terminal-panel-resizer")

    expect(panel).not.toBeNull()
    expect(resizer).not.toBeNull()
    expect(panel).toHaveStyle({ height: "280px" })

    fireEvent.pointerDown(resizer!, {
      button: 0,
      clientY: 500,
    })
    fireEvent.pointerMove(window, {
      clientY: 420,
    })

    await flushFrame()

    expect(onPanelHeightChange).not.toHaveBeenCalled()
    expect(panel).toHaveStyle({ height: "360px" })

    fireEvent.pointerUp(window)

    expect(onPanelHeightChange).toHaveBeenCalledTimes(1)
    expect(onPanelHeightChange).toHaveBeenCalledWith(360)
    expect(document.body.classList.contains("is-resizing-terminal-panel")).toBe(false)
  })
})
