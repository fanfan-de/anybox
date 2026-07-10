import { spawn } from "node:child_process"
import { stat, rm } from "node:fs/promises"

import type {
  CinemaRenderErrorCode,
  CinemaRenderSettings,
} from "@anybox/shared/cinema-render"

import { parseFFprobeDocument, runMediaTool } from "#cinema/media-runtime.ts"
import type { CinemaRenderPlan } from "#cinema/render-graph.ts"

const DEFAULT_RENDER_TIMEOUT_MS = 24 * 60 * 60 * 1_000
const DEFAULT_STDERR_LIMIT_BYTES = 512 * 1024
const CANCEL_FORCE_TIMEOUT_MS = 3_000

export type CinemaRenderProgressUpdate = {
  renderedUs: number
  percent: number
}

export type CinemaRenderOutputProbe = {
  durationSeconds: number
  width: number
  height: number
  fps: number
  videoCodec: string
  audioCodec: string
  hasAudio: true
  sizeBytes: number
}

export class CinemaRenderRunnerError extends Error {
  readonly code: CinemaRenderErrorCode
  readonly retryable: boolean

  constructor(code: CinemaRenderErrorCode, message: string, retryable: boolean) {
    super(message)
    this.name = "CinemaRenderRunnerError"
    this.code = code
    this.retryable = retryable
  }
}

function limitedAppend(
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike>,
  limit: number,
) {
  if (current.length >= limit) return current
  return Buffer.concat([current, chunk.subarray(0, Math.max(0, limit - current.length))])
}

export function parseCinemaFFmpegProgress(
  values: Readonly<Record<string, string>>,
  outputDurationUs: number,
): CinemaRenderProgressUpdate | undefined {
  const raw = values.out_time_us ?? values.out_time_ms
  if (!raw) return undefined
  const renderedUs = Math.max(0, Math.min(outputDurationUs, Number.parseInt(raw, 10)))
  if (!Number.isFinite(renderedUs)) return undefined
  return {
    renderedUs,
    percent: outputDurationUs > 0
      ? Math.max(0, Math.min(100, renderedUs / outputDurationUs * 100))
      : 0,
  }
}

export function createCinemaRenderProgressThrottle(
  emit: (progress: CinemaRenderProgressUpdate) => void,
  now: () => number = () => Date.now(),
) {
  let lastEmittedAt = Number.NEGATIVE_INFINITY
  let lastPercent = Number.NEGATIVE_INFINITY
  let lastRenderedUs = Number.NEGATIVE_INFINITY
  return (progress: CinemaRenderProgressUpdate, force = false) => {
    const timestamp = now()
    if (progress.percent === lastPercent && progress.renderedUs === lastRenderedUs) return false
    if (
      !force
      && timestamp - lastEmittedAt < 250
    ) return false
    if (!force && progress.percent < 100 && progress.percent - lastPercent < 1) return false
    lastEmittedAt = timestamp
    lastPercent = progress.percent
    lastRenderedUs = progress.renderedUs
    emit(progress)
    return true
  }
}

export async function validateCinemaRenderOutput(input: {
  ffprobePath: string
  outputPath: string
  settings: CinemaRenderSettings
  outputDurationUs: number
}): Promise<CinemaRenderOutputProbe> {
  let result: Awaited<ReturnType<typeof runMediaTool>>
  try {
    result = await runMediaTool(input.ffprobePath, [
      "-v", "error",
      "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height,duration,avg_frame_rate,r_frame_rate",
      "-of", "json",
      input.outputPath,
    ], { timeoutMs: 30_000 })
  } catch {
    throw new CinemaRenderRunnerError("output-validation-failed", "Rendered output could not be probed.", true)
  }
  let document: Parameters<typeof parseFFprobeDocument>[0]
  try {
    document = JSON.parse(result.stdout) as Parameters<typeof parseFFprobeDocument>[0]
  } catch {
    throw new CinemaRenderRunnerError("output-validation-failed", "Rendered output metadata is invalid.", true)
  }
  let probe: ReturnType<typeof parseFFprobeDocument>
  try {
    probe = parseFFprobeDocument(document, "video")
  } catch {
    throw new CinemaRenderRunnerError("output-validation-failed", "Rendered output streams are invalid.", true)
  }
  const expectedDurationSeconds = input.outputDurationUs / 1_000_000
  const frameDurationSeconds = input.settings.frameRate.denominator / input.settings.frameRate.numerator
  const durationTolerance = Math.max(0.1, frameDurationSeconds * 2)
  const expectedFps = input.settings.frameRate.numerator / input.settings.frameRate.denominator
  const info = await stat(input.outputPath).catch(() => undefined)
  if (
    !info?.isFile()
    || info.size <= 0
    || probe.durationSeconds === undefined
    || Math.abs(probe.durationSeconds - expectedDurationSeconds) > durationTolerance
    || probe.width !== input.settings.width
    || probe.height !== input.settings.height
    || probe.fps === undefined
    || Math.abs(probe.fps - expectedFps) > 0.02
    || probe.videoCodec !== "h264"
    || probe.audioCodec !== "aac"
    || !probe.hasAudio
  ) {
    throw new CinemaRenderRunnerError(
      "output-validation-failed",
      "Rendered output does not match the requested duration, dimensions, frame rate, or codecs.",
      true,
    )
  }
  return {
    durationSeconds: probe.durationSeconds,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
    hasAudio: true,
    sizeBytes: info.size,
  }
}

export async function runCinemaRenderPlan(input: {
  ffmpegPath: string
  ffprobePath: string
  outputPath: string
  plan: CinemaRenderPlan
  settings: CinemaRenderSettings
  signal?: AbortSignal
  timeoutMs?: number
  stderrLimitBytes?: number
  onProgress?: (progress: CinemaRenderProgressUpdate) => void
}): Promise<CinemaRenderOutputProbe> {
  if (input.signal?.aborted) {
    throw new CinemaRenderRunnerError("render-canceled", "Render was canceled.", true)
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS
  const stderrLimit = input.stderrLimitBytes ?? DEFAULT_STDERR_LIMIT_BYTES
  const emitProgress = createCinemaRenderProgressThrottle(input.onProgress ?? (() => undefined))

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(input.ffmpegPath, input.plan.args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
      let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
      let stdoutBuffer = ""
      let progressValues: Record<string, string> = {}
      let settled = false
      let timedOut = false
      let forceTimer: ReturnType<typeof setTimeout> | undefined

      const stop = () => {
        if (settled) return
        child.kill("SIGTERM")
        forceTimer = setTimeout(() => {
          if (!settled) child.kill("SIGKILL")
        }, CANCEL_FORCE_TIMEOUT_MS)
        forceTimer.unref?.()
      }
      const onAbort = () => stop()
      const timer = setTimeout(() => {
        timedOut = true
        stop()
      }, timeoutMs)
      timer.unref?.()
      input.signal?.addEventListener("abort", onAbort, { once: true })

      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (forceTimer) clearTimeout(forceTimer)
        input.signal?.removeEventListener("abort", onAbort)
        callback()
      }
      const processProgressLine = (line: string) => {
        const separator = line.indexOf("=")
        if (separator <= 0) return
        progressValues[line.slice(0, separator)] = line.slice(separator + 1)
        if (line.startsWith("progress=")) {
          const parsed = parseCinemaFFmpegProgress(progressValues, input.plan.outputDurationUs)
          if (parsed) emitProgress(parsed, progressValues.progress === "end")
          progressValues = {}
        }
      }

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf8")
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() ?? ""
        lines.forEach(processProgressLine)
      })
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = limitedAppend(stderr, chunk, stderrLimit)
      })
      child.once("error", () => finish(() => reject(new CinemaRenderRunnerError(
        "render-start-failed",
        "FFmpeg could not be started.",
        true,
      ))))
      child.once("close", (code) => finish(() => {
        if (input.signal?.aborted) {
          reject(new CinemaRenderRunnerError("render-canceled", "Render was canceled.", true))
        } else if (timedOut) {
          reject(new CinemaRenderRunnerError("render-timeout", "Render exceeded its time limit.", true))
        } else if (code !== 0) {
          reject(new CinemaRenderRunnerError(
            "render-failed",
            `FFmpeg exited with code ${code ?? "unknown"}.`,
            true,
          ))
        } else {
          emitProgress({ renderedUs: input.plan.outputDurationUs, percent: 100 }, true)
          resolve()
        }
      }))
    })

    return await validateCinemaRenderOutput({
      ffprobePath: input.ffprobePath,
      outputPath: input.outputPath,
      settings: input.settings,
      outputDurationUs: input.plan.outputDurationUs,
    })
  } catch (error) {
    await rm(input.outputPath, { force: true }).catch(() => undefined)
    if (error instanceof CinemaRenderRunnerError) throw error
    throw new CinemaRenderRunnerError("render-failed", "Render failed unexpectedly.", true)
  }
}
