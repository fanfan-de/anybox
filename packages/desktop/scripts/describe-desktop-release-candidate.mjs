import { createHash } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || !value) throw new Error("Arguments must use --key value pairs")
    values.set(key.slice(2), value)
  }
  for (const key of ["platform", "arch", "directory", "primary", "output", "commit"]) {
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
const directory = path.resolve(args.directory)
const output = path.resolve(args.output)
const primaryInstaller = path.basename(args.primary)
const packageJson = JSON.parse(await fsp.readFile(path.resolve(scriptDir, "..", "package.json"), "utf8"))
const entries = await fsp.readdir(directory, { withFileTypes: true })
const files = []
for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
  const filePath = path.join(directory, entry.name)
  if (path.resolve(filePath) === output) continue
  if (!entry.isFile()) throw new Error(`Release candidate directory contains a non-file entry: ${entry.name}`)
  const stat = await fsp.lstat(filePath)
  if (stat.isSymbolicLink()) throw new Error(`Release candidate cannot contain a symlink: ${entry.name}`)
  files.push({ fileName: entry.name, sizeBytes: stat.size, sha256: await sha256(filePath) })
}
if (!files.some((entry) => entry.fileName === primaryInstaller)) {
  throw new Error(`Primary installer ${primaryInstaller} is missing from ${directory}`)
}
const manifest = {
  schemaVersion: 1,
  classification: "signed-release-candidate",
  platform: args.platform,
  arch: args.arch,
  desktopVersion: packageJson.version,
  commitSHA: args.commit,
  primaryInstaller,
  files,
}
await fsp.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`[desktop][release] described ${args.platform}/${args.arch} candidate with ${files.length} file(s)`)
