import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { resolveInstalledToolchain } from "#platform/toolchain.ts"

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_OUTPUT_LIMIT_BYTES = 512 * 1024

export type CinemaMediaProbe = {
  durationSeconds?: number
  width?: number
  height?: number
  fps?: number
  videoCodec?: string
  audioCodec?: string
  hasAudio: boolean
  formatNames: string[]
  chromiumPlayable: boolean
}

type FFprobeStream = {
  codec_type?: unknown
  codec_name?: unknown
  width?: unknown
  height?: unknown
  duration?: unknown
  avg_frame_rate?: unknown
  r_frame_rate?: unknown
}

type FFprobeDocument = {
  streams?: unknown
  format?: {
    duration?: unknown
    format_name?: unknown
  }
}

export type MediaToolPaths = {
  ffmpeg: string
  ffprobe: string
  runtimeID?: string
  subtitleFontPath?: string
}

let mediaToolPathsOverride: MediaToolPaths | undefined

export type MediaToolRunOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  outputLimitBytes?: number
}

function finitePositive(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function codecName(stream: FFprobeStream | undefined) {
  return typeof stream?.codec_name === "string" ? stream.codec_name.trim().toLowerCase() || undefined : undefined
}

export function parseFrameRate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const text = String(value).trim()
  if (!text) return undefined
  const [numeratorText, denominatorText] = text.split("/", 2)
  const numerator = Number.parseFloat(numeratorText ?? "")
  const denominator = denominatorText === undefined ? 1 : Number.parseFloat(denominatorText)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return undefined
  const valueNumber = numerator / denominator
  return Number.isFinite(valueNumber) && valueNumber > 0 ? valueNumber : undefined
}

const CHROMIUM_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1"])
const CHROMIUM_AUDIO_CODECS = new Set([
  "aac",
  "mp3",
  "opus",
  "vorbis",
  "flac",
  "pcm_s16le",
  "pcm_s24le",
  "pcm_f32le",
  "pcm_u8",
])

export function parseFFprobeDocument(
  document: FFprobeDocument,
  expectedKind: "video" | "audio",
  inputPath?: string,
): CinemaMediaProbe {
  const streams = Array.isArray(document.streams)
    ? document.streams.filter((value): value is FFprobeStream => Boolean(value) && typeof value === "object")
    : []
  const videoStream = streams.find((stream) => stream.codec_type === "video")
  const audioStream = streams.find((stream) => stream.codec_type === "audio")
  const formatDuration = finitePositive(document.format?.duration)
  const streamDuration = finitePositive(videoStream?.duration ?? audioStream?.duration)
  const durationSeconds = formatDuration ?? streamDuration
  const width = finitePositive(videoStream?.width)
  const height = finitePositive(videoStream?.height)
  const fps = parseFrameRate(videoStream?.avg_frame_rate) ?? parseFrameRate(videoStream?.r_frame_rate)
  const videoCodec = codecName(videoStream)
  const audioCodec = codecName(audioStream)
  const formatNames = typeof document.format?.format_name === "string"
    ? document.format.format_name.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)
    : []

  if (expectedKind === "video" && !videoStream) throw new Error("ffprobe did not find a video stream")
  if (expectedKind === "audio" && !audioStream) throw new Error("ffprobe did not find an audio stream")

  const videoPlayable = !videoCodec || CHROMIUM_VIDEO_CODECS.has(videoCodec)
  const audioPlayable = !audioCodec || CHROMIUM_AUDIO_CODECS.has(audioCodec)
  // Chromium does not reliably play the Matroska container even when its
  // elementary streams use otherwise supported codecs. Keep the original MKV
  // and serve a WebM proxy instead.
  const containerPlayable = expectedKind !== "video" || path.extname(inputPath ?? "").toLowerCase() !== ".mkv"
  return {
    ...(durationSeconds ? { durationSeconds } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(fps ? { fps } : {}),
    ...(videoCodec ? { videoCodec } : {}),
    ...(audioCodec ? { audioCodec } : {}),
    hasAudio: Boolean(audioStream),
    formatNames,
    chromiumPlayable: expectedKind === "video" ? videoPlayable && audioPlayable && containerPlayable : audioPlayable,
  }
}

export async function resolveMediaToolPaths(_env: NodeJS.ProcessEnv = process.env): Promise<MediaToolPaths> {
  if (mediaToolPathsOverride) return mediaToolPathsOverride
  const installed = await resolveInstalledToolchain()
  const fontCandidate = path.join(installed.fontsDirectory, "NotoSansCJKsc-Regular.otf")
  return {
    ffmpeg: installed.ffmpeg,
    ffprobe: installed.ffprobe,
    runtimeID: installed.runtimeID,
    ...(fs.existsSync(fontCandidate) ? { subtitleFontPath: fontCandidate } : {}),
  }
}

export function setMediaToolPathsForTest(value: MediaToolPaths | undefined) {
  const previous = mediaToolPathsOverride
  mediaToolPathsOverride = value
  return () => { mediaToolPathsOverride = previous }
}

function appendLimited(current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>, limit: number) {
  if (current.length >= limit) return current
  return Buffer.concat([current, chunk.subarray(0, Math.max(0, limit - current.length))])
}

export async function runMediaTool(
  executable: string,
  args: string[],
  options: MediaToolRunOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const outputLimitBytes = options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES
  if (options.signal?.aborted) throw new DOMException("Media processing was canceled", "AbortError")

  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let settled = false
    let timedOut = false

    const stop = () => {
      if (!child.killed) child.kill("SIGKILL")
    }
    const onAbort = () => stop()
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, timeoutMs)
    timer.unref?.()
    options.signal?.addEventListener("abort", onAbort, { once: true })

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk, outputLimitBytes)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk, outputLimitBytes)
    })
    child.once("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", onAbort)
      reject(error)
    })
    child.once("close", (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", onAbort)
      const output = {
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
      }
      if (options.signal?.aborted) {
        reject(new DOMException("Media processing was canceled", "AbortError"))
      } else if (timedOut) {
        reject(new Error(`Media process exceeded ${timeoutMs}ms`))
      } else if (code !== 0) {
        reject(new Error(`Media process failed (${code ?? signal ?? "unknown"}): ${output.stderr || output.stdout}`))
      } else {
        resolve(output)
      }
    })
  })
}

class SingleConcurrencyQueue {
  private tail: Promise<void> = Promise.resolve()

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      if (signal?.aborted) throw new DOMException("Media processing was canceled", "AbortError")
      return await task()
    } finally {
      release()
    }
  }
}

export const mediaProcessingQueue = new SingleConcurrencyQueue()

export async function probeMediaFile(
  inputPath: string,
  expectedKind: "video" | "audio",
  options: MediaToolRunOptions = {},
) {
  const tools = await resolveMediaToolPaths()
  const result = await runMediaTool(tools.ffprobe, [
    "-v", "error",
    "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height,duration,avg_frame_rate,r_frame_rate",
    "-of", "json",
    inputPath,
  ], { ...options, timeoutMs: options.timeoutMs ?? 30_000 })
  let document: FFprobeDocument
  try {
    document = JSON.parse(result.stdout) as FFprobeDocument
  } catch {
    throw new Error("ffprobe returned invalid JSON")
  }
  return parseFFprobeDocument(document, expectedKind, inputPath)
}

function ensureParent(outputPath: string) {
  return fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
}

export async function createVideoThumbnail(
  inputPath: string,
  outputPath: string,
  durationSeconds: number | undefined,
  options: MediaToolRunOptions = {},
) {
  await ensureParent(outputPath)
  const tools = await resolveMediaToolPaths()
  const seekSeconds = Math.max(0, Math.min(1, (durationSeconds ?? 10) * 0.1))
  return mediaProcessingQueue.run(() => runMediaTool(tools.ffmpeg, [
    "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
    "-ss", seekSeconds.toFixed(3), "-i", inputPath,
    "-frames:v", "1",
    "-vf", "scale=512:512:force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-q:v", "3",
    outputPath,
  ], options), options.signal)
}

export async function createImageThumbnail(
  inputPath: string,
  outputPath: string,
  options: MediaToolRunOptions = {},
) {
  await ensureParent(outputPath)
  const tools = await resolveMediaToolPaths()
  return mediaProcessingQueue.run(() => runMediaTool(tools.ffmpeg, [
    "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
    "-i", inputPath,
    "-frames:v", "1",
    "-vf", "scale=512:512:force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-q:v", "3",
    outputPath,
  ], { ...options, timeoutMs: options.timeoutMs ?? 30_000 }), options.signal)
}

export async function createVideoPreviewProxy(
  inputPath: string,
  outputPath: string,
  options: MediaToolRunOptions = {},
) {
  await ensureParent(outputPath)
  const tools = await resolveMediaToolPaths()
  return mediaProcessingQueue.run(() => runMediaTool(tools.ffmpeg, [
    "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
    "-i", inputPath,
    "-vf", "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-deadline", "good",
    "-c:a", "libopus", "-b:a", "128k",
    outputPath,
  ], { ...options, timeoutMs: options.timeoutMs ?? 2 * 60 * 60 * 1000 }), options.signal)
}

export async function createAudioPreviewProxy(
  inputPath: string,
  outputPath: string,
  options: MediaToolRunOptions = {},
) {
  await ensureParent(outputPath)
  const tools = await resolveMediaToolPaths()
  return mediaProcessingQueue.run(() => runMediaTool(tools.ffmpeg, [
    "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
    "-i", inputPath,
    "-vn", "-c:a", "libopus", "-b:a", "128k",
    outputPath,
  ], { ...options, timeoutMs: options.timeoutMs ?? 60 * 60 * 1000 }), options.signal)
}

export function normalizeWaveformPeaks(samples: readonly number[], sampleCount = 256) {
  const count = Math.max(1, Math.min(2048, Math.floor(sampleCount)))
  const peaks = Array.from({ length: count }, () => 0)
  if (samples.length === 0) return peaks
  for (let index = 0; index < samples.length; index += 1) {
    const bucket = Math.min(count - 1, Math.floor(index / samples.length * count))
    peaks[bucket] = Math.max(peaks[bucket]!, Math.abs(samples[index] ?? 0))
  }
  const maximum = Math.max(...peaks, 0)
  if (maximum <= 0) return peaks
  return peaks.map((peak) => Math.min(1, peak / maximum))
}

export async function extractAudioWaveformPeaks(
  inputPath: string,
  sampleCount = 256,
  options: MediaToolRunOptions = {},
) {
  const tools = await resolveMediaToolPaths()
  const outputLimitBytes = options.outputLimitBytes ?? 16 * 1024 * 1024
  const timeoutMs = options.timeoutMs ?? 120_000
  return await mediaProcessingQueue.run(() => new Promise<number[]>((resolve, reject) => {
    const child = spawn(tools.ffmpeg, [
      "-hide_banner", "-nostdin", "-loglevel", "error",
      "-i", inputPath,
      "-map", "0:a:0",
      "-vn", "-ac", "1", "-ar", "200",
      "-f", "f32le", "pipe:1",
    ], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    const chunks: Buffer[] = []
    let bytes = 0
    let stderr = ""
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", abort)
      callback()
    }
    const abort = () => child.kill("SIGKILL")
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs)
    timer.unref?.()
    options.signal?.addEventListener("abort", abort, { once: true })
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > outputLimitBytes) {
        child.kill("SIGKILL")
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8") })
    child.on("error", (error) => finish(() => reject(error)))
    child.on("close", (code) => finish(() => {
      if (options.signal?.aborted) return reject(new DOMException("Waveform extraction was canceled", "AbortError"))
      if (bytes > outputLimitBytes) return reject(new Error("Waveform PCM output exceeded the safety limit"))
      if (code !== 0) return reject(new Error(stderr.trim() || `FFmpeg waveform extraction exited with code ${code}`))
      const buffer = Buffer.concat(chunks)
      const samples: number[] = []
      for (let offset = 0; offset + 4 <= buffer.length; offset += 4) samples.push(buffer.readFloatLE(offset))
      resolve(normalizeWaveformPeaks(samples, sampleCount))
    }))
  }), options.signal)
}
