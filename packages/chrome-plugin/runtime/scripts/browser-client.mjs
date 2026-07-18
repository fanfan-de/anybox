// Chrome JavaScript SDK shared by execution hosts such as the Node REPL.
const DEFAULT_AGENT_BASE_URL = defaultAgentBaseURL()
const AGENT_BASE_URL = normalizeBaseURL(
  process.env.ANYBOX_AGENT_BASE_URL || DEFAULT_AGENT_BASE_URL,
)
const TRUSTED_TOKEN = process.env.ANYBOX_BROWSER_TRUSTED_TOKEN || ""

function defaultAgentBaseURL() {
  const host = String(process.env.ANYBOX_SERVER_HOST || "127.0.0.1").trim() || "127.0.0.1"
  const port = String(process.env.ANYBOX_SERVER_PORT || "4096").trim() || "4096"
  return `http://${host}:${port}`
}

function normalizeBaseURL(value) {
  const normalized = String(value || DEFAULT_AGENT_BASE_URL).trim().replace(/\/+$/, "")
  return normalized || DEFAULT_AGENT_BASE_URL
}

async function agentFetch(path, options) {
  if (typeof fetch !== "function") {
    throw new Error("The Chrome runtime requires a Node.js runtime with fetch support.")
  }

  const response = await fetch(`${AGENT_BASE_URL}${path}`, {
    headers: {
      accept: "application/json",
      ...(options?.headers ?? {}),
    },
    ...options,
  })
  const bodyText = await response.text()
  let body
  try {
    body = bodyText ? JSON.parse(bodyText) : undefined
  } catch {
    body = undefined
  }

  if (!response.ok) {
    const apiMessage = body?.error && typeof body.error.message === "string" ? body.error.message : undefined
    throw new Error(apiMessage || bodyText.trim() || `Anybox agent request failed with HTTP ${response.status}.`)
  }
  if (!body || body.success !== true) {
    throw new Error("Anybox agent returned an invalid API envelope.")
  }
  return body.data
}

async function browserCommand(method, params = {}, options = {}) {
  return agentFetch("/api/browser-extension/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method,
      params,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    }),
  })
}

async function trustedBrowserCommand(method, params = {}, options = {}) {
  if (!TRUSTED_TOKEN) throw new Error("Chrome trusted command token is not available.")
  return agentFetch("/api/browser-extension/trusted-command", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-anybox-browser-trusted-token": TRUSTED_TOKEN,
    },
    body: JSON.stringify({
      method,
      params,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    }),
  })
}

function serializeEvaluation(pageFunction, args) {
  if (typeof pageFunction === "function") {
    return `(${pageFunction.toString()})(...${JSON.stringify(args)})`
  }
  if (typeof pageFunction === "string") return pageFunction
  throw new Error("evaluate requires a function or JavaScript expression string.")
}

class BrowserLocator {
  constructor(tab, selector) {
    this.tab = tab
    this.selector = selector
  }

  async click(options = {}) {
    return this.tab.playwright.click(this.selector, options)
  }

  async fill(value, options = {}) {
    return this.tab.playwright.fill(this.selector, value, options)
  }

  async textContent() {
    return this.tab.evaluate((selector) => document.querySelector(selector)?.textContent ?? null, this.selector)
  }

  async inputValue() {
    return this.tab.evaluate((selector) => {
      const element = document.querySelector(selector)
      return element && "value" in element ? element.value : null
    }, this.selector)
  }
}

class BrowserTab {
  constructor(tabId) {
    this.tabId = tabId
    this.cdp = {
      send: async (method, params = {}) => trustedBrowserCommand("cdp.send", { tabId: this.tabId, method, params }),
    }
    this.playwright = createPlaywrightAdapter(this)
  }

  withTabId(params = {}) {
    return this.tabId ? { ...params, tabId: this.tabId } : params
  }

  async info() {
    if (!this.tabId) return undefined
    const result = await browserCommand("tabs.list")
    return result.tabs.find((tab) => tab.id === this.tabId)
  }

  async activate() {
    const tab = await browserCommand("tabs.activate", this.withTabId())
    this.tabId = tab.id
    return tab
  }

  async snapshot(options = {}) {
    return browserCommand("page.snapshot", this.withTabId(options))
  }

  async interactiveSnapshot(options = {}) {
    return browserCommand("page.interactiveSnapshot", this.withTabId(options))
  }

  async domTree(options = {}) {
    return browserCommand("page.domTree", this.withTabId(options))
  }

  async accessibilityTree(options = {}) {
    return browserCommand("page.accessibilityTree", this.withTabId(options))
  }

  async screenshot(options = {}) {
    return browserCommand("page.screenshot", this.withTabId(options))
  }

  async click(x, y, options = {}) {
    return browserCommand("page.click", this.withTabId({ x, y, ...options }))
  }

  async clickElement(elementId, options = {}) {
    return browserCommand("page.clickElement", this.withTabId({ elementId, ...options }))
  }

  async fill(elementId, text, options = {}) {
    return browserCommand("page.fill", this.withTabId({ elementId, text, ...options }))
  }

  async type(text) {
    return browserCommand("page.type", this.withTabId({ text }))
  }

  async scroll(options = {}) {
    return browserCommand("page.scroll", this.withTabId(options))
  }

  async waitFor(options = {}) {
    const timeoutMs = options.timeoutMs ? Math.min(Math.max(Number(options.timeoutMs), 1), 60_000) + 5_000 : undefined
    return browserCommand("page.waitFor", this.withTabId(options), { timeoutMs })
  }

  async release() {
    if (!this.tabId) return { released: false }
    return browserCommand("tabs.release", { tabId: this.tabId })
  }

  async evaluate(pageFunction, ...args) {
    const result = await trustedBrowserCommand("page.executeScript", this.withTabId({
      script: serializeEvaluation(pageFunction, args),
    }))
    return result.value
  }

  locator(selector) {
    return new BrowserLocator(this, selector)
  }
}

function createPlaywrightAdapter(tab) {
  return {
    locator: (selector) => new BrowserLocator(tab, selector),
    evaluate: (pageFunction, ...args) => tab.evaluate(pageFunction, ...args),
    screenshot: (options = {}) => tab.screenshot(options),
    waitForSelector: (selector, options = {}) => tab.waitFor({ selector, timeoutMs: options.timeout }),
    click: async (selector, options = {}) => {
      await tab.evaluate((query) => {
        const element = document.querySelector(query)
        if (!element) throw new Error(`Selector '${query}' was not found.`)
        element.scrollIntoView({ block: "center", inline: "center" })
        element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      }, selector)
      return { selector, ...options }
    },
    fill: async (selector, value, options = {}) => {
      await tab.evaluate((query, nextValue) => {
        const element = document.querySelector(query)
        if (!element) throw new Error(`Selector '${query}' was not found.`)
        element.scrollIntoView({ block: "center", inline: "center" })
        element.focus()
        if ("value" in element) {
          element.value = nextValue
        } else {
          element.textContent = nextValue
        }
        element.dispatchEvent(new Event("input", { bubbles: true }))
        element.dispatchEvent(new Event("change", { bubbles: true }))
      }, selector, value)
      return { selector, textLength: String(value).length, ...options }
    },
    keyboard: {
      type: (text) => tab.type(text),
    },
    mouse: {
      click: (x, y, options = {}) => tab.click(x, y, options),
    },
  }
}

class BrowserRuntime {
  constructor() {
    this.tabs = {
      list: async () => {
        const result = await browserCommand("tabs.list")
        return result.tabs.map((tab) => ({ ...tab, runtime: new BrowserTab(tab.id) }))
      },
      open: async (url, options = {}) => {
        const tab = await browserCommand("tabs.open", { url, ...options })
        return new BrowserTab(tab.id)
      },
      activate: async (tabId) => {
        const tab = await browserCommand("tabs.activate", { tabId })
        return new BrowserTab(tab.id)
      },
      get: async (tabId) => new BrowserTab(tabId),
      current: async () => new BrowserTab(undefined),
    }
  }
}

export async function setupBrowserRuntime(options = {}) {
  const globals = options.globals || globalThis
  const agent = globals.agent && typeof globals.agent === "object" ? globals.agent : {}
  agent.browsers = {
    get: async (name = "extension") => {
      if (name !== "extension") throw new Error(`Unknown browser runtime '${name}'.`)
      return new BrowserRuntime()
    },
  }
  globals.agent = agent
  globals.setupBrowserRuntime = setupBrowserRuntime
  return agent
}
