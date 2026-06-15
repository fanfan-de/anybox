import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const packageRoot = path.resolve(import.meta.dirname, "..")
const appRoot = path.join(packageRoot, "src", "renderer", "src", "app")
const translationsPath = path.join(appRoot, "i18n", "translations.ts")
const baselinePath = path.join(packageRoot, "scripts", "i18n-audit-baseline.json")
const updateBaseline = process.argv.includes("--update-baseline")

const localizableAttributes = ["aria-label", "title", "placeholder", "alt"]
const ignoredPathParts = [
  `${path.sep}i18n${path.sep}translations.ts`,
  `${path.sep}test-setup.ts`,
]

const glossaryTerms = new Set([
  "Agent",
  "Anybox",
  "API",
  "API key",
  "ChatGPT",
  "Codex",
  "Git",
  "HTTP",
  "HTTPS",
  "JSON",
  "LLM",
  "MCP",
  "OpenAI",
  "Pull Request",
  "Shell",
  "SSH",
  "STDIO",
  "Terminal",
  "URL",
])

const allowedLegacyLiterals = new Set([
  "CONNECTION",
  "CONNECTOR",
  "Default",
  "Global",
  "Header",
  "KEY",
  "Local stdio",
  "Plugin",
  "Remote HTTP",
  "STDIO",
  "VALUE",
  "Value",
])

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, files)
      continue
    }
    if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

function readTranslationSources() {
  const source = fs.readFileSync(translationsPath, "utf8")
  const values = new Set()
  const valuePattern = /"[^"]+"\s*:\s*("(?:\\.|[^"\\])*")/g
  for (const match of source.matchAll(valuePattern)) {
    try {
      const value = JSON.parse(match[1])
      if (typeof value === "string") {
        values.add(normalizeCandidate(value))
      }
    } catch {
      // Ignore malformed partial matches; TypeScript will catch real syntax issues.
    }
  }
  return values
}

function lineNumberForOffset(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length
}

function normalizeCandidate(value) {
  return value.replace(/\s+/g, " ").trim()
}

function stripJsxExpressions(value) {
  return value.replace(/\{[^{}]*\}/g, " ").replace(/\$\{[^{}]*\}/g, " ")
}

function isLikelyEnglishUi(value) {
  if (!/[A-Za-z]/.test(value)) return false
  if (/[\u3400-\u9fff]/.test(value)) return false
  if (/^[a-z0-9_.:/@~#%{}[\],'"`\\ -]+$/.test(value)) return false
  return /[A-Za-z]{3,}/.test(value)
}

function isLikelyCodeFragment(value) {
  if (/^\)?\s*:\s*/.test(value)) return true
  if (/^\)\s*:\s*[^<]+$/.test(value)) return true
  if (/[;=]|=>|\?\s*\(|\|\s*Promise\b/.test(value)) return true
  if (/\b(?:const|let|var|function|return|if|else|typeof|interface|type|extends|satisfies)\b/.test(value)) {
    return true
  }
  if (/\b(?:Array|ReadonlyArray|CSSProperties|DragEvent|FocusEvent|FormEvent|HTMLElement|KeyboardEvent|MouseEvent|MutableRefObject|Promise|ReactNode|Record|RefObject|SetStateAction)\b/.test(value)) {
    return true
  }
  if (/\b[a-z]+[A-Z][A-Za-z0-9]*\b/.test(value) && /[:()[\]|]/.test(value)) return true
  return false
}

function isAllowedTechnicalLiteral(value) {
  if (allowedLegacyLiterals.has(value)) return true
  if (glossaryTerms.has(value)) return true
  if (/^[A-Z][A-Z0-9_ -]{1,}$/.test(value)) return true
  if (/^(?:[A-Z][a-zA-Z0-9+.-]*)(?:\s*\/\s*[A-Z][a-zA-Z0-9+.-]*)+$/.test(value)) return true
  if (/^(?:[A-Z][a-zA-Z0-9+.-]*\s+){0,3}(?:MCP|API key|JSON|URL|HTTP|Git|Shell|Terminal|Agent|Anybox|Codex|OpenAI|ChatGPT|Pull Request)s?$/.test(value)) return true
  return false
}

function isAllowedCandidate(value, translationSources) {
  const normalized = normalizeCandidate(value)
  if (!isLikelyEnglishUi(normalized)) return true
  if (isLikelyCodeFragment(normalized)) return true
  if (translationSources.has(normalized)) return true
  if (translationSources.has(normalized.replace(/\.$/, ""))) return true
  if (isAllowedTechnicalLiteral(normalized)) return true
  return false
}

function findingKey(finding) {
  return `${finding.file}\t${finding.kind}\t${finding.value}`
}

function toBaseline(findings) {
  const entries = {}
  for (const finding of findings) {
    const key = findingKey(finding)
    entries[key] = (entries[key] ?? 0) + 1
  }
  return entries
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return {}
  return JSON.parse(fs.readFileSync(baselinePath, "utf8"))
}

function writeBaseline(findings) {
  const baseline = toBaseline(findings)
  const sortedBaseline = Object.fromEntries(
    Object.entries(baseline).sort(([left], [right]) => left.localeCompare(right)),
  )
  const payload = {
    version: 1,
    description: "Existing desktop renderer English UI literals allowed temporarily by the i18n audit. Reduce this file as strings move to t().",
    entries: sortedBaseline,
  }
  fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

function filterNewFindings(findings, baselinePayload) {
  const baseline = baselinePayload.entries ?? {}
  const remainingCounts = { ...baseline }
  const newFindings = []

  for (const finding of findings) {
    const key = findingKey(finding)
    if ((remainingCounts[key] ?? 0) > 0) {
      remainingCounts[key] -= 1
      continue
    }
    newFindings.push(finding)
  }

  return newFindings
}

function collectCandidates(file, source) {
  const candidates = []
  if (!file.endsWith(".tsx")) return candidates

  const patterns = [
    {
      kind: "jsx-text",
      regex: />\s*([^<>{}\n][^<>{}\n]*[A-Za-z][^<>{}\n]*)\s*</g,
      valueIndex: 1,
    },
    {
      kind: "attribute",
      regex: new RegExp(`\\b(?:${localizableAttributes.join("|")})=("|')([^"'{}]*[A-Za-z][^"'{}]*)\\1`, "g"),
      valueIndex: 2,
    },
    {
      kind: "message",
      regex: /\b(?:confirm|alert|setError|new Error)\(\s*(["'`])([^"'`\n]*[A-Za-z][^"'`\n]*)\1/g,
      valueIndex: 2,
    },
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern.regex)) {
      const rawValue = stripJsxExpressions(match[pattern.valueIndex] ?? "")
      const value = normalizeCandidate(rawValue)
      if (!value) continue
      candidates.push({
        file,
        kind: pattern.kind,
        line: lineNumberForOffset(source, match.index ?? 0),
        value,
      })
    }
  }
  return candidates
}

const translationSources = readTranslationSources()
const files = walk(appRoot).filter((file) => !ignoredPathParts.some((part) => file.includes(part)))
const findings = []

for (const file of files) {
  const source = fs.readFileSync(file, "utf8")
  for (const candidate of collectCandidates(file, source)) {
    if (!isAllowedCandidate(candidate.value, translationSources)) {
      findings.push({
        ...candidate,
        file: path.relative(packageRoot, candidate.file),
      })
    }
  }
}

if (updateBaseline) {
  writeBaseline(findings)
  console.log(`i18n audit baseline updated (${findings.length} current findings).`)
  process.exit(0)
}

const baseline = readBaseline()
const newFindings = filterNewFindings(findings, baseline)

if (newFindings.length > 0) {
  console.error("i18n audit found English UI literals without a translation key or glossary allowance:")
  for (const finding of newFindings.slice(0, 80)) {
    console.error(`${finding.file}:${finding.line} [${finding.kind}] ${finding.value}`)
  }
  if (newFindings.length > 80) {
    console.error(`...and ${newFindings.length - 80} more.`)
  }
  process.exitCode = 1
} else {
  const baselineCount = Object.values(baseline.entries ?? {}).reduce((total, count) => total + count, 0)
  console.log(`i18n audit passed (${files.length} files scanned, ${baselineCount} baseline findings allowed).`)
}
