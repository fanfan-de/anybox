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

const declaredNativeHostTargets = [
  nativeHostBuildTarget("win32", "x64"),
  nativeHostBuildTarget("darwin", "x64"),
  nativeHostBuildTarget("darwin", "arm64"),
]

async function write(root, relativePath, content = relativePath) {
  const target = path.join(root, relativePath)
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await fsp.writeFile(target, content)
}

async function createFixture(projectRoot) {
  const extensionKey = Buffer.from("fixture Chrome extension public key").toString("base64")
  const extensionId = chromeExtensionIDFromManifestKey(extensionKey)
  await write(
    projectRoot,
    path.join("runtime", ".anybox-plugin", "plugin.json"),
    `${JSON.stringify({
      name: "chrome",
      version: "1.2.3",
      description: "Chrome fixture.",
      skills: "skills",
      skillPreviews: [{
        name: "Chrome",
        description: "Chrome fixture skill.",
        directory: "chrome",
      }],
      mcpRequirements: [{
        mcp: "node-repl",
        tools: ["js", "js_reset", "js_add_node_module_dir"],
        permissions: [
          "Raw page JavaScript and Chrome DevTools Protocol are disabled.",
        ],
        required: true,
        reason: "Import the Browser Client in Anybox Node REPL.",
      }],
      platformArtifacts: [{
        id: "chrome-native-host",
        type: "chrome-native-messaging-host",
        hostName: "com.anybox.browser",
        extensionIDs: [extensionId],
        executables: declaredNativeHostTargets.map((target) => ({
          platform: target.platform,
          architecture: target.architecture,
          path: target.packagePath.split(path.sep).join("/"),
        })),
      }],
    }, null, 2)}\n`,
  )
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
    "const state = process.env.ANYBOX_AGENT_DATA_DIR\n",
  )
  await write(
    projectRoot,
    path.join("runtime", "scripts", "native-host-bootstrap.js"),
    "function ensureNativeMessagingHost() {}\nmodule.exports = { ensureNativeMessagingHost }\n",
  )
  await write(projectRoot, path.join("runtime", "assets", "chrome.svg"), "<svg />\n")
  await write(
    projectRoot,
    path.join("runtime", "skills", "chrome", "SKILL.md"),
    [
      "Structured locators are available only when advertised. Raw page JavaScript and unrestricted CDP are disabled.",
      "Use mcp__anybox_node_repl__js.",
      "Import scripts/browser-client.mjs with pathToFileURL.",
      "Reload when globalThis.setupBrowserRuntime !== setupBrowserRuntime.",
      "Call agent.browsers.ensureReady({ launch: true }) before selecting Chrome.",
      "",
    ].join("\n"),
  )
  await write(projectRoot, "LICENSE", "MIT License\n")

  await write(projectRoot, path.join("browser-runtime", "package.json"), "{}\n")
  await write(projectRoot, path.join("browser-runtime", "src", "browser-client.ts"))
  await write(
    projectRoot,
    path.join("browser-runtime", "dist", "browser-client.mjs"),
    [
      "export function setupBrowserRuntime() {}",
      "new URL('./browser-host.mjs', import.meta.url)",
      "new URL('./native-host-bootstrap.js', import.meta.url)",
      "const contractVersion = 3",
      "const capabilities = { arbitraryJavaScript: false, fullCdp: false }",
      "const locatorMethods = ['playwright.locator.click', 'playwright.locator.fill']",
      "const unavailable = 'CAPABILITY_UNAVAILABLE'",
      "const readinessState = 'needs-extension'",
      "",
    ].join("\n"),
  )
  await write(projectRoot, path.join("browser-host", "package.json"), "{}\n")
  await write(projectRoot, path.join("browser-host", "src", "main.ts"))
  await write(
    projectRoot,
    path.join("browser-host", "dist", "browser-host.mjs"),
    "const boundary = 'Browser Host runtime.request'\n",
  )
  await write(
    projectRoot,
    path.join("browser-host", "dist", "ipc-listener-sidecar.mjs"),
    "const sidecar = true\n",
  )
  await write(projectRoot, path.join("browser-extension", "package.json"), "{}\n")
  await write(projectRoot, path.join("browser-extension", "src", "background.ts"))
  await write(projectRoot, path.join("browser-extension", "tsconfig.json"), "{}\n")
  await write(
    projectRoot,
    path.join("browser-extension", "dist", "manifest.json"),
    `${JSON.stringify({ key: extensionKey })}\n`,
  )
  for (const file of [
    "background.js",
    "content.js",
    "popup.html",
    "popup.js",
    path.join("chunks", "shared.js"),
  ]) {
    await write(projectRoot, path.join("browser-extension", "dist", file))
  }
  for (const file of [
    "locator-engine.js",
    "locator-engine.metadata.json",
    "THIRD_PARTY_NOTICES.md",
    path.join("licenses", "playwright-LICENSE.txt"),
    path.join("licenses", "playwright-NOTICE.txt"),
  ]) {
    await write(
      projectRoot,
      path.join("browser-extension", "dist", file),
      await fsp.readFile(path.join(
        import.meta.dirname,
        "..",
        "browser-extension",
        "public",
        file,
      )),
    )
  }
  await write(projectRoot, path.join("browser-extension", "dist", "background.js.map"))

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
}

async function createAllNativeHostBuilds(projectRoot) {
  for (const target of declaredNativeHostTargets) {
    await write(
      projectRoot,
      path.join(
        "browser-native-host",
        "dist",
        target.platformDirectory,
        target.architectureDirectory,
        target.executableName,
      ),
      `${target.platform}/${target.architecture}\n`,
    )
  }
}

async function withFixture(prefix, run) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), prefix))
  const projectRoot = path.join(tempRoot, "packages", "chrome-plugin")
  const pluginRoot = path.join(tempRoot, "plugins", "Anybox-Plugins", "chrome")
  try {
    await createFixture(projectRoot)
    await run({ projectRoot, pluginRoot })
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
}

test("derives the stable Anybox extension ID from its manifest key", async () => {
  const manifest = JSON.parse(await fsp.readFile(
    path.join(import.meta.dirname, "..", "browser-extension", "public", "manifest.json"),
    "utf8",
  ))
  assert.equal(
    chromeExtensionIDFromManifestKey(manifest.key),
    "mgpdddgemohfmonbnpehohhlbndakdpg",
  )
})

test("synchronizes only installable Chrome files into the distribution directory", async () => {
  await withFixture("anybox-chrome-package-", async ({ projectRoot, pluginRoot }) => {
    await createAllNativeHostBuilds(projectRoot)
    const result = await packageChromePlugin({
      projectRoot,
      pluginRoot,
      nativeHostScope: "all",
    })
    const validation = await validateChromePluginPackage(pluginRoot, {
      nativeHostScope: "all",
    })
    const files = validation.files.map((entry) => entry.split(path.sep).join("/"))

    assert.deepEqual(files, [
      ".anybox-plugin/plugin.json",
      "assets/chrome.svg",
      "browser-extension/background.js",
      "browser-extension/chunks/shared.js",
      "browser-extension/content.js",
      "browser-extension/licenses/playwright-LICENSE.txt",
      "browser-extension/licenses/playwright-NOTICE.txt",
      "browser-extension/locator-engine.js",
      "browser-extension/locator-engine.metadata.json",
      "browser-extension/manifest.json",
      "browser-extension/popup.html",
      "browser-extension/popup.js",
      "browser-extension/THIRD_PARTY_NOTICES.md",
      ...declaredNativeHostTargets
        .map((target) => target.packagePath.split(path.sep).join("/"))
        .sort(),
      "LICENSE",
      "scripts/browser-client.mjs",
      "scripts/browser-host.mjs",
      "scripts/extension-id.json",
      "scripts/installManifest.mjs",
      "scripts/ipc-listener-sidecar.mjs",
      "scripts/native-host-bootstrap.js",
      "skills/chrome/SKILL.md",
    ])
    assert.equal(result.version, "1.2.3")
    assert.equal(files.some((entry) => entry.endsWith(".map")), false)
    assert.equal(files.some((entry) => entry.includes("node-repl-server")), false)
    assert.equal(files.some((entry) => entry.includes("browser-gateway-worker")), false)
    assert.equal(files.some((entry) => entry.includes("browser-ipc-client")), false)

    const manifest = JSON.parse(
      await fsp.readFile(path.join(pluginRoot, ".anybox-plugin", "plugin.json"), "utf8"),
    )
    assert.equal(manifest.mcpServers, undefined)
    assert.equal(manifest.mcpRequirements[0].mcp, "node-repl")
    await packageChromePlugin({
      projectRoot,
      pluginRoot,
      check: true,
      nativeHostScope: "all",
    })
    assert.deepEqual(await compareChromePluginPackages(pluginRoot, pluginRoot), [])
  })
})

test("assembles and validates every declared Native Host target", async () => {
  await withFixture("anybox-chrome-portable-package-", async ({ projectRoot, pluginRoot }) => {
    await createAllNativeHostBuilds(projectRoot)
    const result = await packageChromePlugin({
      projectRoot,
      pluginRoot,
      nativeHostScope: "all",
    })
    const validation = await validateChromePluginPackage(pluginRoot, {
      nativeHostScope: "all",
    })
    const files = new Set(
      validation.files.map((entry) => entry.split(path.sep).join("/")),
    )

    assert.equal(result.nativeHostScope, "all")
    for (const target of declaredNativeHostTargets) {
      assert.equal(
        files.has(target.packagePath.split(path.sep).join("/")),
        true,
      )
    }
  })
})

test("strict validation rejects a package missing any declared Native Host", async () => {
  await withFixture("anybox-chrome-incomplete-package-", async ({ projectRoot, pluginRoot }) => {
    await createAllNativeHostBuilds(projectRoot)
    await packageChromePlugin({
      projectRoot,
      pluginRoot,
      nativeHostScope: "all",
    })
    await fsp.rm(path.join(pluginRoot, declaredNativeHostTargets[0].packagePath))
    await assert.rejects(
      validateChromePluginPackage(pluginRoot, { nativeHostScope: "all" }),
      /missing Native Messaging Host for/,
    )
  })
})

test("strictly validates the targets actually declared by the manifest", async () => {
  await withFixture("anybox-chrome-declared-targets-", async ({ projectRoot, pluginRoot }) => {
    await createAllNativeHostBuilds(projectRoot)
    await packageChromePlugin({
      projectRoot,
      pluginRoot,
      nativeHostScope: "all",
    })
    const manifestPath = path.join(pluginRoot, ".anybox-plugin", "plugin.json")
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
    const removed = manifest.platformArtifacts[0].executables.pop()
    await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await fsp.rm(path.join(pluginRoot, removed.path))

    const result = await validateChromePluginPackage(pluginRoot, {
      nativeHostScope: "all",
    })
    assert.equal(
      result.files.some((entry) =>
        entry.split(path.sep).join("/") === removed.path
      ),
      false,
    )
  })
})

test("rejects duplicate Native Host targets", async () => {
  await withFixture("anybox-chrome-duplicate-target-", async ({ projectRoot, pluginRoot }) => {
    await createAllNativeHostBuilds(projectRoot)
    await packageChromePlugin({
      projectRoot,
      pluginRoot,
      nativeHostScope: "all",
    })
    const manifestPath = path.join(pluginRoot, ".anybox-plugin", "plugin.json")
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
    manifest.platformArtifacts[0].executables.push({
      ...manifest.platformArtifacts[0].executables[0],
    })
    await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await assert.rejects(
      validateChromePluginPackage(pluginRoot, { nativeHostScope: "all" }),
      /duplicate Native Messaging Host targets/,
    )
  })
})

test("rejects a Native Host path that does not match its target", async () => {
  await withFixture("anybox-chrome-target-path-", async ({ projectRoot, pluginRoot }) => {
    await createAllNativeHostBuilds(projectRoot)
    await packageChromePlugin({
      projectRoot,
      pluginRoot,
      nativeHostScope: "all",
    })
    const manifestPath = path.join(pluginRoot, ".anybox-plugin", "plugin.json")
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
    manifest.platformArtifacts[0].executables[0].path =
      "extension-host/windows/x64/wrong.exe"
    await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await assert.rejects(
      validateChromePluginPackage(pluginRoot, { nativeHostScope: "all" }),
      /path for win32\/x64 must be/,
    )
  })
})

test("rejects an undeclared Native Host file", async () => {
  await withFixture("anybox-chrome-undeclared-host-", async ({ projectRoot, pluginRoot }) => {
    await createAllNativeHostBuilds(projectRoot)
    await packageChromePlugin({
      projectRoot,
      pluginRoot,
      nativeHostScope: "all",
    })
    await write(
      pluginRoot,
      path.join("extension-host", "linux", "x64", "extension-host"),
      "undeclared\n",
    )

    await assert.rejects(
      validateChromePluginPackage(pluginRoot, { nativeHostScope: "all" }),
      /contains an undeclared Native Messaging Host/,
    )
  })
})

test("current-platform packaging preserves previously assembled Native Hosts", async () => {
  await withFixture("anybox-chrome-preserve-native-", async ({ projectRoot, pluginRoot }) => {
    await createAllNativeHostBuilds(projectRoot)
    await packageChromePlugin({
      projectRoot,
      pluginRoot,
      nativeHostScope: "all",
    })
    const preservedTarget = declaredNativeHostTargets.find(
      (target) =>
        target.platform !== process.platform
        || target.architecture !== process.arch,
    )
    assert.ok(preservedTarget)
    const preservedPath = path.join(pluginRoot, preservedTarget.packagePath)
    const before = await fsp.readFile(preservedPath)

    await packageChromePlugin({ projectRoot, pluginRoot })

    assert.deepEqual(await fsp.readFile(preservedPath), before)
    await validateChromePluginPackage(pluginRoot, { nativeHostScope: "all" })
  })
})

test("does not mix preserved Native Hosts from another plugin version", async () => {
  await withFixture("anybox-chrome-versioned-native-", async ({ projectRoot, pluginRoot }) => {
    await createAllNativeHostBuilds(projectRoot)
    await packageChromePlugin({
      projectRoot,
      pluginRoot,
      nativeHostScope: "all",
    })
    const sourceManifestPath = path.join(
      projectRoot,
      "runtime",
      ".anybox-plugin",
      "plugin.json",
    )
    const sourceManifest = JSON.parse(
      await fsp.readFile(sourceManifestPath, "utf8"),
    )
    sourceManifest.version = "1.2.4"
    await fsp.writeFile(
      sourceManifestPath,
      `${JSON.stringify(sourceManifest, null, 2)}\n`,
    )

    await packageChromePlugin({ projectRoot, pluginRoot })

    await assert.rejects(
      validateChromePluginPackage(pluginRoot, { nativeHostScope: "all" }),
      /missing Native Messaging Host for/,
    )
  })
})

test("check mode reports stale Browser Client output without overwriting it", async () => {
  await withFixture("anybox-chrome-package-check-", async ({ projectRoot, pluginRoot }) => {
    await packageChromePlugin({ projectRoot, pluginRoot })
    await fsp.writeFile(path.join(pluginRoot, "scripts", "browser-client.mjs"), "stale\n")

    await assert.rejects(
      packageChromePlugin({ projectRoot, pluginRoot, check: true }),
      /changed: scripts\/browser-client\.mjs/,
    )
    assert.equal(
      await fsp.readFile(path.join(pluginRoot, "scripts", "browser-client.mjs"), "utf8"),
      "stale\n",
    )
  })
})

test("check mode rejects a matching tracked package missing declared targets", async () => {
  await withFixture("anybox-chrome-package-check-incomplete-", async ({
    projectRoot,
    pluginRoot,
  }) => {
    await packageChromePlugin({ projectRoot, pluginRoot })

    await assert.rejects(
      packageChromePlugin({ projectRoot, pluginRoot, check: true }),
      /missing Native Messaging Host for/,
    )
  })
})

test("rejects capability claims that re-enable raw page JavaScript or CDP", async () => {
  await withFixture("anybox-chrome-capability-", async ({ projectRoot, pluginRoot }) => {
    await packageChromePlugin({ projectRoot, pluginRoot })
    const manifestPath = path.join(pluginRoot, ".anybox-plugin", "plugin.json")
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
    manifest.mcpRequirements[0].permissions = [
      "Allows raw page JavaScript and Chrome DevTools Protocol commands.",
    ]
    await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /capability claims must state that raw page JavaScript and CDP are disabled/,
    )
  })
})

test("rejects a Chrome manifest without its Anybox Node REPL requirement", async () => {
  await withFixture("anybox-chrome-requirement-", async ({ projectRoot, pluginRoot }) => {
    await packageChromePlugin({ projectRoot, pluginRoot })
    const manifestPath = path.join(pluginRoot, ".anybox-plugin", "plugin.json")
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
    delete manifest.mcpRequirements
    await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /must declare exactly one Anybox built-in Node REPL MCP requirement/,
    )
  })
})

test("rejects a package that restores a Chrome-owned Node server", async () => {
  await withFixture("anybox-chrome-legacy-runtime-", async ({ projectRoot, pluginRoot }) => {
    await packageChromePlugin({ projectRoot, pluginRoot })
    await write(pluginRoot, path.join("scripts", "node-repl-server.js"), "legacy\n")
    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /must not contain the removed Chrome runtime/,
    )
  })
})

test("rejects Browser Client output that restores the old capability boundary", async () => {
  await withFixture("anybox-chrome-old-capability-", async ({ projectRoot, pluginRoot }) => {
    await packageChromePlugin({ projectRoot, pluginRoot })
    await fsp.appendFile(
      path.join(pluginRoot, "scripts", "browser-client.mjs"),
      "\nconst oldCapability = 'anybox.browser-runtime'\n",
    )
    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /Browser Client, plugin-owned Browser Host, and Native Host boundaries are inconsistent/,
    )
  })
})

test("rejects a Locator engine that differs from the pinned Playwright bundle", async () => {
  await withFixture("anybox-chrome-locator-integrity-", async ({ projectRoot, pluginRoot }) => {
    await packageChromePlugin({ projectRoot, pluginRoot })
    await fsp.appendFile(
      path.join(pluginRoot, "browser-extension", "locator-engine.js"),
      "\n// modified\n",
    )
    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /does not match its pinned Playwright 1\.61\.1 SHA-256/,
    )
  })
})

test("rejects Locator metadata that changes its audited upstream source", async () => {
  await withFixture("anybox-chrome-locator-metadata-", async ({ projectRoot, pluginRoot }) => {
    await packageChromePlugin({ projectRoot, pluginRoot })
    const metadataPath = path.join(
      pluginRoot,
      "browser-extension",
      "locator-engine.metadata.json",
    )
    const metadata = JSON.parse(await fsp.readFile(metadataPath, "utf8"))
    metadata.upstreamCommit = "unreviewed"
    await fsp.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /metadata 'upstreamCommit' must equal/,
    )
  })
})

test("rejects altered Playwright license and notice files", async () => {
  await withFixture("anybox-chrome-locator-license-", async ({ projectRoot, pluginRoot }) => {
    await packageChromePlugin({ projectRoot, pluginRoot })
    await fsp.appendFile(
      path.join(
        pluginRoot,
        "browser-extension",
        "licenses",
        "playwright-NOTICE.txt",
      ),
      "\nmodified\n",
    )
    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /playwright-NOTICE\.txt does not match the pinned upstream SHA-256/,
    )
  })
})

test("rejects extension JavaScript above the 1.5 MiB Locator v3 limit", async () => {
  await withFixture("anybox-chrome-extension-size-", async ({ projectRoot, pluginRoot }) => {
    await packageChromePlugin({ projectRoot, pluginRoot })
    await fsp.writeFile(
      path.join(pluginRoot, "browser-extension", "background.js"),
      Buffer.alloc(Math.floor(1.5 * 1024 * 1024)),
    )
    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /minified Locator v3 package limit/,
    )
  })
})

test("rejects a generated package that exceeds the GitHub Tree install limit", async () => {
  await withFixture("anybox-chrome-size-", async ({ projectRoot, pluginRoot }) => {
    await packageChromePlugin({ projectRoot, pluginRoot })
    await fsp.writeFile(
      path.join(pluginRoot, "assets", "oversized.bin"),
      Buffer.alloc(5 * 1024 * 1024),
    )
    await assert.rejects(
      validateChromePluginPackage(pluginRoot),
      /GitHub Tree installs are limited/,
    )
  })
})
