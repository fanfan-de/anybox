import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(scriptDir, "..")
const electronBuilderCLI = path.join(desktopDir, "node_modules", "electron-builder", "cli.js")
const normalizeLinuxUpdateMetadataScript = path.join(scriptDir, "normalize-linux-update-metadata.mjs")
const builderArgs = process.argv.slice(2)

if (builderArgs.some((argument) => argument === "--publish" || argument.startsWith("--publish="))) {
  throw new Error("The dist command always uses --publish never; use the reviewed publish workflow for uploads")
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopDir,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`)
}

run(process.execPath, [electronBuilderCLI, ...builderArgs, "--publish", "never"])
run(process.execPath, [normalizeLinuxUpdateMetadataScript, "--directory", path.join(desktopDir, "dist")])
