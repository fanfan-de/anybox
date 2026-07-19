const { execFile } = require("node:child_process")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const { promisify } = require("node:util")

let installPromise
const execFileAsync = promisify(execFile)

class NativeHostInstallError extends Error {
  constructor(message, cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = "NativeHostInstallError"
    this.code = "NATIVE_HOST_INSTALL_FAILED"
    this.retryable = true
  }
}

function ensureNativeMessagingHost() {
  installPromise ??= import(
    pathToFileURL(path.join(__dirname, "installManifest.mjs")).href
  )
    .then(({ install }) => install())
    .catch((error) => {
      installPromise = undefined
      throw new NativeHostInstallError(
        `Native Messaging Host registration failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error,
      )
    })
  return installPromise
}

async function probeNativeMessagingHost() {
  const installation = await ensureNativeMessagingHost()
  if (installation?.skipped) return
  if (
    typeof installation?.extensionHostPath !== "string"
    || typeof installation?.runtimeConfigPath !== "string"
  ) {
    throw new NativeHostInstallError(
      "Native Messaging Host installation did not return probe paths.",
    )
  }
  try {
    await execFileAsync(
      installation.extensionHostPath,
      ["--probe"],
      {
        env: {
          ...process.env,
          ANYBOX_BROWSER_NATIVE_CONFIG: installation.runtimeConfigPath,
        },
        timeout: 5_000,
        windowsHide: true,
      },
    )
  } catch (error) {
    throw new NativeHostInstallError(
      `Native Messaging Host health check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    )
  }
}

module.exports = {
  NativeHostInstallError,
  ensureNativeMessagingHost,
  probeNativeMessagingHost,
}
