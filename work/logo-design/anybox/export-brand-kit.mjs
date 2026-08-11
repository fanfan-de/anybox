import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoDir = path.resolve(scriptDir, "../../..")
const outputDir = path.join(repoDir, "outputs", "anybox-brand")
const sharpEntry = path.join(repoDir, "packages", "desktop", "build", "agent-runtime", "dependencies", "node", "node_modules", "sharp", "lib", "index.js")
const sharp = (await import(pathToFileURL(sharpEntry).href)).default

async function rasterize(sourceName, outputName, width, height = width, format = "png") {
  const source = path.join(outputDir, sourceName)
  const output = path.join(outputDir, outputName)
  let pipeline = sharp(await readFile(source), { density: 384 }).resize(width, height, { fit: "contain" })
  pipeline = format === "webp" ? pipeline.webp({ quality: 92, alphaQuality: 100 }) : pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
  await pipeline.toFile(output)
}

function makeIco(frames) {
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
  return Buffer.concat([header, ...frames.map((frame) => frame.bytes)])
}

for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  await rasterize("anybox-mark-color.svg", `anybox-mark-${size}.png`, size)
}
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  await rasterize("anybox-app-icon.svg", `anybox-app-icon-${size}.png`, size)
}
await rasterize("favicon.svg", "favicon-16.png", 16)
await rasterize("favicon.svg", "favicon-32.png", 32)
await rasterize("favicon.svg", "favicon-48.png", 48)
await rasterize("anybox-full-logo.svg", "anybox-full-logo.png", 1120, 240)
await rasterize("anybox-full-logo-dark.svg", "anybox-full-logo-dark.png", 1120, 240)
await rasterize("social-preview.svg", "social-preview.png", 1200, 630)
await rasterize("social-preview.svg", "social-preview.webp", 1200, 630, "webp")

const icoFrames = []
for (const size of [16, 32, 48, 64, 128, 256]) {
  const bytes = await sharp(await readFile(path.join(outputDir, "favicon.svg")), { density: 384 }).resize(size, size).png().toBuffer()
  icoFrames.push({ size, bytes })
}
await writeFile(path.join(outputDir, "favicon.ico"), makeIco(icoFrames))

console.log(`Exported Anybox brand kit to ${outputDir}`)
