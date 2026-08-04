import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  createLineEndingNormalizer,
  createPathNormalizedFingerprint,
} from "./native-fingerprint.mjs"

function fixture(label) {
  const root = mkdtempSync(path.join(os.tmpdir(), `anybox-fingerprint-${label}-`))
  const repoRoot = path.join(root, "repo")
  const projectRoot = path.join(repoRoot, "packages", "mobile-app")
  const dependencyRoot = path.join(root, "store", `expo-demo-${label}`, "node_modules", "expo-demo")
  mkdirSync(path.join(projectRoot, "assets"), { recursive: true })
  mkdirSync(path.join(dependencyRoot, "android", "src"), { recursive: true })
  writeFileSync(
    path.join(dependencyRoot, "package.json"),
    `${JSON.stringify({ name: "expo-demo", version: "1.2.3" })}\n`,
  )

  const relativeDependency = path.relative(projectRoot, dependencyRoot)
  const relativeAndroid = path.join(relativeDependency, "android")
  const relativePlugin = path.join(relativeDependency, "app.plugin.js")
  const sources = [
    {
      type: "file",
      filePath: relativePlugin,
      hash: "plugin-content",
    },
    {
      type: "file",
      filePath: path.join("assets", "icon.png"),
      hash: "icon-content",
    },
    {
      type: "dir",
      filePath: relativeAndroid,
      hash: `path-dependent-directory-hash-${label}`,
      debugInfo: {
        path: relativeAndroid,
        children: [
          {
            path: path.join(relativeAndroid, "build.gradle"),
            hash: "gradle-content",
          },
          {
            path: path.join(relativeAndroid, "src"),
            hash: `path-dependent-child-hash-${label}`,
            children: [
              {
                path: path.join(relativeAndroid, "src", "Module.kt"),
                hash: "module-content",
              },
            ],
          },
        ],
      },
    },
    {
      type: "contents",
      id: "expoAutolinkingConfig:android",
      contents: JSON.stringify({
        modules: [{ packageName: "expo-demo", projects: [{ sourceDir: relativeAndroid }] }],
      }),
      hash: `path-dependent-autolinking-hash-${label}`,
    },
    {
      type: "contents",
      id: "expoConfig",
      contents: "stable-config",
      hash: "stable-config-hash",
    },
  ]
  return {
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    context: { projectRoot, repoRoot },
    sources,
  }
}

test("normalizes project, pnpm store, directory, and autolinking paths", () => {
  const left = fixture("left")
  const right = fixture("right-with-a-longer-path")
  try {
    assert.equal(
      createPathNormalizedFingerprint(left.sources, left.context),
      createPathNormalizedFingerprint(right.sources, right.context),
    )
  } finally {
    left.cleanup()
    right.cleanup()
  }
})

test("changes when included native file content changes", () => {
  const current = fixture("current")
  try {
    const before = createPathNormalizedFingerprint(current.sources, current.context)
    current.sources[2].debugInfo.children[1].children[0].hash = "changed-module-content"
    const after = createPathNormalizedFingerprint(current.sources, current.context)
    assert.notEqual(after, before)
  } finally {
    current.cleanup()
  }
})

test("normalizes CRLF even when the pair crosses stream chunks", () => {
  const normalize = createLineEndingNormalizer()
  const source = { type: "file", filePath: "android/src/Module.kt" }
  const chunks = [
    normalize(source, Buffer.from("first\r"), false),
    normalize(source, Buffer.from("\nsecond\r\nthird"), false),
    normalize(source, null, true),
  ].filter(Boolean)
  assert.equal(Buffer.concat(chunks).toString("utf8"), "first\nsecond\nthird")
})

test("does not rewrite binary files", () => {
  const normalize = createLineEndingNormalizer()
  const source = { type: "file", filePath: "assets/icon.png" }
  const contents = Buffer.from([0, 13, 10, 255])
  assert.equal(normalize(source, contents, false), contents)
  assert.equal(normalize(source, null, true), null)
})
