import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  verifyComputerUseSupplyChainMetadata,
  writeComputerUseSupplyChainMetadata,
} from "./computer-use-supply-chain.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..", "..", "..")
const sourceRoot = path.join(
  repoRoot,
  "plugins",
  "Anybox-Plugins",
  "computer-use-windows",
)

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "anybox-cu-supply-chain-"))
  const files = new Map([
    ["agent-server.js", "agent bundle"],
    ["mcp/computer-use/server.js", "facade"],
    ["mcp/computer-use/package.json", "{\"type\":\"commonjs\"}\n"],
    ["mcp/computer-use/lib/tool-definitions.js", "definitions"],
    ["computer-use/win32-x64/computer-use-helper.exe", "helper fixture"],
  ])
  for (const [relativePath, content] of files) {
    const target = path.join(root, ...relativePath.split("/"))
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, content)
  }
  const helperDigest = createHash("sha256")
    .update(files.get("computer-use/win32-x64/computer-use-helper.exe"))
    .digest("hex")
  await fsp.writeFile(
    path.join(
      root,
      "computer-use",
      "win32-x64",
      "computer-use-helper.sha256",
    ),
    `${helperDigest}  computer-use-helper.exe\n`,
  )
  return root
}

test("writes and verifies Computer Use SBOM and provenance", async (context) => {
  const runtimeDir = await fixture()
  context.after(() => fsp.rm(runtimeDir, { recursive: true, force: true }))
  await writeComputerUseSupplyChainMetadata({
    runtimeDir,
    repoRoot,
    sourceRoot,
    platform: "win32",
    arch: "x64",
  })
  const result = await verifyComputerUseSupplyChainMetadata({
    runtimeDir,
    platform: "win32",
    arch: "x64",
  })
  assert.equal(result.version, "0.2.0")
  assert.equal(result.protocolVersion, 1)
  assert.equal(result.files, 6)

  const sbom = JSON.parse(await fsp.readFile(
    path.join(runtimeDir, "computer-use", "sbom.cdx.json"),
    "utf8",
  ))
  assert.equal(sbom.bomFormat, "CycloneDX")
  assert.equal(sbom.specVersion, "1.5")

  const provenance = JSON.parse(await fsp.readFile(
    path.join(runtimeDir, "computer-use", "provenance.intoto.json"),
    "utf8",
  ))
  assert.equal(provenance._type, "https://in-toto.io/Statement/v1")
  assert.equal(provenance.predicateType, "https://slsa.dev/provenance/v1")
})

test("detects artifact tampering and blocks unsigned strict releases", async (context) => {
  const runtimeDir = await fixture()
  context.after(() => fsp.rm(runtimeDir, { recursive: true, force: true }))
  await writeComputerUseSupplyChainMetadata({
    runtimeDir,
    repoRoot,
    sourceRoot,
    platform: "win32",
    arch: "x64",
  })
  await assert.rejects(
    verifyComputerUseSupplyChainMetadata({
      runtimeDir,
      platform: "win32",
      arch: "x64",
      releaseStrict: true,
    }),
    /valid Authenticode signature/,
  )

  await fsp.appendFile(
    path.join(runtimeDir, "mcp", "computer-use", "server.js"),
    "\ntampered",
  )
  await assert.rejects(
    verifyComputerUseSupplyChainMetadata({
      runtimeDir,
      platform: "win32",
      arch: "x64",
    }),
    /artifact size mismatch|artifact digest mismatch/,
  )
})
