import { describe, expect, test } from "bun:test"

import {
  getCinemaRenderRuntimeStatus,
  parseCinemaFFmpegVersion,
  parseCinemaRenderEncoders,
  parseCinemaSubtitleRenderer,
  resolveCinemaRenderRuntimeID,
  resolveLockedCinemaRenderExecutionRuntime,
  selectCinemaRenderExecutionRuntime,
} from "../src/cinema/render-runtime"
import { resolveMediaToolPaths } from "../src/cinema/media-runtime"
import { CinemaRoutes } from "../src/server/routes/cinema"

describe("cinema render runtime", () => {
  test("registers the redacted runtime status endpoint", () => {
    expect(CinemaRoutes().routes.some((route) =>
      route.method === "GET" && route.path === "/render-runtime"
    )).toBe(true)
  })

  test("parses a redacted version and the supported V1 encoders", () => {
    expect(parseCinemaFFmpegVersion("ffmpeg version 7.1.1 Copyright (c) FFmpeg developers\n"))
      .toBe("7.1.1")
    expect(parseCinemaRenderEncoders(`
 V..... libx264              libx264 H.264 / AVC
 V..... h264_mf              H264 via MediaFoundation
 V..... h264_videotoolbox    VideoToolbox H.264 Encoder
 A..... aac                  AAC (Advanced Audio Coding)
    `)).toEqual({
      videoEncoders: ["libx264", "h264_mf", "h264_videotoolbox"],
      audioEncoders: ["aac"],
    })
    expect(parseCinemaSubtitleRenderer(" ... ass               V->V       Render ASS subtitles onto input video using the libass library.")).toBe("libass")
    expect(parseCinemaSubtitleRenderer(" .. ass               V->V       Render ASS subtitles onto input video using the libass library.")).toBe("libass")
  })

  test("discovers tools and returns no executable paths", async () => {
    const status = await getCinemaRenderRuntimeStatus({}, {
      platform: "win32",
      resolveMediaToolPaths: async () => ({
        ffmpeg: "C:\\Private Tools\\ffmpeg.exe",
        ffprobe: "C:\\Private Tools\\ffprobe.exe",
      }),
      runMediaTool: async (executable, args) => {
        if (args.includes("-encoders")) {
          return {
            stdout: " V..... libx264 H.264\n A..... aac AAC\n",
            stderr: "",
          }
        }
        return {
          stdout: executable.includes("ffprobe")
            ? "ffprobe version 7.1.1\n"
            : "ffmpeg version 7.1.1\n",
          stderr: "",
        }
      },
    })

    expect(status).toEqual({
      available: true,
      version: "7.1.1",
      platform: "win32",
      ffprobeAvailable: true,
      videoEncoders: ["libx264"],
      audioEncoders: ["aac"],
      subtitleRenderer: null,
    })
    expect(JSON.stringify(status)).not.toContain("Private Tools")
  })

  test("returns a stable redacted issue when discovery fails", async () => {
    const status = await getCinemaRenderRuntimeStatus({}, {
      platform: "linux",
      resolveMediaToolPaths: async () => {
        throw new Error("Missing /home/private/bin/ffmpeg with SECRET=value")
      },
      runMediaTool: async () => ({ stdout: "", stderr: "" }),
    })

    expect(status).toEqual({
      available: false,
      platform: "linux",
      ffprobeAvailable: false,
      videoEncoders: [],
      audioEncoders: [],
      subtitleRenderer: null,
      issue: "FFmpeg and ffprobe are unavailable or could not be started.",
    })
    expect(JSON.stringify(status)).not.toContain("SECRET")
    expect(JSON.stringify(status)).not.toContain("/home/private")
  })

  test("selects an auditable path-free runtime binding", async () => {
    const dependencies = {
      platform: "win32" as const,
      resolveMediaToolPaths: async () => ({
        ffmpeg: "C:\\Private Tools\\ffmpeg.exe",
        ffprobe: "C:\\Private Tools\\ffprobe.exe",
      }),
      runMediaTool: async (executable: string, args: string[]) => {
        if (args.includes("-encoders")) {
          return { stdout: " V..... libx264 H.264\n V..... h264_mf H.264\n A..... aac AAC\n", stderr: "" }
        }
        return {
          stdout: executable.includes("ffprobe") ? "ffprobe version 7.1.1\n" : "ffmpeg version 7.1.1\n",
          stderr: "",
        }
      },
    }
    const selected = await selectCinemaRenderExecutionRuntime(
      { ANYBOX_MEDIA_RUNTIME_ID: "ffmpeg-win32-reviewed-1" },
      dependencies,
    )

    expect(selected.executionRuntime).toEqual({
      runtimeID: "ffmpeg-win32-reviewed-1",
      ffmpegVersion: "7.1.1",
      platform: "win32",
      videoEncoder: "h264_mf",
      audioEncoder: "aac",
    })
    expect(JSON.stringify(selected.executionRuntime)).not.toContain("Private Tools")
    expect(resolveCinemaRenderRuntimeID({}, "linux", "7.1.1")).toBe("dev-linux-7.1.1")
    const redactedConfiguredID = resolveCinemaRenderRuntimeID(
      { ANYBOX_MEDIA_RUNTIME_ID: "C:\\private\\ffmpeg.exe" },
      "win32",
      "7.1.1",
    )
    expect(redactedConfiguredID).not.toContain("private")
    expect(redactedConfiguredID).not.toContain("\\")
  })

  test("executes the locked encoder and rejects runtime identity drift", async () => {
    const dependencies = {
      platform: "win32" as const,
      resolveMediaToolPaths: async () => ({ ffmpeg: "ffmpeg", ffprobe: "ffprobe" }),
      runMediaTool: async (executable: string, args: string[]) => {
        if (args.includes("-encoders")) {
          return { stdout: " V..... libx264 H.264\n V..... h264_mf H.264\n A..... aac AAC\n", stderr: "" }
        }
        return {
          stdout: executable === "ffprobe" ? "ffprobe version 7.1.1\n" : "ffmpeg version 7.1.1\n",
          stderr: "",
        }
      },
    }
    const locked = {
      runtimeID: "ffmpeg-win32-reviewed-1",
      ffmpegVersion: "7.1.1",
      platform: "win32" as const,
      videoEncoder: "libx264" as const,
      audioEncoder: "aac" as const,
    }
    const resolved = await resolveLockedCinemaRenderExecutionRuntime(
      locked,
      { ANYBOX_MEDIA_RUNTIME_ID: locked.runtimeID },
      dependencies,
    )
    expect(resolved.executionRuntime.videoEncoder).toBe("libx264")

    await expect(resolveLockedCinemaRenderExecutionRuntime(
      locked,
      { ANYBOX_MEDIA_RUNTIME_ID: "different-runtime" },
      dependencies,
    )).rejects.toThrow("locked FFmpeg runtime or encoder")
  })

  test("strict packaged discovery never falls back to PATH or a partial binary pair", async () => {
    await expect(resolveMediaToolPaths({ ANYBOX_MEDIA_RUNTIME_STRICT: "1" }))
      .rejects.toThrow("verified bundled FFmpeg runtime is incomplete")
    await expect(resolveMediaToolPaths({
      ANYBOX_MEDIA_RUNTIME_STRICT: "1",
      ANYBOX_FFMPEG_BINARY: "C:\\unverified\\ffmpeg.exe",
    })).rejects.toThrow("verified bundled FFmpeg runtime is incomplete")
  })
})
