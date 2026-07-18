import type { BrowserExtensionCommandMethod } from "@anybox/shared/browser-extension"

const attachedTabs = new Set<number>()

type TabSummary = {
  id: number
  windowId?: number
  title?: string
  url?: string
  active?: boolean
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

const SENSITIVE_VALUE_PATTERN =
  /\b(password|passcode|passwd|secret|token|api[_-]?key|authorization|cookie|session|csrf|credit|card|cvv|cvc|ssn|otp|2fa)\b/i
const MAX_NODE_TEXT_CHARS = 500
const REDACTED_VALUE = "[redacted]"

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

function toTabSummary(tab: any): TabSummary {
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title,
    url: tab.url,
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

async function attachDebugger(tabId: number) {
  if (attachedTabs.has(tabId)) return
  try {
    await chrome.debugger.attach({ tabId }, "1.3")
    attachedTabs.add(tabId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("Another debugger") || message.includes("already attached")) {
      throw new Error(`Cannot control tab ${tabId}: ${message}`)
    }
    throw error
  }
}

async function sendCdp(tabId: number, method: string, commandParams?: Record<string, unknown>) {
  await attachDebugger(tabId)
  return await chrome.debugger.sendCommand({ tabId }, method, commandParams)
}

async function runInPage<T>(tabId: number, func: (...args: any[]) => T, args: unknown[] = []) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  })
  return result?.result as T
}

async function listTabs() {
  const tabs = await chrome.tabs.query({})
  return {
    tabs: tabs
      .filter((tab: any) => typeof tab.id === "number")
      .map(toTabSummary),
  }
}

async function openTab(params: unknown) {
  const input = readRecord(params)
  const url = readString(input.url)
  if (!url) throw new Error("tabs.open requires a URL.")
  const tab = await chrome.tabs.create({ url, active: input.active !== false })
  return toTabSummary(tab)
}

async function activateTab(params: unknown) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const tab = await chrome.tabs.update(tabId, { active: true })
  if (typeof tab.windowId === "number") {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined)
  }
  return toTabSummary(tab)
}

async function snapshot(params: unknown) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const maxTextChars = Math.min(readNumber(input.maxTextChars, 20_000) ?? 20_000, 100_000)
  const tab = await tabInfo(tabId)
  const data = await runInPage(tabId, (limit: number) => {
    const trim = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim()
    const text = trim(document.body?.innerText ?? "")
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
    const inputs = Array.from(document.querySelectorAll("input, textarea, select"))
      .slice(0, 80)
      .map((field) => {
        const input = field as HTMLInputElement
        return {
          name: input.name || undefined,
          type: input.type || field.tagName.toLowerCase(),
          placeholder: input.placeholder || undefined,
          value: typeof input.value === "string" ? input.value.slice(0, 200) : undefined,
        }
      })
    return {
      text: limitedText,
      links,
      buttons,
      inputs,
      truncated: text.length > limit,
    }
  }, [maxTextChars])

  return {
    tabId,
    url: tab.url,
    title: tab.title,
    ...data,
  }
}

async function interactiveSnapshot(params: unknown) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const maxElements = Math.min(Math.max(readNumber(input.maxElements, 200) ?? 200, 1), 500)
  const tab = await tabInfo(tabId)
  const data = await runInPage(tabId, (limit: number) => {
    const ATTR = "data-anybox-element-id"
    const selectors = [
      "a[href]",
      "button",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[contenteditable='true']",
      "[tabindex]",
    ].join(",")
    const trim = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim()
    const textFor = (element: Element) => trim(element.textContent).slice(0, 300)
    const labelledByText = (element: Element) => {
      const id = element.getAttribute("aria-labelledby")
      if (!id) return ""
      return id
        .split(/\s+/)
        .map((part) => document.getElementById(part)?.textContent ?? "")
        .join(" ")
    }
    const nameFor = (element: Element) => {
      const input = element as HTMLInputElement
      return trim(
        element.getAttribute("aria-label") ||
          labelledByText(element) ||
          element.getAttribute("alt") ||
          element.getAttribute("title") ||
          input.placeholder ||
          input.value ||
          element.textContent,
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
      const haystack = [
        input.type,
        input.name,
        input.id,
        input.autocomplete,
        input.placeholder,
        element.getAttribute("aria-label"),
      ].join(" ").toLowerCase()
      return /\b(password|passcode|secret|token|api[_-]?key|credit|card|cvv|cvc|ssn|otp|2fa)\b/.test(haystack)
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
      elements.push({
        elementId: ensureElementId(element, index),
        role: roleFor(element),
        tag,
        name: nameFor(element) || undefined,
        text: textFor(element) || undefined,
        href: tag === "a" ? (element as HTMLAnchorElement).href : undefined,
        type: input.type || undefined,
        placeholder: input.placeholder || undefined,
        value: typeof input.value === "string" && input.type !== "password" ? input.value.slice(0, 200) : undefined,
        disabled: disabledFor(element),
        visible,
        sensitive: sensitiveFor(element) || undefined,
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
  }, [maxElements])

  return {
    tabId,
    url: tab.url,
    title: tab.title,
    ...data,
  }
}

function readCdpAttribute(rawNode: any, name: string) {
  const attributes = Array.isArray(rawNode?.attributes) ? rawNode.attributes : []
  for (let index = 0; index < attributes.length; index += 2) {
    if (attributes[index] === name) return typeof attributes[index + 1] === "string" ? attributes[index + 1] : ""
  }
  return undefined
}

function shouldRedactDomAttribute(rawNode: any, attributeName: string) {
  if (SENSITIVE_VALUE_PATTERN.test(attributeName)) return true
  if (attributeName.toLowerCase() !== "value") return false
  return (readCdpAttribute(rawNode, "type") ?? "").toLowerCase() === "password"
}

function normalizeDomAttributes(rawNode: any) {
  const attributes = Array.isArray(rawNode?.attributes) ? rawNode.attributes : []
  const output: Record<string, string> = {}
  for (let index = 0; index < attributes.length; index += 2) {
    const name = typeof attributes[index] === "string" ? attributes[index] : undefined
    if (!name) continue
    const value = typeof attributes[index + 1] === "string" ? attributes[index + 1] : ""
    output[name] = shouldRedactDomAttribute(rawNode, name) ? REDACTED_VALUE : (truncateText(value) ?? "")
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

async function domTree(params: unknown) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const maxDepth = readClampedInteger(input.maxDepth, 6, 0, 20)
  const maxNodes = readClampedInteger(input.maxNodes, 1_000, 1, 5_000)
  const pierce = readBoolean(input.pierce, true)
  const includeText = readBoolean(input.includeText, true)
  const includeAttributes = readBoolean(input.includeAttributes, true)
  const tab = await tabInfo(tabId)

  await sendCdp(tabId, "DOM.enable", {})
  const documentTree = await sendCdp(tabId, "DOM.getDocument", {
    depth: maxDepth,
    pierce,
  }) as { root?: any }
  if (!documentTree.root) throw new Error("Chrome did not return a DOM document root.")

  let nodeCount = 0
  let truncated = false

  const visit = (rawNode: any, relation: DomTreeRelation = "child"): DomTreeNode | undefined => {
    if (!rawNode || typeof rawNode !== "object") return undefined
    if (!includeText && rawNode.nodeType === 3) return undefined
    if (nodeCount >= maxNodes) {
      truncated = true
      return undefined
    }

    nodeCount += 1
    const normalized: DomTreeNode = {
      ...(relation !== "child" ? { relation } : {}),
      ...(typeof rawNode.nodeId === "number" ? { nodeId: rawNode.nodeId } : {}),
      ...(typeof rawNode.backendNodeId === "number" ? { backendNodeId: rawNode.backendNodeId } : {}),
      nodeType: Number.isInteger(rawNode.nodeType) ? rawNode.nodeType : 0,
      nodeName: typeof rawNode.nodeName === "string" ? rawNode.nodeName : "",
      ...(typeof rawNode.localName === "string" && rawNode.localName ? { localName: rawNode.localName } : {}),
    }
    const nodeValue = truncateText(rawNode.nodeValue)
    if (nodeValue) normalized.nodeValue = nodeValue
    if (includeAttributes) {
      const attributes = normalizeDomAttributes(rawNode)
      if (attributes) normalized.attributes = attributes
    }

    appendDomChildren(normalized, rawNode.children, "child", visit)
    appendDomChildren(normalized, rawNode.shadowRoots, "shadowRoot", visit)
    appendDomChildren(normalized, rawNode.pseudoElements, "pseudoElement", visit)
    const contentDocument = visit(rawNode.contentDocument, "contentDocument")
    if (contentDocument) {
      if (!normalized.children) normalized.children = []
      normalized.children.push(contentDocument)
    }
    const templateContent = visit(rawNode.templateContent, "templateContent")
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
    if (value !== undefined) properties[property.name] = value
  }
  return Object.keys(properties).length > 0 ? properties : undefined
}

function shouldRedactAccessibilityValue(node: AccessibilityTreeNode) {
  const haystack = [
    node.role,
    node.name,
    node.description,
    node.properties ? Object.entries(node.properties).map(([key, value]) => `${key} ${String(value)}`).join(" ") : "",
  ].join(" ")
  return SENSITIVE_VALUE_PATTERN.test(haystack)
}

async function accessibilityTree(params: unknown) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const maxDepth = readClampedInteger(input.maxDepth, 8, 0, 30)
  const maxNodes = readClampedInteger(input.maxNodes, 1_000, 1, 5_000)
  const includeIgnored = readBoolean(input.includeIgnored, false)
  const tab = await tabInfo(tabId)

  await sendCdp(tabId, "Accessibility.enable", {})
  const rawTree = await sendCdp(tabId, "Accessibility.getFullAXTree", {
    depth: maxDepth,
  }) as { nodes?: any[] }
  const rawNodes = Array.isArray(rawTree.nodes) ? rawTree.nodes : []
  const parentById = new Map<string, string>()
  for (const rawNode of rawNodes) {
    const nodeId = typeof rawNode?.nodeId === "string" ? rawNode.nodeId : undefined
    if (!nodeId || !Array.isArray(rawNode.childIds)) continue
    for (const childId of rawNode.childIds) {
      if (typeof childId === "string") parentById.set(childId, nodeId)
    }
  }

  const normalized = rawNodes.map((rawNode): AccessibilityTreeNode | undefined => {
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
    if (shouldRedactAccessibilityValue(node) && node.value !== undefined) node.value = REDACTED_VALUE
    return node
  }).filter((node): node is AccessibilityTreeNode => Boolean(node))

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

async function screenshot(params: unknown) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const fullPage = readBoolean(input.fullPage)
  const result = await sendCdp(tabId, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: fullPage,
  }) as { data?: string }
  if (!result.data) throw new Error("Chrome did not return screenshot data.")
  return {
    tabId,
    mime: "image/png",
    data: result.data,
  }
}

async function click(params: unknown) {
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
  })
  await sendCdp(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button,
    clickCount: 1,
  })
  await chrome.tabs.sendMessage(tabId, { type: "ANYBOX_BROWSER_BRIDGE_ACTIVE" }).catch(() => undefined)
  return { tabId, x, y, button }
}

async function clickElement(params: unknown) {
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
  }, [elementId]) as { ok: boolean; error?: string; x?: number; y?: number }

  if (!target.ok || target.x === undefined || target.y === undefined) {
    throw new Error(target.error || `Element '${elementId}' could not be clicked.`)
  }

  await sendCdp(tabId, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: target.x,
    y: target.y,
    button,
  })
  await sendCdp(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: target.x,
    y: target.y,
    button,
    clickCount: 1,
  })
  await sendCdp(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: target.x,
    y: target.y,
    button,
    clickCount: 1,
  })
  await chrome.tabs.sendMessage(tabId, { type: "ANYBOX_BROWSER_BRIDGE_ACTIVE", action: "Clicking" }).catch(() => undefined)
  const tab = await tabInfo(tabId)
  return { tabId, elementId, url: tab.url, title: tab.title }
}

async function fill(params: unknown) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const elementId = readString(input.elementId)
  const text = readString(input.text)
  if (!elementId) throw new Error("page.fill requires elementId.")
  const result = await runInPage(tabId, (id: string, nextValue: string) => {
    const ATTR = "data-anybox-element-id"
    const elements = Array.from(document.querySelectorAll(`[${ATTR}]`))
    const element = elements.find((node) => node.getAttribute(ATTR) === id) as HTMLElement | undefined
    if (!element) return { ok: false, error: `Element '${id}' was not found. Run browser_interactive_snapshot again.` }
    if ((element as HTMLInputElement).disabled || element.getAttribute("aria-disabled") === "true") {
      return { ok: false, error: `Element '${id}' is disabled.` }
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
  }, [elementId, text]) as { ok: boolean; error?: string }

  if (!result.ok) throw new Error(result.error || `Element '${elementId}' could not be filled.`)
  await chrome.tabs.sendMessage(tabId, { type: "ANYBOX_BROWSER_BRIDGE_ACTIVE", action: "Typing" }).catch(() => undefined)
  const tab = await tabInfo(tabId)
  return { tabId, elementId, textLength: text.length, url: tab.url, title: tab.title }
}

async function typeText(params: unknown) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const text = readString(input.text)
  if (!text) throw new Error("page.type requires text.")
  await sendCdp(tabId, "Input.insertText", { text })
  await chrome.tabs.sendMessage(tabId, { type: "ANYBOX_BROWSER_BRIDGE_ACTIVE" }).catch(() => undefined)
  return { tabId, textLength: text.length }
}

async function scroll(params: unknown) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const scrollX = readNumber(input.scrollX, 0) ?? 0
  const scrollY = readNumber(input.scrollY, 0) ?? 0
  const position = await runInPage(tabId, (x: number, y: number) => {
    window.scrollBy(x, y)
    return { scrollX: window.scrollX, scrollY: window.scrollY }
  }, [scrollX, scrollY])
  await chrome.tabs.sendMessage(tabId, { type: "ANYBOX_BROWSER_BRIDGE_ACTIVE" }).catch(() => undefined)
  return { tabId, scrollX, scrollY, position }
}

async function waitFor(params: unknown) {
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
    const tab = await tabInfo(tabId)
    if (urlIncludes && tab.url?.includes(urlIncludes)) {
      return { tabId, url: tab.url, title: tab.title, matched: true, reason: `URL includes '${urlIncludes}'.` }
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
    }, [{ text, selector, elementId }])

    if (matched) {
      const latest = await tabInfo(tabId)
      return { tabId, url: latest.url, title: latest.title, matched: true, reason: matched }
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  const tab = await tabInfo(tabId)
  return { tabId, url: tab.url, title: tab.title, matched: false, reason }
}

async function executeScript(params: unknown) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const script = readString(input.script)
  if (!script) throw new Error("page.executeScript requires script.")
  const result = await sendCdp(tabId, "Runtime.evaluate", {
    expression: script,
    awaitPromise: true,
    returnByValue: true,
  }) as { result?: { value?: unknown } }
  return {
    tabId,
    value: result.result?.value,
  }
}

async function cdpSend(params: unknown) {
  const input = readRecord(params)
  const tabId = await activeTabId(input.tabId)
  const method = readString(input.method)
  if (!method) throw new Error("cdp.send requires method.")
  const commandParams = readRecord(input.params)
  return await sendCdp(tabId, method, commandParams)
}

export async function handleBrowserCommand(method: BrowserExtensionCommandMethod, params?: unknown) {
  switch (method) {
    case "tabs.list":
      return await listTabs()
    case "tabs.open":
      return await openTab(params)
    case "tabs.activate":
      return await activateTab(params)
    case "tabs.release":
      return { ok: true }
    case "page.snapshot":
      return await snapshot(params)
    case "page.interactiveSnapshot":
      return await interactiveSnapshot(params)
    case "page.domTree":
      return await domTree(params)
    case "page.accessibilityTree":
      return await accessibilityTree(params)
    case "page.screenshot":
      return await screenshot(params)
    case "page.click":
      return await click(params)
    case "page.clickElement":
      return await clickElement(params)
    case "page.fill":
      return await fill(params)
    case "page.type":
      return await typeText(params)
    case "page.scroll":
      return await scroll(params)
    case "page.waitFor":
      return await waitFor(params)
    case "page.executeScript":
      return await executeScript(params)
    case "cdp.send":
      return await cdpSend(params)
  }
}

chrome.debugger.onDetach.addListener((source: any) => {
  if (typeof source.tabId === "number") attachedTabs.delete(source.tabId)
})
