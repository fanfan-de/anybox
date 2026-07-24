import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const { enableLanCleartextTraffic } = require("../../plugins/with-android-lan-cleartext.js")

test("enables cleartext traffic on the main Android application for the local Wi-Fi bridge", () => {
  const manifest = {
    manifest: {
      application: [
        {
          $: {
            "android:name": ".MainApplication",
            "android:usesCleartextTraffic": "false",
          },
        },
      ],
    },
  }

  const result = enableLanCleartextTraffic(manifest)

  assert.equal(
    result.manifest.application[0].$["android:usesCleartextTraffic"],
    "true",
  )
})
