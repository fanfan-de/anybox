import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  AgentFolderWorkspace,
  AgentSshDirectoryEntry,
  AgentSshDirectoryListing,
  AgentSshProfile,
  DesktopApi,
} from "../../../../shared/desktop-ipc-contract"
import { ToastProvider } from "../toast"
import { SshConnectionsPage } from "./SshConnectionsPage"

const PROFILE: AgentSshProfile = {
  id: "profile-1",
  name: "Production",
  host: "203.0.113.10",
  port: 22,
  username: "ubuntu",
  privateKeyPath: "C:\\Users\\demo\\.ssh\\id_rsa",
  defaultRemotePath: "/home/ubuntu",
  createdAt: 1,
  updatedAt: 1,
  hasPassphrase: false,
}

function createEntry(input: Partial<AgentSshDirectoryEntry> & Pick<AgentSshDirectoryEntry, "name" | "path" | "type">): AgentSshDirectoryEntry {
  return {
    uri: `ssh://${input.path}`,
    size: 0,
    modifiedAt: 1_700_000_000_000,
    ...input,
  }
}

function createListing(path: string, entries: AgentSshDirectoryEntry[] = []): AgentSshDirectoryListing {
  return {
    profileID: PROFILE.id,
    path,
    entries,
  }
}

function createWorkspace(path: string): AgentFolderWorkspace {
  return {
    id: `ssh:${path}`,
    directory: path,
    name: path.split("/").filter(Boolean).pop() ?? path,
    exists: true,
    created: 1,
    updated: 1,
    project: {
      id: "project-1",
      name: "Production",
      worktree: path,
    },
    sessions: [],
  }
}

function installDesktopMock(overrides: Partial<DesktopApi> = {}) {
  window.desktop = {
    listSshProfiles: vi.fn().mockResolvedValue([PROFILE]),
    saveSshProfile: vi.fn(),
    deleteSshProfile: vi.fn(),
    testSshProfile: vi.fn().mockResolvedValue({
      ok: true,
      profileID: PROFILE.id,
      remotePath: PROFILE.defaultRemotePath,
    }),
    listSshDirectory: vi.fn().mockResolvedValue(createListing(PROFILE.defaultRemotePath)),
    openSshFolderWorkspace: vi.fn().mockImplementation(async ({ path }: { path: string }) => createWorkspace(path)),
    ...overrides,
  } as unknown as DesktopApi
}

function renderPage() {
  return render(
    <ToastProvider>
      <SshConnectionsPage searchQuery="" />
    </ToastProvider>,
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

async function loadRemoteFolder() {
  renderPage()
  await screen.findByRole("button", { name: /Production/ })
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }))
  await screen.findByRole("listbox", { name: "Remote folder entries" })
}

afterEach(() => {
  vi.restoreAllMocks()
  delete window.desktop
})

describe("SshConnectionsPage remote browser", () => {
  it("shows directories and files, selects rows, and enters a directory on double click", async () => {
    const listSshDirectory = vi.fn().mockImplementation(async ({ path }: { path?: string | null }) => {
      if (path === "/home/ubuntu/app2") return createListing("/home/ubuntu/app2")
      return createListing("/home/ubuntu", [
        createEntry({ name: "package.json", path: "/home/ubuntu/package.json", type: "file", size: 1200 }),
        createEntry({ name: "src", path: "/home/ubuntu/src", type: "directory" }),
        createEntry({ name: "app2", path: "/home/ubuntu/app2", type: "directory" }),
        createEntry({ name: "socket", path: "/home/ubuntu/socket", type: "other" }),
      ])
    })
    installDesktopMock({ listSshDirectory })

    await loadRemoteFolder()

    const rows = screen.getAllByRole("option")
    expect(within(rows[0]).getByText("app2")).toBeInTheDocument()
    expect(within(rows[1]).getByText("src")).toBeInTheDocument()
    expect(within(rows[2]).getByText("package.json")).toBeInTheDocument()
    expect(within(rows[3]).getByText("socket")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("option", { name: /package\.json, File, \/home\/ubuntu\/package\.json/ }))
    expect(screen.getByRole("option", { name: /package\.json/ })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("Target: /home/ubuntu")).toBeInTheDocument()

    const appRow = screen.getByRole("option", { name: /app2, Folder, \/home\/ubuntu\/app2/ })
    fireEvent.click(appRow)
    expect(screen.getByText("Target: /home/ubuntu/app2")).toBeInTheDocument()
    fireEvent.doubleClick(appRow)

    await waitFor(() => expect(listSshDirectory).toHaveBeenLastCalledWith({
      profileID: PROFILE.id,
      path: "/home/ubuntu/app2",
    }))
    expect(await screen.findByText("Target: /home/ubuntu/app2")).toBeInTheDocument()
    expect(screen.getByText("No entries loaded")).toBeInTheDocument()
  })

  it("supports editable absolute paths and keeps the previous path when loading fails", async () => {
    const listSshDirectory = vi.fn().mockImplementation(async ({ path }: { path?: string | null }) => {
      if (path === "/tmp/app") return createListing("/tmp/app")
      if (path === "/missing") throw new Error("Path not found")
      return createListing("/home/ubuntu")
    })
    installDesktopMock({ listSshDirectory })

    renderPage()
    await screen.findByRole("button", { name: /Production/ })

    fireEvent.click(screen.getByRole("button", { name: "Edit path" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Remote path" }), {
      target: { value: "tmp/app" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Go" }))

    expect(await screen.findByText("Remote path must be an absolute POSIX path.")).toBeInTheDocument()
    expect(listSshDirectory).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole("textbox", { name: "Remote path" }), {
      target: { value: "/tmp/app" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Go" }))

    await waitFor(() => expect(listSshDirectory).toHaveBeenLastCalledWith({
      profileID: PROFILE.id,
      path: "/tmp/app",
    }))
    expect(await screen.findByText("Target: /tmp/app")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Edit path" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Remote path" }), {
      target: { value: "/missing" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Go" }))

    expect(await screen.findByText("Path not found")).toBeInTheDocument()
    expect(screen.getByText("Target: /tmp/app")).toBeInTheDocument()
  })

  it("opens the current path, selected directory, or current path for selected files", async () => {
    const openSshFolderWorkspace = vi.fn().mockImplementation(async ({ path }: { path: string }) => createWorkspace(path))
    installDesktopMock({
      openSshFolderWorkspace,
      listSshDirectory: vi.fn().mockResolvedValue(createListing("/home/ubuntu", [
        createEntry({ name: "app", path: "/home/ubuntu/app", type: "directory" }),
        createEntry({ name: "package.json", path: "/home/ubuntu/package.json", type: "file", size: 1200 }),
      ])),
    })

    await loadRemoteFolder()

    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
    await waitFor(() => expect(openSshFolderWorkspace).toHaveBeenLastCalledWith({
      profileID: PROFILE.id,
      path: "/home/ubuntu",
    }))

    fireEvent.click(screen.getByRole("option", { name: /app, Folder/ }))
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
    await waitFor(() => expect(openSshFolderWorkspace).toHaveBeenLastCalledWith({
      profileID: PROFILE.id,
      path: "/home/ubuntu/app",
    }))

    fireEvent.click(screen.getByRole("option", { name: /package\.json, File/ }))
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
    await waitFor(() => expect(openSshFolderWorkspace).toHaveBeenLastCalledWith({
      profileID: PROFILE.id,
      path: "/home/ubuntu",
    }))
  })

  it("filters loaded entries and restores the list from the empty filtered state", async () => {
    installDesktopMock({
      listSshDirectory: vi.fn().mockResolvedValue(createListing("/home/ubuntu", [
        createEntry({ name: "app", path: "/home/ubuntu/app", type: "directory" }),
        createEntry({ name: "logs", path: "/home/ubuntu/logs", type: "directory" }),
        createEntry({ name: "README.md", path: "/home/ubuntu/README.md", type: "file", size: 400 }),
      ])),
    })

    await loadRemoteFolder()

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter remote folder entries" }), {
      target: { value: "readme" },
    })

    expect(screen.getByRole("option", { name: /README\.md/ })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /app, Folder/ })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter remote folder entries" }), {
      target: { value: "missing" },
    })

    expect(screen.getByText("No matching entries")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }))
    expect(screen.getByRole("option", { name: /app, Folder/ })).toBeInTheDocument()
  })

  it("supports keyboard browsing shortcuts", async () => {
    const listSshDirectory = vi.fn().mockImplementation(async ({ path }: { path?: string | null }) => {
      if (path === "/home/ubuntu/app") return createListing("/home/ubuntu/app")
      return createListing("/home/ubuntu", [
        createEntry({ name: "app", path: "/home/ubuntu/app", type: "directory" }),
        createEntry({ name: "package.json", path: "/home/ubuntu/package.json", type: "file", size: 1200 }),
      ])
    })
    installDesktopMock({ listSshDirectory })

    await loadRemoteFolder()
    const browser = screen.getByLabelText("Remote directory browser")

    fireEvent.keyDown(browser, { key: "ArrowDown" })
    expect(screen.getByRole("option", { name: /app, Folder/ })).toHaveAttribute("aria-selected", "true")

    fireEvent.keyDown(browser, { key: "Enter" })
    await waitFor(() => expect(listSshDirectory).toHaveBeenLastCalledWith({
      profileID: PROFILE.id,
      path: "/home/ubuntu/app",
    }))

    fireEvent.keyDown(browser, { key: "Backspace" })
    await waitFor(() => expect(listSshDirectory).toHaveBeenLastCalledWith({
      profileID: PROFILE.id,
      path: "/home/ubuntu",
    }))

    fireEvent.keyDown(browser, { key: "l", ctrlKey: true })
    expect(screen.getByRole("textbox", { name: "Remote path" })).toHaveFocus()

    fireEvent.keyDown(browser, { key: "r", ctrlKey: true })
    await waitFor(() => expect(listSshDirectory).toHaveBeenLastCalledWith({
      profileID: PROFILE.id,
      path: "/home/ubuntu",
    }))
  })

  it("collapses and restores the connection inspector without losing the draft", async () => {
    installDesktopMock()

    renderPage()
    await screen.findByRole("button", { name: /Production/ })

    const inspector = document.getElementById("ssh-connection-inspector")
    expect(inspector).not.toBeNull()
    expect(inspector).not.toHaveAttribute("hidden")

    fireEvent.click(screen.getByRole("button", { name: "Close Connection" }))
    expect(inspector).toHaveAttribute("hidden")

    fireEvent.click(screen.getByRole("button", { name: "Connection" }))
    expect(inspector).not.toHaveAttribute("hidden")
    expect(screen.getByDisplayValue(PROFILE.host)).toBeInTheDocument()
  })

  it("ignores stale directory responses when navigation requests race", async () => {
    const slow = deferred<AgentSshDirectoryListing>()
    const fast = deferred<AgentSshDirectoryListing>()
    const listSshDirectory = vi.fn().mockImplementation(({ path }: { path?: string | null }) => {
      if (path === "/slow") return slow.promise
      if (path === "/fast") return fast.promise
      return Promise.resolve(createListing("/home/ubuntu", [
        createEntry({ name: "fast", path: "/fast", type: "directory" }),
        createEntry({ name: "slow", path: "/slow", type: "directory" }),
      ]))
    })
    installDesktopMock({ listSshDirectory })

    await loadRemoteFolder()

    fireEvent.doubleClick(screen.getByRole("option", { name: /slow, Folder/ }))
    fireEvent.doubleClick(screen.getByRole("option", { name: /fast, Folder/ }))

    await act(async () => {
      fast.resolve(createListing("/fast", [
        createEntry({ name: "done.txt", path: "/fast/done.txt", type: "file", size: 4 }),
      ]))
      await fast.promise
    })

    expect(await screen.findByText("Target: /fast")).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /done\.txt, File/ })).toBeInTheDocument()

    await act(async () => {
      slow.resolve(createListing("/slow", [
        createEntry({ name: "stale.txt", path: "/slow/stale.txt", type: "file", size: 4 }),
      ]))
      await slow.promise
    })

    expect(screen.getByText("Target: /fast")).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /stale\.txt/ })).not.toBeInTheDocument()
  })
})
