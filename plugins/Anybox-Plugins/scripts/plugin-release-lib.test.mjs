import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  buildPluginRelease,
  PLUGIN_CATALOG_ID,
  PLUGIN_CATALOG_RELEASE_TAG,
  PLUGIN_RELEASE_MANIFEST_FILENAME,
  PLUGIN_RELEASE_REGISTRY_FILENAME,
  verifyPluginRelease,
} from "./plugin-release-lib.mjs"

function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    ...options,
  }).trim()
}

function manifestFor(id) {
  return {
    name: id,
    version: "1.0.0",
    description: `${id} deterministic release fixture.`,
    interface: {
      displayName: id,
      shortDescription: `${id} fixture.`,
      category: "Docs",
    },
    mcpServers: [],
    skills: [],
  }
}

async function createFixtureRepository(pluginIDs = ["alpha", "beta"]) {
  const root = await mkdtemp(join(tmpdir(), "anybox-plugin-release-test-"))
  const pluginsRoot = join(root, "plugins", "Anybox-Plugins")
  await mkdir(pluginsRoot, { recursive: true })

  for (const id of pluginIDs) {
    const manifestRoot = join(pluginsRoot, id, ".anybox-plugin")
    await mkdir(manifestRoot, { recursive: true })
    await writeFile(join(manifestRoot, "plugin.json"), `${JSON.stringify(manifestFor(id), null, 2)}\n`)
    await writeFile(join(pluginsRoot, id, "README.md"), `# ${id}\n`)
  }
  await writeFile(
    join(pluginsRoot, "index.json"),
    `${JSON.stringify(pluginIDs.map((id) =>
      `https://raw.githubusercontent.com/fanfan-de/anybox/master/plugins/Anybox-Plugins/${id}/.anybox-plugin/plugin.json`), null, 2)}\n`,
  )

  git(root, ["init", "--quiet"])
  git(root, ["config", "user.email", "plugin-release-tests@example.test"])
  git(root, ["config", "user.name", "Plugin Release Tests"])
  git(root, ["add", "-f", "--", "."])
  git(root, ["commit", "--quiet", "-m", "fixture"])
  return {
    root,
    pluginsRoot,
    sourceCommit: git(root, ["rev-parse", "HEAD"]),
  }
}

async function listReleaseBytes(directory, manifest) {
  const names = [
    PLUGIN_RELEASE_MANIFEST_FILENAME,
    PLUGIN_RELEASE_REGISTRY_FILENAME,
    ...manifest.assets.map((asset) => asset.name),
  ].sort()
  return new Map(await Promise.all(names.map(async (name) => [name, await readFile(join(directory, name))])))
}

test("builds byte-identical ZIPs, registry metadata, and release manifests", async () => {
  const fixture = await createFixtureRepository()
  try {
    const firstDirectory = join(fixture.root, "release-one")
    const secondDirectory = join(fixture.root, "release-two")
    const input = {
      repoRoot: fixture.root,
      pluginsRoot: fixture.pluginsRoot,
      sourceCommit: fixture.sourceCommit,
      expectedPluginCount: 2,
    }
    const first = await buildPluginRelease({ ...input, outputDirectory: firstDirectory })
    const second = await buildPluginRelease({ ...input, outputDirectory: secondDirectory })
    await verifyPluginRelease({ ...input, outputDirectory: firstDirectory })
    await verifyPluginRelease({ ...input, outputDirectory: secondDirectory })

    const firstBytes = await listReleaseBytes(firstDirectory, first.releaseManifest)
    const secondBytes = await listReleaseBytes(secondDirectory, second.releaseManifest)
    assert.deepEqual([...firstBytes.keys()], [...secondBytes.keys()])
    for (const [name, bytes] of firstBytes) {
      assert.deepEqual(bytes, secondBytes.get(name), `${name} was not deterministic`)
    }

    assert.equal(first.registry.pluginCount, 2)
    assert.equal(first.registry.schemaVersion, 3)
    assert.equal(first.registry.catalogID, PLUGIN_CATALOG_ID)
    assert.equal(first.releaseManifest.schemaVersion, 2)
    assert.equal(first.releaseManifest.catalogID, PLUGIN_CATALOG_ID)
    assert.equal(first.releaseManifest.releaseTag, PLUGIN_CATALOG_RELEASE_TAG)
    assert.equal("desktopVersion" in first.registry, false)
    assert.equal("desktopVersion" in first.releaseManifest, false)
    assert.deepEqual(first.registry.plugins.map((plugin) => plugin.id), ["alpha", "beta"])
    assert.ok(first.registry.plugins.every((plugin) => plugin.package.type === "zip"))
    assert.ok(first.registry.plugins.every((plugin) =>
      plugin.package.url.startsWith(`https://github.com/fanfan-de/anybox/releases/download/${PLUGIN_CATALOG_RELEASE_TAG}/`)))
    assert.doesNotMatch(JSON.stringify(first.registry), /github-tree/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test("rejects invalid manifests, duplicate IDs/manifests, sensitive files, unsafe references, symlinks, and oversized output", async (t) => {
  await t.test("invalid canonical manifest", async () => {
    const fixture = await createFixtureRepository(["alpha"])
    try {
      const manifestPath = join(fixture.pluginsRoot, "alpha", ".anybox-plugin", "plugin.json")
      await writeFile(manifestPath, `${JSON.stringify({ name: "alpha" }, null, 2)}\n`)
      git(fixture.root, ["add", "-f", "--", "."])
      await assert.rejects(
        buildPluginRelease({
          repoRoot: fixture.root,
          pluginsRoot: fixture.pluginsRoot,
          outputDirectory: join(fixture.root, "release"),
          sourceCommit: fixture.sourceCommit,
          expectedPluginCount: 1,
          allowDirty: true,
        }),
        /has no version/,
      )
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  await t.test("duplicate registry ID", async () => {
    const fixture = await createFixtureRepository()
    try {
      const outputDirectory = join(fixture.root, "release")
      await buildPluginRelease({
        repoRoot: fixture.root,
        pluginsRoot: fixture.pluginsRoot,
        outputDirectory,
        sourceCommit: fixture.sourceCommit,
        expectedPluginCount: 2,
      })

      const registryPath = join(outputDirectory, PLUGIN_RELEASE_REGISTRY_FILENAME)
      const releaseManifestPath = join(outputDirectory, PLUGIN_RELEASE_MANIFEST_FILENAME)
      const registry = JSON.parse(await readFile(registryPath, "utf8"))
      registry.plugins[1].id = registry.plugins[0].id
      registry.plugins[1].name = registry.plugins[0].name
      const registryBytes = Buffer.from(`${JSON.stringify(registry, null, 2)}\n`)
      await writeFile(registryPath, registryBytes)

      const releaseManifest = JSON.parse(await readFile(releaseManifestPath, "utf8"))
      releaseManifest.registry.size = registryBytes.length
      releaseManifest.registry.sha256 = createHash("sha256").update(registryBytes).digest("hex")
      await writeFile(releaseManifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`)

      await assert.rejects(
        verifyPluginRelease({
          outputDirectory,
          sourceCommit: fixture.sourceCommit,
          expectedPluginCount: 2,
        }),
        /duplicate ID/,
      )
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  await t.test("duplicate manifest", async () => {
    const fixture = await createFixtureRepository(["alpha"])
    try {
      await writeFile(join(fixture.pluginsRoot, "alpha", "plugin.json"), "{}\n")
      git(fixture.root, ["add", "-f", "--", "."])
      await assert.rejects(
        buildPluginRelease({
          repoRoot: fixture.root,
          pluginsRoot: fixture.pluginsRoot,
          outputDirectory: join(fixture.root, "release"),
          sourceCommit: fixture.sourceCommit,
          expectedPluginCount: 1,
          allowDirty: true,
        }),
        /exactly one canonical plugin\.json/,
      )
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  await t.test("sensitive file", async () => {
    const fixture = await createFixtureRepository(["alpha"])
    try {
      await writeFile(join(fixture.pluginsRoot, "alpha", ".env"), "TOKEN=secret\n")
      git(fixture.root, ["add", "-f", "--", "."])
      await assert.rejects(
        buildPluginRelease({
          repoRoot: fixture.root,
          pluginsRoot: fixture.pluginsRoot,
          outputDirectory: join(fixture.root, "release"),
          sourceCommit: fixture.sourceCommit,
          expectedPluginCount: 1,
          allowDirty: true,
        }),
        /sensitive file/,
      )
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  await t.test("path traversal", async () => {
    const fixture = await createFixtureRepository(["alpha"])
    try {
      const manifestPath = join(fixture.pluginsRoot, "alpha", ".anybox-plugin", "plugin.json")
      const manifest = manifestFor("alpha")
      manifest.interface.logo = "../outside.png"
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      git(fixture.root, ["add", "-f", "--", "."])
      await assert.rejects(
        buildPluginRelease({
          repoRoot: fixture.root,
          pluginsRoot: fixture.pluginsRoot,
          outputDirectory: join(fixture.root, "release"),
          sourceCommit: fixture.sourceCommit,
          expectedPluginCount: 1,
          allowDirty: true,
        }),
        /must stay inside the plugin package|does not exist/,
      )
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  await t.test("symbolic-link git mode", async () => {
    const fixture = await createFixtureRepository(["alpha"])
    try {
      const linkPath = join(fixture.pluginsRoot, "alpha", "unsafe-link")
      await writeFile(linkPath, "README.md")
      const blob = git(fixture.root, ["hash-object", "-w", "--stdin"], { input: "README.md" })
      git(fixture.root, [
        "update-index",
        "--add",
        "--cacheinfo",
        `120000,${blob},plugins/Anybox-Plugins/alpha/unsafe-link`,
      ])
      await assert.rejects(
        buildPluginRelease({
          repoRoot: fixture.root,
          pluginsRoot: fixture.pluginsRoot,
          outputDirectory: join(fixture.root, "release"),
          sourceCommit: fixture.sourceCommit,
          expectedPluginCount: 1,
          allowDirty: true,
        }),
        /unsupported git mode 120000/,
      )
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  await t.test("package byte limit", async () => {
    const fixture = await createFixtureRepository(["alpha"])
    try {
      await assert.rejects(
        buildPluginRelease({
          repoRoot: fixture.root,
          pluginsRoot: fixture.pluginsRoot,
          outputDirectory: join(fixture.root, "release"),
          sourceCommit: fixture.sourceCommit,
          expectedPluginCount: 1,
          maxPluginPackageBytes: 10,
        }),
        /limit is 10/,
      )
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })
})
