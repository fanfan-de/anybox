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

async function sha512Base64(filePath) {
  const hash = createHash("sha512")
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest("base64")
}

export async function verifyDesktopReleaseCandidate({ manifestPath, directory, evidencePath }) {
  const [manifest, evidence] = await Promise.all([
    fsp.readFile(manifestPath, "utf8").then(JSON.parse),
    fsp.readFile(evidencePath, "utf8").then(JSON.parse),
  ])
  invariant(manifest.schemaVersion === 1, "Unsupported desktop candidate manifest schema")
  invariant(manifest.classification === "signed-release-candidate", "Desktop candidate classification is invalid")
  invariant(
    manifest.platform === "win32" || manifest.platform === "darwin" || manifest.platform === "linux",
    "Desktop candidate platform is invalid",
  )
  invariant(
    (manifest.platform === "win32" && manifest.arch === "x64")
      || (manifest.platform === "darwin" && manifest.arch === "arm64")
      || (manifest.platform === "linux" && manifest.arch === "x64"),
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
  if (manifest.platform === "win32") {
    invariant(manifest.primaryInstaller.endsWith("-x64.exe"), "Windows primary installer name is invalid")
    for (const required of [manifest.primaryInstaller, `${manifest.primaryInstaller}.blockmap`, "latest.yml"]) {
      invariant(lockedNames.has(required), `Windows candidate is missing required update asset ${required}`)
    }
  } else if (manifest.platform === "darwin") {
    invariant(manifest.primaryInstaller.endsWith("-arm64.dmg"), "macOS primary installer name is invalid")
    const zipName = `${manifest.primaryInstaller.slice(0, -4)}.zip`
    for (const required of [
      manifest.primaryInstaller,
      `${manifest.primaryInstaller}.blockmap`,
      zipName,
      `${zipName}.blockmap`,
      "latest-mac.yml",
    ]) {
      invariant(lockedNames.has(required), `macOS candidate is missing required update asset ${required}`)
    }
  } else {
    invariant(manifest.primaryInstaller.endsWith("-x64.AppImage"), "Linux primary installer name is invalid")
    const debName = `${manifest.primaryInstaller.slice(0, -9)}.deb`
    for (const required of [
      manifest.primaryInstaller,
      debName,
      "latest-linux.yml",
    ]) {
      invariant(lockedNames.has(required), `Linux candidate is missing required release asset ${required}`)
    }
  }

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

  const metadataName = manifest.platform === "win32"
    ? "latest.yml"
    : manifest.platform === "darwin"
      ? "latest-mac.yml"
      : "latest-linux.yml"
  const metadata = await fsp.readFile(path.join(directory, metadataName), "utf8")
  const escapedVersion = manifest.desktopVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  invariant(
    new RegExp(`^version:\\s*['\"]?${escapedVersion}['\"]?\\s*$`, "m").test(metadata),
    `${metadataName} does not declare the candidate version`,
  )
  const updaterPayloads = manifest.platform === "darwin"
    ? [manifest.primaryInstaller, `${manifest.primaryInstaller.slice(0, -4)}.zip`]
    : manifest.platform === "linux"
      ? [manifest.primaryInstaller, `${manifest.primaryInstaller.slice(0, -9)}.deb`]
      : [manifest.primaryInstaller]
  for (const fileName of updaterPayloads) {
    invariant(metadata.includes(fileName), `${metadataName} does not reference ${fileName}`)
    const payloadSize = (await fsp.stat(path.join(directory, fileName))).size
    invariant(
      metadata.includes(await sha512Base64(path.join(directory, fileName))),
      `${metadataName} has a stale SHA-512 for ${fileName}`,
    )
    invariant(
      new RegExp(`(?:^|\\n)\\s*size:\\s*${payloadSize}\\s*(?:$|\\n)`).test(metadata),
      `${metadataName} has a stale size for ${fileName}`,
    )
  }
  if (manifest.platform === "linux") {
    const updateUrls = Array.from(metadata.matchAll(/^\s*-\s+url:\s*['"]?([^'"\r\n]+)['"]?\s*$/gm), (match) => match[1])
    invariant(updateUrls.length === new Set(updateUrls).size, "latest-linux.yml contains duplicate file URLs")
    invariant(
      updateUrls.filter((url) => url === manifest.primaryInstaller).length === 1,
      "latest-linux.yml must contain the AppImage exactly once",
    )
    invariant(
      updateUrls.filter((url) => url === `${manifest.primaryInstaller.slice(0, -9)}.deb`).length === 1,
      "latest-linux.yml must contain the Debian package exactly once",
    )
    const escapedInstaller = manifest.primaryInstaller.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const primaryEntry = metadata.match(
      new RegExp(`(?:^|\\n)\\s*-\\s+url:\\s*['\"]?${escapedInstaller}['\"]?\\s*\\n((?:\\s{4,}[^\\n]*(?:\\n|$))*)`),
    )
    invariant(primaryEntry, "latest-linux.yml does not contain an AppImage file entry")
    invariant(
      /^\s*blockMapSize:\s*[1-9]\d*\s*$/m.test(primaryEntry[1]),
      "latest-linux.yml does not declare a positive embedded AppImage blockMapSize",
    )
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
