import { createHash } from "node:crypto"

import {
  CinemaRenderExecutionRuntimeSchema,
  CinemaRenderRuntimeIDSchema,
  CinemaRenderRuntimeStatusSchema,
  type CinemaRenderExecutionRuntime,
  type CinemaRenderRuntimeStatus,
} from "@anybox/shared/cinema-render"

import {
  resolveMediaToolPaths,
  runMediaTool,
  type MediaToolPaths,
} from "#cinema/media-runtime.ts"

const RUNTIME_PROBE_TIMEOUT_MS = 10_000
const RUNTIME_PROBE_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024

type SupportedPlatform = CinemaRenderRuntimeStatus["platform"]

export type CinemaRenderRuntimeDependencies = {
  platform: SupportedPlatform
  resolveMediaToolPaths: (env?: NodeJS.ProcessEnv) => Promise<MediaToolPaths>
  runMediaTool: typeof runMediaTool
}

function supportedPlatform(platform: NodeJS.Platform): SupportedPlatform {
  if (platform === "win32" || platform === "darwin") return platform
  return "linux"
}

const defaultDependencies: CinemaRenderRuntimeDependencies = {
  platform: supportedPlatform(process.platform),
  resolveMediaToolPaths,
  runMediaTool,
}

export function parseCinemaFFmpegVersion(output: string) {
  return /(?:^|\n)ffmpeg version\s+([^\s]+)/i.exec(output)?.[1]
}

export function parseCinemaRenderEncoders(output: string) {
  const videoEncoders: CinemaRenderRuntimeStatus["videoEncoders"] = []
  const audioEncoders: CinemaRenderRuntimeStatus["audioEncoders"] = []

  if (/\blibx264\b/.test(output)) videoEncoders.push("libx264")
  if (/\bh264_mf\b/.test(output)) videoEncoders.push("h264_mf")
  if (/\bh264_videotoolbox\b/.test(output)) videoEncoders.push("h264_videotoolbox")
  if (/^\s*A[^\n]*\baac\b/m.test(output)) audioEncoders.push("aac")

  return { videoEncoders, audioEncoders }
}

function stableRuntimeUnavailable(platform: SupportedPlatform) {
  return CinemaRenderRuntimeStatusSchema.parse({
    available: false,
    platform,
    ffprobeAvailable: false,
    videoEncoders: [],
    audioEncoders: [],
    issue: "FFmpeg and ffprobe are unavailable or could not be started.",
  })
}

async function probeCinemaRenderRuntime(
  env: NodeJS.ProcessEnv,
  dependencies: CinemaRenderRuntimeDependencies,
) {
  const tools = await dependencies.resolveMediaToolPaths(env)
  const options = {
    timeoutMs: RUNTIME_PROBE_TIMEOUT_MS,
    outputLimitBytes: RUNTIME_PROBE_OUTPUT_LIMIT_BYTES,
  }
  const [ffmpegVersion, ffprobeVersion, encoderList] = await Promise.all([
    dependencies.runMediaTool(tools.ffmpeg, ["-hide_banner", "-version"], options),
    dependencies.runMediaTool(tools.ffprobe, ["-hide_banner", "-version"], options),
    dependencies.runMediaTool(tools.ffmpeg, ["-hide_banner", "-encoders"], options),
  ])
  const encoderOutput = `${encoderList.stdout}\n${encoderList.stderr}`
  const encoders = parseCinemaRenderEncoders(encoderOutput)
  const version = parseCinemaFFmpegVersion(`${ffmpegVersion.stdout}\n${ffmpegVersion.stderr}`)
  const status = CinemaRenderRuntimeStatusSchema.parse({
    available: true,
    ...(version ? { version } : {}),
    platform: dependencies.platform,
    ffprobeAvailable: Boolean(ffprobeVersion.stdout || ffprobeVersion.stderr),
    ...encoders,
  })
  return { status, tools }
}

export function chooseCinemaRenderVideoEncoder(runtime: CinemaRenderRuntimeStatus) {
  if (runtime.platform === "win32" && runtime.videoEncoders.includes("h264_mf")) return "h264_mf" as const
  if (runtime.platform === "darwin" && runtime.videoEncoders.includes("h264_videotoolbox")) {
    return "h264_videotoolbox" as const
  }
  if (runtime.videoEncoders.includes("libx264")) return "libx264" as const
  return runtime.videoEncoders[0]
}

function runtimeIDDigest(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20)
}

export function resolveCinemaRenderRuntimeID(
  env: NodeJS.ProcessEnv,
  platform: SupportedPlatform,
  ffmpegVersion: string,
) {
  const configured = env.ANYBOX_MEDIA_RUNTIME_ID?.trim()
  if (configured) {
    const parsed = CinemaRenderRuntimeIDSchema.safeParse(configured)
    return parsed.success
      ? parsed.data
      : `runtime-${platform}-${runtimeIDDigest(`configured\0${configured}`)}`
  }
  const developmentID = `dev-${platform}-${ffmpegVersion}`
  const parsed = CinemaRenderRuntimeIDSchema.safeParse(developmentID)
  return parsed.success
    ? parsed.data
    : `runtime-${platform}-${runtimeIDDigest(`development\0${platform}\0${ffmpegVersion}`)}`
}

function bindProbedRuntime(
  status: CinemaRenderRuntimeStatus,
  env: NodeJS.ProcessEnv,
): CinemaRenderExecutionRuntime {
  const videoEncoder = chooseCinemaRenderVideoEncoder(status)
  if (
    !status.available
    || !status.ffprobeAvailable
    || !status.version
    || !videoEncoder
    || !status.audioEncoders.includes("aac")
  ) {
    throw new Error("Required FFmpeg runtime and encoders are unavailable.")
  }
  return CinemaRenderExecutionRuntimeSchema.parse({
    runtimeID: resolveCinemaRenderRuntimeID(env, status.platform, status.version),
    ffmpegVersion: status.version,
    platform: status.platform,
    videoEncoder,
    audioEncoder: "aac",
  })
}

export type CinemaRenderRuntimeSelection = {
  executionRuntime: CinemaRenderExecutionRuntime
  tools: MediaToolPaths
}

export async function selectCinemaRenderExecutionRuntime(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: CinemaRenderRuntimeDependencies = defaultDependencies,
): Promise<CinemaRenderRuntimeSelection> {
  try {
    const { status, tools } = await probeCinemaRenderRuntime(env, dependencies)
    return { executionRuntime: bindProbedRuntime(status, env), tools }
  } catch {
    throw new Error("Required FFmpeg runtime and encoders are unavailable.")
  }
}

export async function resolveLockedCinemaRenderExecutionRuntime(
  lockedRuntime: CinemaRenderExecutionRuntime,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: CinemaRenderRuntimeDependencies = defaultDependencies,
): Promise<CinemaRenderRuntimeSelection> {
  try {
    const expected = CinemaRenderExecutionRuntimeSchema.parse(lockedRuntime)
    const { status, tools } = await probeCinemaRenderRuntime(env, dependencies)
    const currentRuntimeID = status.version
      ? resolveCinemaRenderRuntimeID(env, status.platform, status.version)
      : undefined
    if (
      !status.available
      || !status.ffprobeAvailable
      || status.platform !== expected.platform
      || status.version !== expected.ffmpegVersion
      || currentRuntimeID !== expected.runtimeID
      || !status.videoEncoders.includes(expected.videoEncoder)
      || !status.audioEncoders.includes(expected.audioEncoder)
    ) {
      throw new Error("runtime-mismatch")
    }
    return { executionRuntime: expected, tools }
  } catch {
    throw new Error("The locked FFmpeg runtime or encoder is no longer available.")
  }
}

export async function getCinemaRenderRuntimeStatus(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: CinemaRenderRuntimeDependencies = defaultDependencies,
): Promise<CinemaRenderRuntimeStatus> {
  try {
    return (await probeCinemaRenderRuntime(env, dependencies)).status
  } catch {
    return stableRuntimeUnavailable(dependencies.platform)
  }
}
