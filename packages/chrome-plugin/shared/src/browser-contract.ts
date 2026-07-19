// This contract belongs to the Chrome plugin and is not part of the Agent core.
import { z } from "zod"
import {
  BrowserExtensionAccessibilityTreeResult,
  BrowserExtensionClickResult,
  BrowserExtensionDomTreeResult,
  BrowserExtensionElementActionResult,
  BrowserExtensionFillResult,
  BrowserExtensionInteractiveSnapshotResult,
  BrowserExtensionLocatorValueResult,
  BrowserExtensionScreenshotResult,
  BrowserExtensionScrollResult,
  BrowserExtensionSnapshotResult,
  BrowserExtensionTabSummary,
  BrowserExtensionTabsListResult,
  BrowserExtensionTabsFinalizeResult,
  BrowserExtensionTabsMarkDeliverableResult,
  BrowserExtensionTabsReleaseResult,
  BrowserExtensionTypeResult,
  BrowserExtensionWaitForResult,
} from "./browser-extension"

export const BROWSER_CONTRACT_V1_VERSION = 1 as const
export const BROWSER_CONTRACT_VERSION = 2 as const
export const BROWSER_CONTRACT_SUPPORTED_VERSIONS = [
  BROWSER_CONTRACT_V1_VERSION,
  BROWSER_CONTRACT_VERSION,
] as const

export const BROWSER_CONTRACT_V1_COMMAND_METHODS = [
  "tabs.list",
  "tabs.open",
  "tabs.activate",
  "tabs.release",
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
] as const
export type BrowserContractV1CommandMethod =
  (typeof BROWSER_CONTRACT_V1_COMMAND_METHODS)[number]

export const BROWSER_CONTRACT_COMMAND_METHODS = [
  ...BROWSER_CONTRACT_V1_COMMAND_METHODS,
  "tabs.listUser",
  "tabs.claim",
  "tabs.markDeliverable",
  "tabs.finalize",
  "locator.click",
  "locator.fill",
  "locator.textContent",
  "locator.inputValue",
  "locator.waitFor",
] as const

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

export const BrowserCommandExecutionContextV2 = z.object({
  sessionID: RequiredContextID,
  turnID: RequiredContextID,
  messageID: RequiredContextID,
  toolCallID: RequiredContextID,
  browserID: RequiredContextID,
  extensionInstanceID: RequiredContextID.optional(),
}).strict()
export type BrowserCommandExecutionContextV2 = z.infer<
  typeof BrowserCommandExecutionContextV2
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

export const BrowserLocator = z.object({
  role: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(512).optional(),
  text: z.string().trim().min(1).max(2_000).optional(),
  label: z.string().trim().min(1).max(512).optional(),
  placeholder: z.string().trim().min(1).max(512).optional(),
  css: z.string().trim().min(1).max(2_000).optional(),
  testId: z.string().trim().min(1).max(512).optional(),
  exact: z.boolean().optional(),
}).strict().refine(
  (value) => Object.entries(value).some(([key, item]) =>
    key !== "exact" && typeof item === "string" && item.length > 0
  ),
  "A structured locator requires role, name, text, label, placeholder, css, or testId.",
)
export type BrowserLocator = z.infer<typeof BrowserLocator>

const BrowserLocatorBaseParams = {
  tabId: RequiredTabID,
  locator: BrowserLocator,
  timeoutMs: z.number().int().positive().max(60_000).optional(),
} as const

export const BrowserLocatorClickParams = z.object({
  ...BrowserLocatorBaseParams,
  button: MouseButton.optional(),
}).strict()

export const BrowserLocatorFillParams = z.object({
  ...BrowserLocatorBaseParams,
  text: z.string(),
  sensitive: z.boolean().optional(),
}).strict()

export const BrowserLocatorTextContentParams = z.object({
  ...BrowserLocatorBaseParams,
}).strict()

export const BrowserLocatorInputValueParams = z.object({
  ...BrowserLocatorBaseParams,
}).strict()

export const BrowserLocatorWaitForParams = z.object({
  ...BrowserLocatorBaseParams,
  state: z.enum(["attached", "visible", "hidden", "enabled"]).optional(),
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

export const BrowserContractV1CommandRegistry = Object.freeze({
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
    security: "page-interaction",
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
} as const satisfies Record<
  BrowserContractV1CommandMethod,
  BrowserContractCommandDefinition
>)

export const BrowserContractCommandRegistry = {
  ...BrowserContractV1CommandRegistry,
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
  "page.scroll": {
    ...BrowserContractV1CommandRegistry["page.scroll"],
    security: "page-content-read",
  },
  "locator.click": {
    method: "locator.click",
    apiPath: "tab.locator(locator).click",
    signature: "tab.locator(locator).click(options?)",
    summary: "Relocate and click a structured locator target.",
    security: "page-interaction",
    params: BrowserLocatorClickParams,
    result: BrowserExtensionElementActionResult,
  },
  "locator.fill": {
    method: "locator.fill",
    apiPath: "tab.locator(locator).fill",
    signature: "tab.locator(locator).fill(text, options?)",
    summary: "Relocate and fill a structured locator target.",
    security: "page-interaction",
    params: BrowserLocatorFillParams,
    result: BrowserExtensionFillResult,
  },
  "locator.textContent": {
    method: "locator.textContent",
    apiPath: "tab.locator(locator).textContent",
    signature: "tab.locator(locator).textContent(options?)",
    summary: "Read redacted text from a structured locator target.",
    security: "page-content-read",
    params: BrowserLocatorTextContentParams,
    result: BrowserExtensionLocatorValueResult,
  },
  "locator.inputValue": {
    method: "locator.inputValue",
    apiPath: "tab.locator(locator).inputValue",
    signature: "tab.locator(locator).inputValue(options?)",
    summary: "Read a non-sensitive value from a structured locator target.",
    security: "page-content-read",
    params: BrowserLocatorInputValueParams,
    result: BrowserExtensionLocatorValueResult,
  },
  "locator.waitFor": {
    method: "locator.waitFor",
    apiPath: "tab.locator(locator).waitFor",
    signature: "tab.locator(locator).waitFor(options?)",
    summary: "Wait for a structured locator state with bounded retries.",
    security: "page-content-read",
    params: BrowserLocatorWaitForParams,
    result: BrowserExtensionWaitForResult,
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
  if (!BROWSER_CONTRACT_SUPPORTED_VERSIONS.includes(
    contractVersion as (typeof BROWSER_CONTRACT_SUPPORTED_VERSIONS)[number],
  )) {
    throw new BrowserContractValidationError(
      "COMMAND_NOT_SUPPORTED",
      `Browser contract version '${contractVersion}' is not supported.`,
    )
  }
  const parsed = BrowserContractCommandMethod.safeParse(method)
  if (
    !parsed.success
    || (
      contractVersion === BROWSER_CONTRACT_V1_VERSION
      && !BROWSER_CONTRACT_V1_COMMAND_METHODS.includes(
        parsed.data as BrowserContractV1CommandMethod,
      )
    )
  ) {
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
  locator: z.boolean(),
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
  locator: false,
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
})
export type BrowserBackendCapabilities = z.infer<
  typeof BrowserBackendCapabilities
>

export const BrowserBackendKind = z.enum(["extension", "iab", "cdp"])
export type BrowserBackendKind = z.infer<typeof BrowserBackendKind>

export const BrowserBackendInfo = z.object({
  contractVersion: z.union([
    z.literal(BROWSER_CONTRACT_V1_VERSION),
    z.literal(BROWSER_CONTRACT_VERSION),
  ]),
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
  contractVersion?: typeof BROWSER_CONTRACT_V1_VERSION | typeof BROWSER_CONTRACT_VERSION
  browserId?: string
  name?: string
  kind?: BrowserBackendKind
  protocolVersion?: number
  backendVersion?: string
  instanceID?: string
  commands?: readonly BrowserContractCommandMethod[]
  features?: Partial<BrowserCapabilityFeatures>
}): BrowserBackendInfo {
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
      commands: input.commands,
      features: input.features,
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
  contractVersion: z.union([
    z.literal(BROWSER_CONTRACT_V1_VERSION),
    z.literal(BROWSER_CONTRACT_VERSION),
  ]),
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
  contractVersion: z.union([
    z.literal(BROWSER_CONTRACT_V1_VERSION),
    z.literal(BROWSER_CONTRACT_VERSION),
  ]),
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
  contractVersion: typeof BROWSER_CONTRACT_V1_VERSION
    | typeof BROWSER_CONTRACT_VERSION = BROWSER_CONTRACT_VERSION,
): BrowserApiManifest {
  const available = contractVersion === BROWSER_CONTRACT_V1_VERSION
    ? new Set<BrowserContractCommandMethod>(BROWSER_CONTRACT_V1_COMMAND_METHODS)
    : new Set<BrowserContractCommandMethod>(BROWSER_CONTRACT_COMMAND_METHODS)
  return BrowserApiManifest.parse({
    contractVersion,
    commands: normalizeCommands(commands).filter((method) =>
      available.has(method)
    ).map((method) => {
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
  contractVersion: typeof BROWSER_CONTRACT_V1_VERSION
    | typeof BROWSER_CONTRACT_VERSION = BROWSER_CONTRACT_VERSION,
): BrowserDocumentationManifest {
  const available = contractVersion === BROWSER_CONTRACT_V1_VERSION
    ? new Set<BrowserContractCommandMethod>(BROWSER_CONTRACT_V1_COMMAND_METHODS)
    : new Set<BrowserContractCommandMethod>(BROWSER_CONTRACT_COMMAND_METHODS)
  return BrowserDocumentationManifest.parse({
    contractVersion,
    title: "Anybox Browser Client Runtime",
    entries: normalizeCommands(commands).filter((method) =>
      available.has(method)
    ).map((method) => {
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
  contractVersion: typeof BROWSER_CONTRACT_V1_VERSION
    | typeof BROWSER_CONTRACT_VERSION = BROWSER_CONTRACT_VERSION,
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
