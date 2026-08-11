import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "../../../packages/desktop/build/agent-runtime/dependencies/node/node_modules/sharp/lib/index.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outputDirectory = path.join(projectRoot, "outputs", "anybox-original-replica-brand");
const sourcePath = path.join(projectRoot, "packages", "site", "public", "anybox-box-cat-logo.png");
const originalVectorPath = path.join(outputDirectory, "anybox-original-logo-white.svg");
const cleanVectorPath = path.join(outputDirectory, "anybox-original-logo-clean-white.svg");
const cleanBlackPath = path.join(outputDirectory, "anybox-original-logo-clean-black.svg");

async function rawPixels(input) {
  return sharp(input).resize(1024, 1024).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function compare(reference, candidate) {
  let absoluteError = 0;
  let squaredError = 0;
  let intersection = 0;
  let union = 0;
  let referencePositive = 0;
  let candidatePositive = 0;

  for (let offset = 0; offset < reference.data.length; offset += 4) {
    const referenceIntensity = Math.round((reference.data[offset] * reference.data[offset + 3]) / 255);
    const candidateIntensity = Math.round((candidate.data[offset] * candidate.data[offset + 3]) / 255);
    const difference = candidateIntensity - referenceIntensity;
    absoluteError += Math.abs(difference);
    squaredError += difference * difference;

    const referenceOn = referenceIntensity >= 128;
    const candidateOn = candidateIntensity >= 128;
    if (referenceOn) referencePositive += 1;
    if (candidateOn) candidatePositive += 1;
    if (referenceOn && candidateOn) intersection += 1;
    if (referenceOn || candidateOn) union += 1;
  }

  const pixelCount = reference.info.width * reference.info.height;
  return {
    meanAbsoluteError: absoluteError / pixelCount,
    rootMeanSquareError: Math.sqrt(squaredError / pixelCount),
    binaryIoU: union === 0 ? 1 : intersection / union,
    referencePositive,
    candidatePositive,
  };
}

const source = await rawPixels(sourcePath);
const originalVector = await rawPixels(originalVectorPath);
const cleanVector = await rawPixels(cleanVectorPath);
const cleanSvg = await fs.readFile(cleanVectorPath, "utf8");

const darkPreview = await sharp(cleanVectorPath)
  .resize(1024, 1024)
  .flatten({ background: "#000000" })
  .png()
  .toBuffer();
const lightPreview = await sharp(cleanBlackPath)
  .resize(1024, 1024)
  .flatten({ background: "#F7F7F4" })
  .png()
  .toBuffer();
const sourcePreview = await sharp(sourcePath)
  .resize(1024, 1024)
  .flatten({ background: "#000000" })
  .png()
  .toBuffer();

await fs.writeFile(path.join(outputDirectory, "preview-clean-dark.png"), darkPreview);
await fs.writeFile(path.join(outputDirectory, "preview-clean-light.png"), lightPreview);
await sharp({
  create: { width: 2048, height: 1024, channels: 3, background: "#000000" },
})
  .composite([
    { input: sourcePreview, left: 0, top: 0 },
    { input: darkPreview, left: 1024, top: 0 },
  ])
  .png()
  .toFile(path.join(outputDirectory, "comparison-original-vs-clean.png"));

const report = {
  anchorCounts: {
    totalBefore: 148,
    totalAfter: 110,
    boxBefore: 64,
    boxAfter: 26,
  },
  sourceToClean: compare(source, cleanVector),
  originalVectorToClean: compare(originalVector, cleanVector),
  svg: {
    pathTags: (cleanSvg.match(/<path\b/g) ?? []).length,
    hasEmbeddedRaster: /<image\b/.test(cleanSvg),
    hasLiveText: /<text\b/.test(cleanSvg),
    bytes: Buffer.byteLength(cleanSvg),
  },
};

await fs.writeFile(path.join(outputDirectory, "clean-validation.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
