import { createHash } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || !value) throw new Error("Arguments must use --key value pairs")
    values.set(key.slice(2), value)
  }
  for (const key of ["platform", "arch", "stage", "archive", "source", "recipe", "output", "revision"]) {
    if (!values.get(key)) throw new Error(`Missing --${key}`)
  }
  const args = Object.fromEntries(values)
  if (
    args.platform === "linux"
    && (!args["x264-source"] || !args["x264-revision"] || !args["zlib-source"] || !args["zlib-version"])
  ) {
    throw new Error("Linux candidates require pinned x264 and zlib source arguments")
  }
  return args
}

async function sha256(filePath) {
  const hash = createHash("sha256")
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

function probeSummary(document, label) {
  const streams = Array.isArray(document.streams) ? document.streams : []
  const video = streams.find((stream) => stream?.codec_type === "video")
  const audio = streams.find((stream) => stream?.codec_type === "audio")
  const durationSeconds = Number.parseFloat(document.format?.duration ?? "")
  if (video?.codec_name !== "h264") throw new Error(`${label} evidence has no H.264 video stream`)
  if (!Number.isFinite(durationSeconds) || Math.abs(durationSeconds - 1) > 0.25) {
    throw new Error(`${label} evidence duration does not match the required one-second smoke`)
  }
  return {
    durationSeconds,
    videoCodec: video.codec_name,
    ...(audio?.codec_name ? { audioCodec: audio.codec_name } : {}),
  }
}

async function describedFile(filePath, relativeTo) {
  const stat = await fsp.stat(filePath)
  return {
    fileName: path.relative(relativeTo, filePath).split(path.sep).join("/"),
    sizeBytes: stat.size,
    sha256: await sha256(filePath),
  }
}

const args = parseArguments(process.argv.slice(2))
const executableNames = args.platform === "win32"
  ? { ffmpeg: "ffmpeg.exe", ffprobe: "ffprobe.exe" }
  : { ffmpeg: "ffmpeg", ffprobe: "ffprobe" }
const artifactPaths = {
  archive: path.resolve(args.archive),
  ffmpeg: path.resolve(args.stage, executableNames.ffmpeg),
  ffprobe: path.resolve(args.stage, executableNames.ffprobe),
  license: path.resolve(args.stage, "LICENSE.txt"),
  notices: path.resolve(args.stage, "THIRD-PARTY-NOTICES.txt"),
  configure: path.resolve(args.stage, "configure.txt"),
  source: path.resolve(args.source),
  buildRecipe: path.resolve(args.recipe),
  sourceMetadata: path.resolve(args.stage, "SOURCE.txt"),
  subtitleFont: path.resolve(args.stage, "fonts", "NotoSansCJKsc-Regular.otf"),
  subtitleFontLicense: path.resolve(args.stage, "fonts", "OFL-1.1.txt"),
  smokeVideo: path.resolve(args.stage, "evidence", "smoke.mp4"),
  smokeProbe: path.resolve(args.stage, "evidence", "smoke.ffprobe.json"),
  subtitleSmokeVideo: path.resolve(args.stage, "evidence", "subtitle-smoke.mp4"),
  subtitleSmokeProbe: path.resolve(args.stage, "evidence", "subtitle-smoke.ffprobe.json"),
  subtitleSmokeScript: path.resolve(args.stage, "evidence", "subtitle-smoke.ass"),
  subtitleSmokeFrame: path.resolve(args.stage, "evidence", "subtitle-smoke.png"),
}
if (args.platform === "linux") {
  artifactPaths.x264Source = path.resolve(args["x264-source"])
  artifactPaths.x264License = path.resolve(args.stage, "X264-LICENSE.txt")
  artifactPaths.zlibSource = path.resolve(args["zlib-source"])
  artifactPaths.zlibLicense = path.resolve(args.stage, "ZLIB-LICENSE.txt")
}
for (const [label, filePath] of Object.entries(artifactPaths)) {
  const stat = await fsp.stat(filePath).catch(() => undefined)
  if (!stat?.isFile()) throw new Error(`Candidate is missing ${label}: ${filePath}`)
}

const archiveStat = await fsp.stat(artifactPaths.archive)
const sourceStat = await fsp.stat(artifactPaths.source)
const recipeStat = await fsp.stat(artifactPaths.buildRecipe)
const x264SourceStat = artifactPaths.x264Source ? await fsp.stat(artifactPaths.x264Source) : undefined
const zlibSourceStat = artifactPaths.zlibSource ? await fsp.stat(artifactPaths.zlibSource) : undefined
const smokeProbe = probeSummary(JSON.parse(await fsp.readFile(artifactPaths.smokeProbe, "utf8")), "Render smoke")
if (smokeProbe.audioCodec !== "aac") throw new Error("Render smoke evidence has no AAC audio stream")
const subtitleSmokeProbe = probeSummary(JSON.parse(await fsp.readFile(artifactPaths.subtitleSmokeProbe, "utf8")), "Subtitle smoke")
if (subtitleSmokeProbe.audioCodec !== undefined) throw new Error("Subtitle smoke evidence unexpectedly contains audio")
const candidate = {
  schemaVersion: 1,
  classification: "unapproved-candidate",
  platform: args.platform,
  arch: args.arch,
  ffmpegRevision: args.revision,
  archive: {
    fileName: path.basename(artifactPaths.archive),
    sizeBytes: archiveStat.size,
    sha256: await sha256(artifactPaths.archive),
  },
  executables: executableNames,
  binaries: {
    [executableNames.ffmpeg]: { sha256: await sha256(artifactPaths.ffmpeg) },
    [executableNames.ffprobe]: { sha256: await sha256(artifactPaths.ffprobe) },
  },
  materials: {
    license: { fileName: "LICENSE.txt", sha256: await sha256(artifactPaths.license) },
    notices: { fileName: "THIRD-PARTY-NOTICES.txt", sha256: await sha256(artifactPaths.notices) },
    configure: { fileName: "configure.txt", sha256: await sha256(artifactPaths.configure) },
    source: {
      fileName: path.basename(artifactPaths.source),
      sizeBytes: sourceStat.size,
      sha256: await sha256(artifactPaths.source),
    },
    buildRecipe: {
      fileName: path.basename(artifactPaths.buildRecipe),
      sizeBytes: recipeStat.size,
      sha256: await sha256(artifactPaths.buildRecipe),
    },
    sourceMetadata: { fileName: "SOURCE.txt", sha256: await sha256(artifactPaths.sourceMetadata) },
    subtitleFont: { fileName: "fonts/NotoSansCJKsc-Regular.otf", sha256: await sha256(artifactPaths.subtitleFont) },
    subtitleFontLicense: { fileName: "fonts/OFL-1.1.txt", sha256: await sha256(artifactPaths.subtitleFontLicense) },
    ...(artifactPaths.x264Source ? {
      componentSources: {
        x264: {
          revision: args["x264-revision"],
          fileName: path.basename(artifactPaths.x264Source),
          sizeBytes: x264SourceStat.size,
          sha256: await sha256(artifactPaths.x264Source),
        },
        zlib: {
          version: args["zlib-version"],
          fileName: path.basename(artifactPaths.zlibSource),
          sizeBytes: zlibSourceStat.size,
          sha256: await sha256(artifactPaths.zlibSource),
        },
      },
      componentLicenses: {
        x264: {
          fileName: "X264-LICENSE.txt",
          sizeBytes: (await fsp.stat(artifactPaths.x264License)).size,
          sha256: await sha256(artifactPaths.x264License),
        },
        zlib: {
          fileName: "ZLIB-LICENSE.txt",
          sizeBytes: (await fsp.stat(artifactPaths.zlibLicense)).size,
          sha256: await sha256(artifactPaths.zlibLicense),
        },
      },
    } : {}),
  },
  subtitleRuntime: {
    renderer: "libass",
    requiredFilter: "ass",
    fontFamilyID: "anybox-subtitle-sans-v1",
    dependencies: {
      libass: { version: "0.17.5", sha256: "2dca25c0e0c837ddf00b52011b3f82cac1e4ddd3ad018227806b0c2288864acc" },
      freetype: { version: "2.14.3", sha256: "36bc4f1cc413335368ee656c42afca65c5a3987e8768cc28cf11ba775e785a5f" },
      fribidi: { version: "1.0.16", sha256: "1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c" },
      harfbuzz: { version: "14.2.1", sha256: "a54a5d8e9380a41fbb762ce367bcbf7704792dfca0d93f1bbca86c5a57902e0e" },
      notoSansCjkSc: { version: "2.004", sha256: await sha256(artifactPaths.subtitleFont), license: "OFL-1.1" },
    },
  },
  smokeEvidence: {
    render: {
      ...smokeProbe,
      output: await describedFile(artifactPaths.smokeVideo, path.resolve(args.stage)),
      probe: await describedFile(artifactPaths.smokeProbe, path.resolve(args.stage)),
    },
    subtitle: {
      ...subtitleSmokeProbe,
      renderer: "libass",
      fontSha256: await sha256(artifactPaths.subtitleFont),
      output: await describedFile(artifactPaths.subtitleSmokeVideo, path.resolve(args.stage)),
      probe: await describedFile(artifactPaths.subtitleSmokeProbe, path.resolve(args.stage)),
      script: await describedFile(artifactPaths.subtitleSmokeScript, path.resolve(args.stage)),
      frame: await describedFile(artifactPaths.subtitleSmokeFrame, path.resolve(args.stage)),
    },
  },
}
await fsp.mkdir(path.dirname(path.resolve(args.output)), { recursive: true })
await fsp.writeFile(path.resolve(args.output), `${JSON.stringify(candidate, null, 2)}\n`)
console.log(`[desktop][media] wrote unapproved candidate metadata to ${path.resolve(args.output)}`)
