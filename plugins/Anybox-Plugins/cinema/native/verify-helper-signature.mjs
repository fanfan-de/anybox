import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const nativeRoot = path.dirname(fileURLToPath(import.meta.url))
const target = `${process.platform}-${process.arch}`
const supported = new Map([
  ["win32-x64", "cinema-platform-helper.exe"],
  ["darwin-arm64", "cinema-platform-helper"],
  ["linux-x64", "cinema-platform-helper"],
])
const fileName = supported.get(target)
const allowUnsignedValidation = process.argv.includes("--allow-unsigned-validation")
if (!fileName) throw new Error(`Cinema helper signature verification does not support ${target}.`)

const artifactDirectory = path.join(nativeRoot, "artifacts", target)
const artifactPath = path.join(artifactDirectory, fileName)
const provenancePath = path.join(artifactDirectory, "signature-verification.json")

async function sha256(filePath) {
  const hash = createHash("sha256")
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true })
  if (result.status !== 0) {
    throw new Error(`${command} signature verification failed: ${(result.stderr || result.stdout || "unknown error").trim()}`)
  }
  return result.stdout.trim()
}

const info = await fsp.lstat(artifactPath).catch(() => undefined)
if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Cinema helper artifact is missing or invalid: ${artifactPath}`)
const digest = await sha256(artifactPath)
let verification

if (allowUnsignedValidation) {
  verification = { status: "unsigned-validation", method: "explicit-ci-validation-bypass" }
} else if (process.platform === "win32") {
  const script = [
    `$signature = Get-AuthenticodeSignature -LiteralPath '${artifactPath.replaceAll("'", "''")}'`,
    "if ($signature.Status -ne 'Valid') { throw \"Authenticode status: $($signature.Status)\" }",
    "$signature | Select-Object Status,@{n='thumbprint';e={$_.SignerCertificate.Thumbprint}} | ConvertTo-Json -Compress",
  ].join("; ")
  const result = JSON.parse(run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]))
  const expected = process.env.CINEMA_HELPER_WINDOWS_SIGNER_THUMBPRINT?.replaceAll(/\s/g, "").toUpperCase()
  const actual = String(result.thumbprint ?? "").replaceAll(/\s/g, "").toUpperCase()
  if (!actual || (expected && actual !== expected)) throw new Error("Cinema Windows helper signer thumbprint is missing or unexpected.")
  verification = { status: "verified", method: "windows-authenticode", signer: actual }
} else if (process.platform === "darwin") {
  run("codesign", ["--verify", "--strict", "--verbose=2", artifactPath])
  const details = spawnSync("codesign", ["-d", "--verbose=4", artifactPath], { encoding: "utf8" })
  const output = `${details.stdout}\n${details.stderr}`
  const teamID = /^TeamIdentifier=(.+)$/m.exec(output)?.[1]?.trim()
  const expected = process.env.CINEMA_HELPER_APPLE_TEAM_ID?.trim()
  if (!teamID || (expected && teamID !== expected)) throw new Error("Cinema macOS helper TeamIdentifier is missing or unexpected.")
  verification = { status: "verified", method: "apple-codesign", signer: teamID }
} else {
  const signaturePath = `${artifactPath}.minisig`
  const publicKey = process.env.CINEMA_HELPER_MINISIGN_PUBLIC_KEY?.trim()
  if (!publicKey) throw new Error("CINEMA_HELPER_MINISIGN_PUBLIC_KEY is required to verify the Linux helper.")
  const signature = await fsp.lstat(signaturePath).catch(() => undefined)
  if (!signature?.isFile() || signature.isSymbolicLink()) throw new Error(`Linux helper signature is missing: ${signaturePath}`)
  run("minisign", ["-Vm", artifactPath, "-x", signaturePath, "-P", publicKey])
  verification = { status: "verified", method: "linux-minisign", signer: createHash("sha256").update(publicKey).digest("hex") }
}

const record = {
  schemaVersion: 1,
  target,
  path: path.relative(nativeRoot, artifactPath).replaceAll("\\", "/"),
  sha256: digest,
  ...verification,
  verifiedAt: new Date().toISOString(),
}
await fsp.writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`, "utf8")
console.log(JSON.stringify(record))
