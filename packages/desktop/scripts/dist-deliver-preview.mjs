import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(scriptDir, "..")
const corepackInvocation = process.platform === "win32"
  ? {
      command: process.execPath,
      args: [path.join(path.dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js")],
    }
  : { command: "corepack", args: [] }
const electronBuilderCLI = path.join(desktopDir, "node_modules", "electron-builder", "cli.js")
const normalizeLinuxUpdateMetadataScript = path.join(scriptDir, "normalize-linux-update-metadata.mjs")

function fail(message) {
  console.error(`[desktop][deliver-preview] ${message}`)
  process.exitCode = 1
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: desktopDir,
    env,
    stdio: "inherit",
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status ?? "unknown"}`)
  }
}

function sanitizedBuilderArgs(args) {
  const result = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--") {
      throw new Error("Do not pass a nested '--' separator to the Deliver preview wrapper.")
    }
    if (argument === "publish") {
      throw new Error("The Deliver preview wrapper cannot invoke the electron-builder publish command.")
    }
    if (argument === "--publish" || argument === "-p") {
      const policy = args[index + 1]
      if (!policy) throw new Error(`${argument} requires a policy.`)
      if (policy !== "never") {
        throw new Error(`Publish policy '${policy}' is forbidden for a Deliver preview build.`)
      }
      index += 1
      continue
    }
    if (argument.startsWith("--publish=") || argument.startsWith("-p=")) {
      const policy = argument.slice(argument.indexOf("=") + 1)
      if (policy !== "never") {
        throw new Error(`Publish policy '${policy}' is forbidden for a Deliver preview build.`)
      }
      continue
    }
    if (argument === "-pnever") continue
    if (argument.startsWith("-p")) {
      throw new Error(`Publish argument '${argument}' is forbidden for a Deliver preview build.`)
    }
    if (
      argument.startsWith("--config.directories.output")
      || argument.startsWith("-c.directories.output")
      || argument.startsWith("--config.artifactName")
      || argument.startsWith("-c.artifactName")
    ) {
      throw new Error(`Preview output identity cannot be overridden (${argument}).`)
    }
    result.push(argument)
  }
  return result
}

try {
  const rawArgs = process.argv.slice(2)
  const betaBuild = rawArgs[0] === "--beta"
  const builderArgs = sanitizedBuilderArgs(betaBuild ? rawArgs.slice(1) : rawArgs)
  if (betaBuild && (
    !process.env.ANYBOX_FFMPEG_BINARY
    || !process.env.ANYBOX_FFPROBE_BINARY
    || !process.env.ANYBOX_MEDIA_RUNTIME_MATERIALS_DIR
  )) {
    throw new Error(
      "Deliver Beta requires FFmpeg, FFprobe, and ANYBOX_MEDIA_RUNTIME_MATERIALS_DIR from the platform runtime build.",
    )
  }
  const previewEnv = {
    ...process.env,
    VITE_CINEMA_DELIVER_DEV: "1",
    ANYBOX_DELIVER_PREVIEW_BUILD: "1",
    ...(betaBuild ? { ANYBOX_DELIVER_BETA_BUILD: "1", ANYBOX_REQUIRE_MEDIA_RUNTIME: "1" } : {}),
  }
  if (!betaBuild) delete previewEnv.ANYBOX_REQUIRE_MEDIA_RUNTIME
  delete previewEnv.ANYBOX_MEDIA_RUNTIME_STRICT

  console.warn(
    betaBuild
      ? "[desktop][deliver-beta] NON-RELEASE Beta with bundled media runtime; publishing is disabled."
      : "[desktop][deliver-preview] NON-RELEASE technical preview; Deliver dev gate enabled; publishing is disabled.",
  )
  run(corepackInvocation.command, [...corepackInvocation.args, "pnpm", "run", "build"], previewEnv)
  run(corepackInvocation.command, [...corepackInvocation.args, "pnpm", "run", "verify:agent-runtime"], previewEnv)
  run(corepackInvocation.command, [...corepackInvocation.args, "pnpm", "run", "icons:generate"], previewEnv)
  const previewLabel = betaBuild ? "Beta" : "Preview"
  const outputDirectoryName = betaBuild ? "deliver-beta" : "deliver-preview"
  rmSync(path.join(desktopDir, "dist", outputDirectoryName), { recursive: true, force: true })
  const linuxBuild = builderArgs.some((argument) => ["--linux", "-l", "linux"].includes(argument))
  const artifactNameConfig = linuxBuild
    ? `--config.linux.artifactName=Anybox-Deliver-${previewLabel}-\${version}-linux-x64.\${ext}`
    : `--config.artifactName=Anybox-Deliver-${previewLabel}-\${version}-\${os}-\${arch}.\${ext}`
  run(process.execPath, [
    electronBuilderCLI,
    ...builderArgs,
    `--config.directories.output=dist/${outputDirectoryName}`,
    artifactNameConfig,
    "--config.forceCodeSigning=false",
    "--config.mac.notarize=false",
    "--config.win.signAndEditExecutable=false",
    "--publish",
    "never",
  ], previewEnv)
  run(process.execPath, [normalizeLinuxUpdateMetadataScript, "--directory", path.join("dist", outputDirectoryName)], previewEnv)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
