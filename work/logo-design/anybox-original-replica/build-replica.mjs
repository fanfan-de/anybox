import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "../../../packages/desktop/build/agent-runtime/dependencies/node/node_modules/sharp/lib/index.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workDirectory = path.join(projectRoot, "work", "logo-design", "anybox-original-replica");
const sourcePath = path.join(projectRoot, "packages", "site", "public", "anybox-box-cat-logo.png");
const tracedPath = path.join(workDirectory, "candidates", "debug-expanded-original-colors.svg");
const outputDirectory = path.join(projectRoot, "outputs", "anybox-original-replica-brand");

await fs.mkdir(outputDirectory, { recursive: true });

const tracedSvg = await fs.readFile(tracedPath, "utf8");
const pathData = [...tracedSvg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*\/>/gs)].map((match) => match[1]);
if (pathData.length !== 10) {
  throw new Error(`Expected 10 traced paths, found ${pathData.length}`);
}

function makeSvg(fill) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-labelledby="title desc">
  <title id="title">Anybox original box cat logo</title>
  <desc id="desc">A faithful vector replica of the original Anybox cat emerging from an open box.</desc>
  <path fill="${fill}" fill-rule="evenodd" clip-rule="evenodd" d="${pathData.join(" ")}"/>
</svg>
`;
}

const whiteSvg = makeSvg("#FFFFFF");
const blackSvg = makeSvg("#000000");
const whiteSvgPath = path.join(outputDirectory, "anybox-original-logo-white.svg");
const blackSvgPath = path.join(outputDirectory, "anybox-original-logo-black.svg");
await fs.writeFile(whiteSvgPath, whiteSvg, "utf8");
await fs.writeFile(blackSvgPath, blackSvg, "utf8");

const whitePngPath = path.join(outputDirectory, "anybox-original-logo-white-1024.png");
const blackPngPath = path.join(outputDirectory, "anybox-original-logo-black-1024.png");
const previewPath = path.join(outputDirectory, "preview.png");

await sharp(Buffer.from(whiteSvg)).resize(1024, 1024).png().toFile(whitePngPath);
await sharp(Buffer.from(blackSvg)).resize(1024, 1024).png().toFile(blackPngPath);
await sharp(Buffer.from(whiteSvg))
  .resize(1024, 1024)
  .flatten({ background: "#000000" })
  .png()
  .toFile(previewPath);

const source = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const replica = await sharp(Buffer.from(whiteSvg)).resize(1024, 1024).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let absoluteError = 0;
let squaredError = 0;
let intersection = 0;
let union = 0;
let sourcePositive = 0;
let replicaPositive = 0;

for (let offset = 0; offset < source.data.length; offset += 4) {
  const sourceIntensity = Math.round((source.data[offset] * source.data[offset + 3]) / 255);
  const replicaIntensity = Math.round((replica.data[offset] * replica.data[offset + 3]) / 255);
  const difference = replicaIntensity - sourceIntensity;
  absoluteError += Math.abs(difference);
  squaredError += difference * difference;

  const sourceOn = sourceIntensity >= 128;
  const replicaOn = replicaIntensity >= 128;
  if (sourceOn) sourcePositive += 1;
  if (replicaOn) replicaPositive += 1;
  if (sourceOn && replicaOn) intersection += 1;
  if (sourceOn || replicaOn) union += 1;
}

const pixelCount = source.info.width * source.info.height;
const report = {
  source: sourcePath,
  sourceSize: [source.info.width, source.info.height],
  outputDirectory,
  tracedPathCount: pathData.length,
  hasEmbeddedRaster: /<image\b/.test(whiteSvg),
  hasLiveText: /<text\b/.test(whiteSvg),
  meanAbsoluteError: absoluteError / pixelCount,
  rootMeanSquareError: Math.sqrt(squaredError / pixelCount),
  binaryIoU: union === 0 ? 1 : intersection / union,
  sourcePositive,
  replicaPositive,
  whiteSvgBytes: Buffer.byteLength(whiteSvg),
  blackSvgBytes: Buffer.byteLength(blackSvg),
};

await fs.writeFile(path.join(outputDirectory, "validation.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
