// This contract belongs to the Chrome plugin and is not part of the Agent core.
import { z } from "zod"
import {
  BrowserExtensionAccessibilityTreeResult,
  BrowserExtensionClickResult,
  BrowserExtensionDomTreeResult,
  BrowserExtensionElementActionResult,
  BrowserExtensionFillResult,
  BrowserExtensionInteractiveSnapshotResult,
  BrowserExtensionPlaywrightActionResult,
  BrowserExtensionPlaywrightDomSnapshotResult,
  BrowserExtensionPlaywrightDownloadPathResult,
  BrowserExtensionPlaywrightElementInfoResult,
  BrowserExtensionPlaywrightEventResult,
  BrowserExtensionPlaywrightFileChooserSetFilesResult,
  BrowserExtensionPlaywrightLocatorBooleanResult,
  BrowserExtensionPlaywrightLocatorCountResult,
  BrowserExtensionPlaywrightLocatorTextsResult,
  BrowserExtensionPlaywrightLocatorValueResult,
  BrowserExtensionPlaywrightWaitResult,
  BrowserExtensionScreenshotResult,
  BrowserExtensionScrollResult,
  BrowserExtensionSnapshotResult,
  BrowserExtensionTabSummary,
  BrowserExtensionTabsCloseResult,
  BrowserExtensionTabsListResult,
  BrowserExtensionTabsFinalizeResult,
  BrowserExtensionTabsMarkDeliverableResult,
  BrowserExtensionTabsReleaseResult,
  BrowserExtensionTypeResult,
  BrowserExtensionWaitForResult,
} from "./browser-extension"
import {
  BrowserLocatorExpressionV3,
  BrowserLocatorPlanV3,
  BrowserPlaywrightDomSnapshotParams,
  BrowserPlaywrightElementInfoParams,
  BrowserPlaywrightEventHandleParams,
  BrowserPlaywrightFileChooserSetFilesParams,
  BrowserPlaywrightLocatorClickParams,
  BrowserPlaywrightLocatorCountParams,
  BrowserPlaywrightLocatorFillParams,
  BrowserPlaywrightLocatorGetAttributeParams,
  BrowserPlaywrightLocatorPressParams,
  BrowserPlaywrightLocatorReadParams,
  BrowserPlaywrightLocatorSelectOptionParams,
  BrowserPlaywrightLocatorSetCheckedParams,
  BrowserPlaywrightLocatorTypeParams,
  BrowserPlaywrightLocatorWaitForParams,
  BrowserPlaywrightRegexMatcherV3,
  BrowserPlaywrightSelectOptionDescriptor,
  BrowserPlaywrightSelectOptionInput,
  BrowserPlaywrightStringMatcherV3,
  BrowserPlaywrightTextMatcherV3,
  BrowserPlaywrightWaitForEventParams,
  BrowserPlaywrightWaitForLoadStateParams,
  BrowserPlaywrightWaitForNavigationParams,
  BrowserPlaywrightWaitForURLParams,
  PLAYWRIGHT_DOM_SNAPSHOT_MAX_CHARS,
  PLAYWRIGHT_DOM_SNAPSHOT_MAX_NODES,
  PLAYWRIGHT_LOCATOR_MAX_FRAME_DEPTH,
  PLAYWRIGHT_LOCATOR_MAX_NODES,
  PLAYWRIGHT_LOCATOR_MAX_SERIALIZED_BYTES,
  PLAYWRIGHT_LOCATOR_MAX_TEXT_CHARS,
  PLAYWRIGHT_LOCATOR_MAX_TIMEOUT_MS,
} from "./playwright-contract"

export {
  BrowserLocatorExpressionV3,
  BrowserLocatorPlanV3,
  BrowserPlaywrightRegexMatcherV3,
  BrowserPlaywrightSelectOptionDescriptor,
  BrowserPlaywrightSelectOptionInput,
  BrowserPlaywrightStringMatcherV3,
  BrowserPlaywrightTextMatcherV3,
  PLAYWRIGHT_DOM_SNAPSHOT_MAX_CHARS,
  PLAYWRIGHT_DOM_SNAPSHOT_MAX_NODES,
  PLAYWRIGHT_LOCATOR_MAX_FRAME_DEPTH,
  PLAYWRIGHT_LOCATOR_MAX_NODES,
  PLAYWRIGHT_LOCATOR_MAX_SERIALIZED_BYTES,
  PLAYWRIGHT_LOCATOR_MAX_TEXT_CHARS,
  PLAYWRIGHT_LOCATOR_MAX_TIMEOUT_MS,
}
export type {
  BrowserLocatorExpressionV3 as BrowserLocatorExpressionV3Type,
  BrowserLocatorPlanV3 as BrowserLocatorPlanV3Type,
  BrowserPlaywrightTextMatcherV3 as BrowserPlaywrightTextMatcherV3Type,
} from "./playwright-contract"

export const BROWSER_CONTRACT_VERSION = 3 as const
export const BROWSER_CONTRACT_SUPPORTED_VERSIONS = [
  BROWSER_CONTRACT_VERSION,
] as const
export const BrowserContractVersion = z.literal(BROWSER_CONTRACT_VERSION)
export type BrowserContractVersion = z.infer<typeof BrowserContractVersion>

export const BROWSER_CONTRACT_COMMAND_METHODS = [
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
] as const

export const BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS = [
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
] as const
export type BrowserContractV3PlaywrightCommandMethod =
  (typeof BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS)[number]

export const BrowserContractCommandMethod = z.enum(
  BROWSER_CONTRACT_COMMAND_METHODS,
)
export type BrowserContractCommandMethod = z.infer<
  typeof BrowserContractCommandMethod
>

export const BROWSER_CONTRACT_ERROR_CODES = [
  "CONTRACT_VERSION_UNSUPPORTED",
  "COMMAND_NOT_SUPPORTED",
  "INVALID_COMMAND_PARAMS",
  "INVALID_COMMAND_RESULT",
  "BACKEND_UNAVAILABLE",
  "NATIVE_HOST_INSTALL_FAILED",
  "CAPABILITY_UNAVAILABLE",
  "PERMISSION_DENIED",
  "APPROVAL_REQUIRED",
  "AUTHORIZATION_INVALID",
  "AUTHORIZATION_EXPIRED",
  "AUTHORIZATION_REPLAYED",
  "BACKEND_UPDATE_REQUIRED",
  "SESSION_REQUIRED",
  "SESSION_ENDED",
  "TURN_ENDED",
  "TAB_NOT_FOUND",
  "TAB_NOT_OWNED",
  "TAB_CLAIM_REQUIRED",
  "LEASE_EXPIRED",
  "DEADLINE_EXCEEDED",
  "CANCELLED",
  "COMMAND_FAILED",
  "LOCATOR_PARSE_ERROR",
  "LOCATOR_NOT_FOUND",
  "LOCATOR_STRICT_VIOLATION",
  "LOCATOR_NOT_ACTIONABLE",
  "STALE_DOCUMENT",
  "FRAME_DETACHED",
  "ACTION_OUTCOME_UNKNOWN",
  "EVENT_EXPIRED",
] as const

export const BrowserContractErrorCode = z.enum(
  BROWSER_CONTRACT_ERROR_CODES,
)
export type BrowserContractErrorCode = z.infer<
  typeof BrowserContractErrorCode
>

export const BrowserContractError = z.object({
  code: BrowserContractErrorCode,
  message: z.string().min(1),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict()
export type BrowserContractError = z.infer<typeof BrowserContractError>

export class BrowserContractValidationError extends Error {
  constructor(
    readonly code:
      | "COMMAND_NOT_SUPPORTED"
      | "INVALID_COMMAND_PARAMS"
      | "INVALID_COMMAND_RESULT",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "BrowserContractValidationError"
  }
}

const RequiredTabID = z.number().int().positive()
const MouseButton = z.enum(["left", "right", "middle"])
const RequiredContextID = z.string().trim().min(1).max(256)

export const BrowserCommandExecutionContext = z.object({
  sessionID: RequiredContextID,
  turnID: RequiredContextID,
  messageID: RequiredContextID,
  toolCallID: RequiredContextID,
  browserID: RequiredContextID,
  extensionInstanceID: RequiredContextID.optional(),
}).strict()
export type BrowserCommandExecutionContext = z.infer<
  typeof BrowserCommandExecutionContext
>

export const BrowserAuthorizationReceipt = z.object({
  value: z.string().trim().min(32).max(16_384),
}).strict()
export type BrowserAuthorizationReceipt = z.infer<
  typeof BrowserAuthorizationReceipt
>

export const BrowserAuthorizationChallenge = z.object({
  grantID: z.string().trim().min(1).max(256),
  challengeID: z.string().uuid(),
  nonce: z.string().trim().min(16).max(256),
  method: BrowserContractCommandMethod,
  security: z.string().trim().min(1).max(128),
  permissionAction: z.enum(["allow", "ask", "deny"]),
  risk: z.enum(["low", "medium", "high", "critical"]),
  rationale: z.string().trim().min(1).max(500),
  sessionID: RequiredContextID,
  turnID: RequiredContextID,
  messageID: RequiredContextID,
  toolCallID: RequiredContextID,
  browserID: RequiredContextID,
  extensionInstanceID: RequiredContextID,
  origin: z.string().trim().min(1).max(2_048),
  tabId: RequiredTabID.optional(),
  tabTitle: z.string().max(200).optional(),
  sensitive: z.boolean(),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
}).strict()
export type BrowserAuthorizationChallenge = z.infer<
  typeof BrowserAuthorizationChallenge
>

const BrowserTargetUrl = z.string()
  .regex(
    /^(?!\s*(?:[jJ][aA][vV][aA][sS][cC][rR][iI][pP][tT]|[dD][aA][tT][aA]|[vV][bB][sS][cC][rR][iI][pP][tT]):)/,
    "Executable URL schemes are not allowed by the Browser Contract.",
  )
  .url()
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol.toLowerCase()
      return !["javascript:", "data:", "vbscript:"].includes(protocol)
    } catch {
      return false
    }
  }, {
    message: "Executable URL schemes are not allowed by the Browser Contract.",
  }).describe(
    "Absolute browser URL. javascript:, data:, and vbscript: schemes are forbidden.",
  )

export const BrowserTabsListParams = z.object({}).strict()
export const BrowserTabsListUserParams = z.object({}).strict()

export const BrowserTabsOpenParams = z.object({
  url: BrowserTargetUrl,
  active: z.boolean().optional(),
}).strict()

export const BrowserTabsActivateParams = z.object({
  tabId: RequiredTabID,
}).strict()

export const BrowserTabsGotoParams = z.object({
  tabId: RequiredTabID,
  url: BrowserTargetUrl,
}).strict()

export const BrowserTabsBackParams = z.object({
  tabId: RequiredTabID,
}).strict()

export const BrowserTabsForwardParams = z.object({
  tabId: RequiredTabID,
}).strict()

export const BrowserTabsReloadParams = z.object({
  tabId: RequiredTabID,
}).strict()

export const BrowserTabsCloseParams = z.object({
  tabId: RequiredTabID,
}).strict()

export const BrowserTabsReleaseParams = z.object({
  tabId: RequiredTabID,
}).strict()

export const BrowserTabsClaimParams = z.object({
  tabId: RequiredTabID,
}).strict()

export const BrowserTabsMarkDeliverableParams = z.object({
  tabId: RequiredTabID,
}).strict()

export const BrowserTabsFinalizeParams = z.object({
  reason: z.enum([
    "turn-end",
    "session-end",
    "agent-terminated",
    "node-repl-reset",
    "native-disconnect",
    "lease-timeout",
    "manual",
  ]).optional(),
}).strict()

export const BrowserPageSnapshotParams = z.object({
  tabId: RequiredTabID,
  maxTextChars: z.number().int().positive().max(100_000).optional(),
}).strict()

export const BrowserPageInteractiveSnapshotParams = z.object({
  tabId: RequiredTabID,
  maxElements: z.number().int().positive().max(500).optional(),
}).strict()

export const BrowserPageDomTreeParams = z.object({
  tabId: RequiredTabID,
  maxDepth: z.number().int().min(0).max(20).optional(),
  maxNodes: z.number().int().positive().max(5_000).optional(),
  pierce: z.boolean().optional(),
  includeText: z.boolean().optional(),
  includeAttributes: z.boolean().optional(),
}).strict()

export const BrowserPageAccessibilityTreeParams = z.object({
  tabId: RequiredTabID,
  maxDepth: z.number().int().min(0).max(30).optional(),
  maxNodes: z.number().int().positive().max(5_000).optional(),
  includeIgnored: z.boolean().optional(),
}).strict()

export const BrowserPageScreenshotParams = z.object({
  tabId: RequiredTabID,
  fullPage: z.boolean().optional(),
}).strict()

export const BrowserPageClickParams = z.object({
  tabId: RequiredTabID,
  x: z.number().finite(),
  y: z.number().finite(),
  button: MouseButton.optional(),
}).strict()

export const BrowserPageClickElementParams = z.object({
  tabId: RequiredTabID,
  elementId: z.string().min(1),
  elementName: z.string().optional(),
  role: z.string().optional(),
  button: MouseButton.optional(),
}).strict()

export const BrowserPageFillParams = z.object({
  tabId: RequiredTabID,
  elementId: z.string().min(1),
  text: z.string(),
  elementName: z.string().optional(),
  sensitive: z.boolean().optional(),
}).strict()

export const BrowserPageTypeParams = z.object({
  tabId: RequiredTabID,
  text: z.string().min(1),
  sensitive: z.boolean().optional(),
}).strict()

export const BrowserPageScrollParams = z.object({
  tabId: RequiredTabID,
  scrollX: z.number().finite().optional(),
  scrollY: z.number().finite().optional(),
}).strict()

const NonBlankWaitString = z.string()
  .regex(/\S/, "Browser wait conditions cannot contain only whitespace.")
  .trim()
  .min(1)

const BrowserPageWaitForParamFields = {
  tabId: RequiredTabID,
  text: NonBlankWaitString.optional(),
  urlIncludes: NonBlankWaitString.optional(),
  selector: NonBlankWaitString.optional(),
  elementId: NonBlankWaitString.optional(),
  timeoutMs: z.number().int().positive().max(60_000).optional(),
} as const

// A union keeps the "at least one condition" rule in both the runtime parser
// and the generated JSON Schema instead of losing it as an opaque refinement.
export const BrowserPageWaitForParams = z.union([
  z.object({
    ...BrowserPageWaitForParamFields,
    text: NonBlankWaitString,
  }).strict(),
  z.object({
    ...BrowserPageWaitForParamFields,
    urlIncludes: NonBlankWaitString,
  }).strict(),
  z.object({
    ...BrowserPageWaitForParamFields,
    selector: NonBlankWaitString,
  }).strict(),
  z.object({
    ...BrowserPageWaitForParamFields,
    elementId: NonBlankWaitString,
  }).strict(),
])

export const BrowserCommandSecurityClass = z.enum([
  "browser-metadata-read",
  "target-url",
  "tab-lifecycle",
  "page-content-read",
  "page-interaction",
  "local-file-read",
])
export type BrowserCommandSecurityClass = z.infer<
  typeof BrowserCommandSecurityClass
>

type BrowserContractCommandDefinition<
  TParams extends z.ZodType = z.ZodType,
  TResult extends z.ZodType = z.ZodType,
> = {
  method: BrowserContractCommandMethod
  apiPath: string
  signature: string
  summary: string
  security: BrowserCommandSecurityClass
  params: TParams
  result: TResult
}

const BrowserContractBaseCommandRegistry = {
  "tabs.list": {
    method: "tabs.list",
    apiPath: "browser.tabs.list",
    signature: "browser.tabs.list()",
    summary: "List tabs visible to the extension backend.",
    security: "browser-metadata-read",
    params: BrowserTabsListParams,
    result: BrowserExtensionTabsListResult,
  },
  "tabs.open": {
    method: "tabs.open",
    apiPath: "browser.tabs.open",
    signature: "browser.tabs.open(url, options?)",
    summary: "Open a URL in a new Chrome tab.",
    security: "target-url",
    params: BrowserTabsOpenParams,
    result: BrowserExtensionTabSummary,
  },
  "tabs.activate": {
    method: "tabs.activate",
    apiPath: "browser.tabs.activate",
    signature: "browser.tabs.activate(tabId)",
    summary: "Activate a bound Chrome tab.",
    security: "tab-lifecycle",
    params: BrowserTabsActivateParams,
    result: BrowserExtensionTabSummary,
  },
  "tabs.goto": {
    method: "tabs.goto",
    apiPath: "tab.goto",
    signature: "tab.goto(url)",
    summary: "Navigate a leased tab to an absolute URL.",
    security: "target-url",
    params: BrowserTabsGotoParams,
    result: BrowserExtensionTabSummary,
  },
  "tabs.back": {
    method: "tabs.back",
    apiPath: "tab.back",
    signature: "tab.back()",
    summary: "Navigate a leased tab backward in its history.",
    security: "page-interaction",
    params: BrowserTabsBackParams,
    result: BrowserExtensionTabSummary,
  },
  "tabs.forward": {
    method: "tabs.forward",
    apiPath: "tab.forward",
    signature: "tab.forward()",
    summary: "Navigate a leased tab forward in its history.",
    security: "page-interaction",
    params: BrowserTabsForwardParams,
    result: BrowserExtensionTabSummary,
  },
  "tabs.reload": {
    method: "tabs.reload",
    apiPath: "tab.reload",
    signature: "tab.reload()",
    summary: "Reload a leased tab.",
    security: "page-interaction",
    params: BrowserTabsReloadParams,
    result: BrowserExtensionTabSummary,
  },
  "tabs.close": {
    method: "tabs.close",
    apiPath: "tab.close",
    signature: "tab.close()",
    summary: "Close a leased tab and release its browser resources.",
    security: "tab-lifecycle",
    params: BrowserTabsCloseParams,
    result: BrowserExtensionTabsCloseResult,
  },
  "tabs.release": {
    method: "tabs.release",
    apiPath: "tab.release",
    signature: "tab.release()",
    summary: "Release a tab from the current browser context.",
    security: "tab-lifecycle",
    params: BrowserTabsReleaseParams,
    result: BrowserExtensionTabsReleaseResult,
  },
  "page.snapshot": {
    method: "page.snapshot",
    apiPath: "tab.snapshot",
    signature: "tab.snapshot(options?)",
    summary: "Read a redacted visible-page snapshot.",
    security: "page-content-read",
    params: BrowserPageSnapshotParams,
    result: BrowserExtensionSnapshotResult,
  },
  "page.interactiveSnapshot": {
    method: "page.interactiveSnapshot",
    apiPath: "tab.interactiveSnapshot",
    signature: "tab.interactiveSnapshot(options?)",
    summary: "List redacted interactive elements on a tab.",
    security: "page-content-read",
    params: BrowserPageInteractiveSnapshotParams,
    result: BrowserExtensionInteractiveSnapshotResult,
  },
  "page.domTree": {
    method: "page.domTree",
    apiPath: "tab.domTree",
    signature: "tab.domTree(options?)",
    summary: "Read a bounded, redacted DOM tree.",
    security: "page-content-read",
    params: BrowserPageDomTreeParams,
    result: BrowserExtensionDomTreeResult,
  },
  "page.accessibilityTree": {
    method: "page.accessibilityTree",
    apiPath: "tab.accessibilityTree",
    signature: "tab.accessibilityTree(options?)",
    summary: "Read a bounded, redacted accessibility tree.",
    security: "page-content-read",
    params: BrowserPageAccessibilityTreeParams,
    result: BrowserExtensionAccessibilityTreeResult,
  },
  "page.screenshot": {
    method: "page.screenshot",
    apiPath: "tab.screenshot",
    signature: "tab.screenshot(options?)",
    summary: "Capture a PNG screenshot of a tab.",
    security: "page-content-read",
    params: BrowserPageScreenshotParams,
    result: BrowserExtensionScreenshotResult,
  },
  "page.click": {
    method: "page.click",
    apiPath: "tab.click",
    signature: "tab.click(x, y, options?)",
    summary: "Click viewport coordinates in a tab.",
    security: "page-interaction",
    params: BrowserPageClickParams,
    result: BrowserExtensionClickResult,
  },
  "page.clickElement": {
    method: "page.clickElement",
    apiPath: "tab.clickElement",
    signature: "tab.clickElement(elementId, options?)",
    summary: "Click an element from an interactive snapshot.",
    security: "page-interaction",
    params: BrowserPageClickElementParams,
    result: BrowserExtensionElementActionResult,
  },
  "page.fill": {
    method: "page.fill",
    apiPath: "tab.fill",
    signature: "tab.fill(elementId, text, options?)",
    summary: "Fill an element from an interactive snapshot.",
    security: "page-interaction",
    params: BrowserPageFillParams,
    result: BrowserExtensionFillResult,
  },
  "page.type": {
    method: "page.type",
    apiPath: "tab.type",
    signature: "tab.type(text)",
    summary: "Insert text into the focused page element.",
    security: "page-interaction",
    params: BrowserPageTypeParams,
    result: BrowserExtensionTypeResult,
  },
  "page.scroll": {
    method: "page.scroll",
    apiPath: "tab.scroll",
    signature: "tab.scroll(options?)",
    summary: "Scroll a tab by a viewport delta.",
    security: "page-content-read",
    params: BrowserPageScrollParams,
    result: BrowserExtensionScrollResult,
  },
  "page.waitFor": {
    method: "page.waitFor",
    apiPath: "tab.waitFor",
    signature: "tab.waitFor(condition)",
    summary: "Wait for a bounded URL, text, selector, or element condition.",
    security: "page-content-read",
    params: BrowserPageWaitForParams,
    result: BrowserExtensionWaitForResult,
  },
} as const

export const BrowserContractCommandRegistry = {
  ...BrowserContractBaseCommandRegistry,
  "tabs.listUser": {
    method: "tabs.listUser",
    apiPath: "browser.tabs.listUser",
    signature: "browser.tabs.listUser()",
    summary: "List user tabs that may be explicitly claimed.",
    security: "browser-metadata-read",
    params: BrowserTabsListUserParams,
    result: BrowserExtensionTabsListResult,
  },
  "tabs.claim": {
    method: "tabs.claim",
    apiPath: "browser.tabs.claim",
    signature: "browser.tabs.claim(tabId)",
    summary: "Claim a user-created tab for the current browser session.",
    security: "tab-lifecycle",
    params: BrowserTabsClaimParams,
    result: BrowserExtensionTabSummary,
  },
  "tabs.markDeliverable": {
    method: "tabs.markDeliverable",
    apiPath: "tab.markDeliverable",
    signature: "tab.markDeliverable()",
    summary: "Retain a leased tab as a user deliverable during finalization.",
    security: "tab-lifecycle",
    params: BrowserTabsMarkDeliverableParams,
    result: BrowserExtensionTabsMarkDeliverableResult,
  },
  "tabs.finalize": {
    method: "tabs.finalize",
    apiPath: "browser.tabs.finalize",
    signature: "browser.tabs.finalize(options?)",
    summary: "Finalize all tab leases for the current session.",
    security: "tab-lifecycle",
    params: BrowserTabsFinalizeParams,
    result: BrowserExtensionTabsFinalizeResult,
  },
  "playwright.domSnapshot": {
    method: "playwright.domSnapshot",
    apiPath: "tab.playwright.domSnapshot",
    signature: "tab.playwright.domSnapshot(options?)",
    summary: "Return a bounded semantic DOM snapshot for locator grounding.",
    security: "page-content-read",
    params: BrowserPlaywrightDomSnapshotParams,
    result: BrowserExtensionPlaywrightDomSnapshotResult,
  },
  "playwright.elementInfo": {
    method: "playwright.elementInfo",
    apiPath: "tab.playwright.elementInfo",
    signature: "tab.playwright.elementInfo(options)",
    summary: "Return locator-oriented metadata at screenshot coordinates.",
    security: "page-content-read",
    params: BrowserPlaywrightElementInfoParams,
    result: BrowserExtensionPlaywrightElementInfoResult,
  },
  "playwright.locator.count": {
    method: "playwright.locator.count",
    apiPath: "tab.playwright.locator(selector).count",
    signature: "locator.count()",
    summary: "Count elements matching an immutable locator plan.",
    security: "page-content-read",
    params: BrowserPlaywrightLocatorCountParams,
    result: BrowserExtensionPlaywrightLocatorCountResult,
  },
  "playwright.locator.allTextContents": {
    method: "playwright.locator.allTextContents",
    apiPath: "tab.playwright.locator(selector).allTextContents",
    signature: "locator.allTextContents(options?)",
    summary: "Return redacted textContent values for all locator matches.",
    security: "page-content-read",
    params: BrowserPlaywrightLocatorReadParams,
    result: BrowserExtensionPlaywrightLocatorTextsResult,
  },
  "playwright.locator.textContent": {
    method: "playwright.locator.textContent",
    apiPath: "tab.playwright.locator(selector).textContent",
    signature: "locator.textContent(options?)",
    summary: "Return redacted textContent for one strict locator match.",
    security: "page-content-read",
    params: BrowserPlaywrightLocatorReadParams,
    result: BrowserExtensionPlaywrightLocatorValueResult,
  },
  "playwright.locator.innerText": {
    method: "playwright.locator.innerText",
    apiPath: "tab.playwright.locator(selector).innerText",
    signature: "locator.innerText(options?)",
    summary: "Return rendered text for one strict locator match.",
    security: "page-content-read",
    params: BrowserPlaywrightLocatorReadParams,
    result: BrowserExtensionPlaywrightLocatorValueResult,
  },
  "playwright.locator.inputValue": {
    method: "playwright.locator.inputValue",
    apiPath: "tab.playwright.locator(selector).inputValue",
    signature: "locator.inputValue(options?)",
    summary: "Return a non-sensitive form value for one strict match.",
    security: "page-content-read",
    params: BrowserPlaywrightLocatorReadParams,
    result: BrowserExtensionPlaywrightLocatorValueResult,
  },
  "playwright.locator.getAttribute": {
    method: "playwright.locator.getAttribute",
    apiPath: "tab.playwright.locator(selector).getAttribute",
    signature: "locator.getAttribute(name, options?)",
    summary: "Return an attribute for one strict locator match.",
    security: "page-content-read",
    params: BrowserPlaywrightLocatorGetAttributeParams,
    result: BrowserExtensionPlaywrightLocatorValueResult,
  },
  "playwright.locator.isVisible": {
    method: "playwright.locator.isVisible",
    apiPath: "tab.playwright.locator(selector).isVisible",
    signature: "locator.isVisible()",
    summary: "Report visibility without scrolling or changing page state.",
    security: "page-content-read",
    params: BrowserPlaywrightLocatorReadParams,
    result: BrowserExtensionPlaywrightLocatorBooleanResult,
  },
  "playwright.locator.isEnabled": {
    method: "playwright.locator.isEnabled",
    apiPath: "tab.playwright.locator(selector).isEnabled",
    signature: "locator.isEnabled()",
    summary: "Report enabled state without changing page state.",
    security: "page-content-read",
    params: BrowserPlaywrightLocatorReadParams,
    result: BrowserExtensionPlaywrightLocatorBooleanResult,
  },
  "playwright.locator.waitFor": {
    method: "playwright.locator.waitFor",
    apiPath: "tab.playwright.locator(selector).waitFor",
    signature: "locator.waitFor(options)",
    summary: "Wait for a locator state using bounded event-driven polling.",
    security: "page-content-read",
    params: BrowserPlaywrightLocatorWaitForParams,
    result: BrowserExtensionPlaywrightWaitResult,
  },
  "playwright.locator.click": {
    method: "playwright.locator.click",
    apiPath: "tab.playwright.locator(selector).click",
    signature: "locator.click(options?)",
    summary: "Strictly resolve, actionability-check, and click a locator.",
    security: "page-interaction",
    params: BrowserPlaywrightLocatorClickParams,
    result: BrowserExtensionPlaywrightActionResult,
  },
  "playwright.locator.dblclick": {
    method: "playwright.locator.dblclick",
    apiPath: "tab.playwright.locator(selector).dblclick",
    signature: "locator.dblclick(options?)",
    summary: "Strictly resolve and double-click a locator.",
    security: "page-interaction",
    params: BrowserPlaywrightLocatorClickParams,
    result: BrowserExtensionPlaywrightActionResult,
  },
  "playwright.locator.fill": {
    method: "playwright.locator.fill",
    apiPath: "tab.playwright.locator(selector).fill",
    signature: "locator.fill(value, options?)",
    summary: "Strictly replace the value of a fillable locator target.",
    security: "page-interaction",
    params: BrowserPlaywrightLocatorFillParams,
    result: BrowserExtensionPlaywrightActionResult,
  },
  "playwright.locator.type": {
    method: "playwright.locator.type",
    apiPath: "tab.playwright.locator(selector).type",
    signature: "locator.type(value, options?)",
    summary: "Strictly type text into a locator target without clearing it.",
    security: "page-interaction",
    params: BrowserPlaywrightLocatorTypeParams,
    result: BrowserExtensionPlaywrightActionResult,
  },
  "playwright.locator.press": {
    method: "playwright.locator.press",
    apiPath: "tab.playwright.locator(selector).press",
    signature: "locator.press(value, options?)",
    summary: "Focus one strict locator match and press a keyboard key.",
    security: "page-interaction",
    params: BrowserPlaywrightLocatorPressParams,
    result: BrowserExtensionPlaywrightActionResult,
  },
  "playwright.locator.selectOption": {
    method: "playwright.locator.selectOption",
    apiPath: "tab.playwright.locator(selector).selectOption",
    signature: "locator.selectOption(value, options?)",
    summary: "Select one or more options on a native select element.",
    security: "page-interaction",
    params: BrowserPlaywrightLocatorSelectOptionParams,
    result: BrowserExtensionPlaywrightActionResult,
  },
  "playwright.locator.setChecked": {
    method: "playwright.locator.setChecked",
    apiPath: "tab.playwright.locator(selector).setChecked",
    signature: "locator.setChecked(checked, options?)",
    summary: "Set the checked state of one strict locator match.",
    security: "page-interaction",
    params: BrowserPlaywrightLocatorSetCheckedParams,
    result: BrowserExtensionPlaywrightActionResult,
  },
  "playwright.waitForNavigation": {
    method: "playwright.waitForNavigation",
    apiPath: "tab.playwright.expectNavigation",
    signature: "tab.playwright.expectNavigation(action, options?)",
    summary: "Wait for navigation from a captured document generation.",
    security: "page-content-read",
    params: BrowserPlaywrightWaitForNavigationParams,
    result: BrowserExtensionPlaywrightWaitResult,
  },
  "playwright.waitForLoadState": {
    method: "playwright.waitForLoadState",
    apiPath: "tab.playwright.waitForLoadState",
    signature: "tab.playwright.waitForLoadState(options?)",
    summary: "Wait for a bounded page lifecycle state.",
    security: "page-content-read",
    params: BrowserPlaywrightWaitForLoadStateParams,
    result: BrowserExtensionPlaywrightWaitResult,
  },
  "playwright.waitForURL": {
    method: "playwright.waitForURL",
    apiPath: "tab.playwright.waitForURL",
    signature: "tab.playwright.waitForURL(url, options?)",
    summary: "Wait for a tab URL and optional lifecycle state.",
    security: "page-content-read",
    params: BrowserPlaywrightWaitForURLParams,
    result: BrowserExtensionPlaywrightWaitResult,
  },
  "playwright.waitForEvent": {
    method: "playwright.waitForEvent",
    apiPath: "tab.playwright.waitForEvent",
    signature: "tab.playwright.waitForEvent(event, options?)",
    summary: "Wait for a one-shot download or file chooser event.",
    security: "page-content-read",
    params: BrowserPlaywrightWaitForEventParams,
    result: BrowserExtensionPlaywrightEventResult,
  },
  "playwright.download.path": {
    method: "playwright.download.path",
    apiPath: "download.path",
    signature: "download.path(options?)",
    summary: "Return the completed path for a one-shot download event.",
    security: "page-content-read",
    params: BrowserPlaywrightEventHandleParams,
    result: BrowserExtensionPlaywrightDownloadPathResult,
  },
  "playwright.fileChooser.setFiles": {
    method: "playwright.fileChooser.setFiles",
    apiPath: "fileChooser.setFiles",
    signature: "fileChooser.setFiles(files, options?)",
    summary: "Upload explicitly approved local files through a chooser.",
    security: "local-file-read",
    params: BrowserPlaywrightFileChooserSetFilesParams,
    result: BrowserExtensionPlaywrightFileChooserSetFilesResult,
  },
} as const satisfies Record<
  BrowserContractCommandMethod,
  BrowserContractCommandDefinition
>

export type BrowserContractCommandParams<
  TMethod extends BrowserContractCommandMethod,
> = z.output<(typeof BrowserContractCommandRegistry)[TMethod]["params"]>

export type BrowserContractCommandResult<
  TMethod extends BrowserContractCommandMethod,
> = z.output<(typeof BrowserContractCommandRegistry)[TMethod]["result"]>

function commandDefinition(
  method: unknown,
  contractVersion: number = BROWSER_CONTRACT_VERSION,
) {
  if (contractVersion !== BROWSER_CONTRACT_VERSION) {
    throw new BrowserContractValidationError(
      "COMMAND_NOT_SUPPORTED",
      `Browser contract version '${contractVersion}' is not supported.`,
    )
  }
  const parsed = BrowserContractCommandMethod.safeParse(method)
  if (!parsed.success) {
    throw new BrowserContractValidationError(
      "COMMAND_NOT_SUPPORTED",
      `Browser command '${String(method)}' is not supported by contract v${contractVersion}.`,
      { cause: parsed.success ? undefined : parsed.error },
    )
  }
  return BrowserContractCommandRegistry[parsed.data]
}

export function parseBrowserCommandParams<
  TMethod extends BrowserContractCommandMethod,
>(
  method: TMethod,
  value: unknown,
  contractVersion: number = BROWSER_CONTRACT_VERSION,
): BrowserContractCommandParams<TMethod> {
  const definition = commandDefinition(method, contractVersion)
  const parsed = definition.params.safeParse(value === undefined ? {} : value)
  if (!parsed.success) {
    throw new BrowserContractValidationError(
      "INVALID_COMMAND_PARAMS",
      `Browser command '${method}' parameters do not match contract v${contractVersion}.`,
      { cause: parsed.error },
    )
  }
  return parsed.data as BrowserContractCommandParams<TMethod>
}

export function parseBrowserCommandResult<
  TMethod extends BrowserContractCommandMethod,
>(
  method: TMethod,
  value: unknown,
  contractVersion: number = BROWSER_CONTRACT_VERSION,
): BrowserContractCommandResult<TMethod> {
  const definition = commandDefinition(method, contractVersion)
  const parsed = definition.result.safeParse(value)
  if (!parsed.success) {
    throw new BrowserContractValidationError(
      "INVALID_COMMAND_RESULT",
      `Browser command '${method}' result does not match contract v${contractVersion}.`,
      { cause: parsed.error },
    )
  }
  return parsed.data as BrowserContractCommandResult<TMethod>
}

export const BrowserCapabilityFeatures = z.object({
  ownership: z.boolean(),
  claim: z.boolean(),
  playwrightLocator: z.boolean().default(false),
  playwrightApiRevision: z.number().int().nonnegative().default(0),
  playwrightEngineVersion: z.string().trim().min(1).max(128).optional(),
  cancel: z.boolean(),
  arbitraryJavaScript: z.boolean(),
  scopedCdp: z.boolean(),
  fullCdp: z.boolean(),
}).strict()
export type BrowserCapabilityFeatures = z.infer<
  typeof BrowserCapabilityFeatures
>

export const DEFAULT_BROWSER_CAPABILITY_FEATURES = {
  ownership: false,
  claim: false,
  playwrightLocator: false,
  playwrightApiRevision: 0,
  cancel: false,
  arbitraryJavaScript: false,
  scopedCdp: false,
  fullCdp: false,
} as const satisfies BrowserCapabilityFeatures

export const BrowserBackendCapabilities = z.object({
  commands: z.array(BrowserContractCommandMethod),
  features: BrowserCapabilityFeatures,
}).strict().superRefine((value, context) => {
  const unique = new Set(value.commands)
  if (unique.size !== value.commands.length) {
    context.addIssue({
      code: "custom",
      message: "Browser backend capability commands must be unique.",
      path: ["commands"],
    })
  }
  const canonical = BROWSER_CONTRACT_COMMAND_METHODS.filter((method) =>
    unique.has(method)
  )
  if (
    canonical.length !== value.commands.length
    || canonical.some((method, index) => value.commands[index] !== method)
  ) {
    context.addIssue({
      code: "custom",
      message: "Browser backend capability commands must use canonical contract order.",
      path: ["commands"],
    })
  }
  const playwrightCommands = BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS
  const advertisesAllPlaywrightCommands = playwrightCommands.every((method) =>
    unique.has(method)
  )
  const advertisesAnyPlaywrightCommand = playwrightCommands.some((method) =>
    unique.has(method)
  )
  if (
    value.features.playwrightLocator !== advertisesAllPlaywrightCommands
    || advertisesAnyPlaywrightCommand !== advertisesAllPlaywrightCommands
  ) {
    context.addIssue({
      code: "custom",
      message:
        "The Playwright Locator v3 surface must be advertised atomically.",
      path: ["features", "playwrightLocator"],
    })
  }
  if (
    value.features.playwrightLocator
    && (
      value.features.playwrightApiRevision < 1
      || !value.features.playwrightEngineVersion
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Playwright Locator capabilities require an API revision and engine version.",
      path: ["features"],
    })
  }
  if (
    !value.features.playwrightLocator
    && (
      value.features.playwrightApiRevision !== 0
      || value.features.playwrightEngineVersion !== undefined
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Disabled Playwright Locator capabilities must not claim an engine revision.",
      path: ["features"],
    })
  }
})
export type BrowserBackendCapabilities = z.infer<
  typeof BrowserBackendCapabilities
>

export const BrowserBackendKind = z.enum(["extension", "iab", "cdp"])
export type BrowserBackendKind = z.infer<typeof BrowserBackendKind>

export const BrowserBackendInfo = z.object({
  contractVersion: BrowserContractVersion,
  browserId: z.string().min(1),
  name: z.string().min(1),
  kind: BrowserBackendKind,
  connected: z.boolean(),
  protocolVersion: z.number().int().positive().optional(),
  backendVersion: z.string().min(1).optional(),
  instanceID: z.string().min(1).optional(),
  capabilities: BrowserBackendCapabilities,
}).strict()
export type BrowserBackendInfo = z.infer<typeof BrowserBackendInfo>

function normalizeCommands(
  commands: readonly BrowserContractCommandMethod[],
) {
  const supported = new Set(
    commands.map((method) => BrowserContractCommandMethod.parse(method)),
  )
  return BROWSER_CONTRACT_COMMAND_METHODS.filter((method) =>
    supported.has(method)
  )
}

export function createBrowserBackendCapabilities(input: {
  commands?: readonly BrowserContractCommandMethod[]
  features?: Partial<BrowserCapabilityFeatures>
} = {}): BrowserBackendCapabilities {
  return BrowserBackendCapabilities.parse({
    commands: normalizeCommands(
      input.commands ?? [],
    ),
    features: {
      ...DEFAULT_BROWSER_CAPABILITY_FEATURES,
      ...input.features,
    },
  })
}

export function createBrowserBackendInfo(input: {
  connected: boolean
  contractVersion?: BrowserContractVersion
  browserId?: string
  name?: string
  kind?: BrowserBackendKind
  protocolVersion?: number
  backendVersion?: string
  instanceID?: string
  commands?: readonly BrowserContractCommandMethod[]
  features?: Partial<BrowserCapabilityFeatures>
}): BrowserBackendInfo {
  const commands = input.commands ?? []
  const hasPlaywrightSurface =
    BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS.every((method) =>
      commands.includes(method)
    )
  return BrowserBackendInfo.parse({
    contractVersion: input.contractVersion ?? BROWSER_CONTRACT_VERSION,
    browserId: input.browserId ?? "extension",
    name: input.name ?? "Anybox Chrome Extension",
    kind: input.kind ?? "extension",
    connected: input.connected,
    protocolVersion: input.protocolVersion,
    backendVersion: input.backendVersion,
    instanceID: input.instanceID,
    capabilities: createBrowserBackendCapabilities({
      commands,
      features: {
        ...(hasPlaywrightSurface
          && input.features?.playwrightLocator === undefined
          ? {
              playwrightLocator: true,
              playwrightApiRevision: 1,
              playwrightEngineVersion: "1.61.1",
            }
          : {}),
        ...input.features,
      },
    }),
  })
}

const JsonSchemaDocument = z.record(z.string(), z.unknown())

export const BrowserApiReceiver = z.enum(["browser", "tab"])
export type BrowserApiReceiver = z.infer<typeof BrowserApiReceiver>

export const BrowserApiPublicResult = z.enum([
  "tab-list-with-runtime-handles",
  "tab-runtime-handle",
  "command-result",
])
export type BrowserApiPublicResult = z.infer<typeof BrowserApiPublicResult>

export const BrowserApiManifestCommand = z.object({
  method: BrowserContractCommandMethod,
  apiPath: z.string().min(1),
  security: BrowserCommandSecurityClass,
  publicReceiver: BrowserApiReceiver,
  publicResult: BrowserApiPublicResult,
  commandParamsSchema: JsonSchemaDocument,
  commandResultSchema: JsonSchemaDocument,
}).strict()
export type BrowserApiManifestCommand = z.infer<
  typeof BrowserApiManifestCommand
>

export const BrowserApiManifest = z.object({
  contractVersion: BrowserContractVersion,
  commands: z.array(BrowserApiManifestCommand),
}).strict()
export type BrowserApiManifest = z.infer<typeof BrowserApiManifest>

export const BrowserDocumentationManifestEntry = z.object({
  method: BrowserContractCommandMethod,
  apiPath: z.string().min(1),
  signature: z.string().min(1),
  summary: z.string().min(1),
  security: BrowserCommandSecurityClass,
}).strict()
export type BrowserDocumentationManifestEntry = z.infer<
  typeof BrowserDocumentationManifestEntry
>

export const BrowserDocumentationManifest = z.object({
  contractVersion: BrowserContractVersion,
  title: z.string().min(1),
  entries: z.array(BrowserDocumentationManifestEntry),
}).strict()
export type BrowserDocumentationManifest = z.infer<
  typeof BrowserDocumentationManifest
>

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const document = z.toJSONSchema(schema)
  return JSON.parse(JSON.stringify(
    document,
    (key, value) => key === "~standard" ? undefined : value,
  )) as Record<string, unknown>
}

function publicReceiver(
  method: BrowserContractCommandMethod,
): BrowserApiReceiver {
  return method === "tabs.list"
    || method === "tabs.listUser"
    || method === "tabs.open"
    || method === "tabs.claim"
    || method === "tabs.activate"
    || method === "tabs.finalize"
    ? "browser"
    : "tab"
}

function publicResult(
  method: BrowserContractCommandMethod,
): BrowserApiPublicResult {
  if (method === "tabs.list" || method === "tabs.listUser") {
    return "tab-list-with-runtime-handles"
  }
  if (
    method === "tabs.open"
    || method === "tabs.claim"
    || method === "tabs.activate"
  ) {
    return "tab-runtime-handle"
  }
  return "command-result"
}

export function createBrowserApiManifest(
  commands: readonly BrowserContractCommandMethod[] =
    BROWSER_CONTRACT_COMMAND_METHODS,
  contractVersion: BrowserContractVersion = BROWSER_CONTRACT_VERSION,
): BrowserApiManifest {
  return BrowserApiManifest.parse({
    contractVersion,
    commands: normalizeCommands(commands).map((method) => {
      const definition = commandDefinition(method, contractVersion)
      return {
        method,
        apiPath: definition.apiPath,
        security: definition.security,
        publicReceiver: publicReceiver(method),
        publicResult: publicResult(method),
        commandParamsSchema: toJsonSchema(definition.params),
        commandResultSchema: toJsonSchema(definition.result),
      }
    }),
  })
}

export function createBrowserDocumentationManifest(
  commands: readonly BrowserContractCommandMethod[] =
    BROWSER_CONTRACT_COMMAND_METHODS,
  contractVersion: BrowserContractVersion = BROWSER_CONTRACT_VERSION,
): BrowserDocumentationManifest {
  return BrowserDocumentationManifest.parse({
    contractVersion,
    title: "Anybox Browser Client Runtime",
    entries: normalizeCommands(commands).map((method) => {
      const definition = commandDefinition(method, contractVersion)
      return {
        method,
        apiPath: definition.apiPath,
        signature: definition.signature,
        summary: definition.summary,
        security: definition.security,
      }
    }),
  })
}

export const BROWSER_API_MANIFEST = createBrowserApiManifest()
export const BROWSER_DOCUMENTATION_MANIFEST =
  createBrowserDocumentationManifest()

export const BrowserGetInfoResult = z.object({
  backend: BrowserBackendInfo,
  apiManifest: BrowserApiManifest,
  documentationManifest: BrowserDocumentationManifest,
}).strict()
export type BrowserGetInfoResult = z.infer<typeof BrowserGetInfoResult>

export function createBrowserGetInfoResult(
  backend: BrowserBackendInfo,
  contractVersion: BrowserContractVersion = BROWSER_CONTRACT_VERSION,
): BrowserGetInfoResult {
  const parsedBackend = BrowserBackendInfo.parse(backend)
  const commands = parsedBackend.capabilities.commands
  return BrowserGetInfoResult.parse({
    backend: parsedBackend,
    apiManifest: createBrowserApiManifest(commands, contractVersion),
    documentationManifest: createBrowserDocumentationManifest(
      commands,
      contractVersion,
    ),
  })
}
