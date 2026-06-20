#!/usr/bin/env node
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  Presentation,
  PresentationFile,
  deckToLayout,
  renderSlideToSvg,
  renderSvgToPng,
  slideToLayout,
} from "../../runtime/index.mjs";
import { checkLayoutQuality, summarizeQuality } from "../lib/quality.mjs";

const allowedImports = new Set(["@anybox/presentation-runtime"]);

try {
  hardenGlobals();
  const request = JSON.parse(process.argv[2] ?? "{}");
  const result = request.action === "render-slide"
    ? await renderSlide(request)
    : request.action === "build-deck"
      ? await buildDeck(request)
      : fail(`Unknown worker action: ${request.action}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

async function renderSlide(request) {
  const context = await makeContext(request);
  const modulePath = resolveSlidePath(context, request.slidePath);
  const exportName = request.exportName ?? exportNameFor(modulePath);
  const presentation = Presentation.create({
    slideSize: context.slideSize,
    workspaceDir: context.workspaceDir,
  });
  const slide = await executeSlideModule(modulePath, exportName, presentation, context);
  const baseName = path.basename(modulePath, ".mjs");
  const layout = slideToLayout(slide);
  const svg = await renderSlideToSvg(slide, { workspaceDir: context.workspaceDir });
  const svgPath = path.resolve(context.previewDir, `${baseName}.svg`);
  const pngPath = path.resolve(context.previewDir, `${baseName}.png`);
  const layoutPath = path.resolve(context.layoutDir, `${baseName}.json`);
  await fs.writeFile(svgPath, svg);
  await renderSvgToPng(svg, pngPath);
  await fs.writeFile(layoutPath, `${JSON.stringify(layout, null, 2)}\n`);
  return {
    ok: true,
    slide: slide.id,
    exportName,
    files: {
      svg: svgPath,
      png: pngPath,
      layout: layoutPath,
    },
  };
}

async function buildDeck(request) {
  const context = await makeContext(request);
  const slideFiles = await discoverSlideFiles(context);
  if (slideFiles.length === 0) {
    fail(`No slide modules found in ${context.slidesDir}.`);
  }

  const presentation = Presentation.create({
    slideSize: context.slideSize,
    workspaceDir: context.workspaceDir,
  });

  const rendered = [];
  for (const modulePath of slideFiles) {
    const exportName = exportNameFor(modulePath);
    const slide = await executeSlideModule(modulePath, exportName, presentation, context);
    const baseName = path.basename(modulePath, ".mjs");
    const svg = await renderSlideToSvg(slide, { workspaceDir: context.workspaceDir });
    const svgPath = path.resolve(context.previewDir, `${baseName}.svg`);
    const pngPath = path.resolve(context.previewDir, `${baseName}.png`);
    await fs.writeFile(svgPath, svg);
    await renderSvgToPng(svg, pngPath);
    rendered.push({ modulePath, exportName, slide, svgPath, pngPath });
  }

  const deckLayout = deckToLayout(presentation);
  const deckLayoutPath = path.resolve(context.layoutDir, "deck.json");
  await fs.writeFile(deckLayoutPath, `${JSON.stringify(deckLayout, null, 2)}\n`);

  const quality = await checkLayoutQuality(deckLayout, { workspaceDir: context.workspaceDir });
  const qualityPath = path.resolve(context.layoutDir, "quality-report.json");
  await fs.writeFile(qualityPath, `${JSON.stringify(quality, null, 2)}\n`);

  const pptxPath = path.resolve(context.outputDir, "final.pptx");
  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(pptxPath);
  const stat = await fs.stat(pptxPath);
  if (stat.size === 0) fail("PPTX export produced an empty file.");

  const contactSheetPath = path.resolve(context.previewDir, "contact-sheet.png");
  await createContactSheet(rendered.map((item) => item.pngPath), contactSheetPath);

  const loFinalRender = await tryLibreOfficeRender(pptxPath, path.resolve(context.previewDir, "lo-final"));
  const summary = {
    ok: quality.ok,
    slideCount: presentation.slides.length,
    pptx: pptxPath,
    deckLayout: deckLayoutPath,
    qualityReport: qualityPath,
    contactSheet: contactSheetPath,
    qualitySummary: summarizeQuality(quality),
    loFinalRenderSkipped: !loFinalRender.ok,
    loFinalRender,
  };
  const summaryPath = path.resolve(context.outputDir, "build-summary.json");
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return { ...summary, summaryPath };
}

async function makeContext(request) {
  const pluginRoot = path.resolve(required(request.pluginRoot, "pluginRoot"));
  const workspaceDir = path.resolve(required(request.workspaceDir, "workspaceDir"));
  const workspacesRoot = path.resolve(required(request.workspacesRoot, "workspacesRoot"));
  assertInside(workspaceDir, workspacesRoot, "workspace must be inside project workspaces/");
  const slidesDir = path.resolve(workspaceDir, "slides");
  const assetsDir = path.resolve(workspaceDir, "assets");
  const previewDir = path.resolve(workspaceDir, "preview");
  const layoutDir = path.resolve(workspaceDir, "layout");
  const outputDir = path.resolve(workspaceDir, "output");
  for (const dir of [slidesDir, assetsDir, previewDir, layoutDir, outputDir]) {
    assertInside(dir, workspaceDir, "workspace subdirectory escaped workspace");
  }
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.mkdir(previewDir, { recursive: true });
  await fs.mkdir(layoutDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  return {
    pluginRoot,
    workspacesRoot,
    workspaceDir,
    slidesDir,
    assetsDir,
    previewDir,
    layoutDir,
    outputDir,
    slideSize: request.slideSize ?? { width: 1280, height: 720 },
    assetPath(name) {
      const resolved = path.resolve(assetsDir, String(name));
      assertInside(resolved, assetsDir, "asset path escaped assets/");
      return resolved;
    },
  };
}

async function discoverSlideFiles(context) {
  const entries = await fs.readdir(context.slidesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^slide-\d+\.mjs$/.test(entry.name))
    .map((entry) => path.resolve(context.slidesDir, entry.name))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}

function resolveSlidePath(context, slidePath) {
  const resolved = path.resolve(context.workspaceDir, slidePath);
  assertInside(resolved, context.slidesDir, "slide module must be inside workspace slides/");
  if (!resolved.endsWith(".mjs")) fail("slide module must be an .mjs file.");
  return resolved;
}

async function executeSlideModule(modulePath, exportName, presentation, context) {
  const source = await validateSlideModuleSource(modulePath);
  const before = presentation.slides.length;
  const moduleUrl = slideModuleDataUrl(modulePath, source, context);
  const module = await import(moduleUrl);
  const fn = module[exportName];
  if (typeof fn !== "function") {
    fail(`Slide export not found: ${exportName} in ${modulePath}`);
  }
  const slide = await fn(presentation, {
    workspaceDir: context.workspaceDir,
    assetsDir: context.assetsDir,
    outputDir: context.outputDir,
    previewDir: context.previewDir,
    layoutDir: context.layoutDir,
    slideSize: context.slideSize,
    assetPath: context.assetPath,
  });
  if (slide) return slide;
  if (presentation.slides.length > before) return presentation.slides.at(presentation.slides.length - 1);
  fail(`${exportName} did not return a slide or add one to the presentation.`);
}

async function validateSlideModuleSource(modulePath) {
  const source = await fs.readFile(modulePath, "utf8");
  if (/\bimport\s*\(/.test(source)) {
    fail(`Dynamic import is not allowed in slide modules: ${modulePath}`);
  }
  const importSpecifiers = [
    ...source.matchAll(/\bimport\s+(?:[^'"]*?\s+from\s*)?["']([^"']+)["']/g),
    ...source.matchAll(/\bexport\s+[^'"]*?\s+from\s+["']([^"']+)["']/g),
  ].map((match) => match[1]);
  for (const specifier of importSpecifiers) {
    if (!allowedImports.has(specifier)) {
      fail(`Import not allowed in slide module: ${specifier}. Use @anybox/presentation-runtime only.`);
    }
  }
  return source;
}

function slideModuleDataUrl(modulePath, source, context) {
  const runtimeUrl = pathToFileURL(path.resolve(context.pluginRoot, "runtime/index.mjs")).href;
  const rewritten = rewriteRuntimeImports(source, runtimeUrl);
  const nonce = `${Date.now()}-${Math.random()}`;
  const annotated = [
    rewritten,
    `//# sourceURL=${pathToFileURL(modulePath).href}`,
    `// anybox-presentation-cache-bust=${nonce}`,
    "",
  ].join("\n");
  return `data:text/javascript;base64,${Buffer.from(annotated, "utf8").toString("base64")}`;
}

function rewriteRuntimeImports(source, runtimeUrl) {
  return source
    .replace(
      /\b(import\s+(?:[^'"]*?\s+from\s*)?)(["'])@anybox\/presentation-runtime\2/g,
      (_, prefix) => `${prefix}${JSON.stringify(runtimeUrl)}`,
    )
    .replace(
      /\b(export\s+[^'"]*?\s+from\s*)(["'])@anybox\/presentation-runtime\2/g,
      (_, prefix) => `${prefix}${JSON.stringify(runtimeUrl)}`,
    );
}

function exportNameFor(modulePath) {
  const match = path.basename(modulePath).match(/^slide-(\d+)\.mjs$/);
  if (!match) fail(`Slide filename must match slide-XX.mjs: ${modulePath}`);
  return `slide${match[1]}`;
}

async function createContactSheet(imagePaths, outputPath) {
  let sharpModule;
  try {
    sharpModule = await import("sharp");
  } catch (error) {
    fail(`sharp is required for contact sheets. ${error.message}`);
  }
  const sharp = sharpModule.default ?? sharpModule;
  const thumbWidth = 320;
  const thumbHeight = 180;
  const padding = 24;
  const labelHeight = 32;
  const columns = Math.min(3, Math.max(1, imagePaths.length));
  const rows = Math.ceil(imagePaths.length / columns);
  const width = columns * thumbWidth + (columns + 1) * padding;
  const height = rows * (thumbHeight + labelHeight) + (rows + 1) * padding;
  const composites = [];

  for (let index = 0; index < imagePaths.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = padding + column * (thumbWidth + padding);
    const top = padding + row * (thumbHeight + labelHeight + padding);
    const thumb = await sharp(imagePaths[index]).resize(thumbWidth, thumbHeight, { fit: "contain", background: "#FFFFFF" }).png().toBuffer();
    const label = Buffer.from(`<svg width="${thumbWidth}" height="${labelHeight}"><text x="0" y="22" font-family="Arial" font-size="18" fill="#111827">Slide ${index + 1}</text></svg>`);
    composites.push({ input: thumb, left, top });
    composites.push({ input: label, left, top: top + thumbHeight + 6 });
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: "#F3F4F6",
    },
  }).composite(composites).png().toFile(outputPath);
}

async function tryLibreOfficeRender(pptxPath, outputDir) {
  const soffice = await findCommand(["soffice", "libreoffice"]);
  if (!soffice) {
    return { ok: false, reason: "LibreOffice not found on PATH." };
  }
  await fs.mkdir(outputDir, { recursive: true });

  const pngAttempt = await runCommand(soffice, [
    "--headless",
    "--convert-to",
    "png",
    "--outdir",
    outputDir,
    pptxPath,
  ]);
  const pngs = await listPngs(outputDir);
  if (pngAttempt.code === 0 && pngs.length > 0) {
    return { ok: true, mode: "png", files: pngs };
  }

  const pdfAttempt = await runCommand(soffice, [
    "--headless",
    "--convert-to",
    "pdf",
    "--outdir",
    outputDir,
    pptxPath,
  ]);
  const pdfs = (await fs.readdir(outputDir)).filter((name) => name.endsWith(".pdf")).map((name) => path.resolve(outputDir, name));
  if (pdfAttempt.code !== 0 || pdfs.length === 0) {
    return {
      ok: false,
      reason: "LibreOffice could not convert PPTX to PNG or PDF.",
      stderr: pngAttempt.stderr || pdfAttempt.stderr,
    };
  }

  const pdftoppm = await findCommand(["pdftoppm"]);
  if (!pdftoppm) {
    return {
      ok: false,
      reason: "LibreOffice produced PDF, but pdftoppm was not found for PNG conversion.",
      pdf: pdfs[0],
    };
  }
  const prefix = path.resolve(outputDir, "slide");
  const ppmAttempt = await runCommand(pdftoppm, ["-png", "-r", "144", pdfs[0], prefix]);
  const finalPngs = await listPngs(outputDir);
  return ppmAttempt.code === 0 && finalPngs.length > 0
    ? { ok: true, mode: "pdf-pdftoppm", files: finalPngs }
    : { ok: false, reason: "pdftoppm did not produce PNG files.", stderr: ppmAttempt.stderr, pdf: pdfs[0] };
}

async function listPngs(dir) {
  const names = await fs.readdir(dir).catch(() => []);
  return names.filter((name) => name.endsWith(".png")).map((name) => path.resolve(dir, name)).sort();
}

async function findCommand(names) {
  for (const name of names) {
    const result = await runCommand("which", [name]);
    if (result.code === 0 && result.stdout.trim()) return result.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function hardenGlobals() {
  globalThis.fetch = async () => {
    throw new Error("Network access is disabled in presentation slide modules.");
  };
  for (const key of Object.keys(process.env)) {
    if (!["PATH", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR"].includes(key)) {
      delete process.env[key];
    }
  }
}

function required(value, label) {
  if (!value) fail(`Missing required field: ${label}`);
  return value;
}

function assertInside(child, parent, message) {
  const relative = path.relative(parent, child);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(message);
  }
}

function fail(message) {
  throw new Error(message);
}
