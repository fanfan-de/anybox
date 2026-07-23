import assert from "node:assert/strict"
import test from "node:test"
import {
  inspectPeArchitecture,
  parseReleaseArgs,
  resolveMacosSigningOptions,
  validateCodesignDetails,
  validateNotaryResult,
  validatePeEmbeddedVersion,
} from "./release-chrome-plugin.mjs"

function pe(machine = 0x8664, version = "0.15.1") {
  const bytes = Buffer.alloc(0x100)
  bytes.write("MZ", 0, "ascii")
  bytes.writeUInt32LE(0x80, 0x3c)
  bytes.write("PE\0\0", 0x80, "ascii")
  bytes.writeUInt16LE(machine, 0x84)
  bytes.write(version, 0x90, "ascii")
  return bytes
}

test("accepts only a PE x64 Windows handoff artifact", () => {
  assert.equal(inspectPeArchitecture(pe()), "x64")
  assert.throws(() => inspectPeArchitecture(pe(0xaa64)), /must be PE x64/)
  assert.throws(() => inspectPeArchitecture(Buffer.from("not-pe")), /valid PE/)
})

test("accepts only a Windows handoff built from the current plugin version", () => {
  assert.equal(validatePeEmbeddedVersion(pe(), "0.15.1"), "0.15.1")
  assert.throws(
    () => validatePeEmbeddedVersion(pe(0x8664, "0.15.0"), "0.15.1"),
    /does not embed the expected plugin version 0\.15\.1/,
  )
})

test("parses explicit Developer ID signing without accepting plaintext credentials", () => {
  assert.deepEqual(parseReleaseArgs([
    "--windows-host",
    "/tmp/extension-host.exe",
    "--macos-signing",
    "developer-id",
    "--codesign-identity",
    "Developer ID Application: Example",
    "--notary-profile",
    "anybox-notary",
  ]), {
    windowsHost: "/tmp/extension-host.exe",
    macosSigning: "developer-id",
    codesignIdentity: "Developer ID Application: Example",
    notaryProfile: "anybox-notary",
  })
  assert.throws(
    () => parseReleaseArgs(["--password", "secret"]),
    /not accepted/,
  )
  assert.throws(
    () => parseReleaseArgs(["--apple-id=user@example.com"]),
    /not accepted/,
  )
})

test("requires an explicit, internally consistent macOS signing mode", () => {
  assert.deepEqual(resolveMacosSigningOptions({
    macosSigning: "ad-hoc",
  }), {
    identity: "-",
    mode: "ad-hoc",
    notaryProfile: undefined,
  })
  assert.deepEqual(resolveMacosSigningOptions({
    macosSigning: "developer-id",
    codesignIdentity: "Developer ID Application: Example",
    notaryProfile: "anybox-notary",
  }), {
    identity: "Developer ID Application: Example",
    mode: "developer-id",
    notaryProfile: "anybox-notary",
  })
  assert.throws(
    () => resolveMacosSigningOptions(),
    /--macos-signing is required/,
  )
  assert.throws(
    () => resolveMacosSigningOptions({ macosSigning: "unsigned" }),
    /must be one of: ad-hoc, developer-id/,
  )
  assert.throws(
    () => resolveMacosSigningOptions({
      macosSigning: "ad-hoc",
      codesignIdentity: "Developer ID Application: Example",
    }),
    /does not accept/,
  )
  assert.throws(
    () => resolveMacosSigningOptions({
      macosSigning: "developer-id",
    }),
    /--codesign-identity is required/,
  )
})

test("requires Developer ID, hardened runtime, and secure timestamp details", () => {
  const valid = [
    "Authority=Developer ID Application: Example, Inc. (ABCDE12345)",
    "CodeDirectory v=20500 size=3352 flags=0x10000(runtime) hashes=13+2 location=embedded",
    "Timestamp=Jul 23, 2026 at 12:00:00",
  ].join("\n")
  assert.doesNotThrow(() =>
    validateCodesignDetails(valid, "developer-id")
  )
  assert.throws(
    () => validateCodesignDetails(
      valid.replace("Developer ID Application", "Apple Development"),
      "developer-id",
    ),
    /Developer ID Application/,
  )
  assert.throws(
    () => validateCodesignDetails(
      valid.replace("(runtime)", ""),
      "developer-id",
    ),
    /hardened runtime/,
  )
  assert.throws(
    () => validateCodesignDetails(
      valid.replace(/^Timestamp=.*$/mu, ""),
      "developer-id",
    ),
    /secure timestamp/,
  )
  assert.throws(
    () => validateCodesignDetails(
      valid.replace(/^Timestamp=.*$/mu, "Timestamp=none"),
      "developer-id",
    ),
    /secure timestamp/,
  )
})

test("requires an ad-hoc signature with hardened runtime in ad-hoc mode", () => {
  const valid = [
    "Signature=adhoc",
    "CodeDirectory v=20500 size=3352 flags=0x10002(adhoc,runtime) hashes=13+2 location=embedded",
    "Timestamp=none",
  ].join("\n")
  assert.doesNotThrow(() => validateCodesignDetails(valid, "ad-hoc"))
  assert.throws(
    () => validateCodesignDetails(
      valid.replace("adhoc,runtime", "runtime"),
      "ad-hoc",
    ),
    /not ad-hoc signed/,
  )
  assert.throws(
    () => validateCodesignDetails(valid.replace("runtime", ""), "ad-hoc"),
    /hardened runtime/,
  )
  assert.throws(
    () => validateCodesignDetails(valid, "unsigned"),
    /Unsupported macOS signing mode/,
  )
})

test("accepts only an Accepted notarytool response", () => {
  assert.deepEqual(
    validateNotaryResult(JSON.stringify({ id: "submission", status: "Accepted" })),
    { id: "submission", status: "Accepted" },
  )
  assert.throws(
    () => validateNotaryResult(JSON.stringify({ status: "Invalid" })),
    /not accepted/,
  )
  assert.throws(() => validateNotaryResult("not-json"), /valid JSON/)
})
