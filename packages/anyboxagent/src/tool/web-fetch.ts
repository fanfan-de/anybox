import { isIP } from "node:net"
import z from "zod"
import * as Tool from "#tool/tool.ts"

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 250_000
const DEFAULT_MAX_CONTENT_CHARS = 12_000
const DEFAULT_MAX_LINKS = 20
const MAX_REDIRECTS = 5
const USER_AGENT = "anyboxagent-web-fetch/1.0"

const WebFetchParameters = z.object({
  url: z.string().url().describe("Absolute http or https URL to fetch."),
  method: z.enum(["GET", "HEAD"]).optional().describe("HTTP method. Defaults to GET."),
  output: z.enum(["auto", "text", "markdown", "html", "json"]).optional().describe(
    "Preferred content output format. HTML pages default to markdown in auto mode.",
  ),
  timeoutMs: z.number().int().positive().max(60_000).optional().describe("Request timeout in milliseconds."),
  maxBytes: z.number().int().positive().max(2_000_000).optional().describe("Maximum response bytes to read."),
  maxContentChars: z.number().int().positive().max(100_000).optional().describe(
    "Maximum normalized content characters to keep in the tool output.",
  ),
  maxLinks: z.number().int().positive().max(200).optional().describe("Maximum links to extract from HTML pages."),
  followRedirects: z.boolean().optional().describe("Follow redirects manually while validating each hop."),
})

type OutputPreference = z.infer<typeof WebFetchParameters>["output"]
type BodyKind = "html" | "json" | "text" | "unsupported"
type StoredContentFormat = "none" | "text" | "markdown" | "html" | "json"

type ExtractedLink = {
  text: string
  url: string
}

interface WebFetchMetadata extends Record<string, unknown> {
  url: string
  finalUrl: string
  status: number
  statusText: string
  ok: boolean
  contentType: string
  contentFormat: StoredContentFormat
  title?: string
  description?: string
  siteName?: string
  publishedAt?: string
  language?: string
  content: string
  contentTruncated: boolean
  bodyBytes: number
  redirects: string[]
  links: ExtractedLink[]
  timeoutMs: number
  maxBytes: number
}

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
}

function isRedirectStatus(status: number) {
  return status >= 300 && status < 400
}

function isBlockedHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase()
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  )
}

function isBlockedIPv4(address: string) {
  const parts = address.split(".").map((value) => Number.parseInt(value, 10))
  if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) return false

  const a = parts[0] ?? -1
  const b = parts[1] ?? -1
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

function isBlockedIPv6(address: string) {
  const normalized = address.trim().toLowerCase()
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.") ||
    normalized.startsWith("::ffff:172.16.") ||
    normalized.startsWith("::ffff:172.17.") ||
    normalized.startsWith("::ffff:172.18.") ||
    normalized.startsWith("::ffff:172.19.") ||
    normalized.startsWith("::ffff:172.2") ||
    normalized.startsWith("::ffff:172.30.") ||
    normalized.startsWith("::ffff:172.31.") ||
    normalized.startsWith("::ffff:169.254.")
  )
}

function assertAllowedWebUrl(rawUrl: string): URL {
  const target = new URL(rawUrl)
  const protocol = target.protocol.toLowerCase()

  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`web_fetch only supports http and https URLs: ${rawUrl}`)
  }

  if (target.username || target.password) {
    throw new Error("web_fetch does not allow embedded credentials in URLs.")
  }

  const hostname = target.hostname.trim()
  if (!hostname) {
    throw new Error("web_fetch requires a valid hostname.")
  }

  if (isBlockedHostname(hostname)) {
    throw new Error(`web_fetch blocked ${rawUrl} because it resolves to a loopback or local network host.`)
  }

  const ipVersion = isIP(hostname)
  if (ipVersion === 4 && isBlockedIPv4(hostname)) {
    throw new Error(`web_fetch blocked ${rawUrl} because it targets a private or reserved IPv4 address.`)
  }

  if (ipVersion === 6 && isBlockedIPv6(hostname)) {
    throw new Error(`web_fetch blocked ${rawUrl} because it targets a private or reserved IPv6 address.`)
  }

  return target
}

function parseHtmlAttributes(fragment: string) {
  const attributes: Record<string, string> = {}
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g

  for (const match of fragment.matchAll(pattern)) {
    const key = match[1]?.toLowerCase()
    const value = match[3] ?? match[4] ?? match[5] ?? ""
    if (!key) continue
    attributes[key] = value
  }

  return attributes
}

function decodeHtmlEntities(input: string) {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (token, entity: string) => {
    const normalized = entity.toLowerCase()
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : token
    }

    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : token
    }

    return HTML_ENTITY_MAP[normalized] ?? token
  })
}

function stripNonContentHtml(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|canvas)\b[\s\S]*?<\/\1>/gi, " ")
}

function extractPlainTextFromHtmlFragment(fragment: string) {
  const withoutTags = fragment.replace(/<[^>]+>/g, " ")
  return normalizeInlineText(decodeHtmlEntities(withoutTags))
}

function normalizeInlineText(input: string) {
  return input.replace(/\s+/g, " ").trim()
}

function normalizeBlockText(input: string) {
  const lines = input
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())

  const result: string[] = []
  let lastWasBlank = true

  for (const line of lines) {
    if (!line) {
      if (!lastWasBlank) {
        result.push("")
        lastWasBlank = true
      }
      continue
    }

    result.push(line)
    lastWasBlank = false
  }

  return result.join("\n").trim()
}

function replaceTagWithText(
  html: string,
  tagName: string,
  formatter: (text: string) => string,
) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi")
  return html.replace(pattern, (_match, inner: string) => {
    const text = extractPlainTextFromHtmlFragment(inner)
    if (!text) return "\n"
    return `\n${formatter(text)}\n`
  })
}

function resolveLinkUrl(href: string, baseUrl: string): string | undefined {
  try {
    const resolved = new URL(href, baseUrl)
    assertAllowedWebUrl(resolved.toString())
    return resolved.toString()
  } catch {
    return undefined
  }
}

function extractLinks(html: string, baseUrl: string, maxLinks: number): ExtractedLink[] {
  const links: ExtractedLink[] = []
  const seen = new Set<string>()
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi

  for (const match of html.matchAll(pattern)) {
    if (links.length >= maxLinks) break
    const attributes = parseHtmlAttributes(match[1] ?? "")
    const href = attributes.href?.trim()
    if (!href || href.startsWith("#")) continue

    const resolved = resolveLinkUrl(href, baseUrl)
    if (!resolved || seen.has(resolved)) continue

    seen.add(resolved)
    links.push({
      text: extractPlainTextFromHtmlFragment(match[2] ?? "") || resolved,
      url: resolved,
    })
  }

  return links
}

function extractMetaContent(html: string, candidates: string[]) {
  const targetKeys = new Set(candidates.map((candidate) => candidate.toLowerCase()))
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []

  for (const tag of tags) {
    const attributes = parseHtmlAttributes(tag)
    const key = attributes.name ?? attributes.property ?? attributes["http-equiv"]
    const content = attributes.content
    if (!key || !content) continue
    if (!targetKeys.has(key.toLowerCase())) continue
    return normalizeInlineText(decodeHtmlEntities(content))
  }

  return undefined
}

function extractTagText(html: string, tagName: string) {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"))
  if (!match?.[1]) return undefined
  return extractPlainTextFromHtmlFragment(match[1])
}

function extractHtmlLanguage(html: string) {
  const match = html.match(/<html\b([^>]*)>/i)
  if (!match?.[1]) return undefined
  const attributes = parseHtmlAttributes(match[1])
  return attributes.lang?.trim()
}

function extractPublishedAt(html: string) {
  const fromMeta = extractMetaContent(html, [
    "article:published_time",
    "og:published_time",
    "publication_date",
    "date",
    "dc.date",
  ])
  if (fromMeta) return fromMeta

  const match = html.match(/<time\b([^>]*)>/i)
  if (!match?.[1]) return undefined
  const attributes = parseHtmlAttributes(match[1])
  return attributes.datetime?.trim()
}

function htmlToText(html: string) {
  let text = stripNonContentHtml(html)
  text = text.replace(/<br\s*\/?>/gi, "\n")
  text = text.replace(/<li\b[^>]*>/gi, "\n- ")
  text = text.replace(/<\/(p|div|section|article|main|header|footer|aside|nav|h[1-6]|blockquote|table|tr|ul|ol|li)>/gi, "\n")
  text = text.replace(/<[^>]+>/g, " ")
  return normalizeBlockText(decodeHtmlEntities(text))
}

function htmlToMarkdown(html: string, baseUrl: string) {
  let markdown = stripNonContentHtml(html)
  markdown = markdown.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, rawAttributes: string, inner: string) => {
    const attributes = parseHtmlAttributes(rawAttributes ?? "")
    const href = attributes.href?.trim()
    const text = extractPlainTextFromHtmlFragment(inner)
    if (!href) return text

    const resolved = resolveLinkUrl(href, baseUrl)
    if (!resolved) return text
    if (!text) return resolved
    return `[${text}](${resolved})`
  })

  for (let level = 6; level >= 1; level--) {
    markdown = replaceTagWithText(markdown, `h${level}`, (text) => `${"#".repeat(level)} ${text}`)
  }

  markdown = replaceTagWithText(markdown, "blockquote", (text) => `> ${text}`)
  markdown = markdown.replace(/<li\b[^>]*>/gi, "\n- ")
  markdown = markdown.replace(/<\/li>/gi, "\n")
  markdown = markdown.replace(/<br\s*\/?>/gi, "\n")
  markdown = markdown.replace(/<\/(p|div|section|article|main|header|footer|aside|nav|ul|ol|table|tr)>/gi, "\n\n")
  markdown = markdown.replace(/<[^>]+>/g, " ")
  return normalizeBlockText(decodeHtmlEntities(markdown))
}

function limitText(input: string, maxChars: number) {
  if (input.length <= maxChars) {
    return {
      text: input,
      truncated: false,
    }
  }

  return {
    text: `${input.slice(0, maxChars).trimEnd()}\n\n[truncated]`,
    truncated: true,
  }
}

function detectBodyKind(contentType: string): BodyKind {
  const normalized = contentType.toLowerCase()
  if (!normalized) return "text"
  if (normalized.includes("html")) return "html"
  if (normalized.includes("json")) return "json"
  if (
    normalized.startsWith("text/") ||
    normalized.includes("xml") ||
    normalized.includes("javascript") ||
    normalized.includes("x-www-form-urlencoded")
  ) {
    return "text"
  }

  return "unsupported"
}

function resolveContentFormat(output: OutputPreference, bodyKind: BodyKind): StoredContentFormat {
  if (bodyKind === "unsupported") return "none"

  switch (output ?? "auto") {
    case "html":
      return bodyKind === "html" ? "html" : "text"
    case "json":
      return bodyKind === "json" ? "json" : "text"
    case "markdown":
      return bodyKind === "html" ? "markdown" : "text"
    case "text":
      return "text"
    case "auto":
    default:
      if (bodyKind === "html") return "markdown"
      if (bodyKind === "json") return "json"
      return "text"
  }
}

function createTextDecoder(contentType: string) {
  const match = contentType.match(/charset=([^\s;]+)/i)
  const requestedCharset = match?.[1]?.trim()

  if (!requestedCharset) {
    return new TextDecoder("utf-8")
  }

  try {
    return new TextDecoder(requestedCharset as ConstructorParameters<typeof TextDecoder>[0])
  } catch {
    return new TextDecoder("utf-8")
  }
}

async function readResponseText(response: Response, maxBytes: number) {
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Tool.ToolControlSignal({
      kind: "blocked",
      reason: `web_fetch stopped because the response is larger than maxBytes (${maxBytes}).`,
      code: "WEB_FETCH_MAX_BYTES_EXCEEDED",
      execution: { sideEffect: "none", retry: "safe" },
    }, { mode: "continue-model", reason: "Web response exceeded the configured byte limit." })
  }

  if (!response.body) {
    return {
      text: "",
      bodyBytes: 0,
    }
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bodyBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    bodyBytes += value.byteLength
    if (bodyBytes > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Tool.ToolControlSignal({
        kind: "blocked",
        reason: `web_fetch stopped because the response exceeded maxBytes (${maxBytes}).`,
        code: "WEB_FETCH_MAX_BYTES_EXCEEDED",
        execution: { sideEffect: "none", retry: "safe" },
      }, { mode: "continue-model", reason: "Web response exceeded the configured byte limit." })
    }

    chunks.push(value)
  }

  const combined = new Uint8Array(bodyBytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }

  const decoder = createTextDecoder(response.headers.get("content-type") ?? "")
  return {
    text: decoder.decode(combined),
    bodyBytes,
  }
}

function createAbortSignal(timeoutMs: number, external?: AbortSignal) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Tool.ToolControlSignal({
      kind: "timeout",
      reason: `web_fetch timed out after ${timeoutMs}ms.`,
      timeoutMs,
      execution: { sideEffect: "none", retry: "safe" },
    }, { mode: "continue-model", reason: "web_fetch timed out." }))
  }, timeoutMs)

  const onAbort = () => {
    const propagated = Tool.findToolControlSignal(external?.reason)
    controller.abort(propagated ?? new Tool.ToolControlSignal({
      kind: "cancelled",
      reason: "web_fetch was cancelled by the framework.",
      by: "framework",
      execution: { sideEffect: "none", retry: "safe" },
    }, { mode: "cancel-turn", reason: "web_fetch was cancelled." }))
  }

  if (external) {
    if (external.aborted) {
      controller.abort(external.reason)
    } else {
      external.addEventListener("abort", onAbort, { once: true })
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer)
      external?.removeEventListener("abort", onAbort)
    },
  }
}

async function fetchWithValidatedRedirects(input: {
  url: URL
  method: "GET" | "HEAD"
  followRedirects: boolean
  timeoutMs: number
  abort?: AbortSignal
}) {
  const abortHandle = createAbortSignal(input.timeoutMs, input.abort)
  const redirects: string[] = []
  let current = input.url

  try {
    for (let index = 0; index <= MAX_REDIRECTS; index++) {
      const response = await fetch(current.toString(), {
        method: input.method,
        redirect: "manual",
        headers: {
          "accept": "text/html, application/json, text/plain;q=0.9, */*;q=0.1",
          "user-agent": USER_AGENT,
        },
        signal: abortHandle.signal,
      })

      if (!input.followRedirects || !isRedirectStatus(response.status)) {
        return {
          response,
          finalUrl: current.toString(),
          redirects,
        }
      }

      const location = response.headers.get("location")
      if (!location) {
        return {
          response,
          finalUrl: current.toString(),
          redirects,
        }
      }

      if (index === MAX_REDIRECTS) {
        throw new Tool.ToolControlSignal({
          kind: "blocked",
          reason: `web_fetch exceeded the redirect limit (${MAX_REDIRECTS}).`,
          code: "WEB_FETCH_REDIRECT_LIMIT",
          execution: { sideEffect: "none", retry: "safe" },
        }, { mode: "continue-model", reason: "Web redirect limit was exceeded." })
      }

      const nextUrl = assertAllowedWebUrl(new URL(location, current).toString())
      redirects.push(nextUrl.toString())
      current = nextUrl
    }

    throw new Tool.ToolControlSignal({
      kind: "blocked",
      reason: `web_fetch exceeded the redirect limit (${MAX_REDIRECTS}).`,
      code: "WEB_FETCH_REDIRECT_LIMIT",
      execution: { sideEffect: "none", retry: "safe" },
    }, { mode: "continue-model", reason: "Web redirect limit was exceeded." })
  } catch (error) {
    const signal = Tool.findToolControlSignal(error) ??
      Tool.findToolControlSignal(abortHandle.signal.reason)
    if (signal) throw signal
    throw error
  } finally {
    abortHandle.cleanup()
  }
}

function buildTextOutput(metadata: WebFetchMetadata) {
  const lines = [
    `URL: ${metadata.url}`,
    metadata.finalUrl !== metadata.url ? `Final URL: ${metadata.finalUrl}` : undefined,
    `Status: ${metadata.status}${metadata.statusText ? ` ${metadata.statusText}` : ""}`,
    `Content-Type: ${metadata.contentType || "(unknown)"}`,
    `Format: ${metadata.contentFormat}`,
    metadata.title ? `Title: ${metadata.title}` : undefined,
    metadata.description ? `Description: ${metadata.description}` : undefined,
    metadata.siteName ? `Site: ${metadata.siteName}` : undefined,
    metadata.language ? `Language: ${metadata.language}` : undefined,
    metadata.publishedAt ? `Published: ${metadata.publishedAt}` : undefined,
    metadata.redirects.length > 0 ? `Redirects: ${metadata.redirects.join(" -> ")}` : undefined,
    `Bytes: ${metadata.bodyBytes}`,
    metadata.contentTruncated ? "Note: normalized content was truncated." : undefined,
    "",
    "Content:",
    metadata.content || "(no body)",
    metadata.links.length > 0 ? "" : undefined,
    metadata.links.length > 0 ? "Links:" : undefined,
    ...metadata.links.map((link) => `- ${link.text}: ${link.url}`),
  ]

  return lines.filter(Boolean).join("\n")
}

function buildHtmlMetadata(input: {
  html: string
  url: string
  output: OutputPreference
  maxLinks: number
  maxContentChars: number
}) {
  const title = extractTagText(input.html, "title")
  const description = extractMetaContent(input.html, ["description", "og:description", "twitter:description"])
  const siteName = extractMetaContent(input.html, ["og:site_name", "application-name"])
  const publishedAt = extractPublishedAt(input.html)
  const language = extractHtmlLanguage(input.html)
  const links = extractLinks(input.html, input.url, input.maxLinks)
  const contentFormat = resolveContentFormat(input.output, "html")
  const rawContent =
    contentFormat === "html"
      ? input.html.trim()
      : contentFormat === "text"
        ? htmlToText(input.html)
        : htmlToMarkdown(input.html, input.url)
  const limited = limitText(rawContent, input.maxContentChars)

  return {
    title,
    description,
    siteName,
    publishedAt,
    language,
    links,
    contentFormat,
    content: limited.text,
    contentTruncated: limited.truncated,
  }
}

function buildJsonMetadata(input: {
  text: string
  output: OutputPreference
  maxContentChars: number
}) {
  const contentFormat = resolveContentFormat(input.output, "json")

  let pretty = input.text.trim()
  try {
    pretty = JSON.stringify(JSON.parse(input.text), null, 2)
  } catch {
    // Keep the raw text when parsing fails even if the server labeled it as JSON.
  }

  const limited = limitText(pretty, input.maxContentChars)
  return {
    contentFormat,
    content: limited.text,
    contentTruncated: limited.truncated,
    links: [] as ExtractedLink[],
  }
}

function buildTextMetadata(input: {
  text: string
  output: OutputPreference
  maxContentChars: number
}) {
  const contentFormat = resolveContentFormat(input.output, "text")
  const limited = limitText(input.text.trim(), input.maxContentChars)
  return {
    contentFormat,
    content: limited.text,
    contentTruncated: limited.truncated,
    links: [] as ExtractedLink[],
  }
}

export const WebFetchTool = Tool.define(
  "web_fetch",
  async (): Promise<Tool.ToolRuntime<typeof WebFetchParameters, WebFetchMetadata>> => {
    return {
      title: "Web Fetch",
      description: "Fetch a public web page or JSON endpoint and return normalized content for the model.",
      parameters: WebFetchParameters,
      validate: (parameters, ctx) => {
        if (ctx.abort?.aborted) {
          throw new Tool.ToolControlSignal({
            kind: "cancelled",
            reason: "web_fetch was cancelled before the request started.",
            by: "framework",
            execution: { sideEffect: "none", retry: "safe" },
          }, { mode: "cancel-turn", reason: "web_fetch was cancelled." })
        }

        try {
          assertAllowedWebUrl(parameters.url)
        } catch (error) {
          return error instanceof Error ? error.message : "web_fetch rejected the target URL."
        }
      },
      describeApproval: (parameters) => ({
        title: `Fetch ${parameters.url}`,
        summary: `Fetch ${parameters.url} and extract normalized response content.`,
      }),
      execute: async (parameters, ctx) => {
        const target = assertAllowedWebUrl(parameters.url)
        const method = parameters.method ?? "GET"
        const output = parameters.output ?? "auto"
        const timeoutMs = parameters.timeoutMs ?? DEFAULT_TIMEOUT_MS
        const maxBytes = parameters.maxBytes ?? DEFAULT_MAX_BYTES
        const maxContentChars = parameters.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS
        const maxLinks = parameters.maxLinks ?? DEFAULT_MAX_LINKS
        const followRedirects = parameters.followRedirects ?? true

        const { response, finalUrl, redirects } = await fetchWithValidatedRedirects({
          url: target,
          method,
          followRedirects,
          timeoutMs,
          abort: ctx.abort,
        })

        const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? ""
        const bodyKind = detectBodyKind(contentType)

        if (method === "GET" && bodyKind === "unsupported") {
          const reason = `web_fetch does not support content-type "${contentType || "unknown"}". Prefer HTML, JSON, or plain text endpoints.`
          throw new Tool.ToolControlSignal({
            kind: "blocked",
            reason,
            code: "WEB_FETCH_UNSUPPORTED_CONTENT_TYPE",
            execution: { sideEffect: "none", retry: "safe" },
          }, { mode: "continue-model", reason })
        }

        let content = ""
        let contentTruncated = false
        let bodyBytes = 0
        let contentFormat: StoredContentFormat = "none"
        let title: string | undefined
        let description: string | undefined
        let siteName: string | undefined
        let publishedAt: string | undefined
        let language: string | undefined
        let links: ExtractedLink[] = []

        if (method === "GET" && bodyKind !== "unsupported") {
          const body = await readResponseText(response, maxBytes)
          bodyBytes = body.bodyBytes

          if (bodyKind === "html") {
            const extracted = buildHtmlMetadata({
              html: body.text,
              url: finalUrl,
              output,
              maxLinks,
              maxContentChars,
            })

            title = extracted.title
            description = extracted.description
            siteName = extracted.siteName
            publishedAt = extracted.publishedAt
            language = extracted.language
            links = extracted.links
            contentFormat = extracted.contentFormat
            content = extracted.content
            contentTruncated = extracted.contentTruncated
          } else if (bodyKind === "json") {
            const extracted = buildJsonMetadata({
              text: body.text,
              output,
              maxContentChars,
            })

            links = extracted.links
            contentFormat = extracted.contentFormat
            content = extracted.content
            contentTruncated = extracted.contentTruncated
          } else {
            const extracted = buildTextMetadata({
              text: body.text,
              output,
              maxContentChars,
            })

            links = extracted.links
            contentFormat = extracted.contentFormat
            content = extracted.content
            contentTruncated = extracted.contentTruncated
          }
        }

        const metadata: WebFetchMetadata = {
          url: target.toString(),
          finalUrl,
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          contentType,
          contentFormat,
          title,
          description,
          siteName,
          publishedAt,
          language,
          content,
          contentTruncated,
          bodyBytes,
          redirects,
          links,
          timeoutMs,
          maxBytes,
        }

        return {
          title: `Fetched ${finalUrl}`,
          text: buildTextOutput(metadata),
          metadata,
          result: response.ok ? "success" : "negative",
          completeness: contentTruncated ? "partial" : "complete",
          sideEffect: "none",
          retry: "safe",
        }
      },
      toModelOutput: async (result) => {
        if (!result.metadata) {
          return {
            type: "text",
            value: result.text,
          }
        }

        return {
          type: "json",
          value: {
            title: result.title ?? "Web Fetch",
            result: result.result ?? "success",
            completeness: result.completeness ?? "complete",
            url: result.metadata.url,
            finalUrl: result.metadata.finalUrl,
            status: result.metadata.status,
            statusText: result.metadata.statusText,
            ok: result.metadata.ok,
            contentType: result.metadata.contentType,
            contentFormat: result.metadata.contentFormat,
            titleText: result.metadata.title,
            description: result.metadata.description,
            siteName: result.metadata.siteName,
            publishedAt: result.metadata.publishedAt,
            language: result.metadata.language,
            content: result.metadata.content,
            contentTruncated: result.metadata.contentTruncated,
            bodyBytes: result.metadata.bodyBytes,
            redirects: result.metadata.redirects,
            links: result.metadata.links,
          },
        }
      },
    }
  },
  {
    title: "Web Fetch",
    aliases: ["web-fetch"],
    capabilities: {
      kind: "read",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    },
  },
)
