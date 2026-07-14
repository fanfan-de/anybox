import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function parseSimpleYamlScalar(value) {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function normalizeLinuxUpdateMetadata(metadataPath) {
  const source = fs.readFileSync(metadataPath, "utf8")
  const newline = source.includes("\r\n") ? "\r\n" : "\n"
  const hadFinalNewline = source.endsWith("\n")
  const lines = source.split(/\r?\n/)
  if (hadFinalNewline) lines.pop()

  const filesIndex = lines.findIndex((line) => line === "files:")
  invariant(filesIndex >= 0, `${path.basename(metadataPath)} is missing its files list`)

  let sectionEnd = filesIndex + 1
  while (sectionEnd < lines.length && (lines[sectionEnd].startsWith(" ") || lines[sectionEnd].length === 0)) {
    sectionEnd += 1
  }

  const entryBlocks = []
  let cursor = filesIndex + 1
  while (cursor < sectionEnd) {
    if (lines[cursor].length === 0) {
      cursor += 1
      continue
    }
    const urlMatch = lines[cursor].match(/^  - url:\s*(.+)$/)
    invariant(urlMatch, `${path.basename(metadataPath)} has an unsupported files entry at line ${cursor + 1}`)
    let entryEnd = cursor + 1
    while (entryEnd < sectionEnd && !lines[entryEnd].startsWith("  - url:")) entryEnd += 1
    const url = parseSimpleYamlScalar(urlMatch[1])
    invariant(url.length > 0, `${path.basename(metadataPath)} contains an empty update URL`)
    entryBlocks.push({
      lines: lines.slice(cursor, entryEnd),
      url,
    })
    cursor = entryEnd
  }
  invariant(entryBlocks.length > 0, `${path.basename(metadataPath)} has an empty files list`)

  const uniqueEntries = []
  const firstEntryByUrl = new Map()
  for (const entry of entryBlocks) {
    const previous = firstEntryByUrl.get(entry.url)
    if (!previous) {
      firstEntryByUrl.set(entry.url, entry)
      uniqueEntries.push(entry)
      continue
    }
    invariant(
      previous.lines.join("\n") === entry.lines.join("\n"),
      `${path.basename(metadataPath)} repeats ${entry.url} with conflicting update metadata`,
    )
  }

  const appImageEntries = uniqueEntries.filter((entry) => entry.url.endsWith(".AppImage"))
  invariant(appImageEntries.length === 1, `${path.basename(metadataPath)} must contain exactly one AppImage entry`)
  invariant(
    /^\s{4}blockMapSize:\s*[1-9]\d*\s*$/m.test(appImageEntries[0].lines.join("\n")),
    `${path.basename(metadataPath)} must declare a positive embedded AppImage blockMapSize`,
  )

  const normalizedLines = [
    ...lines.slice(0, filesIndex + 1),
    ...uniqueEntries.flatMap((entry) => entry.lines),
    ...lines.slice(sectionEnd),
  ]
  const normalized = `${normalizedLines.join(newline)}${hadFinalNewline ? newline : ""}`
  const changed = normalized !== source
  if (changed) fs.writeFileSync(metadataPath, normalized)
  return { changed, urls: uniqueEntries.map((entry) => entry.url) }
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--directory" || !argv[1]) {
    throw new Error("Usage: normalize-linux-update-metadata.mjs --directory <electron-builder-output>")
  }
  return path.resolve(argv[1])
}

function main() {
  const directory = parseArguments(process.argv.slice(2))
  const metadataPath = path.join(directory, "latest-linux.yml")
  if (!fs.existsSync(metadataPath)) {
    console.log(`[desktop][linux-update] no latest-linux.yml in ${directory}; normalization skipped`)
    return
  }
  const result = normalizeLinuxUpdateMetadata(metadataPath)
  console.log(
    `[desktop][linux-update] ${result.changed ? "normalized" : "verified"} latest-linux.yml with ${result.urls.length} unique file entries`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(`[desktop][linux-update] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
