import { spawnSync } from "node:child_process"
import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const defaultProjectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)

const supportedTargets = new Map([
  ["win32/x64", {
    platform: "win32",
    architecture: "x64",
    platformDirectory: "windows",
    architectureDirectory: "x64",
    executableName: "extension-host.exe",
    rustTarget: "x86_64-pc-windows-msvc",
  }],
  ["darwin/x64", {
    platform: "darwin",
    architecture: "x64",
    platformDirectory: "macos",
    architectureDirectory: "x64",
    executableName: "extension-host",
    rustTarget: "x86_64-apple-darwin",
  }],
  ["darwin/arm64", {
    platform: "darwin",
    architecture: "arm64",
    platformDirectory: "macos",
    architectureDirectory: "arm64",
    executableName: "extension-host",
    rustTarget: "aarch64-apple-darwin",
  }],
])

export function resolveNativeHostBuildTarget({
  target,
  platform = process.platform,
  architecture = process.arch,
} = {}) {
  const explicit = typeof target === "string" && target.trim().length > 0
  const targetID = explicit ? target.trim() : `${platform}/${architecture}`
  const resolved = supportedTargets.get(targetID)
  if (!resolved) {
    throw new Error(
      `Unsupported Native Messaging Host target: ${targetID}. Expected win32/x64, darwin/x64, or darwin/arm64.`,
    )
  }
  if (resolved.platform !== platform) {
    throw new Error(
      `Native Messaging Host target ${targetID} must be built on ${resolved.platform}; current host is ${platform}/${architecture}.`,
    )
  }
  if (resolved.platform === "win32" && architecture !== "x64") {
    throw new Error(
      `Windows x64 Native Messaging Host must be built on a Windows x64 host; current host is ${platform}/${architecture}.`,
    )
  }
  return {
    ...resolved,
    explicit,
    targetID,
  }
}

export function nativeHostBuildPaths(
  target,
  projectRoot = defaultProjectRoot,
) {
  const cargoOutputRoot = target.explicit
    ? path.join(projectRoot, "target", target.rustTarget, "release")
    : path.join(projectRoot, "target", "release")
  return {
    source: path.join(cargoOutputRoot, target.executableName),
    destination: path.join(
      projectRoot,
      "dist",
      target.platformDirectory,
      target.architectureDirectory,
      target.executableName,
    ),
  }
}

export function parseBuildArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--target") {
      const target = argv[index + 1]
      if (!target || target.startsWith("-")) {
        throw new Error("--target requires a platform/architecture value.")
      }
      options.target = target
      index += 1
    } else if (value.startsWith("--target=")) {
      options.target = value.slice("--target=".length)
    } else if (value === "--help" || value === "-h") {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${value}`)
    }
  }
  return options
}

export async function buildNativeHost({
  target: targetValue,
  platform = process.platform,
  architecture = process.arch,
  projectRoot = defaultProjectRoot,
  spawn = spawnSync,
} = {}) {
  const target = resolveNativeHostBuildTarget({
    target: targetValue,
    platform,
    architecture,
  })
  const cargoArgs = [
    "build",
    "--release",
    "--locked",
    "--manifest-path",
    path.join(projectRoot, "Cargo.toml"),
  ]
  if (target.explicit) cargoArgs.push("--target", target.rustTarget)

  const result = spawn("cargo", cargoArgs, {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true,
    shell: platform === "win32",
  })
  if (result.status !== 0) {
    throw new Error(
      `Failed to build the Rust Native Messaging Host for ${target.targetID}.`,
    )
  }

  const paths = nativeHostBuildPaths(target, projectRoot)
  await fsp.rm(paths.destination, { force: true })
  await fsp.mkdir(path.dirname(paths.destination), { recursive: true })
  await fsp.copyFile(paths.source, paths.destination)
  if (target.platform !== "win32") await fsp.chmod(paths.destination, 0o755)

  const stat = await fsp.stat(paths.destination)
  return {
    architecture: target.architectureDirectory,
    bytes: stat.size,
    output: paths.destination,
    platform: target.platformDirectory,
    rustTarget: target.rustTarget,
    target: target.targetID,
  }
}

function printHelp() {
  process.stdout.write([
    "Build an officially supported Anybox Chrome Native Messaging Host.",
    "",
    "Usage:",
    "  node tools/build.mjs [--target <platform/architecture>]",
    "",
    "Targets:",
    "  win32/x64",
    "  darwin/x64",
    "  darwin/arm64",
    "",
    "Without --target, the current supported platform and architecture are used.",
    "",
  ].join("\n"))
}

async function main() {
  const options = parseBuildArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  const result = await buildNativeHost({ target: options.target })
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
