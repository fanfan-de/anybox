import assert from "node:assert/strict"
import { existsSync, readdirSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

import { build } from "esbuild"
import { chromium } from "playwright-core"

const extensionRoot = path.resolve(import.meta.dirname, "..")
const enginePath = path.join(
  extensionRoot,
  "public",
  "locator-engine.js",
)
const compilerPath = path.join(
  extensionRoot,
  "src",
  "background",
  "locator-compiler.ts",
)

function chromeExecutable() {
  const configured = process.env.ANYBOX_BROWSER_CHROME_PATH?.trim()
  const candidates = [
    configured,
    process.platform === "win32"
      ? path.join(
          process.env.LOCALAPPDATA ?? "",
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : undefined,
    process.platform === "win32"
      ? path.join(
          process.env.PROGRAMFILES ?? "",
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : undefined,
    process.platform === "win32"
      ? path.join(
          process.env["PROGRAMFILES(X86)"] ?? "",
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : undefined,
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined,
    process.platform === "linux" ? "/usr/bin/google-chrome" : undefined,
    process.platform === "linux" ? "/usr/bin/google-chrome-stable" : undefined,
    process.platform === "linux" ? "/usr/bin/chromium" : undefined,
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate))
}

function extensionTestExecutable() {
  const configured =
    process.env.ANYBOX_BROWSER_CHROME_FOR_TESTING_PATH?.trim()
  if (configured && existsSync(configured)) return configured
  const cacheRoots = process.platform === "win32"
    ? [path.join(os.homedir(), "AppData", "Local", "ms-playwright")]
    : [path.join(os.homedir(), ".cache", "ms-playwright")]
  for (const root of cacheRoots) {
    if (!existsSync(root)) continue
    const versions = readdirSync(root)
      .filter((entry) => /^chromium-\d+$/u.test(entry))
      .sort((left, right) => right.localeCompare(left, undefined, {
        numeric: true,
      }))
    for (const version of versions) {
      const candidates = process.platform === "win32"
        ? [path.join(root, version, "chrome-win64", "chrome.exe")]
        : process.platform === "darwin"
          ? [
              path.join(
                root,
                version,
                "chrome-mac-arm64",
                "Chromium.app",
                "Contents",
                "MacOS",
                "Chromium",
              ),
              path.join(
                root,
                version,
                "chrome-mac",
                "Chromium.app",
                "Contents",
                "MacOS",
                "Chromium",
              ),
            ]
          : [path.join(root, version, "chrome-linux", "chrome")]
      const executable = candidates.find((candidate) => existsSync(candidate))
      if (executable) return executable
    }
  }
  return undefined
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(0, "127.0.0.1")
  })
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  return address.port
}

async function closeServer(server) {
  if (!server?.listening) return
  server.closeAllConnections?.()
  await new Promise((resolve) => server.close(resolve))
}

function fingerprintScript(elements) {
  return elements.map((element) => ({
    id: element.id || null,
    tag: element.tagName.toLowerCase(),
    testId: element.getAttribute("data-testid"),
    text: String(element.textContent ?? "").replace(/\s+/g, " ").trim(),
  }))
}

test("pinned Anybox engine matches Playwright 1.61.1 in real Chrome", {
  skip: chromeExecutable()
    ? false
    : "Google Chrome is not installed; set ANYBOX_BROWSER_CHROME_PATH to run.",
  timeout: 45_000,
}, async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "anybox-locator-real-chrome-"),
  )
  const compilerOutput = path.join(temporaryRoot, "locator-compiler.mjs")
  let browser
  try {
    await build({
      entryPoints: [compilerPath],
      outfile: compilerOutput,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      sourcemap: false,
    })
    const { compileLocatorExpressionV3 } = await import(
      `${pathToFileURL(compilerOutput).href}?${Date.now()}`
    )
    const engineSource = await readFile(enginePath, "utf8")
    browser = await chromium.launch({
      executablePath: chromeExecutable(),
      headless: true,
      args: [
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--no-first-run",
      ],
    })
    const page = await browser.newPage()
    await page.setContent(`
      <!doctype html>
      <html>
        <body>
          <button id="save-a">Save</button>
          <button id="save-b">Save</button>
          <button id="unique" data-testid="unique-action">Unique</button>
          <ul>
            <li id="product-a">Product 1</li>
            <li id="product-b">Product 2</li>
          </ul>
          <div id="dynamic">Dynamic 42</div>
          <label>
            Email
            <input id="email" data-testid="email" placeholder="Work email">
          </label>
          <div id="shadow-host"></div>
          <iframe id="child" srcdoc="<button id='frame-button'>Frame action</button>"></iframe>
          <script>
            const root = document.querySelector("#shadow-host")
              .attachShadow({ mode: "open" })
            root.innerHTML = '<a id="shadow-link" href="#">Shadow Link</a>'
          </script>
        </body>
      </html>
    `)

    const inject = async (frame) => {
      await frame.evaluate((source) => {
        globalThis.eval(source)
      }, engineSource)
    }
    const anyboxMatches = async (frame, expression) => {
      const selector = compileLocatorExpressionV3(expression)
      return await frame.evaluate((compiled) => {
        const engine = globalThis.__anyboxPlaywrightEngine
        const elements = engine.querySelectorAllCached(compiled, document)
        return elements.map((element) => ({
          id: element.id || null,
          tag: element.tagName.toLowerCase(),
          testId: element.getAttribute("data-testid"),
          text: String(element.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim(),
        }))
      }, selector)
    }
    const compare = async (expression, locator, frame = page.mainFrame()) => {
      const expected = await locator.evaluateAll(fingerprintScript)
      const actual = await anyboxMatches(frame, expression)
      assert.deepEqual(actual, expected)
    }

    await inject(page.mainFrame())
    await compare({
      kind: "role",
      role: "button",
      name: { type: "string", value: "Save", exact: true },
    }, page.getByRole("button", { name: "Save", exact: true }))
    await compare({
      kind: "testId",
      matcher: { type: "string", value: "unique-action", exact: true },
    }, page.getByTestId("unique-action"))
    await compare({
      kind: "filter",
      source: { kind: "role", role: "listitem" },
      hasText: { type: "string", value: "Product 2" },
    }, page.getByRole("listitem").filter({ hasText: "Product 2" }))
    await compare({
      kind: "role",
      role: "link",
      name: { type: "string", value: "Shadow Link", exact: true },
    }, page.getByRole("link", { name: "Shadow Link", exact: true }))
    await compare({
      kind: "text",
      matcher: { type: "regex", source: "^Dynamic 42$", flags: "u" },
    }, page.getByText(/^Dynamic 42$/u))
    await compare({
      kind: "text",
      matcher: {
        type: "regex",
        source: String.raw`^Dynamic \d{2}$`,
        flags: "iu",
      },
    }, page.getByText(/^dynamic \d{2}$/iu))
    await page.locator("#dynamic").evaluate((element) => {
      element.textContent = "Dynamic 4/2"
    })
    await compare({
      kind: "text",
      matcher: {
        type: "regex",
        source: String.raw`^Dynamic \d/\d$`,
        flags: "u",
      },
    }, page.getByText(/^Dynamic \d\/\d$/u))
    await page.locator("#dynamic").evaluate((element) => {
      element.textContent = "Dynamic >> '42'"
    })
    await compare({
      kind: "text",
      matcher: {
        type: "regex",
        source: String.raw`^Dynamic >> '42'$`,
        flags: "",
      },
    }, page.getByText(/^Dynamic >> '42'$/))
    await page.locator("#dynamic").evaluate((element) => {
      element.textContent = "Dynamic 42"
    })
    await compare({
      kind: "selector",
      value: "button#unique",
    }, page.locator("button#unique"))
    await compare({
      kind: "label",
      matcher: { type: "string", value: "Email", exact: true },
    }, page.getByLabel("Email", { exact: true }))
    await compare({
      kind: "placeholder",
      matcher: { type: "string", value: "Work email", exact: true },
    }, page.getByPlaceholder("Work email", { exact: true }))
    await compare({
      kind: "and",
      left: { kind: "role", role: "button" },
      right: {
        kind: "testId",
        matcher: {
          type: "string",
          value: "unique-action",
          exact: true,
        },
      },
    }, page.getByRole("button").and(page.getByTestId("unique-action")))
    await compare({
      kind: "or",
      left: { kind: "selector", value: "#product-a" },
      right: { kind: "selector", value: "#product-b" },
    }, page.locator("#product-a").or(page.locator("#product-b")))
    await compare({
      kind: "nth",
      source: { kind: "role", role: "listitem" },
      index: -2,
    }, page.getByRole("listitem").nth(-2))
    await compare({
      kind: "filter",
      source: { kind: "role", role: "listitem" },
      has: {
        kind: "text",
        matcher: { type: "string", value: "Product 2", exact: true },
      },
    }, page.getByRole("listitem").filter({
      has: page.getByText("Product 2", { exact: true }),
    }))
    await compare({
      kind: "descendant",
      left: { kind: "selector", value: "body" },
      right: {
        kind: "testId",
        matcher: { type: "string", value: "email", exact: true },
      },
    }, page.locator("body").getByTestId("email"))

    const dynamicSelector = {
      kind: "testId",
      matcher: { type: "string", value: "unique-action", exact: true },
    }
    assert.equal((await anyboxMatches(page.mainFrame(), dynamicSelector)).length, 1)
    await page.evaluate(() => {
      const duplicate = document.createElement("button")
      duplicate.id = "dynamic-duplicate"
      duplicate.dataset.testid = "unique-action"
      duplicate.textContent = "Dynamic duplicate"
      document.body.append(duplicate)
    })
    assert.equal((await anyboxMatches(page.mainFrame(), dynamicSelector)).length, 2)
    await page.locator("#dynamic-duplicate").evaluate((element) =>
      element.remove()
    )

    const shadowLinkSelector = {
      kind: "role",
      role: "link",
      name: { type: "string", value: "Shadow Link", exact: true },
    }
    assert.equal(
      (await anyboxMatches(page.mainFrame(), shadowLinkSelector)).length,
      1,
    )
    await page.evaluate(() => {
      document.querySelector("#shadow-host").shadowRoot
        .querySelector("#shadow-link").textContent = "Changed Shadow Link"
    })
    assert.equal(
      (await anyboxMatches(page.mainFrame(), shadowLinkSelector)).length,
      0,
    )
    await page.evaluate(() => {
      document.querySelector("#shadow-host").shadowRoot
        .querySelector("#shadow-link").textContent = "Shadow Link"
    })

    const child = page.frames().find((frame) => frame !== page.mainFrame())
    assert.ok(child)
    await inject(child)
    await compare({
      kind: "role",
      role: "button",
      name: { type: "string", value: "Frame action", exact: true },
    }, page.frameLocator("#child").getByRole("button", {
      name: "Frame action",
      exact: true,
    }), child)

    const actionability = await page.evaluate(async () => {
      const engine = globalThis.__anyboxPlaywrightEngine
      const visible = document.querySelector("#unique")
      const hidden = document.createElement("button")
      hidden.style.display = "none"
      document.body.append(hidden)
      return {
        visible: await engine.checkElementStates(
          visible,
          ["visible", "stable", "enabled"],
        ),
        hidden: await engine.checkElementStates(hidden, ["visible"]),
      }
    })
    assert.equal(actionability.visible, undefined)
    assert.deepEqual(actionability.hidden, { missingState: "visible" })

    const benchmark = await page.evaluate(() => {
      const fixture = document.createDocumentFragment()
      for (let index = 0; index < 20_000; index += 1) {
        const element = document.createElement(
          index === 19_999 ? "button" : "div",
        )
        element.textContent = index === 19_999 ? "Hot target" : `row ${index}`
        fixture.append(element)
      }
      document.body.append(fixture)
      const engine = globalThis.__anyboxPlaywrightEngine
      const selector = 'internal:role=button[name="Hot target"s]'
      engine.querySelectorAllCached(selector, document)
      const oldSamples = []
      const newSamples = []
      for (let sample = 0; sample < 40; sample += 1) {
        let started = performance.now()
        Array.from(document.querySelectorAll("*")).find((element) =>
          element.tagName === "BUTTON"
          && String(element.textContent ?? "").trim() === "Hot target"
        )
        oldSamples.push(performance.now() - started)
        started = performance.now()
        engine.querySelectorAllCached(selector, document)
        newSamples.push(performance.now() - started)
      }
      const p95 = (samples) => [...samples].sort((left, right) => left - right)[
        Math.floor(samples.length * 0.95)
      ]
      return {
        oldP95: p95(oldSamples),
        newP95: p95(newSamples),
      }
    })
    assert.ok(
      benchmark.newP95 <= benchmark.oldP95 * 0.5,
      `Expected hot semantic locator p95 <= 50% of the legacy scan; got ${JSON.stringify(benchmark)}.`,
    )

    const cdp = await page.context().newCDPSession(page)
    await cdp.send("HeapProfiler.enable")
    await page.evaluate(() => {
      const engine = globalThis.__anyboxPlaywrightEngine
      const selector = 'internal:role=button[name="Hot target"s]'
      for (let index = 0; index < 100; index += 1) {
        engine.querySelectorAllCached(selector, document)
      }
    })
    await page.waitForTimeout(75)
    await cdp.send("HeapProfiler.collectGarbage")
    const heapBefore = await cdp.send("Runtime.getHeapUsage")
    await page.evaluate(() => {
      const engine = globalThis.__anyboxPlaywrightEngine
      const selector = 'internal:role=button[name="Hot target"s]'
      for (let index = 0; index < 1_000; index += 1) {
        engine.querySelectorAllCached(selector, document)
      }
    })
    await page.waitForTimeout(75)
    await cdp.send("HeapProfiler.collectGarbage")
    const heapAfter = await cdp.send("Runtime.getHeapUsage")
    assert.ok(
      heapAfter.usedSize - heapBefore.usedSize < 4 * 1024 * 1024,
      `Expected no sustained heap growth after 1,000 hot locates; before=${heapBefore.usedSize}, after=${heapAfter.usedSize}.`,
    )
  } finally {
    await browser?.close()
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("Browser Contract v4 groups and finalizes tabs in real Chrome", {
  skip: extensionTestExecutable()
    ? false
    : "Chrome for Testing/Chromium is required because branded Chrome 137+ blocks --load-extension; set ANYBOX_BROWSER_CHROME_FOR_TESTING_PATH.",
  timeout: 45_000,
}, async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "anybox-tab-groups-real-chrome-"),
  )
  const userDataDir = path.join(temporaryRoot, "profile")
  const extensionDir = path.join(temporaryRoot, "extension")
  let context
  try {
    await build({
      stdin: {
        contents: `
          import { handleBrowserCommand } from "./src/background/commands.ts"
          globalThis.__anyboxTestCommand = async (input) => {
            try {
              return {
                ok: true,
                data: await handleBrowserCommand(
                  input.method,
                  input.params,
                  { context: input.context },
                ),
              }
            } catch (error) {
              return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                code: error?.code,
                retryable: error?.retryable,
              }
            }
          }
        `,
        resolveDir: extensionRoot,
        sourcefile: "tab-group-e2e-entry.ts",
        loader: "ts",
      },
      outfile: path.join(extensionDir, "background.js"),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "chrome120",
      sourcemap: false,
      alias: {
        "@anybox/chrome-shared/browser-contract": path.join(
          extensionRoot,
          "..",
          "shared",
          "src",
          "browser-contract.ts",
        ),
        "@anybox/chrome-shared/browser-extension": path.join(
          extensionRoot,
          "..",
          "shared",
          "src",
          "browser-extension.ts",
        ),
      },
    })
    await writeFile(
      path.join(extensionDir, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name: "Anybox Tab Group E2E",
        version: "0.15.0",
        background: {
          service_worker: "background.js",
          type: "module",
        },
        permissions: [
          "debugger",
          "scripting",
          "storage",
          "tabs",
          "tabGroups",
        ],
        host_permissions: ["<all_urls>"],
      }),
      "utf8",
    )

    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: extensionTestExecutable(),
      // Chrome's current headless mode ignores side-loaded MV3 extensions.
      // Use a temporary isolated profile in headful mode for this API test.
      headless: false,
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--no-first-run",
      ],
    })
    const worker = context.serviceWorkers()[0]
      ?? await context.waitForEvent("serviceworker", { timeout: 10_000 })
    const command = async (method, params, turnID = "turn-1") => {
      const response = await worker.evaluate(
        async ({ method: commandMethod, params: commandParams, commandContext }) =>
          await globalThis.__anyboxTestCommand({
            method: commandMethod,
            params: commandParams,
            context: commandContext,
          }),
        {
          method,
          params,
          commandContext: {
            sessionID: "session-e2e",
            turnID,
            extensionInstanceID: "extension-e2e",
          },
        },
      )
      assert.equal(
        response.ok,
        true,
        `${method} failed: ${response.code ?? ""} ${response.error ?? ""}`,
      )
      return response.data
    }

    await command("browser.nameSession", {
      name: "✍️ Publish Zhihu update",
    })
    const deliverable = await command("tabs.open", {
      url: "https://example.invalid/result",
      active: false,
    })
    const handoff = await command("tabs.open", {
      url: "https://example.invalid/login",
      active: false,
    })
    const temporary = await command("tabs.open", {
      url: "https://example.invalid/helper",
      active: false,
    })
    const grouped = await worker.evaluate(async (tabIds) => {
      const tabs = await Promise.all(tabIds.map((tabId) => chrome.tabs.get(tabId)))
      const group = await chrome.tabGroups.get(tabs[0].groupId)
      return { tabs, group }
    }, [deliverable.id, handoff.id, temporary.id])
    assert.ok(grouped.tabs[0].groupId >= 0)
    assert.equal(grouped.tabs[1].groupId, grouped.tabs[0].groupId)
    assert.equal(grouped.tabs[2].groupId, grouped.tabs[0].groupId)
    assert.equal(grouped.group.title, "✍️ Publish Zhihu update")
    assert.equal(grouped.group.collapsed, false)

    const finalized = await command("tabs.finalize", {
      keep: [
        { tabId: deliverable.id, status: "deliverable" },
        { tabId: handoff.id, status: "handoff" },
      ],
    })
    assert.deepEqual(finalized.deliverableTabIds, [deliverable.id])
    assert.deepEqual(finalized.handoffTabIds, [handoff.id])
    assert.deepEqual(finalized.closedTabIds, [temporary.id])
    const afterFinalize = await worker.evaluate(async (tabIds) => {
      const read = async (tabId) => {
        try {
          return await chrome.tabs.get(tabId)
        } catch {
          return null
        }
      }
      return await Promise.all(tabIds.map(read))
    }, [deliverable.id, handoff.id, temporary.id])
    assert.equal(afterFinalize[0].groupId, -1)
    assert.ok(afterFinalize[1].groupId >= 0)
    assert.equal(afterFinalize[2], null)

    await command("tabs.markHandoff", { tabId: handoff.id }, "turn-2")
    await command("tabs.finalize", {
      keep: [{ tabId: handoff.id, status: "handoff" }],
    }, "turn-2")
    const resumed = await worker.evaluate(
      async (tabId) => await chrome.tabs.get(tabId),
      handoff.id,
    )
    assert.ok(resumed.groupId >= 0)

    const userTab = await worker.evaluate(async () => {
      const tab = await chrome.tabs.create({
        url: "https://example.invalid/user",
        active: false,
      })
      const groupId = await chrome.tabs.group({ tabIds: [tab.id] })
      await chrome.tabGroups.update(groupId, {
        title: "User group",
        color: "red",
      })
      return { tabId: tab.id, groupId }
    })
    await command("tabs.claim", { tabId: userTab.tabId }, "turn-3")
    await command("tabs.finalize", { keep: [] }, "turn-3")
    const userAfterFinalize = await worker.evaluate(
      async (tabId) => await chrome.tabs.get(tabId),
      userTab.tabId,
    )
    assert.equal(userAfterFinalize.groupId, userTab.groupId)
  } finally {
    await context?.close()
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("Extension v4 executor drives real Chrome without replaying input", {
  skip: chromeExecutable()
    ? false
    : "Google Chrome is not installed; set ANYBOX_BROWSER_CHROME_PATH to run.",
  timeout: 45_000,
}, async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "anybox-locator-executor-chrome-"),
  )
  const executorOutput = path.join(temporaryRoot, "playwright-executor.mjs")
  const executorPath = path.join(
    extensionRoot,
    "src",
    "background",
    "playwright-executor.ts",
  )
  let browser
  let executor
  let fixtureServer
  let crossOriginServer
  const originalChrome = globalThis.chrome
  const originalDebug = console.debug
  try {
    await build({
      entryPoints: [executorPath],
      outfile: executorOutput,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      sourcemap: false,
    })
    const engineSource = await readFile(enginePath, "utf8")
    browser = await chromium.launch({
      executablePath: chromeExecutable(),
      headless: true,
      args: [
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--no-first-run",
      ],
    })
    const page = await browser.newPage()
    const fixtureHtml = `
      <!doctype html>
      <html>
        <head><title>Executor fixture</title></head>
        <body>
          <button id="go" data-testid="go">Go</button>
          <button id="fault" data-testid="fault">Fault</button>
          <input id="query" data-testid="query">
          <input id="private-a" data-testid="private-field"
            type="password" aria-label="secret-token-123">
          <input id="private-b" data-testid="private-field"
            type="password" aria-label="secret-token-456">
          <label for="otp">Verification code</label>
          <input id="otp" data-testid="otp" value="654321">
          <textarea id="notes" data-testid="notes">textarea-private-789</textarea>
          <div id="editable" data-testid="editable" contenteditable
            aria-label="Notes">contenteditable-private-abc</div>
          <input id="checked" data-testid="checked" type="checkbox">
          <input id="upload" data-testid="upload" type="file" multiple>
          <a data-testid="download"
            download="locator-download.txt"
            href="data:text/plain,anybox%20locator%20download">
            Download
          </a>
          <select id="choice" data-testid="choice">
            <option value="a">A</option>
            <option value="b">B</option>
          </select>
          <div id="shadow-host"></div>
          <iframe id="child" style="display:block;margin-top:1500px" srcdoc="
            <button data-testid='frame-go'
              onclick='parent.executorFrameClicks += 1'>Frame Go</button>
          "></iframe>
          <script>
            window.executorClicks = 0
            window.executorFrameClicks = 0
            document.querySelector("#go").addEventListener("click", () => {
              window.executorClicks += 1
            })
            window.executorInputs = []
            document.querySelector("#query").addEventListener("input", event => {
              window.executorInputs.push(event.target.value)
            })
            document.querySelector("#shadow-host")
              .attachShadow({ mode: "open" })
          </script>
        </body>
      </html>
    `
    fixtureServer = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      response.end(fixtureHtml)
    })
    crossOriginServer = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      response.end(`
        <!doctype html>
        <button data-testid="oopif-go"
          onclick="window.oopifClicks = (window.oopifClicks || 0) + 1">
          OOPIF Go
        </button>
      `)
    })
    const fixturePort = await listen(fixtureServer)
    const crossOriginPort = await listen(crossOriginServer)
    const fixtureUrl = `http://127.0.0.1:${fixturePort}/`
    const crossOriginUrl = `http://localhost:${crossOriginPort}/`
    await page.goto(fixtureUrl)

    const cdp = await page.context().newCDPSession(page)
    const rawRootSession = cdp._connection.toImpl(cdp)._session
    assert.ok(rawRootSession)
    const eventListeners = new Set()
    const detachListeners = new Set()
    const routedSessions = new Map()
    const attachedIframeSessions = new Set()
    const forwardedEvents = [
      "Target.attachedToTarget",
      "Target.detachedFromTarget",
      "Runtime.executionContextDestroyed",
      "Runtime.executionContextsCleared",
      "Page.frameAttached",
      "Page.frameNavigated",
      "Page.navigatedWithinDocument",
      "Page.frameDetached",
      "Page.lifecycleEvent",
      "Page.fileChooserOpened",
      "Browser.downloadWillBegin",
      "Browser.downloadProgress",
    ]
    const emitDebuggerEvent = (source, method, params) => {
      if (!forwardedEvents.includes(method)) return
      for (const listener of eventListeners) {
        listener(source, method, params)
      }
    }
    const routeSessionEvent = (
      sourceSessionId,
      parentSession,
      method,
      params,
    ) => {
      if (
        method === "Target.attachedToTarget"
        && params.targetInfo?.type === "iframe"
        && typeof params.sessionId === "string"
      ) {
        attachedIframeSessions.add(params.sessionId)
        ensureRoutedSession(params.sessionId, parentSession)
      }
      emitDebuggerEvent(
        sourceSessionId
          ? { tabId: 1, sessionId: sourceSessionId }
          : { tabId: 1 },
        method,
        params,
      )
      if (
        method === "Target.detachedFromTarget"
        && typeof params.sessionId === "string"
      ) {
        routedSessions.get(params.sessionId)?.dispose()
        routedSessions.delete(params.sessionId)
      }
    }
    const ensureRoutedSession = (sessionId, parentSession) => {
      const existing = routedSessions.get(sessionId)
      if (existing) return existing
      const session = parentSession.createChildSession(
        sessionId,
        (method, params) => {
          routeSessionEvent(sessionId, session, method, params)
        },
      )
      routedSessions.set(sessionId, session)
      return session
    }
    for (const event of forwardedEvents) {
      cdp.on(event, (params) => {
        routeSessionEvent(undefined, rawRootSession, event, params)
      })
    }

    let failMouseAfterMove = false
    let mouseDispatches = 0
    let mouseEvents = []
    globalThis.chrome = {
      debugger: {
        async attach() {},
        async detach() {
          for (const listener of detachListeners) {
            listener({ tabId: 1 }, "target_closed")
          }
        },
        async sendCommand(target, method, params) {
          if (target.sessionId) {
            const session = routedSessions.get(target.sessionId)
            if (!session) {
              throw new Error(`Unknown child session ${target.sessionId}.`)
            }
            return await session.send(method, params)
          }
          if (method === "Input.dispatchMouseEvent") {
            mouseDispatches += 1
            mouseEvents.push(params.type)
            if (failMouseAfterMove && mouseDispatches === 2) {
              throw new Error("Injected transport interruption")
            }
          }
          return await cdp.send(method, params)
        },
        onEvent: {
          addListener(listener) {
            eventListeners.add(listener)
          },
        },
        onDetach: {
          addListener(listener) {
            detachListeners.add(listener)
          },
        },
      },
      runtime: {
        getURL() {
          return `data:text/javascript;base64,${
            Buffer.from(engineSource).toString("base64")
          }`
        },
        async getPlatformInfo() {
          return { os: process.platform === "darwin" ? "mac" : "win" }
        },
      },
      tabs: {
        async get() {
          return { id: 1, title: await page.title(), url: page.url() }
        },
      },
    }
    console.debug = () => {}
    executor = await import(
      `${pathToFileURL(executorOutput).href}?${Date.now()}`
    )
    executor.configurePlaywrightDownloadDirectory(temporaryRoot)

    const run = (method, params) =>
      executor.executePlaywrightCommand(method, { tabId: 1, ...params })
    const testIdPlan = (value) => ({
      framePath: [],
      expression: {
        kind: "testId",
        matcher: { type: "string", value, exact: true },
      },
    })
    const frameTestIdPlan = (value) => ({
      ...testIdPlan(value),
      framePath: ["#child"],
    })
    const oopifTestIdPlan = (value) => ({
      ...testIdPlan(value),
      framePath: ["#cross-child"],
    })

    assert.equal((await run("playwright.locator.count", {
      plan: testIdPlan("go"),
    })).count, 1)
    assert.equal((await run("playwright.locator.count", {
      plan: frameTestIdPlan("frame-go"),
    })).count, 1)
    assert.equal(await page.evaluate(() => window.scrollY), 0)
    await run("playwright.locator.click", {
      plan: frameTestIdPlan("frame-go"),
      timeoutMs: 2_000,
    })
    assert.equal(await page.evaluate(() => window.executorFrameClicks), 1)
    assert.ok(await page.evaluate(() => window.scrollY > 0))
    await page.evaluate(() => {
      const frame = document.querySelector("#child")
      const rect = frame.getBoundingClientRect()
      const cover = document.createElement("div")
      cover.id = "frame-cover"
      Object.assign(cover.style, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        zIndex: "2147483647",
      })
      document.body.append(cover)
    })
    await assert.rejects(
      run("playwright.locator.click", {
        plan: frameTestIdPlan("frame-go"),
        timeoutMs: 300,
      }),
      (error) =>
        error.code === "LOCATOR_NOT_ACTIONABLE"
        && error.details?.phase === "actionability",
    )
    assert.equal(await page.evaluate(() => window.executorFrameClicks), 1)
    await page.locator("#frame-cover").evaluate((element) => element.remove())
    await run("playwright.locator.click", {
      plan: frameTestIdPlan("frame-go"),
      timeoutMs: 2_000,
    })
    assert.equal(await page.evaluate(() => window.executorFrameClicks), 2)

    await page.evaluate((url) => new Promise((resolve, reject) => {
      const frame = document.createElement("iframe")
      frame.id = "cross-child"
      frame.style.display = "block"
      frame.addEventListener("load", resolve, { once: true })
      frame.addEventListener("error", reject, { once: true })
      frame.src = url
      document.body.append(frame)
    }), crossOriginUrl)
    assert.ok(
      attachedIframeSessions.size > 0,
      "Expected Target.setAutoAttach to expose the cross-origin OOPIF.",
    )
    assert.equal((await run("playwright.locator.count", {
      plan: oopifTestIdPlan("oopif-go"),
      timeoutMs: 2_000,
    })).count, 1)
    await run("playwright.locator.click", {
      plan: oopifTestIdPlan("oopif-go"),
      timeoutMs: 2_000,
    })
    const oopif = page.frames().find((frame) =>
      frame.url().startsWith(crossOriginUrl)
    )
    assert.ok(oopif)
    assert.equal(
      await oopif.evaluate(() => window.oopifClicks),
      1,
    )
    await run("playwright.waitForLoadState", {
      state: "load",
      timeoutMs: 1_000,
    })

    await page.evaluate(() => {
      setTimeout(() => {
        const button = document.createElement("button")
        button.dataset.testid = "shadow-late"
        button.textContent = "Shadow late"
        document.querySelector("#shadow-host").shadowRoot.append(button)
      }, 50)
    })
    assert.equal((await run("playwright.locator.textContent", {
      plan: testIdPlan("shadow-late"),
      timeoutMs: 2_000,
    })).value, "Shadow late")

    await run("playwright.locator.fill", {
      plan: testIdPlan("query"),
      value: "hello",
      timeoutMs: 2_000,
    })
    assert.deepEqual(await page.evaluate(() => ({
      value: document.querySelector("#query").value,
      inputs: window.executorInputs,
    })), { value: "hello", inputs: ["hello"] })
    await run("playwright.locator.press", {
      plan: testIdPlan("query"),
      value: "Control+A",
      timeoutMs: 2_000,
    })
    await run("playwright.locator.type", {
      plan: testIdPlan("query"),
      value: "Z",
      timeoutMs: 2_000,
    })
    assert.equal(await page.locator("#query").inputValue(), "Z")
    await run("playwright.locator.press", {
      plan: testIdPlan("query"),
      value: "Shift+KeyA",
      timeoutMs: 2_000,
    })
    assert.equal(await page.locator("#query").inputValue(), "ZA")

    await assert.rejects(
      run("playwright.locator.fill", {
        plan: testIdPlan("otp"),
        value: "111111",
        timeoutMs: 2_000,
      }),
      (error) =>
        error.code === "PERMISSION_DENIED"
        && error.details?.phase === "sensitive-check",
    )
    assert.equal(await page.locator("#otp").inputValue(), "654321")
    await run("playwright.locator.fill", {
      plan: testIdPlan("otp"),
      value: "111111",
      sensitive: true,
      timeoutMs: 2_000,
    })
    assert.equal(await page.locator("#otp").inputValue(), "111111")
    assert.equal((await run("playwright.locator.inputValue", {
      plan: testIdPlan("otp"),
      timeoutMs: 2_000,
    })).value, null)

    await assert.rejects(
      run("playwright.locator.fill", {
        plan: testIdPlan("checked"),
        value: "not-a-checkbox-value",
        timeoutMs: 2_000,
      }),
      (error) =>
        error.code === "LOCATOR_NOT_ACTIONABLE"
        && error.details?.phase === "target-type",
    )
    assert.equal(await page.locator("#checked").isChecked(), false)

    await run("playwright.locator.setChecked", {
      plan: testIdPlan("checked"),
      checked: true,
      timeoutMs: 2_000,
    })
    assert.equal(await page.locator("#checked").isChecked(), true)
    assert.deepEqual((await run("playwright.locator.selectOption", {
      plan: testIdPlan("choice"),
      values: ["b"],
      timeoutMs: 2_000,
    })).values, ["b"])
    assert.equal(await page.locator("#choice").inputValue(), "b")

    const uploadPath = path.join(temporaryRoot, "approved-upload.txt")
    await writeFile(uploadPath, "approved fixture", "utf8")
    const chooserPromise = run("playwright.waitForEvent", {
      event: "filechooser",
      timeoutMs: 2_000,
    })
    await run("playwright.locator.click", {
      plan: testIdPlan("upload"),
      timeoutMs: 2_000,
    })
    const chooser = await chooserPromise
    assert.equal(chooser.event, "filechooser")
    assert.equal(chooser.multiple, true)
    await run("playwright.fileChooser.setFiles", {
      eventID: chooser.eventID,
      files: [uploadPath],
      timeoutMs: 2_000,
    })
    assert.deepEqual(await page.locator("#upload").evaluate((element) => ({
      count: element.files.length,
      name: element.files[0]?.name,
    })), { count: 1, name: "approved-upload.txt" })
    await assert.rejects(
      run("playwright.fileChooser.setFiles", {
        eventID: chooser.eventID,
        files: [uploadPath],
        timeoutMs: 2_000,
      }),
      (error) => error.code === "EVENT_EXPIRED",
    )

    const downloadPromise = run("playwright.waitForEvent", {
      event: "download",
      timeoutMs: 2_000,
    })
    await run("playwright.locator.click", {
      plan: testIdPlan("download"),
      timeoutMs: 2_000,
    })
    const download = await downloadPromise
    assert.equal(download.event, "download")
    const downloaded = await run("playwright.download.path", {
      eventID: download.eventID,
      timeoutMs: 2_000,
    })
    assert.ok(downloaded.path)
    assert.equal(
      await readFile(downloaded.path, "utf8"),
      "anybox locator download",
    )
    await assert.rejects(
      run("playwright.download.path", {
        eventID: download.eventID,
        timeoutMs: 2_000,
      }),
      (error) => error.code === "EVENT_EXPIRED",
    )

    await run("playwright.locator.click", {
      plan: testIdPlan("go"),
      timeoutMs: 2_000,
    })
    assert.equal(await page.evaluate(() => window.executorClicks), 1)

    await page.evaluate(() => {
      const duplicate = document.createElement("button")
      duplicate.dataset.testid = "go"
      duplicate.textContent = "Duplicate"
      document.body.append(duplicate)
    })
    await assert.rejects(
      run("playwright.locator.click", {
        plan: testIdPlan("go"),
        timeoutMs: 500,
      }),
      (error) =>
        error.code === "LOCATOR_STRICT_VIOLATION"
        && error.retryable === false
        && error.details?.matchCount === 2,
    )
    await page.locator("button", { hasText: "Duplicate" })
      .evaluate((element) => element.remove())
    await assert.rejects(
      run("playwright.locator.textContent", {
        plan: testIdPlan("private-field"),
        timeoutMs: 500,
      }),
      (error) => {
        const details = JSON.stringify(error.details)
        return error.code === "LOCATOR_STRICT_VIOLATION"
          && error.details?.matchCount === 2
          && details.includes("[redacted]")
          && !details.includes("secret-token-123")
          && !details.includes("secret-token-456")
      },
    )

    const registeredNavigation = await run(
      "playwright.waitForNavigation",
      {
        mode: "register",
        waitUntil: "load",
        timeoutMs: 2_000,
      },
    )
    await page.evaluate(() => {
      location.hash = "same-document"
    })
    await run("playwright.waitForNavigation", {
      mode: "wait",
      waiterID: registeredNavigation.waiterID,
      timeoutMs: 2_000,
    })
    await run("playwright.waitForURL", {
      url: `${fixtureUrl}#same-document`,
      waitUntil: "load",
      timeoutMs: 2_000,
    })

    const privateSnapshot = await run("playwright.domSnapshot", {})
    assert.doesNotMatch(privateSnapshot.snapshot, /secret-token-123/u)
    assert.doesNotMatch(privateSnapshot.snapshot, /secret-token-456/u)
    assert.doesNotMatch(privateSnapshot.snapshot, /111111/u)
    assert.doesNotMatch(privateSnapshot.snapshot, /textarea-private-789/u)
    assert.doesNotMatch(
      privateSnapshot.snapshot,
      /contenteditable-private-abc/u,
    )
    const editableBox = await page.locator("#editable").boundingBox()
    assert.ok(editableBox)
    const editableInfo = await run("playwright.elementInfo", {
      x: editableBox.x + editableBox.width / 2,
      y: editableBox.y + editableBox.height / 2,
      includeNonInteractable: true,
    })
    assert.doesNotMatch(
      JSON.stringify(editableInfo),
      /contenteditable-private-abc/u,
    )
    const snapshot = await run("playwright.domSnapshot", {
      maxNodes: 5_000,
      maxChars: 64,
    })
    assert.equal(snapshot.truncated, true)
    assert.match(snapshot.snapshot, /truncated/u)

    mouseDispatches = 0
    mouseEvents = []
    failMouseAfterMove = true
    await assert.rejects(
      run("playwright.locator.click", {
        plan: testIdPlan("fault"),
        timeoutMs: 2_000,
      }),
      (error) =>
        error.code === "ACTION_OUTCOME_UNKNOWN"
        && error.retryable === false
        && error.details?.phase === "post-dispatch",
    )
    assert.equal(mouseDispatches, 3)
    assert.deepEqual(mouseEvents, [
      "mouseMoved",
      "mousePressed",
      "mouseReleased",
    ])
  } finally {
    executor?.resetPlaywrightExecutor()
    console.debug = originalDebug
    if (originalChrome === undefined) {
      delete globalThis.chrome
    } else {
      globalThis.chrome = originalChrome
    }
    await browser?.close()
    await closeServer(fixtureServer)
    await closeServer(crossOriginServer)
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
