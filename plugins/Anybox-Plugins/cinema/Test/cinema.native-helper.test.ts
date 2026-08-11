import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  configureNativeHelper,
  nativeHelperPath,
  resetNativeHelperConfigurationForTest,
} from "../src/platform/native-helper.ts"

const roots: string[] = []

afterEach(async () => {
  resetNativeHelperConfigurationForTest()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function helperFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cinema-helper-config-"))
  roots.push(root)
  const helperPath = path.join(root, process.platform === "win32" ? "helper.exe" : "helper")
  const bytes = Buffer.from("managed-cinema-helper")
  await writeFile(helperPath, bytes)
  return {
    helperPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
}

function artifactsJSON(helperPath: string, sha256: string) {
  return JSON.stringify({
    "cinema-platform-helper": {
      type: "app-runtime-helper",
      path: helperPath,
      sha256,
    },
  })
}

describe("Cinema managed native helper", () => {
  test("accepts only the absolute Anybox-managed path after SHA-256 verification", async () => {
    const fixture = await helperFixture()
    await expect(configureNativeHelper({
      mode: "anybox",
      artifactsJSON: artifactsJSON(fixture.helperPath, fixture.sha256),
    })).resolves.toBe(path.resolve(fixture.helperPath))
    expect(nativeHelperPath()).toBe(path.resolve(fixture.helperPath))
  })

  test("fails closed for missing, incomplete, or tampered managed metadata", async () => {
    const fixture = await helperFixture()
    await expect(configureNativeHelper({ mode: "anybox" }))
      .rejects.toMatchObject({ code: "NATIVE_HELPER_CONFIGURATION_INVALID" })
    await expect(configureNativeHelper({
      mode: "anybox",
      artifactsJSON: JSON.stringify({
        "cinema-platform-helper": { path: fixture.helperPath, sha256: fixture.sha256 },
      }),
    })).rejects.toMatchObject({ code: "NATIVE_HELPER_CONFIGURATION_INVALID" })
    await expect(configureNativeHelper({
      mode: "anybox",
      artifactsJSON: artifactsJSON(fixture.helperPath, "0".repeat(64)),
    })).rejects.toMatchObject({ code: "NATIVE_HELPER_CONFIGURATION_INVALID" })
    expect(() => nativeHelperPath()).toThrow("not configured")
  })
})
