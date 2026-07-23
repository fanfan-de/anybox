// Chrome extension wire types are private to the Chrome plugin package.
import { z } from "zod"

export const BROWSER_EXTENSION_PROTOCOL_VERSION = 1 as const
export const ANYBOX_CHROME_EXTENSION_ID = "mgpdddgemohfmonbnpehohhlbndakdpg"
export const ANYBOX_CHROME_NATIVE_HOST_NAME = "com.anybox.browser"

export const BrowserExtensionCommandMethod = z.enum([
  "browser.nameSession",
  "tabs.list",
  "tabs.listUser",
  "tabs.open",
  "tabs.claim",
  "tabs.activate",
  "tabs.goto",
  "tabs.back",
  "tabs.forward",
  "tabs.reload",
  "tabs.close",
  "tabs.release",
  "tabs.markDeliverable",
  "tabs.markHandoff",
  "tabs.finalize",
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
  "playwright.domSnapshot",
  "playwright.elementInfo",
  "playwright.locator.count",
  "playwright.locator.allTextContents",
  "playwright.locator.textContent",
  "playwright.locator.innerText",
  "playwright.locator.inputValue",
  "playwright.locator.getAttribute",
  "playwright.locator.isVisible",
  "playwright.locator.isEnabled",
  "playwright.locator.waitFor",
  "playwright.locator.click",
  "playwright.locator.dblclick",
  "playwright.locator.fill",
  "playwright.locator.type",
  "playwright.locator.press",
  "playwright.locator.selectOption",
  "playwright.locator.setChecked",
  "playwright.waitForNavigation",
  "playwright.waitForLoadState",
  "playwright.waitForURL",
  "playwright.waitForEvent",
  "playwright.download.path",
  "playwright.fileChooser.setFiles",
  "page.executeScript",
  "cdp.send",
])
export type BrowserExtensionCommandMethod = z.infer<typeof BrowserExtensionCommandMethod>

export const BrowserExtensionCapabilities = z.object({
  contractVersion: z.number().int().positive(),
  commands: z.array(z.string().min(1).max(128)).max(256),
}).strict()
export type BrowserExtensionCapabilities = z.infer<
  typeof BrowserExtensionCapabilities
>

export const BrowserExtensionCommandContext = z.object({
  sessionID: z.string().trim().min(1).max(256).optional(),
  turnID: z.string().trim().min(1).max(256).optional(),
  messageID: z.string().trim().min(1).max(256).optional(),
  toolCallID: z.string().trim().min(1).max(256).optional(),
  browserID: z.string().trim().min(1).max(256).optional(),
  extensionInstanceID: z.string().trim().min(1).max(256).optional(),
}).strict()
export type BrowserExtensionCommandContext = z.infer<typeof BrowserExtensionCommandContext>

export const BrowserExtensionHelloMessage = z.object({
  type: z.literal("hello"),
  protocolVersion: z.literal(BROWSER_EXTENSION_PROTOCOL_VERSION),
  extensionInstanceID: z.string().min(1),
  extensionID: z.string().min(1),
  version: z.string().min(1),
  capabilities: BrowserExtensionCapabilities,
  lastTransportError: z.string().min(1).optional(),
}).strict()
export type BrowserExtensionHelloMessage = z.infer<typeof BrowserExtensionHelloMessage>

export const BrowserExtensionResultMessage = z.discriminatedUnion("ok", [
  z.object({
    type: z.literal("result"),
    commandID: z.string().min(1),
    ok: z.literal(true),
    data: z.unknown(),
  }).strict(),
  z.object({
    type: z.literal("result"),
    commandID: z.string().min(1),
    ok: z.literal(false),
    error: z.string(),
    code: z.string().min(1).optional(),
    retryable: z.boolean().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
])
export type BrowserExtensionResultMessage = z.infer<typeof BrowserExtensionResultMessage>

export const BrowserExtensionEventMessage = z.object({
  type: z.literal("event"),
  event: z.string().min(1),
  data: z.unknown().optional(),
})
export type BrowserExtensionEventMessage = z.infer<typeof BrowserExtensionEventMessage>

export const BrowserExtensionPongMessage = z.object({
  type: z.literal("pong"),
  nonce: z.string().optional(),
})
export type BrowserExtensionPongMessage = z.infer<typeof BrowserExtensionPongMessage>

export const BrowserExtensionClientMessage = z.union([
  BrowserExtensionHelloMessage,
  BrowserExtensionResultMessage,
  BrowserExtensionEventMessage,
  BrowserExtensionPongMessage,
])
export type BrowserExtensionClientMessage = z.infer<typeof BrowserExtensionClientMessage>

export const BrowserExtensionCommandMessage = z.object({
  type: z.literal("command"),
  commandID: z.string().min(1),
  contractVersion: z.literal(4),
  method: BrowserExtensionCommandMethod,
  params: z.unknown().optional(),
  context: BrowserExtensionCommandContext.optional(),
})
export type BrowserExtensionCommandMessage = z.infer<typeof BrowserExtensionCommandMessage>

export const BrowserExtensionHelloAckMessage = z.object({
  type: z.literal("helloAck"),
  protocolVersion: z.literal(BROWSER_EXTENSION_PROTOCOL_VERSION),
  contractVersion: z.literal(4),
  browserID: z.string().min(1),
  extensionInstanceID: z.string().min(1),
  heartbeatIntervalMs: z.number().int().positive(),
  heartbeatTimeoutMs: z.number().int().positive(),
  downloadDirectory: z.string().trim().min(1).max(32_768).optional(),
}).strict()
export type BrowserExtensionHelloAckMessage = z.infer<
  typeof BrowserExtensionHelloAckMessage
>

export const BrowserExtensionPingMessage = z.object({
  type: z.literal("ping"),
  nonce: z.string().optional(),
})
export type BrowserExtensionPingMessage = z.infer<typeof BrowserExtensionPingMessage>

export const BrowserExtensionServerMessage = z.union([
  BrowserExtensionHelloAckMessage,
  BrowserExtensionCommandMessage,
  BrowserExtensionPingMessage,
])
export type BrowserExtensionServerMessage = z.infer<typeof BrowserExtensionServerMessage>

export const BrowserExtensionTabSummary = z.object({
  id: z.number().int().positive(),
  windowId: z.number().int().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  active: z.boolean().optional(),
  lease: z.object({
    source: z.enum(["user", "agent"]),
    sessionID: z.string().min(1),
    turnID: z.string().min(1),
    state: z.enum(["active", "handoff"]),
    mark: z.enum(["deliverable", "handoff"]).optional(),
    extensionInstanceID: z.string().min(1),
    expiresAt: z.number().int().positive(),
  }).strict().optional(),
}).strict()
export type BrowserExtensionTabSummary = z.infer<typeof BrowserExtensionTabSummary>

export const BrowserExtensionTabsListResult = z.object({
  tabs: z.array(BrowserExtensionTabSummary),
}).strict()
export type BrowserExtensionTabsListResult = z.infer<typeof BrowserExtensionTabsListResult>

export const BrowserExtensionSnapshotResult = z.object({
  tabId: z.number().int().positive(),
  url: z.string().optional(),
  title: z.string().optional(),
  text: z.string(),
  links: z.array(z.object({ text: z.string(), href: z.string() }).strict()),
  buttons: z.array(z.object({ text: z.string() }).strict()),
  inputs: z.array(z.object({
    name: z.string().optional(),
    type: z.string().optional(),
    placeholder: z.string().optional(),
    value: z.string().optional(),
    sensitive: z.boolean().optional(),
  }).strict()),
  truncated: z.boolean(),
}).strict()
export type BrowserExtensionSnapshotResult = z.infer<typeof BrowserExtensionSnapshotResult>

export const BrowserExtensionElementRect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
}).strict()
export type BrowserExtensionElementRect = z.infer<typeof BrowserExtensionElementRect>

export const BrowserExtensionInteractiveElement = z.object({
  elementId: z.string().min(1),
  role: z.string().optional(),
  tag: z.string(),
  name: z.string().optional(),
  text: z.string().optional(),
  href: z.string().optional(),
  type: z.string().optional(),
  placeholder: z.string().optional(),
  value: z.string().optional(),
  disabled: z.boolean(),
  visible: z.boolean(),
  sensitive: z.boolean().optional(),
  rect: BrowserExtensionElementRect,
}).strict()
export type BrowserExtensionInteractiveElement = z.infer<typeof BrowserExtensionInteractiveElement>

export const BrowserExtensionInteractiveSnapshotResult = z.object({
  tabId: z.number().int().positive(),
  url: z.string().optional(),
  title: z.string().optional(),
  elements: z.array(BrowserExtensionInteractiveElement),
  truncated: z.boolean(),
}).strict()
export type BrowserExtensionInteractiveSnapshotResult = z.infer<typeof BrowserExtensionInteractiveSnapshotResult>

export type BrowserExtensionDomNode = {
  relation?: "child" | "shadowRoot" | "contentDocument" | "templateContent" | "pseudoElement"
  nodeId?: number
  backendNodeId?: number
  nodeType: number
  nodeName: string
  localName?: string
  nodeValue?: string
  attributes?: Record<string, string>
  children?: BrowserExtensionDomNode[]
}

export const BrowserExtensionDomNode: z.ZodType<BrowserExtensionDomNode> = z.lazy(() => z.object({
  relation: z.enum(["child", "shadowRoot", "contentDocument", "templateContent", "pseudoElement"]).optional(),
  nodeId: z.number().int().optional(),
  backendNodeId: z.number().int().optional(),
  nodeType: z.number().int(),
  nodeName: z.string(),
  localName: z.string().optional(),
  nodeValue: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  children: z.array(BrowserExtensionDomNode).optional(),
}).strict())

export const BrowserExtensionDomTreeResult = z.object({
  tabId: z.number().int().positive(),
  url: z.string().optional(),
  title: z.string().optional(),
  root: BrowserExtensionDomNode,
  nodeCount: z.number().int().nonnegative(),
  maxDepth: z.number().int().nonnegative(),
  maxNodes: z.number().int().positive(),
  truncated: z.boolean(),
}).strict()
export type BrowserExtensionDomTreeResult = z.infer<typeof BrowserExtensionDomTreeResult>

export const BrowserExtensionAccessibilityNode = z.object({
  nodeId: z.string().min(1),
  parentId: z.string().min(1).optional(),
  backendDOMNodeId: z.number().int().optional(),
  ignored: z.boolean(),
  ignoredReasons: z.array(z.string()).optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  value: z.unknown().optional(),
  description: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  childIds: z.array(z.string()).optional(),
}).strict()
export type BrowserExtensionAccessibilityNode = z.infer<typeof BrowserExtensionAccessibilityNode>

export const BrowserExtensionAccessibilityTreeResult = z.object({
  tabId: z.number().int().positive(),
  url: z.string().optional(),
  title: z.string().optional(),
  rootNodeId: z.string().optional(),
  nodes: z.array(BrowserExtensionAccessibilityNode),
  nodeCount: z.number().int().nonnegative(),
  maxDepth: z.number().int().nonnegative(),
  maxNodes: z.number().int().positive(),
  includeIgnored: z.boolean(),
  truncated: z.boolean(),
}).strict()
export type BrowserExtensionAccessibilityTreeResult = z.infer<typeof BrowserExtensionAccessibilityTreeResult>

export const BrowserExtensionScreenshotResult = z.object({
  tabId: z.number().int().positive(),
  mime: z.literal("image/png"),
  data: z.string().min(1),
}).strict()
export type BrowserExtensionScreenshotResult = z.infer<typeof BrowserExtensionScreenshotResult>

export const BrowserExtensionElementActionResult = z.object({
  tabId: z.number().int().positive(),
  elementId: z.string().min(1),
  url: z.string().optional(),
  title: z.string().optional(),
}).strict()
export type BrowserExtensionElementActionResult = z.infer<typeof BrowserExtensionElementActionResult>

export const BrowserExtensionFillResult = BrowserExtensionElementActionResult.extend({
  textLength: z.number().int().nonnegative(),
}).strict()
export type BrowserExtensionFillResult = z.infer<typeof BrowserExtensionFillResult>

export const BrowserExtensionWaitForResult = z.object({
  tabId: z.number().int().positive(),
  url: z.string().optional(),
  title: z.string().optional(),
  matched: z.boolean(),
  reason: z.string().optional(),
}).strict()
export type BrowserExtensionWaitForResult = z.infer<typeof BrowserExtensionWaitForResult>

export const BrowserExtensionClickResult = z.object({
  tabId: z.number().int().positive(),
  x: z.number().finite(),
  y: z.number().finite(),
  button: z.enum(["left", "right", "middle"]),
}).strict()
export type BrowserExtensionClickResult = z.infer<typeof BrowserExtensionClickResult>

export const BrowserExtensionTypeResult = z.object({
  tabId: z.number().int().positive(),
  textLength: z.number().int().nonnegative(),
}).strict()
export type BrowserExtensionTypeResult = z.infer<typeof BrowserExtensionTypeResult>

export const BrowserExtensionScrollPosition = z.object({
  scrollX: z.number().finite(),
  scrollY: z.number().finite(),
}).strict()
export type BrowserExtensionScrollPosition = z.infer<typeof BrowserExtensionScrollPosition>

export const BrowserExtensionScrollResult = z.object({
  tabId: z.number().int().positive(),
  scrollX: z.number().finite(),
  scrollY: z.number().finite(),
  position: BrowserExtensionScrollPosition,
}).strict()
export type BrowserExtensionScrollResult = z.infer<typeof BrowserExtensionScrollResult>

export const BrowserExtensionTabsReleaseResult = z.object({
  tabId: z.number().int().positive(),
  released: z.boolean(),
}).strict()
export type BrowserExtensionTabsReleaseResult = z.infer<typeof BrowserExtensionTabsReleaseResult>

export const BrowserExtensionTabsCloseResult = z.object({
  tabId: z.number().int().positive(),
  closed: z.boolean(),
}).strict()
export type BrowserExtensionTabsCloseResult = z.infer<typeof BrowserExtensionTabsCloseResult>

export const BrowserExtensionNameSessionResult = z.object({
  name: z.string().trim().min(1).max(128),
}).strict()
export type BrowserExtensionNameSessionResult = z.infer<
  typeof BrowserExtensionNameSessionResult
>

export const BrowserExtensionTabsMarkDeliverableResult = z.object({
  tabId: z.number().int().positive(),
  state: z.literal("deliverable"),
}).strict()
export type BrowserExtensionTabsMarkDeliverableResult = z.infer<
  typeof BrowserExtensionTabsMarkDeliverableResult
>

export const BrowserExtensionTabsMarkHandoffResult = z.object({
  tabId: z.number().int().positive(),
  state: z.literal("handoff"),
}).strict()
export type BrowserExtensionTabsMarkHandoffResult = z.infer<
  typeof BrowserExtensionTabsMarkHandoffResult
>

export const BrowserExtensionTabsFinalizeResult = z.object({
  sessionID: z.string().min(1),
  closedTabIds: z.array(z.number().int().positive()),
  releasedTabIds: z.array(z.number().int().positive()),
  deliverableTabIds: z.array(z.number().int().positive()),
  handoffTabIds: z.array(z.number().int().positive()),
  detachedTabIds: z.array(z.number().int().positive()),
}).strict()
export type BrowserExtensionTabsFinalizeResult = z.infer<
  typeof BrowserExtensionTabsFinalizeResult
>

const BrowserExtensionPlaywrightResultBase = {
  tabId: z.number().int().positive(),
  url: z.string().optional(),
  title: z.string().optional(),
  documentGeneration: z.number().int().nonnegative(),
} as const

export const BrowserExtensionPlaywrightDomSnapshotResult = z.object({
  ...BrowserExtensionPlaywrightResultBase,
  snapshot: z.string().max(1_000_000),
  nodeCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
}).strict()
export type BrowserExtensionPlaywrightDomSnapshotResult = z.infer<
  typeof BrowserExtensionPlaywrightDomSnapshotResult
>

export const BrowserExtensionPlaywrightElementInfoRect = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
}).strict()

export const BrowserExtensionPlaywrightElementInfo = z.object({
  ariaName: z.string().nullable().optional(),
  boundingBox: BrowserExtensionPlaywrightElementInfoRect.nullable().optional(),
  nodeId: z.number().int().nullable().optional(),
  preview: z.string().max(500),
  role: z.string().nullable().optional(),
  selector: z.object({
    candidates: z.array(z.string().max(2_000)).max(10),
    frameSelectors: z.array(z.string().max(2_000)).max(16).optional(),
    primary: z.string().max(2_000).nullable().optional(),
  }).strict(),
  tagName: z.string().max(128),
  testId: z.string().max(512).nullable().optional(),
  visibleText: z.string().max(2_000).nullable().optional(),
}).strict()
export type BrowserExtensionPlaywrightElementInfo = z.infer<
  typeof BrowserExtensionPlaywrightElementInfo
>

export const BrowserExtensionPlaywrightElementInfoResult = z.object({
  ...BrowserExtensionPlaywrightResultBase,
  elements: z.array(BrowserExtensionPlaywrightElementInfo).max(50),
}).strict()
export type BrowserExtensionPlaywrightElementInfoResult = z.infer<
  typeof BrowserExtensionPlaywrightElementInfoResult
>

export const BrowserExtensionPlaywrightLocatorCountResult = z.object({
  ...BrowserExtensionPlaywrightResultBase,
  count: z.number().int().nonnegative(),
}).strict()
export type BrowserExtensionPlaywrightLocatorCountResult = z.infer<
  typeof BrowserExtensionPlaywrightLocatorCountResult
>

export const BrowserExtensionPlaywrightLocatorTextsResult = z.object({
  ...BrowserExtensionPlaywrightResultBase,
  values: z.array(z.string().max(100_000)).max(5_000),
}).strict()
export type BrowserExtensionPlaywrightLocatorTextsResult = z.infer<
  typeof BrowserExtensionPlaywrightLocatorTextsResult
>

export const BrowserExtensionPlaywrightLocatorValueResult = z.object({
  ...BrowserExtensionPlaywrightResultBase,
  value: z.string().max(1_000_000).nullable(),
}).strict()
export type BrowserExtensionPlaywrightLocatorValueResult = z.infer<
  typeof BrowserExtensionPlaywrightLocatorValueResult
>

export const BrowserExtensionPlaywrightLocatorBooleanResult = z.object({
  ...BrowserExtensionPlaywrightResultBase,
  value: z.boolean(),
}).strict()
export type BrowserExtensionPlaywrightLocatorBooleanResult = z.infer<
  typeof BrowserExtensionPlaywrightLocatorBooleanResult
>

export const BrowserExtensionPlaywrightActionResult = z.object({
  ...BrowserExtensionPlaywrightResultBase,
  dispatched: z.boolean(),
  values: z.array(z.string().max(2_000)).max(100).optional(),
}).strict()
export type BrowserExtensionPlaywrightActionResult = z.infer<
  typeof BrowserExtensionPlaywrightActionResult
>

export const BrowserExtensionPlaywrightWaitResult = z.object({
  ...BrowserExtensionPlaywrightResultBase,
  matched: z.boolean(),
  state: z.string().max(128),
  waiterID: z.string().uuid().optional(),
}).strict()
export type BrowserExtensionPlaywrightWaitResult = z.infer<
  typeof BrowserExtensionPlaywrightWaitResult
>

export const BrowserExtensionPlaywrightEventResult = z.object({
  ...BrowserExtensionPlaywrightResultBase,
  event: z.enum(["download", "filechooser"]),
  eventID: z.string().uuid(),
  multiple: z.boolean().optional(),
}).strict()
export type BrowserExtensionPlaywrightEventResult = z.infer<
  typeof BrowserExtensionPlaywrightEventResult
>

export const BrowserExtensionPlaywrightDownloadPathResult = z.object({
  ...BrowserExtensionPlaywrightResultBase,
  path: z.string().nullable(),
}).strict()
export type BrowserExtensionPlaywrightDownloadPathResult = z.infer<
  typeof BrowserExtensionPlaywrightDownloadPathResult
>

export const BrowserExtensionPlaywrightFileChooserSetFilesResult = z.object({
  ...BrowserExtensionPlaywrightResultBase,
  fileCount: z.number().int().nonnegative(),
}).strict()
export type BrowserExtensionPlaywrightFileChooserSetFilesResult = z.infer<
  typeof BrowserExtensionPlaywrightFileChooserSetFilesResult
>
