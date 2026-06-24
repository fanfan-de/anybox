import DOMPurify, { type Config } from "dompurify"

const sanitizeConfig = {
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
  ALLOWED_ATTR: ["alt", "class", "colspan", "height", "rowspan", "src", "title", "width"],
  ALLOWED_TAGS: [
    "article",
    "aside",
    "blockquote",
    "body",
    "br",
    "code",
    "div",
    "em",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hr",
    "html",
    "img",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "span",
    "strong",
    "style",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ],
  ALLOWED_URI_REGEXP: /^data:image\/(?:avif|gif|jpeg|jpg|png|webp);base64,/i,
  FORBID_ATTR: ["style"],
  FORBID_TAGS: [
    "audio",
    "base",
    "button",
    "canvas",
    "embed",
    "form",
    "iframe",
    "input",
    "link",
    "meta",
    "object",
    "script",
    "select",
    "source",
    "textarea",
    "track",
    "video",
  ],
  WHOLE_DOCUMENT: true,
} satisfies Config

function sanitizeStyleBlocks(html: string) {
  return html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_match, attributes: string, css: string) => {
    const safeCss = css
      .replace(/@import\b[^;]*(?:;|$)/gi, "")
      .replace(/expression\s*\([^)]*\)/gi, "")
      .replace(/url\s*\(\s*(['"]?)(?!data:image\/(?:avif|gif|jpeg|jpg|png|webp);base64,)[^)]+?\1\s*\)/gi, "none")

    return `<style${attributes}>${safeCss}</style>`
  })
}

function injectFrameDefaults(html: string, options: { paused: boolean }) {
  const csp = [
    "default-src 'none'",
    "script-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "img-src data:",
    "style-src 'unsafe-inline'",
    "font-src data:",
    "media-src 'none'",
  ].join("; ")

  const defaultHead = [
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<style>",
    "html{box-sizing:border-box;width:100%;height:100%;overflow:hidden;background:transparent;color:#111827;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}",
    "*,*::before,*::after{box-sizing:inherit;}",
    "body{margin:0;width:100%;min-width:0;min-height:100%;overflow:hidden;background:transparent;}",
    "img{max-width:100%;height:auto;}",
    "@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:0.001ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:0.001ms!important;}}",
    options.paused
      ? "*,*::before,*::after{animation-play-state:paused!important;transition:none!important;}"
      : "",
    "</style>",
  ].join("")

  if (/<head(?:\s|>)/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${defaultHead}`)
  }

  if (/<html(?:\s|>)/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${defaultHead}</head>`)
  }

  return `<!doctype html><html><head>${defaultHead}</head><body>${html}</body></html>`
}

function injectTrustedDynamicFrameDefaults(html: string, options: { paused: boolean }) {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: data: https: http:",
    "connect-src blob: data: https: http:",
    "img-src blob: data: https: http:",
    "style-src 'unsafe-inline' https: http:",
    "font-src data: https: http:",
    "media-src data: blob: https: http:",
    "worker-src blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ")

  const defaultHead = [
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<style>",
    "html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;}",
    "*,*::before,*::after{box-sizing:border-box;}",
    options.paused
      ? "*,*::before,*::after{animation-play-state:paused!important;transition:none!important;}"
      : "",
    "</style>",
  ].join("")

  if (/<head(?:\s|>)/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${defaultHead}`)
  }

  if (/<html(?:\s|>)/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${defaultHead}</head>`)
  }

  return `<!doctype html><html><head>${defaultHead}</head><body>${html}</body></html>`
}

export function sanitizeHtmlBackgroundDocument(html: string, options: { paused?: boolean } = {}) {
  const sanitized = DOMPurify.sanitize(html, sanitizeConfig)
  const sanitizedHtml = typeof sanitized === "string" ? sanitized : ""
  return injectFrameDefaults(sanitizeStyleBlocks(sanitizedHtml), { paused: Boolean(options.paused) })
}

export function buildTrustedDynamicHtmlBackgroundDocument(html: string, options: { paused?: boolean } = {}) {
  return injectTrustedDynamicFrameDefaults(html, { paused: Boolean(options.paused) })
}
