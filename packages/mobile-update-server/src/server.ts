import { X509Certificate } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import { createUpdateApp } from "./app.js"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const defaultCertificatePath = path.resolve(
  packageRoot,
  "..",
  "mobile-app",
  "credentials",
  "ota-certificate.pem",
)
const port = Number.parseInt(process.env.PORT ?? "3210", 10)
if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error("PORT must be a valid TCP port.")

const certificatePath = path.resolve(
  process.env.ANYBOX_OTA_CERTIFICATE_PATH ?? defaultCertificatePath,
)
const publicKeyPem = readFileSync(certificatePath, "utf8")
const certificate = new X509Certificate(publicKeyPem)
const now = Date.now()
if (now < Date.parse(certificate.validFrom) || now > Date.parse(certificate.validTo)) {
  throw new Error("The OTA public certificate is not currently valid.")
}
const cdnBaseUrl = process.env.MOBILE_UPDATE_CDN_BASE_URL ?? "https://download.anybox.com.cn"

const app = createUpdateApp({
  cdnBaseUrl,
  publicKeyPem,
  ...(process.env.MOBILE_UPDATE_READY_URL
    ? { readyUrl: process.env.MOBILE_UPDATE_READY_URL }
    : {}),
})

serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, (info) => {
  console.info(
    JSON.stringify({
      event: "mobile_update_server_started",
      host: info.address,
      port: info.port,
      cdnBaseUrl,
      keyId: "anybox-mobile-2026",
    }),
  )
})
