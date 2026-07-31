import { expect, mock, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

test("BunProc reuses a cached SDK package without running bun add", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "anybox-bun-runtime-"))
  const cache = path.join(root, "cache")
  const runtimeDir = path.join(cache, "runtime-node_modules")
  const packageRoot = path.join(runtimeDir, "node_modules", "@ai-sdk", "openai-compatible")
  const outdatedChecks: Array<{ pkg: string; version: string }> = []
  let restoreCacheDir: (() => void) | undefined

  mock.module("#bun/registry.ts", () => ({
    PackageRegistry: {
      isOutdated: async (pkg: string, version: string) => {
        outdatedChecks.push({ pkg, version })
        return false
      },
    },
  }))

  try {
    await mkdir(packageRoot, { recursive: true })
    await writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify(
        {
          name: "@ai-sdk/openai-compatible",
          version: "3.0.18",
          main: "index.js",
        },
        null,
        2,
      ) + "\n",
    )
    await writeFile(
      path.join(packageRoot, "index.js"),
      [
        "exports.createOpenAICompatible = function createOpenAICompatible() {",
        "  return {",
        "    languageModel() {",
        "      return { provider: 'cached-runtime-sdk' }",
        "    },",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const { BunProc } = await import("#bun/index.ts")
    restoreCacheDir = BunProc.setCacheDirForTesting(runtimeDir)

    const exact = await BunProc.install("@ai-sdk/openai-compatible", "3.0.18")
    expect(exact.version).toBe("3.0.18")
    expect(exact.root).toBe(packageRoot)
    expect(exact.entry).toBe(path.join(packageRoot, "index.js"))

    const latest = await BunProc.install("@ai-sdk/openai-compatible", "latest")
    expect(latest.version).toBe("3.0.18")
    expect(outdatedChecks).toEqual([
      {
        pkg: "@ai-sdk/openai-compatible",
        version: "3.0.18",
      },
    ])

    const loaded = await BunProc.importPackage<{
      createOpenAICompatible: () => {
        languageModel(): { provider: string }
      }
    }>("@ai-sdk/openai-compatible", "3.0.18")

    expect(typeof loaded.module.createOpenAICompatible).toBe("function")
    expect(loaded.module.createOpenAICompatible().languageModel()).toEqual({
      provider: "cached-runtime-sdk",
    })

    const manifest = JSON.parse(await Bun.file(path.join(runtimeDir, "package.json")).text()) as {
      name: string
      dependencies?: Record<string, string>
    }
    expect(manifest.name).toBe("anyboxagent-runtime-cache")
    expect(manifest.dependencies ?? {}).toEqual({})
  } finally {
    restoreCacheDir?.()
    mock.restore()
    await rm(root, { recursive: true, force: true })
  }
})
