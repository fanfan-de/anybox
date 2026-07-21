#!/usr/bin/env node

import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(scriptDirectory, "..")
const {
  HELPER_VERSION,
  PLUGIN_VERSION,
  PROTOCOL_VERSION,
} = require("./lib/build-info")
const { HelperClient } = require("./lib/helper-client")

const manifestPath = path.join(pluginRoot, ".anybox-plugin", "plugin.json")
const helperPath = path.join(pluginRoot, "helper", "win32-x64", "computer-use-helper.exe")
const hashPath = path.join(pluginRoot, "helper", "win32-x64", "computer-use-helper.sha256")
const csharpBuildInfoPath = path.join(
  pluginRoot,
  "helper",
  "ComputerUse.Helper",
  "BuildInfo.cs",
)
const csharpProjectPath = path.join(
  pluginRoot,
  "helper",
  "ComputerUse.Helper",
  "ComputerUse.Helper.csproj",
)

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const csharpBuildInfo = fs.readFileSync(csharpBuildInfoPath, "utf8")
const csharpProject = fs.readFileSync(csharpProjectPath, "utf8")
const csharpVersion = /HelperVersion\s*=\s*"([^"]+)"/u.exec(csharpBuildInfo)?.[1]
const csharpProtocol = Number(/ProtocolVersion\s*=\s*(\d+)/u.exec(csharpBuildInfo)?.[1])
const csharpProjectVersion = /<Version>([^<]+)<\/Version>/u.exec(csharpProject)?.[1]

assert.equal(manifest.version, PLUGIN_VERSION, "manifest and Node plugin versions differ")
assert.equal(csharpVersion, HELPER_VERSION, "C# helper and Node helper versions differ")
assert.equal(csharpProjectVersion, HELPER_VERSION, "C# project and helper versions differ")
assert.equal(csharpProtocol, PROTOCOL_VERSION, "C# helper and Node protocol versions differ")
assert.ok(fs.existsSync(helperPath), `helper executable is missing: ${helperPath}`)
assert.ok(fs.existsSync(hashPath), `helper SHA-256 file is missing: ${hashPath}`)

const expectedHash = fs.readFileSync(hashPath, "utf8").trim().split(/\s+/u)[0]?.toLowerCase()
const actualHash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(helperPath))
  .digest("hex")
assert.match(expectedHash, /^[a-f0-9]{64}$/u, "helper SHA-256 file is invalid")
assert.equal(actualHash, expectedHash, "packaged helper SHA-256 does not match")

const client = new HelperClient({ helperPath, cwd: pluginRoot })
try {
  const handshake = await client.ensureInitialized()
  const health = await client.call("health_check", {}, {
    context: {
      sessionID: "plugin-package-verification",
      turnID: "plugin-package-verification",
      toolCallID: "plugin-package-verification",
    },
  })
  assert.equal(handshake.protocolVersion, PROTOCOL_VERSION)
  assert.equal(handshake.helperVersion, HELPER_VERSION)
  assert.equal(handshake.capabilities?.uia, true)
  assert.equal(handshake.capabilities?.elementActions, true)
  assert.equal(handshake.capabilities?.physicalInputEpoch, true)
  assert.equal(handshake.capabilities?.overlay, true)
  assert.equal(handshake.capabilities?.listApps, true)
  assert.equal(handshake.capabilities?.launchApp, true)
  assert.equal(health.protocolVersion, PROTOCOL_VERSION)
  assert.equal(health.helperVersion, HELPER_VERSION)
  assert.equal(health.accessibilityBackend, "uia")
  assert.equal(health.features?.elementActions, true)
  assert.equal(health.features?.physicalInputEpoch, true)
  assert.equal(health.features?.overlay, true)
  assert.equal(health.features?.listApps, true)
  assert.equal(health.features?.launchApp, true)
  process.stdout.write(`${JSON.stringify({
    ok: true,
    pluginVersion: PLUGIN_VERSION,
    helperVersion: health.helperVersion,
    protocolVersion: health.protocolVersion,
    captureBackend: health.captureBackend,
    accessibilityBackend: health.accessibilityBackend,
    accessibilityDiagnostic: health.accessibilityDiagnostic,
    physicalInputEpoch: health.features?.physicalInputEpoch,
    physicalInputDiagnostic: health.physicalInputDiagnostic,
    overlay: health.features?.overlay,
    overlayDiagnostic: health.overlayDiagnostic,
    sha256: actualHash,
  }, null, 2)}\n`)
} finally {
  client.stop()
}
