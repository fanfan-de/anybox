import { createHash } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const COMMIT_PATTERN = /^[a-f0-9]{7,64}$/i

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || !value) throw new Error("Arguments must use --key value pairs")
    values.set(key.slice(2), value)
  }
  for (const key of ["manifest", "directory", "evidence"]) {
    if (!values.get(key)) throw new Error(`Missing --${key}`)
  }
  return Object.fromEntries(values)
}

async function sha256(filePath) {
  const hash = createHash("sha256")
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

export async function verifyDesktopReleaseCandidate({ manifestPath, directory, evidencePath }) {
  const [manifest, evidence] = await Promise.all([
    fsp.readFile(manifestPath, "utf8").then(JSON.parse),
    fsp.readFile(evidencePath, "utf8").then(JSON.parse),
  ])
  invariant(manifest.schemaVersion === 1, "Unsupported desktop candidate manifest schema")
  invariant(manifest.classification === "signed-release-candidate", "Desktop candidate classification is invalid")
  invariant(manifest.platform === "win32" || manifest.platform === "darwin", "Desktop candidate platform is invalid")
  invariant(
    (manifest.platform === "win32" && manifest.arch === "x64")
      || (manifest.platform === "darwin" && manifest.arch === "arm64"),
    "Desktop candidate target is unsupported",
  )
  invariant(typeof manifest.desktopVersion === "string" && manifest.desktopVersion.length > 0, "Desktop candidate version is missing")
  invariant(COMMIT_PATTERN.test(manifest.commitSHA), "Desktop candidate commit SHA is invalid")
  invariant(path.basename(manifest.primaryInstaller) === manifest.primaryInstaller, "Primary installer name is unsafe")
  invariant(Array.isArray(manifest.files) && manifest.files.length > 0, "Desktop candidate file list is empty")

  const lockedNames = new Set()
  for (const file of manifest.files) {
    invariant(file && typeof file === "object", "Desktop candidate file entry is invalid")
    invariant(path.basename(file.fileName) === file.fileName && file.fileName.length > 0, "Desktop candidate filename is unsafe")
    invariant(!lockedNames.has(file.fileName), `Desktop candidate repeats ${file.fileName}`)
    invariant(Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0, `${file.fileName} has an invalid size`)
    invariant(SHA256_PATTERN.test(file.sha256), `${file.fileName} has an invalid SHA-256`)
    lockedNames.add(file.fileName)
  }
  invariant(lockedNames.has(manifest.primaryInstaller), "Primary installer is not locked in the candidate manifest")

  const actualEntries = await fsp.readdir(directory, { withFileTypes: true })
  const actualNames = actualEntries
    .filter((entry) => path.resolve(directory, entry.name) !== path.resolve(manifestPath))
    .map((entry) => entry.name)
  invariant(actualNames.length === lockedNames.size, "Desktop candidate contains missing or extra files")
  for (const entry of actualEntries) {
    const filePath = path.resolve(directory, entry.name)
    if (filePath === path.resolve(manifestPath)) continue
    invariant(entry.isFile(), `Desktop candidate contains a non-file entry: ${entry.name}`)
    const stat = await fsp.lstat(filePath)
    invariant(!stat.isSymbolicLink(), `Desktop candidate contains a symlink: ${entry.name}`)
    const locked = manifest.files.find((file) => file.fileName === entry.name)
    invariant(locked, `Desktop candidate contains an unlocked file: ${entry.name}`)
    invariant(stat.size === locked.sizeBytes, `${entry.name} size does not match the candidate manifest`)
    invariant(await sha256(filePath) === locked.sha256, `${entry.name} SHA-256 does not match the candidate manifest`)
  }

  const primary = manifest.files.find((file) => file.fileName === manifest.primaryInstaller)
  invariant(evidence.build?.artifactFileName === primary.fileName, "Installed evidence names a different primary installer")
  invariant(evidence.build?.artifactSHA256 === primary.sha256, "Installed evidence has a different primary installer digest")
  invariant(evidence.build?.desktopVersion === manifest.desktopVersion, "Installed evidence has a different desktop version")
  invariant(evidence.build?.commitSHA === manifest.commitSHA, "Installed evidence has a different commit")
  invariant(evidence.host?.platform === manifest.platform, "Installed evidence has a different platform")
  invariant(evidence.host?.architecture === manifest.arch, "Installed evidence has a different architecture")
  return manifest
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const manifest = await verifyDesktopReleaseCandidate({
    manifestPath: path.resolve(args.manifest),
    directory: path.resolve(args.directory),
    evidencePath: path.resolve(args.evidence),
  })
  console.log(`[desktop][release] verified complete ${manifest.platform}/${manifest.arch} candidate artifact set`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(`[desktop][release] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
