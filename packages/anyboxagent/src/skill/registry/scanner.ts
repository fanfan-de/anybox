import { createHash } from "node:crypto"
import { lstat, readFile, readdir } from "node:fs/promises"
import { extname, isAbsolute, join, relative, resolve } from "node:path"
import type {
  RegistryLocalScanFinding,
  RegistryLocalScanReport,
  RegistryLocalScanRisk,
} from "@anybox/shared/skill-registry"

export type { RegistryLocalScanReport } from "@anybox/shared/skill-registry"

export const REGISTRY_SCANNER_VERSION = "2"

export interface RegistryTreeDigest {
  treeHash: string
  files: Array<{
    path: string
    size: number
    sha256: string
  }>
  totalBytes: number
}

export interface TencentSkillHubContentDigest {
  contentHash: string
  fileCount: number
}

export interface RegistryTreeLimits {
  maxFiles: number
  maxDepth: number
  maxFileBytes: number
  maxTotalBytes: number
}

export const DEFAULT_REGISTRY_TREE_LIMITS: RegistryTreeLimits = {
  maxFiles: 2_000,
  maxDepth: 20,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
}

const KNOWN_BINARY_EXTENSIONS = new Set([
  ".a",
  ".app",
  ".bin",
  ".class",
  ".com",
  ".dll",
  ".dmg",
  ".dylib",
  ".elf",
  ".exe",
  ".jar",
  ".msi",
  ".node",
  ".o",
  ".scr",
  ".so",
])

const NESTED_ARCHIVE_EXTENSIONS = new Set([
  ".7z",
  ".bz2",
  ".gz",
  ".rar",
  ".tar",
  ".tgz",
  ".xz",
  ".zip",
])

type TextRule = {
  code: string
  risk: Exclude<RegistryLocalScanRisk, "none" | "critical">
  message: string
  pattern: RegExp
}

const TEXT_RULES: TextRule[] = [
  {
    code: "REMOTE_PIPE_TO_SHELL",
    risk: "high",
    message: "Downloads remote content and pipes it directly to a command shell.",
    pattern: /(?:curl|wget)\b[^\n|]{0,500}\|\s*(?:ba|z|fi)?sh\b/i,
  },
  {
    code: "POWERSHELL_DOWNLOAD_EXECUTE",
    risk: "high",
    message: "Downloads and executes remote PowerShell content.",
    pattern: /\b(?:irm|invoke-restmethod|iwr|invoke-webrequest)\b[^\n|;]{0,500}(?:\||;)\s*(?:iex|invoke-expression)\b/i,
  },
  {
    code: "ENCODED_COMMAND",
    risk: "high",
    message: "Uses an encoded PowerShell command.",
    pattern: /\bpowershell(?:\.exe)?\b[^\n]{0,300}\s-(?:e|enc|encodedcommand)\s+[a-z0-9+/=]{16,}/i,
  },
  {
    code: "DECODE_AND_EXECUTE",
    risk: "high",
    message: "Decodes content and passes it to an interpreter or evaluator.",
    pattern: /(?:base64\s+(?:-d|--decode)|frombase64string|certutil\s+-decode)[^\n]{0,500}(?:\||;|&&)\s*(?:ba|z|fi)?sh\b|eval\b/i,
  },
  {
    code: "CREDENTIAL_ACCESS",
    risk: "high",
    message: "References common credential, SSH, browser, cloud, or wallet secret locations.",
    pattern: /(?:~|\$HOME|%USERPROFILE%)?[\\/](?:\.ssh|\.aws|\.azure|\.config[\\/]gcloud|Library[\\/]Application Support[\\/](?:Google[\\/]Chrome|BraveSoftware)|AppData[\\/]Local[\\/](?:Google[\\/]Chrome|Microsoft[\\/]Edge)|wallets?)(?:[\\/]|\b)|\b(?:id_rsa|id_ed25519|credentials\.json|Login Data|Local State)\b/i,
  },
  {
    code: "PERSISTENCE_CHANGE",
    risk: "high",
    message: "Modifies a startup, scheduled-task, service, or registry persistence mechanism.",
    pattern: /\b(?:schtasks\s+\/create|crontab\s+-|systemctl\s+enable|launchctl\s+load|reg\s+add\s+HK(?:CU|LM)\\.*\\Run\b|New-Service\b|sc(?:\.exe)?\s+create)\b/i,
  },
  {
    code: "PROCESS_EXECUTION",
    risk: "medium",
    message: "Uses a general-purpose child-process or shell execution API.",
    pattern: /\b(?:child_process|execSync|spawnSync|subprocess\.(?:run|Popen|call)|os\.system)\b/i,
  },
  {
    code: "EXTERNAL_EXFILTRATION_ENDPOINT",
    risk: "medium",
    message: "References a webhook, Telegram bot API, or other common exfiltration endpoint.",
    pattern: /https:\/\/(?:discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com\/services|api\.telegram\.org\/bot|webhook\.site\/)/i,
  },
  {
    code: "DESTRUCTIVE_COMMAND",
    risk: "medium",
    message: "Contains a broadly destructive filesystem command.",
    pattern: /\brm\s+-rf\s+(?:\/|~|\$HOME)\b|\bRemove-Item\b[^\n]{0,200}\b-Recurse\b[^\n]{0,200}\b-Force\b/i,
  },
  {
    code: "PROMPT_INJECTION_LANGUAGE",
    risk: "medium",
    message: "Contains language commonly used to override higher-priority instructions.",
    pattern: /\b(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|rules?|prompts?)\b/i,
  },
]

function ensureInside(root: string, candidate: string) {
  const relativePath = relative(root, candidate)
  if (relativePath && (relativePath.startsWith("..") || isAbsolute(relativePath))) {
    throw new Error("Registry skill tree contains a path outside its package root.")
  }
}

function normalizedRelativePath(root: string, filePath: string) {
  return relative(root, filePath).replace(/\\/g, "/")
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function appearsBinary(bytes: Buffer) {
  const sampleLength = Math.min(bytes.length, 8_192)
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] === 0) return true
  }
  return false
}

function findingLine(content: string, matchIndex: number) {
  let line = 1
  for (let index = 0; index < matchIndex; index += 1) {
    if (content.charCodeAt(index) === 10) line += 1
  }
  return line
}

async function collectTree(
  packageRoot: string,
  limits: RegistryTreeLimits,
): Promise<Array<{ path: string; relativePath: string; bytes: Buffer }>> {
  const root = resolve(packageRoot)
  const files: Array<{ path: string; relativePath: string; bytes: Buffer }> = []
  let totalBytes = 0

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > limits.maxDepth) {
      throw new Error(`Registry skill tree exceeds the maximum depth of ${limits.maxDepth}.`)
    }

    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = resolve(directory, entry.name)
      ensureInside(root, entryPath)
      const info = await lstat(entryPath)

      if (info.isSymbolicLink()) {
        throw new Error("Registry skills must not contain symbolic links.")
      }
      if (info.isDirectory()) {
        await visit(entryPath, depth + 1)
        continue
      }
      if (!info.isFile()) {
        throw new Error("Registry skills must contain only regular files and directories.")
      }
      if (info.size > limits.maxFileBytes) {
        throw new Error(`Registry skill file '${normalizedRelativePath(root, entryPath)}' exceeds the per-file size limit.`)
      }

      totalBytes += info.size
      if (totalBytes > limits.maxTotalBytes) {
        throw new Error("Registry skill tree exceeds the total unpacked size limit.")
      }
      if (files.length >= limits.maxFiles) {
        throw new Error(`Registry skill tree exceeds the maximum file count of ${limits.maxFiles}.`)
      }

      files.push({
        path: entryPath,
        relativePath: normalizedRelativePath(root, entryPath),
        bytes: await readFile(entryPath),
      })
    }
  }

  await visit(root, 0)
  return files.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath))
}

export async function digestRegistrySkillTree(
  packageRoot: string,
  limits: RegistryTreeLimits = DEFAULT_REGISTRY_TREE_LIMITS,
): Promise<RegistryTreeDigest> {
  const files = await collectTree(packageRoot, limits)
  const digest = createHash("sha256")
  let totalBytes = 0

  const result = files.map((file) => {
    const fileHash = sha256(file.bytes)
    totalBytes += file.bytes.length
    digest.update(file.relativePath)
    digest.update("\0")
    digest.update(String(file.bytes.length))
    digest.update("\0")
    digest.update(fileHash)
    digest.update("\0")
    return {
      path: file.relativePath,
      size: file.bytes.length,
      sha256: fileHash,
    }
  })

  return {
    treeHash: digest.digest("hex"),
    files: result,
    totalBytes,
  }
}

/**
 * Matches Tencent SkillHub's signed package content_hash v1. The platform
 * signs normalized file content rather than the ZIP bytes, so archive
 * repacking does not invalidate the signature.
 */
export async function computeTencentSkillHubContentHash(
  packageRoot: string,
  limits: RegistryTreeLimits = DEFAULT_REGISTRY_TREE_LIMITS,
): Promise<TencentSkillHubContentDigest> {
  const files = (await collectTree(packageRoot, limits))
    .filter((file) => {
      const segments = file.relativePath.split("/")
      if (file.relativePath === "_meta.json" || segments[0] === "__MACOSX") return false
      return !segments.some((segment) =>
        segment === ".DS_Store" || segment === "Thumbs.db" || segment.startsWith("._"),
      )
    })
    .toSorted((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0)
  const manifest = files
    .map((file) => `${file.relativePath}:${sha256(file.bytes)}\n`)
    .join("")
  return {
    contentHash: sha256(Buffer.from(manifest, "utf8")),
    fileCount: files.length,
  }
}

/**
 * Matches ClawHub's public-GitHub handoff fingerprint: one line per file,
 * `<relative path>\0<byte length>\0<file sha256>`, joined with newlines.
 */
export async function computeClawHubGitHubContentHash(
  packageRoot: string,
  limits: RegistryTreeLimits = DEFAULT_REGISTRY_TREE_LIMITS,
) {
  const files = await collectTree(packageRoot, limits)
  const lines = files.map((file) => `${file.relativePath}\0${file.bytes.length}\0${sha256(file.bytes)}`)
  return sha256(Buffer.from(lines.join("\n"), "utf8"))
}

export async function scanRegistrySkillTree(
  packageRoot: string,
  limits: RegistryTreeLimits = DEFAULT_REGISTRY_TREE_LIMITS,
): Promise<RegistryLocalScanReport> {
  const files = await collectTree(packageRoot, limits)
  const findings: RegistryLocalScanFinding[] = []

  for (const file of files) {
    const extension = extname(file.relativePath).toLowerCase()

    if (KNOWN_BINARY_EXTENSIONS.has(extension)) {
      findings.push({
        code: "EXECUTABLE_BINARY",
        risk: "high",
        file: file.relativePath,
        message: "Contains an executable or loadable binary.",
      })
      continue
    }
    if (NESTED_ARCHIVE_EXTENSIONS.has(extension)) {
      findings.push({
        code: "NESTED_ARCHIVE",
        risk: "high",
        file: file.relativePath,
        message: "Contains a nested archive that cannot be inspected safely.",
      })
      continue
    }
    if (appearsBinary(file.bytes)) {
      // Images, fonts, audio, and video are resources rather than executable payloads.
      if (!/\.(?:avif|gif|ico|jpe?g|mp3|mp4|ogg|otf|pdf|png|svgz|ttf|wav|webm|webp|woff2?)$/i.test(extension)) {
        findings.push({
          code: "UNRECOGNIZED_BINARY",
          risk: "high",
          file: file.relativePath,
          message: "Contains an unrecognized binary resource.",
        })
      }
      continue
    }

    // Avoid allocating very large strings just to run heuristic checks, but do
    // not report an uninspected text payload as safe.
    if (file.bytes.length > 2 * 1024 * 1024) {
      findings.push({
        code: "TEXT_SCAN_INCOMPLETE",
        risk: "high",
        file: file.relativePath,
        message: "Text content exceeds the complete static-scan limit and requires manual review.",
      })
      continue
    }
    const content = file.bytes.toString("utf8")
    if (file.relativePath.toLowerCase().endsWith("package.json")) {
      try {
        const packageJSON = JSON.parse(content) as { scripts?: unknown }
        if (packageJSON.scripts && typeof packageJSON.scripts === "object" && !Array.isArray(packageJSON.scripts)) {
          const installHooks = ["preinstall", "install", "postinstall", "prepare"]
            .filter((name) => {
              const value = (packageJSON.scripts as Record<string, unknown>)[name]
              return typeof value === "string" && value.trim().length > 0
            })
          if (installHooks.length > 0) {
            findings.push({
              code: "PACKAGE_INSTALL_HOOK",
              risk: "high",
              file: file.relativePath,
              message: `Declares package install hooks (${installHooks.join(", ")}); Anybox will not execute them.`,
            })
          }
        }
      } catch {
        // Invalid package.json is inert for scanning purposes and remains a
        // regular text resource; no package manager is ever invoked.
      }
    }
    for (const rule of TEXT_RULES) {
      const match = rule.pattern.exec(content)
      rule.pattern.lastIndex = 0
      if (!match || match.index === undefined) continue
      findings.push({
        code: rule.code,
        risk: rule.risk,
        file: file.relativePath,
        line: findingLine(content, match.index),
        message: rule.message,
      })
    }
  }

  const risk: RegistryLocalScanRisk = findings.some((finding) => finding.risk === "high" || finding.risk === "critical")
    ? "high"
    : findings.some((finding) => finding.risk === "medium")
      ? "medium"
      : findings.some((finding) => finding.risk === "low") ? "low" : "none"

  const counts = {
    low: findings.filter((finding) => finding.risk === "low").length,
    medium: findings.filter((finding) => finding.risk === "medium").length,
    high: findings.filter((finding) => finding.risk === "high").length,
    critical: findings.filter((finding) => finding.risk === "critical").length,
  }

  return {
    scannerVersion: REGISTRY_SCANNER_VERSION,
    risk,
    blocked: risk === "high",
    findings,
    counts,
    scannedAt: Date.now(),
  }
}
