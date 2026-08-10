import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { zipSync } from "fflate"

const pluginRoot = path.dirname(fileURLToPath(import.meta.url))
const release = process.argv.includes("--release")
const allowUnsignedValidation = process.argv.includes("--allow-unsigned-validation")
const skipBuild = process.argv.includes("--skip-build")
const manifestPath = path.join(pluginRoot, ".anybox-plugin", "plugin.json")
const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".txt"])
const forbiddenText = [
  "packages/anyboxagent",
  "packages\\anyboxagent",
  "@anybox/shared/cinema",
  "packages/cinema-web",
  "ANYBOX_AGENT_",
  "ANYBOX_CINEMA_",
  "ANYBOX_FFMPEG_",
  "ANYBOX_FFPROBE_",
]

function run(command, args) {
  const result = spawnSync(command, args, { cwd: pluginRoot, stdio: "inherit", windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`)
}

function resolveBunExecutable() {
  if (typeof Bun !== "undefined") return process.execPath
  const command = process.platform === "win32" ? "bun.cmd" : "bun"
  const probe = spawnSync(command, ["--print", "process.execPath"], {
    cwd: pluginRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  })
  const executable = probe.stdout?.trim()
  if (probe.status !== 0 || !executable || !fs.existsSync(executable)) {
    throw probe.error ?? new Error("Unable to resolve the Bun executable required to build Cinema.")
  }
  return executable
}

async function sha256(filePath) {
  const hash = createHash("sha256")
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

async function regularFiles(root, prefix) {
  const result = []
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name)
    const relative = `${prefix}/${entry.name}`.replace(/^\/+/, "").replaceAll("\\", "/")
    if (entry.isSymbolicLink()) throw new Error(`Cinema package cannot contain symbolic links: ${relative}`)
    if (entry.isDirectory()) result.push(...await regularFiles(absolute, relative))
    else if (entry.isFile()) result.push({ absolute, relative })
    else throw new Error(`Cinema package contains an unsupported filesystem entry: ${relative}`)
  }
  return result
}

if (!skipBuild) run(resolveBunExecutable(), ["run", "build.mjs"])
const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
if (manifest.name !== "cinema" || manifest.version !== "1.0.0") throw new Error("Cinema package manifest must identify cinema 1.0.0.")

const helper = manifest.platformArtifacts?.find((item) => item.id === "cinema-platform-helper" && item.type === "app-runtime-helper")
if (!helper) throw new Error("Cinema package is missing the native app-runtime-helper declaration.")
const declaredTargets = new Set(helper.executables.map((item) => `${item.platform}-${item.architecture}`))
if (release && JSON.stringify([...declaredTargets].sort()) !== JSON.stringify(["darwin-arm64", "linux-x64", "win32-x64"])) {
  throw new Error("Cinema release packages require exactly Windows x64, macOS arm64, and Linux x64 helpers.")
}

const files = [
  { absolute: manifestPath, relative: ".anybox-plugin/plugin.json" },
  ...await regularFiles(path.join(pluginRoot, "web"), "web"),
  ...await regularFiles(path.join(pluginRoot, "runtime"), "runtime"),
  ...await regularFiles(path.join(pluginRoot, "mcp"), "mcp"),
  ...await regularFiles(path.join(pluginRoot, "skills"), "skills"),
]
for (const executable of helper.executables) {
  const absolute = path.resolve(pluginRoot, ...executable.path.split("/"))
  const safeRoot = `${path.resolve(pluginRoot)}${path.sep}`
  if (!absolute.startsWith(safeRoot)) throw new Error(`Helper path escapes the plugin package: ${executable.path}`)
  const info = await fsp.lstat(absolute).catch(() => undefined)
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Declared helper is missing or invalid: ${executable.path}`)
  const digest = await sha256(absolute)
  if (digest !== executable.sha256) throw new Error(`Declared helper SHA-256 does not match: ${executable.path}`)
  if (release) {
    const target = `${executable.platform}-${executable.architecture}`
    const provenancePath = path.join(path.dirname(absolute), "signature-verification.json")
    const provenance = await fsp.readFile(provenancePath, "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => undefined)
    const allowedStatus = allowUnsignedValidation ? ["verified", "unsigned-validation"] : ["verified"]
    if (
      provenance?.schemaVersion !== 1
      || provenance?.target !== target
      || provenance?.sha256 !== digest
      || !allowedStatus.includes(provenance?.status)
    ) throw new Error(`Cinema release helper is not signature-verified: ${target}`)
  }
  files.push({ absolute, relative: executable.path })
}

files.sort((left, right) => left.relative.localeCompare(right.relative))
if (new Set(files.map((item) => item.relative)).size !== files.length) throw new Error("Cinema package contains duplicate paths.")
if (files.some((item) => /(^|\/)(?:ffmpeg|ffprobe)(?:\.exe)?$/i.test(item.relative))) {
  throw new Error("FFmpeg and ffprobe must not be included in the Cinema plugin ZIP.")
}

const archiveEntries = {}
for (const file of files) {
  const bytes = new Uint8Array(await fsp.readFile(file.absolute))
  if (textExtensions.has(path.extname(file.relative).toLowerCase())) {
    const text = new TextDecoder().decode(bytes)
    for (const marker of forbiddenText) {
      if (text.includes(marker)) throw new Error(`Cinema package contains forbidden dependency marker '${marker}' in ${file.relative}.`)
    }
    if (/(?:[A-Za-z]:[\\/](?:Projects|Users)[\\/]|\/(?:home|Users)\/[^/]+\/)/.test(text)) {
      throw new Error(`Cinema package contains a build-machine absolute path in ${file.relative}.`)
    }
  }
  archiveEntries[`${manifest.name}/${file.relative}`] = bytes
}

const outputDirectory = path.join(pluginRoot, "dist")
const outputPath = path.join(outputDirectory, `cinema-${manifest.version}.anybox-plugin.zip`)
await fsp.mkdir(outputDirectory, { recursive: true })
const archive = zipSync(archiveEntries, { level: 9 })
await fsp.writeFile(outputPath, archive)
console.log(JSON.stringify({ outputPath, sizeBytes: archive.byteLength, files: files.length, release, allowUnsignedValidation }))
