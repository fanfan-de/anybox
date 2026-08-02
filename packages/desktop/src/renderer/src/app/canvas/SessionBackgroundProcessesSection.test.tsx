import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentSessionBackgroundProcessList } from "../../../../shared/desktop-ipc-contract"
import { SessionBackgroundProcessesSection } from "./SessionBackgroundProcessesSection"

type BackgroundProcess = AgentSessionBackgroundProcessList["items"][number]

const processOne: BackgroundProcess = {
  id: "process-1",
  title: "Compile docs",
  command: "pnpm docs:build --watch",
  cwd: "C:\\Projects\\Docs",
  shell: "powershell.exe",
  tty: true,
  status: "running",
  createdAt: 2,
  updatedAt: 3,
}

const processTwo: BackgroundProcess = {
  ...processOne,
  id: "process-2",
  title: "Run preview server",
  command: "pnpm dev",
  createdAt: 1,
}

function createList(items: BackgroundProcess[], sessionID = "session-1"): AgentSessionBackgroundProcessList {
  return { sessionID, generatedAt: Date.now(), items }
}

function setDesktopApi(api: Partial<NonNullable<typeof window.desktop>>) {
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: api,
  })
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function advancePoll() {
  await act(async () => {
    vi.advanceTimersByTime(2_000)
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  setDesktopApi({})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("SessionBackgroundProcessesSection", () => {
  it("hides an empty list, auto-expands on first appearance, and preserves a manual collapse", async () => {
    vi.useFakeTimers()
    const snapshots = [
      createList([]),
      createList([processOne]),
      createList([processOne]),
      createList([]),
      createList([processOne]),
    ]
    const getSessionBackgroundProcesses = vi.fn(async () => snapshots.shift() ?? createList([processOne]))
    setDesktopApi({ getSessionBackgroundProcesses })

    render(<SessionBackgroundProcessesSection sessionID="session-1" />)
    await flushPromises()
    expect(screen.queryByRole("region", { name: "后台进程" })).not.toBeInTheDocument()

    await advancePoll()
    const section = screen.getByRole("region", { name: "后台进程" })
    expect(within(section).getByRole("button", { name: "收起后台进程" })).toBeInTheDocument()
    expect(within(section).getByText("Compile docs").closest("li")).toHaveAttribute(
      "title",
      "pnpm docs:build --watch\n工作目录：C:\\Projects\\Docs\nShell：powershell.exe\nTTY：是",
    )

    fireEvent.click(within(section).getByRole("button", { name: "收起后台进程" }))
    expect(within(section).getByRole("button", { name: "展开后台进程" })).toBeInTheDocument()
    await advancePoll()
    expect(within(section).getByRole("button", { name: "展开后台进程" })).toBeInTheDocument()
    expect(within(section).queryByText("Compile docs")).not.toBeInTheDocument()

    await advancePoll()
    expect(screen.queryByRole("region", { name: "后台进程" })).not.toBeInTheDocument()

    await advancePoll()
    expect(screen.getByRole("button", { name: "收起后台进程" })).toBeInTheDocument()
    expect(screen.getByText("Compile docs")).toBeInTheDocument()
  })

  it("stops polling after unmount", async () => {
    vi.useFakeTimers()
    const getSessionBackgroundProcesses = vi.fn().mockResolvedValue(createList([]))
    setDesktopApi({ getSessionBackgroundProcesses })

    const { unmount } = render(<SessionBackgroundProcessesSection sessionID="session-1" />)
    await flushPromises()
    expect(getSessionBackgroundProcesses).toHaveBeenCalledTimes(1)

    unmount()
    await act(async () => vi.advanceTimersByTime(6_000))
    expect(getSessionBackgroundProcesses).toHaveBeenCalledTimes(1)
  })

  it("discards a stale response after switching sessions", async () => {
    let resolveFirstSession: ((value: AgentSessionBackgroundProcessList) => void) | undefined
    const getSessionBackgroundProcesses = vi.fn(({ sessionID }: { sessionID: string }) => {
      if (sessionID === "session-1") {
        return new Promise<AgentSessionBackgroundProcessList>((resolve) => {
          resolveFirstSession = resolve
        })
      }
      return Promise.resolve(createList([processTwo], sessionID))
    })
    setDesktopApi({ getSessionBackgroundProcesses })

    const { rerender } = render(<SessionBackgroundProcessesSection sessionID="session-1" />)
    rerender(<SessionBackgroundProcessesSection sessionID="session-2" />)

    expect(await screen.findByText("Run preview server")).toBeInTheDocument()
    await act(async () => resolveFirstSession?.(createList([processOne], "session-1")))

    expect(screen.queryByText("Compile docs")).not.toBeInTheDocument()
    expect(screen.getByText("Run preview server")).toBeInTheDocument()
  })

  it("uses a portal action menu, restores focus on Escape, and terminates one process", async () => {
    const getSessionBackgroundProcesses = vi.fn()
      .mockResolvedValueOnce(createList([processOne]))
      .mockResolvedValueOnce(createList([]))
    const terminateSessionBackgroundProcess = vi.fn().mockResolvedValue({
      sessionID: "session-1",
      processID: processOne.id,
      terminated: true,
    })
    setDesktopApi({ getSessionBackgroundProcesses, terminateSessionBackgroundProcess })

    render(<SessionBackgroundProcessesSection sessionID="session-1" />)
    const trigger = await screen.findByRole("button", { name: "后台进程操作：Compile docs" })
    fireEvent.click(trigger)

    const menu = screen.getByRole("menu", { name: "后台进程操作：Compile docs" })
    expect(menu).toHaveAttribute("data-session-info-popover", "true")
    const terminateItem = within(menu).getByRole("menuitem", { name: "强制终止" })
    await waitFor(() => expect(terminateItem).toHaveFocus())
    fireEvent.keyDown(terminateItem, { key: "Home" })
    expect(terminateItem).toHaveFocus()
    fireEvent.keyDown(terminateItem, { key: "End" })
    expect(terminateItem).toHaveFocus()
    fireEvent.keyDown(terminateItem, { key: "ArrowDown" })
    expect(terminateItem).toHaveFocus()
    fireEvent.keyDown(terminateItem, { key: "ArrowUp" })
    expect(terminateItem).toHaveFocus()
    fireEvent.keyDown(terminateItem, { key: "Escape" })
    expect(screen.queryByRole("menu", { name: "后台进程操作：Compile docs" })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole("menuitem", { name: "强制终止" }))

    await waitFor(() => {
      expect(terminateSessionBackgroundProcess).toHaveBeenCalledWith({
        sessionID: "session-1",
        processID: processOne.id,
      })
      expect(screen.queryByRole("region", { name: "后台进程" })).not.toBeInTheDocument()
    })
  })

  it("disables the corresponding row action while termination is in progress", async () => {
    let resolveTermination: ((value: {
      sessionID: string
      processID: string
      terminated: boolean
    }) => void) | undefined
    const getSessionBackgroundProcesses = vi.fn()
      .mockResolvedValueOnce(createList([processOne]))
      .mockResolvedValueOnce(createList([]))
    const terminateSessionBackgroundProcess = vi.fn(() => new Promise<{
      sessionID: string
      processID: string
      terminated: boolean
    }>((resolve) => {
      resolveTermination = resolve
    }))
    setDesktopApi({ getSessionBackgroundProcesses, terminateSessionBackgroundProcess })

    render(<SessionBackgroundProcessesSection sessionID="session-1" />)
    const trigger = await screen.findByRole("button", { name: "后台进程操作：Compile docs" })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole("menuitem", { name: "强制终止" }))

    await waitFor(() => expect(trigger).toBeDisabled())
    await act(async () => resolveTermination?.({
      sessionID: "session-1",
      processID: processOne.id,
      terminated: true,
    }))
    await waitFor(() => expect(screen.queryByRole("region", { name: "后台进程" })).not.toBeInTheDocument())
  })

  it("confirms bulk termination and honors cancellation", async () => {
    const getSessionBackgroundProcesses = vi.fn()
      .mockResolvedValueOnce(createList([processOne, processTwo]))
      .mockResolvedValueOnce(createList([]))
    const terminateAllSessionBackgroundProcesses = vi.fn().mockResolvedValue({
      sessionID: "session-1",
      terminatedProcessIDs: [processOne.id, processTwo.id],
    })
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true)
    setDesktopApi({ getSessionBackgroundProcesses, terminateAllSessionBackgroundProcesses })

    render(<SessionBackgroundProcessesSection sessionID="session-1" />)
    const sectionActions = await screen.findByRole("button", { name: "后台进程操作" })
    fireEvent.click(sectionActions)
    fireEvent.click(screen.getByRole("menuitem", { name: "终止全部后台进程" }))

    expect(confirm).toHaveBeenLastCalledWith("确定强制终止此会话的 2 个后台进程吗？进程中的未保存状态将丢失。")
    expect(terminateAllSessionBackgroundProcesses).not.toHaveBeenCalled()

    fireEvent.click(sectionActions)
    fireEvent.click(screen.getByRole("menuitem", { name: "终止全部后台进程" }))

    await waitFor(() => {
      expect(terminateAllSessionBackgroundProcesses).toHaveBeenCalledWith({ sessionID: "session-1" })
      expect(screen.queryByRole("region", { name: "后台进程" })).not.toBeInTheDocument()
    })
  })

  it("shows an action error only while the process still exists", async () => {
    const getSessionBackgroundProcesses = vi.fn().mockResolvedValue(createList([processOne]))
    const terminateSessionBackgroundProcess = vi.fn().mockRejectedValue(new Error("Process refused termination"))
    setDesktopApi({ getSessionBackgroundProcesses, terminateSessionBackgroundProcess })

    render(<SessionBackgroundProcessesSection sessionID="session-1" />)
    fireEvent.click(await screen.findByRole("button", { name: "后台进程操作：Compile docs" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "强制终止" }))

    expect(await screen.findByText("Process refused termination")).toBeInTheDocument()
  })

  it("does not report a termination race after the process exits naturally", async () => {
    const getSessionBackgroundProcesses = vi.fn()
      .mockResolvedValueOnce(createList([processOne]))
      .mockResolvedValueOnce(createList([]))
    const terminateSessionBackgroundProcess = vi.fn().mockRejectedValue(new Error("Process already exited"))
    setDesktopApi({ getSessionBackgroundProcesses, terminateSessionBackgroundProcess })

    render(<SessionBackgroundProcessesSection sessionID="session-1" />)
    fireEvent.click(await screen.findByRole("button", { name: "后台进程操作：Compile docs" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "强制终止" }))

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "后台进程" })).not.toBeInTheDocument()
      expect(screen.queryByText("Process already exited")).not.toBeInTheDocument()
    })
  })
})
