const path = require("node:path")
const { pathToFileURL } = require("node:url")

let installPromise

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

module.exports = { NativeHostInstallError, ensureNativeMessagingHost }
