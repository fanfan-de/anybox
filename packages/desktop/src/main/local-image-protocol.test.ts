import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path, { join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { toLocalImageProtocolUrl, toLocalVideoProtocolUrl } from "../shared/local-image-protocol"
import {
  getLocalImageMimeType,
  getLocalVideoMimeType,
  LOCAL_IMAGE_PROTOCOL_SCHEMES,
  resolveLocalImageProtocolRequest,
  resolveLocalVideoProtocolRequest,
  handleLocalVideoProtocolRequest,
} from "./local-image-protocol"

const tempDirectories: string[] = []

async function createFixtureDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "desktop-local-image-protocol-"))
  tempDirectories.push(directory)
  return directory
}

function requestUrlForSource(source: string) {
  const url = toLocalImageProtocolUrl(source)
  if (!url) throw new Error(`Invalid fixture source: ${source}`)
  return url
}

function videoRequestUrlForSource(source: string) {
  const url = toLocalVideoProtocolUrl(source)
  if (!url) throw new Error(`Invalid fixture source: ${source}`)
  return url
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("local image protocol", () => {
  it("registers only the video scheme for streaming media", () => {
    expect(LOCAL_IMAGE_PROTOCOL_SCHEMES).toEqual([
      {
        scheme: "anybox-local-image",
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
        },
      },
      {
        scheme: "anybox-local-video",
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
        },
      },
    ])
  })

  it("decodes URL-encoded absolute Windows paths before creating protocol URLs", () => {
    expect(toLocalImageProtocolUrl("C:/新建文件夹%20(12)/verify-start.png")).toBe(
      `anybox-local-image://image?source=${encodeURIComponent("C:/新建文件夹 (12)/verify-start.png")}`,
    )
  })

  it("normalizes URL-style slash-prefixed Windows paths before creating protocol URLs", () => {
    expect(toLocalImageProtocolUrl("/C:/新建文件夹 (12)/verify-start.png")).toBe(
      `anybox-local-image://image?source=${encodeURIComponent("C:/新建文件夹 (12)/verify-start.png")}`,
    )
  })

  it.runIf(process.platform === "win32")(
    "loads a slash-prefixed Windows image path through the protocol resolver",
    async () => {
      const directory = await createFixtureDirectory()
      const imagePath = join(directory, "slash-prefixed.png")
      await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      const slashPrefixedPath = `/${imagePath.replace(/\\/g, "/")}`

      await expect(resolveLocalImageProtocolRequest(requestUrlForSource(slashPrefixedPath))).resolves.toEqual({
        ok: true,
        filePath: path.resolve(imagePath),
        mimeType: "image/png",
        size: 4,
      })
    },
  )

  it("resolves a valid raster image absolute path", async () => {
    const directory = await createFixtureDirectory()
    const imagePath = join(directory, "image.png")
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    await expect(resolveLocalImageProtocolRequest(requestUrlForSource(imagePath))).resolves.toEqual({
      ok: true,
      filePath: path.resolve(imagePath),
      mimeType: "image/png",
      size: 4,
    })
  })

  it("resolves a valid raster image file URL", async () => {
    const directory = await createFixtureDirectory()
    const imagePath = join(directory, "image.jpg")
    await writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff]))

    await expect(resolveLocalImageProtocolRequest(requestUrlForSource(pathToFileURL(imagePath).toString()))).resolves.toMatchObject({
      ok: true,
      filePath: path.resolve(imagePath),
      mimeType: "image/jpeg",
    })
  })

  it("rejects unsupported image extensions", async () => {
    const directory = await createFixtureDirectory()
    const imagePath = join(directory, "image.svg")
    await writeFile(imagePath, "<svg />")

    await expect(resolveLocalImageProtocolRequest(requestUrlForSource(imagePath))).resolves.toMatchObject({
      ok: false,
      status: 415,
    })
  })

  it("rejects non-image files", async () => {
    const directory = await createFixtureDirectory()
    const textPath = join(directory, "notes.txt")
    await writeFile(textPath, "not an image")

    await expect(resolveLocalImageProtocolRequest(requestUrlForSource(textPath))).resolves.toMatchObject({
      ok: false,
      status: 415,
    })
  })

  it("rejects directories", async () => {
    const directory = await createFixtureDirectory()
    const nestedDirectory = join(directory, "image.png")
    await mkdir(nestedDirectory)

    await expect(resolveLocalImageProtocolRequest(requestUrlForSource(nestedDirectory))).resolves.toMatchObject({
      ok: false,
      status: 400,
    })
  })

  it("rejects relative sources", async () => {
    await expect(
      resolveLocalImageProtocolRequest("anybox-local-image://image?source=relative%2Fimage.png"),
    ).resolves.toMatchObject({
      ok: false,
      status: 400,
    })
  })

  it("rejects oversized images", async () => {
    const directory = await createFixtureDirectory()
    const imagePath = join(directory, "image.webp")
    await writeFile(imagePath, Buffer.from([1, 2, 3]))

    await expect(resolveLocalImageProtocolRequest(requestUrlForSource(imagePath), { maxBytes: 2 })).resolves.toMatchObject({
      ok: false,
      status: 413,
    })
  })

  it("rejects missing files", async () => {
    const directory = await createFixtureDirectory()
    const imagePath = join(directory, "missing.png")

    await expect(resolveLocalImageProtocolRequest(requestUrlForSource(imagePath))).resolves.toMatchObject({
      ok: false,
      status: 404,
    })
  })

  it("maps allowed raster extensions to content types", () => {
    expect(getLocalImageMimeType("a.avif")).toBe("image/avif")
    expect(getLocalImageMimeType("a.bmp")).toBe("image/bmp")
    expect(getLocalImageMimeType("a.gif")).toBe("image/gif")
    expect(getLocalImageMimeType("a.ico")).toBe("image/x-icon")
    expect(getLocalImageMimeType("a.jpeg")).toBe("image/jpeg")
    expect(getLocalImageMimeType("a.jpg")).toBe("image/jpeg")
    expect(getLocalImageMimeType("a.png")).toBe("image/png")
    expect(getLocalImageMimeType("a.webp")).toBe("image/webp")
    expect(getLocalImageMimeType("a.svg")).toBeNull()
  })

  it("resolves valid local video absolute paths", async () => {
    const directory = await createFixtureDirectory()
    const videoPath = join(directory, "clip.mp4")
    await writeFile(videoPath, Buffer.from([0, 1, 2, 3, 4, 5]))

    await expect(resolveLocalVideoProtocolRequest(videoRequestUrlForSource(videoPath))).resolves.toEqual({
      ok: true,
      filePath: path.resolve(videoPath),
      mimeType: "video/mp4",
      size: 6,
    })
  })

  it("streams byte ranges for video previews", async () => {
    const directory = await createFixtureDirectory()
    const videoPath = join(directory, "clip.webm")
    await writeFile(videoPath, Buffer.from([0, 1, 2, 3, 4, 5]))

    const response = await handleLocalVideoProtocolRequest(new Request(videoRequestUrlForSource(videoPath), {
      headers: {
        range: "bytes=2-4",
      },
    }))

    expect(response.status).toBe(206)
    expect(response.headers.get("accept-ranges")).toBe("bytes")
    expect(response.headers.get("content-range")).toBe("bytes 2-4/6")
    expect(response.headers.get("content-length")).toBe("3")
    expect(response.headers.get("content-type")).toBe("video/webm")
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([2, 3, 4])
  })

  it("maps allowed video extensions to content types", () => {
    expect(getLocalVideoMimeType("a.m4v")).toBe("video/mp4")
    expect(getLocalVideoMimeType("a.mov")).toBe("video/quicktime")
    expect(getLocalVideoMimeType("a.mp4")).toBe("video/mp4")
    expect(getLocalVideoMimeType("a.ogg")).toBe("video/ogg")
    expect(getLocalVideoMimeType("a.ogv")).toBe("video/ogg")
    expect(getLocalVideoMimeType("a.webm")).toBe("video/webm")
    expect(getLocalVideoMimeType("a.avi")).toBeNull()
  })
})
