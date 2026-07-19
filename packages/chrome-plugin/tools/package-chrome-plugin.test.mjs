import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  chromeExtensionIDFromManifestKey,
  compareChromePluginPackages,
  nativeHostBuildTarget,
  packageChromePlugin,
  validateChromePluginPackage,
} from "./package-chrome-plugin.mjs"

async function write(root, relativePath, content = relativePath) {
  const target = path.join(root, relativePath)
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await fsp.writeFile(target, content)
}

async function createFixture(projectRoot) {
  const extensionKey = Buffer.from("fixture Chrome extension public key").toString("base64")
  const extensionId = chromeExtensionIDFromManifestKey(extensionKey)
  await write(projectRoot, path.join("runtime", ".anybox-plugin", "plugin.json"), `${JSON.stringify({
    name: "chrome",
    version: "1.2.3",
    description: "Chrome fixture.",
    skills: "skills",
    skillPreviews: [
      {
        name: "Chrome",
        description: "Chrome fixture skill.",
        directory: "chrome",
      },
    ],
    mcpServers: [
      {
        id: "node-repl",
        runtime: {
          transport: "stdio",
          command: "node",
          args: ["${PLUGIN_ROOT}/scripts/node-repl-server.js"],
          cwd: "${PLUGIN_ROOT}",
          timeoutMs: 120_000,
          toolPolicies: {
            js_reset: { policy: "auto" },
            js_add_node_module_dir: { policy: "ask" },
            js: { policy: "ask" },
          },
        },
        permissions: [
          "Raw page JavaScript and Chrome DevTools Protocol are disabled.",
        ],
        installReview: [
          "Raw page JavaScript and CDP are disabled at the model command boundary.",
        ],
      },
    ],
  }, null, 2)}\n`)
  await write(
    projectRoot,
    path.join("runtime", "scripts", "extension-id.json"),
    `${JSON.stringify({
      extensionHostName: "com.anybox.browser",
      extensionId,
    }, null, 2)}\n`,
  )
  await write(
    projectRoot,
    path.join("runtime", "scripts", "installManifest.mjs"),
    "const runtimeEndpoint = process.env.ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT\n",
  )
  await write(
    projectRoot,
    path.join("runtime", "scripts", "browser-gateway-worker.js"),
    "if (value.type === \"getInfo\") {}\nconst contractVersion = value.contractVersion\n",
  )
  await write(projectRoot, path.join("runtime", "scripts", "browser-ipc-client.cjs"))
  await write(projectRoot, path.join("runtime", "scripts", "native-host-bootstrap.js"))
  await write(projectRoot, path.join("runtime", "scripts", "node-repl-server.js"))
  await write(projectRoot, path.join("runtime", "assets", "chrome.svg"), "<svg />\n")
  await write(
    projectRoot,
    path.join("runtime", "skills", "chrome", "SKILL.md"),
    "Selector-driven click/fill adapters, page JavaScript, and CDP are disabled.\n",
  )
  await write(projectRoot, "LICENSE", "MIT License\n")

  await write(projectRoot, path.join("browser-runtime", "package.json"), "{}\n")
  await write(projectRoot, path.join("browser-runtime", "src", "browser-client.ts"))
  await write(
    projectRoot,
    path.join("browser-runtime", "dist", "browser-client.mjs"),
    [
      "// generated browser runtime: disabled until Anybox can enforce command-level capability",
      "export function setupBrowserRuntime() {}",
      "const contractVersion = 1",
      "const capabilities = { arbitraryJavaScript: false, fullCdp: false }",
      "const unavailable = \"CAPABILITY_UNAVAILABLE\"",
      "",
    ].join("\n"),
  )
  await write(projectRoot, path.join("browser-extension", "package.json"), "{}\n")
  await write(projectRoot, path.join("browser-extension", "src", "background.ts"))
  await write(projectRoot, path.join("browser-extension", "tsconfig.json"), "{}\n")
  await write(
    projectRoot,
    path.join("browser-extension", "dist", "manifest.json"),
    `${JSON.stringify({ key: extensionKey })}\n`,
  )
  await write(projectRoot, path.join("browser-extension", "dist", "background.js"))
  await write(projectRoot, path.join("browser-extension", "dist", "background.js.map"))
  await write(projectRoot, path.join("browser-extension", "dist", "content.js"))
  await write(projectRoot, path.join("browser-extension", "dist", "popup.html"))
  await write(projectRoot, path.join("browser-extension", "dist", "popup.js"))
  await write(projectRoot, path.join("browser-extension", "dist", "chunks", "shared.js"))
  await write(projectRoot, path.join("browser-extension", "dist", "chunks", "shared.js.map"))

  await write(projectRoot, path.join("browser-native-host", "package.json"), "{}\n")
  await write(projectRoot, path.join("browser-native-host", "src", "main.rs"))
  const nativeHostTarget = nativeHostBuildTarget()
  await write(
    projectRoot,
    path.join(
      "browser-native-host",
      "dist",
      nativeHostTarget.platformDirectory,
      nativeHostTarget.architectureDirectory,
      nativeHostTarget.executableName,
    ),
  )
  await write(projectRoot, path.join("tools", "package-chrome-plugin.mjs"))
  await write(projectRoot, "README.md")
}

test("derives the stable Anybox extension ID from its manifest key", async () => {
  const manifest = JSON.parse(await fsp.readFile(
    path.join(
      import.meta.dirname,
      "..",
      "browser-extension",
      "public",
      "manifest.json",
    ),
    "utf8",
  ))
  assert.equal(
    chromeExtensionIDFromManifestKey(manifest.key),
    "hjbejdmgpifdjjlpgmdfmbmbhkedgnjc",
  )
})

test("synchronizes only installable Chrome files into the distribution directory", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "anybox-chrome-package-"))
  const projectRoot = path.join(tempRoot, "packages", "chrome-plugin")
  const pluginRoot = path.join(tempRoot, "plugins", "Anybox-Plugins", "chrome")

  try {
    await createFixture(projectRoot)
    const result = await packageChromePlugin({ projectRoot, pluginRoot })
    const validation = await validateChromePluginPackage(pluginRoot)
    const files = validation.files.map((entry) => entry.split(path.sep).join("/"))

    assert.deepEqual(files, [
      ".anybox-plugin/plugin.json",
      "assets/chrome.svg",
      "browser-extension/background.js",
      "browser-extension/chunks/shared.js",
      "browser-extension/content.js",
      "browser-extension/manifest.json",
      "browser-extension/popup.html",
      "browser-extension/popup.js",
      nativeHostBuildTarget().packagePath.split(path.sep).join("/"),
      "LICENSE",
      "scripts/browser-client.mjs",
      "scripts/browser-gateway-worker.js",
      "scripts/browser-ipc-client.cjs",
      "scripts/extension-id.json",
      "scripts/installManifest.mjs",
      "scripts/native-host-bootstrap.js",
      "scripts/node-repl-server.js",
      "skills/chrome/SKILL.md",
    ])
    assert.equal(result.version, "1.2.3")
    assert.equal(files.some((entry) => entry.endsWith(".map")), false)
    assert.equal(files.some((entry) => entry.includes("/src/")), false)
    assert.equal(files.some((entry) => entry.startsWith("browser-native-host/")), false)
    assert.equal(files.some((entry) => entry.endsWith("package.json")), false)
    assert.equal(files.some((entry) => entry.toLowerCase().includes("readme")), false)
    assert.equal(
      await fsp.readFile(path.join(pluginRoot, "scripts", "browser-client.mjs"), "utf8"),
      [
        "// generated browser runtime: disabled until Anybox can enforce command-level capability",
        "export function setupBrowserRuntime() {}",
        "const contractVersion = 1",
        "const capabilities = { arbitraryJavaScript: false, fullCdp: false }",
        "const unavailable = \"CAPABILITY_UNAVAILABLE\"",
        "",
      ].join("\n"),
    )
    assert.equal(
      await fsp.readFile(path.join(pluginRoot, "scripts", "installManifest.mjs"), "utf8"),
      "const runtimeEndpoint = process.env.ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT\n",
    )

    const manifest = JSON.parse(
      await fsp.readFile(path.join(pluginRoot, ".anybox-plugin", "plugin.json"), "utf8"),
    )
    assert.equal(manifest.package, undefined)
    assert.equal(manifest.skillPreviews.length, 1)
    assert.equal(
      await fsp.readFile(path.join(projectRoot, "browser-native-host", "src", "main.rs"), "utf8"),
      path.join("browser-native-host", "src", "main.rs"),
    )
    assert.equal(
      await fsp.readFile(path.join(projectRoot, "browser-runtime", "src", "browser-client.ts"), "utf8"),
      path.join("browser-runtime", "src", "browser-client.ts"),
    )

    await packageChromePlugin({ projectRoot, pluginRoot, check: true })
    assert.deepEqual(await compareChromePluginPackages(pluginRoot, pluginRoot), [])
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test("check mode reports a stale tracked plugin without overwriting it", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "anybox-chrome-package-check-"))
  const projectRoot = path.join(tempRoot, "packages", "chrome-plugin")
  const pluginRoot = path.join(tempRoot, "plugins", "Anybox-Plugins", "chrome")

  try {
    await createFixture(projectRoot)
    await packageChromePlugin({ projectRoot, pluginRoot })
    await fsp.writeFile(path.join(pluginRoot, "scripts", "node-repl-server.js"), "stale\n")

    await assert.rejects(
      packageChromePlugin({ projectRoot, pluginRoot, check: true }),
      /changed: scripts\/node-repl-server\.js/,
    )
    assert.equal(
      await fsp.readFile(path.join(pluginRoot, "scripts", "node-repl-server.js"), "utf8"),
      "stale\n",
    )
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test("rejects capability claims that re-enable raw page JavaScript or CDP", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "anybox-chrome-capability-"))
  const projectRoot = path.join(tempRoot, "packages", "chrome-plugin")
  const pluginRoot = path.join(tempRoot, "plugins", "Anybox-Plugins", "chrome")

  try {
    await createFixture(projectRoot)
    await packageChromePlugin({ projectRoot, pluginRoot })
    const manifestPath = path.join(pluginRoot, ".anybox-plugin", "plugin.json")
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
    manifest.mcpServers[0].permissions = [
      "Allows raw page JavaScript and Chrome DevTools Protocol commands.",
    ]
    await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /capability claims must state that raw page JavaScript and CDP are disabled/,
    )
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test("rejects a Chrome manifest that removes its required node-repl server", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "anybox-chrome-mcp-"))
  const projectRoot = path.join(tempRoot, "packages", "chrome-plugin")
  const pluginRoot = path.join(tempRoot, "plugins", "Anybox-Plugins", "chrome")

  try {
    await createFixture(projectRoot)
    await packageChromePlugin({ projectRoot, pluginRoot })
    const manifestPath = path.join(pluginRoot, ".anybox-plugin", "plugin.json")
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
    delete manifest.mcpServers
    await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /must declare exactly one 'node-repl' MCP server/,
    )
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test("rejects a Chrome manifest without its required description", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "anybox-chrome-description-"))
  const projectRoot = path.join(tempRoot, "packages", "chrome-plugin")
  const pluginRoot = path.join(tempRoot, "plugins", "Anybox-Plugins", "chrome")

  try {
    await createFixture(projectRoot)
    await packageChromePlugin({ projectRoot, pluginRoot })
    const manifestPath = path.join(pluginRoot, ".anybox-plugin", "plugin.json")
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
    delete manifest.description
    await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /must describe a versioned 'chrome' plugin/,
    )
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test("rejects a Chrome node-repl server without its packaged runtime", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "anybox-chrome-mcp-runtime-"))
  const projectRoot = path.join(tempRoot, "packages", "chrome-plugin")
  const pluginRoot = path.join(tempRoot, "plugins", "Anybox-Plugins", "chrome")

  try {
    await createFixture(projectRoot)
    await packageChromePlugin({ projectRoot, pluginRoot })
    const manifestPath = path.join(pluginRoot, ".anybox-plugin", "plugin.json")
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
    delete manifest.mcpServers[0].runtime
    await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /node-repl MCP server must declare its packaged stdio runtime/,
    )
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test("rejects a browser gateway Worker that reintroduces a Browser API allowlist", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "anybox-chrome-worker-policy-"))
  const projectRoot = path.join(tempRoot, "packages", "chrome-plugin")
  const pluginRoot = path.join(tempRoot, "plugins", "Anybox-Plugins", "chrome")

  try {
    await createFixture(projectRoot)
    await packageChromePlugin({ projectRoot, pluginRoot })
    await fsp.appendFile(
      path.join(pluginRoot, "scripts", "browser-gateway-worker.js"),
      "const SAFE_BROWSER_METHODS = new Set()\n",
    )

    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /must remain a contract-aware transport adapter without a Browser API method allowlist/,
    )
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test("rejects a generated package that exceeds the GitHub Tree install limit", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "anybox-chrome-package-size-"))
  const projectRoot = path.join(tempRoot, "packages", "chrome-plugin")
  const pluginRoot = path.join(tempRoot, "plugins", "Anybox-Plugins", "chrome")

  try {
    await createFixture(projectRoot)
    await packageChromePlugin({ projectRoot, pluginRoot })
    await fsp.writeFile(
      path.join(pluginRoot, "assets", "oversized.bin"),
      Buffer.alloc(5 * 1024 * 1024),
    )
    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /GitHub Tree installs are limited/,
    )
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})
