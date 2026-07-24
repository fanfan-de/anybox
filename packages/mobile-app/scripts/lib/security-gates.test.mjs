import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { assertNoExpoHosting } from "./mobile-update-tools.mjs"

const require = createRequire(import.meta.url)
const { addReleaseSigningConfig } = require("../../plugins/with-android-release-signing.js")

test("self-hosting guard rejects Expo/EAS update configuration", () => {
  assert.doesNotThrow(() =>
    assertNoExpoHosting(
      {
        updates: { url: "https://updates.anybox.com.cn/v1/manifest" },
        extra: { anyboxMobileUpdateChannel: "production" },
      },
      "test config",
    ),
  )
  for (const value of [
    "https://u.expo.dev/project",
    "https://exp.host/@owner/project",
    { extra: { eas: { projectId: "00000000-0000-0000-0000-000000000000" } } },
    { extra: { projectId: "00000000-0000-0000-0000-000000000000" } },
  ]) {
    assert.throws(() => assertNoExpoHosting(value, "test config"), /hosted-service/)
  }
})

test("patched Expo runtime packages do not embed hosted update domains", () => {
  const routerPath = require.resolve("expo-router/build/fork/extractPathFromURL.js")
  const linkingPath = path.join(
    path.dirname(require.resolve("expo-linking/package.json")),
    "build",
    "createURL.js",
  )
  const expoRequire = createRequire(require.resolve("expo/package.json"))
  const assetPath = path.join(
    path.dirname(expoRequire.resolve("expo-asset/package.json")),
    "build",
    "AssetUris.js",
  )
  for (const sourcePath of [routerPath, assetPath, linkingPath]) {
    const source = readFileSync(sourcePath, "utf8")
    assert.doesNotMatch(
      source,
      /\b(?:expo\.io|exp\.host|exp\.direct|expo\.test|(?:u\.)?expo\.dev)\b/i,
    )
  }
})

test("release signing plugin leaves debug on debug and release on release", () => {
  const source = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`
  const generated = addReleaseSigningConfig(source)
  assert.match(generated, /debug\s*\{[\s\S]*signingConfig signingConfigs\.debug/)
  assert.match(generated, /release\s*\{[\s\S]*signingConfig signingConfigs\.release/)
  assert.match(generated, /System\.getenv\("ANYBOX_ANDROID_KEYSTORE_PATH"\)/)
})
