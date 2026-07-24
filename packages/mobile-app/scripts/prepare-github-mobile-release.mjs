import { existsSync } from "node:fs"
import path from "node:path"
import { prepareAndroidReleaseAssets } from "./lib/android-release.mjs"
import {
  loadMobileReleaseEnvironment,
  packageRoot,
  parseNotes,
  parseOption,
  readMobileConfig,
  requireOtaSigningMaterial,
} from "./lib/mobile-update-tools.mjs"

function usage() {
  return [
    "Prepare signed Anybox Mobile GitHub Release assets.",
    "",
    "Usage:",
    '  pnpm mobile:release:github:prepare -- --notes "Release note"',
    "",
    "Options:",
    "  --apk <path>                    Defaults to build/anybox-mobile-release.apk.",
    "  --out-dir <path>                Defaults to build/github-release.",
    "  --notes <text>                  May be repeated.",
    "  --force                         Mark the new APK as required.",
    "  --minimum-version-code <value>  Defaults to app.json update baseline.",
    "  --help",
  ].join("\n")
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage())
    return
  }
  loadMobileReleaseEnvironment()
  const mobile = readMobileConfig()
  const signing = requireOtaSigningMaterial()
  const apkPath = path.resolve(
    parseOption(args, "--apk", path.join(packageRoot, "build", "anybox-mobile-release.apk")),
  )
  const outDirectory = path.resolve(
    parseOption(args, "--out-dir", path.join(packageRoot, "build", "github-release")),
  )
  if (!existsSync(apkPath)) throw new Error(`Release APK not found: ${apkPath}`)
  const notes = parseNotes(args)
  if (notes.length === 0) throw new Error("At least one --notes value is required.")
  const minimumVersionCode = Number.parseInt(
    parseOption(
      args,
      "--minimum-version-code",
      String(mobile.appJson.extra.anyboxMobileMinimumVersionCode),
    ),
    10,
  )
  const prepared = await prepareAndroidReleaseAssets({
    mobile,
    apkPath,
    notes,
    force: args.includes("--force"),
    minimumVersionCode,
    privateKeyPem: signing.privateKeyPem,
    outDirectory,
  })

  console.log(`Release tag: ${prepared.tag}`)
  console.log(`APK asset: ${prepared.apkOutputPath}`)
  console.log(`Manifest asset: ${prepared.manifestOutputPath}`)
  console.log(`Manifest signature: ${prepared.signatureOutputPath}`)
  console.log("Create the GitHub release with:")
  console.log(
    `gh release create ${prepared.tag} "${prepared.apkOutputPath}" "${prepared.manifestOutputPath}" ` +
      `"${prepared.signatureOutputPath}" --repo ${mobile.githubRepository} ` +
      `--title "Anybox Mobile ${mobile.version}" --notes "Anybox Mobile ${mobile.version}" --latest=false`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
