import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  GlobalSkillFileDocument,
  GlobalSkillTree,
  GlobalSkillTreeNode,
  SkillGitInstallPreview,
  SkillGitInstallResult,
} from "./types"
import { useToast } from "./toast"

interface UseGlobalSkillsOptions {
  onSkillsUpdated?: () => void | Promise<void>
}

type CreateGlobalSkillDraftKind = "skill" | "folder"
type GlobalSkillsMessage = {
  tone: "success" | "error"
  text: string
}

export interface GlobalSkillFolderOption {
  label: string
  path: string | null
}

type AgentEnvelope<T> =
  | {
      success: true
      data: T
    }
  | {
      success: false
      error?: {
        message?: string
      }
    }

const FALLBACK_AGENT_BASE_URL = "http://127.0.0.1:4096"

function resolveFallbackAgentURL(pathname: string) {
  return new URL(pathname, FALLBACK_AGENT_BASE_URL).toString()
}

async function requestFallbackAgentJSON<T>(pathname: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(resolveFallbackAgentURL(pathname), init)
  } catch (error) {
    throw new Error(
      `Desktop bridge is unavailable and the local agent API could not be reached. ${formatError(error)}`,
    )
  }

  const envelope = (await response.json().catch(() => null)) as AgentEnvelope<T> | null
  if (!response.ok || !envelope) {
    throw new Error(`Agent API request failed (${response.status}).`)
  }
  if (envelope.success !== true) {
    throw new Error(envelope.error?.message || `Agent API request failed (${response.status}).`)
  }

  return envelope.data
}

function getGlobalSkillsTreeClient() {
  return window.desktop?.getGlobalSkillsTree ?? (() => requestFallbackAgentJSON<GlobalSkillTree>("/api/skills/tree"))
}

function getReadGlobalSkillFileClient() {
  return window.desktop?.readGlobalSkillFile ??
    ((input: { path: string }) =>
      requestFallbackAgentJSON<GlobalSkillFileDocument>(`/api/skills/file?path=${encodeURIComponent(input.path.trim())}`))
}

function getPreviewGlobalSkillGitInstallClient() {
  return window.desktop?.previewGlobalSkillGitInstall ??
    ((input: { source: string; parentDirectory?: string | null }) =>
      requestFallbackAgentJSON<SkillGitInstallPreview>("/api/skills/git/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      }))
}

function getInstallGlobalSkillsFromGitClient() {
  return window.desktop?.installGlobalSkillsFromGit ??
    ((input: { previewID: string; skillIDs: string[]; parentDirectory?: string | null }) =>
      requestFallbackAgentJSON<SkillGitInstallResult>("/api/skills/git/install", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      }))
}

function findFirstSkillFile(nodes: GlobalSkillTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.kind === "file" && node.name === "SKILL.md") {
      return node.path
    }
  }

  for (const node of nodes) {
    if (node.kind === "directory") {
      const nested = findFirstSkillFile(node.children ?? [])
      if (nested) return nested
    }
  }

  for (const node of nodes) {
    if (node.kind === "file") {
      return node.path
    }
  }

  return null
}

function getDirectoryRole(node: GlobalSkillTreeNode): "folder" | "skill" | "resource" {
  if (node.kind !== "directory") return "resource"
  if (node.role) return node.role
  return (node.children ?? []).some((child) => child.kind === "file" && child.name.toLowerCase() === "skill.md")
    ? "skill"
    : "folder"
}

function findDirectoryAncestors(
  nodes: GlobalSkillTreeNode[],
  targetPath: string,
  trail: string[] = [],
): string[] | null {
  for (const node of nodes) {
    if (node.kind === "file" && node.path === targetPath) {
      return trail
    }

    if (node.kind === "directory") {
      if (node.path === targetPath) {
        return [...trail, node.path]
      }

      const nested = findDirectoryAncestors(node.children ?? [], targetPath, [...trail, node.path])
      if (nested) return nested
    }
  }

  return null
}

function findDirectoryNode(nodes: GlobalSkillTreeNode[], targetPath: string | null): GlobalSkillTreeNode | null {
  if (!targetPath) return null

  for (const node of nodes) {
    if (node.kind !== "directory") continue
    if (node.path === targetPath) return node
    const nested = findDirectoryNode(node.children ?? [], targetPath)
    if (nested) return nested
  }

  return null
}

function containsPath(node: GlobalSkillTreeNode, targetPath: string): boolean {
  if (node.path === targetPath) return true
  if (node.kind !== "directory") return false
  return (node.children ?? []).some((child) => containsPath(child, targetPath))
}

function findSelectedSkillDirectory(nodes: GlobalSkillTreeNode[], targetPath: string | null): GlobalSkillTreeNode | null {
  if (!targetPath) return null

  for (const node of nodes) {
    if (node.kind !== "directory" || !containsPath(node, targetPath)) continue
    if (getDirectoryRole(node) === "skill") {
      return node
    }

    const nested = findSelectedSkillDirectory(node.children ?? [], targetPath)
    if (nested) return nested
  }

  return null
}

function hasNodePath(nodes: GlobalSkillTreeNode[], targetPath: string) {
  return nodes.some((node) => containsPath(node, targetPath))
}

function uniquePaths(input: string[]) {
  return [...new Set(input.filter(Boolean))]
}

function isPathWithinDirectory(path: string, directory: string) {
  return path === directory || path.startsWith(`${directory}\\`) || path.startsWith(`${directory}/`)
}

function replaceDirectoryPrefix(path: string, from: string, to: string) {
  if (path === from) return to
  if (isPathWithinDirectory(path, from)) {
    return `${to}${path.slice(from.length)}`
  }

  return path
}

function getChildrenForParent(nodes: GlobalSkillTreeNode[], parentPath: string | null) {
  if (!parentPath) return nodes
  const parent = findDirectoryNode(nodes, parentPath)
  return parent?.children ?? []
}

function hasDuplicateChildName(nodes: GlobalSkillTreeNode[], parentPath: string | null, input: string) {
  const normalized = input.trim().toLowerCase()
  return getChildrenForParent(nodes, parentPath).some((node) => !node.readOnly && node.name.trim().toLowerCase() === normalized)
}

function hasDuplicateChildNameExcept(
  nodes: GlobalSkillTreeNode[],
  parentPath: string | null,
  input: string,
  ignoredPath: string,
) {
  const normalized = input.trim().toLowerCase()
  return getChildrenForParent(nodes, parentPath).some((node) => {
    if (node.readOnly) return false
    if (node.path === ignoredPath) return false
    return node.name.trim().toLowerCase() === normalized
  })
}

function getParentDirectoryPath(nodes: GlobalSkillTreeNode[], targetPath: string) {
  const ancestors = findDirectoryAncestors(nodes, targetPath)
  if (!ancestors || ancestors.length < 2) return null
  return ancestors[ancestors.length - 2] ?? null
}

function suggestNextDirectoryName(nodes: GlobalSkillTreeNode[], parentPath: string | null, kind: CreateGlobalSkillDraftKind) {
  const baseName = kind === "skill" ? "new-skill" : "new-folder"
  const existing = new Set(
    getChildrenForParent(nodes, parentPath)
      .filter((node) => !node.readOnly)
      .map((node) => node.name.toLowerCase()),
  )

  if (!existing.has(baseName)) return baseName

  let index = 2
  while (existing.has(`${baseName}-${index}`)) {
    index += 1
  }

  return `${baseName}-${index}`
}

function collectFolderOptions(nodes: GlobalSkillTreeNode[], trail: string[] = []): GlobalSkillFolderOption[] {
  const options: GlobalSkillFolderOption[] = []
  for (const node of nodes) {
    if (node.kind !== "directory" || node.readOnly || getDirectoryRole(node) !== "folder") continue
    const nextTrail = [...trail, node.name]
    options.push({
      path: node.path,
      label: nextTrail.join(" / "),
    })
    options.push(...collectFolderOptions(node.children ?? [], nextTrail))
  }

  return options
}

function getMoveTargetOptions(nodes: GlobalSkillTreeNode[], sourcePath: string | null): GlobalSkillFolderOption[] {
  const options: GlobalSkillFolderOption[] = [
    {
      path: null,
      label: "Root",
    },
    ...collectFolderOptions(nodes),
  ]

  if (!sourcePath) return options
  return options.filter((option) => {
    if (!option.path) return true
    return option.path !== sourcePath && !isPathWithinDirectory(option.path, sourcePath)
  })
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function validateSkillNameInput(input: string) {
  const trimmed = input.trim()
  if (!trimmed) {
    return "Skill name is required."
  }

  if (trimmed === "." || trimmed === ".." || /[\\/]/.test(trimmed)) {
    return "Skill name cannot include slashes or relative path segments."
  }

  return null
}

export function useGlobalSkills({ onSkillsUpdated }: UseGlobalSkillsOptions = {}) {
  const toast = useToast()
  const [globalSkillsRoot, setGlobalSkillsRoot] = useState("")
  const [globalSkillsTree, setGlobalSkillsTree] = useState<GlobalSkillTreeNode[]>([])
  const [expandedSkillPaths, setExpandedSkillPaths] = useState<string[]>([])
  const [creatingGlobalSkillName, setCreatingGlobalSkillName] = useState("")
  const [creatingGlobalSkillDraftKind, setCreatingGlobalSkillDraftKind] = useState<CreateGlobalSkillDraftKind>("skill")
  const [creatingGlobalSkillParentDirectory, setCreatingGlobalSkillParentDirectory] = useState<string | null>(null)
  const [isCreateGlobalSkillDraftVisible, setIsCreateGlobalSkillDraftVisible] = useState(false)
  const [renamingGlobalSkillDraftDirectory, setRenamingGlobalSkillDraftDirectory] = useState<string | null>(null)
  const [renamingGlobalSkillName, setRenamingGlobalSkillName] = useState("")
  const [renamingGlobalSkillDirectory, setRenamingGlobalSkillDirectory] = useState<string | null>(null)
  const [selectedGlobalSkillFilePath, setSelectedGlobalSkillFilePath] = useState<string | null>(null)
  const [selectedGlobalSkillFileContent, setSelectedGlobalSkillFileContent] = useState("")
  const [savedGlobalSkillFileContent, setSavedGlobalSkillFileContent] = useState("")
  const [selectedGlobalSkillFileReadOnly, setSelectedGlobalSkillFileReadOnly] = useState(false)
  const [isLoadingGlobalSkillsTree, setIsLoadingGlobalSkillsTree] = useState(false)
  const [isLoadingGlobalSkillFile, setIsLoadingGlobalSkillFile] = useState(false)
  const [isSavingGlobalSkillFile, setIsSavingGlobalSkillFile] = useState(false)
  const [isCreatingGlobalSkill, setIsCreatingGlobalSkill] = useState(false)
  const [deletingGlobalSkillDirectory, setDeletingGlobalSkillDirectory] = useState<string | null>(null)
  const [isGitInstallDialogOpen, setIsGitInstallDialogOpen] = useState(false)
  const [gitInstallSource, setGitInstallSource] = useState("")
  const [gitInstallPreview, setGitInstallPreview] = useState<SkillGitInstallPreview | null>(null)
  const [selectedGitInstallSkillIDs, setSelectedGitInstallSkillIDs] = useState<string[]>([])
  const [isPreviewingGitInstall, setIsPreviewingGitInstall] = useState(false)
  const [isInstallingGitSkills, setIsInstallingGitSkills] = useState(false)
  const [isInstallingLocalSkill, setIsInstallingLocalSkill] = useState(false)
  const [isLocalInstallDialogOpen, setIsLocalInstallDialogOpen] = useState(false)
  const [gitInstallTargetDirectory, setGitInstallTargetDirectory] = useState<string | null>(null)
  const [localInstallTargetDirectory, setLocalInstallTargetDirectory] = useState<string | null>(null)
  const [movingGlobalSkillDirectory, setMovingGlobalSkillDirectory] = useState<string | null>(null)
  const [movingGlobalSkillTargetDirectory, setMovingGlobalSkillTargetDirectory] = useState<string | null>(null)
  const [isMoveGlobalSkillDialogOpen, setIsMoveGlobalSkillDialogOpen] = useState(false)
  const [isMovingGlobalSkillDirectory, setIsMovingGlobalSkillDirectory] = useState(false)

  const treeRequestRef = useRef(0)
  const fileRequestRef = useRef(0)
  const isDirtyGlobalSkillFile =
    selectedGlobalSkillFilePath !== null &&
    !selectedGlobalSkillFileReadOnly &&
    selectedGlobalSkillFileContent !== savedGlobalSkillFileContent
  const selectedGlobalSkillDirectory = useMemo(
    () => findSelectedSkillDirectory(globalSkillsTree, selectedGlobalSkillFilePath),
    [globalSkillsTree, selectedGlobalSkillFilePath],
  )
  const globalSkillFolderOptions = useMemo<GlobalSkillFolderOption[]>(
    () => [
      {
        path: null,
        label: "Root",
      },
      ...collectFolderOptions(globalSkillsTree),
    ],
    [globalSkillsTree],
  )
  const moveGlobalSkillTargetOptions = useMemo<GlobalSkillFolderOption[]>(
    () => getMoveTargetOptions(globalSkillsTree, movingGlobalSkillDirectory),
    [globalSkillsTree, movingGlobalSkillDirectory],
  )

  const showGlobalSkillsMessage = useCallback((message: GlobalSkillsMessage) => {
    if (message.tone === "success") {
      toast.success(message.text)
    } else {
      toast.error(message.text)
    }
  }, [toast])

  async function notifySkillsUpdated() {
    try {
      await onSkillsUpdated?.()
    } catch (error) {
      console.error("[desktop] global skills sync failed:", error)
    }
  }

  function confirmDiscardChanges(action: string) {
    if (!isDirtyGlobalSkillFile) return true
    if (typeof window.confirm !== "function") return true
    return window.confirm(`Discard unsaved changes and ${action}?`)
  }

  function applyExpandedPaths(targetPath: string | null, rootPath: string, nextTree: GlobalSkillTreeNode[]) {
    const ancestorPaths = targetPath ? findDirectoryAncestors(nextTree, targetPath) ?? [] : []
    setExpandedSkillPaths((current) => uniquePaths([...current, rootPath, ...ancestorPaths]))
  }

  async function loadGlobalSkillFile(path: string, options?: { rootPath?: string; tree?: GlobalSkillTreeNode[] }) {
    const readGlobalSkillFile = getReadGlobalSkillFileClient()

    const requestID = ++fileRequestRef.current
    setIsLoadingGlobalSkillFile(true)

    try {
      const document = await readGlobalSkillFile({ path })
      if (fileRequestRef.current !== requestID) return

      setSelectedGlobalSkillFilePath(document.path)
      setSelectedGlobalSkillFileContent(document.content)
      setSavedGlobalSkillFileContent(document.content)
      setSelectedGlobalSkillFileReadOnly(Boolean(document.readOnly))
      applyExpandedPaths(document.path, options?.rootPath ?? globalSkillsRoot, options?.tree ?? globalSkillsTree)
    } catch (error) {
      if (fileRequestRef.current !== requestID) return
      showGlobalSkillsMessage({
        tone: "error",
        text: formatError(error),
      })
    } finally {
      if (fileRequestRef.current === requestID) {
        setIsLoadingGlobalSkillFile(false)
      }
    }
  }

  async function refreshGlobalSkillsTree(preferredFilePath?: string | null) {
    const getGlobalSkillsTree = getGlobalSkillsTreeClient()

    const requestID = ++treeRequestRef.current
    setIsLoadingGlobalSkillsTree(true)

    try {
      const payload = await getGlobalSkillsTree()
      if (treeRequestRef.current !== requestID) return

      setGlobalSkillsRoot(payload.root)
      setGlobalSkillsTree(payload.items)

      const nextFilePath =
        (preferredFilePath && hasNodePath(payload.items, preferredFilePath) ? preferredFilePath : null) ??
        (selectedGlobalSkillFilePath && hasNodePath(payload.items, selectedGlobalSkillFilePath) ? selectedGlobalSkillFilePath : null) ??
        findFirstSkillFile(payload.items)

      setExpandedSkillPaths((current) =>
        uniquePaths([
          ...current.filter((item) => item === payload.root || hasNodePath(payload.items, item)),
          payload.root,
          ...(nextFilePath ? findDirectoryAncestors(payload.items, nextFilePath) ?? [] : []),
        ]),
      )

      if (!nextFilePath) {
        setSelectedGlobalSkillFilePath(null)
        setSelectedGlobalSkillFileContent("")
        setSavedGlobalSkillFileContent("")
        setSelectedGlobalSkillFileReadOnly(false)
        return
      }

      if (nextFilePath === selectedGlobalSkillFilePath) {
        return
      }

      await loadGlobalSkillFile(nextFilePath, {
        rootPath: payload.root,
        tree: payload.items,
      })
    } catch (error) {
      if (treeRequestRef.current !== requestID) return
      showGlobalSkillsMessage({
        tone: "error",
        text: formatError(error),
      })
    } finally {
      if (treeRequestRef.current === requestID) {
        setIsLoadingGlobalSkillsTree(false)
      }
    }
  }

  useEffect(() => {
    void refreshGlobalSkillsTree()
  }, [])

  async function handleGlobalSkillFileSelect(path: string) {
    if (path === selectedGlobalSkillFilePath) return
    if (!confirmDiscardChanges("switch files")) return

    applyExpandedPaths(path, globalSkillsRoot, globalSkillsTree)
    await loadGlobalSkillFile(path)
  }

  function handleGlobalSkillDraftChange(value: string) {
    if (selectedGlobalSkillFileReadOnly) return
    setSelectedGlobalSkillFileContent(value)
  }

  function handleGlobalSkillDirectoryToggle(path: string) {
    setExpandedSkillPaths((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    )
  }

  function handleCreateGlobalSkillDraftStart(kind: CreateGlobalSkillDraftKind = "skill", parentDirectory: string | null = null) {
    if (isCreatingGlobalSkill || isCreateGlobalSkillDraftVisible || renamingGlobalSkillDraftDirectory || renamingGlobalSkillDirectory) return
    const parentNode = parentDirectory ? findDirectoryNode(globalSkillsTree, parentDirectory) : null
    if (parentNode?.readOnly) {
      showGlobalSkillsMessage({
        tone: "error",
        text: "Plugin skills are read-only.",
      })
      return
    }

    setCreatingGlobalSkillDraftKind(kind)
    setCreatingGlobalSkillParentDirectory(parentDirectory)
    setCreatingGlobalSkillName(suggestNextDirectoryName(globalSkillsTree, parentDirectory, kind))
    if (parentDirectory) {
      setExpandedSkillPaths((current) => uniquePaths([...current, parentDirectory]))
    }
    setIsCreateGlobalSkillDraftVisible(true)
  }

  function resetGitInstallDialog() {
    setGitInstallSource("")
    setGitInstallPreview(null)
    setSelectedGitInstallSkillIDs([])
    setGitInstallTargetDirectory(null)
  }

  function handleGitInstallDialogOpen() {
    if (isPreviewingGitInstall || isInstallingGitSkills || isInstallingLocalSkill) return
    resetGitInstallDialog()
    setIsGitInstallDialogOpen(true)
  }

  function handleGitInstallDialogClose() {
    if (isPreviewingGitInstall || isInstallingGitSkills || isInstallingLocalSkill) return
    setIsGitInstallDialogOpen(false)
    resetGitInstallDialog()
  }

  function handleGitInstallSourceChange(value: string) {
    setGitInstallSource(value)
    setGitInstallPreview(null)
    setSelectedGitInstallSkillIDs([])
  }

  function handleGitInstallTargetDirectoryChange(value: string | null) {
    setGitInstallTargetDirectory(value)
    setGitInstallPreview(null)
    setSelectedGitInstallSkillIDs([])
  }

  function handleLocalInstallDialogOpen() {
    if (isPreviewingGitInstall || isInstallingGitSkills || isInstallingLocalSkill) return
    setLocalInstallTargetDirectory(null)
    setIsLocalInstallDialogOpen(true)
  }

  function handleLocalInstallDialogClose() {
    if (isInstallingLocalSkill) return
    setIsLocalInstallDialogOpen(false)
    setLocalInstallTargetDirectory(null)
  }

  function handleLocalInstallTargetDirectoryChange(value: string | null) {
    setLocalInstallTargetDirectory(value)
  }

  function handleGitInstallSkillToggle(skillID: string) {
    setSelectedGitInstallSkillIDs((current) =>
      current.includes(skillID) ? current.filter((item) => item !== skillID) : [...current, skillID],
    )
  }

  async function handlePreviewGitSkillInstall() {
    const previewGlobalSkillGitInstall = getPreviewGlobalSkillGitInstallClient()
    if (isPreviewingGitInstall || isInstallingGitSkills || isInstallingLocalSkill) return

    const source = gitInstallSource.trim()
    if (!source) {
      showGlobalSkillsMessage({
        tone: "error",
        text: "Enter a GitHub repository or Git URL.",
      })
      return
    }

    setIsPreviewingGitInstall(true)
    setGitInstallPreview(null)
    setSelectedGitInstallSkillIDs([])

    try {
      const preview = await previewGlobalSkillGitInstall({
        source,
        parentDirectory: gitInstallTargetDirectory,
      })
      const availableSkillIDs = preview.skills.filter((skill) => skill.available).map((skill) => skill.id)
      setGitInstallPreview(preview)
      setSelectedGitInstallSkillIDs(availableSkillIDs)
      if (preview.skills.length === 0) {
        showGlobalSkillsMessage({
          tone: "error",
          text: "No skills were found in this repository.",
        })
      } else {
          }
    } catch (error) {
      showGlobalSkillsMessage({
        tone: "error",
        text: formatError(error),
      })
    } finally {
      setIsPreviewingGitInstall(false)
    }
  }

  async function handleInstallGitSkills() {
    const installGlobalSkillsFromGit = getInstallGlobalSkillsFromGitClient()
    if (!gitInstallPreview || isPreviewingGitInstall || isInstallingGitSkills || isInstallingLocalSkill) return

    if (selectedGitInstallSkillIDs.length === 0) {
      showGlobalSkillsMessage({
        tone: "error",
        text: "Select at least one skill to install.",
      })
      return
    }
    if (!confirmDiscardChanges("install skills from Git")) return

    setIsInstallingGitSkills(true)

    try {
      const result = await installGlobalSkillsFromGit({
        previewID: gitInstallPreview.previewID,
        skillIDs: selectedGitInstallSkillIDs,
        parentDirectory: gitInstallTargetDirectory,
      })
      const firstInstalledFile = result.installed[0]?.filePath ?? null
      await refreshGlobalSkillsTree(firstInstalledFile)
      setIsGitInstallDialogOpen(false)
      resetGitInstallDialog()
      showGlobalSkillsMessage({
        tone: "success",
        text: `Installed ${result.installed.length} skill${result.installed.length === 1 ? "" : "s"}.`,
      })
      await notifySkillsUpdated()
    } catch (error) {
      showGlobalSkillsMessage({
        tone: "error",
        text: formatError(error),
      })
    } finally {
      setIsInstallingGitSkills(false)
    }
  }

  async function handleInstallLocalSkillFile() {
    const installGlobalSkillFromLocalFile = window.desktop?.installGlobalSkillFromLocalFile
    if (isPreviewingGitInstall || isInstallingGitSkills || isInstallingLocalSkill) return

    if (!installGlobalSkillFromLocalFile) {
      showGlobalSkillsMessage({
        tone: "error",
        text: "Installing from a local file is unavailable in this desktop shell.",
      })
      return
    }
    if (!confirmDiscardChanges("install a skill from a local file")) return

    setIsInstallingLocalSkill(true)

    try {
      const result = await installGlobalSkillFromLocalFile({
        parentDirectory: localInstallTargetDirectory,
      })
      if (!result) return

      const firstInstalledFile = result.installed[0]?.filePath ?? null
      await refreshGlobalSkillsTree(firstInstalledFile)
      setIsLocalInstallDialogOpen(false)
      showGlobalSkillsMessage({
        tone: "success",
        text: `Installed ${result.installed.length} skill${result.installed.length === 1 ? "" : "s"}.`,
      })
      await notifySkillsUpdated()
    } catch (error) {
      showGlobalSkillsMessage({
        tone: "error",
        text: formatError(error),
      })
    } finally {
      setIsInstallingLocalSkill(false)
    }
  }

  function handleCreateGlobalSkillDraftChange(value: string) {
    setCreatingGlobalSkillName(value)
  }

  function handleCreateGlobalSkillDraftCancel() {
    if (isCreatingGlobalSkill) return

    setCreatingGlobalSkillName("")
    setCreatingGlobalSkillDraftKind("skill")
    setCreatingGlobalSkillParentDirectory(null)
    setIsCreateGlobalSkillDraftVisible(false)
  }

  function handleRenameGlobalSkillDraftStart(directoryPath: string) {
    if (isCreatingGlobalSkill || isCreateGlobalSkillDraftVisible || renamingGlobalSkillDirectory) return

    const targetDirectory = findDirectoryNode(globalSkillsTree, directoryPath)
    if (!targetDirectory || targetDirectory.path !== directoryPath) return
    if (targetDirectory.readOnly) return
    const role = getDirectoryRole(targetDirectory)
    if (role !== "skill" && role !== "folder") return

    setRenamingGlobalSkillDraftDirectory(targetDirectory.path)
    setRenamingGlobalSkillName(targetDirectory.name)
  }

  function handleRenameGlobalSkillDraftChange(value: string) {
    setRenamingGlobalSkillName(value)
  }

  function handleRenameGlobalSkillDraftCancel() {
    if (renamingGlobalSkillDirectory) return

    setRenamingGlobalSkillDraftDirectory(null)
    setRenamingGlobalSkillName("")
  }

  async function handleCreateGlobalSkill() {
    const createGlobalSkill = window.desktop?.createGlobalSkill
    const createGlobalSkillFolder = window.desktop?.createGlobalSkillFolder
    if (isCreatingGlobalSkill || !isCreateGlobalSkillDraftVisible) return
    if (creatingGlobalSkillDraftKind === "skill" && !createGlobalSkill) return
    if (creatingGlobalSkillDraftKind === "folder" && !createGlobalSkillFolder) return

    const validationError = validateSkillNameInput(creatingGlobalSkillName)
    if (validationError) {
      showGlobalSkillsMessage({
        tone: "error",
        text: validationError,
      })
      return
    }

    const name = creatingGlobalSkillName.trim()
    if (hasDuplicateChildName(globalSkillsTree, creatingGlobalSkillParentDirectory, name)) {
      showGlobalSkillsMessage({
        tone: "error",
        text: `${creatingGlobalSkillDraftKind === "skill" ? "Skill" : "Folder"} '${name}' already exists.`,
      })
      return
    }

    if (!confirmDiscardChanges(`create a new ${creatingGlobalSkillDraftKind}`)) return

    setIsCreatingGlobalSkill(true)

    try {
      if (creatingGlobalSkillDraftKind === "folder") {
        const created = await createGlobalSkillFolder!({
          name,
          parentDirectory: creatingGlobalSkillParentDirectory,
        })
        await refreshGlobalSkillsTree()
        setExpandedSkillPaths((current) => uniquePaths([...current, created.directory]))
      } else {
        const created = await createGlobalSkill!({
          name,
          parentDirectory: creatingGlobalSkillParentDirectory,
        })
        await refreshGlobalSkillsTree(created.file.path)
      }
      setCreatingGlobalSkillName("")
      setCreatingGlobalSkillDraftKind("skill")
      setCreatingGlobalSkillParentDirectory(null)
      setIsCreateGlobalSkillDraftVisible(false)
      showGlobalSkillsMessage({
        tone: "success",
        text: `Created ${name}.`,
      })
      await notifySkillsUpdated()
    } catch (error) {
      showGlobalSkillsMessage({
        tone: "error",
        text: formatError(error),
      })
    } finally {
      setIsCreatingGlobalSkill(false)
    }
  }

  async function handleRenameGlobalSkill() {
    const renameGlobalSkill = window.desktop?.renameGlobalSkill
    const renameGlobalSkillFolder = window.desktop?.renameGlobalSkillFolder
    const targetDirectory =
      (renamingGlobalSkillDraftDirectory
        ? findDirectoryNode(globalSkillsTree, renamingGlobalSkillDraftDirectory)
        : null) ?? null

    if (!targetDirectory || renamingGlobalSkillDirectory) return
    if (targetDirectory.readOnly) return
    const targetRole = getDirectoryRole(targetDirectory)
    if (targetRole !== "skill" && targetRole !== "folder") return
    if (targetRole === "skill" && !renameGlobalSkill) return
    if (targetRole === "folder" && !renameGlobalSkillFolder) return

    const validationError = validateSkillNameInput(renamingGlobalSkillName)
    if (validationError) {
      showGlobalSkillsMessage({
        tone: "error",
        text: validationError,
      })
      return
    }

    const name = renamingGlobalSkillName.trim()
    if (name === targetDirectory.name) {
      handleRenameGlobalSkillDraftCancel()
      return
    }

    const parentDirectoryPath = getParentDirectoryPath(globalSkillsTree, targetDirectory.path)
    if (hasDuplicateChildNameExcept(globalSkillsTree, parentDirectoryPath, name, targetDirectory.path)) {
      showGlobalSkillsMessage({
        tone: "error",
        text: `${targetRole === "skill" ? "Skill" : "Folder"} '${name}' already exists.`,
      })
      return
    }

    if (selectedGlobalSkillFilePath && isDirtyGlobalSkillFile && isPathWithinDirectory(selectedGlobalSkillFilePath, targetDirectory.path)) {
      if (!confirmDiscardChanges("rename this skill")) {
        return
      }
    }

    setRenamingGlobalSkillDirectory(targetDirectory.path)

    try {
      const renamed: { directory: string; filePath?: string | null } = targetRole === "folder"
        ? await renameGlobalSkillFolder!({
            directory: targetDirectory.path,
            name,
          })
        : await renameGlobalSkill!({
            directory: targetDirectory.path,
            name,
          })
      const preferredFilePath =
        selectedGlobalSkillFilePath && isPathWithinDirectory(selectedGlobalSkillFilePath, targetDirectory.path)
          ? replaceDirectoryPrefix(selectedGlobalSkillFilePath, targetDirectory.path, renamed.directory)
          : "filePath" in renamed
            ? renamed.filePath
            : null
      await refreshGlobalSkillsTree(preferredFilePath)
      setRenamingGlobalSkillDraftDirectory(null)
      setRenamingGlobalSkillName("")
      showGlobalSkillsMessage({
        tone: "success",
        text: `Renamed ${targetDirectory.name} to ${name}.`,
      })
      await notifySkillsUpdated()
    } catch (error) {
      showGlobalSkillsMessage({
        tone: "error",
        text: formatError(error),
      })
    } finally {
      setRenamingGlobalSkillDirectory(null)
    }
  }

  async function handleSaveGlobalSkillFile() {
    const updateGlobalSkillFile = window.desktop?.updateGlobalSkillFile
    if (selectedGlobalSkillFileReadOnly) return
    if (!updateGlobalSkillFile || !selectedGlobalSkillFilePath || !isDirtyGlobalSkillFile || isSavingGlobalSkillFile) return

    setIsSavingGlobalSkillFile(true)

    try {
      const document = await updateGlobalSkillFile({
        path: selectedGlobalSkillFilePath,
        content: selectedGlobalSkillFileContent,
      })
      setSelectedGlobalSkillFileContent(document.content)
      setSavedGlobalSkillFileContent(document.content)
      showGlobalSkillsMessage({
        tone: "success",
        text: `Saved ${document.path.split(/[\\/]/).filter(Boolean).pop() ?? "file"}.`,
      })
      await notifySkillsUpdated()
    } catch (error) {
      showGlobalSkillsMessage({
        tone: "error",
        text: formatError(error),
      })
    } finally {
      setIsSavingGlobalSkillFile(false)
    }
  }

  async function handleOpenGlobalSkillsFolder(targetPath?: string) {
    const openPath = window.desktop?.openPath
    const resolvedTargetPath = targetPath?.trim() || globalSkillsRoot.trim()
    if (!resolvedTargetPath) return


    if (!openPath) {
      showGlobalSkillsMessage({
        tone: "error",
        text: "Opening the skills folder is unavailable in this desktop shell.",
      })
      return
    }

    try {
      await openPath({
        targetPath: resolvedTargetPath,
      })
    } catch (error) {
      showGlobalSkillsMessage({
        tone: "error",
        text: formatError(error),
      })
    }
  }

  async function handleDeleteGlobalSkill(directoryPath?: string) {
    const deleteGlobalSkill = window.desktop?.deleteGlobalSkill
    const deleteGlobalSkillFolder = window.desktop?.deleteGlobalSkillFolder
    const targetDirectory =
      (directoryPath ? findDirectoryNode(globalSkillsTree, directoryPath) : null) ?? selectedGlobalSkillDirectory
    if (!targetDirectory || deletingGlobalSkillDirectory) return
    if (targetDirectory.readOnly) {
      showGlobalSkillsMessage({
        tone: "error",
        text: "Plugin skills are read-only.",
      })
      return
    }

    const targetRole = getDirectoryRole(targetDirectory)
    if (targetRole === "skill" && !deleteGlobalSkill) return
    if (targetRole === "folder" && !deleteGlobalSkillFolder) return
    if (targetRole !== "skill" && targetRole !== "folder") return

    const targetName = targetDirectory.name
    const confirmMessage =
      targetRole === "folder"
        ? `Delete empty folder '${targetName}'?`
        : `Delete global skill '${targetName}'?`
    if (typeof window.confirm === "function" && !window.confirm(confirmMessage)) {
      return
    }

    setDeletingGlobalSkillDirectory(targetDirectory.path)

    try {
      if (targetRole === "folder") {
        await deleteGlobalSkillFolder!({
          directory: targetDirectory.path,
        })
      } else {
        await deleteGlobalSkill!({
          directory: targetDirectory.path,
        })
      }
      await refreshGlobalSkillsTree()
      showGlobalSkillsMessage({
        tone: "success",
        text: `Deleted ${targetName}.`,
      })
      await notifySkillsUpdated()
    } catch (error) {
      showGlobalSkillsMessage({
        tone: "error",
        text: formatError(error),
      })
    } finally {
      setDeletingGlobalSkillDirectory(null)
    }
  }

  function handleMoveGlobalSkillDirectoryStart(directoryPath: string) {
    if (isMoveGlobalSkillDialogOpen || isMovingGlobalSkillDirectory) return

    const targetDirectory = findDirectoryNode(globalSkillsTree, directoryPath)
    if (!targetDirectory) return
    if (targetDirectory.readOnly) return
    const targetRole = getDirectoryRole(targetDirectory)
    if (targetRole !== "skill" && targetRole !== "folder") return

    setMovingGlobalSkillDirectory(targetDirectory.path)
    setMovingGlobalSkillTargetDirectory(getParentDirectoryPath(globalSkillsTree, targetDirectory.path))
    setIsMoveGlobalSkillDialogOpen(true)
  }

  function handleMoveGlobalSkillDirectoryCancel() {
    if (isMovingGlobalSkillDirectory) return
    setIsMoveGlobalSkillDialogOpen(false)
    setMovingGlobalSkillDirectory(null)
    setMovingGlobalSkillTargetDirectory(null)
  }

  function handleMoveGlobalSkillTargetDirectoryChange(value: string | null) {
    setMovingGlobalSkillTargetDirectory(value)
  }

  async function handleMoveGlobalSkillDirectory() {
    const moveGlobalSkillDirectory = window.desktop?.moveGlobalSkillDirectory
    if (!moveGlobalSkillDirectory || !movingGlobalSkillDirectory || isMovingGlobalSkillDirectory) return

    const sourceDirectory = findDirectoryNode(globalSkillsTree, movingGlobalSkillDirectory)
    if (!sourceDirectory) return
    if (sourceDirectory.readOnly) return
    const sourceRole = getDirectoryRole(sourceDirectory)
    if (sourceRole !== "skill" && sourceRole !== "folder") return

    if (selectedGlobalSkillFilePath && isDirtyGlobalSkillFile && isPathWithinDirectory(selectedGlobalSkillFilePath, sourceDirectory.path)) {
      if (!confirmDiscardChanges(`move this ${sourceRole}`)) {
        return
      }
    }

    setIsMovingGlobalSkillDirectory(true)

    try {
      const moved = await moveGlobalSkillDirectory({
        directory: sourceDirectory.path,
        parentDirectory: movingGlobalSkillTargetDirectory,
      })
      const preferredFilePath =
        selectedGlobalSkillFilePath && isPathWithinDirectory(selectedGlobalSkillFilePath, sourceDirectory.path)
          ? replaceDirectoryPrefix(selectedGlobalSkillFilePath, sourceDirectory.path, moved.directory)
          : moved.filePath
      await refreshGlobalSkillsTree(preferredFilePath)
      setIsMoveGlobalSkillDialogOpen(false)
      setMovingGlobalSkillDirectory(null)
      setMovingGlobalSkillTargetDirectory(null)
      showGlobalSkillsMessage({
        tone: "success",
        text: `Moved ${sourceDirectory.name}.`,
      })
      await notifySkillsUpdated()
    } catch (error) {
      showGlobalSkillsMessage({
        tone: "error",
        text: formatError(error),
      })
    } finally {
      setIsMovingGlobalSkillDirectory(false)
    }
  }

  return {
    creatingGlobalSkillName,
    creatingGlobalSkillDraftKind,
    creatingGlobalSkillParentDirectory,
    deletingGlobalSkillDirectory,
    expandedSkillPaths,
    globalSkillFolderOptions,
    globalSkillsRoot,
    globalSkillsTree,
    gitInstallTargetDirectory,
    gitInstallPreview,
    gitInstallSource,
    handleCreateGlobalSkill,
    handleCreateGlobalSkillDraftCancel,
    handleCreateGlobalSkillDraftChange,
    handleCreateGlobalSkillDraftStart,
    handleDeleteGlobalSkill,
    handleGitInstallDialogClose,
    handleGitInstallDialogOpen,
    handleGitInstallSkillToggle,
    handleGitInstallSourceChange,
    handleGitInstallTargetDirectoryChange,
    handleGlobalSkillDirectoryToggle,
    handleGlobalSkillDraftChange,
    handleGlobalSkillFileSelect,
    handleInstallGitSkills,
    handleInstallLocalSkillFile,
    handleLocalInstallDialogClose,
    handleLocalInstallDialogOpen,
    handleLocalInstallTargetDirectoryChange,
    handleMoveGlobalSkillDirectory,
    handleMoveGlobalSkillDirectoryCancel,
    handleMoveGlobalSkillDirectoryStart,
    handleMoveGlobalSkillTargetDirectoryChange,
    handleOpenGlobalSkillsFolder,
    handlePreviewGitSkillInstall,
    handleRenameGlobalSkill,
    handleRenameGlobalSkillDraftCancel,
    handleRenameGlobalSkillDraftChange,
    handleRenameGlobalSkillDraftStart,
    handleSaveGlobalSkillFile,
    isCreateGlobalSkillDraftVisible,
    isCreatingGlobalSkill,
    isDirtyGlobalSkillFile,
    isGitInstallDialogOpen,
    isInstallingGitSkills,
    isInstallingLocalSkill,
    isLocalInstallDialogOpen,
    isLoadingGlobalSkillFile,
    isLoadingGlobalSkillsTree,
    isMoveGlobalSkillDialogOpen,
    isMovingGlobalSkillDirectory,
    isPreviewingGitInstall,
    isSavingGlobalSkillFile,
    localInstallTargetDirectory,
    moveGlobalSkillTargetOptions,
    movingGlobalSkillDirectory,
    movingGlobalSkillTargetDirectory,
    renamingGlobalSkillDirectory,
    renamingGlobalSkillDraftDirectory,
    renamingGlobalSkillName,
    refreshGlobalSkillsTree,
    selectedGlobalSkillDirectory,
    selectedGlobalSkillFileContent,
    selectedGlobalSkillFilePath,
    selectedGlobalSkillFileReadOnly,
    selectedGitInstallSkillIDs,
  }
}
