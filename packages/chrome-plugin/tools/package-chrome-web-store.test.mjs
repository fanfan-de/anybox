import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  defaultStoreIconRoot,
  packageChromeWebStore,
  readZipEntryNames,
  stageChromeWebStorePackage,
} from "./package-chrome-web-store.mjs"

const toolsRoot = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(toolsRoot, "..")
const extensionPublicRoot = path.join(
  projectRoot,
  "browser-extension",
  "public",
)
const iconSizes = [16, 48, 128]

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function copyFile(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  await fsp.copyFile(source, destination)
}

async function createExtensionFixture(extensionRoot) {
  await copyFile(
    path.join(extensionPublicRoot, "manifest.json"),
    path.join(extensionRoot, "manifest.json"),
  )
  for (const size of iconSizes) {
    await copyFile(
      path.join(extensionPublicRoot, "icons", `icon${size}.png`),
      path.join(extensionRoot, "icons", `icon${size}.png`),
    )
  }
  await fsp.writeFile(
    path.join(extensionRoot, "background.js"),
    "const internalChromeBuild = true\n",
  )
  await fsp.writeFile(
    path.join(extensionRoot, "background.js.map"),
    "{}\n",
  )
}

async function iconHashes(root) {
  return Promise.all(iconSizes.map(async (size) => sha256(
    await fsp.readFile(path.join(root, "icons", `icon${size}.png`)),
  )))
}

test("stages box-cat icons without mutating the internal Chrome extension build", async () => {
  const temporaryRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "anybox-web-store-stage-test-"),
  )
  const extensionRoot = path.join(temporaryRoot, "dist")
  const packageRoot = path.join(temporaryRoot, "package")

  try {
    await fsp.mkdir(extensionRoot, { recursive: true })
    await createExtensionFixture(extensionRoot)
    const internalBefore = await iconHashes(extensionRoot)

    const result = await stageChromeWebStorePackage({
      extensionDistRoot: extensionRoot,
      packageRoot,
    })

    assert.equal(result.version, "0.15.1")
    assert.equal(result.icons.length, 3)
    assert.equal(result.files.includes("manifest.json"), true)
    assert.equal(result.files.includes("background.js.map"), false)
    assert.deepEqual(await iconHashes(extensionRoot), internalBefore)

    for (const [index, size] of iconSizes.entries()) {
      const packagedHash = sha256(
        await fsp.readFile(path.join(packageRoot, "icons", `icon${size}.png`)),
      )
      const storeHash = sha256(
        await fsp.readFile(path.join(defaultStoreIconRoot, `icon${size}.png`)),
      )
      assert.equal(packagedHash, storeHash)
      assert.notEqual(packagedHash, internalBefore[index])
    }
  } finally {
    await fsp.rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("rejects a Web Store icon whose pixels do not match its declared size", async () => {
  const temporaryRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "anybox-web-store-icon-test-"),
  )
  const extensionRoot = path.join(temporaryRoot, "dist")
  const packageRoot = path.join(temporaryRoot, "package")
  const storeIconRoot = path.join(temporaryRoot, "store-icons")

  try {
    await fsp.mkdir(extensionRoot, { recursive: true })
    await createExtensionFixture(extensionRoot)
    for (const size of iconSizes) {
      await copyFile(
        path.join(defaultStoreIconRoot, `icon${size}.png`),
        path.join(storeIconRoot, `icon${size}.png`),
      )
    }
    await copyFile(
      path.join(defaultStoreIconRoot, "icon16.png"),
      path.join(storeIconRoot, "icon48.png"),
    )

    await assert.rejects(
      stageChromeWebStorePackage({
        extensionDistRoot: extensionRoot,
        packageRoot,
        storeIconRoot,
      }),
      /must be 48x48/,
    )
  } finally {
    await fsp.rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("creates a deterministic root-manifest Web Store ZIP", async () => {
  const temporaryRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "anybox-web-store-zip-test-"),
  )
  const extensionRoot = path.join(temporaryRoot, "dist")
  const firstZip = path.join(temporaryRoot, "first.zip")
  const secondZip = path.join(temporaryRoot, "second.zip")

  try {
    await fsp.mkdir(extensionRoot, { recursive: true })
    await createExtensionFixture(extensionRoot)

    const first = await packageChromeWebStore({
      extensionDistRoot: extensionRoot,
      outputPath: firstZip,
    })
    const second = await packageChromeWebStore({
      extensionDistRoot: extensionRoot,
      outputPath: secondZip,
    })

    assert.equal(first.sha256, second.sha256)
    assert.equal(first.bytes, second.bytes)
    assert.deepEqual(await readZipEntryNames(firstZip), [
      "background.js",
      "icons/icon128.png",
      "icons/icon16.png",
      "icons/icon48.png",
      "manifest.json",
    ])
  } finally {
    await fsp.rm(temporaryRoot, { recursive: true, force: true })
  }
})
