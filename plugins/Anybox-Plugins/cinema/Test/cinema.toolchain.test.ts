import { afterEach, describe, expect, test } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import * as tar from "tar"
import * as Global from "#global/global.ts"
import {
  assertSafeToolchainArchiveEntry,
  cancelToolchainInstall,
  getToolchainStatus,
  importToolchainArchive,
  installToolchain,
  setToolchainLockPathForTest,
} from "../src/platform/toolchain.ts"

const roots: string[] = []
const restores: Array<() => void> = []
const servers: Array<ReturnType<typeof Bun.serve>> = []

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function fixture(options: { paddingBytes?: number; url?: string } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "cinema-toolchain-test-"))
  roots.push(root)
  const content = path.join(root, "content")
  await mkdir(content)
  const ffmpegName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
  const ffprobeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe"
  const ffmpeg = Buffer.from("cinema-test-ffmpeg")
  const ffprobe = Buffer.from("cinema-test-ffprobe")
  await writeFile(path.join(content, ffmpegName), ffmpeg)
  await writeFile(path.join(content, ffprobeName), ffprobe)
  if (options.paddingBytes) await writeFile(path.join(content, "padding.bin"), randomBytes(options.paddingBytes))
  const archive = path.join(root, "cinema-tools.tar.gz")
  await tar.c({ cwd: content, file: archive, gzip: true }, await import("node:fs/promises").then((fs) => fs.readdir(content)))
  const archiveBytes = await readFile(archive)
  const lock = path.join(root, "toolchain.lock.json")
  const target = {
    runtimeID: `cinema-test-${crypto.randomUUID()}`,
    distribution: {
      fileName: path.basename(archive),
      sha256: digest(archiveBytes),
      sizeBytes: archiveBytes.byteLength,
      url: options.url ?? "https://downloads.invalid/cinema-tools.tar.gz",
    },
    executables: { ffmpeg: ffmpegName, ffprobe: ffprobeName },
    binaries: {
      [ffmpegName]: { sha256: digest(ffmpeg) },
      [ffprobeName]: { sha256: digest(ffprobe) },
    },
  }
  await writeFile(lock, JSON.stringify({
    schemaVersion: 1,
    platforms: { [process.platform]: { status: "supported", targets: { [process.arch]: target } } },
  }))
  const data = path.join(root, "data")
  Global.configureRuntimePaths({ data, cache: path.join(root, "cache"), log: path.join(root, "log") })
  restores.push(setToolchainLockPathForTest(lock))
  return { root, archive, archiveBytes, lock, target, data }
}

afterEach(async () => {
  cancelToolchainInstall()
  while (servers.length) servers.pop()?.stop(true)
  while (restores.length) restores.pop()?.()
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

describe("Cinema reviewed media toolchain", () => {
  test("rejects traversal, links, entry-count attacks, and expanded-size attacks", () => {
    expect(() => assertSafeToolchainArchiveEntry("../escape", "File", 1, { entries: 0, unpackedBytes: 0 })).toThrow("unsafe path")
    expect(() => assertSafeToolchainArchiveEntry("link", "SymbolicLink", 1, { entries: 0, unpackedBytes: 0 })).toThrow("link or unsupported")
    expect(() => assertSafeToolchainArchiveEntry("huge", "File", 1024 * 1024 * 1024 + 1, { entries: 0, unpackedBytes: 0 })).toThrow("exceeds")
    expect(() => assertSafeToolchainArchiveEntry("extra", "Directory", 0, { entries: 20_000, unpackedBytes: 0 })).toThrow("exceeds")
  })

  test("imports the exact offline archive and preserves the active version after a digest mismatch", async () => {
    const value = await fixture()
    const installed = await importToolchainArchive(value.archive)
    expect(installed.status).toBe("ready")
    expect((await getToolchainStatus()).status).toBe("ready")

    const lock = JSON.parse(await readFile(value.lock, "utf8"))
    lock.platforms[process.platform].targets[process.arch].distribution.sha256 = "0".repeat(64)
    await writeFile(value.lock, JSON.stringify(lock))
    await expect(importToolchainArchive(value.archive)).rejects.toMatchObject({ code: "TOOLCHAIN_ARCHIVE_INVALID" })
    expect(await stat(path.join(value.data, "toolchains", value.target.runtimeID))).toBeDefined()
  })

  test("keeps a canceled partial download and resumes it with a validated byte range", async () => {
    const value = await fixture({ paddingBytes: 1024 * 1024 })
    const ranges: Array<string | null> = []
    let port = 0
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const range = request.headers.get("range")
        ranges.push(range)
        const start = range ? Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? 0) : 0
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for (let offset = start; offset < value.archiveBytes.byteLength; offset += 16 * 1024) {
                await Bun.sleep(10)
                controller.enqueue(value.archiveBytes.subarray(offset, Math.min(value.archiveBytes.byteLength, offset + 16 * 1024)))
              }
              controller.close()
            } catch (error) {
              controller.error(error)
            }
          },
        })
        return new Response(body, {
          status: start > 0 ? 206 : 200,
          headers: {
            "content-length": String(value.archiveBytes.byteLength - start),
            ...(start > 0 ? { "content-range": `bytes ${start}-${value.archiveBytes.byteLength - 1}/${value.archiveBytes.byteLength}` } : {}),
          },
        })
      },
    })
    servers.push(server)
    port = server.port
    const lock = JSON.parse(await readFile(value.lock, "utf8"))
    lock.platforms[process.platform].targets[process.arch].distribution.url = `http://127.0.0.1:${port}/cinema-tools.tar.gz`
    await writeFile(value.lock, JSON.stringify(lock))

    const first = installToolchain()
    await Bun.sleep(100)
    expect(cancelToolchainInstall()).toEqual({ canceled: true })
    await expect(first).rejects.toBeDefined()
    const partial = path.join(value.root, "cache", "toolchain-downloads", `${path.basename(value.archive)}.partial`)
    const partialSize = (await stat(partial)).size
    expect(partialSize).toBeGreaterThan(0)
    expect(partialSize).toBeLessThan(value.archiveBytes.byteLength)

    expect((await installToolchain()).status).toBe("ready")
    expect(ranges[0]).toBeNull()
    expect(ranges[1]).toBe(`bytes=${partialSize}-`)
  })
})
