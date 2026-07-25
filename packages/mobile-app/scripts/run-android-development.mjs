import { existsSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { DEVELOPMENT_PACKAGE_NAME } from "./lib/android-development.mjs"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const isWindows = process.platform === "win32"

function packageBin(name) {
  return path.join(
    packageRoot,
    "node_modules",
    ".bin",
    `${name}${isWindows ? ".CMD" : ""}`,
  )
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    shell: isWindows && /\.(?:bat|cmd)$/i.test(command),
    stdio: "inherit",
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args.join(" ")} failed.`)
  }
}

function assertSafeForwardedArgs(args) {
  for (const forbidden of ["--app-id", "--binary", "--no-bundler", "--variant"]) {
    if (
      args.some(
        (value) => value === forbidden || value.startsWith(`${forbidden}=`),
      )
    ) {
      throw new Error(
        `${forbidden} is managed by mobile:android:dev and cannot be overridden.`,
      )
    }
  }
}

function main() {
  const forwardedArgs = process.argv.slice(2).filter((value) => value !== "--")
  assertSafeForwardedArgs(forwardedArgs)
  const expo = packageBin("expo")
  if (!existsSync(expo)) {
    throw new Error("Expo CLI is not installed in packages/mobile-app.")
  }
  const env = {
    ...process.env,
    ANYBOX_MOBILE_BUILD_PROFILE: "development",
    NODE_ENV: "development",
  }

  run(
    "node",
    [
      path.join(packageRoot, "scripts", "build-android-debug.mjs"),
      "--profile",
      "development",
      "--prepare-only",
      "--no-embed",
    ],
    { env },
  )
  run(
    expo,
    [
      "run:android",
      "--app-id",
      DEVELOPMENT_PACKAGE_NAME,
      ...forwardedArgs,
    ],
    { env },
  )
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
