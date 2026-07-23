import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  buildBrowserHost,
  buildBrowserRuntime,
  buildChromeExtension,
  defaultPluginRoot,
  defaultProjectRoot,
  packageChromePlugin,
  validateChromePluginPackage,
} from "./package-chrome-plugin.mjs"
import {
  buildNativeHost,
} from "../browser-native-host/tools/build.mjs"

const MAC_TARGETS = Object.freeze([
  {
    architecture: "x64",
    target: "darwin/x64",
    rustArchitecture: "x86_64",
  },
  {
    architecture: "arm64",
    target: "darwin/arm64",
    rustArchitecture: "arm64",
  },
])

function requiredValue(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`)
  }
  return value.trim()
}

function runCommand(command, args, options = {}) {
  const capture = options.capture === true
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: capture ? "utf8" : undefined,
    env: options.env,
    stdio: capture ? "pipe" : "inherit",
    windowsHide: true,
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const details = capture
      ? [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
      : ""
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}${details ? `\n${details}` : ""}`,
    )
  }
  return {
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  }
}

async function sha256(filePath) {
  return createHash("sha256")
    .update(await fsp.readFile(filePath))
    .digest("hex")
}

export function inspectPeArchitecture(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 0x40) {
    throw new Error("Windows Native Messaging Host is not a valid PE file.")
  }
  if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error("Windows Native Messaging Host is missing the MZ header.")
  }
  const peOffset = bytes.readUInt32LE(0x3c)
  if (
    peOffset + 6 > bytes.length
    || bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0"
  ) {
    throw new Error("Windows Native Messaging Host is missing the PE header.")
  }
  const machine = bytes.readUInt16LE(peOffset + 4)
  if (machine !== 0x8664) {
    throw new Error(
      `Windows Native Messaging Host must be PE x64 (machine 0x8664); found 0x${machine.toString(16)}.`,
    )
  }
  return "x64"
}

export function validatePeEmbeddedVersion(bytes, expectedVersion) {
  const version = requiredValue(expectedVersion, "expected Windows Host version")
  if (!Buffer.isBuffer(bytes) || !bytes.includes(Buffer.from(version, "ascii"))) {
    throw new Error(
      `Windows Native Messaging Host does not embed the expected plugin version ${version}. Build it from the same source revision before release.`,
    )
  }
  return version
}

export function validateCodesignDetails(details) {
  if (!/^\s*Authority=Developer ID Application:/mu.test(details)) {
    throw new Error(
      "macOS Native Messaging Host is not signed with Developer ID Application.",
    )
  }
  if (!/^\s*flags=.*\bruntime\b/mu.test(details)) {
    throw new Error(
      "macOS Native Messaging Host signature is missing the hardened runtime.",
    )
  }
  if (!/^\s*Timestamp=.+$/mu.test(details)) {
    throw new Error(
      "macOS Native Messaging Host signature is missing a secure timestamp.",
    )
  }
}

export function validateNotaryResult(output) {
  let result
  try {
    result = JSON.parse(output)
  } catch (error) {
    throw new Error("Apple notarytool did not return valid JSON.", {
      cause: error,
    })
  }
  if (result?.status !== "Accepted") {
    throw new Error(
      `Apple notarization was not accepted (status: ${result?.status ?? "missing"}).`,
    )
  }
  return result
}

export function parseReleaseArgs(argv) {
  const options = {}
  const forbidden = new Set([
    "--apple-id",
    "--password",
    "--team-id",
    "--api-key",
    "--api-key-id",
    "--api-issuer",
    "--certificate",
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    const [flag, inlineValue] = value.split("=", 2)
    if (forbidden.has(flag)) {
      throw new Error(
        `${flag} is not accepted. Store notarization credentials in a notarytool Keychain profile.`,
      )
    }
    const consumeValue = () => {
      if (inlineValue !== undefined) return inlineValue
      const next = argv[index + 1]
      if (!next || next.startsWith("-")) {
        throw new Error(`${flag} requires a value.`)
      }
      index += 1
      return next
    }
    if (flag === "--windows-host") {
      options.windowsHost = consumeValue()
    } else if (flag === "--codesign-identity") {
      options.codesignIdentity = consumeValue()
    } else if (flag === "--notary-profile") {
      options.notaryProfile = consumeValue()
    } else if (flag === "--help" || flag === "-h") {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${value}`)
    }
  }
  return options
}

async function verifyMachOArchitecture(filePath, expected, run = runCommand) {
  const result = run("lipo", ["-archs", filePath], { capture: true })
  const architectures = result.stdout.trim().split(/\s+/u).filter(Boolean)
  if (architectures.length !== 1 || architectures[0] !== expected) {
    throw new Error(
      `Expected a thin ${expected} Mach-O at ${filePath}; found ${architectures.join(", ") || "unknown"}.`,
    )
  }
}

async function signAndVerifyMacHost(filePath, identity, run = runCommand) {
  run("codesign", [
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--sign",
    identity,
    filePath,
  ])
  run("codesign", ["--verify", "--strict", "--verbose=2", filePath])
  const details = run(
    "codesign",
    ["--display", "--verbose=4", filePath],
    { capture: true },
  )
  validateCodesignDetails(`${details.stdout}\n${details.stderr}`)
}

async function notarizeMacHosts(hosts, profile, run = runCommand) {
  const temporaryRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "anybox-chrome-notarization-"),
  )
  try {
    const payloadRoot = path.join(temporaryRoot, "chrome-native-hosts")
    for (const host of hosts) {
      const destination = path.join(
        payloadRoot,
        "macos",
        host.architecture,
        "extension-host",
      )
      await fsp.mkdir(path.dirname(destination), { recursive: true })
      await fsp.copyFile(host.path, destination)
      await fsp.chmod(destination, 0o755)
    }
    const archivePath = path.join(
      temporaryRoot,
      "chrome-native-hosts-notarization.zip",
    )
    run("ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      payloadRoot,
      archivePath,
    ])
    const result = run("xcrun", [
      "notarytool",
      "submit",
      archivePath,
      "--keychain-profile",
      profile,
      "--wait",
      "--output-format",
      "json",
    ], { capture: true })
    return validateNotaryResult(result.stdout)
  } finally {
    await fsp.rm(temporaryRoot, { recursive: true, force: true })
  }
}

export async function releaseChromePlugin({
  windowsHost,
  codesignIdentity,
  notaryProfile,
  platform = process.platform,
  architecture = process.arch,
  projectRoot = defaultProjectRoot,
  pluginRoot = defaultPluginRoot,
  run = runCommand,
} = {}) {
  if (platform !== "darwin" || architecture !== "arm64") {
    throw new Error(
      `Chrome plugin release must run on an Apple Silicon Mac; current host is ${platform}/${architecture}.`,
    )
  }
  const windowsHostPath = path.resolve(
    requiredValue(windowsHost, "--windows-host"),
  )
  const identity = requiredValue(codesignIdentity, "--codesign-identity")
  const profile = requiredValue(notaryProfile, "--notary-profile")
  const windowsBytes = await fsp.readFile(windowsHostPath)
  inspectPeArchitecture(windowsBytes)
  const sourceManifest = JSON.parse(await fsp.readFile(
    path.join(projectRoot, "runtime", ".anybox-plugin", "plugin.json"),
    "utf8",
  ))
  const expectedVersion = requiredValue(
    sourceManifest.version,
    "Chrome source manifest version",
  )
  validatePeEmbeddedVersion(windowsBytes, expectedVersion)
  const windowsHash = createHash("sha256").update(windowsBytes).digest("hex")

  const nativeHostRoot = path.join(projectRoot, "browser-native-host")
  const windowsDestination = path.join(
    nativeHostRoot,
    "dist",
    "windows",
    "x64",
    "extension-host.exe",
  )
  await fsp.mkdir(path.dirname(windowsDestination), { recursive: true })
  await fsp.copyFile(windowsHostPath, windowsDestination)

  const macHosts = []
  for (const macTarget of MAC_TARGETS) {
    const build = await buildNativeHost({
      target: macTarget.target,
      platform,
      architecture,
      projectRoot: nativeHostRoot,
    })
    await verifyMachOArchitecture(
      build.output,
      macTarget.rustArchitecture,
      run,
    )
    await signAndVerifyMacHost(build.output, identity, run)
    macHosts.push({
      architecture: macTarget.architecture,
      path: build.output,
    })
  }

  const notary = await notarizeMacHosts(macHosts, profile, run)
  for (const host of macHosts) {
    run("spctl", [
      "--assess",
      "--type",
      "execute",
      "--verbose=4",
      host.path,
    ])
  }
  const signedHashes = new Map(
    await Promise.all(macHosts.map(async (host) => [
      host.architecture,
      await sha256(host.path),
    ])),
  )

  buildBrowserHost()
  buildBrowserRuntime()
  buildChromeExtension()
  await packageChromePlugin({
    projectRoot,
    pluginRoot,
    nativeHostScope: "all",
  })
  const validation = await validateChromePluginPackage(pluginRoot, {
    nativeHostScope: "all",
  })
  const packagedNativeHosts = validation.files.filter((entry) =>
    entry.split(path.sep).join("/").startsWith("extension-host/")
  )
  if (packagedNativeHosts.length !== 3) {
    throw new Error(
      `Released Chrome plugin must contain exactly three Native Messaging Hosts; found ${packagedNativeHosts.length}.`,
    )
  }
  const packagedWindowsPath = path.join(
    pluginRoot,
    "extension-host",
    "windows",
    "x64",
    "extension-host.exe",
  )
  inspectPeArchitecture(await fsp.readFile(packagedWindowsPath))
  if (await sha256(packagedWindowsPath) !== windowsHash) {
    throw new Error(
      "Packaged Windows x64 Native Messaging Host differs from the handoff artifact.",
    )
  }
  for (const host of macHosts) {
    const packagedPath = path.join(
      pluginRoot,
      "extension-host",
      "macos",
      host.architecture,
      "extension-host",
    )
    if (await sha256(packagedPath) !== signedHashes.get(host.architecture)) {
      throw new Error(
        `Packaged macOS ${host.architecture} Native Messaging Host differs from the signed binary.`,
      )
    }
  }

  return {
    files: validation.files.length,
    nativeHosts: packagedNativeHosts,
    notarizationID: notary.id,
    pluginRoot,
    version: expectedVersion,
  }
}

function printHelp() {
  process.stdout.write([
    "Build, sign, notarize, assemble, and validate the Anybox Chrome plugin locally.",
    "",
    "Usage:",
    "  node tools/release-chrome-plugin.mjs \\",
    "    --windows-host <path-to-extension-host.exe> \\",
    "    --codesign-identity <Developer-ID-identity> \\",
    "    --notary-profile <Keychain-profile>",
    "",
    "The Windows host must come from a self-owned Windows x64 build machine.",
    "Notarization credentials must already be stored in the named Keychain profile.",
    "",
  ].join("\n"))
}

async function main() {
  const options = parseReleaseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  const result = await releaseChromePlugin(options)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
