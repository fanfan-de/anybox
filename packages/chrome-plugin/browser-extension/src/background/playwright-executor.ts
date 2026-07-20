import type {
  BrowserContractErrorCode,
  BrowserContractV3PlaywrightCommandMethod,
  BrowserLocatorPlanV3Type,
} from "@anybox/chrome-shared/browser-contract"
import {
  PLAYWRIGHT_DOM_SNAPSHOT_MAX_CHARS,
  PLAYWRIGHT_DOM_SNAPSHOT_MAX_NODES,
} from "@anybox/chrome-shared/browser-contract"

import {
  commandAbortedError,
  sendCdp,
  subscribeCdpDetach,
  subscribeCdpEvents,
  throwIfCommandAborted,
} from "./cdp-session"
import { compileLocatorPlanV3 } from "./locator-compiler"
import { recordLocatorMetric } from "./locator-metrics"

export const PLAYWRIGHT_LOCATOR_ENGINE_VERSION = "1.61.1"
export const PLAYWRIGHT_LOCATOR_API_REVISION = 1

const ENGINE_GLOBAL = "__anyboxPlaywrightEngine"
const ENGINE_VERSION_GLOBAL = "__anyboxPlaywrightEngineVersion"
const ENGINE_BUNDLE_SHA256 =
  "3ce6afda466d2c04fc8fb5befc699d164322af080f3678e9d6d12425ba2ce7df"
const ISOLATED_WORLD_NAME = "__anybox_locator_v3__"
const DEFAULT_TIMEOUT_MS = 10_000
const EVENT_TTL_MS = 5 * 60_000
const MAX_ERROR_PREVIEWS = 10
const FRAME_TARGET_FILTER = [
  { type: "iframe", exclude: false },
  { exclude: true },
]
const SENSITIVE_PATTERN_SOURCE =
  "(?:^|-)(?:password|passcode|passwd|secret|token|api-key|authorization|cookie|session|csrf|credit|debit|card|cardholder|card-holder|cardnumber|card-number|cvv|cvc|ssn|otp|otpcode|otp-code|2fa|onetime|one-time|onetimecode|one-time-code|cc-number|cc-csc|cc-cvc|cc-exp|verificationcode|verification-code|securitycode|security-code|pin)(?:$|-)|验证码|密码|口令|令牌|银行卡|卡号|安全码|一次性"
const PRIVACY_GLOBAL = "__anyboxLocatorPrivacy"
const PUBLIC_SELECTOR_HELPERS = `
const cssValue=value=>'"'+CSS.escape(String(value))+'"';
const uniqueSelector=selector=>{try{return document.querySelectorAll(selector).length===1}catch{return false}};
const structuralSelector=(element,attributesAllowed)=>{
  const parts=[];
  let current=element;
  while(current&&current.nodeType===Node.ELEMENT_NODE){
    const tag=current.tagName.toLowerCase();
    if(attributesAllowed&&current.id){
      parts.unshift("#"+CSS.escape(current.id));
      break;
    }
    const parent=current.parentElement;
    const siblings=parent?Array.from(parent.children).filter(item=>item.tagName===current.tagName):[];
    const position=siblings.length>1?":nth-of-type("+(siblings.indexOf(current)+1)+")":"";
    parts.unshift(tag+position);
    if(current===document.documentElement)break;
    current=parent;
  }
  return parts.join(" > ");
};
const selectorsFor=(element,sensitive)=>{
  const candidates=[];
  const add=selector=>{if(selector&&selector.length<=2000&&!candidates.includes(selector))candidates.push(selector)};
  if(!sensitive){
    const testId=element.getAttribute("data-testid");
    const name=element.getAttribute("name");
    const ariaLabel=element.getAttribute("aria-label");
    const role=element.getAttribute("role");
    if(testId)add("[data-testid="+cssValue(testId)+"]");
    if(element.id)add("#"+CSS.escape(element.id));
    if(name)add(element.tagName.toLowerCase()+"[name="+cssValue(name)+"]");
    if(ariaLabel)add("[aria-label="+cssValue(ariaLabel)+"]");
    if(role)add("[role="+cssValue(role)+"]");
  }
  add(structuralSelector(element,!sensitive));
  const ordered=[...candidates.filter(uniqueSelector),...candidates.filter(selector=>!uniqueSelector(selector))];
  return {candidates:ordered.slice(0,10),primary:ordered[0]||null};
};`

function privacyHelperExpression() {
  return `(()=>{
    const sensitivePattern=new RegExp(${JSON.stringify(SENSITIVE_PATTERN_SOURCE)},"i");
    const trim=value=>String(value??"").replace(/\\s+/g," ").trim();
    const metadata=value=>trim(value)
      .replace(/([A-Z]+)([A-Z][a-z])/g,"$1-$2")
      .replace(/([a-z0-9])([A-Z])/g,"$1-$2")
      .replace(/[^a-z0-9\\u3400-\\u9fff]+/gi,"-")
      .replace(/^-+|-+$/g,"")
      .toLowerCase();
    const labelledByText=element=>(element.getAttribute("aria-labelledby")||"")
      .split(/\\s+/)
      .filter(Boolean)
      .map(id=>{
        const root=element.getRootNode();
        return root.getElementById?.(id)?.textContent
          ||document.getElementById(id)?.textContent
          ||"";
      })
      .join(" ");
    const privateEditable=element=>{
      const tag=element.tagName.toLowerCase();
      const type=String(element.type||"").toLowerCase();
      if(tag==="input")
        return !["button","submit","reset","checkbox","radio","image"].includes(type);
      if(tag==="textarea"||tag==="select")return true;
      if((element.getAttribute("role")||"").toLowerCase()==="textbox")return true;
      const contenteditable=(element.getAttribute("contenteditable")||"").toLowerCase();
      return element.isContentEditable===true
        ||contenteditable===""&&element.hasAttribute("contenteditable")
        ||contenteditable==="true"
        ||contenteditable==="plaintext-only";
    };
    const valuesFor=element=>[
      element.value,
      element.innerText,
      element.textContent,
    ].map(trim).filter(Boolean);
    const ownPrivateValues=element=>
      privateEditable(element)?valuesFor(element):[];
    const privateValuesWithin=element=>{
      const values=[];
      const seen=new Set();
      const add=candidate=>{
        if(seen.has(candidate))return;
        seen.add(candidate);
        if(privateEditable(candidate))values.push(...valuesFor(candidate));
      };
      const visit=root=>{
        if(root.nodeType===Node.ELEMENT_NODE)add(root);
        for(const candidate of root.querySelectorAll("*")){
          add(candidate);
          if(candidate.shadowRoot)visit(candidate.shadowRoot);
        }
      };
      visit(element);
      return [...new Set(values)].sort((left,right)=>right.length-left.length);
    };
    const sensitive=element=>{
      const type=String(element.type||element.getAttribute("type")||"").toLowerCase();
      const values=[
        type,
        element.name,
        element.id,
        element.autocomplete,
        element.placeholder,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("alt"),
        labelledByText(element),
        ...Array.from(element.labels||[]).map(label=>label.textContent||""),
      ];
      return type==="password"
        ||type==="hidden"
        ||sensitivePattern.test(values.map(metadata).filter(Boolean).join("-"));
    };
    const safeMetadata=(element,value)=>{
      const candidate=trim(value);
      if(!candidate)return "";
      const comparable=value=>metadata(value).replaceAll("-","");
      const normalizedCandidate=comparable(candidate);
      return ownPrivateValues(element).some(value=>{
        const normalizedPrivate=comparable(value);
        return normalizedPrivate&&normalizedCandidate.includes(normalizedPrivate);
      })?"":candidate;
    };
    const redactText=(element,value)=>{
      let result=trim(value);
      for(const privateValue of privateValuesWithin(element))
        result=result.split(privateValue).join("[redacted]");
      return result;
    };
    globalThis[${JSON.stringify(PRIVACY_GLOBAL)}]=Object.freeze({
      privateEditable,
      redactText,
      safeMetadata,
      sensitive,
    });
    return true;
  })()`
}

type CdpDebuggee = {
  tabId: number
  sessionId?: string
}

type FrameInfo = {
  frameId: string
  parentFrameId?: string
  sessionId?: string
  url?: string
  isolatedContextId?: number
}

type DownloadHandle = {
  kind: "download"
  eventID: string
  tabId: number
  generation: number
  sessionId?: string
  expiresAt: number
  guid: string
  suggestedFilename?: string
  state: "inProgress" | "completed" | "canceled"
  path?: string
}

type FileChooserHandle = {
  kind: "filechooser"
  eventID: string
  tabId: number
  generation: number
  sessionId?: string
  expiresAt: number
  backendNodeId: number
  frameId?: string
  multiple: boolean
}

type EventHandle = DownloadHandle | FileChooserHandle

type PendingEvent = {
  event: "download" | "filechooser"
  generation: number
  resolve: (handle: EventHandle) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  cleanup?: () => void
}

type NavigationRegistration = {
  waiterID: string
  fromGeneration: number
  url?: string
  waitUntil: string
  expiresAt: number
}

type TabState = {
  tabId: number
  initialized: boolean
  initializing?: Promise<void>
  mainFrameId?: string
  frames: Map<string, FrameInfo>
  sessionTargets: Map<string, string>
  engineContexts: Set<string>
  documentGeneration: number
  lastMainNavigationGeneration: number
  lifecycle: Map<string, Set<string>>
  revision: number
  revisionWaiters: Set<() => void>
  pendingEvents: Set<PendingEvent>
  eventHandles: Map<string, EventHandle>
  navigationWaiters: Map<string, NavigationRegistration>
}

type FrameRoute = {
  frame: FrameInfo
  contextId: number
  offsetX: number
  offsetY: number
  framePath: Array<{ frameId: string }>
  frameOwners?: Array<{
    route: FrameRoute
    selector: string
  }>
}

type RemoteObject = {
  type?: string
  subtype?: string
  value?: unknown
  objectId?: string
  description?: string
}

type QuerySummary = {
  count: number
  previews: string[]
}

type ResolvedElement = {
  route: FrameRoute
  objectId: string
  summary: QuerySummary
}

const tabStates = new Map<number, TabState>()
let engineSourcePromise: Promise<string> | undefined
let downloadDirectory: string | undefined

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {}
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function readNumber(value: unknown, fallback?: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback
}

function timeoutFrom(params: Record<string, unknown>) {
  return Math.min(
    60_000,
    Math.max(1, Math.trunc(readNumber(params.timeoutMs, DEFAULT_TIMEOUT_MS)!)),
  )
}

function browserError(
  code: BrowserContractErrorCode,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>,
) {
  return Object.assign(new Error(message), {
    code,
    retryable,
    ...(details ? { details } : {}),
  })
}

function locatorDetails(
  state: TabState,
  route: FrameRoute | undefined,
  phase: string,
  matchCount?: number,
  previews?: string[],
) {
  return {
    phase,
    documentGeneration: state.documentGeneration,
    framePath: route?.framePath ?? [],
    ...(matchCount === undefined ? {} : { matchCount }),
    ...(previews?.length
      ? { candidatePreviews: previews.slice(0, MAX_ERROR_PREVIEWS) }
      : {}),
  }
}

function contextKey(sessionId: string | undefined, contextId: number) {
  return `${sessionId ?? "root"}:${contextId}`
}

function getTabState(tabId: number) {
  let state = tabStates.get(tabId)
  if (!state) {
    state = {
      tabId,
      initialized: false,
      frames: new Map(),
      sessionTargets: new Map(),
      engineContexts: new Set(),
      documentGeneration: 0,
      lastMainNavigationGeneration: 0,
      lifecycle: new Map(),
      revision: 0,
      revisionWaiters: new Set(),
      pendingEvents: new Set(),
      eventHandles: new Map(),
      navigationWaiters: new Map(),
    }
    tabStates.set(tabId, state)
  }
  return state
}

function notifyState(state: TabState) {
  state.revision += 1
  for (const waiter of [...state.revisionWaiters]) waiter()
}

function bumpGeneration(
  state: TabState,
  frameId: string | undefined,
  isMainNavigation: boolean,
  preserveLifecycle = false,
) {
  state.documentGeneration += 1
  if (isMainNavigation) {
    state.lastMainNavigationGeneration = state.documentGeneration
  }
  if (frameId) {
    if (!preserveLifecycle) {
      state.lifecycle.set(frameId, new Set(["commit"]))
    }
    const frame = state.frames.get(frameId)
    if (frame?.isolatedContextId !== undefined) {
      state.engineContexts.delete(
        contextKey(frame.sessionId, frame.isolatedContextId),
      )
      frame.isolatedContextId = undefined
    }
  }
  for (const [eventID, handle] of state.eventHandles) {
    if (handle.generation !== state.documentGeneration) {
      state.eventHandles.delete(eventID)
    }
  }
  for (const pending of [...state.pendingEvents]) {
    if (pending.generation === state.documentGeneration) continue
    state.pendingEvents.delete(pending)
    clearTimeout(pending.timer)
    pending.cleanup?.()
    pending.reject(browserError(
      "EVENT_EXPIRED",
      `The pending ${pending.event} event belongs to a previous document generation.`,
      false,
      {
        phase: "event-wait",
        documentGeneration: state.documentGeneration,
      },
    ))
  }
  notifyState(state)
}

function updateFrameTree(
  state: TabState,
  node: Record<string, unknown>,
  sessionId?: string,
  parentFrameId?: string,
) {
  const frame = readRecord(node.frame)
  const frameId = readString(frame.id)
  if (!frameId) return
  const existing = state.frames.get(frameId)
  state.frames.set(frameId, {
    frameId,
    parentFrameId: readString(frame.parentId) || parentFrameId,
    sessionId: sessionId ?? existing?.sessionId,
    url: readString(frame.url) || existing?.url,
    isolatedContextId: existing?.isolatedContextId,
  })
  if (!state.mainFrameId && !parentFrameId && !frame.parentId) {
    state.mainFrameId = frameId
  }
  const children = Array.isArray(node.childFrames) ? node.childFrames : []
  for (const child of children) {
    updateFrameTree(state, readRecord(child), sessionId, frameId)
  }
}

async function initializeCdpSession(
  state: TabState,
  sessionId?: string,
) {
  const commands = [
    sendCdp(state.tabId, "Page.enable", {}, undefined, sessionId),
    sendCdp(state.tabId, "Runtime.enable", {}, undefined, sessionId),
    sendCdp(state.tabId, "DOM.enable", {}, undefined, sessionId),
    sendCdp(state.tabId, "Accessibility.enable", {}, undefined, sessionId),
    sendCdp(
      state.tabId,
      "Page.setLifecycleEventsEnabled",
      { enabled: true },
      undefined,
      sessionId,
    ),
  ]
  if (sessionId) {
    commands.push(sendCdp(
      state.tabId,
      "Target.setAutoAttach",
      {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
        filter: FRAME_TARGET_FILTER,
      },
      undefined,
      sessionId,
    ))
  }
  await Promise.all(commands)
  const tree = readRecord(
    await sendCdp(
      state.tabId,
      "Page.getFrameTree",
      {},
      undefined,
      sessionId,
    ),
  )
  updateFrameTree(state, readRecord(tree.frameTree), sessionId)
}

async function ensureTabInitialized(
  tabId: number,
  signal?: AbortSignal,
) {
  const state = getTabState(tabId)
  if (state.initialized) return state
  if (!state.initializing) {
    state.initializing = (async () => {
      await sendCdp(tabId, "Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
        filter: FRAME_TARGET_FILTER,
      }, signal)
      await initializeCdpSession(state)
      state.initialized = true
      notifyState(state)
    })().catch((error) => {
      state.initializing = undefined
      throw error
    })
  }
  await state.initializing
  return state
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function loadEngineSource() {
  if (!engineSourcePromise) {
    engineSourcePromise = (async () => {
      const response = await fetch(chrome.runtime.getURL("locator-engine.js"))
      if (!response.ok) {
        throw new Error(
          `Could not load pinned Locator engine (${response.status}).`,
        )
      }
      const source = await response.text()
      const digest = await sha256(source)
      if (digest !== ENGINE_BUNDLE_SHA256) {
        throw new Error(
          "Pinned Locator engine integrity check failed; reinstall the extension.",
        )
      }
      return source
    })()
  }
  return await engineSourcePromise
}

function exceptionMessage(response: Record<string, unknown>) {
  const details = readRecord(response.exceptionDetails)
  const exception = readRecord(details.exception)
  return readString(exception.description)
    || readString(exception.value)
    || readString(details.text)
    || "The isolated Locator execution failed."
}

async function evaluate(
  state: TabState,
  route: FrameRoute,
  expression: string,
  options: {
    awaitPromise?: boolean
    returnByValue?: boolean
    signal?: AbortSignal
  } = {},
): Promise<RemoteObject> {
  throwIfCommandAborted(options.signal)
  const response = readRecord(await sendCdp(
    state.tabId,
    "Runtime.evaluate",
    {
      expression,
      contextId: route.contextId,
      awaitPromise: options.awaitPromise ?? false,
      returnByValue: options.returnByValue ?? true,
      userGesture: false,
      silent: true,
    },
    options.signal,
    route.frame.sessionId,
  ))
  if (response.exceptionDetails) {
    throw new Error(exceptionMessage(response))
  }
  return readRecord(response.result) as RemoteObject
}

async function callElement(
  state: TabState,
  element: ResolvedElement,
  functionDeclaration: string,
  args: unknown[] = [],
  options: {
    awaitPromise?: boolean
    signal?: AbortSignal
  } = {},
): Promise<unknown> {
  throwIfCommandAborted(options.signal)
  const response = readRecord(await sendCdp(
    state.tabId,
    "Runtime.callFunctionOn",
    {
      objectId: element.objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      awaitPromise: options.awaitPromise ?? false,
      returnByValue: true,
      userGesture: false,
      silent: true,
    },
    options.signal,
    element.route.frame.sessionId,
  ))
  if (response.exceptionDetails) {
    throw new Error(exceptionMessage(response))
  }
  return readRecord(response.result).value
}

async function releaseObject(
  state: TabState,
  element: ResolvedElement,
) {
  await sendCdp(
    state.tabId,
    "Runtime.releaseObject",
    { objectId: element.objectId },
    undefined,
    element.route.frame.sessionId,
  ).catch(() => undefined)
}

async function ensureFrameContext(
  state: TabState,
  frame: FrameInfo,
  signal?: AbortSignal,
) {
  if (
    frame.isolatedContextId !== undefined
    && state.engineContexts.has(
      contextKey(frame.sessionId, frame.isolatedContextId),
    )
  ) {
    return frame.isolatedContextId
  }
  const response = readRecord(await sendCdp(
    state.tabId,
    "Page.createIsolatedWorld",
    {
      frameId: frame.frameId,
      worldName: ISOLATED_WORLD_NAME,
      grantUniveralAccess: false,
    },
    signal,
    frame.sessionId,
  ))
  const contextId = readNumber(response.executionContextId)
  if (contextId === undefined) {
    throw browserError(
      "FRAME_DETACHED",
      "The target frame detached before its Locator context was created.",
      true,
      {
        documentGeneration: state.documentGeneration,
        framePath: [{ frameId: frame.frameId }],
      },
    )
  }
  frame.isolatedContextId = contextId
  const route: FrameRoute = {
    frame,
    contextId,
    offsetX: 0,
    offsetY: 0,
    framePath: [{ frameId: frame.frameId }],
  }
  const source = await loadEngineSource()
  await evaluate(state, route, source, {
    returnByValue: true,
    signal,
  })
  await evaluate(state, route, privacyHelperExpression(), {
    returnByValue: true,
    signal,
  })
  const version = await evaluate(
    state,
    route,
    `globalThis[${JSON.stringify(ENGINE_VERSION_GLOBAL)}]`,
    { returnByValue: true, signal },
  )
  if (version.value !== PLAYWRIGHT_LOCATOR_ENGINE_VERSION) {
    throw new Error("The pinned Locator engine reported an unexpected version.")
  }
  state.engineContexts.add(contextKey(frame.sessionId, contextId))
  recordLocatorMetric({
    event: "engine-init",
    engineVersion: PLAYWRIGHT_LOCATOR_ENGINE_VERSION,
  })
  return contextId
}

async function mainFrameRoute(
  state: TabState,
  signal?: AbortSignal,
): Promise<FrameRoute> {
  const frame = state.mainFrameId
    ? state.frames.get(state.mainFrameId)
    : undefined
  if (!frame) {
    throw browserError(
      "FRAME_DETACHED",
      "The tab does not currently have an attached main frame.",
      true,
      { documentGeneration: state.documentGeneration, framePath: [] },
    )
  }
  return {
    frame,
    contextId: await ensureFrameContext(state, frame, signal),
    offsetX: 0,
    offsetY: 0,
    framePath: [{ frameId: frame.frameId }],
  }
}

function queryExpression(selector: string) {
  return `(()=>{const engine=globalThis[${JSON.stringify(ENGINE_GLOBAL)}];const privacy=globalThis[${JSON.stringify(PRIVACY_GLOBAL)}];try{const elements=engine.querySelectorAllCached(${JSON.stringify(selector)},document);const previews=elements.slice(0,${MAX_ERROR_PREVIEWS}).map(element=>{const sensitive=privacy.sensitive(element);const role=engine.utils.getAriaRole(element)||element.getAttribute("role")||"";const rawName=engine.utils.getElementAccessibleName(element,false);const name=sensitive?"[redacted]":privacy.safeMetadata(element,rawName).slice(0,120);return \`<\${element.tagName.toLowerCase()}\${role?\` role="\${role}"\`:""}\${name?\` name="\${name}"\`:""}>\`.slice(0,200)});return {ok:true,count:elements.length,previews}}catch(error){return {ok:false,error:String(error?.message??error)}}})()`
}

async function querySummary(
  state: TabState,
  route: FrameRoute,
  selector: string,
  signal?: AbortSignal,
): Promise<QuerySummary> {
  const object = await evaluate(state, route, queryExpression(selector), {
    returnByValue: true,
    signal,
  })
  const value = readRecord(object.value)
  if (value.ok !== true) {
    throw browserError(
      "LOCATOR_PARSE_ERROR",
      "The Locator plan could not be compiled by the pinned Playwright engine.",
      false,
      {
        ...locatorDetails(state, route, "parse"),
        engineMessage: readString(value.error).slice(0, 500),
      },
    )
  }
  return {
    count: Math.max(0, Math.trunc(readNumber(value.count, 0)!)),
    previews: Array.isArray(value.previews)
      ? value.previews.filter((item): item is string =>
        typeof item === "string"
      ).slice(0, MAX_ERROR_PREVIEWS)
      : [],
  }
}

async function querySingleObject(
  state: TabState,
  route: FrameRoute,
  selector: string,
  signal?: AbortSignal,
) {
  const object = await evaluate(
    state,
    route,
    `(()=>{const engine=globalThis[${JSON.stringify(ENGINE_GLOBAL)}];const elements=engine.querySelectorAllCached(${JSON.stringify(selector)},document);return elements.length===1?elements[0]:null})()`,
    { returnByValue: false, signal },
  )
  return object.objectId
}

async function waitForRevision(
  state: TabState,
  delayMs: number,
  signal?: AbortSignal,
) {
  throwIfCommandAborted(signal)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      state.revisionWaiters.delete(onRevision)
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }
    const onRevision = () => finish()
    const onAbort = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      state.revisionWaiters.delete(onRevision)
      signal?.removeEventListener("abort", onAbort)
      reject(commandAbortedError())
    }
    const timer = setTimeout(finish, delayMs)
    state.revisionWaiters.add(onRevision)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

async function waitForDocumentSignal(
  state: TabState,
  route: FrameRoute,
  delayMs: number,
  signal?: AbortSignal,
) {
  const bounded = Math.max(1, Math.min(1_000, delayMs))
  try {
    await evaluate(
      state,
      route,
      `new Promise(resolve=>{let done=false;const finish=reason=>{if(done)return;done=true;observer.disconnect();clearTimeout(timer);resolve(reason)};const observer=new MutationObserver(()=>finish("mutation"));const observe=root=>{observer.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT);while(walker.nextNode()){const shadowRoot=walker.currentNode.shadowRoot;if(shadowRoot)observe(shadowRoot)}};observe(document);const timer=setTimeout(()=>finish("deadline"),${bounded})})`,
      { awaitPromise: true, returnByValue: true, signal },
    )
  } catch {
    throwIfCommandAborted(signal)
    await waitForRevision(state, Math.min(250, bounded), signal)
  }
}

async function resolveFramePath(
  state: TabState,
  plan: BrowserLocatorPlanV3Type,
  deadline: number,
  signal?: AbortSignal,
  forAction = false,
): Promise<FrameRoute> {
  let route = await mainFrameRoute(state, signal)
  for (const frameSelector of plan.framePath) {
    let entered = false
    while (!entered) {
      let summary = await querySummary(state, route, frameSelector, signal)
      while (summary.count === 0 && Date.now() < deadline) {
        await waitForDocumentSignal(
          state,
          route,
          deadline - Date.now(),
          signal,
        )
        route = route.frame.frameId === state.mainFrameId
          ? await mainFrameRoute(state, signal)
          : route
        summary = await querySummary(state, route, frameSelector, signal)
      }
      if (summary.count === 0) {
        throw browserError(
          "LOCATOR_NOT_FOUND",
          "A frameLocator step did not match an iframe before the deadline.",
          true,
          locatorDetails(
            state,
            route,
            "resolve-frame",
            0,
            summary.previews,
          ),
        )
      }
      if (summary.count !== 1) {
        throw browserError(
          "LOCATOR_STRICT_VIOLATION",
          `A frameLocator step matched ${summary.count} elements.`,
          false,
          locatorDetails(
            state,
            route,
            "resolve-frame",
            summary.count,
            summary.previews,
          ),
        )
      }
      const objectId = await querySingleObject(
        state,
        route,
        frameSelector,
        signal,
      )
      if (!objectId) {
        if (Date.now() >= deadline) {
          throw browserError(
            "STALE_DOCUMENT",
            "The iframe changed after strict resolution.",
            true,
            locatorDetails(state, route, "resolve-frame", 1, summary.previews),
          )
        }
        await waitForDocumentSignal(
          state,
          route,
          deadline - Date.now(),
          signal,
        )
        continue
      }
      const frameElement: ResolvedElement = {
        route,
        objectId,
        summary,
      }
      try {
        const frameData = readRecord(await callElement(
          state,
          frameElement,
          `async function(forAction){const engine=globalThis[${JSON.stringify(ENGINE_GLOBAL)}];if(forAction){this.scrollIntoView({block:"center",inline:"center",behavior:"instant"});const stateResult=await engine.checkElementStates(this,["visible","stable"]);if(stateResult==="error:notconnected")return {ok:false,reason:"detached"};if(stateResult?.missingState)return {ok:false,reason:stateResult.missingState}}const rect=this.getBoundingClientRect();const style=getComputedStyle(this);return {ok:true,x:rect.x+(parseFloat(style.borderLeftWidth)||0)+(parseFloat(style.paddingLeft)||0),y:rect.y+(parseFloat(style.borderTopWidth)||0)+(parseFloat(style.paddingTop)||0)}}`,
          [forAction],
          { awaitPromise: true, signal },
        ))
        if (frameData.ok !== true) {
          if (Date.now() >= deadline) {
            throw browserError(
              "LOCATOR_NOT_ACTIONABLE",
              "A frameLocator owner was not visible and stable before the deadline.",
              true,
              {
                ...locatorDetails(
                  state,
                  route,
                  "frame-actionability",
                  1,
                  summary.previews,
                ),
                reason: readString(frameData.reason, "not actionable"),
              },
            )
          }
          await waitForDocumentSignal(
            state,
            route,
            deadline - Date.now(),
            signal,
          )
          continue
        }
        const described = readRecord(await sendCdp(
          state.tabId,
          "DOM.describeNode",
          { objectId, depth: 0, pierce: true },
          signal,
          route.frame.sessionId,
        ))
        const node = readRecord(described.node)
        const frameId = readString(node.frameId)
        if (!frameId) {
          throw browserError(
            "LOCATOR_NOT_ACTIONABLE",
            "frameLocator resolved an element that is not an attached iframe.",
            false,
            locatorDetails(state, route, "enter-frame", 1, summary.previews),
          )
        }
        let child = state.frames.get(frameId)
        while (!child && Date.now() < deadline) {
          await waitForRevision(
            state,
            Math.min(250, deadline - Date.now()),
            signal,
          )
          child = state.frames.get(frameId)
        }
        if (!child) {
          throw browserError(
            "FRAME_DETACHED",
            "The resolved iframe detached before its execution context was ready.",
            true,
            locatorDetails(state, route, "enter-frame", 1, summary.previews),
          )
        }
        route = {
          frame: child,
          contextId: await ensureFrameContext(state, child, signal),
          offsetX: route.offsetX + (readNumber(frameData.x, 0) ?? 0),
          offsetY: route.offsetY + (readNumber(frameData.y, 0) ?? 0),
          framePath: [...route.framePath, { frameId }],
          frameOwners: [
            ...(route.frameOwners ?? []),
            { route, selector: frameSelector },
          ],
        }
        entered = true
      } finally {
        await releaseObject(state, frameElement)
      }
    }
  }
  return route
}

function isKnownBrowserError(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && typeof (error as { code?: unknown }).code === "string",
  )
}

async function resolveStrictElement(
  state: TabState,
  plan: BrowserLocatorPlanV3Type,
  deadline: number,
  signal?: AbortSignal,
  forAction = false,
): Promise<ResolvedElement> {
  const { selector } = compileLocatorPlanV3(plan)
  let lastRoute: FrameRoute | undefined
  let lastSummary: QuerySummary = { count: 0, previews: [] }
  let observedGeneration = state.documentGeneration
  do {
    throwIfCommandAborted(signal)
    try {
      const route = await resolveFramePath(
        state,
        plan,
        deadline,
        signal,
        forAction,
      )
      lastRoute = route
      const summary = await querySummary(state, route, selector, signal)
      lastSummary = summary
      if (summary.count > 1) {
        throw browserError(
          "LOCATOR_STRICT_VIOLATION",
          `The Locator matched ${summary.count} elements; a single-element operation requires exactly one.`,
          false,
          locatorDetails(
            state,
            route,
            "strict-resolution",
            summary.count,
            summary.previews,
          ),
        )
      }
      if (summary.count === 1) {
        const objectId = await querySingleObject(
          state,
          route,
          selector,
          signal,
        )
        if (objectId) return { route, objectId, summary }
      }
      if (Date.now() >= deadline) break
      await waitForDocumentSignal(
        state,
        route,
        deadline - Date.now(),
        signal,
      )
    } catch (error) {
      throwIfCommandAborted(signal)
      if (isKnownBrowserError(error)) throw error
      if (
        state.documentGeneration === observedGeneration
        && Date.now() >= deadline
      ) {
        throw browserError(
          "STALE_DOCUMENT",
          "The document execution context became unavailable while resolving the Locator.",
          true,
          locatorDetails(state, lastRoute, "strict-resolution"),
        )
      }
      observedGeneration = state.documentGeneration
      await waitForRevision(
        state,
        Math.min(100, Math.max(1, deadline - Date.now())),
        signal,
      )
    }
  } while (Date.now() < deadline)

  throw browserError(
    "LOCATOR_NOT_FOUND",
    "The Locator did not match an element before the deadline.",
    true,
    locatorDetails(
      state,
      lastRoute,
      "strict-resolution",
      lastSummary.count,
      lastSummary.previews,
    ),
  )
}

async function resolveImmediateSummary(
  state: TabState,
  plan: BrowserLocatorPlanV3Type,
  signal?: AbortSignal,
) {
  const { selector } = compileLocatorPlanV3(plan)
  const route = await resolveFramePath(
    state,
    plan,
    Date.now() + DEFAULT_TIMEOUT_MS,
    signal,
  )
  return {
    selector,
    route,
    summary: await querySummary(state, route, selector, signal),
  }
}

async function resultBase(state: TabState) {
  let title: string | undefined
  let url: string | undefined
  try {
    const tab = await chrome.tabs.get(state.tabId)
    title = typeof tab.title === "string" ? tab.title : undefined
    if (typeof tab.url === "string") {
      const parsed = new URL(tab.url)
      url = parsed.protocol === "http:" || parsed.protocol === "https:"
        ? `${parsed.origin}${parsed.pathname}`
        : tab.url === "about:blank"
          ? tab.url
          : undefined
    }
  } catch {
    // Results may omit tab metadata if Chrome tears down the tab concurrently.
  }
  return {
    tabId: state.tabId,
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    documentGeneration: state.documentGeneration,
  }
}

function strictViolation(
  state: TabState,
  route: FrameRoute,
  summary: QuerySummary,
) {
  return browserError(
    "LOCATOR_STRICT_VIOLATION",
    `The Locator matched ${summary.count} elements; this operation requires exactly one.`,
    false,
    locatorDetails(
      state,
      route,
      "strict-resolution",
      summary.count,
      summary.previews,
    ),
  )
}

async function readElementValue(
  state: TabState,
  element: ResolvedElement,
  kind:
    | "textContent"
    | "innerText"
    | "inputValue"
    | "attribute"
    | "visible"
    | "enabled",
  argument?: string,
  signal?: AbortSignal,
) {
  return await callElement(
    state,
    element,
    `function(kind,argument){if(!this.isConnected)throw new Error("Element is detached");const engine=globalThis[${JSON.stringify(ENGINE_GLOBAL)}];const privacy=globalThis[${JSON.stringify(PRIVACY_GLOBAL)}];const sensitive=privacy.sensitive(this);if(kind==="visible")return engine.elementState(this,"visible").matches;if(kind==="enabled")return engine.elementState(this,"enabled").matches;if(kind==="textContent")return sensitive?null:privacy.redactText(this,this.textContent);if(kind==="innerText"){if(!("innerText" in this))throw new Error("Element does not expose innerText");return sensitive?null:privacy.redactText(this,this.innerText)}if(kind==="inputValue"){if(sensitive)return null;if(this.tagName==="INPUT"||this.tagName==="TEXTAREA"||this.tagName==="SELECT")return this.value;throw new Error("Element is not an input, textarea, or select")}if(kind==="attribute")return sensitive&&String(argument).toLowerCase()==="value"?null:this.getAttribute(String(argument));throw new Error("Unsupported Locator read")}`,
    [kind, argument],
    { signal },
  )
}

async function locatorCount(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const plan = params.plan as BrowserLocatorPlanV3Type
  const { summary } = await resolveImmediateSummary(state, plan, signal)
  return { ...await resultBase(state), count: summary.count }
}

async function locatorAllTextContents(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const plan = params.plan as BrowserLocatorPlanV3Type
  const { selector, route } = await resolveImmediateSummary(state, plan, signal)
  const object = await evaluate(
    state,
    route,
    `(()=>{const engine=globalThis[${JSON.stringify(ENGINE_GLOBAL)}];const privacy=globalThis[${JSON.stringify(PRIVACY_GLOBAL)}];return engine.querySelectorAllCached(${JSON.stringify(selector)},document).map(element=>privacy.sensitive(element)?"[redacted]":privacy.redactText(element,element.textContent).slice(0,100000))})()`,
    { returnByValue: true, signal },
  )
  const values = Array.isArray(object.value)
    ? object.value.filter((item): item is string => typeof item === "string")
    : []
  return { ...await resultBase(state), values }
}

async function locatorRead(
  state: TabState,
  params: Record<string, unknown>,
  kind:
    | "textContent"
    | "innerText"
    | "inputValue"
    | "attribute"
    | "visible"
    | "enabled",
  signal?: AbortSignal,
) {
  const deadline = Date.now() + timeoutFrom(params)
  let lastElement: ResolvedElement | undefined
  let lastCause = "The document changed during the Locator read."
  while (Date.now() < deadline) {
    const generation = state.documentGeneration
    const element = await resolveStrictElement(
      state,
      params.plan as BrowserLocatorPlanV3Type,
      deadline,
      signal,
    )
    lastElement = element
    let retry = false
    try {
      const value = await readElementValue(
        state,
        element,
        kind,
        kind === "attribute" ? readString(params.name) : undefined,
        signal,
      )
      return { ...await resultBase(state), value }
    } catch (error) {
      if (isKnownBrowserError(error)) throw error
      const message = error instanceof Error ? error.message : String(error)
      lastCause = message.slice(0, 500)
      retry = generation !== state.documentGeneration
        || /(?:context|detached|object|node.*found|target closed)/iu.test(
          message,
        )
      if (!retry) {
        throw browserError(
          "LOCATOR_NOT_ACTIONABLE",
          message,
          false,
          locatorDetails(
            state,
            element.route,
            "read",
            1,
            element.summary.previews,
          ),
        )
      }
    } finally {
      await releaseObject(state, element)
    }
    if (retry && Date.now() < deadline) {
      await waitForRevision(
        state,
        Math.min(100, deadline - Date.now()),
        signal,
      )
    }
  }
  throw browserError(
    "STALE_DOCUMENT",
    "The document did not remain stable long enough to complete the Locator read.",
    true,
    {
      ...locatorDetails(
        state,
        lastElement?.route,
        "read",
        lastElement ? 1 : undefined,
        lastElement?.summary.previews,
      ),
      cause: lastCause,
    },
  )
}

async function locatorWaitFor(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const plan = params.plan as BrowserLocatorPlanV3Type
  const { selector } = compileLocatorPlanV3(plan)
  const desired = readString(params.state)
  const deadline = Date.now() + timeoutFrom(params)
  let route: FrameRoute | undefined
  let summary: QuerySummary = { count: 0, previews: [] }
  while (Date.now() < deadline) {
    route = await resolveFramePath(state, plan, deadline, signal)
    summary = await querySummary(state, route, selector, signal)
    if (summary.count > 1) throw strictViolation(state, route, summary)
    if (
      summary.count === 0
      && (desired === "detached" || desired === "hidden")
    ) {
      return {
        ...await resultBase(state),
        matched: true,
        state: desired,
      }
    }
    if (summary.count === 1) {
      if (desired === "attached") {
        return {
          ...await resultBase(state),
          matched: true,
          state: desired,
        }
      }
      const objectId = await querySingleObject(
        state,
        route,
        selector,
        signal,
      )
      if (objectId) {
        const element: ResolvedElement = { route, objectId, summary }
        try {
          const visible = await readElementValue(
            state,
            element,
            "visible",
            undefined,
            signal,
          )
          if (
            (desired === "visible" && visible === true)
            || (desired === "hidden" && visible === false)
          ) {
            return {
              ...await resultBase(state),
              matched: true,
              state: desired,
            }
          }
        } finally {
          await releaseObject(state, element)
        }
      }
    }
    await waitForDocumentSignal(
      state,
      route,
      deadline - Date.now(),
      signal,
    )
  }
  throw browserError(
    "DEADLINE_EXCEEDED",
    `The Locator did not reach state '${desired}' before the deadline.`,
    true,
    locatorDetails(
      state,
      route,
      "wait",
      summary.count,
      summary.previews,
    ),
  )
}

async function checkFrameOwnerHitTargets(
  state: TabState,
  route: FrameRoute,
  x: number,
  y: number,
  signal?: AbortSignal,
) {
  for (const owner of [...(route.frameOwners ?? [])].reverse()) {
    const objectId = await querySingleObject(
      state,
      owner.route,
      owner.selector,
      signal,
    )
    if (!objectId) {
      return {
        ok: false as const,
        reason: "A frameLocator owner changed after strict resolution.",
        route: owner.route,
      }
    }
    const frameElement: ResolvedElement = {
      route: owner.route,
      objectId,
      summary: { count: 1, previews: [] },
    }
    try {
      const outcome = readRecord(await callElement(
        state,
        frameElement,
        `function(point){const hit=globalThis[${JSON.stringify(ENGINE_GLOBAL)}].expectHitTarget(point,this);if(hit==="done")return {ok:true};return {ok:false,reason:typeof hit==="object"?hit.hitTargetDescription:String(hit)}}`,
        [{
          x: x - owner.route.offsetX,
          y: y - owner.route.offsetY,
        }],
        { signal },
      ))
      if (outcome.ok !== true) {
        return {
          ok: false as const,
          reason: readString(
            outcome.reason,
            "A frameLocator owner does not receive pointer events.",
          ),
          route: owner.route,
        }
      }
    } finally {
      await releaseObject(state, frameElement)
    }
  }
  return { ok: true as const }
}

async function prepareAction(
  state: TabState,
  params: Record<string, unknown>,
  action: "click" | "fill" | "type" | "press" | "select" | "check",
  signal?: AbortSignal,
) {
  const deadline = Date.now() + timeoutFrom(params)
  const force = params.force === true
  let lastReason = "The element is not actionable."
  while (Date.now() < deadline) {
    let waitRoute: FrameRoute | undefined
    const element = await resolveStrictElement(
      state,
      params.plan as BrowserLocatorPlanV3Type,
      deadline,
      signal,
      true,
    )
    waitRoute = element.route
    try {
      const states = action === "fill" || action === "type"
        ? ["visible", "stable", "enabled", "editable"]
        : ["visible", "stable", "enabled"]
      const outcome = readRecord(await callElement(
        state,
        element,
        `async function(states,force){const engine=globalThis[${JSON.stringify(ENGINE_GLOBAL)}];if(!this.isConnected)return {ok:false,reason:"detached"};this.scrollIntoView({block:"center",inline:"center",behavior:"instant"});if(!force){const stateResult=await engine.checkElementStates(this,states);if(stateResult==="error:notconnected")return {ok:false,reason:"detached"};if(stateResult?.missingState)return {ok:false,reason:stateResult.missingState}}const rect=this.getBoundingClientRect();const point={x:rect.left+rect.width/2,y:rect.top+rect.height/2};if(!force){const hit=engine.expectHitTarget(point,this);if(hit!=="done")return {ok:false,reason:typeof hit==="object"?hit.hitTargetDescription:String(hit)}}return {ok:true,x:point.x,y:point.y}}`,
        [states, force],
        { awaitPromise: true, signal },
      ))
      if (outcome.ok === true) {
        const x = element.route.offsetX + (readNumber(outcome.x, 0) ?? 0)
        const y = element.route.offsetY + (readNumber(outcome.y, 0) ?? 0)
        const frameHit = force
          ? { ok: true as const }
          : await checkFrameOwnerHitTargets(
              state,
              element.route,
              x,
              y,
              signal,
            )
        if (frameHit.ok) {
          return { element, x, y }
        }
        lastReason = frameHit.reason
        waitRoute = frameHit.route
      } else {
        lastReason = readString(outcome.reason, lastReason)
      }
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error)
    }
    await releaseObject(state, element)
    await waitForDocumentSignal(
      state,
      waitRoute ?? element.route,
      deadline - Date.now(),
      signal,
    )
  }
  throw browserError(
    "LOCATOR_NOT_ACTIONABLE",
    `The Locator target was not actionable before the deadline: ${lastReason}`,
    true,
    {
      phase: "actionability",
      documentGeneration: state.documentGeneration,
      reason: lastReason.slice(0, 500),
    },
  )
}

function actionOutcomeUnknown(
  state: TabState,
  element: ResolvedElement | undefined,
  action: string,
  cause: unknown,
) {
  return browserError(
    "ACTION_OUTCOME_UNKNOWN",
    `The '${action}' input was dispatched, but its final outcome could not be confirmed. Do not replay it without a new snapshot.`,
    false,
    {
      ...locatorDetails(
        state,
        element?.route,
        "post-dispatch",
        element ? 1 : undefined,
        element?.summary.previews,
      ),
      action,
      cause: cause instanceof Error
        ? cause.message.slice(0, 500)
        : String(cause).slice(0, 500),
    },
  )
}

async function inspectActionTarget(
  state: TabState,
  element: ResolvedElement,
  signal?: AbortSignal,
) {
  return readRecord(await callElement(
    state,
    element,
    `function(){const attributeType=(this.getAttribute("type")||"").toLowerCase();return {tag:this.tagName.toLowerCase(),type:this.tagName==="INPUT"?String(this.type||"").toLowerCase():attributeType,contentEditable:this.isContentEditable===true,sensitive:globalThis[${JSON.stringify(PRIVACY_GLOBAL)}].sensitive(this),checked:"checked" in this?this.checked:undefined,multiple:this.multiple===true}}`,
    [],
    { signal },
  ))
}

type ModifierName = "Alt" | "Control" | "Meta" | "Shift"

const MODIFIER_BITS: Record<ModifierName, number> = {
  Alt: 1,
  Control: 2,
  Meta: 4,
  Shift: 8,
}

const MODIFIER_KEYS: Record<
  ModifierName,
  { key: string; code: string; windowsVirtualKeyCode: number }
> = {
  Alt: { key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18 },
  Control: {
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17,
  },
  Meta: { key: "Meta", code: "MetaLeft", windowsVirtualKeyCode: 91 },
  Shift: { key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 },
}

async function normalizedModifiers(value: unknown): Promise<ModifierName[]> {
  const requested = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
  let controlOrMeta: ModifierName = "Control"
  try {
    const platform = await chrome.runtime.getPlatformInfo?.()
    if (platform?.os === "mac") controlOrMeta = "Meta"
  } catch {
    // Chromium on non-macOS uses Control for ControlOrMeta.
  }
  return [...new Set(requested.map((item) =>
    item === "ControlOrMeta" ? controlOrMeta : item
  ).filter((item): item is ModifierName =>
    item === "Alt"
    || item === "Control"
    || item === "Meta"
    || item === "Shift"
  ))]
}

function modifierMask(modifiers: readonly ModifierName[]) {
  return modifiers.reduce((mask, modifier) => mask | MODIFIER_BITS[modifier], 0)
}

async function dispatchModifier(
  tabId: number,
  modifier: ModifierName,
  type: "keyDown" | "keyUp",
  modifiers: number,
  signal?: AbortSignal,
) {
  const descriptor = MODIFIER_KEYS[modifier]
  await sendCdp(tabId, "Input.dispatchKeyEvent", {
    type,
    ...descriptor,
    nativeVirtualKeyCode: descriptor.windowsVirtualKeyCode,
    modifiers,
  }, signal)
}

async function locatorClick(
  state: TabState,
  params: Record<string, unknown>,
  double: boolean,
  signal?: AbortSignal,
) {
  const prepared = await prepareAction(state, params, "click", signal)
  const { element, x, y } = prepared
  const button = ["left", "right", "middle"].includes(readString(params.button))
    ? readString(params.button)
    : "left"
  const modifiers = await normalizedModifiers(params.modifiers)
  const mask = modifierMask(modifiers)
  let dispatched = false
  const pressedModifiers: ModifierName[] = []
  let mousePressed = false
  let pressedClickCount = 0
  try {
    for (const modifier of modifiers) {
      dispatched = true
      pressedModifiers.push(modifier)
      await dispatchModifier(
        state.tabId,
        modifier,
        "keyDown",
        modifierMask(pressedModifiers),
        signal,
      )
    }
    dispatched = true
    await sendCdp(state.tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      modifiers: mask,
    }, signal)
    const clickCounts = double ? [1, 2] : [1]
    for (const clickCount of clickCounts) {
      dispatched = true
      mousePressed = true
      pressedClickCount = clickCount
      await sendCdp(state.tabId, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button,
        clickCount,
        modifiers: mask,
      }, signal)
      await sendCdp(state.tabId, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button,
        clickCount,
        modifiers: mask,
      }, signal)
      mousePressed = false
      pressedClickCount = 0
    }
    while (pressedModifiers.length > 0) {
      const modifier = pressedModifiers.pop()!
      await dispatchModifier(
        state.tabId,
        modifier,
        "keyUp",
        modifierMask(pressedModifiers),
        signal,
      )
    }
    return { ...await resultBase(state), dispatched: true }
  } catch (error) {
    if (dispatched) {
      throw actionOutcomeUnknown(
        state,
        element,
        double ? "dblclick" : "click",
        error,
      )
    }
    throw error
  } finally {
    if (mousePressed) {
      await sendCdp(state.tabId, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button,
        clickCount: pressedClickCount || 1,
        modifiers: mask,
      }).catch(() => undefined)
    }
    while (pressedModifiers.length > 0) {
      const modifier = pressedModifiers.pop()!
      await dispatchModifier(
        state.tabId,
        modifier,
        "keyUp",
        modifierMask(pressedModifiers),
      )
        .catch(() => undefined)
    }
    await releaseObject(state, element)
  }
}

async function locatorFill(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const prepared = await prepareAction(state, params, "fill", signal)
  const { element } = prepared
  const value = readString(params.value)
  let dispatched = false
  try {
    const target = await inspectActionTarget(state, element, signal)
    if (target.sensitive === true && params.sensitive !== true) {
      throw browserError(
        "PERMISSION_DENIED",
        "The Locator target is sensitive; fill requires sensitive: true and one-time Host approval.",
        false,
        locatorDetails(
          state,
          element.route,
          "sensitive-check",
          1,
          element.summary.previews,
        ),
      )
    }
    const fillableInputTypes = new Set([
      "",
      "color",
      "date",
      "datetime-local",
      "email",
      "month",
      "number",
      "password",
      "range",
      "search",
      "tel",
      "text",
      "time",
      "url",
      "week",
    ])
    const fillable = (
      target.tag === "input"
      && fillableInputTypes.has(readString(target.type))
    )
      || target.tag === "textarea"
      || target.contentEditable === true
    if (!fillable) {
      throw browserError(
        "LOCATOR_NOT_ACTIONABLE",
        "fill requires an input, textarea, or contenteditable target.",
        false,
        locatorDetails(state, element.route, "target-type", 1),
      )
    }

    dispatched = true
    const fillResult = await callElement(
      state,
      element,
      `function(value){return globalThis[${JSON.stringify(ENGINE_GLOBAL)}].fill(this,value)}`,
      [value],
      { signal },
    )
    if (fillResult === "needsinput") {
      if (value) {
        await sendCdp(
          state.tabId,
          "Input.insertText",
          { text: value },
          signal,
          element.route.frame.sessionId,
        )
      } else {
        await dispatchKey(
          state,
          "Backspace",
          0,
          element.route.frame.sessionId,
          signal,
        )
      }
    } else if (fillResult !== "done") {
      throw new Error(`Pinned fill routine returned '${String(fillResult)}'.`)
    }
    const verified = await callElement(
      state,
      element,
      "function(){if(this.tagName===\"INPUT\"||this.tagName===\"TEXTAREA\"||this.tagName===\"SELECT\")return this.value;return this.textContent??\"\"}",
      [],
      { signal },
    )
    if (verified !== value) {
      throw browserError(
        "LOCATOR_NOT_ACTIONABLE",
        "The page did not retain the filled value; the action will not be replayed.",
        false,
        locatorDetails(state, element.route, "verify", 1),
      )
    }
    return { ...await resultBase(state), dispatched: true }
  } catch (error) {
    if (dispatched) {
      throw actionOutcomeUnknown(state, element, "fill", error)
    }
    throw error
  } finally {
    await releaseObject(state, element)
  }
}

const SPECIAL_KEYS: Record<
  string,
  { key: string; code: string; windowsVirtualKeyCode: number }
> = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Backspace: {
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8,
  },
  Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowDown: {
    key: "ArrowDown",
    code: "ArrowDown",
    windowsVirtualKeyCode: 40,
  },
  ArrowLeft: {
    key: "ArrowLeft",
    code: "ArrowLeft",
    windowsVirtualKeyCode: 37,
  },
  ArrowRight: {
    key: "ArrowRight",
    code: "ArrowRight",
    windowsVirtualKeyCode: 39,
  },
  Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: {
    key: "PageDown",
    code: "PageDown",
    windowsVirtualKeyCode: 34,
  },
  Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
}
for (let index = 1; index <= 12; index += 1) {
  SPECIAL_KEYS[`F${index}`] = {
    key: `F${index}`,
    code: `F${index}`,
    windowsVirtualKeyCode: 111 + index,
  }
}

function keyDescriptor(key: string) {
  const special = SPECIAL_KEYS[key]
  if (special) return special
  const codeLetter = key.match(/^Key([A-Z])$/u)?.[1]
  if (codeLetter) {
    return {
      key: codeLetter.toLowerCase(),
      code: key,
      windowsVirtualKeyCode: codeLetter.charCodeAt(0),
    }
  }
  const codeDigit = key.match(/^Digit([0-9])$/u)?.[1]
  if (codeDigit) {
    return {
      key: codeDigit,
      code: key,
      windowsVirtualKeyCode: codeDigit.charCodeAt(0),
    }
  }
  const characters = Array.from(key)
  if (characters.length !== 1) return undefined
  const first = characters[0]!
  const upper = first.toUpperCase()
  return {
    key: first,
    code: /^[a-z]$/iu.test(first) ? `Key${upper}` : "",
    windowsVirtualKeyCode: upper.charCodeAt(0) || 0,
  }
}

async function dispatchKey(
  state: TabState,
  key: string,
  modifiers: number,
  sessionId: string | undefined,
  signal?: AbortSignal,
) {
  const descriptor = keyDescriptor(key)
  if (!descriptor) throw new Error(`Unsupported key '${key}'.`)
  const printable = Array.from(descriptor.key).length === 1
  const shortcutModifiers =
    MODIFIER_BITS.Alt | MODIFIER_BITS.Control | MODIFIER_BITS.Meta
  const text = printable && (modifiers & shortcutModifiers) === 0
    ? (modifiers & MODIFIER_BITS.Shift) !== 0
      ? descriptor.key.toLocaleUpperCase()
      : descriptor.key
    : undefined
  let keyDown = false
  try {
    keyDown = true
    await sendCdp(state.tabId, "Input.dispatchKeyEvent", {
      type: text === undefined ? "rawKeyDown" : "keyDown",
      ...descriptor,
      nativeVirtualKeyCode: descriptor.windowsVirtualKeyCode,
      modifiers,
      ...(text === undefined ? {} : { text }),
    }, signal, sessionId)
    await sendCdp(state.tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      ...descriptor,
      nativeVirtualKeyCode: descriptor.windowsVirtualKeyCode,
      modifiers,
    }, signal, sessionId)
    keyDown = false
  } finally {
    if (keyDown) {
      await sendCdp(state.tabId, "Input.dispatchKeyEvent", {
        type: "keyUp",
        ...descriptor,
        nativeVirtualKeyCode: descriptor.windowsVirtualKeyCode,
        modifiers,
      }, undefined, sessionId).catch(() => undefined)
    }
  }
}

async function locatorType(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const prepared = await prepareAction(state, params, "type", signal)
  const { element } = prepared
  const value = readString(params.value)
  let dispatched = false
  try {
    const target = await inspectActionTarget(state, element, signal)
    if (target.sensitive === true && params.sensitive !== true) {
      throw browserError(
        "PERMISSION_DENIED",
        "The Locator target is sensitive; type requires sensitive: true and one-time Host approval.",
        false,
        locatorDetails(state, element.route, "sensitive-check", 1),
      )
    }
    if (!value) {
      return { ...await resultBase(state), dispatched: false }
    }
    dispatched = true
    await callElement(
      state,
      element,
      `function(){return globalThis[${JSON.stringify(ENGINE_GLOBAL)}].focusNode(this,true)}`,
      [],
      { signal },
    )
    for (const character of Array.from(value)) {
      await dispatchKey(
        state,
        character,
        0,
        element.route.frame.sessionId,
        signal,
      )
    }
    return { ...await resultBase(state), dispatched: true }
  } catch (error) {
    if (dispatched) throw actionOutcomeUnknown(state, element, "type", error)
    throw error
  } finally {
    await releaseObject(state, element)
  }
}

async function locatorPress(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const tokens = readString(params.value).split("+")
  const key = tokens.pop() ?? ""
  let modifierNames: string[] = tokens
  if (
    !key
    || modifierNames.some((item) =>
      item !== "Alt"
      && item !== "Control"
      && item !== "ControlOrMeta"
      && item !== "Meta"
      && item !== "Shift"
    )
  ) {
    throw browserError(
      "LOCATOR_PARSE_ERROR",
      "A key chord may only use supported modifiers before its final key.",
      false,
      locatorDetails(state, undefined, "parse-key"),
    )
  }
  if (!keyDescriptor(key)) {
    throw browserError(
      "LOCATOR_PARSE_ERROR",
      `The key '${key.slice(0, 64)}' is not supported by the fixed keyboard map.`,
      false,
      locatorDetails(state, undefined, "parse-key"),
    )
  }
  const prepared = await prepareAction(state, params, "press", signal)
  const { element } = prepared
  let dispatched = false
  const pressedModifiers: ModifierName[] = []
  try {
    const controlOrMeta = await normalizedModifiers(["ControlOrMeta"])
    modifierNames = modifierNames.map((item) =>
      item === "ControlOrMeta" ? controlOrMeta[0] ?? "Control" : item
    )
    const modifiers = [...new Set(modifierNames)].filter(
      (item): item is ModifierName =>
        item === "Alt"
        || item === "Control"
        || item === "Meta"
        || item === "Shift",
    )
    const mask = modifierMask(modifiers)
    dispatched = true
    await callElement(
      state,
      element,
      `function(){return globalThis[${JSON.stringify(ENGINE_GLOBAL)}].focusNode(this,true)}`,
      [],
      { signal },
    )
    for (const modifier of modifiers) {
      pressedModifiers.push(modifier)
      await dispatchModifier(
        state.tabId,
        modifier,
        "keyDown",
        modifierMask(pressedModifiers),
        signal,
      )
    }
    await dispatchKey(
      state,
      key,
      mask,
      element.route.frame.sessionId,
      signal,
    )
    while (pressedModifiers.length > 0) {
      const modifier = pressedModifiers.pop()!
      await dispatchModifier(
        state.tabId,
        modifier,
        "keyUp",
        modifierMask(pressedModifiers),
        signal,
      )
    }
    return { ...await resultBase(state), dispatched: true }
  } catch (error) {
    if (dispatched) throw actionOutcomeUnknown(state, element, "press", error)
    throw error
  } finally {
    while (pressedModifiers.length > 0) {
      const modifier = pressedModifiers.pop()!
      await dispatchModifier(
        state.tabId,
        modifier,
        "keyUp",
        modifierMask(pressedModifiers),
      )
        .catch(() => undefined)
    }
    await releaseObject(state, element)
  }
}

async function locatorSelectOption(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const prepared = await prepareAction(state, params, "select", signal)
  const { element } = prepared
  const values = Array.isArray(params.values) ? params.values : []
  let dispatched = false
  try {
    const target = await inspectActionTarget(state, element, signal)
    if (target.tag !== "select") {
      throw browserError(
        "LOCATOR_NOT_ACTIONABLE",
        "selectOption requires a native select target.",
        false,
        locatorDetails(state, element.route, "target-type", 1),
      )
    }
    const options = values.map((value) =>
      typeof value === "string" ? { valueOrLabel: value } : value
    )
    dispatched = true
    const result = await callElement(
      state,
      element,
      `function(options){return globalThis[${JSON.stringify(ENGINE_GLOBAL)}].selectOptions(this,options)}`,
      [options],
      { signal },
    )
    if (!Array.isArray(result)) {
      throw new Error(`Select action failed with '${String(result)}'.`)
    }
    const selectedValues = result.filter((item): item is string =>
      typeof item === "string"
    )
    const verifiedValues = await callElement(
      state,
      element,
      "function(){return Array.from(this.selectedOptions).map(option=>option.value)}",
      [],
      { signal },
    )
    if (
      !Array.isArray(verifiedValues)
      || JSON.stringify(verifiedValues) !== JSON.stringify(selectedValues)
    ) {
      throw new Error("The target did not retain its selected options.")
    }
    return {
      ...await resultBase(state),
      dispatched: true,
      values: selectedValues,
    }
  } catch (error) {
    if (dispatched) {
      throw actionOutcomeUnknown(state, element, "selectOption", error)
    }
    throw error
  } finally {
    await releaseObject(state, element)
  }
}

async function locatorSetChecked(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const prepared = await prepareAction(state, params, "check", signal)
  const { element } = prepared
  const checked = params.checked === true
  let dispatched = false
  try {
    const target = await inspectActionTarget(state, element, signal)
    if (
      target.tag !== "input"
      || (target.type !== "checkbox" && target.type !== "radio")
    ) {
      throw browserError(
        "LOCATOR_NOT_ACTIONABLE",
        "setChecked requires an input[type=checkbox] or input[type=radio] target.",
        false,
        locatorDetails(state, element.route, "target-type", 1),
      )
    }
    if (target.type === "radio" && !checked) {
      throw browserError(
        "LOCATOR_NOT_ACTIONABLE",
        "A radio input cannot be unchecked directly.",
        false,
        locatorDetails(state, element.route, "target-type", 1),
      )
    }
    if (target.checked === checked) {
      return { ...await resultBase(state), dispatched: false }
    }
    dispatched = true
    const result = readRecord(await callElement(
      state,
      element,
      "function(checked){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,\"checked\")?.set;if(!setter)throw new Error(\"Native checked setter is unavailable\");setter.call(this,checked);this.dispatchEvent(new Event(\"input\",{bubbles:true,composed:true}));this.dispatchEvent(new Event(\"change\",{bubbles:true,composed:true}));return {checked:this.checked}}",
      [checked],
      { signal },
    ))
    if (result.checked !== checked) {
      throw new Error("The target did not retain its requested checked state.")
    }
    const verified = await callElement(
      state,
      element,
      "function(){return this.checked}",
      [],
      { signal },
    )
    if (verified !== checked) {
      throw new Error("The target reverted its requested checked state.")
    }
    return { ...await resultBase(state), dispatched: true }
  } catch (error) {
    if (dispatched) {
      throw actionOutcomeUnknown(state, element, "setChecked", error)
    }
    throw error
  } finally {
    await releaseObject(state, element)
  }
}

function settlePendingEvent(
  state: TabState,
  pending: PendingEvent,
  handle: EventHandle,
) {
  state.pendingEvents.delete(pending)
  clearTimeout(pending.timer)
  pending.cleanup?.()
  for (const [eventID, existing] of state.eventHandles) {
    if (existing.expiresAt <= Date.now()) state.eventHandles.delete(eventID)
  }
  while (state.eventHandles.size >= 128) {
    const oldest = state.eventHandles.keys().next().value
    if (typeof oldest !== "string") break
    state.eventHandles.delete(oldest)
  }
  state.eventHandles.set(handle.eventID, handle)
  pending.resolve(handle)
}

function rejectPendingEvents(state: TabState, error: Error) {
  for (const pending of [...state.pendingEvents]) {
    state.pendingEvents.delete(pending)
    clearTimeout(pending.timer)
    pending.cleanup?.()
    pending.reject(error)
  }
}

function eventHandleID() {
  return crypto.randomUUID()
}

async function processCdpEvent(
  source: CdpDebuggee,
  method: string,
  rawParams: Record<string, unknown>,
) {
  const state = tabStates.get(source.tabId)
  if (!state) return
  const params = readRecord(rawParams)

  if (method === "Target.attachedToTarget") {
    const sessionId = readString(params.sessionId)
    const targetInfo = readRecord(params.targetInfo)
    const targetId = readString(targetInfo.targetId)
    if (readString(targetInfo.type) !== "iframe") return
    if (sessionId) {
      recordLocatorMetric({ event: "frame-attach", oopif: true })
      state.sessionTargets.set(sessionId, targetId)
      if (targetId) {
        const frame = state.frames.get(targetId)
        state.frames.set(targetId, {
          frameId: targetId,
          parentFrameId: frame?.parentFrameId,
          url: readString(targetInfo.url) || frame?.url,
          sessionId,
          isolatedContextId: frame?.isolatedContextId,
        })
      }
      notifyState(state)
      await initializeCdpSession(state, sessionId).catch(() => undefined)
    }
    return
  }

  if (method === "Target.detachedFromTarget") {
    const sessionId = readString(params.sessionId)
    if (sessionId) {
      state.sessionTargets.delete(sessionId)
      for (const [frameId, frame] of state.frames) {
        if (frame.sessionId === sessionId) state.frames.delete(frameId)
      }
      bumpGeneration(state, undefined, false)
    }
    return
  }

  if (method === "Runtime.executionContextDestroyed") {
    const contextId = readNumber(params.executionContextId)
    for (const frame of state.frames.values()) {
      if (
        contextId !== undefined
        &&
        frame.sessionId === source.sessionId
        && frame.isolatedContextId === contextId
      ) {
        const isolatedContextId = frame.isolatedContextId
        state.engineContexts.delete(
          contextKey(frame.sessionId, isolatedContextId),
        )
        frame.isolatedContextId = undefined
      }
    }
    notifyState(state)
    return
  }

  if (method === "Runtime.executionContextsCleared") {
    for (const frame of state.frames.values()) {
      if (frame.sessionId === source.sessionId) {
        if (frame.isolatedContextId !== undefined) {
          state.engineContexts.delete(
            contextKey(frame.sessionId, frame.isolatedContextId),
          )
        }
        frame.isolatedContextId = undefined
      }
    }
    notifyState(state)
    return
  }

  if (method === "Page.frameAttached") {
    const frameId = readString(params.frameId)
    if (frameId) {
      if (!source.sessionId) {
        recordLocatorMetric({ event: "frame-attach", oopif: false })
      }
      const existing = state.frames.get(frameId)
      state.frames.set(frameId, {
        frameId,
        parentFrameId: readString(params.parentFrameId)
          || existing?.parentFrameId,
        sessionId: source.sessionId ?? existing?.sessionId,
        url: existing?.url,
        isolatedContextId: existing?.isolatedContextId,
      })
      notifyState(state)
    }
    return
  }

  if (method === "Page.frameNavigated") {
    const frame = readRecord(params.frame)
    const frameId = readString(frame.id)
    if (frameId) {
      const parentFrameId = readString(frame.parentId) || undefined
      const existing = state.frames.get(frameId)
      state.frames.set(frameId, {
        frameId,
        parentFrameId,
        sessionId: source.sessionId ?? existing?.sessionId,
        url: readString(frame.url) || existing?.url,
      })
      if (!parentFrameId) state.mainFrameId = frameId
      bumpGeneration(state, frameId, !parentFrameId)
    }
    return
  }

  if (method === "Page.navigatedWithinDocument") {
    const frameId = readString(params.frameId)
    const frame = state.frames.get(frameId)
    if (frame) frame.url = readString(params.url) || frame.url
    bumpGeneration(state, frameId, frameId === state.mainFrameId, true)
    return
  }

  if (method === "Page.frameDetached") {
    const frameId = readString(params.frameId)
    if (frameId) {
      const remove = (target: string) => {
        for (const child of [...state.frames.values()]) {
          if (child.parentFrameId === target) remove(child.frameId)
        }
        state.frames.delete(target)
      }
      remove(frameId)
      bumpGeneration(state, frameId, frameId === state.mainFrameId)
    }
    return
  }

  if (method === "Page.lifecycleEvent") {
    const frameId = readString(params.frameId)
    const name = readString(params.name)
    if (frameId && name) {
      const lifecycle = state.lifecycle.get(frameId) ?? new Set<string>()
      lifecycle.add(
        name === "networkIdle"
          ? "networkidle"
          : name === "DOMContentLoaded"
            ? "domcontentloaded"
            : name,
      )
      state.lifecycle.set(frameId, lifecycle)
      notifyState(state)
    }
    return
  }

  if (method === "Page.fileChooserOpened") {
    const pending = [...state.pendingEvents].find((item) =>
      item.event === "filechooser"
      && item.generation === state.documentGeneration
    )
    const backendNodeId = readNumber(params.backendNodeId)
    if (pending && backendNodeId !== undefined) {
      const handle: FileChooserHandle = {
        kind: "filechooser",
        eventID: eventHandleID(),
        tabId: state.tabId,
        generation: state.documentGeneration,
        sessionId: source.sessionId,
        expiresAt: Date.now() + EVENT_TTL_MS,
        backendNodeId,
        frameId: readString(params.frameId) || undefined,
        multiple: readString(params.mode) === "selectMultiple",
      }
      settlePendingEvent(state, pending, handle)
    }
    return
  }

  if (method === "Browser.downloadWillBegin") {
    const pending = [...state.pendingEvents].find((item) =>
      item.event === "download"
      && item.generation === state.documentGeneration
    )
    const guid = readString(params.guid)
    if (pending && guid) {
      const handle: DownloadHandle = {
        kind: "download",
        eventID: eventHandleID(),
        tabId: state.tabId,
        generation: state.documentGeneration,
        sessionId: source.sessionId,
        expiresAt: Date.now() + EVENT_TTL_MS,
        guid,
        suggestedFilename: readString(params.suggestedFilename) || undefined,
        state: "inProgress",
        path: downloadDirectory
          ? `${downloadDirectory.replace(/[\\/]$/u, "")}/${guid}`
          : undefined,
      }
      settlePendingEvent(state, pending, handle)
    }
    return
  }

  if (method === "Browser.downloadProgress") {
    const guid = readString(params.guid)
    for (const handle of state.eventHandles.values()) {
      if (handle.kind !== "download" || handle.guid !== guid) continue
      const progressState = readString(params.state)
      if (
        progressState === "completed"
        || progressState === "canceled"
        || progressState === "inProgress"
      ) {
        handle.state = progressState
      }
      const filePath = readString(params.filePath)
      if (filePath) handle.path = filePath
      notifyState(state)
    }
  }
}

subscribeCdpEvents((source, method, params) => {
  void processCdpEvent(source, method, params)
})

subscribeCdpDetach((source, reason) => {
  const state = tabStates.get(source.tabId)
  if (!state) return
  rejectPendingEvents(
    state,
    browserError(
      "BACKEND_UNAVAILABLE",
      `Chrome detached the Locator debugger session${
        reason ? `: ${reason}` : "."
      }`,
      true,
    ),
  )
  tabStates.delete(source.tabId)
})

export function configurePlaywrightDownloadDirectory(
  directory: string | undefined,
) {
  downloadDirectory = directory?.trim() || undefined
}

async function waitForEventCommand(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const event = readString(params.event) as "download" | "filechooser"
  const timeout = timeoutFrom(params)
  let fileChooserSessions: Set<string | undefined> | undefined
  if (event === "download") {
    if (!downloadDirectory) {
      throw browserError(
        "BACKEND_UPDATE_REQUIRED",
        "The Browser Host did not provide its managed download directory.",
        false,
      )
    }
    await sendCdp(state.tabId, "Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: downloadDirectory,
      eventsEnabled: true,
    }, signal)
  } else {
    fileChooserSessions = new Set<string | undefined>([
      undefined,
      ...[...state.frames.values()].map((frame) => frame.sessionId),
    ])
    await Promise.all([...fileChooserSessions].map((sessionId) =>
      sendCdp(
        state.tabId,
        "Page.setInterceptFileChooserDialog",
        { enabled: true },
        signal,
        sessionId,
      ).catch(() => undefined)
    ))
  }

  const handle = await new Promise<EventHandle>((resolve, reject) => {
    const pending: PendingEvent = {
      event,
      generation: state.documentGeneration,
      resolve,
      reject,
      timer: setTimeout(() => {
        state.pendingEvents.delete(pending)
        pending.cleanup?.()
        reject(browserError(
          "DEADLINE_EXCEEDED",
          `Timed out waiting for browser event '${event}'.`,
          true,
          {
            phase: "event-wait",
            documentGeneration: state.documentGeneration,
          },
        ))
      }, timeout),
    }
    const cleanups: Array<() => void> = []
    if (signal) {
      const onAbort = () => {
        state.pendingEvents.delete(pending)
        clearTimeout(pending.timer)
        pending.cleanup?.()
        reject(commandAbortedError())
      }
      signal.addEventListener("abort", onAbort, { once: true })
      cleanups.push(() => signal.removeEventListener("abort", onAbort))
    }
    if (fileChooserSessions) {
      cleanups.push(() => {
        void Promise.all([...fileChooserSessions!].map((sessionId) =>
          sendCdp(
            state.tabId,
            "Page.setInterceptFileChooserDialog",
            { enabled: false },
            undefined,
            sessionId,
          ).catch(() => undefined)
        ))
      })
    }
    pending.cleanup = () => {
      for (const cleanup of cleanups) cleanup()
      cleanups.length = 0
    }
    state.pendingEvents.add(pending)
  })

  return {
    ...await resultBase(state),
    event: handle.kind,
    eventID: handle.eventID,
    ...(handle.kind === "filechooser"
      ? { multiple: handle.multiple }
      : {}),
  }
}

function requireEventHandle(
  state: TabState,
  eventID: string,
  kind: "download",
): DownloadHandle
function requireEventHandle(
  state: TabState,
  eventID: string,
  kind: "filechooser",
): FileChooserHandle
function requireEventHandle(
  state: TabState,
  eventID: string,
  kind: EventHandle["kind"],
): EventHandle {
  const handle = state.eventHandles.get(eventID)
  if (
    !handle
    || handle.kind !== kind
    || handle.tabId !== state.tabId
    || handle.generation !== state.documentGeneration
    || handle.expiresAt <= Date.now()
  ) {
    state.eventHandles.delete(eventID)
    throw browserError(
      "EVENT_EXPIRED",
      `The ${kind} event handle is expired, already consumed, or belongs to another document.`,
      false,
      {
        phase: "event-handle",
        documentGeneration: state.documentGeneration,
      },
    )
  }
  return handle
}

async function downloadPath(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const eventID = readString(params.eventID)
  const handle = requireEventHandle(state, eventID, "download")
  const deadline = Date.now() + timeoutFrom(params)
  while (handle.state === "inProgress" && Date.now() < deadline) {
    await waitForRevision(
      state,
      Math.min(1_000, deadline - Date.now()),
      signal,
    )
    requireEventHandle(state, eventID, "download")
  }
  if (handle.state === "inProgress") {
    throw browserError(
      "DEADLINE_EXCEEDED",
      "The download did not complete before the deadline.",
      true,
      {
        phase: "download",
        documentGeneration: state.documentGeneration,
      },
    )
  }
  state.eventHandles.delete(eventID)
  if (handle.state === "canceled") {
    throw browserError(
      "COMMAND_FAILED",
      "Chrome canceled the download.",
      false,
      {
        phase: "download",
        documentGeneration: state.documentGeneration,
      },
    )
  }
  return { ...await resultBase(state), path: handle.path ?? null }
}

async function fileChooserSetFiles(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const eventID = readString(params.eventID)
  const handle = requireEventHandle(state, eventID, "filechooser")
  const files = Array.isArray(params.files)
    ? params.files.filter((item): item is string => typeof item === "string")
    : []
  if (!handle.multiple && files.length > 1) {
    throw browserError(
      "LOCATOR_NOT_ACTIONABLE",
      "This file chooser accepts only one local file.",
      false,
      {
        phase: "file-chooser",
        documentGeneration: state.documentGeneration,
      },
    )
  }
  state.eventHandles.delete(eventID)
  let dispatched = false
  try {
    dispatched = true
    await sendCdp(state.tabId, "DOM.setFileInputFiles", {
      files,
      backendNodeId: handle.backendNodeId,
    }, signal, handle.sessionId)
    return { ...await resultBase(state), fileCount: files.length }
  } catch (error) {
    if (dispatched) {
      throw browserError(
        "ACTION_OUTCOME_UNKNOWN",
        "File paths were dispatched to Chrome, but the chooser outcome could not be confirmed. Do not replay without a new chooser event.",
        false,
        {
          phase: "post-dispatch",
          action: "fileChooser.setFiles",
          documentGeneration: state.documentGeneration,
        },
      )
    }
    throw error
  }
}

function globMatches(value: string, pattern: string) {
  if (!pattern.includes("*")) return value === pattern
  const source = pattern
    .replace(/[.+?^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*")
  return new RegExp(`^${source}$`, "u").test(value)
}

function navigationReady(
  state: TabState,
  fromGeneration: number,
  urlPattern: string | undefined,
  waitUntil: string,
) {
  const frameId = state.mainFrameId
  if (
    !frameId
    || state.lastMainNavigationGeneration <= fromGeneration
  ) {
    return false
  }
  const frame = state.frames.get(frameId)
  if (urlPattern && !globMatches(frame?.url ?? "", urlPattern)) return false
  if (waitUntil === "commit") return true
  return state.lifecycle.get(frameId)?.has(waitUntil) === true
}

async function waitForNavigation(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const mode = readString(params.mode)
  if (mode === "register") {
    for (const [waiterID, registration] of state.navigationWaiters) {
      if (registration.expiresAt <= Date.now()) {
        state.navigationWaiters.delete(waiterID)
      }
    }
    while (state.navigationWaiters.size >= 128) {
      const oldest = state.navigationWaiters.keys().next().value
      if (typeof oldest !== "string") break
      state.navigationWaiters.delete(oldest)
    }
    const registration: NavigationRegistration = {
      waiterID: eventHandleID(),
      fromGeneration: state.documentGeneration,
      url: readString(params.url) || undefined,
      waitUntil: readString(params.waitUntil, "load"),
      expiresAt: Date.now() + EVENT_TTL_MS,
    }
    state.navigationWaiters.set(registration.waiterID, registration)
    return {
      ...await resultBase(state),
      matched: true,
      state: "registered",
      waiterID: registration.waiterID,
    }
  }
  if (mode === "cancel") {
    const waiterID = readString(params.waiterID)
    const cancelled = state.navigationWaiters.delete(waiterID)
    return {
      ...await resultBase(state),
      matched: cancelled,
      state: "cancelled",
    }
  }

  let registration: NavigationRegistration | undefined
  if (mode === "wait") {
    const waiterID = readString(params.waiterID)
    registration = state.navigationWaiters.get(waiterID)
    state.navigationWaiters.delete(waiterID)
    if (!registration || registration.expiresAt <= Date.now()) {
      throw browserError(
        "EVENT_EXPIRED",
        "The registered navigation waiter expired or was already consumed.",
        false,
        {
          phase: "navigation-registration",
          documentGeneration: state.documentGeneration,
        },
      )
    }
  }

  const fromGeneration = registration?.fromGeneration ?? readNumber(
    params.fromGeneration,
    state.documentGeneration,
  )!
  const url = registration?.url ?? (readString(params.url) || undefined)
  const waitUntil = registration?.waitUntil
    ?? readString(params.waitUntil, "load")
  const deadline = Date.now() + timeoutFrom(params)
  while (
    !navigationReady(state, fromGeneration, url, waitUntil)
    && Date.now() < deadline
  ) {
    await waitForRevision(
      state,
      Math.min(1_000, deadline - Date.now()),
      signal,
    )
  }
  if (!navigationReady(state, fromGeneration, url, waitUntil)) {
    throw browserError(
      "DEADLINE_EXCEEDED",
      "The expected navigation did not reach its requested state before the deadline.",
      true,
      {
        phase: "navigation",
        documentGeneration: state.documentGeneration,
        fromGeneration,
      },
    )
  }
  return {
    ...await resultBase(state),
    matched: true,
    state: waitUntil,
  }
}

async function waitForLoadState(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const desired = readString(params.state, "load")
  const deadline = Date.now() + timeoutFrom(params)
  const isReady = async () => {
    const frameId = state.mainFrameId
    if (!frameId) return false
    const lifecycle = state.lifecycle.get(frameId) ?? new Set<string>()
    if (lifecycle.has(desired)) return true
    if (desired === "networkidle") return false
    try {
      const route = await mainFrameRoute(state, signal)
      const readyState = readString((await evaluate(
        state,
        route,
        "document.readyState",
        { returnByValue: true, signal },
      )).value)
      if (readyState === "interactive" || readyState === "complete") {
        lifecycle.add("domcontentloaded")
      }
      if (readyState === "complete") lifecycle.add("load")
      state.lifecycle.set(frameId, lifecycle)
      return lifecycle.has(desired)
    } catch {
      throwIfCommandAborted(signal)
      return false
    }
  }
  while (!await isReady() && Date.now() < deadline) {
    await waitForRevision(
      state,
      Math.min(1_000, deadline - Date.now()),
      signal,
    )
  }
  if (!await isReady()) {
    throw browserError(
      "DEADLINE_EXCEEDED",
      `The page did not reach load state '${desired}' before the deadline.`,
      true,
      {
        phase: "load-state",
        documentGeneration: state.documentGeneration,
      },
    )
  }
  return {
    ...await resultBase(state),
    matched: true,
    state: desired,
  }
}

async function waitForURL(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const pattern = readString(params.url)
  const desired = readString(params.waitUntil, "load")
  const deadline = Date.now() + timeoutFrom(params)
  const isReady = async () => {
    const frameId = state.mainFrameId
    if (!frameId) return false
    if (!globMatches(state.frames.get(frameId)?.url ?? "", pattern)) {
      return false
    }
    if (desired === "commit") return true
    if (state.lifecycle.get(frameId)?.has(desired) === true) return true
    if (desired === "networkidle") return false
    try {
      const route = await mainFrameRoute(state, signal)
      const readyState = readString((await evaluate(
        state,
        route,
        "document.readyState",
        { returnByValue: true, signal },
      )).value)
      return desired === "domcontentloaded"
        ? readyState === "interactive" || readyState === "complete"
        : readyState === "complete"
    } catch {
      throwIfCommandAborted(signal)
      return false
    }
  }
  while (!await isReady() && Date.now() < deadline) {
    await waitForRevision(
      state,
      Math.min(1_000, deadline - Date.now()),
      signal,
    )
  }
  if (!await isReady()) {
    throw browserError(
      "DEADLINE_EXCEEDED",
      "The page URL did not match before the deadline.",
      true,
      {
        phase: "url-wait",
        documentGeneration: state.documentGeneration,
      },
    )
  }
  return {
    ...await resultBase(state),
    matched: true,
    state: desired,
  }
}

function orderedFrames(state: TabState) {
  const result: Array<{ frame: FrameInfo; depth: number }> = []
  const visit = (frameId: string, depth: number) => {
    const frame = state.frames.get(frameId)
    if (!frame) return
    result.push({ frame, depth })
    for (const child of state.frames.values()) {
      if (child.parentFrameId === frameId) visit(child.frameId, depth + 1)
    }
  }
  if (state.mainFrameId) visit(state.mainFrameId, 0)
  return result
}

function snapshotExpression(maxNodes: number, maxChars: number) {
  return `(()=>{const engine=globalThis[${JSON.stringify(ENGINE_GLOBAL)}];const privacy=globalThis[${JSON.stringify(PRIVACY_GLOBAL)}];const lines=[];let nodeCount=0;let chars=0;let truncated=false;const normalize=value=>String(value??"").replace(/\\s+/g," ").trim();const append=line=>{if(chars+line.length+1>${maxChars}){truncated=true;return false}lines.push(line);chars+=line.length+1;return true};const visit=root=>{for(const element of root.querySelectorAll("*")){if(nodeCount>=${maxNodes}){truncated=true;return}const tag=element.tagName.toLowerCase();if(["script","style","noscript","template"].includes(tag))continue;nodeCount++;const sensitive=privacy.sensitive(element);const privateEditable=privacy.privateEditable(element);const role=engine.utils.getAriaRole(element)||element.getAttribute("role")||"";const rawName=engine.utils.getElementAccessibleName(element,false);const name=sensitive?"[redacted]":privacy.safeMetadata(element,rawName).slice(0,300);const testId=sensitive?"":privacy.safeMetadata(element,element.getAttribute("data-testid")).slice(0,200);const placeholder=sensitive?"":privacy.safeMetadata(element,element.getAttribute("placeholder")).slice(0,200);const directText=sensitive||privateEditable?"":normalize(Array.from(element.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join(" ")).slice(0,300);const parts=[role||tag];if(name)parts.push(JSON.stringify(name));else if(directText)parts.push(JSON.stringify(directText));if(testId)parts.push(\`[testid=\${JSON.stringify(testId)}]\`);if(placeholder)parts.push(\`[placeholder=\${JSON.stringify(placeholder)}]\`);if(tag==="iframe"||tag==="frame")parts.push("[frame]");if(!append("- "+parts.join(" ")))return;if(element.shadowRoot)visit(element.shadowRoot);if(truncated)return}};visit(document);return {snapshot:lines.join("\\n"),nodeCount,truncated}})()`
}

async function domSnapshot(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const maxNodes = Math.min(
    PLAYWRIGHT_DOM_SNAPSHOT_MAX_NODES,
    Math.max(1, Math.trunc(readNumber(
      params.maxNodes,
      PLAYWRIGHT_DOM_SNAPSHOT_MAX_NODES,
    )!)),
  )
  const maxChars = Math.min(
    PLAYWRIGHT_DOM_SNAPSHOT_MAX_CHARS,
    Math.max(16, Math.trunc(readNumber(
      params.maxChars,
      PLAYWRIGHT_DOM_SNAPSHOT_MAX_CHARS,
    )!)),
  )

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const generation = state.documentGeneration
    const sections: string[] = []
    let nodeCount = 0
    let truncated = false
    let chars = 0
    for (const { frame, depth } of orderedFrames(state)) {
      if (nodeCount >= maxNodes || chars >= maxChars) {
        truncated = true
        break
      }
      try {
        const contextId = await ensureFrameContext(state, frame, signal)
        const route: FrameRoute = {
          frame,
          contextId,
          offsetX: 0,
          offsetY: 0,
          framePath: [{ frameId: frame.frameId }],
        }
        const remainingNodes = maxNodes - nodeCount
        const remainingChars = maxChars - chars
        const object = await evaluate(
          state,
          route,
          snapshotExpression(remainingNodes, remainingChars),
          { returnByValue: true, signal },
        )
        const value = readRecord(object.value)
        const marker = depth === 0
          ? "[document]"
          : `${"  ".repeat(depth)}[frame depth=${depth}]`
        const body = readString(value.snapshot)
        const section = body ? `${marker}\n${body}` : marker
        if (chars + section.length + 1 > maxChars) {
          const available = Math.max(0, maxChars - chars)
          sections.push(section.slice(0, available))
          chars = maxChars
          truncated = true
          break
        }
        sections.push(section)
        chars += section.length + 1
        nodeCount += Math.max(
          0,
          Math.trunc(readNumber(value.nodeCount, 0)!),
        )
        truncated = truncated || value.truncated === true
      } catch {
        if (state.documentGeneration !== generation) break
        sections.push(`${"  ".repeat(depth)}[frame unavailable]`)
      }
    }
    if (state.documentGeneration !== generation) continue
    let snapshot = sections.join("\n")
    if (truncated) {
      const detailedMarker =
        `[snapshot truncated: ${nodeCount}/${maxNodes} nodes, ${Math.min(chars, maxChars)}/${maxChars} chars]`
      const marker = detailedMarker.length <= maxChars
        ? detailedMarker
        : "[truncated]"
      const prefixLength = Math.max(0, maxChars - marker.length - 1)
      snapshot = `${snapshot.slice(0, prefixLength)}\n${marker}`
        .slice(0, maxChars)
    }
    return {
      ...await resultBase(state),
      snapshot,
      nodeCount,
      truncated,
    }
  }
  throw browserError(
    "STALE_DOCUMENT",
    "The document changed repeatedly while capturing its semantic snapshot.",
    true,
    {
      phase: "dom-snapshot",
      documentGeneration: state.documentGeneration,
    },
  )
}

async function elementInfo(
  state: TabState,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const x = readNumber(params.x, 0)!
  const y = readNumber(params.y, 0)!
  const includeNonInteractable = params.includeNonInteractable === true
  let route = await mainFrameRoute(state, signal)
  const frameSelectors: string[] = []

  for (let depth = 0; depth < 16; depth += 1) {
    const localX = x - route.offsetX
    const localY = y - route.offsetY
    const frameObject = await evaluate(
      state,
      route,
      `(()=>{const element=document.elementFromPoint(${JSON.stringify(localX)},${JSON.stringify(localY)});if(!element)return null;if(element.matches("iframe,frame"))return element;return element.closest("iframe,frame")})()`,
      { returnByValue: false, signal },
    )
    if (!frameObject.objectId) break
    const frameElement: ResolvedElement = {
      route,
      objectId: frameObject.objectId,
      summary: { count: 1, previews: [] },
    }
    let nextRoute: FrameRoute | undefined
    try {
      const frameData = readRecord(await callElement(
        state,
        frameElement,
        `function(){${PUBLIC_SELECTOR_HELPERS}const sensitive=globalThis[${JSON.stringify(PRIVACY_GLOBAL)}].sensitive(this);const rect=this.getBoundingClientRect();const style=getComputedStyle(this);return {x:rect.x+(parseFloat(style.borderLeftWidth)||0)+(parseFloat(style.paddingLeft)||0),y:rect.y+(parseFloat(style.borderTopWidth)||0)+(parseFloat(style.paddingTop)||0),selector:selectorsFor(this,sensitive)}}`,
        [],
        { signal },
      ))
      const described = readRecord(await sendCdp(
        state.tabId,
        "DOM.describeNode",
        { objectId: frameElement.objectId, depth: 0, pierce: true },
        signal,
        route.frame.sessionId,
      ))
      const frameId = readString(readRecord(described.node).frameId)
      const child = frameId ? state.frames.get(frameId) : undefined
      if (!child) break
      const selector = readString(readRecord(frameData.selector).primary)
      if (selector) frameSelectors.push(selector)
      nextRoute = {
        frame: child,
        contextId: await ensureFrameContext(state, child, signal),
        offsetX: route.offsetX + (readNumber(frameData.x, 0) ?? 0),
        offsetY: route.offsetY + (readNumber(frameData.y, 0) ?? 0),
        framePath: [...route.framePath, { frameId }],
      }
    } finally {
      await releaseObject(state, frameElement)
    }
    if (!nextRoute) break
    route = nextRoute
  }

  const localX = x - route.offsetX
  const localY = y - route.offsetY
  const object = await evaluate(
    state,
    route,
    `(()=>{const engine=globalThis[${JSON.stringify(ENGINE_GLOBAL)}];const privacy=globalThis[${JSON.stringify(PRIVACY_GLOBAL)}];${PUBLIC_SELECTOR_HELPERS}const seen=new Set();const elements=[];for(const candidate of document.elementsFromPoint(${JSON.stringify(localX)},${JSON.stringify(localY)})){let element=candidate;while(element){if(!seen.has(element)){seen.add(element);elements.push(element)}element=element.parentElement}}return elements.slice(0,50).map(element=>{const rect=element.getBoundingClientRect();const visible=engine.utils.isElementVisible(element);const sensitive=privacy.sensitive(element);const role=engine.utils.getAriaRole(element)||element.getAttribute("role")||null;const rawName=engine.utils.getElementAccessibleName(element,false);const ariaName=sensitive?"[redacted]":privacy.safeMetadata(element,rawName).slice(0,500)||null;const visibleText=sensitive?"[redacted]":privacy.redactText(element,element.innerText||element.textContent).slice(0,2000)||null;const testId=sensitive?null:privacy.safeMetadata(element,element.getAttribute("data-testid")).slice(0,512)||null;return {interactable:visible&&rect.width>0&&rect.height>0,info:{ariaName,boundingBox:{x:rect.x+${JSON.stringify(route.offsetX)},y:rect.y+${JSON.stringify(route.offsetY)},width:rect.width,height:rect.height},preview:\`<\${element.tagName.toLowerCase()}\${role?\` role="\${role}"\`:""}\${ariaName?\` name="\${ariaName}"\`:""}>\`.slice(0,500),role,selector:{...selectorsFor(element,sensitive),frameSelectors:${JSON.stringify(frameSelectors)}},tagName:element.tagName.toLowerCase(),testId,visibleText}}}).filter(item=>${includeNonInteractable}||item.interactable).map(item=>item.info)})()`,
    { returnByValue: true, signal },
  )
  const elements = Array.isArray(object.value)
    ? object.value.slice(0, 50)
    : []
  return { ...await resultBase(state), elements }
}

async function executePlaywrightCommandCore(
  method: BrowserContractV3PlaywrightCommandMethod,
  rawParams: unknown,
  signal?: AbortSignal,
) {
  const params = readRecord(rawParams)
  const tabId = readNumber(params.tabId)
  if (!tabId || !Number.isInteger(tabId)) {
    throw browserError(
      "INVALID_COMMAND_PARAMS",
      `Browser command '${method}' requires a positive tabId.`,
      false,
    )
  }
  const state = await ensureTabInitialized(tabId, signal)
  switch (method) {
    case "playwright.domSnapshot":
      return await domSnapshot(state, params, signal)
    case "playwright.elementInfo":
      return await elementInfo(state, params, signal)
    case "playwright.locator.count":
      return await locatorCount(state, params, signal)
    case "playwright.locator.allTextContents":
      return await locatorAllTextContents(state, params, signal)
    case "playwright.locator.textContent":
      return await locatorRead(state, params, "textContent", signal)
    case "playwright.locator.innerText":
      return await locatorRead(state, params, "innerText", signal)
    case "playwright.locator.inputValue":
      return await locatorRead(state, params, "inputValue", signal)
    case "playwright.locator.getAttribute":
      return await locatorRead(state, params, "attribute", signal)
    case "playwright.locator.isVisible":
      return await locatorRead(state, params, "visible", signal)
    case "playwright.locator.isEnabled":
      return await locatorRead(state, params, "enabled", signal)
    case "playwright.locator.waitFor":
      return await locatorWaitFor(state, params, signal)
    case "playwright.locator.click":
      return await locatorClick(state, params, false, signal)
    case "playwright.locator.dblclick":
      return await locatorClick(state, params, true, signal)
    case "playwright.locator.fill":
      return await locatorFill(state, params, signal)
    case "playwright.locator.type":
      return await locatorType(state, params, signal)
    case "playwright.locator.press":
      return await locatorPress(state, params, signal)
    case "playwright.locator.selectOption":
      return await locatorSelectOption(state, params, signal)
    case "playwright.locator.setChecked":
      return await locatorSetChecked(state, params, signal)
    case "playwright.waitForNavigation":
      return await waitForNavigation(state, params, signal)
    case "playwright.waitForLoadState":
      return await waitForLoadState(state, params, signal)
    case "playwright.waitForURL":
      return await waitForURL(state, params, signal)
    case "playwright.waitForEvent":
      return await waitForEventCommand(state, params, signal)
    case "playwright.download.path":
      return await downloadPath(state, params, signal)
    case "playwright.fileChooser.setFiles":
      return await fileChooserSetFiles(state, params, signal)
  }
}

export async function executePlaywrightCommand(
  method: BrowserContractV3PlaywrightCommandMethod,
  rawParams: unknown,
  signal?: AbortSignal,
) {
  const startedAt = performance.now()
  try {
    const result = await executePlaywrightCommandCore(
      method,
      rawParams,
      signal,
    )
    const value = readRecord(result)
    const strictSuccess = [
      "playwright.locator.textContent",
      "playwright.locator.innerText",
      "playwright.locator.inputValue",
      "playwright.locator.getAttribute",
      "playwright.locator.isVisible",
      "playwright.locator.isEnabled",
      "playwright.locator.click",
      "playwright.locator.dblclick",
      "playwright.locator.fill",
      "playwright.locator.type",
      "playwright.locator.press",
      "playwright.locator.selectOption",
      "playwright.locator.setChecked",
    ].includes(method)
    const matchCount = typeof value.count === "number"
      ? value.count
      : method === "playwright.locator.allTextContents"
          && Array.isArray(value.values)
        ? value.values.length
        : strictSuccess
          ? 1
          : undefined
    recordLocatorMetric({
      event: "command",
      method,
      durationMs: performance.now() - startedAt,
      ...(matchCount === undefined ? {} : { matchCount }),
    })
    return result
  } catch (error) {
    const errorCode = error
      && typeof error === "object"
      && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: BrowserContractErrorCode }).code
      : "INTERNAL_ERROR"
    recordLocatorMetric({
      event: "command",
      method,
      durationMs: performance.now() - startedAt,
      errorCode,
    })
    throw error
  }
}

export function releasePlaywrightTab(tabId: number) {
  const state = tabStates.get(tabId)
  if (!state) return
  rejectPendingEvents(
    state,
    browserError(
      "SESSION_ENDED",
      "The browser tab lease ended before the pending Locator operation completed.",
      false,
    ),
  )
  tabStates.delete(tabId)
}

export function resetPlaywrightExecutor() {
  for (const tabId of [...tabStates.keys()]) releasePlaywrightTab(tabId)
  engineSourcePromise = undefined
}
