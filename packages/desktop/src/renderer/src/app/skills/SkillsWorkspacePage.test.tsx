import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { RegistryFileContent } from "@anybox/shared"
import { useState, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n/I18nProvider"
import type { GlobalSkillsNavigatorProps } from "./GlobalSkillsPage"
import { SkillsWorkspacePage, type SkillLibraryMode } from "./SkillsWorkspacePage"

const skill = {
  id: "clawhub:demo/reader",
  provider: "clawhub",
  remoteId: "demo/reader",
  slug: "reader",
  displayName: "Reader Skill",
  summary: "Read documents safely.",
  author: { handle: "demo" },
  version: "1.0.0",
  canonicalUrl: "https://clawhub.ai/demo/reader",
  topics: ["documents"],
  security: {
    provider: "clawhub",
    remoteId: "demo/reader",
    version: "1.0.0",
    status: "clean" as const,
    blocked: false,
    reasons: [],
  },
}

const downloaded = {
  id: "registry:clawhub:demo/reader",
  provider: "clawhub",
  remoteId: "demo/reader",
  slug: "reader",
  displayName: "Reader Skill",
  description: "Read documents safely.",
  author: { handle: "demo" },
  canonicalUrl: "https://clawhub.ai/demo/reader",
  activeVersion: "1.0.0",
  enabled: false,
  packageRoot: "C:/Anybox/registry/reader/1.0.0",
  artifactSha256: "a".repeat(64),
  treeHash: "b".repeat(64),
  downloadedAt: 1,
  updatedAt: 1,
  upstreamSecurity: skill.security,
  localScan: {
    scannerVersion: "1",
    risk: "none" as const,
    blocked: false,
    findings: [],
    counts: { low: 0, medium: 0, high: 0, critical: 0 },
    scannedAt: 1,
  },
  versions: [{
    version: "1.0.0",
    packageRoot: "C:/Anybox/registry/reader/1.0.0",
    artifactSha256: "a".repeat(64),
    treeHash: "b".repeat(64),
    installedAt: 1,
    source: { kind: "registry" as const },
    security: skill.security,
    localScan: {
      scannerVersion: "1",
      risk: "none" as const,
      blocked: false,
      findings: [],
      counts: { low: 0, medium: 0, high: 0, critical: 0 },
      scannedAt: 1,
    },
  }],
  security: skill.security,
}

function Harness({
  canChangeMode,
  children,
  localNavigatorProps,
  onBeforeForkToLocal,
  onForkedToLocal,
}: {
  canChangeMode?: (mode: SkillLibraryMode) => boolean
  children: ReactNode
  localNavigatorProps?: GlobalSkillsNavigatorProps
  onBeforeForkToLocal?: () => boolean
  onForkedToLocal?: (result: { id: string; sourceSkillID: string; directory: string; filePath: string }) => void
}) {
  const [mode, setMode] = useState<SkillLibraryMode>("local")
  const [isMarketplaceOpen, setIsMarketplaceOpen] = useState(false)
  return (
    <div className="app-shell">
      <SkillsWorkspacePage
        isMarketplaceOpen={isMarketplaceOpen}
        localNavigatorProps={localNavigatorProps}
        mode={mode}
        onMarketplaceClose={() => setIsMarketplaceOpen(false)}
        onMarketplaceOpen={() => setIsMarketplaceOpen(true)}
        onModeChange={(nextMode) => {
          if (canChangeMode && !canChangeMode(nextMode)) return false
          setMode(nextMode)
          return true
        }}
        onBeforeForkToLocal={onBeforeForkToLocal}
        onForkedToLocal={onForkedToLocal}
      >
        {children}
      </SkillsWorkspacePage>
    </div>
  )
}

function createLocalNavigatorProps(
  overrides: Partial<GlobalSkillsNavigatorProps> = {},
): GlobalSkillsNavigatorProps {
  return {
    creatingGlobalSkillName: "",
    creatingGlobalSkillDraftKind: "skill",
    creatingGlobalSkillParentDirectory: null,
    deletingGlobalSkillDirectory: null,
    expandedSkillPaths: [],
    globalSkillsRoot: "C:/Anybox/skills",
    globalSkillsTree: [],
    isCreateGlobalSkillDraftVisible: false,
    isCreatingGlobalSkill: false,
    isInstallingLocalSkill: false,
    isLoadingSkillsTree: false,
    renamingGlobalSkillDirectory: null,
    renamingGlobalSkillDraftDirectory: null,
    renamingGlobalSkillName: "",
    selectedGlobalSkillFilePath: null,
    onCreateGlobalSkill: vi.fn(),
    onCreateGlobalSkillDraftCancel: vi.fn(),
    onCreateGlobalSkillDraftChange: vi.fn(),
    onCreateGlobalSkillDraftStart: vi.fn(),
    onDeleteGlobalSkill: vi.fn(),
    onGitInstallDialogOpen: vi.fn(),
    onGlobalSkillDirectoryToggle: vi.fn(),
    onGlobalSkillFileSelect: vi.fn(),
    onLocalInstallDialogOpen: vi.fn(),
    onMoveGlobalSkillDirectoryStart: vi.fn(),
    onOpenGlobalSkillsFolder: vi.fn(),
    onRenameGlobalSkill: vi.fn(),
    onRenameGlobalSkillDraftCancel: vi.fn(),
    onRenameGlobalSkillDraftChange: vi.fn(),
    onRenameGlobalSkillDraftStart: vi.fn(),
    ...overrides,
  }
}

function openThirdPartyMarketplace() {
  fireEvent.click(screen.getByRole("button", { name: "Add Skill" }))
  fireEvent.click(screen.getByRole("menuitem", { name: "Get third-party Skills" }))
}

describe("SkillsWorkspacePage", () => {
  const desktop = {
    getSkillRegistryProviders: vi.fn().mockResolvedValue([
      {
        id: "clawhub",
        name: "ClawHub",
        description: "Public skills",
        canonicalUrl: "https://clawhub.ai",
        beta: false,
        enabled: true,
        configured: true,
        capabilities: { search: true, browse: true, detail: true, versions: true, files: true, download: true, security: true },
      },
      {
        id: "skillhub",
        name: "Tencent SkillHub",
        description: "Public Tencent SkillHub catalog",
        canonicalUrl: "https://skillhub.cn",
        beta: false,
        enabled: true,
        configured: true,
        capabilities: { search: true, browse: true, detail: true, versions: true, files: true, download: true, security: true },
      },
    ]),
    searchSkillRegistry: vi.fn().mockResolvedValue({
      items: [skill],
      errors: [{ provider: "skillhub", code: "UPSTREAM_ERROR", message: "Service temporarily unavailable" }],
    }),
    getSkillRegistryDetail: vi.fn().mockResolvedValue({
      ...skill,
      description: "A detailed description.",
      latestVersion: { provider: "clawhub", remoteId: "demo/reader", version: "1.0.0" },
    }),
    getSkillRegistryVersions: vi.fn().mockResolvedValue([
      { provider: "clawhub", remoteId: "demo/reader", version: "1.0.0" },
    ]),
    getSkillRegistryFiles: vi.fn().mockResolvedValue([
      { provider: "clawhub", remoteId: "demo/reader", version: "1.0.0", path: "SKILL.md", name: "SKILL.md" },
    ]),
    getSkillRegistrySecurity: vi.fn().mockResolvedValue(skill.security),
    readSkillRegistryFile: vi.fn().mockResolvedValue({
      provider: "clawhub",
      remoteId: "demo/reader",
      version: "1.0.0",
      path: "SKILL.md",
      name: "SKILL.md",
      content: "# Reader Skill\n\nUse this skill safely.",
      encoding: "utf8" as const,
    }),
    downloadSkillRegistrySkill: vi.fn().mockResolvedValue(downloaded),
    listDownloadedRegistrySkills: vi.fn().mockResolvedValue([]),
    listDownloadedRegistrySkillFiles: vi.fn().mockResolvedValue([
      { provider: "clawhub", remoteId: "demo/reader", version: "1.0.0", path: "SKILL.md", name: "SKILL.md" },
      { provider: "clawhub", remoteId: "demo/reader", version: "1.0.0", path: "notes.txt", name: "notes.txt" },
    ]),
    readDownloadedRegistrySkillFile: vi.fn().mockResolvedValue({
      provider: "clawhub",
      remoteId: "demo/reader",
      version: "1.0.0",
      path: "SKILL.md",
      name: "SKILL.md",
      content: "# Offline Reader",
      encoding: "utf8" as const,
    }),
    forkDownloadedRegistrySkill: vi.fn().mockResolvedValue({
      id: "user:reader",
      sourceSkillID: downloaded.id,
      directory: "C:/Anybox/skills/reader",
      filePath: "C:/Anybox/skills/reader/SKILL.md",
    }),
    previewDownloadedRegistrySkillUpdate: vi.fn().mockResolvedValue({
      id: downloaded.id,
      currentVersion: "1.0.0",
      targetVersion: "1.1.0",
      updateAvailable: true,
      alreadyDownloaded: false,
      currentTreeHash: "b".repeat(64),
      targetTreeHash: "c".repeat(64),
      blocked: false,
      fileChanges: [
        { path: "SKILL.md", status: "changed" as const, currentSha256: "a".repeat(64), targetSha256: "c".repeat(64) },
        { path: "notes.txt", status: "added" as const, targetSha256: "d".repeat(64) },
      ],
      upstreamSecurity: { ...skill.security, version: "1.1.0" },
    }),
    updateDownloadedRegistrySkill: vi.fn().mockResolvedValue({ ...downloaded, activeVersion: "1.1.0" }),
  }

  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem("desktop.locale", "en-US")
    for (const method of Object.values(desktop)) method.mockClear()
    desktop.listDownloadedRegistrySkills.mockResolvedValue([])
    Object.defineProperty(window, "desktop", { configurable: true, value: desktop })
  })

  it("keeps local editing and renders partial registry results", async () => {
    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    expect(screen.getByText("Local editor")).toBeInTheDocument()
    const workspaceTabs = screen.getByRole("tablist", { name: "Skill library sections" })
    expect(Array.from(workspaceTabs.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent)).toEqual([
      "All",
      "Local",
      "Downloaded",
    ])
    expect(screen.queryByRole("tab", { name: "Discover" })).not.toBeInTheDocument()

    await new Promise((resolve) => window.setTimeout(resolve, 450))
    expect(desktop.getSkillRegistryProviders).not.toHaveBeenCalled()
    expect(desktop.searchSkillRegistry).not.toHaveBeenCalled()
    expect(desktop.getSkillRegistryDetail).not.toHaveBeenCalled()
    expect(desktop.getSkillRegistryVersions).not.toHaveBeenCalled()
    expect(desktop.getSkillRegistryFiles).not.toHaveBeenCalled()
    expect(desktop.getSkillRegistrySecurity).not.toHaveBeenCalled()
    expect(desktop.readSkillRegistryFile).not.toHaveBeenCalled()

    openThirdPartyMarketplace()

    const dialog = await screen.findByRole("dialog", { name: "Third-party Skills" })
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog.closest(".app-shell")).not.toBeNull()
    expect(screen.getByText("Local editor")).toBeInTheDocument()
    await waitFor(() => expect(desktop.searchSkillRegistry).toHaveBeenCalled())
    expect(await screen.findByRole("heading", { name: "Reader Skill", level: 2 })).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(/Tencent SkillHub.*temporarily unavailable/i)
    expect(screen.getByRole("button", { name: "Tencent SkillHub" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: /Configure SkillHub|Manage SkillHub/i })).not.toBeInTheDocument()
    expect(await screen.findByRole("heading", { name: "Reader Skill", level: 1 })).toBeInTheDocument()
    expect(screen.getByText("Scan clean")).toBeInTheDocument()
    expect(screen.getAllByText("1.0.0").length).toBeGreaterThan(0)
  })

  it("renders local skills as flat entities and opens the skill document from the row", async () => {
    const onGlobalSkillFileSelect = vi.fn()
    const localNavigatorProps = createLocalNavigatorProps({
      globalSkillsTree: [{
        name: "Design",
        path: "C:/Anybox/skills/Design",
        kind: "directory",
        role: "folder",
        children: [{
          name: "brand-guidelines",
          path: "C:/Anybox/skills/Design/brand-guidelines",
          kind: "directory",
          role: "skill",
          children: [
            {
              name: "SKILL.md",
              path: "C:/Anybox/skills/Design/brand-guidelines/SKILL.md",
              kind: "file",
            },
            {
              name: "LICENSE.txt",
              path: "C:/Anybox/skills/Design/brand-guidelines/LICENSE.txt",
              kind: "file",
            },
          ],
        }],
      }],
      onGlobalSkillFileSelect,
    })

    render(
      <I18nProvider>
        <Harness localNavigatorProps={localNavigatorProps}>
          <div>Local detail</div>
        </Harness>
      </I18nProvider>,
    )

    await waitFor(() => expect(desktop.listDownloadedRegistrySkills).toHaveBeenCalled())

    const skillRow = screen.getByRole("button", { name: "brand-guidelines" })
    expect(skillRow).not.toHaveAttribute("aria-expanded")
    expect(skillRow).toHaveClass("is-navigation")
    expect(skillRow.querySelector(".skill-library-product-icon")).toBeNull()
    expect(document.querySelector(".skills-workspace-list-panel > .skills-workspace-filter-bar")).not.toBeNull()
    expect(screen.queryByRole("button", { name: "Design" })).not.toBeInTheDocument()
    expect(screen.queryByText("LICENSE.txt")).not.toBeInTheDocument()

    fireEvent.click(skillRow)

    expect(onGlobalSkillFileSelect).toHaveBeenCalledWith("C:/Anybox/skills/Design/brand-guidelines/SKILL.md")
  })

  it("renders marketplace skills as product rows with real icons, badges, and accessible metrics", async () => {
    const productSkill = {
      ...skill,
      id: "skillhub:tencent-docs",
      provider: "skillhub",
      remoteId: "tencent-docs",
      slug: "tencent-docs",
      displayName: "Tencent Docs",
      summary: "Create, read, and search cloud documents.",
      iconUrl: "https://cdn.skillhub.cn/icons/tencent-docs.png",
      verified: true,
      requiresApiKey: true,
      author: { handle: "tencent", displayName: "Tencent" },
      canonicalUrl: "https://skillhub.cn/skills/tencent-docs",
      topics: ["Office", "Knowledge"],
      stats: { stars: 138, downloads: 183000 },
      security: { ...skill.security, provider: "skillhub", remoteId: "tencent-docs" },
    }
    desktop.searchSkillRegistry.mockResolvedValueOnce({ items: [productSkill], errors: [] })
    desktop.getSkillRegistryDetail.mockResolvedValueOnce({
      ...productSkill,
      description: "Tencent Docs integration.",
      latestVersion: { provider: "skillhub", remoteId: "tencent-docs", version: "1.0.0" },
    })

    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    openThirdPartyMarketplace()

    const row = await screen.findByRole("button", { name: /Tencent Docs/ })
    const rowView = within(row)
    const icon = rowView.getByRole("img", { name: "Tencent Docs icon" })
    expect(icon.tagName).toBe("IMG")
    expect(icon).toHaveAttribute("src", productSkill.iconUrl)
    expect(icon).toHaveAttribute("loading", "lazy")
    expect(icon).toHaveAttribute("decoding", "async")
    expect(icon).toHaveAttribute("referrerpolicy", "no-referrer")
    expect(rowView.getByText("Office")).toBeInTheDocument()
    expect(rowView.getByRole("img", { name: "Verified publisher" })).toBeInTheDocument()
    expect(rowView.getByText("API key required")).toBeInTheDocument()
    expect(rowView.getByRole("img", { name: "138 stars" })).toBeInTheDocument()
    expect(rowView.getByRole("img", { name: "183000 downloads" })).toBeInTheDocument()
    expect(row).toHaveTextContent("Tencent")
    expect(row).toHaveTextContent("Scan clean")
    expect(row).toHaveTextContent("Tencent SkillHub")

    fireEvent.error(icon)
    await waitFor(() => {
      expect(rowView.getByRole("img", { name: "Tencent Docs icon" }).tagName).toBe("SPAN")
    })
    const fallback = rowView.getByRole("img", { name: "Tencent Docs icon" })
    expect(fallback.querySelector(".skill-default-logo-mark")).not.toBeNull()
  })

  it("uses the ClawHub author avatar when a catalog item has no explicit icon", async () => {
    const clawHubSkill = {
      ...skill,
      author: { handle: "pskoett" },
    }
    desktop.searchSkillRegistry.mockResolvedValueOnce({ items: [clawHubSkill], errors: [] })
    desktop.getSkillRegistryDetail.mockResolvedValueOnce({
      ...clawHubSkill,
      description: "ClawHub skill detail.",
      latestVersion: { provider: "clawhub", remoteId: clawHubSkill.remoteId, version: "1.0.0" },
    })

    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    openThirdPartyMarketplace()

    const row = await screen.findByRole("button", { name: /Reader Skill/ })
    const icon = within(row).getByRole("img", { name: "Reader Skill icon" })
    expect(icon.tagName).toBe("IMG")
    expect(icon).toHaveAttribute("src", "https://github.com/pskoett.png?size=80")

    fireEvent.error(icon)
    expect(within(row).getByRole("img", { name: "Reader Skill icon" }).tagName).toBe("SPAN")
  })

  it("keeps downloaded navigation logo-free while retaining detail identity", async () => {
    const remoteIcon = "https://cdn.skillhub.cn/icons/reader.png"
    const localIcon = "data:image/png;base64,iVBORw0KGgo="
    desktop.listDownloadedRegistrySkills.mockResolvedValueOnce([
      { ...downloaded, iconUrl: remoteIcon },
      {
        ...downloaded,
        id: "registry:clawhub:demo/local-icon",
        remoteId: "demo/local-icon",
        slug: "local-icon",
        displayName: "Local Icon Skill",
        iconUrl: localIcon,
      },
    ])

    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    fireEvent.click(screen.getByRole("tab", { name: "Downloaded" }))

    const readerRow = await screen.findByRole("button", { name: /Reader Skill/ })
    const localIconRow = screen.getByRole("button", { name: /Local Icon Skill/ })
    expect(readerRow).toHaveClass("is-navigation")
    expect(readerRow.querySelector(".skill-library-product-icon")).toBeNull()
    expect(localIconRow.querySelector(".skill-library-product-icon")).toBeNull()

    fireEvent.click(localIconRow)
    const detailImage = document.querySelector<HTMLImageElement>(
      ".skill-library-downloaded-identity .skill-library-product-icon img",
    )
    expect(detailImage).not.toBeNull()
    expect(detailImage).toHaveAttribute("src", localIcon)
  })

  it("filters downloaded skills in place without replacing the workspace", async () => {
    const enabledDownloaded = {
      ...downloaded,
      id: "registry:clawhub:demo/writer",
      remoteId: "demo/writer",
      slug: "writer",
      displayName: "Writer Skill",
      enabled: true,
    }
    desktop.listDownloadedRegistrySkills.mockResolvedValueOnce([downloaded, enabledDownloaded])

    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    fireEvent.click(screen.getByRole("tab", { name: "Downloaded" }))

    const workspace = screen.getByRole("tabpanel", { name: /Downloaded/ })
    expect(await screen.findByRole("button", { name: /Reader Skill/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Writer Skill/ })).toBeInTheDocument()

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "enabled" } })
    expect(screen.queryByRole("button", { name: /Reader Skill/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Writer Skill/ })).toBeInTheDocument()
    expect(screen.getByRole("tabpanel", { name: /Downloaded/ })).toBe(workspace)

    fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), { target: { value: "reader" } })
    expect(screen.queryByRole("button", { name: /Writer Skill/ })).not.toBeInTheDocument()
    expect(screen.getByText("No matching skills found.")).toBeInTheDocument()
  })

  it("searches only while the third-party marketplace is open", async () => {
    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    openThirdPartyMarketplace()

    const searchInput = within(screen.getByRole("dialog", { name: "Third-party Skills" })).getByRole("searchbox", { name: "Search skills" })
    fireEvent.change(searchInput, { target: { value: "unity" } })
    await waitFor(() => expect(desktop.searchSkillRegistry).toHaveBeenLastCalledWith(expect.objectContaining({ query: "unity" })))

    desktop.searchSkillRegistry.mockClear()
    fireEvent.change(searchInput, { target: { value: "blender" } })
    fireEvent.click(screen.getByRole("button", { name: "Close third-party Skills" }))
    await new Promise((resolve) => window.setTimeout(resolve, 450))
    expect(desktop.searchSkillRegistry).not.toHaveBeenCalled()
  })

  it("presents Tencent SkillHub as a public source without credential controls", async () => {
    window.localStorage.setItem("desktop.locale", "zh-CN")
    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)

    fireEvent.click(screen.getByRole("button", { name: "添加 Skill" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "获取第三方 Skill" }))

    expect(await screen.findByRole("button", { name: "腾讯 SkillHub" })).toBeEnabled()
    expect(screen.queryByText(/Beta/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/API key/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /配置 SkillHub|管理 SkillHub/i })).not.toBeInTheDocument()
  })

  it("downloads into the managed list and reads the offline SKILL.md", async () => {
    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    openThirdPartyMarketplace()

    const downloadButton = await screen.findByRole("button", { name: "Download locally" })
    fireEvent.click(downloadButton)
    await waitFor(() => expect(desktop.downloadSkillRegistrySkill).toHaveBeenCalledWith({
      provider: "clawhub",
      remoteId: "demo/reader",
      version: "1.0.0",
    }))

    fireEvent.click(await screen.findByRole("button", { name: "Manage in \"Downloaded\"" }))
    const overviewTab = await screen.findByRole("tab", { name: "Overview" })
    expect(overviewTab).toHaveAttribute("aria-selected", "true")
    expect(await screen.findByText("SHA-256")).toBeInTheDocument()
    expect(screen.getByText(/quarantined/i)).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Offline Reader" })).not.toBeInTheDocument()

    fireEvent.keyDown(overviewTab, { key: "ArrowRight" })
    expect(screen.getByRole("tab", { name: "Security" })).toHaveAttribute("aria-selected", "true")
    fireEvent.click(screen.getByRole("tab", { name: "Files" }))
    expect(await screen.findByRole("heading", { name: "Offline Reader" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("option", { name: "notes.txt" }))
    await waitFor(() => expect(desktop.readDownloadedRegistrySkillFile).toHaveBeenCalledWith({
      id: downloaded.id,
      path: "notes.txt",
      version: "1.0.0",
    }))
  })

  it("ignores a stale file response after another downloaded skill is selected", async () => {
    const secondDownloaded = {
      ...downloaded,
      id: "registry:clawhub:demo/writer",
      remoteId: "demo/writer",
      slug: "writer",
      displayName: "Writer Skill",
    }
    desktop.listDownloadedRegistrySkills.mockResolvedValueOnce([downloaded, secondDownloaded])
    let resolveNotes: ((value: RegistryFileContent) => void) | undefined
    desktop.readDownloadedRegistrySkillFile.mockImplementation(({ id, path }) => {
      if (id === downloaded.id && path === "notes.txt") {
        return new Promise((resolve) => { resolveNotes = resolve })
      }
      return Promise.resolve({
        provider: "clawhub",
        remoteId: id === secondDownloaded.id ? "demo/writer" : "demo/reader",
        version: "1.0.0",
        path: "SKILL.md",
        name: "SKILL.md",
        content: id === secondDownloaded.id ? "# Writer Content" : "# Initial Skill",
        encoding: "utf8" as const,
      })
    })
    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    fireEvent.click(screen.getByRole("tab", { name: "Downloaded" }))
    fireEvent.click(await screen.findByRole("tab", { name: "Files" }))

    expect(await screen.findByRole("heading", { name: "Initial Skill" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("option", { name: "notes.txt" }))
    fireEvent.click(screen.getByRole("button", { name: /Writer Skill/ }))
    fireEvent.click(await screen.findByRole("tab", { name: "Files" }))
    expect(await screen.findByRole("heading", { name: "Writer Content" })).toBeInTheDocument()

    await act(async () => {
      resolveNotes?.({
        provider: "clawhub",
        remoteId: "demo/reader",
        version: "1.0.0",
        path: "notes.txt",
        name: "notes.txt",
        content: "# Stale Notes",
        encoding: "utf8" as const,
      })
    })
    expect(screen.queryByRole("heading", { name: "Stale Notes" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Writer Content" })).toBeInTheDocument()
  })

  it("forks a managed skill into the local catalog", async () => {
    desktop.listDownloadedRegistrySkills.mockResolvedValue([downloaded])
    const onForkedToLocal = vi.fn()
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<I18nProvider><Harness onForkedToLocal={onForkedToLocal}><div>Local editor</div></Harness></I18nProvider>)
    fireEvent.click(screen.getByRole("tab", { name: "Downloaded" }))

    fireEvent.click(await screen.findByRole("button", { name: "Fork to local" }))
    await waitFor(() => expect(desktop.forkDownloadedRegistrySkill).toHaveBeenCalledWith({ id: downloaded.id }))
    await waitFor(() => expect(onForkedToLocal).toHaveBeenCalledWith(expect.objectContaining({ filePath: expect.stringContaining("SKILL.md") })))
    confirm.mockRestore()
  })

  it("shows verified Tencent SkillHub package integrity separately from security scans", async () => {
    desktop.listDownloadedRegistrySkills.mockResolvedValue([{
      ...downloaded,
      provider: "skillhub",
      canonicalUrl: "https://skillhub.cn/skills/reader",
      versions: downloaded.versions.map((version) => ({
        ...version,
        source: {
          kind: "archive" as const,
          contentHash: "c".repeat(64),
          contentHashAlgorithm: "skillhub-v1" as const,
          signatureKeyId: "skillhub-platform-v1",
          signatureVerified: true,
        },
      })),
    }])
    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    fireEvent.click(screen.getByRole("tab", { name: "Downloaded" }))
    fireEvent.click(await screen.findByRole("tab", { name: "Security" }))

    expect(await screen.findByText("Tencent SkillHub content fingerprint and Ed25519 signature verified")).toBeInTheDocument()
    expect(screen.getByText(/Signing key: skillhub-platform-v1/)).toBeInTheDocument()
  })

  it("shows file-level changes before applying an update", async () => {
    desktop.listDownloadedRegistrySkills.mockResolvedValue([downloaded])
    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    fireEvent.click(screen.getByRole("tab", { name: "Downloaded" }))

    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }))
    const dialog = await screen.findByRole("dialog", { name: "Update preview" })
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus())
    expect(dialog).toHaveTextContent("Changed 1")
    expect(dialog).toHaveTextContent("Added 1")
    expect(dialog).toHaveTextContent("SKILL.md")
    expect(dialog).toHaveTextContent("notes.txt")
    expect(desktop.updateDownloadedRegistrySkill).not.toHaveBeenCalled()

    const updateButton = screen.getByRole("button", { name: "Update and scan again" })
    updateButton.focus()
    fireEvent.keyDown(window, { key: "Tab" })
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus()

    fireEvent.click(updateButton)
    await waitFor(() => expect(desktop.updateDownloadedRegistrySkill).toHaveBeenCalledWith({
      id: downloaded.id,
      version: "1.1.0",
    }))
  })

  it("does not fork when the dirty-editor guard declines", async () => {
    desktop.listDownloadedRegistrySkills.mockResolvedValueOnce([downloaded])
    const onBeforeForkToLocal = vi.fn(() => false)
    render(<I18nProvider><Harness onBeforeForkToLocal={onBeforeForkToLocal}><div>Local editor</div></Harness></I18nProvider>)
    fireEvent.click(screen.getByRole("tab", { name: "Downloaded" }))

    fireEvent.click(await screen.findByRole("button", { name: "Fork to local" }))
    expect(onBeforeForkToLocal).toHaveBeenCalled()
    expect(desktop.forkDownloadedRegistrySkill).not.toHaveBeenCalled()
  })

  it("handles update-preview failures without leaving a pending state", async () => {
    desktop.listDownloadedRegistrySkills.mockResolvedValueOnce([downloaded])
    desktop.previewDownloadedRegistrySkillUpdate.mockRejectedValueOnce(new Error("offline"))
    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    fireEvent.click(screen.getByRole("tab", { name: "Downloaded" }))

    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }))
    expect(await screen.findByText("Unable to load the update preview. Try again later.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Check for updates" })).not.toBeDisabled()
  })

  it("loads the next cursor page and keeps unknown-risk results out of the low-risk filter", async () => {
    const unknownSkill = {
      ...skill,
      id: "clawhub:demo/unknown",
      remoteId: "demo/unknown",
      slug: "unknown",
      displayName: "Unknown Skill",
      security: undefined,
    }
    const nextSkill = {
      ...skill,
      id: "clawhub:demo/writer",
      remoteId: "demo/writer",
      slug: "writer",
      displayName: "Writer Skill",
    }
    desktop.searchSkillRegistry
      .mockResolvedValueOnce({ items: [skill, unknownSkill], errors: [], nextCursor: { clawhub: "next-page" } })
      .mockResolvedValueOnce({ items: [nextSkill], errors: [] })
    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    openThirdPartyMarketplace()

    fireEvent.click(await screen.findByRole("button", { name: /Unknown Skill/ }))
    fireEvent.click(screen.getByRole("button", { name: "Low risk" }))
    expect(screen.queryByRole("button", { name: /Unknown Skill/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Reader Skill/ })).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    await waitFor(() => expect(desktop.searchSkillRegistry).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: { clawhub: "next-page" } })))
    expect(await screen.findByRole("button", { name: /Writer Skill/ })).toBeInTheDocument()
  })

  it("opens downloaded management when the marketplace version is newer", async () => {
    desktop.listDownloadedRegistrySkills.mockResolvedValueOnce([downloaded])
    desktop.getSkillRegistryDetail.mockResolvedValueOnce({
      ...skill,
      description: "A detailed description.",
      latestVersion: { provider: "clawhub", remoteId: "demo/reader", version: "1.1.0" },
    })
    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    openThirdPartyMarketplace()

    fireEvent.click(await screen.findByRole("button", { name: "Update in \"Downloaded\"" }))
    await waitFor(() => expect(screen.getByRole("tab", { name: /Downloaded/ })).toHaveAttribute("aria-selected", "true"))
    expect(screen.queryByRole("dialog", { name: "Third-party Skills" })).not.toBeInTheDocument()
    expect(desktop.previewDownloadedRegistrySkillUpdate).not.toHaveBeenCalled()
    expect(desktop.updateDownloadedRegistrySkill).not.toHaveBeenCalled()
  })

  it("keeps the marketplace open when leaving an unsaved local skill is declined", async () => {
    desktop.listDownloadedRegistrySkills.mockResolvedValueOnce([downloaded])
    const canChangeMode = vi.fn(() => false)
    render(
      <I18nProvider>
        <Harness canChangeMode={canChangeMode}><div>Local editor</div></Harness>
      </I18nProvider>,
    )
    openThirdPartyMarketplace()

    fireEvent.click(await screen.findByRole("button", { name: "Manage in \"Downloaded\"" }))
    expect(canChangeMode).toHaveBeenCalledWith("downloaded")
    expect(screen.getByRole("dialog", { name: "Third-party Skills" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Local" })).toHaveAttribute("aria-selected", "true")
  })

  it("switches the remote version before reading its files", async () => {
    desktop.getSkillRegistryVersions.mockResolvedValueOnce([
      { provider: "clawhub", remoteId: "demo/reader", version: "1.0.0" },
      { provider: "clawhub", remoteId: "demo/reader", version: "0.9.0" },
    ])
    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    openThirdPartyMarketplace()
    await screen.findByRole("heading", { name: "Reader Skill", level: 2 })
    fireEvent.click(screen.getByRole("tab", { name: "Versions" }))
    fireEvent.click(await screen.findByRole("button", { name: /0\.9\.0/ }))

    await waitFor(() => expect(desktop.getSkillRegistryFiles).toHaveBeenLastCalledWith({
      provider: "clawhub",
      remoteId: "demo/reader",
      version: "0.9.0",
    }))
  })

  it("resets the detail scroll position when navigating to another skill", async () => {
    const writerSkill = {
      ...skill,
      id: "clawhub:demo/writer",
      remoteId: "demo/writer",
      slug: "writer",
      displayName: "Writer Skill",
      summary: "Write documents safely.",
    }
    desktop.searchSkillRegistry.mockResolvedValueOnce({ items: [skill, writerSkill], errors: [] })
    desktop.getSkillRegistryDetail
      .mockResolvedValueOnce({
        ...skill,
        description: "A detailed description.",
        latestVersion: { provider: "clawhub", remoteId: "demo/reader", version: "1.0.0" },
      })
      .mockResolvedValueOnce({
        ...writerSkill,
        description: "A detailed writer description.",
        latestVersion: { provider: "clawhub", remoteId: "demo/writer", version: "1.0.0" },
      })

    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    openThirdPartyMarketplace()
    await screen.findByRole("heading", { name: "Reader Skill", level: 2 })

    const detailContent = screen.getByRole("tabpanel", { name: "Readme" })
    detailContent.scrollTop = 240
    detailContent.scrollLeft = 40
    fireEvent.click(screen.getByRole("button", { name: /Writer Skill/ }))

    await screen.findByRole("heading", { name: "Writer Skill", level: 2 })
    expect(detailContent.scrollTop).toBe(0)
    expect(detailContent.scrollLeft).toBe(0)
  })

  it("supports arrow-key navigation for workspace and detail tabs", async () => {
    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    const localTab = screen.getByRole("tab", { name: "Local" })
    localTab.focus()
    fireEvent.keyDown(localTab, { key: "ArrowRight" })
    const downloadedTab = screen.getByRole("tab", { name: "Downloaded" })
    await waitFor(() => expect(downloadedTab).toHaveAttribute("aria-selected", "true"))
    expect(downloadedTab).toHaveFocus()

    openThirdPartyMarketplace()
    const readmeTab = await screen.findByRole("tab", { name: "Readme" })
    readmeTab.focus()
    fireEvent.keyDown(readmeTab, { key: "ArrowRight" })
    const filesTab = screen.getByRole("tab", { name: "Files" })
    expect(filesTab).toHaveAttribute("aria-selected", "true")
    expect(filesTab).toHaveFocus()
    expect(filesTab).toHaveAttribute("aria-controls")
  })

  it("keeps Escape inert and restores focus after explicitly closing the marketplace", async () => {
    render(<I18nProvider><Harness><div>Local editor</div></Harness></I18nProvider>)
    const addSkillButton = screen.getByRole("button", { name: "Add Skill" })
    addSkillButton.focus()
    fireEvent.click(addSkillButton)
    fireEvent.click(screen.getByRole("menuitem", { name: "Get third-party Skills" }))

    const dialog = await screen.findByRole("dialog", { name: "Third-party Skills" })
    const searchInput = within(dialog).getByRole("searchbox", { name: "Search skills" })
    await waitFor(() => expect(searchInput).toHaveFocus())

    fireEvent.keyDown(window, { key: "Escape" })
    expect(dialog).toBeInTheDocument()

    const backdrop = dialog.closest(".skill-marketplace-overlay")
    expect(backdrop).not.toBeNull()
    fireEvent.mouseDown(backdrop!)
    fireEvent.click(backdrop!)
    expect(dialog).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Close third-party Skills" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Third-party Skills" })).not.toBeInTheDocument())
    expect(addSkillButton).toHaveFocus()
  })
})
