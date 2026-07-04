#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const workspaceRoot = path.resolve(process.cwd());
const articleArg = process.argv[2];
const outputArg = process.argv[3];

if (!articleArg) {
  console.error("ERROR: missing article path");
  console.error("Usage: node prepare-zhihu-article.mjs <article.md> [output-dir]");
  process.exit(1);
}

const articlePath = path.resolve(articleArg);
const outputDir = path.resolve(outputArg || path.join(workspaceRoot, "zhihu-publish-out"));

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function parseFrontmatter(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { data: {}, body: source, errors: ["missing frontmatter"] };
  }

  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return { data: {}, body: source, errors: ["frontmatter is not closed"] };
  }

  const raw = normalized.slice(4, end);
  const body = normalized.slice(end + 5).trimStart();
  const data = {};
  let currentListKey = null;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;

    const listMatch = line.match(/^\s*-\s*(.+?)\s*$/);
    if (listMatch && currentListKey) {
      data[currentListKey].push(unquote(listMatch[1]));
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!pair) continue;

    const [, key, value] = pair;
    if (value === "") {
      data[key] = [];
      currentListKey = key;
    } else {
      data[key] = unquote(value);
      currentListKey = null;
    }
  }

  return { data, body, errors: [] };
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeImageTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }
  return target.replace(/\\/g, "/");
}

function resolveAsset(target, articleDir) {
  const cleanTarget = normalizeImageTarget(target.split("|")[0]);
  const candidates = [
    path.resolve(articleDir, cleanTarget),
    path.resolve(workspaceRoot, cleanTarget),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0];
}

function collectImages(markdown, articleDir) {
  const images = [];
  const matches = [
    ...markdown.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g),
  ].map((match) => ({
    syntax: "markdown",
    alt: match[1].trim(),
    target: normalizeImageTarget(match[2]),
    resolvedPath: resolveAsset(match[2], articleDir),
  }));

  const wikiMatches = [
    ...markdown.matchAll(/!\[\[([^\]]+)\]\]/g),
  ].map((match) => {
    const [target, alt = ""] = match[1].split("|");
    return {
      syntax: "wikilink",
      alt: alt.trim(),
      target: normalizeImageTarget(target),
      resolvedPath: resolveAsset(target, articleDir),
    };
  });

  images.push(...matches, ...wikiMatches);
  return images;
}

function markdownToHtml(markdown, articleDir) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listOpen = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const closeList = () => {
    if (!listOpen) return;
    html.push("</ul>");
    listOpen = false;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const image = parseImageLine(trimmed, articleDir);
    if (image) {
      flushParagraph();
      closeList();
      html.push(`<p><img src="${toFileUrl(image.resolvedPath)}" alt="${escapeHtml(image.alt)}"></p>`);
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();

  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "  <meta charset=\"utf-8\">",
    "  <title>Zhihu Publish Draft</title>",
    "</head>",
    "<body>",
    ...html,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function parseImageLine(line, articleDir) {
  const md = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (md) {
    return { alt: md[1].trim(), resolvedPath: resolveAsset(md[2], articleDir) };
  }

  const wiki = line.match(/^!\[\[([^\]]+)\]\]$/);
  if (wiki) {
    const [target, alt = ""] = wiki[1].split("|");
    return { alt: alt.trim(), resolvedPath: resolveAsset(target, articleDir) };
  }

  return null;
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>');
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toFileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1:")}`;
}

function makePlainText(markdown) {
  return markdown
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_, target) => `[图片：${target}]`)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, target) => `[图片：${alt || target}]`)
    .trim();
}

if (!fs.existsSync(articlePath)) {
  fail(`article not found: ${articlePath}`);
  process.exit();
}

const articleDir = path.dirname(articlePath);
const source = fs.readFileSync(articlePath, "utf8");
const { data, body, errors } = parseFrontmatter(source);
const images = collectImages(body, articleDir);
const missingImages = images.filter((image) => !fs.existsSync(image.resolvedPath));

fs.mkdirSync(outputDir, { recursive: true });

const safeName = path.basename(articlePath, path.extname(articlePath)).replace(/[<>:"/\\|?*]/g, "_");
const htmlPath = path.join(outputDir, `${safeName}.html`);
const plainPath = path.join(outputDir, `${safeName}.txt`);
const manifestPath = path.join(outputDir, `${safeName}.manifest.json`);
const topics = Array.isArray(data["zhihu-topics"]) ? data["zhihu-topics"] : [];

const manifest = {
  articlePath,
  title: data["zhihu-title"] || data.title || path.basename(articlePath, path.extname(articlePath)),
  topics,
  link: data["zhihu-link"] || "",
  cover: data["zhihu-cover"] || "",
  images,
  missingImages,
  outputs: { htmlPath, plainPath, manifestPath },
};

fs.writeFileSync(htmlPath, markdownToHtml(body, articleDir), "utf8");
fs.writeFileSync(plainPath, makePlainText(body), "utf8");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

if (errors.length) fail(errors.join("; "));
if (!manifest.title) fail("missing zhihu-title");
if (!manifest.topics.length) fail("missing zhihu-topics");
if (missingImages.length) {
  fail(`missing ${missingImages.length} image(s): ${missingImages.map((image) => image.target).join(", ")}`);
}

if (!process.exitCode) {
  console.log(`OK title: ${manifest.title}`);
  console.log(`OK topics: ${manifest.topics.join(", ")}`);
  console.log(`OK images: ${images.length}`);
  console.log(`HTML: ${htmlPath}`);
  console.log(`TEXT: ${plainPath}`);
  console.log(`MANIFEST: ${manifestPath}`);
}
