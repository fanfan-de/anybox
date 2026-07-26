import { EventEmitter } from "node:events"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { WebContents } from "electron"
import { SemanticTokenInspectorSessionManager } from "./semantic-token-inspector"
import type { SemanticTokenInspectorEvent } from "../shared/semantic-token-inspector"

class FakeDebugger extends EventEmitter {
  attached = false
  attachedVersion: string | undefined
  commands: Array<{ method: string; params?: unknown }> = []
  responses = new Map<string, unknown>()
  failures = new Map<string, Error>()
  handlers = new Map<string, (params?: unknown) => unknown>()

  attach(version?: string) {
    this.attached = true
    this.attachedVersion = version
  }

  detach() {
    this.attached = false
  }

  isAttached() {
    return this.attached
  }

  async sendCommand(method: string, params?: unknown) {
    this.commands.push({ method, params })
    const failure = this.failures.get(method)
    if (failure) throw failure
    const handler = this.handlers.get(method)
    if (handler) return handler(params)
    if (method === "CSS.enable") {
      this.emit("message", {}, "CSS.styleSheetAdded", {
        header: {
          styleSheetId: "sheet-1",
          sourceURL: "settings.css",
        },
      })
    }
    return this.responses.get(method) ?? {}
  }
}

class FakeWebContents extends EventEmitter {
  readonly id: number
  readonly debugger = new FakeDebugger()
  destroyed = false
  devToolsOpened = false
  ignoreMenuShortcuts = false

  constructor(id = 7) {
    super()
    this.id = id
  }

  isDestroyed() {
    return this.destroyed
  }

  isDevToolsOpened() {
    return this.devToolsOpened
  }

  setIgnoreMenuShortcuts(ignore: boolean) {
    this.ignoreMenuShortcuts = ignore
  }
}

function asWebContents(value: FakeWebContents) {
  return value as unknown as WebContents
}

function installInspectionResponses(contents: FakeWebContents) {
  contents.debugger.responses.set("DOM.getNodeForLocation", { nodeId: 1, backendNodeId: 11 })
  contents.debugger.responses.set("DOM.describeNode", {
    node: {
      nodeId: 1,
      backendNodeId: 11,
      nodeType: 1,
      nodeName: "SPAN",
      localName: "span",
      attributes: ["class", "plugin-market-tag"],
    },
  })
  contents.debugger.responses.set("CSS.getLayersForNode", {})
  contents.debugger.responses.set("CSS.getMatchedStylesForNode", {
    matchedCSSRules: [
      {
        matchingSelectors: [0],
        rule: {
          styleSheetId: "sheet-1",
          origin: "regular",
          selectorList: {
            text: ".plugin-market-tag",
            selectors: [
              {
                text: ".plugin-market-tag",
                specificity: { a: 0, b: 1, c: 0 },
              },
            ],
          },
          style: {
            styleSheetId: "sheet-1",
            range: { startLine: 20, startColumn: 2 },
            cssProperties: [
              {
                name: "background-color",
                value: "var(--semantic-plugin-market-tag-surface)",
                parsedOk: true,
              },
            ],
          },
        },
      },
    ],
    inherited: [
      {
        matchedCSSRules: [
          {
            matchingSelectors: [0],
            rule: {
              styleSheetId: "sheet-1",
              origin: "regular",
              selectorList: {
                text: ":root",
                selectors: [
                  {
                    text: ":root",
                    specificity: { a: 0, b: 1, c: 0 },
                  },
                ],
              },
              style: {
                styleSheetId: "sheet-1",
                range: { startLine: 1, startColumn: 0 },
                cssProperties: [
                  {
                    name: "--semantic-plugin-market-tag-surface",
                    value: "var(--semantic-plugin-market-tag-surface-light)",
                    parsedOk: true,
                  },
                  {
                    name: "--semantic-plugin-market-tag-surface-light",
                    value: "#f2d6d6",
                    parsedOk: true,
                  },
                ],
              },
            },
          },
        ],
      },
    ],
  })
  contents.debugger.responses.set("CSS.getComputedStyleForNode", {
    computedStyle: [
      { name: "background-color", value: "rgb(242, 214, 214)" },
      { name: "color", value: "rgb(32, 32, 32)" },
      { name: "transition-duration", value: "0s" },
      { name: "animation-name", value: "none" },
    ],
  })
  contents.debugger.responses.set("DOM.getBoxModel", {
    model: {
      border: [10, 10, 110, 10, 110, 34, 10, 34],
    },
  })
}

describe("SemanticTokenInspectorSessionManager", () => {
  it("resolves Vite-injected style owner nodes to editable local CSS", async () => {
    const rendererRoot = await mkdtemp(path.join(os.tmpdir(), "anybox-inspector-"))
    const stylesRoot = path.join(rendererRoot, "styles")
    const cssPath = path.join(stylesRoot, "sample.css")
    const indexPath = path.join(stylesRoot, "index.css")
    await mkdir(stylesRoot, { recursive: true })
    await writeFile(
      cssPath,
      ".plugin-market-tag {\n  background-color: var(--semantic-plugin-market-tag-surface);\n}\n",
      "utf8",
    )
    await writeFile(indexPath, '@import "./sample.css";\n', "utf8")

    const manager = new SemanticTokenInspectorSessionManager(() => undefined, {
      rendererSourceRoot: rendererRoot,
    })
    const contents = new FakeWebContents()
    installInspectionResponses(contents)
    const matchedStyles = contents.debugger.responses.get("CSS.getMatchedStylesForNode") as {
      matchedCSSRules?: Array<{
        rule?: { style?: { cssProperties?: Array<Record<string, unknown>> } }
      }>
    }
    matchedStyles.matchedCSSRules?.[0]?.rule?.style?.cssProperties?.push(
      ...Array.from({ length: 4_200 }, (_, index) => ({
        name: `--unrelated-${index}`,
        value: `${index}`,
        parsedOk: true,
      })),
    )
    contents.debugger.handlers.set("CSS.enable", () => {
      contents.debugger.emit("message", {}, "CSS.styleSheetAdded", {
        header: {
          styleSheetId: "sheet-1",
          sourceURL: "",
          ownerNode: 99,
        },
      })
      return {}
    })
    contents.debugger.handlers.set("DOM.describeNode", (params) => {
      if ((params as { backendNodeId?: number } | undefined)?.backendNodeId === 99) {
        return {
          node: {
            backendNodeId: 99,
            nodeType: 1,
            nodeName: "STYLE",
            localName: "style",
            attributes: ["type", "text/css", "data-vite-dev-id", "/src/styles/index.css?t=1"],
          },
        }
      }
      return {
        node: {
          nodeId: 1,
          backendNodeId: 11,
          nodeType: 1,
          nodeName: "SPAN",
          localName: "span",
          attributes: ["class", "plugin-market-tag"],
        },
      }
    })

    try {
      await manager.start(asWebContents(contents))
      const result = await manager.inspect(asWebContents(contents), {
        x: 20,
        y: 20,
        ancestorDepth: 0,
        requestID: 2,
        resolvedColorMode: "light",
      })

      expect(result).toMatchObject({
        status: "ok",
        inspection: {
          properties: expect.arrayContaining([
            expect.objectContaining({
              property: "background-color",
              source: expect.objectContaining({
                sourceURL: cssPath.replaceAll("\\", "/"),
                editRef: expect.any(String),
              }),
            }),
          ]),
        },
      })

      const firstEditRef = result.status === "ok"
        ? result.inspection.properties.find((property) => property.property === "background-color")
          ?.source?.editRef
        : undefined
      const repeatedResult = await manager.inspect(asWebContents(contents), {
        x: 20,
        y: 20,
        ancestorDepth: 0,
        requestID: 3,
        resolvedColorMode: "light",
      })
      const repeatedEditRef = repeatedResult.status === "ok"
        ? repeatedResult.inspection.properties.find(
            (property) => property.property === "background-color",
          )?.source?.editRef
        : undefined
      expect(firstEditRef).toEqual(expect.any(String))
      expect(repeatedEditRef).toBe(firstEditRef)
    } finally {
      manager.stop(asWebContents(contents))
      await rm(rendererRoot, { recursive: true, force: true })
    }
  })

  it("attaches, inspects a token source, and stops cleanly", async () => {
    const events: SemanticTokenInspectorEvent[] = []
    const manager = new SemanticTokenInspectorSessionManager((_contents, event) => events.push(event))
    const contents = new FakeWebContents()
    installInspectionResponses(contents)

    await expect(manager.start(asWebContents(contents))).resolves.toMatchObject({
      status: "active",
      authoring: {
        status: "read-only",
        reason: "source-root-unavailable",
      },
    })
    expect(contents.debugger.attachedVersion).toBe("1.3")
    expect(contents.debugger.commands.slice(0, 3).map((entry) => entry.method)).toEqual([
      "DOM.enable",
      "CSS.enable",
      "DOM.getDocument",
    ])

    contents.emit("before-input-event", {}, {
      type: "keyDown",
      key: "Alt",
      code: "AltLeft",
      alt: true,
    })
    expect(contents.ignoreMenuShortcuts).toBe(true)
    contents.emit("before-input-event", {}, {
      type: "keyUp",
      key: "Alt",
      code: "AltLeft",
      alt: false,
    })
    expect(contents.ignoreMenuShortcuts).toBe(false)
    contents.emit("before-input-event", {}, {
      type: "keyDown",
      key: "Alt",
      code: "AltLeft",
      alt: true,
      isAutoRepeat: true,
    })

    const result = await manager.inspect(asWebContents(contents), {
      x: 20,
      y: 20,
      ancestorDepth: 0,
      requestID: 3,
      resolvedColorMode: "light",
    })
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.inspection.target).toMatchObject({
        tagName: "SPAN",
        classes: ["plugin-market-tag"],
      })
      expect(result.inspection.properties.find((property) => property.property === "background-color")).toMatchObject({
        diagnosis: "semantic-runtime",
        severity: "pass",
        source: {
          selector: ".plugin-market-tag",
          sourceURL: "settings.css",
          line: 21,
          column: 3,
        },
      })
    }

    expect(manager.stop(asWebContents(contents))).toEqual({ status: "inactive" })
    expect(contents.debugger.isAttached()).toBe(false)
    expect(contents.ignoreMenuShortcuts).toBe(false)
    expect(events).toEqual([{ type: "pin-current" }])
  })

  it("blocks activation while DevTools is open or another debugger owns the target", async () => {
    const manager = new SemanticTokenInspectorSessionManager(() => undefined)
    const devToolsContents = new FakeWebContents()
    devToolsContents.devToolsOpened = true
    await expect(manager.start(asWebContents(devToolsContents))).resolves.toMatchObject({
      status: "blocked",
      reason: "devtools-open",
    })

    const attachedContents = new FakeWebContents(8)
    attachedContents.debugger.attached = true
    await expect(manager.start(asWebContents(attachedContents))).resolves.toMatchObject({
      status: "blocked",
      reason: "debugger-in-use",
    })
  })

  it("never attaches the debugger in packaged builds", async () => {
    const manager = new SemanticTokenInspectorSessionManager(() => undefined, {
      packaged: true,
    })
    const contents = new FakeWebContents()

    await expect(manager.start(asWebContents(contents))).resolves.toMatchObject({
      status: "blocked",
      reason: "packaged",
    })
    expect(contents.debugger.isAttached()).toBe(false)
  })

  it("emits a detach event and releases the session when DevTools opens", async () => {
    const events: SemanticTokenInspectorEvent[] = []
    const manager = new SemanticTokenInspectorSessionManager((_contents, event) => events.push(event))
    const contents = new FakeWebContents()

    await manager.start(asWebContents(contents))
    contents.devToolsOpened = true
    contents.emit("devtools-opened")

    expect(events).toEqual([
      {
        type: "detached",
        reason: "devtools-opened",
        message: "Semantic Token Inspector stopped because DevTools was opened.",
      },
    ])
    expect(contents.debugger.isAttached()).toBe(false)
    await expect(manager.inspect(asWebContents(contents), {
      x: 1,
      y: 1,
      ancestorDepth: 0,
      requestID: 4,
      resolvedColorMode: "light",
    })).resolves.toMatchObject({
      status: "unavailable",
      reason: "inactive",
    })
  })

  it("reports unsupported protocol commands without leaving the debugger attached", async () => {
    const manager = new SemanticTokenInspectorSessionManager(() => undefined)
    const contents = new FakeWebContents()
    contents.debugger.failures.set("CSS.enable", new Error("'CSS.enable' wasn't found"))

    await expect(manager.start(asWebContents(contents))).resolves.toMatchObject({
      status: "blocked",
      reason: "protocol-unsupported",
    })
    expect(contents.debugger.isAttached()).toBe(false)
  })

  it("validates coordinates and ancestor depth before issuing CDP commands", async () => {
    const manager = new SemanticTokenInspectorSessionManager(() => undefined)
    const contents = new FakeWebContents()
    await manager.start(asWebContents(contents))
    const commandCount = contents.debugger.commands.length

    await expect(manager.inspect(asWebContents(contents), {
      x: -1,
      y: 1,
      ancestorDepth: 9,
      requestID: 5,
      resolvedColorMode: "light",
    })).resolves.toMatchObject({
      status: "unavailable",
      reason: "protocol-error",
    })
    expect(contents.debugger.commands).toHaveLength(commandCount)
  })

  it("walks to a requested DOM ancestor without exposing node IDs to the renderer", async () => {
    const manager = new SemanticTokenInspectorSessionManager(() => undefined)
    const contents = new FakeWebContents()
    installInspectionResponses(contents)
    contents.debugger.handlers.set("DOM.describeNode", (params) => {
      const nodeId = (params as { nodeId?: number } | undefined)?.nodeId
      if (nodeId === 2) {
        return {
          node: {
            nodeId: 2,
            backendNodeId: 12,
            nodeType: 1,
            nodeName: "DIV",
            localName: "div",
            attributes: ["class", "plugin-card"],
          },
        }
      }
      return {
        node: {
          nodeId: 1,
          backendNodeId: 11,
          nodeType: 1,
          nodeName: "SPAN",
          localName: "span",
          parentId: 2,
          attributes: ["class", "plugin-market-tag"],
        },
      }
    })
    await manager.start(asWebContents(contents))

    const result = await manager.inspect(asWebContents(contents), {
      x: 20,
      y: 20,
      ancestorDepth: 1,
      requestID: 6,
      resolvedColorMode: "light",
    })

    expect(result).toMatchObject({
      status: "ok",
      inspection: {
        target: {
          tagName: "DIV",
          classes: ["plugin-card"],
        },
      },
    })
    expect(contents.debugger.commands).toContainEqual({
      method: "CSS.getMatchedStylesForNode",
      params: { nodeId: 2 },
    })
  })
})
