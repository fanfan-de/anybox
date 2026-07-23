import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  buildNativeHost,
  nativeHostBuildPaths,
  parseBuildArgs,
  resolveNativeHostBuildTarget,
} from "../browser-native-host/tools/build.mjs"

test("maps each official Native Host target to its Rust target and output", () => {
  const cases = [
    ["win32/x64", "x86_64-pc-windows-msvc", "windows", "x64", "extension-host.exe"],
    ["darwin/x64", "x86_64-apple-darwin", "macos", "x64", "extension-host"],
    ["darwin/arm64", "aarch64-apple-darwin", "macos", "arm64", "extension-host"],
  ]
  for (const [
    targetID,
    rustTarget,
    platformDirectory,
    architectureDirectory,
    executableName,
  ] of cases) {
    const platform = targetID.split("/")[0]
    const target = resolveNativeHostBuildTarget({
      target: targetID,
      platform,
      architecture: platform === "win32" ? "x64" : "arm64",
    })
    const paths = nativeHostBuildPaths(target, "/repo/native-host")
    assert.equal(target.rustTarget, rustTarget)
    assert.equal(
      paths.source,
      path.join(
        "/repo/native-host",
        "target",
        rustTarget,
        "release",
        executableName,
      ),
    )
    assert.equal(
      paths.destination,
      path.join(
        "/repo/native-host",
        "dist",
        platformDirectory,
        architectureDirectory,
        executableName,
      ),
    )
  }
})

test("keeps the current-platform build layout when --target is omitted", () => {
  const target = resolveNativeHostBuildTarget({
    platform: "darwin",
    architecture: "arm64",
  })
  const paths = nativeHostBuildPaths(target, "/repo/native-host")
  assert.equal(target.explicit, false)
  assert.equal(
    paths.source,
    path.join("/repo/native-host", "target", "release", "extension-host"),
  )
  assert.equal(
    paths.destination,
    path.join(
      "/repo/native-host",
      "dist",
      "macos",
      "arm64",
      "extension-host",
    ),
  )
})

test("builds an explicit target from Cargo's target-specific output", async () => {
  const projectRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "anybox-native-host-build-"),
  )
  const source = path.join(
    projectRoot,
    "target",
    "x86_64-apple-darwin",
    "release",
    "extension-host",
  )
  await fsp.mkdir(path.dirname(source), { recursive: true })
  await fsp.writeFile(source, "mach-o")
  const calls = []
  try {
    const result = await buildNativeHost({
      target: "darwin/x64",
      platform: "darwin",
      architecture: "arm64",
      projectRoot,
      spawn: (command, args, options) => {
        calls.push({ command, args, options })
        return { status: 0 }
      },
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].command, "cargo")
    assert.deepEqual(calls[0].args.slice(-2), [
      "--target",
      "x86_64-apple-darwin",
    ])
    assert.equal(
      result.output,
      path.join(projectRoot, "dist", "macos", "x64", "extension-host"),
    )
    assert.equal(await fsp.readFile(result.output, "utf8"), "mach-o")
    if (process.platform !== "win32") {
      assert.equal((await fsp.stat(result.output)).mode & 0o777, 0o755)
    }
  } finally {
    await fsp.rm(projectRoot, { recursive: true, force: true })
  }
})

test("rejects unsupported and cross-operating-system build combinations", () => {
  assert.throws(
    () => resolveNativeHostBuildTarget({
      target: "linux/x64",
      platform: "linux",
      architecture: "x64",
    }),
    /Unsupported Native Messaging Host target/,
  )
  assert.throws(
    () => resolveNativeHostBuildTarget({
      target: "win32\/x64",
      platform: "darwin",
      architecture: "arm64",
    }),
    /must be built on win32/,
  )
  assert.throws(
    () => resolveNativeHostBuildTarget({
      target: "win32\/x64",
      platform: "win32",
      architecture: "arm64",
    }),
    /must be built on a Windows x64 host/,
  )
})

test("parses explicit targets and requires their value", () => {
  assert.deepEqual(parseBuildArgs(["--target", "darwin/x64"]), {
    target: "darwin/x64",
  })
  assert.deepEqual(parseBuildArgs(["--target=darwin/arm64"]), {
    target: "darwin/arm64",
  })
  assert.throws(() => parseBuildArgs(["--target"]), /requires/)
})
