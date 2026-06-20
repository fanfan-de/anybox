import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_SLIDE_SIZE = { width: 1280, height: 720 };
const PX_PER_INCH = 96;
const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

let nextId = 1;

export class Presentation {
  constructor(options = {}) {
    this.slideSize = normalizeSlideSize(options.slideSize);
    this.workspaceDir = options.workspaceDir ? path.resolve(options.workspaceDir) : null;
    this.slides = new SlideCollection(this);
    this.theme = options.theme ?? {};
  }

  static create(options = {}) {
    return new Presentation(options);
  }

  toJSON() {
    return {
      slideSize: this.slideSize,
      slides: this.slides.items.map((slide, index) => slide.toJSON(index)),
    };
  }
}

export class SlideCollection {
  constructor(presentation) {
    this.presentation = presentation;
    this.items = [];
  }

  add(options = {}) {
    const slide = new Slide(this.presentation, {
      ...options,
      id: options.id ?? `slide-${String(this.items.length + 1).padStart(2, "0")}`,
    });
    this.items.push(slide);
    return slide;
  }

  at(index) {
    return this.items[index];
  }

  get length() {
    return this.items.length;
  }

  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }
}

export class Slide {
  constructor(presentation, options = {}) {
    this.presentation = presentation;
    this.id = options.id ?? makeId("slide");
    this.title = options.title ?? null;
    this.root = null;
    this.elements = [];
  }

  addElement(element) {
    this.elements.push(element);
    return element;
  }

  toJSON(index = 0) {
    return {
      index,
      id: this.id,
      title: this.title,
      slideSize: this.presentation.slideSize,
      elements: this.elements.map((element) => ({ ...element })),
    };
  }
}

export class PresentationFile {
  static async exportPptx(presentation) {
    return new PptxPresentationFile(presentation);
  }
}

class PptxPresentationFile {
  constructor(presentation) {
    this.presentation = presentation;
  }

  async save(filePath) {
    const outputPath = path.resolve(filePath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    let pptxgenjs;
    try {
      pptxgenjs = await import("pptxgenjs");
    } catch (error) {
      throw new Error(`pptxgenjs is required to export PPTX. Run npm install in the plugin root. ${error.message}`);
    }

    const PptxGenJS = pptxgenjs.default ?? pptxgenjs;
    const pptx = new PptxGenJS();
    const widthIn = this.presentation.slideSize.width / PX_PER_INCH;
    const heightIn = this.presentation.slideSize.height / PX_PER_INCH;
    pptx.author = "Anybox";
    pptx.subject = "Anybox generated presentation";
    pptx.title = "Anybox Presentation";
    pptx.company = "Anybox";
    pptx.lang = "en-US";
    pptx.layout = "LAYOUT_WIDE";
    if (typeof pptx.defineLayout === "function") {
      pptx.defineLayout({ name: "ANYBOX_CUSTOM", width: widthIn, height: heightIn });
      pptx.layout = "ANYBOX_CUSTOM";
    }

    for (const slide of this.presentation.slides) {
      const pptSlide = pptx.addSlide();
      for (const element of slide.elements) {
        await addElementToPptx(pptx, pptSlide, element, this.presentation);
      }
    }

    try {
      await pptx.writeFile({ fileName: outputPath });
    } catch (error) {
      if (typeof pptx.writeFile === "function") {
        await pptx.writeFile({ fileName: outputPath });
      } else {
        throw error;
      }
    }

    return outputPath;
  }
}

export function composeSlide(slide, elementTree) {
  if (!(slide instanceof Slide)) {
    throw new TypeError("composeSlide requires a Slide created by presentation.slides.add().");
  }
  const root = normalizeRootElement(elementTree, slide.presentation.slideSize);
  const elements = flattenElement(root, {
    left: 0,
    top: 0,
    width: root.width,
    height: root.height,
  });
  slide.root = root;
  slide.elements = elements;
  const title = elements.find((element) => element.type === "Text" && element.role === "title")
    ?? elements.find((element) => element.type === "Text" && element.top < 140 && element.style?.fontSize >= 24);
  slide.title = title?.text ?? slide.title;
  return slide;
}

export function Layers(options = {}, children = []) {
  return element("Layers", { ...options, children: asChildren(children) });
}

export function Text(text, options = {}) {
  return element("Text", { ...options, text: text == null ? "" : String(text) });
}

export function Shape(options = {}) {
  return element("Shape", options);
}

export function Image(options = {}) {
  return element("Image", options);
}

export function Panel(options = {}, children = []) {
  return element("Panel", { ...options, children: asChildren(children) });
}

export function Row(options = {}, children = []) {
  if (Array.isArray(options)) {
    return element("Row", { children: options });
  }
  return element("Row", { ...options, children: asChildren(children) });
}

export function Column(options = {}, children = []) {
  if (Array.isArray(options)) {
    return element("Column", { children: options });
  }
  return element("Column", { ...options, children: asChildren(children) });
}

export function textStyle(style = {}) {
  if (typeof style === "string") return parseTextStyle(style);
  return normalizeTextStyle(style);
}

export function stroke(color = "#000000", options = {}) {
  if (color === "none" || color === "transparent" || color === null) {
    return { color: "none", width: 0, transparency: 100, ...options };
  }
  return {
    color,
    width: options.width ?? 1,
    transparency: options.transparency ?? 0,
    ...options,
  };
}

export function fill(color = "#FFFFFF", options = {}) {
  if (color === "none" || color === "transparent" || color === null) {
    return { color: "none", transparency: 100, ...options };
  }
  return { color, transparency: options.transparency ?? 0, ...options };
}

export function theme(tokens = {}) {
  return { ...tokens };
}

export async function renderSlideToSvg(slide, options = {}) {
  const slideSize = slide.presentation.slideSize;
  const body = [];
  for (const element of slide.elements) {
    body.push(await elementToSvg(element, {
      workspaceDir: options.workspaceDir ?? slide.presentation.workspaceDir,
    }));
  }
  return [
    `<svg xmlns="${SVG_NS}" width="${slideSize.width}" height="${slideSize.height}" viewBox="0 0 ${slideSize.width} ${slideSize.height}">`,
    ...body,
    "</svg>",
  ].join("\n");
}

export async function renderSlideToPng(slide, outputPath, options = {}) {
  let sharpModule;
  try {
    sharpModule = await import("sharp");
  } catch (error) {
    throw new Error(`sharp is required to render PNG previews. Run npm install in the plugin root. ${error.message}`);
  }
  const sharp = sharpModule.default ?? sharpModule;
  const svg = await renderSlideToSvg(slide, options);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

export async function renderSvgToPng(svg, outputPath) {
  let sharpModule;
  try {
    sharpModule = await import("sharp");
  } catch (error) {
    throw new Error(`sharp is required to render PNG previews. Run npm install in the plugin root. ${error.message}`);
  }
  const sharp = sharpModule.default ?? sharpModule;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

export function slideToLayout(slide) {
  return slide.toJSON(0);
}

export function deckToLayout(presentation) {
  return presentation.toJSON();
}

export function resolveAssetPath(src, workspaceDir = null) {
  if (!src || typeof src !== "string") return null;
  if (src.startsWith("data:")) return src;
  if (path.isAbsolute(src)) return src;
  if (!workspaceDir) return path.resolve(src);
  const candidates = [
    path.resolve(workspaceDir, "assets", src),
    path.resolve(workspaceDir, src),
  ];
  return candidates[0];
}

function element(type, props) {
  return {
    id: props.id ?? makeId(type.toLowerCase()),
    type,
    ...props,
  };
}

function makeId(prefix) {
  return `${prefix}-${nextId++}`;
}

function normalizeSlideSize(slideSize = DEFAULT_SLIDE_SIZE) {
  const width = Number(slideSize.width ?? DEFAULT_SLIDE_SIZE.width);
  const height = Number(slideSize.height ?? DEFAULT_SLIDE_SIZE.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("slideSize must include positive numeric width and height.");
  }
  return { width, height };
}

function normalizeRootElement(root, slideSize) {
  if (!root || root.type !== "Layers") {
    throw new Error("composeSlide expects a Layers(...) root element.");
  }
  return {
    ...root,
    width: Number(root.width ?? slideSize.width),
    height: Number(root.height ?? slideSize.height),
    children: asChildren(root.children),
  };
}

function asChildren(children) {
  return Array.isArray(children) ? children.filter(Boolean) : [];
}

function flattenElement(node, parentBox, forcedBox = null) {
  if (!node) return [];
  const box = forcedBox ?? resolveBox(node, parentBox);

  if (node.type === "Layers") {
    return asChildren(node.children).flatMap((child) => flattenElement(child, box));
  }

  if (node.type === "Panel") {
    const padding = normalizePadding(node.padding ?? 0);
    const panelShape = normalizeLeaf({ ...node, type: "Shape", role: node.role ?? "panel" }, box);
    const childBox = {
      left: box.left + padding.left,
      top: box.top + padding.top,
      width: Math.max(0, box.width - padding.left - padding.right),
      height: Math.max(0, box.height - padding.top - padding.bottom),
    };
    return [
      panelShape,
      ...asChildren(node.children).flatMap((child) => flattenElement(child, childBox)),
    ];
  }

  if (node.type === "Row" || node.type === "Column") {
    return layoutStack(node, box).flatMap(({ child, childBox }) => flattenElement(child, box, childBox));
  }

  return [normalizeLeaf(node, box)];
}

function resolveBox(node, parentBox) {
  const position = node.position ?? {};
  const left = parentBox.left + Number(position.left ?? node.left ?? 0);
  const top = parentBox.top + Number(position.top ?? node.top ?? 0);
  const width = Number(node.width ?? position.width ?? parentBox.width);
  const height = Number(node.height ?? position.height ?? parentBox.height);
  return { left, top, width, height };
}

function normalizeLeaf(node, box) {
  const base = {
    id: node.id ?? makeId(node.type.toLowerCase()),
    type: node.type,
    role: node.role,
    left: round(box.left),
    top: round(box.top),
    width: round(box.width),
    height: round(box.height),
  };

  if (node.type === "Text") {
    return {
      ...base,
      text: node.text ?? "",
      style: textStyle(node.style ?? {}),
      metadata: node.metadata ?? {},
    };
  }

  if (node.type === "Shape") {
    return {
      ...base,
      shape: node.shape ?? "rect",
      radius: Number(node.radius ?? 0),
      fill: normalizePaint(node.fill ?? "#FFFFFF"),
      line: normalizeLine(node.line ?? stroke("none")),
      metadata: node.metadata ?? {},
    };
  }

  if (node.type === "Image") {
    return {
      ...base,
      src: node.src ?? node.path ?? "",
      alt: node.alt ?? "",
      fit: node.fit ?? "cover",
      metadata: node.metadata ?? {},
    };
  }

  return { ...base, metadata: node.metadata ?? {} };
}

function layoutStack(node, box) {
  const children = asChildren(node.children);
  const gap = Number(node.gap ?? 0);
  const isRow = node.type === "Row";
  const totalGap = Math.max(0, children.length - 1) * gap;
  const mainSize = isRow ? box.width : box.height;
  const explicit = children.map((child) => Number(isRow ? child.width : child.height));
  const explicitTotal = explicit.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  const autoCount = explicit.filter((value) => !Number.isFinite(value)).length;
  const autoSize = autoCount > 0 ? Math.max(0, (mainSize - totalGap - explicitTotal) / autoCount) : 0;
  let cursor = isRow ? box.left : box.top;

  return children.map((child, index) => {
    const childMain = Number.isFinite(explicit[index]) ? explicit[index] : autoSize;
    const childBox = isRow
      ? {
          left: cursor,
          top: box.top,
          width: childMain,
          height: Number(child.height ?? box.height),
        }
      : {
          left: box.left,
          top: cursor,
          width: Number(child.width ?? box.width),
          height: childMain,
        };
    cursor += childMain + gap;
    return { child, childBox };
  });
}

function normalizePadding(padding) {
  if (typeof padding === "number") {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return {
    top: Number(padding.top ?? 0),
    right: Number(padding.right ?? padding.x ?? 0),
    bottom: Number(padding.bottom ?? 0),
    left: Number(padding.left ?? padding.x ?? 0),
  };
}

function normalizePaint(value) {
  if (typeof value === "string") return fill(value);
  return fill(value.color ?? "#FFFFFF", value);
}

function normalizeLine(value) {
  if (typeof value === "string") return stroke(value);
  return stroke(value.color ?? "none", value);
}

function parseTextStyle(style) {
  const out = {};
  for (const part of style.split(";")) {
    const [rawKey, ...rawValue] = part.split(":");
    if (!rawKey || rawValue.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.join(":").trim();
    if (key === "font") {
      const match = value.match(/([0-9.]+)px\s+(.+)/i);
      if (match) {
        out.fontSize = Number(match[1]);
        out.fontFace = stripQuotes(match[2].trim());
      }
      continue;
    }
    if (key === "font-size") out.fontSize = Number(value.replace("px", ""));
    if (key === "font-family") out.fontFace = stripQuotes(value);
    if (key === "weight" || key === "font-weight") out.bold = Number(value) >= 600 || value === "bold";
    if (key === "color") out.color = value;
    if (key === "align" || key === "text-align") out.align = value;
    if (key === "valign" || key === "vertical-align") out.valign = value;
    if (key === "line-height") out.lineHeight = Number(value.replace("px", ""));
  }
  return normalizeTextStyle(out);
}

function normalizeTextStyle(style) {
  return {
    fontFace: style.fontFace ?? style.fontFamily ?? "Arial",
    fontSize: Number(style.fontSize ?? 18),
    bold: Boolean(style.bold),
    italic: Boolean(style.italic),
    color: style.color ?? "#111827",
    align: style.align ?? "left",
    valign: style.valign ?? "top",
    lineHeight: Number(style.lineHeight ?? Number(style.fontSize ?? 18) * 1.2),
    margin: style.margin ?? 0,
    ...style,
  };
}

function stripQuotes(value) {
  return value.replace(/^["']|["']$/g, "");
}

async function addElementToPptx(pptx, pptSlide, element, presentation) {
  const options = {
    x: element.left / PX_PER_INCH,
    y: element.top / PX_PER_INCH,
    w: element.width / PX_PER_INCH,
    h: element.height / PX_PER_INCH,
  };

  if (element.type === "Shape") {
    const shapeType = mapShapeType(pptx, element);
    pptSlide.addShape(shapeType, {
      ...options,
      fill: pptxFill(element.fill),
      line: pptxLine(element.line),
    });
    return;
  }

  if (element.type === "Text") {
    const style = element.style ?? {};
    pptSlide.addText(element.text, {
      ...options,
      fontFace: style.fontFace,
      fontSize: style.fontSize,
      bold: style.bold,
      italic: style.italic,
      color: stripHash(style.color),
      align: style.align,
      valign: style.valign === "middle" ? "mid" : style.valign,
      margin: Number(style.margin ?? 0) / PX_PER_INCH,
      breakLine: false,
      fit: "shrink",
    });
    return;
  }

  if (element.type === "Image") {
    const src = resolveAssetPath(element.src, presentation.workspaceDir);
    if (!src) throw new Error(`Image element ${element.id} is missing src.`);
    if (src.startsWith("data:")) {
      pptSlide.addImage({ data: src, ...options });
      return;
    }
    await fs.access(src).catch(() => {
      throw new Error(`Image not found: ${src}`);
    });
    pptSlide.addImage({ path: src, ...options });
  }
}

function mapShapeType(pptx, element) {
  const name = element.radius > 0 ? "roundRect" : element.shape;
  return pptx.ShapeType?.[name] ?? pptx.ShapeType?.rect ?? name ?? "rect";
}

function pptxFill(value) {
  if (!value || value.color === "none") return { color: "FFFFFF", transparency: 100 };
  return { color: stripHash(value.color), transparency: Number(value.transparency ?? 0) };
}

function pptxLine(value) {
  if (!value || value.color === "none" || Number(value.width ?? 0) === 0) {
    return { color: "FFFFFF", transparency: 100 };
  }
  return {
    color: stripHash(value.color),
    transparency: Number(value.transparency ?? 0),
    width: Number(value.width ?? 1),
  };
}

async function elementToSvg(element, options) {
  if (element.type === "Shape") {
    const fillAttr = svgPaint(element.fill);
    const lineAttr = svgStroke(element.line);
    const radius = Number(element.radius ?? 0);
    return `<rect x="${element.left}" y="${element.top}" width="${element.width}" height="${element.height}" rx="${radius}" ry="${radius}" ${fillAttr} ${lineAttr}/>`;
  }

  if (element.type === "Text") {
    return textToSvg(element);
  }

  if (element.type === "Image") {
    const href = await imageHref(element.src, options.workspaceDir);
    return `<image x="${element.left}" y="${element.top}" width="${element.width}" height="${element.height}" href="${escapeAttr(href)}" preserveAspectRatio="xMidYMid slice"/>`;
  }

  return "";
}

function textToSvg(element) {
  const style = element.style ?? {};
  const fontSize = Number(style.fontSize ?? 18);
  const lineHeight = Number(style.lineHeight ?? fontSize * 1.2);
  const margin = Number(style.margin ?? 0);
  const x = element.left + margin;
  const y = element.top + margin + fontSize;
  const maxWidth = Math.max(1, element.width - margin * 2);
  const lines = wrapText(element.text ?? "", maxWidth, fontSize);
  const weight = style.bold ? 700 : 400;
  const fontStyle = style.italic ? "italic" : "normal";
  const anchor = style.align === "center" ? "middle" : style.align === "right" ? "end" : "start";
  const textX = style.align === "center" ? element.left + element.width / 2 : style.align === "right" ? element.left + element.width - margin : x;
  const tspans = lines.map((line, index) => (
    `<tspan x="${textX}" y="${round(y + index * lineHeight)}">${escapeXml(line)}</tspan>`
  ));
  return [
    `<g clip-path="url(#clip-${escapeAttr(element.id)})">`,
    `<clipPath id="clip-${escapeAttr(element.id)}"><rect x="${element.left}" y="${element.top}" width="${element.width}" height="${element.height}"/></clipPath>`,
    `<text font-family="${escapeAttr(style.fontFace ?? "Arial")}" font-size="${fontSize}" font-weight="${weight}" font-style="${fontStyle}" fill="${escapeAttr(style.color ?? "#111827")}" text-anchor="${anchor}">`,
    ...tspans,
    "</text>",
    "</g>",
  ].join("");
}

function wrapText(text, width, fontSize) {
  const raw = String(text).split(/\r?\n/);
  const maxChars = Math.max(1, Math.floor(width / (fontSize * 0.55)));
  const lines = [];
  for (const paragraph of raw) {
    const words = paragraph.includes(" ") ? paragraph.split(/\s+/) : paragraph.split("");
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line}${paragraph.includes(" ") ? " " : ""}${word}` : word;
      if (candidate.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}

async function imageHref(src, workspaceDir) {
  const resolved = resolveAssetPath(src, workspaceDir);
  if (!resolved) return "";
  if (resolved.startsWith("data:")) return resolved;
  const data = await fs.readFile(resolved);
  const ext = path.extname(resolved).slice(1).toLowerCase() || "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : `image/${ext}`;
  return `data:${mime};base64,${data.toString("base64")}`;
}

function svgPaint(value) {
  if (!value || value.color === "none") return 'fill="none"';
  const opacity = 1 - Number(value.transparency ?? 0) / 100;
  return `fill="${escapeAttr(value.color)}" fill-opacity="${opacity}"`;
}

function svgStroke(value) {
  if (!value || value.color === "none" || Number(value.width ?? 0) === 0) {
    return 'stroke="none"';
  }
  const opacity = 1 - Number(value.transparency ?? 0) / 100;
  return `stroke="${escapeAttr(value.color)}" stroke-opacity="${opacity}" stroke-width="${Number(value.width ?? 1)}"`;
}

function stripHash(color = "000000") {
  return String(color).replace(/^#/, "").toUpperCase();
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeXml(value).replace(/"/g, "&quot;");
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

export const namespaces = {
  svg: SVG_NS,
  xhtml: XHTML_NS,
};
