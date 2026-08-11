import { createHash } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const nativeRoot = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(nativeRoot, "..")
const manifestPath = path.join(pluginRoot, ".anybox-plugin", "plugin.json")
const checkOnly = process.argv.includes("--check")
const allowUnsignedValidation = process.argv.includes("--allow-unsigned-validation")
const targets = [
  { platform: "win32", architecture: "x64", fileName: "cinema-platform-helper.exe" },
  { platform: "darwin", architecture: "arm64", fileName: "cinema-platform-helper" },
  { platform: "linux", architecture: "x64", fileName: "cinema-platform-helper" },
]

async function sha256(filePath) {
  const hash = createHash("sha256")
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

function requiredEnvironment(name, label) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required to approve the ${label} helper for release.`)
  return value
}

function expectedVerification(target) {
  if (target === "win32-x64") {
    return {
      method: "windows-authenticode",
      signer: requiredEnvironment("CINEMA_HELPER_WINDOWS_SIGNER_THUMBPRINT", "Windows")
        .replaceAll(/\s/g, "").toUpperCase(),
    }
  }
  if (target === "darwin-arm64") {
    return {
      method: "apple-codesign",
      signer: requiredEnvironment("CINEMA_HELPER_APPLE_TEAM_ID", "macOS"),
    }
  }
  const publicKey = requiredEnvironment("CINEMA_HELPER_MINISIGN_PUBLIC_KEY", "Linux")
  return {
    method: "linux-minisign",
    signer: createHash("sha256").update(publicKey).digest("hex"),
  }
}

function approvedProvenance(provenance, target, digest) {
  if (provenance?.schemaVersion !== 1 || provenance?.target !== target || provenance?.sha256 !== digest) return false
  if (provenance.status === "unsigned-validation") {
    return allowUnsignedValidation && provenance.method === "explicit-ci-validation-bypass"
  }
  if (provenance.status !== "verified") return false
  const expected = expectedVerification(target)
  const signer = target === "win32-x64"
    ? String(provenance.signer ?? "").replaceAll(/\s/g, "").toUpperCase()
    : String(provenance.signer ?? "")
  return provenance.method === expected.method && signer === expected.signer
}

const executables = []
for (const target of targets) {
  const targetKey = `${target.platform}-${target.architecture}`
  const relativePath = `native/artifacts/${targetKey}/${target.fileName}`
  const absolutePath = path.join(pluginRoot, ...relativePath.split("/"))
  const info = await fsp.lstat(absolutePath).catch(() => undefined)
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Missing regular Cinema helper artifact: ${relativePath}`)
  const digest = await sha256(absolutePath)
  const provenancePath = path.join(path.dirname(absolutePath), "signature-verification.json")
  const provenance = await fsp.readFile(provenancePath, "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => undefined)
  if (!approvedProvenance(provenance, targetKey, digest)) {
    throw new Error(`Cinema helper signature verification is missing, stale, or not release-approved: ${targetKey}`)
  }
  executables.push({
    platform: target.platform,
    architecture: target.architecture,
    path: relativePath,
    sha256: digest,
  })
}

const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
const artifact = manifest.platformArtifacts?.find((item) => item.id === "cinema-platform-helper")
if (!artifact || artifact.type !== "app-runtime-helper") throw new Error("Cinema manifest is missing its app-runtime-helper declaration.")

if (checkOnly) {
  if (JSON.stringify(artifact.executables) !== JSON.stringify(executables)) {
    throw new Error("Cinema helper artifacts do not match the manifest. Run native/assemble-helper-manifest.mjs on the release assembly machine.")
  }
} else {
  artifact.executables = executables
  await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
}
console.log(JSON.stringify({ checked: checkOnly, allowUnsignedValidation, executables }))
