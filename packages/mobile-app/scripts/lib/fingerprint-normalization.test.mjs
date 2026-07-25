import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { canonicalFingerprintHash } from "./mobile-update-tools.mjs"

function toPosix(value) {
  return value.replaceAll("\\", "/")
}

function directoryHash(childPath, childHash) {
  return createHash("sha1").update(childPath).update(childHash).digest("hex")
}

function fixture(
  projectRoot,
  virtualStoreDirectory,
  {
    dependencyBytes = "abc123",
    dependencyVersion = "56.0.23",
  } = {},
) {
  const packageDirectory = path.join(
    virtualStoreDirectory,
    "expo-updates@56.0.23",
    "node_modules",
    "expo-updates",
    "android",
  )
  const filePath = toPosix(path.relative(projectRoot, packageDirectory))
  const childPath = toPosix(path.join(filePath, "build.gradle"))
  const autolinkingContents = JSON.stringify({
    packageVersion: dependencyVersion,
    sourceDir: toPosix(
      path.relative(
        projectRoot,
        path.join(virtualStoreDirectory, "expo-updates@56.0.23"),
      ),
    ),
  })
  return {
    hash: "installation-layout-dependent",
    sources: [
      {
        type: "dir",
        filePath,
        reasons: ["expoAutolinkingAndroid"],
        hash: directoryHash(childPath, dependencyBytes),
        debugInfo: {
          path: filePath,
          hash: directoryHash(childPath, dependencyBytes),
          children: [
            {
              path: childPath,
              hash: dependencyBytes,
            },
          ],
        },
      },
      {
        type: "contents",
        id: "expoAutolinkingConfig:android",
        contents: autolinkingContents,
        reasons: ["expoAutolinkingConfig"],
        hash: createHash("sha1").update(autolinkingContents).digest("hex"),
        debugInfo: {
          hash: createHash("sha1").update(autolinkingContents).digest("hex"),
        },
      },
    ],
  }
}

test("native fingerprint ignores the physical pnpm virtual store location", () => {
  const projectRootA = path.join(os.tmpdir(), "anybox-a", "packages", "mobile-app")
  const projectRootB = path.join(os.tmpdir(), "anybox-b", "packages", "mobile-app")
  const storeA = path.join(os.tmpdir(), "anybox-a", "node_modules", ".pnpm")
  const storeB = path.join(os.tmpdir(), "short-pnpm-store")
  const hashA = canonicalFingerprintHash(fixture(projectRootA, storeA), {
    projectRoot: projectRootA,
    virtualStoreDirectory: storeA,
  })
  const hashB = canonicalFingerprintHash(fixture(projectRootB, storeB), {
    projectRoot: projectRootB,
    virtualStoreDirectory: storeB,
  })
  assert.equal(hashA, hashB)
})

test("native fingerprint ignores mutable files in the physical dependency store", () => {
  const projectRoot = path.join(os.tmpdir(), "anybox", "packages", "mobile-app")
  const virtualStoreDirectory = path.join(
    os.tmpdir(),
    "anybox",
    "node_modules",
    ".pnpm",
  )
  const before = canonicalFingerprintHash(
    fixture(projectRoot, virtualStoreDirectory),
    { projectRoot, virtualStoreDirectory },
  )
  const after = canonicalFingerprintHash(
    fixture(projectRoot, virtualStoreDirectory, { dependencyBytes: "changed" }),
    { projectRoot, virtualStoreDirectory },
  )
  assert.equal(before, after)
})

test("native fingerprint still changes when a linked native dependency version changes", () => {
  const projectRoot = path.join(os.tmpdir(), "anybox", "packages", "mobile-app")
  const virtualStoreDirectory = path.join(
    os.tmpdir(),
    "anybox",
    "node_modules",
    ".pnpm",
  )
  const before = canonicalFingerprintHash(
    fixture(projectRoot, virtualStoreDirectory),
    { projectRoot, virtualStoreDirectory },
  )
  const after = canonicalFingerprintHash(
    fixture(projectRoot, virtualStoreDirectory, {
      dependencyVersion: "56.0.24",
    }),
    { projectRoot, virtualStoreDirectory },
  )
  assert.notEqual(before, after)
})
