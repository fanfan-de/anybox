import type {
  BrowserExtensionCommandContext,
  BrowserExtensionCommandMethod,
} from "@anybox/chrome-shared/browser-extension"
import {
  BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS,
  BROWSER_CONTRACT_VERSION,
  BrowserContractCommandMethod,
  BrowserContractValidationError,
  parseBrowserCommandParams,
  parseBrowserCommandResult,
  type BrowserContractCommandMethod as BrowserContractCommandMethodValue,
} from "@anybox/chrome-shared/browser-contract"
import {
  commandAbortedError,
  detachAllDebuggers,
  detachTabDebugger,
  sendCdp,
  throwIfCommandAborted,
  waitForCommandDelay,
} from "./cdp-session"
import {
  createLease,
  finalizeAllLeases,
  finalizeExpiredLeases,
  finalizeSessionLeases,
  finalizeTurnLeases,
  listLeases,
  markDeliverable,
  releaseLease,
  requireLease,
} from "./lease-store"
import {
  executePlaywrightCommand,
  releasePlaywrightTab,
} from "./playwright-executor"

export { detachAllDebuggers, detachTabDebugger } from "./cdp-session"

type TabSummary = {
  id: number
  windowId?: number
  title?: string
  url?: string
  active?: boolean
  lease?: {
    source: "user" | "agent"
    sessionID: string
    turnID: string
    state: "active" | "deliverable" | "handoff" | "released"
    retained?: boolean
    extensionInstanceID: string
    expiresAt: number
  }
}

type InteractiveElement = {
  elementId: string
  role?: string
  tag: string
  name?: string
  text?: string
  href?: string
  type?: string
  placeholder?: string
  value?: string
  disabled: boolean
  visible: boolean
  sensitive?: boolean
  rect: {
    x: number
    y: number
    width: number
    height: number
  }
}

type DomTreeRelation = "child" | "shadowRoot" | "contentDocument" | "templateContent" | "pseudoElement"

type DomTreeNode = {
  relation?: DomTreeRelation
  nodeId?: number
  backendNodeId?: number
  nodeType: number
  nodeName: string
  localName?: string
  nodeValue?: string
  attributes?: Record<string, string>
  children?: DomTreeNode[]
}

type AccessibilityTreeNode = {
  nodeId: string
  parentId?: string
  backendDOMNodeId?: number
  ignored: boolean
  ignoredReasons?: string[]
  role?: string
  name?: string
  value?: unknown
  description?: string
  properties?: Record<string, unknown>
  childIds?: string[]
}

type DomSensitivityMetadata = {
  sensitive: boolean
  privateValue: boolean
  metadata: string
}

const SENSITIVE_VALUE_PATTERN =
  /(?:^|-)(?:password|passcode|passwd|secret|token|api-key|authorization|cookie|session|csrf|credit|debit|card|cardholder|card-holder|cardnumber|card-number|cvv|cvc|ssn|otp|otpcode|otp-code|2fa|onetime|one-time|onetimecode|one-time-code|cc-number|cc-csc|cc-cvc|cc-exp|verificationcode|verification-code|securitycode|security-code|pin)(?:$|-)|验证码|密码|口令|令牌|银行卡|卡号|安全码|一次性/i
const MAX_NODE_TEXT_CHARS = 500
const REDACTED_VALUE = "[redacted]"
const REDACTED_URL = "[redacted-url]"
const REDACTED_PATH = "[redacted-path]"
const URL_ATTRIBUTE_NAMES = new Set([
  "action",
  "archive",
  "background",
  "cite",
  "classid",
  "codebase",
  "data",
  "formaction",
  "href",
  "icon",
  "longdesc",
  "manifest",
  "ping",
  "poster",
  "profile",
  "src",
  "srcset",
  "style",
  "usemap",
  "url",
  "xlink:href",
])

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function readNumber(value: unknown, fallback?: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function readBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function readStringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function readClampedInteger(value: unknown, fallback: number, min: number, max: number) {
  const numeric = readNumber(value, fallback) ?? fallback
  return Math.min(max, Math.max(min, Math.trunc(numeric)))
}

function truncateText(value: unknown, limit = MAX_NODE_TEXT_CHARS) {
  if (typeof value !== "string") return undefined
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (!trimmed) return undefined
  return trimmed.length > limit ? `${trimmed.slice(0, limit).trimEnd()}...` : trimmed
}

function compactJsonValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value === "string") return truncateText(value) ?? ""
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.slice(0, 20).map(compactJsonValue).filter((item) => item !== undefined)
  if (typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
      const compact = compactJsonValue(child)
      if (compact !== undefined) output[key] = compact
    }
    return output
  }
  return String(value)
}

function normalizeSensitiveMetadata(value: unknown) {
  if (value === undefined || value === null) return ""
  return String(value)
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-z0-9\u3400-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
}

function hasSensitiveMetadata(...values: unknown[]) {
  return SENSITIVE_VALUE_PATTERN.test(
    values.map(normalizeSensitiveMetadata).filter(Boolean).join("-"),
  )
}

function comparablePrivateText(value: unknown) {
  if (value === undefined || value === null) return ""
  return String(value)
    .replace(/[^a-z0-9\u3400-\u9fff]+/gi, "")
    .toLowerCase()
}

function containsPrivateText(value: unknown, privateValues: string[]) {
  const candidate = comparablePrivateText(value)
  return candidate.length > 0 && privateValues.some((privateValue) => {
    const comparablePrivateValue = comparablePrivateText(privateValue)
    return comparablePrivateValue.length > 0 && candidate.includes(comparablePrivateValue)
  })
}

function redactBrowserUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined
  try {
    const url = new URL(value)
    if (url.protocol === "file:") return REDACTED_URL
    const suffix = `${url.search ? `?${REDACTED_VALUE}` : ""}${url.hash ? `#${REDACTED_VALUE}` : ""}`
    if (url.protocol === "http:" || url.protocol === "https:") {
      return `${url.origin}${url.pathname === "/" ? "/" : `/${REDACTED_PATH}`}${suffix}`
    }
    if (url.protocol === "chrome:" || url.protocol === "chrome-extension:") {
      return `${url.protocol}//${url.host}${url.pathname === "/" ? "/" : `/${REDACTED_PATH}`}${suffix}`
    }
    if (url.protocol === "about:" && value === "about:blank") return value
    return REDACTED_URL
  } catch {
    return REDACTED_URL
  }
}

function toTabSummary(tab: any): TabSummary {
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title,
    url: redactBrowserUrl(tab.url),
    active: tab.active,
  }
}

async function activeTabId(rawTabId: unknown) {
  const tabId = readNumber(rawTabId)
  if (Number.isInteger(tabId) && tabId! > 0) return tabId!

  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const active = activeTabs.find((tab: any) => typeof tab.id === "number")
  if (active?.id) return active.id as number

  const fallbackTabs = await chrome.tabs.query({})
  const fallback = fallbackTabs.find((tab: any) => typeof tab.id === "number")
  if (fallback?.id) return fallback.id as number

  throw new Error("No Chrome tab is available.")
}

async function tabInfo(tabId: number) {
  const tab = await chrome.tabs.get(tabId)
  return toTabSummary(tab)
}

async function runInPage<T>(
  tabId: number,
  func: (...args: any[]) => T,
  args: unknown[] = [],
  signal?: AbortSignal,
) {
  throwIfCommandAborted(signal)
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  })
  throwIfCommandAborted(signal)
  return result?.result as T
}

async function showBrowserOverlay(tabId: number, action?: string) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    })
    await chrome.tabs.sendMessage(tabId, {
      type: "ANYBOX_BROWSER_BRIDGE_ACTIVE",
      action,
    })
  } catch {
    // Restricted pages can reject injection. The advisory overlay must not
    // turn a completed browser command into a failure.
  }
}

async function removeBrowserOverlay(tabId: number) {
  await chrome.tabs.sendMessage(tabId, {
    type: "ANYBOX_BROWSER_BRIDGE_REMOVE",
  }).catch(() => undefined)
}

async function listTabs(
  context?: BrowserExtensionCommandContext,
  mode: "all" | "owned" | "user" = "all",
) {
  const [tabs, selectedTabs] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ])
  const selectedTabId = selectedTabs.find(
    (tab: any) => typeof tab.id === "number",
  )?.id
  const leases = mode === "all" ? [] : await listLeases()
  const leasesByTab = new Map(leases.map((lease) => [lease.tabId, lease]))
  let summaries: TabSummary[] = tabs
    .filter((tab: any) => typeof tab.id === "number")
    .map((tab: any) => {
      const summary = toTabSummary(tab)
      const lease = leasesByTab.get(summary.id)
      return lease
        ? {
            ...summary,
            lease: {
              source: lease.source,
              sessionID: lease.sessionID,
              turnID: lease.turnID,
              state: lease.state,
              retained: lease.retained,
              extensionInstanceID: lease.extensionInstanceID,
              expiresAt: lease.expiresAt,
            },
          }
        : summary
    })
  if (mode === "owned") {
    summaries = summaries.filter((tab) =>
      tab.lease?.sessionID === context?.sessionID
      && tab.lease?.extensionInstanceID === context?.extensionInstanceID
      && tab.lease?.state !== "released"
    )
  } else if (mode === "user") {
    summaries = summaries.filter((tab) =>
      !tab.lease
      || tab.lease.source === "user"
      || (tab.lease.state === "released" && tab.lease.retained === true)
    )
  }
  if (typeof selectedTabId === "number") {
    summaries.sort((left: TabSummary, right: TabSummary) =>
      Number(right.id === selectedTabId) - Number(left.id === selectedTabId)
    )
  }
  return {
    tabs: summaries,
  }
}

async function openTab(
  params: unknown,
  context?: BrowserExtensionCommandContext,
  signal?: AbortSignal,
) {
  const input = readRecord(params)
  const url = readString(input.url)
  if (!url) throw new Error("tabs.open requires a URL.")
  throwIfCommandAborted(signal)
  const tab = await chrome.tabs.create({ url, active: input.active !== false })
  try {
    throwIfCommandAborted(signal)
    if (typeof tab.id === "number" && context?.extensionInstanceID) {
      await createLease({
        tabId: tab.id,
        source: "agent",
        context,
        extensionInstanceID: context.extensionInstanceID,
        openerTabId: typeof tab.openerTabId === "number" ? tab.openerTabId : undefined,
      })
    }
  } catch (error) {
    if (signal?.aborted && typeof tab.id === "number") {
      await chrome.tabs.remove(tab.id).catch(() => undefined)
    }
    throw error
  }
  return toTabSummary(tab)
}

async function claimTab(
  params: unknown,
  context?: BrowserExtensionCommandContext,
  signal?: AbortSignal,
) {
  const tabId = readNumber(readRecord(params).tabId)
  if (!tabId || !context?.extensionInstanceID) {
    throw Object.assign(
      new Error("tabs.claim requires a tab and Browser Contract v3 context."),
      { code: "SESSION_REQUIRED", retryable: false },
    )
  }
  throwIfCommandAborted(signal)
  const tab = await chrome.tabs.get(tabId)
  throwIfCommandAborted(signal)
  await createLease({
    tabId,
    source: "user",
    context,
    extensionInstanceID: context.extensionInstanceID,
    openerTabId: typeof tab.openerTabId === "number" ? tab.openerTabId : undefined,
  })
  return toTabSummary(tab)
}

async function activateTab(params: unknown, signal?: AbortSignal) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  throwIfCommandAborted(signal)
  const tab = await chrome.tabs.update(tabId, { active: true })
  if (typeof tab.windowId === "number") {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined)
  }
  return toTabSummary(tab)
}

async function gotoTab(params: unknown, signal?: AbortSignal) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const url = readString(input.url)
  if (!url) throw new Error("tabs.goto requires a URL.")
  throwIfCommandAborted(signal)
  const tab = await chrome.tabs.update(tabId, { url })
  throwIfCommandAborted(signal)
  return toTabSummary(tab)
}

async function backTab(params: unknown, signal?: AbortSignal) {
  const tabId = await activeTabId(readRecord(params).tabId)
  throwIfCommandAborted(signal)
  await chrome.tabs.goBack(tabId)
  throwIfCommandAborted(signal)
  return tabInfo(tabId)
}

async function forwardTab(params: unknown, signal?: AbortSignal) {
  const tabId = await activeTabId(readRecord(params).tabId)
  throwIfCommandAborted(signal)
  await chrome.tabs.goForward(tabId)
  throwIfCommandAborted(signal)
  return tabInfo(tabId)
}

async function reloadTab(params: unknown, signal?: AbortSignal) {
  const tabId = await activeTabId(readRecord(params).tabId)
  throwIfCommandAborted(signal)
  await chrome.tabs.reload(tabId)
  throwIfCommandAborted(signal)
  return tabInfo(tabId)
}

async function closeTab(
  params: unknown,
  context?: BrowserExtensionCommandContext,
  signal?: AbortSignal,
) {
  const tabId = readNumber(readRecord(params).tabId)
  if (!tabId) throw new Error("tabs.close requires a tabId.")
  throwIfCommandAborted(signal)
  await removeBrowserOverlay(tabId)
  releasePlaywrightTab(tabId)
  await detachTabDebugger(tabId)
  throwIfCommandAborted(signal)
  await chrome.tabs.remove(tabId)
  await releaseLease(tabId, context).catch(() => undefined)
  throwIfCommandAborted(signal)
  return { tabId, closed: true }
}

async function snapshot(params: unknown, signal?: AbortSignal) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const maxTextChars = Math.min(readNumber(input.maxTextChars, 20_000) ?? 20_000, 100_000)
  const tab = await tabInfo(tabId)
  const data = await runInPage(tabId, (limit: number, sensitivePatternSource: string) => {
    const trim = (value: unknown) => {
      if (value === undefined || value === null) return ""
      return String(value).replace(/\s+/g, " ").trim()
    }
    const sensitivePattern = new RegExp(sensitivePatternSource, "i")
    const normalizeMetadata = (value: unknown) => {
      if (value === undefined || value === null) return ""
      return String(value)
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/[^a-z0-9\u3400-\u9fff]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase()
    }
    const labelledByText = (element: Element) => {
      const id = element.getAttribute("aria-labelledby")
      if (!id) return ""
      return id
        .split(/\s+/)
        .map((part) => document.getElementById(part)?.textContent ?? "")
        .join(" ")
    }
    const sensitiveFor = (element: Element) => {
      const field = element as HTMLInputElement
      const type = (field.type || "").toLowerCase()
      const haystack = [
        type,
        field.name,
        field.id,
        field.autocomplete,
        field.placeholder,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        labelledByText(element),
        ...Array.from(field.labels ?? []).map((label) => label.textContent ?? ""),
      ].map(normalizeMetadata).filter(Boolean).join("-")
      return type === "password" || type === "hidden" || sensitivePattern.test(haystack)
    }
    const snapshotFields = Array.from(document.querySelectorAll(
      "input, textarea, select, [contenteditable]:not([contenteditable='false' i]), [role='textbox']",
    ))
    const privateValuesFor = (field: Element) => {
      const input = field as HTMLInputElement
      return [input.value, (field as HTMLElement).innerText, field.textContent]
        .map(trim)
        .filter((value) => value.length > 0)
    }
    const safeMetadata = (value: unknown, privateValues: string[]) => {
      const candidate = trim(value)
      if (!candidate) return undefined
      const comparable = (text: string) => text
        .replace(/[^a-z0-9\u3400-\u9fff]+/gi, "")
        .toLowerCase()
      const candidateComparable = comparable(candidate)
      return privateValues.some((privateValue) => {
        const privateComparable = comparable(privateValue)
        return privateComparable.length > 0 && candidateComparable.includes(privateComparable)
      })
        ? undefined
        : candidate
    }
    const sensitiveText = snapshotFields
      .flatMap(privateValuesFor)
      .sort((left, right) => right.length - left.length)
    let text = trim(document.body?.innerText ?? "")
    for (const value of sensitiveText) {
      text = text.split(value).join("[redacted]")
    }
    const limitedText = text.length > limit ? `${text.slice(0, limit).trimEnd()}\n\n[truncated]` : text
    const links = Array.from(document.querySelectorAll("a[href]"))
      .slice(0, 80)
      .map((link) => ({
        text: trim(link.textContent),
        href: (link as HTMLAnchorElement).href,
      }))
      .filter((link) => link.href)
    const buttons = Array.from(document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']"))
      .slice(0, 80)
      .map((button) => ({ text: trim((button as HTMLInputElement).value || button.textContent) }))
      .filter((button) => button.text)
    const inputs = snapshotFields
      .slice(0, 80)
      .map((field) => {
        const input = field as HTMLInputElement
        const sensitive = sensitiveFor(field)
        if (sensitive) return { sensitive: true }
        const privateValues = privateValuesFor(field)
        return {
          name: safeMetadata(input.name, privateValues),
          type: safeMetadata(input.type || field.tagName.toLowerCase(), privateValues),
          placeholder: safeMetadata(input.placeholder, privateValues),
          value: undefined,
        }
      })
    return {
      text: limitedText,
      links,
      buttons,
      inputs,
      truncated: text.length > limit,
    }
  }, [maxTextChars, SENSITIVE_VALUE_PATTERN.source], signal)

  return {
    tabId,
    url: tab.url,
    title: tab.title,
    ...data,
    links: data.links.map((link) => ({
      ...link,
      href: redactBrowserUrl(link.href),
    })),
  }
}

async function interactiveSnapshot(params: unknown, signal?: AbortSignal) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const maxElements = Math.min(Math.max(readNumber(input.maxElements, 200) ?? 200, 1), 500)
  const tab = await tabInfo(tabId)
  const data = await runInPage(tabId, (limit: number, sensitivePatternSource: string) => {
    const ATTR = "data-anybox-element-id"
    const sensitivePattern = new RegExp(sensitivePatternSource, "i")
    const normalizeMetadata = (value: unknown) => {
      if (value === undefined || value === null) return ""
      return String(value)
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/[^a-z0-9\u3400-\u9fff]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase()
    }
    const selectors = [
      "a[href]",
      "button",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[contenteditable]:not([contenteditable='false' i])",
      "[tabindex]",
    ].join(",")
    const trim = (value: unknown) => {
      if (value === undefined || value === null) return ""
      return String(value).replace(/\s+/g, " ").trim()
    }
    const textFor = (element: Element) => trim(element.textContent).slice(0, 300)
    const labelledByText = (element: Element) => {
      const id = element.getAttribute("aria-labelledby")
      if (!id) return ""
      return id
        .split(/\s+/)
        .map((part) => document.getElementById(part)?.textContent ?? "")
        .join(" ")
    }
    const nameFor = (element: Element, includeTextContent: boolean) => {
      const input = element as HTMLInputElement
      const type = (input.type || "").toLowerCase()
      const buttonValue = ["button", "submit", "reset"].includes(type) ? input.value : ""
      return trim(
        element.getAttribute("aria-label") ||
          labelledByText(element) ||
          element.getAttribute("alt") ||
          element.getAttribute("title") ||
          input.placeholder ||
          buttonValue ||
          (includeTextContent ? element.textContent : ""),
      ).slice(0, 300)
    }
    const roleFor = (element: Element) => {
      const explicit = element.getAttribute("role")
      if (explicit) return explicit
      const tag = element.tagName.toLowerCase()
      if (tag === "a") return "link"
      if (tag === "button") return "button"
      if (tag === "textarea" || tag === "select") return tag
      if (tag === "input") {
        const type = ((element as HTMLInputElement).type || "text").toLowerCase()
        if (type === "button" || type === "submit" || type === "reset") return "button"
        if (type === "checkbox") return "checkbox"
        if (type === "radio") return "radio"
        return "textbox"
      }
      return undefined
    }
    const sensitiveFor = (element: Element) => {
      const input = element as HTMLInputElement
      const type = (input.type || "").toLowerCase()
      const haystack = [
        type,
        input.name,
        input.id,
        input.autocomplete,
        input.placeholder,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("alt"),
        labelledByText(element),
      ].map(normalizeMetadata).filter(Boolean).join("-")
      return type === "password" || type === "hidden" || sensitivePattern.test(haystack)
    }
    const hasPrivateValue = (element: Element) => {
      const tag = element.tagName.toLowerCase()
      const inputType = ((element as HTMLInputElement).type || "").toLowerCase()
      if (tag === "input") return !["button", "submit", "reset"].includes(inputType)
      if (tag === "textarea" || tag === "select") return true
      if ((element.getAttribute("role") ?? "").toLowerCase() === "textbox") return true
      const contenteditable = (element.getAttribute("contenteditable") ?? "").toLowerCase()
      const hasContenteditableAttribute = element.getAttribute("contenteditable") !== null
      return (element as HTMLElement).isContentEditable === true ||
        hasContenteditableAttribute && contenteditable === "" ||
        contenteditable === "true" ||
        contenteditable === "plaintext-only"
    }
    const privateValuesFor = (element: Element) => {
      const input = element as HTMLInputElement
      return [input.value, (element as HTMLElement).innerText, element.textContent]
        .map(trim)
        .filter((value) => value.length > 0)
    }
    const safeMetadata = (value: unknown, privateValues: string[]) => {
      const candidate = trim(value)
      if (!candidate) return undefined
      const comparable = (text: string) => text
        .replace(/[^a-z0-9\u3400-\u9fff]+/gi, "")
        .toLowerCase()
      const candidateComparable = comparable(candidate)
      return privateValues.some((privateValue) => {
        const privateComparable = comparable(privateValue)
        return privateComparable.length > 0 && candidateComparable.includes(privateComparable)
      })
        ? undefined
        : candidate
    }
    const visibleFor = (element: Element, rect: DOMRect) => {
      const style = window.getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
    }
    const disabledFor = (element: Element) => {
      const input = element as HTMLInputElement
      return Boolean(input.disabled || element.getAttribute("aria-disabled") === "true")
    }
    const ensureElementId = (element: Element, index: number) => {
      const existing = element.getAttribute(ATTR)
      if (existing) return existing
      const created = `anybox-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`
      element.setAttribute(ATTR, created)
      return created
    }

    const nodes = Array.from(document.querySelectorAll(selectors))
    const elements: InteractiveElement[] = []
    for (let index = 0; index < nodes.length && elements.length < limit; index += 1) {
      const element = nodes[index]!
      const rect = element.getBoundingClientRect()
      const visible = visibleFor(element, rect)
      if (!visible) continue
      const tag = element.tagName.toLowerCase()
      const input = element as HTMLInputElement
      const sensitive = sensitiveFor(element)
      const privateValue = hasPrivateValue(element)
      const privateValues = privateValue ? privateValuesFor(element) : []
      const name = nameFor(element, !privateValue)
      elements.push({
        elementId: ensureElementId(element, index),
        role: roleFor(element),
        tag,
        name: sensitive ? undefined : safeMetadata(name, privateValues),
        text: sensitive || privateValue ? undefined : textFor(element) || undefined,
        href: tag === "a" ? (element as HTMLAnchorElement).href : undefined,
        type: input.type || undefined,
        placeholder: sensitive ? undefined : safeMetadata(input.placeholder, privateValues),
        value: privateValue || sensitive || typeof input.value !== "string"
          ? undefined
          : input.value.slice(0, 200),
        disabled: disabledFor(element),
        visible,
        sensitive: sensitive || undefined,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      })
    }

    return {
      elements,
      truncated: elements.length >= limit && nodes.length > elements.length,
    }
  }, [maxElements, SENSITIVE_VALUE_PATTERN.source], signal)

  return {
    tabId,
    url: tab.url,
    title: tab.title,
    ...data,
    elements: data.elements.map((element) => ({
      ...element,
      href: redactBrowserUrl(element.href),
    })),
  }
}

function readCdpAttribute(rawNode: any, name: string) {
  const attributes = Array.isArray(rawNode?.attributes) ? rawNode.attributes : []
  const expected = name.toLowerCase()
  for (let index = 0; index < attributes.length; index += 2) {
    if (typeof attributes[index] === "string" && attributes[index].toLowerCase() === expected) {
      return typeof attributes[index + 1] === "string" ? attributes[index + 1] : ""
    }
  }
  return undefined
}

function isPrivateDomValueNode(rawNode: any) {
  const tag = String(rawNode?.localName ?? rawNode?.nodeName ?? "").toLowerCase()
  const type = (readCdpAttribute(rawNode, "type") ?? "").toLowerCase()
  if (tag === "input") return !["button", "submit", "reset"].includes(type)
  if (tag === "textarea" || tag === "select") return true
  if ((readCdpAttribute(rawNode, "role") ?? "").toLowerCase() === "textbox") return true
  const contenteditable = (readCdpAttribute(rawNode, "contenteditable") ?? "").toLowerCase()
  return (contenteditable === "" && readCdpAttribute(rawNode, "contenteditable") !== undefined) ||
    contenteditable === "true" ||
    contenteditable === "plaintext-only"
}

function isValueBearingDomAttribute(attributeName: string) {
  return normalizeSensitiveMetadata(attributeName).includes("value")
}

function isUrlBearingDomAttribute(attributeName: string, value: string) {
  const normalizedName = attributeName.toLowerCase()
  if (URL_ATTRIBUTE_NAMES.has(normalizedName)) {
    return normalizedName !== "style" || /url\s*\(/i.test(value)
  }
  return normalizedName.endsWith("url") ||
    normalizedName.endsWith("uri") ||
    /(?:https?|file|data|blob):/i.test(value) ||
    /url\s*\(/i.test(value)
}

function privateDomValues(rawNode: any) {
  const values: string[] = []
  const attributes = Array.isArray(rawNode?.attributes) ? rawNode.attributes : []
  for (let index = 0; index < attributes.length; index += 2) {
    const name = typeof attributes[index] === "string" ? attributes[index] : ""
    const value = typeof attributes[index + 1] === "string" ? attributes[index + 1] : ""
    if (isValueBearingDomAttribute(name) && value) values.push(value)
  }
  const collectText = (node: any, remaining: number): number => {
    if (!node || typeof node !== "object" || remaining <= 0) return remaining
    const text = truncateText(node.nodeValue)
    if (text) values.push(text)
    remaining -= 1
    if (!Array.isArray(node.children)) return remaining
    for (const child of node.children) {
      remaining = collectText(child, remaining)
      if (remaining <= 0) break
    }
    return remaining
  }
  collectText(rawNode, 100)
  return [...new Set(values)].sort((left, right) => right.length - left.length)
}

function shouldRedactDomAttribute(
  rawNode: any,
  attributeName: string,
  nodeSensitive = false,
  privateValue = false,
) {
  if (nodeSensitive) return true
  if (hasSensitiveMetadata(attributeName)) return true
  if (privateValue && isValueBearingDomAttribute(attributeName)) return true
  if (attributeName.toLowerCase() !== "value") return false
  const type = (readCdpAttribute(rawNode, "type") ?? "").toLowerCase()
  if (type === "password" || type === "hidden") return true
  const metadata = [
    type,
    readCdpAttribute(rawNode, "name"),
    readCdpAttribute(rawNode, "id"),
    readCdpAttribute(rawNode, "autocomplete"),
    readCdpAttribute(rawNode, "placeholder"),
    readCdpAttribute(rawNode, "aria-label"),
  ]
  return hasSensitiveMetadata(...metadata)
}

function isSensitiveDomNode(rawNode: any) {
  const type = (readCdpAttribute(rawNode, "type") ?? "").toLowerCase()
  if (type === "password" || type === "hidden") return true
  const attributes = Array.isArray(rawNode?.attributes) ? rawNode.attributes : []
  return hasSensitiveMetadata(type, ...attributes)
}

function collectDomSensitivityMetadata(rawRoot: any, maxNodes: number) {
  const output = new Map<number, DomSensitivityMetadata>()
  let visited = 0
  const visit = (
    rawNode: any,
    inheritedSensitive = false,
    inheritedPrivateValue = false,
  ) => {
    if (!rawNode || typeof rawNode !== "object" || visited >= maxNodes) return
    visited += 1
    const sensitive = inheritedSensitive || isSensitiveDomNode(rawNode)
    const privateValue = inheritedPrivateValue || isPrivateDomValueNode(rawNode)
    const metadata = [
      readCdpAttribute(rawNode, "type"),
      readCdpAttribute(rawNode, "name"),
      readCdpAttribute(rawNode, "id"),
      readCdpAttribute(rawNode, "autocomplete"),
      readCdpAttribute(rawNode, "placeholder"),
      readCdpAttribute(rawNode, "aria-label"),
      readCdpAttribute(rawNode, "role"),
    ].join(" ")
    if (typeof rawNode.backendNodeId === "number") {
      output.set(rawNode.backendNodeId, { sensitive, privateValue, metadata })
    }
    const children = [
      ...(Array.isArray(rawNode.children) ? rawNode.children : []),
      ...(Array.isArray(rawNode.shadowRoots) ? rawNode.shadowRoots : []),
      ...(Array.isArray(rawNode.pseudoElements) ? rawNode.pseudoElements : []),
      rawNode.contentDocument,
      rawNode.templateContent,
    ]
    for (const child of children) visit(child, sensitive, privateValue)
  }
  visit(rawRoot)
  return output
}

function normalizeDomAttributes(
  rawNode: any,
  nodeSensitive = false,
  privateValue = false,
) {
  const attributes = Array.isArray(rawNode?.attributes) ? rawNode.attributes : []
  const output: Record<string, string> = {}
  const privateValues = privateValue ? privateDomValues(rawNode) : []
  for (let index = 0; index < attributes.length; index += 2) {
    const name = typeof attributes[index] === "string" ? attributes[index] : undefined
    if (!name) continue
    const value = typeof attributes[index + 1] === "string" ? attributes[index + 1] : ""
    if (
      shouldRedactDomAttribute(rawNode, name, nodeSensitive, privateValue) ||
      containsPrivateText(value, privateValues)
    ) {
      output[name] = REDACTED_VALUE
    } else if (isUrlBearingDomAttribute(name, value)) {
      output[name] = redactBrowserUrl(value) ?? REDACTED_URL
    } else {
      output[name] = truncateText(value) ?? ""
    }
  }
  return Object.keys(output).length > 0 ? output : undefined
}

function appendDomChildren(
  target: DomTreeNode,
  rawChildren: unknown,
  relation: DomTreeRelation,
  visit: (rawNode: any, relation: DomTreeRelation) => DomTreeNode | undefined,
) {
  if (!Array.isArray(rawChildren)) return
  for (const child of rawChildren) {
    const normalized = visit(child, relation)
    if (!normalized) continue
    if (!target.children) target.children = []
    target.children.push(normalized)
  }
}

async function domTree(params: unknown, signal?: AbortSignal) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const maxDepth = readClampedInteger(input.maxDepth, 6, 0, 20)
  const maxNodes = readClampedInteger(input.maxNodes, 1_000, 1, 5_000)
  const pierce = readBoolean(input.pierce, true)
  const includeText = readBoolean(input.includeText, true)
  const includeAttributes = readBoolean(input.includeAttributes, true)
  const tab = await tabInfo(tabId)

  await sendCdp(tabId, "DOM.enable", {}, signal)
  const documentTree = await sendCdp(tabId, "DOM.getDocument", {
    depth: maxDepth,
    pierce,
  }, signal) as { root?: any }
  if (!documentTree.root) throw new Error("Chrome did not return a DOM document root.")

  let nodeCount = 0
  let truncated = false

  const visit = (
    rawNode: any,
    relation: DomTreeRelation = "child",
    inheritedSensitive = false,
    inheritedPrivateValue = false,
  ): DomTreeNode | undefined => {
    if (!rawNode || typeof rawNode !== "object") return undefined
    if (!includeText && rawNode.nodeType === 3) return undefined
    if (nodeCount >= maxNodes) {
      truncated = true
      return undefined
    }

    nodeCount += 1
    const sensitive = inheritedSensitive || isSensitiveDomNode(rawNode)
    const privateValue = inheritedPrivateValue || isPrivateDomValueNode(rawNode)
    const normalized: DomTreeNode = {
      ...(relation !== "child" ? { relation } : {}),
      ...(typeof rawNode.nodeId === "number" ? { nodeId: rawNode.nodeId } : {}),
      ...(typeof rawNode.backendNodeId === "number" ? { backendNodeId: rawNode.backendNodeId } : {}),
      nodeType: Number.isInteger(rawNode.nodeType) ? rawNode.nodeType : 0,
      nodeName: typeof rawNode.nodeName === "string" ? rawNode.nodeName : "",
      ...(typeof rawNode.localName === "string" && rawNode.localName ? { localName: rawNode.localName } : {}),
    }
    const nodeValue = truncateText(rawNode.nodeValue)
    if (nodeValue) normalized.nodeValue = sensitive || privateValue ? REDACTED_VALUE : nodeValue
    if (includeAttributes) {
      const attributes = normalizeDomAttributes(rawNode, sensitive, privateValue)
      if (attributes) normalized.attributes = attributes
    }

    const visitChild = (child: any, childRelation: DomTreeRelation) =>
      visit(child, childRelation, sensitive, privateValue)
    appendDomChildren(normalized, rawNode.children, "child", visitChild)
    appendDomChildren(normalized, rawNode.shadowRoots, "shadowRoot", visitChild)
    appendDomChildren(normalized, rawNode.pseudoElements, "pseudoElement", visitChild)
    const contentDocument = visit(rawNode.contentDocument, "contentDocument", sensitive, privateValue)
    if (contentDocument) {
      if (!normalized.children) normalized.children = []
      normalized.children.push(contentDocument)
    }
    const templateContent = visit(rawNode.templateContent, "templateContent", sensitive, privateValue)
    if (templateContent) {
      if (!normalized.children) normalized.children = []
      normalized.children.push(templateContent)
    }

    return normalized
  }

  const root = visit(documentTree.root)
  if (!root) throw new Error("Chrome DOM document root could not be normalized.")

  return {
    tabId,
    url: tab.url,
    title: tab.title,
    root,
    nodeCount,
    maxDepth,
    maxNodes,
    truncated,
  }
}

function axValue(rawValue: any): unknown {
  if (!rawValue || typeof rawValue !== "object") return undefined
  if ("value" in rawValue) return compactJsonValue(rawValue.value)
  if (typeof rawValue.type === "string") return rawValue.type
  return undefined
}

function axValueText(rawValue: any) {
  const value = axValue(rawValue)
  return typeof value === "string" ? value : undefined
}

function axIgnoredReasons(rawNode: any) {
  if (!Array.isArray(rawNode?.ignoredReasons)) return undefined
  const reasons = rawNode.ignoredReasons
    .map((reason: any) => typeof reason?.name === "string" ? reason.name : axValueText(reason?.value))
    .filter((reason: unknown): reason is string => typeof reason === "string" && reason.length > 0)
  return reasons.length > 0 ? reasons : undefined
}

function axProperties(rawNode: any) {
  if (!Array.isArray(rawNode?.properties)) return undefined
  const properties: Record<string, unknown> = {}
  for (const property of rawNode.properties) {
    if (!property || typeof property.name !== "string") continue
    const value = axValue(property.value)
    if (value === undefined) continue
    properties[property.name] = URL_ATTRIBUTE_NAMES.has(property.name.toLowerCase())
      ? redactBrowserUrl(value) ?? REDACTED_URL
      : value
  }
  return Object.keys(properties).length > 0 ? properties : undefined
}

function shouldRedactAccessibilityValue(
  node: AccessibilityTreeNode,
  domMetadata?: DomSensitivityMetadata,
) {
  const haystack = [
    node.role,
    node.name,
    node.value === undefined ? "" : String(node.value),
    node.description,
    node.properties ? Object.entries(node.properties).map(([key, value]) => `${key} ${String(value)}`).join(" ") : "",
    domMetadata?.metadata,
  ].join(" ")
  return domMetadata?.sensitive === true || hasSensitiveMetadata(haystack)
}

function hasEditableAccessibilityValue(node: AccessibilityTreeNode) {
  const role = (node.role ?? "").toLowerCase()
  if (["textbox", "searchbox", "combobox", "spinbutton"].includes(role)) return true
  if (!node.properties) return false
  return Object.entries(node.properties).some(([key, value]) =>
    key.toLowerCase() === "editable" && value !== false && value !== "false",
  )
}

function redactAccessibilityNode(node: AccessibilityTreeNode) {
  if (node.ignoredReasons) node.ignoredReasons = node.ignoredReasons.map(() => REDACTED_VALUE)
  if (node.name !== undefined) node.name = REDACTED_VALUE
  if (node.value !== undefined) node.value = REDACTED_VALUE
  if (node.description !== undefined) node.description = REDACTED_VALUE
  if (node.properties) {
    node.properties = Object.fromEntries(
      Object.keys(node.properties).map((key) => [key, REDACTED_VALUE]),
    )
  }
}

async function accessibilityTree(params: unknown, signal?: AbortSignal) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const maxDepth = readClampedInteger(input.maxDepth, 8, 0, 30)
  const maxNodes = readClampedInteger(input.maxNodes, 1_000, 1, 5_000)
  const includeIgnored = readBoolean(input.includeIgnored, false)
  const tab = await tabInfo(tabId)

  await sendCdp(tabId, "Accessibility.enable", {}, signal)
  const rawTree = await sendCdp(tabId, "Accessibility.getFullAXTree", {
    depth: maxDepth,
  }, signal) as { nodes?: any[] }
  const rawNodes = Array.isArray(rawTree.nodes) ? rawTree.nodes : []
  let domMetadataByBackendId = new Map<number, DomSensitivityMetadata>()
  try {
    await sendCdp(tabId, "DOM.enable", {}, signal)
    const documentTree = await sendCdp(tabId, "DOM.getDocument", {
      depth: maxDepth,
      pierce: true,
    }, signal) as { root?: any }
    domMetadataByBackendId = collectDomSensitivityMetadata(documentTree?.root, maxNodes * 5)
  } catch {
    // Some pages do not expose a DOM tree for every accessibility target. In that
    // case, editable AX values are still redacted by the role-based fallback.
  }
  const parentById = new Map<string, string>()
  for (const rawNode of rawNodes) {
    const nodeId = typeof rawNode?.nodeId === "string" ? rawNode.nodeId : undefined
    if (!nodeId || !Array.isArray(rawNode.childIds)) continue
    for (const childId of rawNode.childIds) {
      if (typeof childId === "string") parentById.set(childId, nodeId)
    }
  }

  const normalizedEntries = rawNodes.map((rawNode): {
    node: AccessibilityTreeNode
    rawNode: any
    domMetadata?: DomSensitivityMetadata
    sensitive: boolean
  } | undefined => {
    const nodeId = typeof rawNode?.nodeId === "string" ? rawNode.nodeId : undefined
    if (!nodeId) return undefined
    const node: AccessibilityTreeNode = {
      nodeId,
      ...(typeof rawNode.backendDOMNodeId === "number" ? { backendDOMNodeId: rawNode.backendDOMNodeId } : {}),
      ignored: rawNode.ignored === true,
      ...(axIgnoredReasons(rawNode) ? { ignoredReasons: axIgnoredReasons(rawNode) } : {}),
      ...(axValueText(rawNode.role) ? { role: axValueText(rawNode.role) } : {}),
      ...(axValueText(rawNode.name) ? { name: axValueText(rawNode.name) } : {}),
      ...(axValue(rawNode.value) !== undefined ? { value: axValue(rawNode.value) } : {}),
      ...(axValueText(rawNode.description) ? { description: axValueText(rawNode.description) } : {}),
      ...(axProperties(rawNode) ? { properties: axProperties(rawNode) } : {}),
    }
    const domMetadata = typeof rawNode.backendDOMNodeId === "number"
      ? domMetadataByBackendId.get(rawNode.backendDOMNodeId)
      : undefined
    return {
      node,
      rawNode,
      domMetadata,
      sensitive: shouldRedactAccessibilityValue(node, domMetadata),
    }
  }).filter((entry): entry is {
    node: AccessibilityTreeNode
    rawNode: any
    domMetadata?: DomSensitivityMetadata
    sensitive: boolean
  } => Boolean(entry))

  const privateNodeIds = new Set(
    normalizedEntries
      .filter(({ node, domMetadata, sensitive }) =>
        sensitive || domMetadata?.privateValue === true || hasEditableAccessibilityValue(node),
      )
      .map(({ node }) => node.nodeId),
  )
  const rawNodeById = new Map(
    normalizedEntries.map(({ node, rawNode }) => [node.nodeId, rawNode]),
  )
  const privacyQueue = [...privateNodeIds]
  while (privacyQueue.length > 0) {
    const nodeId = privacyQueue.shift()!
    const rawNode = rawNodeById.get(nodeId)
    if (!Array.isArray(rawNode?.childIds)) continue
    for (const childId of rawNode.childIds) {
      if (typeof childId !== "string" || privateNodeIds.has(childId)) continue
      privateNodeIds.add(childId)
      privacyQueue.push(childId)
    }
  }

  const normalized = normalizedEntries.map(({ node, sensitive }) => {
    if (sensitive || privateNodeIds.has(node.nodeId)) redactAccessibilityNode(node)
    return node
  })

  const filteredNodes = normalized.filter((node) => includeIgnored || !node.ignored)
  const keptNodes = filteredNodes.slice(0, maxNodes)
  const keptIds = new Set(keptNodes.map((node) => node.nodeId))
  const keptById = new Map(keptNodes.map((node) => [node.nodeId, node]))

  const nearestKeptParent = (nodeId: string) => {
    let parentId = parentById.get(nodeId)
    while (parentId && !keptIds.has(parentId)) parentId = parentById.get(parentId)
    return parentId
  }

  for (const node of keptNodes) {
    const parentId = nearestKeptParent(node.nodeId)
    if (!parentId) continue
    node.parentId = parentId
    const parent = keptById.get(parentId)
    if (parent) {
      if (!parent.childIds) parent.childIds = []
      parent.childIds.push(node.nodeId)
    }
  }

  return {
    tabId,
    url: tab.url,
    title: tab.title,
    rootNodeId: keptNodes.find((node) => !node.parentId)?.nodeId,
    nodes: keptNodes,
    nodeCount: keptNodes.length,
    maxDepth,
    maxNodes,
    includeIgnored,
    truncated: filteredNodes.length > keptNodes.length,
  }
}

async function screenshot(params: unknown, signal?: AbortSignal) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const fullPage = readBoolean(input.fullPage)
  const result = await sendCdp(tabId, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: fullPage,
  }, signal) as { data?: string }
  if (!result.data) throw new Error("Chrome did not return screenshot data.")
  return {
    tabId,
    mime: "image/png",
    data: result.data,
  }
}

async function click(params: unknown, signal?: AbortSignal) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const x = readNumber(input.x)
  const y = readNumber(input.y)
  if (x === undefined || y === undefined) throw new Error("page.click requires finite x and y.")
  const button = readString(input.button, "left")
  await sendCdp(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button,
    clickCount: 1,
  }, signal)
  await sendCdp(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button,
    clickCount: 1,
  }, signal)
  await showBrowserOverlay(tabId, "Clicking")
  return { tabId, x, y, button }
}

async function clickElement(params: unknown, signal?: AbortSignal) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const elementId = readString(input.elementId)
  if (!elementId) throw new Error("page.clickElement requires elementId.")
  const button = readString(input.button, "left")
  const target = await runInPage(tabId, (id: string) => {
    const ATTR = "data-anybox-element-id"
    const elements = Array.from(document.querySelectorAll(`[${ATTR}]`))
    const element = elements.find((node) => node.getAttribute(ATTR) === id) as HTMLElement | undefined
    if (!element) return { ok: false, error: `Element '${id}' was not found. Run browser_interactive_snapshot again.` }
    if ((element as HTMLInputElement).disabled || element.getAttribute("aria-disabled") === "true") {
      return { ok: false, error: `Element '${id}' is disabled.` }
    }
    element.scrollIntoView({ block: "center", inline: "center" })
    const rect = element.getBoundingClientRect()
    return {
      ok: true,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }
  }, [elementId], signal) as { ok: boolean; error?: string; x?: number; y?: number }

  if (!target.ok || target.x === undefined || target.y === undefined) {
    throw new Error(target.error || `Element '${elementId}' could not be clicked.`)
  }

  await sendCdp(tabId, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: target.x,
    y: target.y,
    button,
  }, signal)
  await sendCdp(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: target.x,
    y: target.y,
    button,
    clickCount: 1,
  }, signal)
  await sendCdp(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: target.x,
    y: target.y,
    button,
    clickCount: 1,
  }, signal)
  await showBrowserOverlay(tabId, "Clicking")
  const tab = await tabInfo(tabId)
  return { tabId, elementId, url: tab.url, title: tab.title }
}

async function fill(params: unknown, signal?: AbortSignal) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const elementId = readString(input.elementId)
  const text = readString(input.text)
  if (!elementId) throw new Error("page.fill requires elementId.")
  const result = await runInPage(tabId, (
    id: string,
    nextValue: string,
    sensitiveApproved: boolean,
    sensitivePatternSource: string,
  ) => {
    const ATTR = "data-anybox-element-id"
    const elements = Array.from(document.querySelectorAll(`[${ATTR}]`))
    const element = elements.find((node) => node.getAttribute(ATTR) === id) as HTMLElement | undefined
    if (!element) return { ok: false, error: `Element '${id}' was not found. Run browser_interactive_snapshot again.` }
    if ((element as HTMLInputElement).disabled || element.getAttribute("aria-disabled") === "true") {
      return { ok: false, error: `Element '${id}' is disabled.` }
    }
    const sensitivePattern = new RegExp(sensitivePatternSource, "i")
    const metadata = [
      element.getAttribute("type"),
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("autocomplete"),
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
    ].filter(Boolean).join("-")
    const sensitive = sensitivePattern.test(metadata)
      || element.getAttribute("type")?.toLowerCase() === "password"
    if (sensitive && !sensitiveApproved) {
      return {
        ok: false,
        sensitive: true,
        error: `Element '${id}' is sensitive; retry with sensitive: true to request one-time approval.`,
      }
    }

    element.scrollIntoView({ block: "center", inline: "center" })
    element.focus()
    const tag = element.tagName.toLowerCase()
    if (tag === "input" || tag === "textarea") {
      const field = element as HTMLInputElement | HTMLTextAreaElement
      const prototype = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
      setter?.call(field, nextValue)
      field.dispatchEvent(new Event("input", { bubbles: true }))
      field.dispatchEvent(new Event("change", { bubbles: true }))
      return { ok: true }
    }
    if (tag === "select") {
      const field = element as HTMLSelectElement
      field.value = nextValue
      field.dispatchEvent(new Event("input", { bubbles: true }))
      field.dispatchEvent(new Event("change", { bubbles: true }))
      return { ok: true }
    }
    if (element.isContentEditable) {
      element.textContent = nextValue
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: nextValue }))
      return { ok: true }
    }
    return { ok: false, error: `Element '${id}' is not fillable.` }
  }, [
    elementId,
    text,
    input.sensitive === true,
    SENSITIVE_VALUE_PATTERN.source,
  ], signal) as { ok: boolean; error?: string; sensitive?: boolean }

  if (!result.ok) {
    throw Object.assign(
      new Error(result.error || `Element '${elementId}' could not be filled.`),
      result.sensitive
        ? { code: "PERMISSION_DENIED", retryable: false }
        : {},
    )
  }
  await showBrowserOverlay(tabId, "Typing")
  const tab = await tabInfo(tabId)
  return { tabId, elementId, textLength: text.length, url: tab.url, title: tab.title }
}

async function typeText(params: unknown, signal?: AbortSignal) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const text = readString(input.text)
  if (!text) throw new Error("page.type requires text.")
  const focused = await runInPage(tabId, (sensitivePatternSource: string) => {
    const element = document.activeElement
    if (!element) return { sensitive: false }
    const sensitivePattern = new RegExp(sensitivePatternSource, "i")
    const metadata = [
      element.getAttribute("type"),
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("autocomplete"),
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
    ].filter(Boolean).join("-")
    return {
      sensitive: sensitivePattern.test(metadata)
        || element.getAttribute("type")?.toLowerCase() === "password",
    }
  }, [SENSITIVE_VALUE_PATTERN.source], signal)
  if (focused?.sensitive && input.sensitive !== true) {
    throw Object.assign(
      new Error(
        "The focused field is sensitive; retry with sensitive: true to request one-time approval.",
      ),
      { code: "PERMISSION_DENIED", retryable: false },
    )
  }
  await sendCdp(tabId, "Input.insertText", { text }, signal)
  await showBrowserOverlay(tabId, "Typing")
  return { tabId, textLength: text.length }
}

async function scroll(params: unknown, signal?: AbortSignal) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const scrollX = readNumber(input.scrollX, 0) ?? 0
  const scrollY = readNumber(input.scrollY, 0) ?? 0
  const position = await runInPage(tabId, (x: number, y: number) => {
    window.scrollBy(x, y)
    return { scrollX: window.scrollX, scrollY: window.scrollY }
  }, [scrollX, scrollY], signal)
  await showBrowserOverlay(tabId, "Scrolling")
  return { tabId, scrollX, scrollY, position }
}

async function waitFor(params: unknown, signal?: AbortSignal) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const timeoutMs = Math.min(Math.max(readNumber(input.timeoutMs, 10_000) ?? 10_000, 250), 60_000)
  const text = readStringOrUndefined(input.text)
  const urlIncludes = readStringOrUndefined(input.urlIncludes)
  const selector = readStringOrUndefined(input.selector)
  const elementId = readStringOrUndefined(input.elementId)
  if (!text && !urlIncludes && !selector && !elementId) {
    throw new Error("page.waitFor requires text, urlIncludes, selector, or elementId.")
  }

  const started = Date.now()
  let reason = "Timed out."
  while (Date.now() - started <= timeoutMs) {
    throwIfCommandAborted(signal)
    const rawTab = await chrome.tabs.get(tabId)
    if (urlIncludes && rawTab.url?.includes(urlIncludes)) {
      const tab = toTabSummary(rawTab)
      return { tabId, url: tab.url, title: tab.title, matched: true, reason: "URL condition matched." }
    }

    const matched = await runInPage(tabId, (query: {
      text?: string
      selector?: string
      elementId?: string
    }) => {
      if (query.text && document.body?.innerText.includes(query.text)) return `Text '${query.text}' appeared.`
      if (query.selector && document.querySelector(query.selector)) return `Selector '${query.selector}' appeared.`
      if (query.elementId) {
        const ATTR = "data-anybox-element-id"
        const elements = Array.from(document.querySelectorAll(`[${ATTR}]`))
        if (elements.some((element) => element.getAttribute(ATTR) === query.elementId)) {
          return `Element '${query.elementId}' appeared.`
        }
      }
      return ""
    }, [{ text, selector, elementId }], signal)

    if (matched) {
      const latest = await tabInfo(tabId)
      return { tabId, url: latest.url, title: latest.title, matched: true, reason: matched }
    }

    await waitForCommandDelay(250, signal)
  }

  const tab = await tabInfo(tabId)
  return { tabId, url: tab.url, title: tab.title, matched: false, reason }
}

async function releaseTab(
  params: unknown,
  context?: BrowserExtensionCommandContext,
) {
  const tabId = readNumber(readRecord(params).tabId)
  if (!tabId) throw new Error("tabs.release requires a tabId.")
  await releaseLease(tabId, context)
  await removeBrowserOverlay(tabId)
  releasePlaywrightTab(tabId)
  await detachTabDebugger(tabId)
  return { tabId, released: true }
}

async function markTabDeliverable(
  params: unknown,
  context?: BrowserExtensionCommandContext,
) {
  const tabId = readNumber(readRecord(params).tabId)
  if (!tabId) throw new Error("tabs.markDeliverable requires a tabId.")
  await markDeliverable(tabId, context)
  return { tabId, state: "deliverable" as const }
}

async function finalizeTabs(
  params: unknown,
  context?: BrowserExtensionCommandContext,
) {
  if (!context?.sessionID || !context.turnID) {
    throw Object.assign(
      new Error("tabs.finalize requires an active session."),
      { code: "SESSION_REQUIRED", retryable: false },
    )
  }
  const reason = readString(readRecord(params).reason, "manual")
  const result = reason === "turn-end"
    ? await finalizeTurnLeases(context.sessionID, context.turnID)
    : await finalizeSessionLeases(context.sessionID)
  return executeLeaseCleanup(result, context.sessionID)
}

async function executeLeaseCleanup(
  result: {
    closeTabIds: number[]
    releaseTabIds: number[]
    retainTabIds: number[]
  },
  sessionID = "all",
) {
  const allTabIds = [
    ...result.closeTabIds,
    ...result.releaseTabIds,
    ...result.retainTabIds,
  ]
  await Promise.all(allTabIds.map((tabId) => removeBrowserOverlay(tabId)))
  allTabIds.forEach((tabId) => releasePlaywrightTab(tabId))
  await Promise.all(allTabIds.map((tabId) => detachTabDebugger(tabId)))
  if (result.closeTabIds.length > 0) {
    await chrome.tabs.remove(result.closeTabIds).catch(() => undefined)
  }
  return {
    sessionID,
    closedTabIds: result.closeTabIds,
    releasedTabIds: result.releaseTabIds,
    retainedTabIds: result.retainTabIds,
    detachedTabIds: allTabIds,
  }
}

export async function finalizeExpiredTabLeases() {
  return executeLeaseCleanup(await finalizeExpiredLeases(), "expired")
}

export async function finalizeDisconnectedTabLeases() {
  return executeLeaseCleanup(await finalizeAllLeases(), "disconnected")
}

const LEASED_TAB_METHODS = new Set<BrowserContractCommandMethodValue>([
  "tabs.activate",
  "tabs.goto",
  "tabs.back",
  "tabs.forward",
  "tabs.reload",
  "tabs.close",
  "tabs.release",
  "tabs.markDeliverable",
  "page.snapshot",
  "page.interactiveSnapshot",
  "page.domTree",
  "page.accessibilityTree",
  "page.screenshot",
  "page.click",
  "page.clickElement",
  "page.fill",
  "page.type",
  "page.scroll",
  "page.waitFor",
  ...BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS,
])

async function enforceTabLease(
  method: BrowserContractCommandMethodValue,
  params: unknown,
  context?: BrowserExtensionCommandContext,
) {
  if (!LEASED_TAB_METHODS.has(method)) return
  const tabId = readNumber(readRecord(params).tabId)
  if (!tabId) {
    throw Object.assign(
      new Error(`Browser command '${method}' requires a leased tabId.`),
      { code: "TAB_CLAIM_REQUIRED", retryable: false },
    )
  }
  await requireLease(tabId, context)
}

async function handleContractCommand(
  method: BrowserContractCommandMethodValue,
  params: unknown,
  context?: BrowserExtensionCommandContext,
  signal?: AbortSignal,
) {
  throwIfCommandAborted(signal)
  await enforceTabLease(method, params, context)
  throwIfCommandAborted(signal)
  if (
    BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS.includes(method as never)
  ) {
    return await executePlaywrightCommand(
      method as (typeof BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS)[number],
      params,
      signal,
    )
  }
  switch (method) {
    case "tabs.list":
      return await listTabs(context, "owned")
    case "tabs.listUser":
      return await listTabs(context, "user")
    case "tabs.open":
      return await openTab(params, context, signal)
    case "tabs.claim":
      return await claimTab(params, context, signal)
    case "tabs.activate":
      return await activateTab(params, signal)
    case "tabs.goto":
      return await gotoTab(params, signal)
    case "tabs.back":
      return await backTab(params, signal)
    case "tabs.forward":
      return await forwardTab(params, signal)
    case "tabs.reload":
      return await reloadTab(params, signal)
    case "tabs.close":
      return await closeTab(params, context, signal)
    case "tabs.release":
      return await releaseTab(params, context)
    case "tabs.markDeliverable":
      return await markTabDeliverable(params, context)
    case "tabs.finalize":
      return await finalizeTabs(params, context)
    case "page.snapshot":
      return await snapshot(params, signal)
    case "page.interactiveSnapshot":
      return await interactiveSnapshot(params, signal)
    case "page.domTree":
      return await domTree(params, signal)
    case "page.accessibilityTree":
      return await accessibilityTree(params, signal)
    case "page.screenshot":
      return await screenshot(params, signal)
    case "page.click":
      return await click(params, signal)
    case "page.clickElement":
      return await clickElement(params, signal)
    case "page.fill":
      return await fill(params, signal)
    case "page.type":
      return await typeText(params, signal)
    case "page.scroll":
      return await scroll(params, signal)
    case "page.waitFor":
      return await waitFor(params, signal)
  }
}

export async function handleBrowserCommand(
  method: BrowserExtensionCommandMethod,
  params?: unknown,
  options: {
    context?: BrowserExtensionCommandContext
    signal?: AbortSignal
  } = {},
) {
  throwIfCommandAborted(options.signal)
  const contractMethod = BrowserContractCommandMethod.safeParse(method)
  if (contractMethod.success) {
    const parsedParams = parseBrowserCommandParams(
      contractMethod.data,
      params,
      BROWSER_CONTRACT_VERSION,
    )
    const result = await handleContractCommand(
      contractMethod.data,
      parsedParams,
      options.context,
      options.signal,
    )
    throwIfCommandAborted(options.signal)
    return parseBrowserCommandResult(
      contractMethod.data,
      result,
      BROWSER_CONTRACT_VERSION,
    )
  }

  switch (method) {
    case "page.executeScript":
    case "cdp.send":
      throw new BrowserContractValidationError(
        "COMMAND_NOT_SUPPORTED",
        `Browser extension command '${method}' is disabled: arbitrary page JavaScript and raw CDP are not extension capabilities.`,
      )
  }
}
