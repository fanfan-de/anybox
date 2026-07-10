import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(scriptDir, "..")
const corepackCommand = process.platform === "win32" ? "corepack.cmd" : "corepack"
const electronBuilderCLI = path.join(desktopDir, "node_modules", "electron-builder", "cli.js")

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
  const builderArgs = sanitizedBuilderArgs(process.argv.slice(2))
  const previewEnv = {
    ...process.env,
    VITE_CINEMA_DELIVER_DEV: "1",
    ANYBOX_DELIVER_PREVIEW_BUILD: "1",
  }
  delete previewEnv.ANYBOX_REQUIRE_MEDIA_RUNTIME
  delete previewEnv.ANYBOX_MEDIA_RUNTIME_STRICT

  console.warn(
    "[desktop][deliver-preview] NON-RELEASE technical preview; Deliver dev gate enabled; publishing is disabled.",
  )
  run(corepackCommand, ["pnpm", "run", "build"], previewEnv)
  run(corepackCommand, ["pnpm", "run", "verify:agent-runtime"], previewEnv)
  run(corepackCommand, ["pnpm", "run", "icons:generate"], previewEnv)
  run(process.execPath, [
    electronBuilderCLI,
    ...builderArgs,
    "--config.directories.output=dist/deliver-preview",
    "--config.artifactName=Anybox-Deliver-Preview-${version}-${os}-${arch}.${ext}",
    "--config.forceCodeSigning=false",
    "--config.mac.notarize=false",
    "--config.win.signAndEditExecutable=false",
    "--publish",
    "never",
  ], previewEnv)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
