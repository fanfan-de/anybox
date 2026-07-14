#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectDir = path.resolve(scriptDir, "..")

function parseArgs(argv) {
  const parsed = new Map()

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith("--")) continue

    const [rawKey, rawValue] = arg.slice(2).split("=", 2)
    if (rawValue !== undefined) {
      parsed.set(rawKey, rawValue)
      continue
    }

    const nextArg = argv[index + 1]
    if (nextArg && !nextArg.startsWith("--")) {
      parsed.set(rawKey, nextArg)
      index += 1
    } else {
      parsed.set(rawKey, "true")
    }
  }

  return parsed
}

function findDefaultSourceSvg() {
  const publicDir = path.join(projectDir, "src", "renderer", "public")
  const publicSvgs = readdirSync(publicDir).filter((entry) => entry.endsWith(".svg"))
  const preferredMarkers = ["\u767d", "white"]
  const fileName = publicSvgs.find((entry) => {
    const baseName = path.basename(entry, ".svg").toLowerCase()
    return preferredMarkers.some((marker) => baseName.includes(marker))
  })

  if (!fileName) {
    throw new Error(`[desktop][icons] source SVG not found in ${publicDir}`)
  }

  return path.join(publicDir, fileName)
}

function findDefaultTrayTemplateSvg() {
  return path.join(projectDir, "assets", "tray-template.svg")
}

function formatCommandResult(result) {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const output = formatCommandResult(result)
    throw new Error(`[desktop][icons] ${command} failed with exit code ${result.status}${output ? `:\n${output}` : ""}`)
  }

  return result
}

function getToolPath(toolName) {
  const macToolPath = path.join("/usr/bin", toolName)
  return existsSync(macToolPath) ? macToolPath : toolName
}

function resizePngWithSips(inputPath, outputPath, size) {
  run(getToolPath("sips"), ["-z", String(size), String(size), inputPath, "--out", outputPath])
}

function readSvgSquareSize(sourceSvg) {
  const svg = readFileSync(sourceSvg, "utf8")
  const viewBoxMatch = svg.match(/viewBox\s*=\s*"([^"]+)"/)
  if (!viewBoxMatch) {
    throw new Error(`[desktop][icons] source SVG has no viewBox: ${sourceSvg}`)
  }

  const viewBox = viewBoxMatch[1].split(/[,\s]+/).filter(Boolean).map(Number)
  if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
    throw new Error(`[desktop][icons] unsupported SVG viewBox: ${viewBoxMatch[1]}`)
  }

  return Math.round(Math.max(viewBox[2], viewBox[3]))
}

function writeIco(filePath, frames) {
  const headerSize = 6 + frames.length * 16
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)

  let imageOffset = headerSize
  frames.forEach((frame, index) => {
    const entryOffset = 6 + index * 16
    header.writeUInt8(frame.size === 256 ? 0 : frame.size, entryOffset)
    header.writeUInt8(frame.size === 256 ? 0 : frame.size, entryOffset + 1)
    header.writeUInt8(0, entryOffset + 2)
    header.writeUInt8(0, entryOffset + 3)
    header.writeUInt16LE(1, entryOffset + 4)
    header.writeUInt16LE(32, entryOffset + 6)
    header.writeUInt32LE(frame.bytes.length, entryOffset + 8)
    header.writeUInt32LE(imageOffset, entryOffset + 12)
    imageOffset += frame.bytes.length
  })

  writeFileSync(filePath, Buffer.concat([header, ...frames.map((frame) => frame.bytes)]))
}

function generateWithMacTools(sourceSvg, outputDir, pngSize) {
  const sipsPath = getToolPath("sips")
  const iconutilPath = getToolPath("iconutil")

  mkdirSync(outputDir, { recursive: true })
  const tempDir = mkdtempSync(path.join(tmpdir(), "anybox-icons-"))

  try {
    const squareSize = readSvgSquareSize(sourceSvg)
    const iconSvgPath = path.join(outputDir, "icon.svg")
    const rawPngPath = path.join(tempDir, "icon-raw.png")
    const paddedPngPath = path.join(tempDir, "icon-padded.png")
    const iconPngPath = path.join(outputDir, "icon.png")
    const iconMasterPath = path.join(outputDir, "icon-master.png")
    const iconIcoPath = path.join(outputDir, "icon.ico")
    const installerIcoPath = path.join(outputDir, "installerIcon.ico")
    const iconsetDir = path.join(tempDir, "icon.iconset")

    copyFileSync(sourceSvg, iconSvgPath)
    run(sipsPath, ["-s", "format", "png", sourceSvg, "--out", rawPngPath])
    run(sipsPath, ["--padToHeightWidth", String(squareSize), String(squareSize), rawPngPath, "--out", paddedPngPath])
    resizePngWithSips(paddedPngPath, iconPngPath, pngSize)
    resizePngWithSips(paddedPngPath, iconMasterPath, 1024)

    mkdirSync(iconsetDir, { recursive: true })
    const iconsetFrames = [
      ["icon_16x16.png", 16],
      ["icon_16x16@2x.png", 32],
      ["icon_32x32.png", 32],
      ["icon_32x32@2x.png", 64],
      ["icon_128x128.png", 128],
      ["icon_128x128@2x.png", 256],
      ["icon_256x256.png", 256],
      ["icon_256x256@2x.png", 512],
      ["icon_512x512.png", 512],
      ["icon_512x512@2x.png", 1024],
    ]
    for (const [fileName, size] of iconsetFrames) {
      resizePngWithSips(paddedPngPath, path.join(iconsetDir, fileName), size)
    }
    run(iconutilPath, ["-c", "icns", iconsetDir, "-o", path.join(outputDir, "icon.icns")])

    const icoFrames = []
    for (const size of [16, 24, 32, 48, 64, 128, 256]) {
      const framePath = path.join(tempDir, `icon-${size}.png`)
      resizePngWithSips(paddedPngPath, framePath, size)
      icoFrames.push({ size, bytes: readFileSync(framePath) })
    }
    writeIco(iconIcoPath, icoFrames)
    copyFileSync(iconIcoPath, installerIcoPath)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }

  console.log(`[desktop][icons] generated app icons from ${sourceSvg}`)
}

function generateTrayTemplateWithMacTools(sourceSvg, outputDir) {
  const sipsPath = getToolPath("sips")
  mkdirSync(outputDir, { recursive: true })
  const tempDir = mkdtempSync(path.join(tmpdir(), "anybox-tray-icons-"))

  try {
    const rawPngPath = path.join(tempDir, "trayTemplate-raw.png")
    run(sipsPath, ["-s", "format", "png", sourceSvg, "--out", rawPngPath])
    resizePngWithSips(rawPngPath, path.join(outputDir, "trayTemplate@2x.png"), 36)
    resizePngWithSips(rawPngPath, path.join(outputDir, "trayTemplate.png"), 18)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }

  console.log(`[desktop][icons] generated tray template icons from ${sourceSvg}`)
}

function rasterizeSvgWithRsvg(sourceSvg, outputPath, size) {
  run(getToolPath("rsvg-convert"), [
    "--width", String(size),
    "--height", String(size),
    "--keep-aspect-ratio",
    "--output", outputPath,
    sourceSvg,
  ])
}

function generateWithLinuxTools(sourceSvg, trayTemplateSvg, outputDir, pngSize) {
  mkdirSync(outputDir, { recursive: true })
  const tempDir = mkdtempSync(path.join(tmpdir(), "anybox-linux-icons-"))

  try {
    copyFileSync(sourceSvg, path.join(outputDir, "icon.svg"))
    rasterizeSvgWithRsvg(sourceSvg, path.join(outputDir, "icon.png"), pngSize)
    rasterizeSvgWithRsvg(sourceSvg, path.join(outputDir, "icon-master.png"), 1024)

    const icoFrames = []
    for (const size of [16, 24, 32, 48, 64, 128, 256]) {
      const framePath = path.join(tempDir, `icon-${size}.png`)
      rasterizeSvgWithRsvg(sourceSvg, framePath, size)
      icoFrames.push({ size, bytes: readFileSync(framePath) })
    }
    const iconIcoPath = path.join(outputDir, "icon.ico")
    writeIco(iconIcoPath, icoFrames)
    copyFileSync(iconIcoPath, path.join(outputDir, "installerIcon.ico"))

    rasterizeSvgWithRsvg(trayTemplateSvg, path.join(outputDir, "trayTemplate.png"), 18)
    rasterizeSvgWithRsvg(trayTemplateSvg, path.join(outputDir, "trayTemplate@2x.png"), 36)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }

  console.log(`[desktop][icons] generated Linux app and tray icons from ${sourceSvg}`)
}

function generateWithPowerShell(sourceSvg, outputDir, pngSize) {
  const powerShell = process.platform === "win32" ? "powershell" : "pwsh"
  run(powerShell, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(scriptDir, "generate-app-icons.ps1"),
    "-SourceSvg",
    sourceSvg,
    "-OutputDir",
    outputDir,
    "-PngSize",
    String(pngSize),
  ])
}

const args = parseArgs(process.argv.slice(2))
const sourceSvg = path.resolve(projectDir, args.get("source") ?? findDefaultSourceSvg())
const trayTemplateSvg = path.resolve(projectDir, args.get("tray-source") ?? findDefaultTrayTemplateSvg())
const outputDir = path.resolve(projectDir, args.get("out-dir") ?? "build")
const pngSize = Number.parseInt(args.get("png-size") ?? "512", 10)

if (!Number.isFinite(pngSize) || pngSize <= 0) {
  throw new Error(`[desktop][icons] invalid png size: ${args.get("png-size")}`)
}

if (!existsSync(sourceSvg)) {
  throw new Error(`[desktop][icons] source SVG not found: ${sourceSvg}`)
}

if (process.platform === "win32") {
  generateWithPowerShell(sourceSvg, outputDir, pngSize)
} else if (process.platform === "darwin") {
  if (!existsSync(trayTemplateSvg)) {
    throw new Error(`[desktop][icons] tray template SVG not found: ${trayTemplateSvg}`)
  }
  generateWithMacTools(sourceSvg, outputDir, pngSize)
  generateTrayTemplateWithMacTools(trayTemplateSvg, outputDir)
} else {
  if (!existsSync(trayTemplateSvg)) {
    throw new Error(`[desktop][icons] tray template SVG not found: ${trayTemplateSvg}`)
  }
  generateWithLinuxTools(sourceSvg, trayTemplateSvg, outputDir, pngSize)
}
