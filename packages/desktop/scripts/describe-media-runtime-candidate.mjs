import { createHash } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || !value) throw new Error("Arguments must use --key value pairs")
    values.set(key.slice(2), value)
  }
  for (const key of ["platform", "arch", "stage", "archive", "source", "recipe", "output", "revision"]) {
    if (!values.get(key)) throw new Error(`Missing --${key}`)
  }
  return Object.fromEntries(values)
}

async function sha256(filePath) {
  const hash = createHash("sha256")
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

const args = parseArguments(process.argv.slice(2))
const executableNames = args.platform === "win32"
  ? { ffmpeg: "ffmpeg.exe", ffprobe: "ffprobe.exe" }
  : { ffmpeg: "ffmpeg", ffprobe: "ffprobe" }
const artifactPaths = {
  archive: path.resolve(args.archive),
  ffmpeg: path.resolve(args.stage, executableNames.ffmpeg),
  ffprobe: path.resolve(args.stage, executableNames.ffprobe),
  license: path.resolve(args.stage, "LICENSE.txt"),
  notices: path.resolve(args.stage, "THIRD-PARTY-NOTICES.txt"),
  configure: path.resolve(args.stage, "configure.txt"),
  source: path.resolve(args.source),
  buildRecipe: path.resolve(args.recipe),
}
for (const [label, filePath] of Object.entries(artifactPaths)) {
  const stat = await fsp.stat(filePath).catch(() => undefined)
  if (!stat?.isFile()) throw new Error(`Candidate is missing ${label}: ${filePath}`)
}

const archiveStat = await fsp.stat(artifactPaths.archive)
const sourceStat = await fsp.stat(artifactPaths.source)
const recipeStat = await fsp.stat(artifactPaths.buildRecipe)
const candidate = {
  schemaVersion: 1,
  classification: "unapproved-candidate",
  platform: args.platform,
  arch: args.arch,
  ffmpegRevision: args.revision,
  archive: {
    fileName: path.basename(artifactPaths.archive),
    sizeBytes: archiveStat.size,
    sha256: await sha256(artifactPaths.archive),
  },
  executables: executableNames,
  binaries: {
    [executableNames.ffmpeg]: { sha256: await sha256(artifactPaths.ffmpeg) },
    [executableNames.ffprobe]: { sha256: await sha256(artifactPaths.ffprobe) },
  },
  materials: {
    license: { fileName: "LICENSE.txt", sha256: await sha256(artifactPaths.license) },
    notices: { fileName: "THIRD-PARTY-NOTICES.txt", sha256: await sha256(artifactPaths.notices) },
    configure: { fileName: "configure.txt", sha256: await sha256(artifactPaths.configure) },
    source: {
      fileName: path.basename(artifactPaths.source),
      sizeBytes: sourceStat.size,
      sha256: await sha256(artifactPaths.source),
    },
    buildRecipe: {
      fileName: path.basename(artifactPaths.buildRecipe),
      sizeBytes: recipeStat.size,
      sha256: await sha256(artifactPaths.buildRecipe),
    },
  },
}
await fsp.mkdir(path.dirname(path.resolve(args.output)), { recursive: true })
await fsp.writeFile(path.resolve(args.output), `${JSON.stringify(candidate, null, 2)}\n`)
console.log(`[desktop][media] wrote unapproved candidate metadata to ${path.resolve(args.output)}`)
