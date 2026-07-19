import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  BROWSER_IPC_PROTOCOL_VERSION,
  install,
  nativeMessagingManifest,
  resolveBrowserIpcRuntimeConfig,
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

test("derives secret-free Named Pipe and Unix Domain Socket locators", () => {
  const windows = resolveBrowserIpcRuntimeConfig({
    env: {},
    homeDir: "C:\\Users\\test",
    platform: "win32",
  })
  assert.equal(windows.transport, "windows-named-pipe")
  assert.equal(windows.protocolVersion, BROWSER_IPC_PROTOCOL_VERSION)
  assert.match(windows.runtimeEndpoint, /^\\\\\.\\pipe\\anybox-browser-runtime-v1-/)
  assert.match(windows.nativeHostEndpoint, /^\\\\\.\\pipe\\anybox-browser-native-host-v1-/)
  assert.equal(
    windows.bootstrapPath,
    path.resolve(
      "C:\\Users\\test",
      ".local",
      "state",
      "anybox",
      "browser-ipc",
      "com.anybox.browser.bootstrap.json",
    ),
  )

  const linux = resolveBrowserIpcRuntimeConfig({
    env: { XDG_STATE_HOME: "/tmp/anybox-state" },
    homeDir: "/home/test",
    platform: "linux",
  })
  assert.equal(linux.transport, "unix-domain-socket")
  assert.equal(linux.protocolVersion, BROWSER_IPC_PROTOCOL_VERSION)
  assert.match(linux.runtimeEndpoint, /runtime-v1-[a-f0-9]{16}\.sock$/)
  assert.match(linux.nativeHostEndpoint, /native-host-v1-[a-f0-9]{16}\.sock$/)
  assert.match(
    linux.bootstrapPath,
    /com\.anybox\.browser\.bootstrap\.json$/,
  )
})

test("validates explicitly injected IPC locators", () => {
  assert.deepEqual(
    resolveBrowserIpcRuntimeConfig({
      env: {
        ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT: "\\\\.\\pipe\\runtime-test",
        ANYBOX_BROWSER_IPC_NATIVE_ENDPOINT: "\\\\.\\pipe\\native-test",
        ANYBOX_BROWSER_IPC_BOOTSTRAP_PATH: "C:\\state\\bootstrap.json",
      },
      homeDir: "C:\\Users\\test",
      platform: "win32",
    }),
    {
      transport: "windows-named-pipe",
      protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
      runtimeEndpoint: "\\\\.\\pipe\\runtime-test",
      nativeHostEndpoint: "\\\\.\\pipe\\native-test",
      bootstrapPath: path.resolve("C:\\state\\bootstrap.json"),
    },
  )
  assert.throws(
    () => resolveBrowserIpcRuntimeConfig({
      env: { ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT: "http://127.0.0.1:4096" },
      homeDir: "C:\\Users\\test",
      platform: "win32",
    }),
    /must be a Windows Named Pipe path/,
  )
  assert.throws(
    () => resolveBrowserIpcRuntimeConfig({
      env: { ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT: "\\\\.\\pipe\\runtime\r\nforged" },
      homeDir: "C:\\Users\\test",
      platform: "win32",
    }),
    /contains an invalid character/,
  )
  assert.throws(
    () => resolveBrowserIpcRuntimeConfig({
      env: { ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT: "relative.sock" },
      homeDir: "/home/test",
      platform: "linux",
    }),
    /must be an absolute Unix Domain Socket path/,
  )
})

test("installs a plugin-owned Windows host and replaces legacy token config", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "anybox-native-host-install-"))
  const pluginRoot = path.join(tempRoot, "plugin")
  const appData = path.join(tempRoot, "AppData", "Roaming")
  const hostPath = await createPluginFixture(pluginRoot)
  const registryCalls = []
  const runtimeEndpoint = "\\\\.\\pipe\\runtime-install-test"
  const nativeHostEndpoint = "\\\\.\\pipe\\native-install-test"
  const bootstrapPath = path.join(tempRoot, "state", "bootstrap.json")

  try {
    const paths = resolveNativeMessagingPaths({
      env: { APPDATA: appData },
      extensionHostName: "com.anybox.browser",
      homeDir: path.join(tempRoot, "home"),
      platform: "win32",
    })
    await fsp.mkdir(path.dirname(paths.runtimeConfigPath), { recursive: true })
    await fsp.writeFile(paths.runtimeConfigPath, JSON.stringify({
      agentBaseURL: "http://127.0.0.1:4096",
      browserTransportToken: "obsolete-long-lived-token",
    }))

    const result = await install({
      architecture: "x64",
      env: {
        APPDATA: appData,
        ANYBOX_AGENT_BASE_URL: "http://127.0.0.1:4567",
        ANYBOX_BROWSER_TRANSPORT_TOKEN: "must-not-be-persisted",
        ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT: runtimeEndpoint,
        ANYBOX_BROWSER_IPC_NATIVE_ENDPOINT: nativeHostEndpoint,
        ANYBOX_BROWSER_IPC_BOOTSTRAP_PATH: bootstrapPath,
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
    assert.deepEqual(
      {
        transport: runtimeConfig.transport,
        protocolVersion: runtimeConfig.protocolVersion,
        runtimeEndpoint: runtimeConfig.runtimeEndpoint,
        nativeHostEndpoint: runtimeConfig.nativeHostEndpoint,
        bootstrapPath: runtimeConfig.bootstrapPath,
      },
      {
        transport: "windows-named-pipe",
        protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
        runtimeEndpoint,
        nativeHostEndpoint,
        bootstrapPath: path.resolve(bootstrapPath),
      },
    )
    assert.equal(typeof runtimeConfig.updatedAt, "string")
    assert.equal(runtimeConfig.agentBaseURL, undefined)
    assert.equal(runtimeConfig.browserTransportToken, undefined)
    assert.equal(JSON.stringify(runtimeConfig).includes("must-not-be-persisted"), false)
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
