import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  computeAndroidNativeFingerprint,
  otaKeyId,
  packageRoot,
  readMobileConfig,
  requireOtaCertificate,
} from "./lib/mobile-update-tools.mjs"

async function main() {
  const args = process.argv.slice(2)
  const mobile = readMobileConfig()
  requireOtaCertificate()
  const nativeFingerprint = await computeAndroidNativeFingerprint()
  const baselinePath = path.join(
    packageRoot,
    "update-baselines",
    `${mobile.runtimeVersion}.json`,
  )
  const baseline = {
    schemaVersion: 1,
    platform: "android",
    fingerprintProfile: "production-channel-normalized",
    runtimeVersion: mobile.runtimeVersion,
    version: mobile.version,
    versionCode: mobile.versionCode,
    nativeFingerprint,
    otaKeyId,
  }

  if (args.includes("--check")) {
    if (!existsSync(baselinePath)) throw new Error(`Native fingerprint baseline is missing: ${baselinePath}`)
    const existing = JSON.parse(readFileSync(baselinePath, "utf8"))
    if (JSON.stringify(existing) !== JSON.stringify(baseline)) {
      throw new Error(
        `Native fingerprint does not match ${baselinePath}. Native changes require a new APK version.`,
      )
    }
    console.log(`Native fingerprint matches ${mobile.runtimeVersion}: ${nativeFingerprint}`)
    return
  }
  if (existsSync(baselinePath) && !args.includes("--replace")) {
    throw new Error(`Baseline already exists; use --replace only while preparing an unreleased APK: ${baselinePath}`)
  }
  mkdirSync(path.dirname(baselinePath), { recursive: true })
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
  console.log(`Recorded Android native fingerprint: ${baselinePath}`)
  console.log(nativeFingerprint)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
