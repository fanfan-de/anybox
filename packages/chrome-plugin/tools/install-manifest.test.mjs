import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  install,
  nativeMessagingManifest,
  resolveAgentBaseURL,
  resolveBundledExtensionHost,
  resolveNativeMessagingPaths,
} from "../runtime/scripts/installManifest.mjs"

async function createPluginFixture(root) {
  const hostPath = path.join(
    root,
    "extension-host",
    "windows",
    "x64",
    "extension-host.exe",
  )
  await fsp.mkdir(path.dirname(hostPath), { recursive: true })
  await fsp.writeFile(hostPath, "native-host")
  await fsp.mkdir(path.join(root, "scripts"), { recursive: true })
  await fsp.writeFile(
    path.join(root, "scripts", "extension-id.json"),
    `${JSON.stringify({
      extensionId: "hjbejdmgpifdjjlpgmdfmbmbhkedgnjc",
      extensionHostName: "com.anybox.browser",
    }, null, 2)}\n`,
  )
  return hostPath
}

test("resolves the Codex-style platform host path", () => {
  assert.equal(
    resolveBundledExtensionHost("C:\\plugin", "win32", "x64"),
    path.resolve("C:\\plugin", "extension-host", "windows", "x64", "extension-host.exe"),
  )
  assert.throws(
    () => resolveBundledExtensionHost("C:\\plugin", "win32", "ia32"),
    /Unsupported Native Messaging Host target/,
  )
})

test("builds a Chrome Native Messaging manifest", () => {
  assert.deepEqual(
    nativeMessagingManifest({
      extensionHostName: "com.anybox.browser",
      extensionHostPath: "C:\\plugin\\extension-host.exe",
      extensionId: "hjbejdmgpifdjjlpgmdfmbmbhkedgnjc",
    }),
    {
      allowed_origins: ["chrome-extension://hjbejdmgpifdjjlpgmdfmbmbhkedgnjc/"],
      description: "Anybox Chrome Native Messaging Host",
      name: "com.anybox.browser",
      path: path.resolve("C:\\plugin\\extension-host.exe"),
      type: "stdio",
    },
  )
})

test("derives the Anybox Agent URL from the runtime environment", () => {
  assert.equal(
    resolveAgentBaseURL({
      ANYBOX_SERVER_HOST: "127.0.0.1",
      ANYBOX_SERVER_PORT: "4567",
    }),
    "http://127.0.0.1:4567",
  )
  assert.throws(
    () => resolveAgentBaseURL({ ANYBOX_AGENT_BASE_URL: "https://example.com" }),
    /must use local HTTP/,
  )
})

test("installs a plugin-owned Windows Native Messaging host", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "anybox-native-host-install-"))
  const pluginRoot = path.join(tempRoot, "plugin")
  const appData = path.join(tempRoot, "AppData", "Roaming")
  const hostPath = await createPluginFixture(pluginRoot)
  const registryCalls = []

  try {
    const result = await install({
      architecture: "x64",
      env: {
        APPDATA: appData,
        ANYBOX_AGENT_BASE_URL: "http://127.0.0.1:4567",
      },
      homeDir: path.join(tempRoot, "home"),
      platform: "win32",
      pluginRoot,
      registerWindowsHost: async (input) => {
        registryCalls.push(input)
        return `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${input.extensionHostName}`
      },
    })

    const manifestPath = path.join(
      appData,
      "Anybox",
      "native-messaging",
      "com.anybox.browser.json",
    )
    assert.equal(result.extensionHostPath, hostPath)
    assert.deepEqual(result.manifestPaths, [manifestPath])
    assert.deepEqual(registryCalls, [{
      extensionHostName: "com.anybox.browser",
      manifestPath,
    }])

    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
    assert.equal(manifest.path, hostPath)
    assert.deepEqual(manifest.allowed_origins, [
      "chrome-extension://hjbejdmgpifdjjlpgmdfmbmbhkedgnjc/",
    ])

    const runtimeConfig = JSON.parse(await fsp.readFile(result.runtimeConfigPath, "utf8"))
    assert.equal(runtimeConfig.agentBaseURL, "http://127.0.0.1:4567")
    assert.equal(typeof runtimeConfig.updatedAt, "string")
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test("uses Chrome's manifest directory and Anybox's config directory on macOS", () => {
  const paths = resolveNativeMessagingPaths({
    env: {},
    extensionHostName: "com.anybox.browser",
    homeDir: "/Users/test",
    platform: "darwin",
  })
  assert.equal(
    paths.manifestPaths[0],
    path.resolve(
      "/Users/test",
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "NativeMessagingHosts",
      "com.anybox.browser.json",
    ),
  )
  assert.equal(
    paths.runtimeConfigPath,
    path.resolve(
      "/Users/test",
      "Library",
      "Application Support",
      "Anybox",
      "native-messaging",
      "com.anybox.browser.runtime.json",
    ),
  )
})
