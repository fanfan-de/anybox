import fs from "node:fs/promises";
import path from "node:path";
import { resolveAssetPath } from "../../runtime/index.mjs";

export async function checkLayoutQuality(layout, options = {}) {
  const deck = normalizeLayout(layout);
  const workspaceDir = options.workspaceDir ? path.resolve(options.workspaceDir) : null;
  const report = {
    ok: true,
    errors: [],
    warnings: [],
    slideCount: deck.slides.length,
    checkedAt: new Date().toISOString(),
  };

  for (const slide of deck.slides) {
    await checkSlide(slide, report, workspaceDir);
  }

  report.ok = report.errors.length === 0;
  return report;
}

export function summarizeQuality(report) {
  const status = report.ok ? "PASS" : "FAIL";
  return `${status}: ${report.errors.length} error(s), ${report.warnings.length} warning(s), ${report.slideCount} slide(s) checked.`;
}

function normalizeLayout(layout) {
  if (Array.isArray(layout?.slides)) return layout;
  if (layout?.elements) {
    return {
      slideSize: layout.slideSize,
      slides: [layout],
    };
  }
  throw new Error("Layout JSON must be a deck layout or slide layout.");
}

async function checkSlide(slide, report, workspaceDir) {
  const width = Number(slide.slideSize?.width ?? 1280);
  const height = Number(slide.slideSize?.height ?? 720);
  const elements = Array.isArray(slide.elements) ? slide.elements : [];
  const label = slide.id ?? `slide-${slide.index + 1}`;

  if (elements.length === 0 || !elements.some(isVisibleElement)) {
    error(report, label, "blank-slide", "Slide has no visible elements.");
  }

  if (!hasTitle(elements)) {
    error(report, label, "missing-title", "Slide must include a visible title text element.");
  }

  for (const element of elements) {
    const right = Number(element.left) + Number(element.width);
    const bottom = Number(element.top) + Number(element.height);
    if (element.left < -0.1 || element.top < -0.1 || right > width + 0.1 || bottom > height + 0.1) {
      error(report, label, "out-of-bounds", `${element.id} exceeds the ${width}x${height} canvas.`);
    }

    if (element.type === "Text") {
      checkText(element, report, label);
    }

    if (element.type === "Image") {
      await checkImage(element, report, label, workspaceDir);
    }
  }
}

function checkText(element, report, label) {
  const text = String(element.text ?? "");
  const fontSize = Number(element.style?.fontSize ?? 18);
  if (text.trim().length === 0) {
    error(report, label, "empty-text", `${element.id} is an empty text box.`);
  }
  if (fontSize < 8) {
    warn(report, label, "small-font", `${element.id} uses ${fontSize}pt text.`);
  }
  const lineHeight = Number(element.style?.lineHeight ?? fontSize * 1.2);
  const charsPerLine = Math.max(1, Math.floor(Number(element.width) / Math.max(1, fontSize * 0.55)));
  const estimatedLines = text.split(/\r?\n/).reduce((count, paragraph) => {
    return count + Math.max(1, Math.ceil(weightedLength(paragraph) / charsPerLine));
  }, 0);
  const estimatedHeight = estimatedLines * lineHeight;
  if (estimatedHeight > Number(element.height) * 1.08) {
    warn(
      report,
      label,
      "text-overflow",
      `${element.id} may overflow: estimated ${Math.round(estimatedHeight)}px text height in ${element.height}px box.`,
    );
  }
}

async function checkImage(element, report, label, workspaceDir) {
  const src = element.src;
  if (!src) {
    error(report, label, "missing-image-src", `${element.id} is missing image src.`);
    return;
  }
  if (String(src).startsWith("data:")) return;
  const resolved = resolveAssetPath(src, workspaceDir);
  try {
    await fs.access(resolved);
  } catch {
    error(report, label, "image-not-found", `${element.id} image not found: ${resolved}`);
  }
}

function hasTitle(elements) {
  return elements.some((element) => {
    if (element.type !== "Text" || String(element.text ?? "").trim().length === 0) return false;
    if (element.role === "title") return true;
    return Number(element.top) < 140 && Number(element.style?.fontSize ?? 0) >= 24;
  });
}

function isVisibleElement(element) {
  if (element.type === "Text") return String(element.text ?? "").trim().length > 0;
  if (element.type === "Image") return Boolean(element.src);
  if (element.type === "Shape") return element.fill?.color !== "none" || element.line?.color !== "none";
  return false;
}

function weightedLength(text) {
  let length = 0;
  for (const char of String(text)) {
    length += /[\u2E80-\u9FFF]/.test(char) ? 1.8 : 1;
  }
  return length;
}

function error(report, slide, code, message) {
  report.errors.push({ slide, code, message });
}

function warn(report, slide, code, message) {
  report.warnings.push({ slide, code, message });
}
