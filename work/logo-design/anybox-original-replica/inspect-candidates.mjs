import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "../../../packages/desktop/build/agent-runtime/dependencies/node/node_modules/sharp/lib/index.js";

const directory = new URL("./candidates/", import.meta.url);
const names = ["a-precise-128", "b-balanced-128", "c-smooth-128"];
const sourcePath = new URL("../../../packages/site/public/anybox-box-cat-logo.png", import.meta.url);
const source = await sharp(fileURLToPath(sourcePath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

for (const name of names) {
  const pngPath = new URL(`${name}.png`, directory);
  const svgPath = new URL(`${name}.svg`, directory);
  const svg = await fs.readFile(svgPath, "utf8");
  const cleanSvg = svg.replace(/\s*<rect\b[^>]*width="1023\.9999"[^>]*\/>\s*/, "\n");
  const { data, info } = await sharp(Buffer.from(cleanSvg))
    .resize(1024, 1024)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let transparent = 0;
  let opaque = 0;
  let minimumAlpha = 255;
  let maximumAlpha = 0;
  let absoluteError = 0;
  let intersection = 0;
  let union = 0;
  let sourcePositive = 0;
  let candidatePositive = 0;

  for (let offset = 3; offset < data.length; offset += 4) {
    const alpha = data[offset];
    if (alpha === 0) transparent += 1;
    if (alpha === 255) opaque += 1;
    minimumAlpha = Math.min(minimumAlpha, alpha);
    maximumAlpha = Math.max(maximumAlpha, alpha);

    const sourceOffset = offset - 3;
    const sourceIntensity = Math.round((source.data[sourceOffset] * source.data[sourceOffset + 3]) / 255);
    absoluteError += Math.abs(alpha - sourceIntensity);
    const sourceOn = sourceIntensity >= 128;
    const candidateOn = alpha >= 128;
    if (sourceOn) sourcePositive += 1;
    if (candidateOn) candidatePositive += 1;
    if (sourceOn && candidateOn) intersection += 1;
    if (sourceOn || candidateOn) union += 1;
  }

  await sharp(Buffer.from(cleanSvg))
    .resize(1024, 1024)
    .flatten({ background: "#000000" })
    .png()
    .toFile(fileURLToPath(new URL(`${name}-preview-black.png`, directory)));

  console.log(JSON.stringify({
    name,
    width: info.width,
    height: info.height,
    transparent,
    opaque,
    minimumAlpha,
    maximumAlpha,
    hasImage: /<image\b/.test(svg),
    pathTags: (svg.match(/<path\b/g) ?? []).length,
    rectTags: (svg.match(/<rect\b/g) ?? []).length,
    viewBox: svg.match(/viewBox="([^"]+)/)?.[1] ?? null,
    bytes: Buffer.byteLength(svg),
    meanAbsoluteError: absoluteError / (info.width * info.height),
    binaryIoU: union === 0 ? 1 : intersection / union,
    sourcePositive,
    candidatePositive,
  }));
}
