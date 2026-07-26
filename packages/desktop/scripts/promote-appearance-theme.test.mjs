import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  parsePromotionArguments,
  promoteAppearanceTheme,
  promoteLibraryTheme,
} from "./promote-appearance-theme.mjs"

function createManifest() {
  return {
    version: 1,
    defaultThemeId: "built-in:classic",
    groups: [
      {
        id: "surface",
        rows: [
          {
            id: "surface-app",
            lightToken: "surface-app-light",
            darkToken: "surface-app-dark",
          },
        ],
      },
    ],
    themes: [
      {
        id: "built-in:classic",
        name: "Classic",
        colorMode: "light",
        brandTheme: "terra",
        fontFamily: "default",
        codeThemePreference: "auto",
        overrides: {},
      },
    ],
  }
}

function createLibrary(overrides = {}) {
  return {
    version: 2,
    activeThemeID: "user:source",
    userThemes: [
      {
        id: "user:source",
        name: "Source",
        source: "user",
        colorMode: "dark",
        brandTheme: "sage",
        fontFamily: "system",
        codeThemePreference: "dracula",
        overrides: {
          "surface-app-light": "#123456",
        },
        foreignDtcg: {},
        ...overrides,
      },
    ],
  }
}

async function withTempDirectory(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "anybox-promote-theme-"))
  try {
    await callback(directory)
  } finally {
    await fs.rm(directory, { force: true, recursive: true })
  }
}

test("parses explicit library promotion arguments", () => {
  assert.deepEqual(
    parsePromotionArguments([
      "--library",
      "appearance-themes.json",
      "--source-theme-id",
      "user:source",
      "--target-id",
      "built-in:focused",
      "--name",
      "Focused",
      "--set-default",
    ]),
    {
      mode: "library",
      libraryPath: "appearance-themes.json",
      sourceThemeID: "user:source",
      targetID: "built-in:focused",
      name: "Focused",
      setDefault: true,
      legacyConfigPath: null,
    },
  )
  assert.equal(
    parsePromotionArguments(["C:\\tmp\\appearance-theme.json"]).mode,
    "legacy",
  )
})

test("creates and updates built-in themes and changes the default only when requested", () => {
  const manifest = createManifest()
  const created = promoteLibraryTheme(manifest, createLibrary(), {
    sourceThemeID: "user:source",
    targetID: "built-in:focused",
    name: "Focused",
    setDefault: false,
  })

  assert.equal(created.action, "created")
  assert.equal(manifest.defaultThemeId, "built-in:classic")
  assert.deepEqual(manifest.themes.at(-1), {
    id: "built-in:focused",
    name: "Focused",
    colorMode: "dark",
    brandTheme: "sage",
    fontFamily: "system",
    codeThemePreference: "dracula",
    overrides: {
      "surface-app-light": {
        type: "literal",
        value: {
          colorSpace: "srgb",
          components: [0.070588, 0.203922, 0.337255],
          alpha: 1,
          hex: "#123456",
        },
      },
    },
  })

  const updated = promoteLibraryTheme(manifest, createLibrary({
    colorMode: "system",
    codeThemePreference: "nord",
  }), {
    sourceThemeID: "user:source",
    targetID: "built-in:focused",
    name: null,
    setDefault: true,
  })

  assert.equal(updated.action, "updated")
  assert.equal(updated.targetTheme.name, "Focused")
  assert.equal(updated.targetTheme.colorMode, "system")
  assert.equal(updated.targetTheme.codeThemePreference, "nord")
  assert.equal(manifest.defaultThemeId, "built-in:focused")
})

test("rejects invalid targets, missing sources, and foreign DTCG data", () => {
  assert.throws(() => promoteLibraryTheme(createManifest(), createLibrary(), {
    sourceThemeID: "user:source",
    targetID: "user:not-built-in",
    name: "Invalid",
    setDefault: false,
  }), /built-in:<slug>/)

  assert.throws(() => promoteLibraryTheme(createManifest(), createLibrary(), {
    sourceThemeID: "user:missing",
    targetID: "built-in:missing",
    name: "Missing",
    setDefault: false,
  }), /was not found/)

  assert.throws(() => promoteLibraryTheme(createManifest(), createLibrary({
    foreignDtcg: {
      thirdParty: {
        token: true,
      },
    },
  }), {
    sourceThemeID: "user:source",
    targetID: "built-in:foreign",
    name: "Foreign",
    setDefault: false,
  }), /cannot be promoted without loss/)
})

test("restores the manifest and generated artifacts when generation fails", async () => {
  await withTempDirectory(async (directory) => {
    const targetManifestPath = path.join(directory, "appearance-token-manifest.json")
    const libraryPath = path.join(directory, "appearance-themes.json")
    const generatedPath = path.join(directory, "appearance-tokens.generated.ts")
    const originalManifest = `${JSON.stringify(createManifest(), null, 2)}\n`
    const originalGenerated = "original generated file\n"
    await fs.writeFile(targetManifestPath, originalManifest, "utf8")
    await fs.writeFile(libraryPath, `${JSON.stringify(createLibrary(), null, 2)}\n`, "utf8")
    await fs.writeFile(generatedPath, originalGenerated, "utf8")

    await assert.rejects(
      promoteAppearanceTheme({
        mode: "library",
        libraryPath,
        sourceThemeID: "user:source",
        targetID: "built-in:rollback",
        name: "Rollback",
        setDefault: false,
        manifestPath: targetManifestPath,
        artifactPaths: [targetManifestPath, generatedPath],
        generateArtifacts: async () => {
          await fs.writeFile(generatedPath, "partially generated\n", "utf8")
          throw new Error("generator failed")
        },
      }),
      /generator failed/,
    )

    assert.equal(await fs.readFile(targetManifestPath, "utf8"), originalManifest)
    assert.equal(await fs.readFile(generatedPath, "utf8"), originalGenerated)
  })
})

test("keeps the legacy appearance-theme.json promotion path working", async () => {
  await withTempDirectory(async (directory) => {
    const targetManifestPath = path.join(directory, "appearance-token-manifest.json")
    const configPath = path.join(directory, "appearance-theme.json")
    await fs.writeFile(targetManifestPath, `${JSON.stringify(createManifest(), null, 2)}\n`, "utf8")
    await fs.writeFile(configPath, JSON.stringify({
      colorMode: "dark",
      brandTheme: "sage",
      fontFamily: "system",
      overrides: {
        "surface-app-light": "#abcdef",
      },
    }), "utf8")

    const result = await promoteAppearanceTheme({
      mode: "legacy",
      legacyConfigPath: configPath,
      manifestPath: targetManifestPath,
    })
    const manifest = JSON.parse(await fs.readFile(targetManifestPath, "utf8"))

    assert.equal(result.targetTheme.id, "built-in:classic")
    assert.equal(manifest.themes[0].colorMode, "dark")
    assert.equal(manifest.themes[0].brandTheme, "sage")
    assert.equal(manifest.themes[0].fontFamily, "system")
    assert.deepEqual(Object.keys(manifest.themes[0].overrides), ["surface-app-light"])
  })
})
