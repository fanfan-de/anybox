import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  compareChromePluginPackages,
  packageChromePlugin,
  validateChromePluginPackage,
} from "./package-chrome-plugin.mjs"

async function write(root, relativePath, content = relativePath) {
  const target = path.join(root, relativePath)
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await fsp.writeFile(target, content)
}

async function createFixture(projectRoot) {
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
  }, null, 2)}\n`)
  await write(projectRoot, path.join("runtime", "scripts", "browser-client.mjs"))
  await write(projectRoot, path.join("runtime", "scripts", "browser-server.js"))
  await write(projectRoot, path.join("runtime", "scripts", "node-repl-server.js"))
  await write(projectRoot, path.join("runtime", "skills", "chrome", "SKILL.md"))
  await write(projectRoot, "LICENSE", "MIT License\n")

  await write(projectRoot, path.join("browser-extension", "package.json"), "{}\n")
  await write(projectRoot, path.join("browser-extension", "src", "background.ts"))
  await write(projectRoot, path.join("browser-extension", "tsconfig.json"), "{}\n")
  await write(projectRoot, path.join("browser-extension", "dist", "manifest.json"), "{}\n")
  await write(projectRoot, path.join("browser-extension", "dist", "background.js"))
  await write(projectRoot, path.join("browser-extension", "dist", "background.js.map"))
  await write(projectRoot, path.join("browser-extension", "dist", "content.js"))
  await write(projectRoot, path.join("browser-extension", "dist", "popup.html"))
  await write(projectRoot, path.join("browser-extension", "dist", "popup.js"))
  await write(projectRoot, path.join("browser-extension", "dist", "chunks", "shared.js"))
  await write(projectRoot, path.join("browser-extension", "dist", "chunks", "shared.js.map"))

  await write(projectRoot, path.join("browser-native-host", "package.json"), "{}\n")
  await write(projectRoot, path.join("browser-native-host", "src", "main.ts"))
  await write(projectRoot, path.join("browser-native-host", "dist", "native-host.exe"))
  await write(projectRoot, path.join("tools", "package-chrome-plugin.mjs"))
  await write(projectRoot, "README.md")
}

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
      "browser-extension/background.js",
      "browser-extension/chunks/shared.js",
      "browser-extension/content.js",
      "browser-extension/manifest.json",
      "browser-extension/popup.html",
      "browser-extension/popup.js",
      "LICENSE",
      "scripts/browser-client.mjs",
      "scripts/browser-server.js",
      "scripts/node-repl-server.js",
      "skills/chrome/SKILL.md",
    ])
    assert.equal(result.version, "1.2.3")
    assert.equal(files.some((entry) => entry.endsWith(".map")), false)
    assert.equal(files.some((entry) => entry.includes("/src/")), false)
    assert.equal(files.some((entry) => entry.startsWith("browser-native-host/")), false)
    assert.equal(files.some((entry) => entry.endsWith("package.json")), false)
    assert.equal(files.some((entry) => entry.toLowerCase().includes("readme")), false)

    const manifest = JSON.parse(
      await fsp.readFile(path.join(pluginRoot, ".anybox-plugin", "plugin.json"), "utf8"),
    )
    assert.equal(manifest.package, undefined)
    assert.equal(manifest.skillPreviews.length, 1)
    assert.equal(
      await fsp.readFile(path.join(projectRoot, "browser-native-host", "src", "main.ts"), "utf8"),
      path.join("browser-native-host", "src", "main.ts"),
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
    await fsp.writeFile(path.join(pluginRoot, "scripts", "browser-server.js"), "stale\n")

    await assert.rejects(
      packageChromePlugin({ projectRoot, pluginRoot, check: true }),
      /changed: scripts\/browser-server\.js/,
    )
    assert.equal(
      await fsp.readFile(path.join(pluginRoot, "scripts", "browser-server.js"), "utf8"),
      "stale\n",
    )
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})
