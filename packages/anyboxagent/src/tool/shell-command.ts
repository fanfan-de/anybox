import path from "node:path"
import { stat } from "node:fs/promises"
import z from "zod"
import * as Tool from "#tool/tool.ts"
import { Flag } from "#flag/flag.ts"
import { Instance } from "#project/instance.ts"
import { withMacOSDefaultPath } from "#shell/environment.ts"
import { getShellTaskRegistry, type ShellTaskResult } from "#shell/task-registry.ts"
import { resolveToolPath, toDisplayPath } from "#tool/shared.ts"
import { which } from "#util/which.ts"

const DEFAULT_YIELD_TIME_MS = 10_000
const MAX_YIELD_TIME_MS = 30_000
const CONFIGURED_DEFAULT_TIMEOUT_MS = Flag.ANYBOX_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS
const DEFAULT_MAX_OUTPUT_CHARS = Flag.ANYBOX_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH ?? 12_000

const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-rf\s+\/(\s|$)/i,
  /\bmkfs(\.[a-z0-9_]+)?\b/i,
  /\bdd\s+.+\bof=\/dev\//i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /\bhalt\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
]

const MACOS_DANGEROUS_COMMAND_PATTERNS = [
  /\bdiskutil\s+eraseDisk\b/i,
  /\bdiskutil\s+partitionDisk\b/i,
  /\bsudo\s+rm\s+-rf\s+\/(\s|$)/i,
  /\bcsrutil\b/i,
  /\bnvram\b/i,
  /\bspctl\s+--master-disable\b/i,
]

const POWERSHELL_DANGEROUS_COMMAND_PATTERNS = [
  /\bRemove-Item\b[\s\S]*-Recurse\b[\s\S]*-Force\b[\s\S]*(?:\b[A-Z]:\\|\/|\$env:SystemRoot)/i,
  /\bFormat-Volume\b/i,
  /\bClear-Disk\b/i,
  /\bStop-Computer\b/i,
  /\bRestart-Computer\b/i,
  /\bSet-ExecutionPolicy\b/i,
  /(?:\bInvoke-WebRequest\b|\biwr\b|\bcurl\b)[\s\S]*\|[\s\S]*(?:\bInvoke-Expression\b|\biex\b)/i,
]

const CMD_DANGEROUS_COMMAND_PATTERNS = [
  /\bformat\b\s+[a-z]:/i,
  /\bshutdown\b/i,
  /\brmdir\b[\s\S]*(?:\/s|-\S*s)[\s\S]*(?:\/q|-\S*q)[\s\S]*(?:[a-z]:\\|\\$)/i,
  /\brd\b[\s\S]*(?:\/s|-\S*s)[\s\S]*(?:\/q|-\S*q)[\s\S]*(?:[a-z]:\\|\\$)/i,
  /\bdel\b[\s\S]*(?:\/s|-\S*s)[\s\S]*(?:\/q|-\S*q)[\s\S]*(?:[a-z]:\\|\\$)/i,
]

const PROTECTED_PROCESS_NAME_ENV = "ANYBOX_PROTECTED_PROCESS_NAMES"
const PROTECTED_PROCESS_ID_ENV_KEYS = [
  "ANYBOX_DESKTOP_PROCESS_ID",
  "ANYBOX_AGENT_PROCESS_ID",
  "ANYBOX_AGENT_PARENT_PROCESS_ID",
] as const
const DEFAULT_PROTECTED_PROCESS_NAMES = [
  "anybox",
  "anybox.exe",
  "anybox-desktop-agent",
  "anybox-desktop-agent.exe",
] as const

export type ShellKind = "bash" | "posix" | "powershell" | "cmd" | "wsl"

export type ShellCommandInput = {
  command: string
  workdir?: string
  timeoutMs?: number
  "yield-time_ms"?: number
  maxOutputChars?: number
  allowUnsafe?: boolean
  description?: string
  runInBackground?: boolean
  run_in_background?: boolean
  distro?: string
}

interface ShellCommandMetadata extends Record<string, unknown> {
  command: string
  shell: string
  cwd: string
  displayCwd: string
  timeoutMs: number | null
  yieldTimeMs?: number
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  aborted: boolean
  stdoutTruncated: boolean
  stderrTruncated: boolean
  stdout: string
  stderr: string
  runInBackground?: boolean
  backgroundTaskId?: string | null
  backgroundTaskCursor?: number | null
  sessionID?: string | null
}

type WhichCommand = typeof which
type IsFile = (filePath: string) => Promise<boolean>

type ResolverOptions = {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  configuredGitBashPath?: string | null
  whichCommand?: WhichCommand
  isFile?: IsFile
}

type ShellInvocation = {
  executable: string
  args: string[]
  shell: string
  env?: NodeJS.ProcessEnv
}

type ShellToolConfig<Parameters extends z.ZodType> = {
  id: string
  title: string
  shellKind: ShellKind
  description: string
  parameters: Parameters
  resolveInvocation(parameters: z.infer<Parameters>, cwd: string): Promise<ShellInvocation>
}

async function isExistingFile(filePath: string) {
  return await stat(filePath).then((fileStat) => fileStat.isFile()).catch(() => false)
}

async function firstExistingFile(candidates: Array<string | undefined | null>, isFile: IsFile) {
  for (const candidate of candidates) {
    if (candidate && await isFile(candidate)) {
      return candidate
    }
  }

  return null
}

function getResolverParts(options?: ResolverOptions) {
  return {
    env: options?.env ?? process.env,
    platform: options?.platform ?? process.platform,
    configuredGitBashPath: options?.configuredGitBashPath ?? Flag.ANYBOX_GIT_BASH_PATH,
    whichCommand: options?.whichCommand ?? which,
    isFile: options?.isFile ?? isExistingFile,
  }
}

function shellCommandParameters(input: {
  commandDescription: string
  wslDistro?: boolean
}) {
  const shape = {
    command: z.string().min(1).describe(input.commandDescription),
    workdir: z.string().optional().describe("Working directory. Defaults to the current project directory."),
    timeoutMs: z.number().int().positive().max(10 * 60 * 1000).optional().describe("Optional hard runtime limit in milliseconds. A task that exceeds it is terminated."),
    "yield-time_ms": z.number().int().nonnegative().max(MAX_YIELD_TIME_MS).optional().describe("How long to wait before returning a background task id for a still-running command. Defaults to 10000 ms; use 0 to return immediately."),
    maxOutputChars: z.number().int().positive().max(200_000).optional().describe("Maximum chars kept for stdout and stderr."),
    allowUnsafe: z.boolean().optional().describe("Allow known dangerous command patterns."),
    description: z.string().optional().describe("Short description for the command intent."),
    runInBackground: z.boolean().optional().describe("Compatibility shortcut for yield-time_ms=0. True returns a managed background task immediately."),
    run_in_background: z.boolean().optional().describe("Alias for runInBackground."),
    ...(input.wslDistro
      ? {
          distro: z.string().trim().min(1).optional().describe("Optional WSL distribution name. Defaults to the user's default WSL distribution."),
        }
      : {}),
  }

  return z.object(shape)
}

const GitBashCommandParameters = shellCommandParameters({
  commandDescription: "Git Bash/MSYS Bash command to execute.",
})

const MacOSShellCommandParameters = shellCommandParameters({
  commandDescription: "macOS zsh/POSIX shell command to execute.",
})

const PowerShellCommandParameters = shellCommandParameters({
  commandDescription: "PowerShell command to execute.",
})

const CmdCommandParameters = shellCommandParameters({
  commandDescription: "Windows Command Prompt command to execute.",
})

const WslBashCommandParameters = shellCommandParameters({
  commandDescription: "WSL Linux Bash command to execute.",
  wslDistro: true,
})

function shouldRunInBackground(parameters: ShellCommandInput) {
  return parameters.runInBackground ?? parameters.run_in_background ?? false
}

function resolveYieldTimeMs(parameters: ShellCommandInput) {
  if (shouldRunInBackground(parameters)) return 0
  return parameters["yield-time_ms"] ?? DEFAULT_YIELD_TIME_MS
}

function shellInput<Parameters extends z.ZodType>(parameters: z.infer<Parameters>): ShellCommandInput {
  return parameters as ShellCommandInput
}

function formatValidationError(toolID: string, error: z.ZodError) {
  const issues = error.issues.map((issue) => {
    const issuePath = issue.path.length > 0 ? issue.path.join(".") : "input"
    return `${issuePath}: ${issue.message}`
  })

  return issues.length > 0
    ? `Invalid ${toolID} arguments. ${issues.join(" ")}`
    : `Invalid ${toolID} arguments.`
}

function resolveCommandCwd(parameters: ShellCommandInput, ctx: Tool.Context) {
  return parameters.workdir
    ? resolveToolPath(parameters.workdir)
    : resolveToolPath(ctx.cwd ?? Instance.directory)
}

function normalizeCommand(command: string) {
  return command.trim().replace(/\s+/g, " ")
}

function shellFirstCommand(command: string) {
  return normalizeCommand(command)
    .split(/[;&|]/)[0]
    ?.trim()
    .split(/\s+/)[0]
    ?.toLowerCase()
}

function escapeRegex(value: string) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
}

function normalizeProcessTargetName(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return ""
  return normalized.endsWith(".exe") ? normalized.slice(0, -4) : normalized
}

function protectedProcessNamePattern(env: NodeJS.ProcessEnv = process.env) {
  const names = new Set<string>()
  for (const name of DEFAULT_PROTECTED_PROCESS_NAMES) {
    const normalized = normalizeProcessTargetName(name)
    if (normalized) names.add(normalized)
  }

  const configured = env[PROTECTED_PROCESS_NAME_ENV]
  if (configured) {
    for (const item of configured.split(/[,\n;\r]+/)) {
      const normalized = normalizeProcessTargetName(item)
      if (normalized) names.add(normalized)
    }
  }

  return [...names]
    .sort((left, right) => right.length - left.length)
    .map((name) => `${escapeRegex(name)}(?:\\.exe)?`)
    .join("|")
}

function protectedProcessIDs(env: NodeJS.ProcessEnv = process.env) {
  const ids = new Set<number>()
  const add = (value: unknown) => {
    if (typeof value !== "string" && typeof value !== "number") return
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed > 0) ids.add(parsed)
  }

  add(process.pid)
  add(process.ppid)
  for (const key of PROTECTED_PROCESS_ID_ENV_KEYS) {
    add(env[key])
  }

  return [...ids].map(String)
}

function protectedProcessIDPattern(env: NodeJS.ProcessEnv = process.env) {
  return protectedProcessIDs(env).map(escapeRegex).join("|")
}

function protectedProcessIDEnvRefPattern() {
  return PROTECTED_PROCESS_ID_ENV_KEYS
    .flatMap((key) => [
      `\\$env:${escapeRegex(key)}`,
      `%${escapeRegex(key)}%`,
      `\\$\\{${escapeRegex(key)}\\}`,
      `\\$${escapeRegex(key)}`,
    ])
    .join("|")
}

function isProtectedProcessTerminationCommand(command: string, env: NodeJS.ProcessEnv = process.env) {
  const namePattern = protectedProcessNamePattern(env)
  const pidPattern = protectedProcessIDPattern(env)
  const pidEnvPattern = protectedProcessIDEnvRefPattern()
  const pidTargetPattern = [pidPattern, pidEnvPattern].filter(Boolean).join("|")
  const nameRegexes = [
    new RegExp(`\\btaskkill\\b[\\s\\S]*(?:/im|/fi)\\s+["']?[^"']*\\b(?:${namePattern})\\b`, "i"),
    new RegExp(`\\b(?:Stop-Process|spps)\\b[\\s\\S]*(?:-Name\\s+)?["']?(?:${namePattern})\\b`, "i"),
    new RegExp(`\\b(?:Get-Process|gps|ps)\\b[\\s\\S]*\\b(?:${namePattern})\\b[\\s\\S]*\\|[\\s\\S]*\\b(?:Stop-Process|spps|kill)\\b`, "i"),
    new RegExp(`\\bwmic\\b[\\s\\S]*\\bprocess\\b[\\s\\S]*(?:name|caption)[\\s\\S]*\\b(?:${namePattern})\\b[\\s\\S]*\\b(?:delete|call\\s+terminate)\\b`, "i"),
    new RegExp(`\\b(?:Get-CimInstance|gcim|Get-WmiObject|gwmi)\\b[\\s\\S]*\\bWin32_Process\\b[\\s\\S]*\\b(?:${namePattern})\\b[\\s\\S]*\\b(?:Terminate|Stop-Process|Remove-CimInstance|Invoke-CimMethod)\\b`, "i"),
    new RegExp(`\\b(?:pkill|killall)\\b[\\s\\S]*\\b(?:${namePattern})\\b`, "i"),
  ]

  if (nameRegexes.some((pattern) => pattern.test(command))) {
    return true
  }

  if (!pidTargetPattern) return false

  const pidTarget = `(?:${pidTargetPattern})(?=$|\\D)`
  return [
    new RegExp(`\\btaskkill\\b[\\s\\S]*/pid\\s+["']?${pidTarget}`, "i"),
    new RegExp(`\\b(?:Stop-Process|spps)\\b[\\s\\S]*(?:-Id|-PID)\\s*["']?${pidTarget}`, "i"),
    new RegExp(`\\bkill\\b(?:\\s+-(?:\\d+|[A-Z]+))*\\s+["']?${pidTarget}`, "i"),
    new RegExp(`\\b(?:Get-Process|gps|ps)\\b[\\s\\S]*(?:-Id|-PID)?\\s*["']?${pidTarget}[\\s\\S]*\\|[\\s\\S]*\\b(?:Stop-Process|spps|kill)\\b`, "i"),
    new RegExp(`\\bGetProcessById\\(\\s*["']?${pidTarget}["']?\\s*\\)[\\s\\S]*\\.Kill\\s*\\(`, "i"),
    new RegExp(`\\bwmic\\b[\\s\\S]*\\bprocess\\b[\\s\\S]*(?:processid|handle)\\s*=?\\s*["']?${pidTarget}[\\s\\S]*\\b(?:delete|call\\s+terminate)\\b`, "i"),
  ].some((pattern) => pattern.test(command))
}

export function isCriticalShellCommand(kind: ShellKind, command: string) {
  if (isProtectedProcessTerminationCommand(command)) {
    return true
  }

  if (kind === "powershell") {
    return POWERSHELL_DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
  }

  if (kind === "cmd") {
    return CMD_DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
  }

  return [
    ...DANGEROUS_COMMAND_PATTERNS,
    ...(kind === "posix" ? MACOS_DANGEROUS_COMMAND_PATTERNS : []),
  ].some((pattern) => pattern.test(command))
}

function isShellReadOnlyCommand(kind: ShellKind, command: string) {
  const normalized = normalizeCommand(command).toLowerCase()
  const first = shellFirstCommand(command)

  if (!first) return false

  if (kind === "powershell") {
    return [
      "get-childitem",
      "gci",
      "dir",
      "ls",
      "get-content",
      "gc",
      "select-string",
      "get-command",
      "get-location",
      "pwd",
      "where-object",
      "measure-object",
    ].includes(first)
  }

  if (kind === "cmd") {
    return ["dir", "type", "where", "echo", "find", "findstr", "cd"].includes(first)
  }

  if (["ls", "pwd", "cat", "head", "tail", "grep", "rg", "find", "wc", "which", "type"].includes(first)) {
    return true
  }

  return /^git\s+(status|log|show|diff|branch|rev-parse|ls-files|grep)\b/i.test(normalized)
}

function isShellWriteLikeCommand(kind: ShellKind, command: string) {
  const normalized = normalizeCommand(command).toLowerCase()
  const first = shellFirstCommand(command)

  if (!first) return false

  if (kind === "powershell") {
    return [
      "set-content",
      "add-content",
      "new-item",
      "copy-item",
      "move-item",
      "remove-item",
      "rename-item",
      "out-file",
      "start-process",
      "npm",
      "pnpm",
      "yarn",
      "bun",
    ].includes(first) || /\|\s*(set-content|add-content|out-file)\b/i.test(command)
  }

  if (kind === "cmd") {
    return [
      "copy",
      "xcopy",
      "move",
      "ren",
      "rename",
      "del",
      "erase",
      "mkdir",
      "md",
      "rmdir",
      "rd",
      "npm",
      "pnpm",
      "yarn",
      "bun",
    ].includes(first) || /(^|[^>])>(?!>)/.test(command) || />>/.test(command)
  }

  return [
    "rm",
    "mv",
    "cp",
    "mkdir",
    "rmdir",
    "touch",
    "chmod",
    "chown",
    "npm",
    "pnpm",
    "yarn",
    "bun",
    "pip",
    "cargo",
    "go",
  ].includes(first) || />|>>|\bsed\s+-i\b|\bgit\s+(add|commit|checkout|switch|reset|clean|merge|rebase|pull|push|apply)\b/i.test(normalized)
}

function isShellNetworkExecution(command: string) {
  return /(?:\bcurl\b|\bwget\b|\bInvoke-WebRequest\b|\biwr\b)[\s\S]*\|[\s\S]*(?:\bsh\b|\bbash\b|\biex\b|\bInvoke-Expression\b)/i
    .test(command)
}

export function assessShellPermission(kind: ShellKind, input: ShellCommandInput, cwd: string): Tool.ToolPermissionIntent {
  const command = input.command.trim()
  const displayCwd = toDisplayPath(cwd)
  const resource = {
    command,
    workdir: displayCwd,
    paths: [displayCwd],
  }

  if (isCriticalShellCommand(kind, command) || isShellNetworkExecution(command)) {
    return {
      action: "deny",
      risk: "critical",
      reason: "Command matches a critical-risk shell pattern.",
      resource,
    }
  }

  if (isShellReadOnlyCommand(kind, command)) {
    return {
      action: "allow",
      risk: "low",
      reason: "Command appears to be read-only.",
      resource,
    }
  }

  if (isShellWriteLikeCommand(kind, command)) {
    return {
      action: "allow",
      risk: "low",
      reason: "Command is permitted by the shell write-like command policy.",
      resource,
    }
  }

  return {
    action: "ask",
    risk: "medium",
    reason: "Shell command could not be classified as safely read-only.",
    resource,
  }
}

function quoteBashSingle(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function gitBashCandidatesFromEnvironment(env: NodeJS.ProcessEnv) {
  const windowsPath = path.win32
  return [
    env.ProgramFiles ? windowsPath.join(env.ProgramFiles, "Git", "bin", "bash.exe") : undefined,
    env["ProgramFiles(x86)"] ? windowsPath.join(env["ProgramFiles(x86)"], "Git", "bin", "bash.exe") : undefined,
    env.LocalAppData ? windowsPath.join(env.LocalAppData, "Programs", "Git", "bin", "bash.exe") : undefined,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ]
}

async function resolveShellCandidate(
  candidate: string | undefined,
  env: NodeJS.ProcessEnv,
  whichCommand: WhichCommand,
  isFile: IsFile,
) {
  const value = candidate?.trim()
  if (!value) return null

  if (path.isAbsolute(value) || value.includes("/") || value.includes("\\")) {
    return await isFile(value) ? value : null
  }

  return whichCommand(value, env)
}

function buildMacOSShellEnvironment(env: NodeJS.ProcessEnv) {
  return {
    ...env,
    PATH: withMacOSDefaultPath(env.PATH ?? env.Path),
  }
}

export function waitForProcessExit(proc: {
  once(event: "error", listener: (error: Error) => void): unknown
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown
}) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    proc.once("error", reject)
    proc.once("exit", (code, signal) => resolve({ code, signal }))
  })
}

export async function resolveGitBashExecutable(options?: ResolverOptions) {
  const { env, platform, configuredGitBashPath, whichCommand, isFile } = getResolverParts(options)

  if (configuredGitBashPath && await isFile(configuredGitBashPath)) {
    return configuredGitBashPath
  }

  if (platform === "win32") {
    const windowsPath = path.win32
    const git = whichCommand("git.exe", env) ?? whichCommand("git", env)
    if (git) {
      const gitBash = windowsPath.resolve(git, "..", "..", "bin", "bash.exe")
      if (await isFile(gitBash)) {
        return gitBash
      }
    }

    const commonPath = await firstExistingFile(gitBashCandidatesFromEnvironment(env), isFile)
    if (commonPath) return commonPath
  }

  throw new Error(
    "No Git Bash executable was found. Set ANYBOX_GIT_BASH_PATH or install Git for Windows.",
  )
}

export async function resolveMacOSShellExecutable(options?: ResolverOptions) {
  const { env, platform, whichCommand, isFile } = getResolverParts(options)

  const configured = await resolveShellCandidate(
    env.ANYBOX_MACOS_SHELL,
    env,
    whichCommand,
    isFile,
  )
  if (configured) return configured

  const fromShellEnv = await resolveShellCandidate(env.SHELL, env, whichCommand, isFile)
  if (fromShellEnv) return fromShellEnv

  if (platform === "darwin") {
    const systemShell = await firstExistingFile(["/bin/zsh", "/bin/bash", "/bin/sh"], isFile)
    if (systemShell) return systemShell
  }

  const fromPath = whichCommand("zsh", env) ?? whichCommand("bash", env) ?? whichCommand("sh", env)
  if (fromPath) return fromPath

  throw new Error(
    "No macOS shell executable was found. Set ANYBOX_MACOS_SHELL or SHELL, or add zsh, bash, or sh to PATH.",
  )
}

export async function resolvePowerShellExecutable(options?: ResolverOptions) {
  const { env, platform, whichCommand, isFile } = getResolverParts(options)
  const fromPath = whichCommand("powershell.exe", env) ?? whichCommand("powershell", env)
  if (fromPath) return fromPath

  if (platform === "win32") {
    const windowsPath = path.win32
    const systemRoot = env.SystemRoot ?? (env.SystemDrive ? windowsPath.join(env.SystemDrive, "Windows") : "C:\\Windows")
    const defaultPath = windowsPath.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    if (await isFile(defaultPath)) return defaultPath
  }

  throw new Error("No PowerShell executable was found. Install Windows PowerShell or add powershell.exe to PATH.")
}

export async function resolveCmdExecutable(options?: ResolverOptions) {
  const { env, platform, whichCommand, isFile } = getResolverParts(options)
  const comspec = env.ComSpec ?? env.comspec
  if (comspec && await isFile(comspec)) return comspec

  const fromPath = whichCommand("cmd.exe", env) ?? whichCommand("cmd", env)
  if (fromPath) return fromPath

  if (platform === "win32") {
    const windowsPath = path.win32
    const systemRoot = env.SystemRoot ?? (env.SystemDrive ? windowsPath.join(env.SystemDrive, "Windows") : "C:\\Windows")
    const defaultPath = windowsPath.join(systemRoot, "System32", "cmd.exe")
    if (await isFile(defaultPath)) return defaultPath
  }

  throw new Error("No Windows Command Prompt executable was found. Set ComSpec or add cmd.exe to PATH.")
}

export async function resolveWslExecutable(options?: ResolverOptions) {
  const { env, platform, whichCommand, isFile } = getResolverParts(options)
  const fromPath = whichCommand("wsl.exe", env) ?? whichCommand("wsl", env)
  if (fromPath) return fromPath

  if (platform === "win32") {
    const windowsPath = path.win32
    const systemRoot = env.SystemRoot ?? (env.SystemDrive ? windowsPath.join(env.SystemDrive, "Windows") : "C:\\Windows")
    const defaultPath = windowsPath.join(systemRoot, "System32", "wsl.exe")
    if (await isFile(defaultPath)) return defaultPath
  }

  throw new Error("No WSL executable was found. Install WSL or add wsl.exe to PATH.")
}

function createShellCommandTool<Parameters extends z.ZodType>(
  config: ShellToolConfig<Parameters>,
): Tool.ToolInfo<Parameters, ShellCommandMetadata> {
  return Tool.define(
    config.id,
    async (): Promise<Tool.ToolRuntime<Parameters, ShellCommandMetadata>> => {
      return {
        title: config.title,
        description: config.description,
        parameters: config.parameters,
        formatValidationError: (error) => formatValidationError(config.id, error),
        validate: async (parameters, ctx) => {
          const input = shellInput(parameters)
          if (ctx.abort?.aborted) {
            return "Tool execution was cancelled before command start."
          }

          const command = input.command.trim()
          if (!command) {
            return "Command must contain non-whitespace characters."
          }

          let cwd: string
          try {
            cwd = resolveCommandCwd(input, ctx)
          } catch (error) {
            if (error instanceof Error) {
              const message = error.message.trim()
              if (message) return message
            }

            return "Failed to resolve workdir."
          }

          if (!await stat(cwd).then((cwdStat) => cwdStat.isDirectory()).catch(() => false)) {
            return `Workdir must be a directory: ${input.workdir ?? cwd}`
          }

          try {
            await config.resolveInvocation(parameters, cwd)
          } catch (error) {
            if (error instanceof Error) {
              const message = error.message.trim()
              if (message) return message
            }

            return `No executable was found for ${config.title}.`
          }
        },
        describeApproval: (parameters, ctx) => {
          const input = shellInput(parameters)
          const cwd = resolveCommandCwd(input, ctx)
          const displayCwd = toDisplayPath(cwd)

          return {
            title: input.description?.trim() || `Run ${config.title} command`,
            summary: `Run a ${config.title} command in ${displayCwd}.`,
            details: {
              command: input.command.trim(),
              workdir: displayCwd,
              paths: [displayCwd],
            },
          }
        },
        assessPermission: (parameters, ctx) => {
          const input = shellInput(parameters)
          const cwd = resolveCommandCwd(input, ctx)
          return assessShellPermission(config.shellKind, input, cwd)
        },
        authorize: (parameters) => {
          const input = shellInput(parameters)
          const command = input.command.trim()
          if (!input.allowUnsafe && isCriticalShellCommand(config.shellKind, command)) {
            return {
              message:
                "Command matched a dangerous pattern and was blocked. Set allowUnsafe=true only when this action is explicitly intended.",
            }
          }
        },
        execute: async (parameters, ctx) => {
          const input = shellInput(parameters)
          if (ctx.abort?.aborted) {
            throw new Error("Tool execution was cancelled before command start.")
          }

          const cwd = resolveCommandCwd(input, ctx)
          if (!await stat(cwd).then((cwdStat) => cwdStat.isDirectory()).catch(() => false)) {
            throw new Error(`Workdir must be a directory: ${input.workdir ?? cwd}`)
          }

          const command = input.command.trim()
          const timeoutMs = input.timeoutMs ?? CONFIGURED_DEFAULT_TIMEOUT_MS
          const yieldTimeMs = resolveYieldTimeMs(input)
          const maxOutputChars = input.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
          const displayCwd = toDisplayPath(cwd)
          const invocation = await config.resolveInvocation(parameters, cwd)
          const title = input.description?.trim() || `${config.id}: ${command}`
          const registry = getShellTaskRegistry()
          const task = registry.start({
            ownerSessionID: ctx.sessionID,
            title: input.description?.trim(),
            command,
            cwd,
            shell: invocation.shell,
            executable: invocation.executable,
            args: invocation.args,
            env: invocation.env,
            maxOutputChars,
            timeoutMs,
          })

          const formatCompleted = (result: ShellTaskResult, aborted: boolean) => {
            const suffix: string[] = []
            if (result.timedOut) suffix.push("timed out")
            if (aborted) suffix.push("aborted")

            const notes: string[] = []
            if (result.stdoutTruncated || result.stderrTruncated) {
              notes.push("Output was truncated. Increase maxOutputChars to inspect more.")
            }

            const normalizedStdout = result.stdout.trimEnd()
            const normalizedStderr = result.stderr.trimEnd()

            return {
              title,
              text: [
                `Command: ${command}`,
                `Workdir: ${displayCwd}`,
                `Shell: ${invocation.shell}`,
                `Exit: ${result.exitCode ?? "unknown"}${suffix.length ? ` (${suffix.join(", ")})` : ""}`,
                notes.length ? `Note: ${notes.join(" ")}` : undefined,
                "",
                "STDOUT:",
                normalizedStdout || "(no stdout)",
                "",
                "STDERR:",
                normalizedStderr || "(no stderr)",
              ].filter(Boolean).join("\n"),
              metadata: {
                command,
                shell: invocation.shell,
                cwd,
                displayCwd,
                timeoutMs: timeoutMs ?? null,
                yieldTimeMs,
                exitCode: result.exitCode,
                signal: result.signal,
                timedOut: result.timedOut,
                aborted,
                stdoutTruncated: result.stdoutTruncated,
                stderrTruncated: result.stderrTruncated,
                stdout: normalizedStdout,
                stderr: normalizedStderr,
                runInBackground: false,
                backgroundTaskId: null,
                backgroundTaskCursor: null,
              },
            }
          }

          let aborted = false
          let snapshot: ShellTaskResult | null
          if (!ctx.abort || yieldTimeMs <= 0) {
            snapshot = await registry.wait(task.id, yieldTimeMs, ctx.sessionID)
          } else if (ctx.abort.aborted) {
            aborted = true
            await registry.stop(task.id, ctx.sessionID)
            snapshot = registry.result(task.id, ctx.sessionID)
          } else {
            let onAbort: (() => void) | null = null
            const outcome = await Promise.race([
              registry.wait(task.id, yieldTimeMs, ctx.sessionID).then((result) => ({
                type: "task" as const,
                result,
              })),
              new Promise<{ type: "abort" }>((resolve) => {
                onAbort = () => resolve({ type: "abort" })
                ctx.abort?.addEventListener("abort", onAbort, { once: true })
              }),
            ])
            if (onAbort) ctx.abort.removeEventListener("abort", onAbort)

            if (outcome.type === "abort") {
              aborted = true
              await registry.stop(task.id, ctx.sessionID)
              snapshot = registry.result(task.id, ctx.sessionID)
            } else {
              snapshot = outcome.result
            }
          }

          if (!snapshot) {
            throw new Error(`Shell task '${task.id}' disappeared before producing a result.`)
          }

          if (aborted || snapshot.timedOut) {
            if (snapshot.status === "running") {
              await registry.stop(task.id, ctx.sessionID)
            }
            return formatCompleted(registry.take(task.id, ctx.sessionID) ?? snapshot, aborted)
          }

          if (snapshot.status !== "running") {
            return formatCompleted(registry.take(task.id, ctx.sessionID) ?? snapshot, false)
          }

          registry.acknowledge(task.id, snapshot.cursor, ctx.sessionID)

          const explicitBackground = shouldRunInBackground(input)
          const normalizedStdout = snapshot.stdout.trimEnd()
          const normalizedStderr = snapshot.stderr.trimEnd()
          const notes: string[] = []
          if (snapshot.stdoutTruncated || snapshot.stderrTruncated) {
            notes.push("Initial output was truncated. Later write_stdin calls return only newer output.")
          }

          return {
            title,
            text: [
              `Command: ${command}`,
              `Workdir: ${displayCwd}`,
              `Shell: ${invocation.shell}`,
              `Session ID: ${task.id}`,
              explicitBackground
                ? "Status: started in background"
                : `Status: still running after ${yieldTimeMs} ms; continuing in background`,
              timeoutMs !== undefined ? `Hard timeout: ${timeoutMs} ms` : undefined,
              notes.length ? `Note: ${notes.join(" ")}` : undefined,
              "",
              "STDOUT SO FAR:",
              normalizedStdout || "(no stdout)",
              "",
              "STDERR SO FAR:",
              normalizedStderr || "(no stderr)",
              "",
              `Use write_stdin with session_id=${task.id} and empty chars to read new output, or chars=\\u0003 to interrupt it.`,
            ].filter(Boolean).join("\n"),
            metadata: {
              command,
              shell: invocation.shell,
              cwd,
              displayCwd,
              timeoutMs: timeoutMs ?? null,
              yieldTimeMs,
              exitCode: null,
              signal: null,
              timedOut: false,
              aborted: false,
              stdoutTruncated: snapshot.stdoutTruncated,
              stderrTruncated: snapshot.stderrTruncated,
              stdout: normalizedStdout,
              stderr: normalizedStderr,
              runInBackground: true,
              backgroundTaskId: task.id,
              backgroundTaskCursor: snapshot.cursor,
              sessionID: task.id,
            },
          }
        },
        toModelOutput: async (result) => {
          const metadata = result.metadata
          if (!metadata) {
            return {
              type: "text",
              value: result.text,
            }
          }

          return {
            type: "json",
            value: {
              title: result.title ?? config.title,
              command: metadata.command,
              workdir: metadata.displayCwd,
              shell: metadata.shell,
              exitCode: metadata.exitCode,
              signal: metadata.signal,
              timedOut: metadata.timedOut,
              aborted: metadata.aborted,
              status:
                metadata.runInBackground
                  ? "background_started"
                  : metadata.timedOut
                    ? "timed_out"
                    : metadata.aborted
                      ? "aborted"
                      : metadata.exitCode === 0
                        ? "ok"
                        : "failed",
              backgroundTaskId: metadata.backgroundTaskId,
              ...(metadata.sessionID ? { session_id: metadata.sessionID } : {}),
              ...(typeof metadata.backgroundTaskCursor === "number"
                ? { backgroundTaskCursor: metadata.backgroundTaskCursor }
                : {}),
              ...(typeof metadata.yieldTimeMs === "number"
                ? { yieldTimeMs: metadata.yieldTimeMs }
                : {}),
              runInBackground: metadata.runInBackground,
              stdoutTruncated: metadata.stdoutTruncated,
              stderrTruncated: metadata.stderrTruncated,
              stdout: metadata.stdout,
              stderr: metadata.stderr,
            },
          }
        },
      }
    },
    {
      title: config.title,
      capabilities: {
        kind: "exec",
        readOnly: false,
        destructive: true,
        concurrency: "exclusive",
        needsShell: true,
      },
    },
  )
}

export const GitBashCommandTool = createShellCommandTool({
  id: "git_bash_command",
  title: "Git Bash",
  shellKind: "bash",
  description: "Run a Git Bash/MSYS Bash command inside the current project boundary. Use Bash syntax, but do not assume a full Linux environment.",
  parameters: GitBashCommandParameters,
  async resolveInvocation(parameters) {
    const executable = await resolveGitBashExecutable()
    const command = shellInput(parameters).command.trim()
    return {
      executable,
      args: ["-lc", command],
      shell: executable,
    }
  },
})

export const MacOSShellCommandTool = createShellCommandTool({
  id: "macos_shell_command",
  title: "macOS Shell",
  shellKind: "posix",
  description: "Run a macOS shell command inside the current project boundary. Use zsh/POSIX syntax.",
  parameters: MacOSShellCommandParameters,
  async resolveInvocation(parameters) {
    const executable = await resolveMacOSShellExecutable()
    const command = shellInput(parameters).command.trim()
    return {
      executable,
      args: ["-lc", command],
      shell: executable,
      env: buildMacOSShellEnvironment(process.env),
    }
  },
})

export const PowerShellCommandTool = createShellCommandTool({
  id: "powershell_command",
  title: "PowerShell",
  shellKind: "powershell",
  description: "Run a Windows PowerShell command inside the current project boundary. Use PowerShell cmdlet syntax, object pipelines, and $env:VAR environment variables.",
  parameters: PowerShellCommandParameters,
  async resolveInvocation(parameters) {
    const executable = await resolvePowerShellExecutable()
    const command = shellInput(parameters).command.trim()
    return {
      executable,
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      shell: executable,
    }
  },
})

export const CmdCommandTool = createShellCommandTool({
  id: "cmd_command",
  title: "Command Prompt",
  shellKind: "cmd",
  description: "Run a Windows Command Prompt command inside the current project boundary. Use CMD syntax such as dir, copy, set VAR=value, and %VAR%.",
  parameters: CmdCommandParameters,
  async resolveInvocation(parameters) {
    const executable = await resolveCmdExecutable()
    const command = shellInput(parameters).command.trim()
    return {
      executable,
      args: ["/d", "/s", "/c", command],
      shell: executable,
    }
  },
})

export const WslBashCommandTool = createShellCommandTool({
  id: "wsl_bash_command",
  title: "WSL Bash",
  shellKind: "wsl",
  description: "Run a WSL Linux Bash command inside the current project boundary. Uses the default WSL distribution unless distro is provided.",
  parameters: WslBashCommandParameters,
  async resolveInvocation(parameters, cwd) {
    const input = shellInput(parameters)
    const executable = await resolveWslExecutable()
    const command = input.command.trim()
    const cdCommand = `cd "$(wslpath ${quoteBashSingle(cwd)})" && ${command}`
    const distro = input.distro?.trim()
    return {
      executable,
      args: [
        ...(distro ? ["-d", distro] : []),
        "--",
        "bash",
        "-lc",
        cdCommand,
      ],
      shell: distro ? `${executable} -d ${distro}` : executable,
    }
  },
})
