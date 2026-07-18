const path = require("node:path")
const { pathToFileURL } = require("node:url")

let installPromise

function ensureNativeMessagingHost() {
  installPromise ??= import(
    pathToFileURL(path.join(__dirname, "installManifest.mjs")).href
  )
    .then(({ install }) => install())
    .catch((error) => {
      process.stderr.write(
        `[anybox-chrome] Native Messaging Host registration failed: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      )
      return undefined
    })
  return installPromise
}

module.exports = { ensureNativeMessagingHost }
