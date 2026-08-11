import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  CinemaProviderWorkflowCatalogSchema,
  type CinemaProviderWorkflow,
  type CinemaProviderWorkflowCatalog,
  type CinemaProviderWorkflowDependency,
  type CinemaProviderWorkflowIssue,
  type CinemaProviderWorkflowOutput,
  type CinemaProviderWorkflowUser,
  type GenerationControl,
  type GenerationFormSpec,
} from "@anybox/cinema-plugin/contracts"
import * as Config from "#config/config.ts"
import * as Global from "#global/global.ts"
import { ApiError } from "#server/error.ts"
import {
  assertSafeProviderURL,
  normalizeProviderBaseURL,
  sameOriginFetch,
} from "../providers/network-policy.ts"

export const COMFYUI_PROVIDER_ID = "comfyui-local"
export const COMFYUI_DEFAULT_BASE_URL = "http://127.0.0.1:8188"
export const COMFYUI_WORKFLOW_CONVERTER_VERSION = "anybox-comfyui-ui-to-api/4"
export const COMFYUI_WORKFLOW_LIMITS = {
  maxWorkflows: 500,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  readConcurrency: 4,
} as const

const REQUEST_TIMEOUT_MS = 15_000
const RESPONSE_MAX_BYTES = 64 * 1024 * 1024
const CACHE_SCHEMA_VERSION = 1
const UI_ONLY_NODE_TYPES = new Set(["Note", "MarkdownNote", "PrimitiveNode", "GetNode", "SetNode", "Reroute"])
const BASIC_WIDGET_TYPES = new Set(["STRING", "INT", "FLOAT", "BOOLEAN", "COMBO"])
const CONTROL_AFTER_GENERATE_VALUES = new Set(["fixed", "increment", "decrement", "randomize"])
const MODEL_INPUT_FOLDERS: Record<string, string> = {
  ckpt_name: "checkpoints",
  checkpoint: "checkpoints",
  model_name: "checkpoints",
  unet_name: "diffusion_models",
  diffusion_model: "diffusion_models",
  lora_name: "loras",
  vae_name: "vae",
  clip_name: "text_encoders",
  text_encoder_name: "text_encoders",
  control_net_name: "controlnet",
  controlnet_name: "controlnet",
  upscale_model: "upscale_models",
  upscale_model_name: "upscale_models",
  latent_upscale_model: "latent_upscale_models",
}

type JsonRecord = Record<string, unknown>
type ApiPromptNode = {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: { title?: string }
}
export type ComfyUIApiPrompt = Record<string, ApiPromptNode>

type NormalizedLink = {
  id: string
  originID: string
  originSlot: number
  targetID: string
  targetSlot: number
  type?: string
}

type NormalizedNode = JsonRecord & {
  id: string
  type: string
  mode: number
  inputs: JsonRecord[]
  outputs: JsonRecord[]
  widgets_values?: unknown[] | JsonRecord
}

type Binding = {
  nodeID: string
  inputName: string
  dynamicComboTemplates?: Array<{
    option: string | number | boolean
    promptInputs: Record<string, unknown>
  }>
}

type BuiltinConversion = {
  prompt: ComfyUIApiPrompt
  bindingCandidates: Map<string, Binding[]>
  nodeTypes: Set<string>
}

export type InternalComfyUIWorkflow = {
  publicWorkflow: CinemaProviderWorkflow
  uiWorkflow: JsonRecord
  apiPrompt: ComfyUIApiPrompt
  bindings: Record<string, Binding[]>
  outputNodeIDs: string[]
}

type InternalCatalog = {
  publicCatalog: CinemaProviderWorkflowCatalog
  workflows: Map<string, InternalComfyUIWorkflow>
  endpoint: string
  userID: string | null
}

type RefreshOptions = {
  baseURL?: string | null
  userID?: string | null
  force?: boolean
}

type FileEntry = {
  path: string
  size: number
  modified?: number
}

type CachedCatalogFile = {
  schemaVersion: number
  catalog: CinemaProviderWorkflowCatalog
}

const catalogPromises = new Map<string, Promise<InternalCatalog>>()
const catalogs = new Map<string, InternalCatalog>()
let cacheRootOverride: string | undefined
let configuredConnectionOverride: { baseURL: string; userID: string | null } | undefined

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function integerValue(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function workflowIssue(
  code: string,
  message: string,
  details: Partial<CinemaProviderWorkflowIssue> = {},
): CinemaProviderWorkflowIssue {
  return { code, message, severity: "error", ...details }
}

function sanitizeWorkflowPath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "")
  if (
    !normalized
    || normalized.includes("\0")
    || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new ApiError(502, "COMFYUI_WORKFLOW_PATH_INVALID", "ComfyUI returned an unsafe workflow path.")
  }
  return normalized
}

function encodeUserDataFilePath(value: string) {
  // ComfyUI exposes GET /userdata/{file} as a single route parameter.
  // Encode directory separators so nested user-data paths stay inside {file}.
  return encodeURIComponent(value)
}

export function validateComfyUIBaseURL(value: string | null | undefined) {
  const candidate = value?.trim() || COMFYUI_DEFAULT_BASE_URL
  const url = new URL(normalizeProviderBaseURL(candidate))
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new ApiError(400, "PROVIDER_CONFIGURATION_INVALID", "ComfyUI endpoint cannot contain a path.")
  }
  return url.origin
}

export async function configuredComfyUIConnection() {
  if (configuredConnectionOverride) return { ...configuredConnectionOverride }
  const settings = await Config.getCinemaVideoProviderSettings(COMFYUI_PROVIDER_ID)
  return {
    baseURL: validateComfyUIBaseURL(settings.baseURL),
    userID: settings.userID?.trim() || null,
  }
}

export function urlForComfyUI(baseURL: string, route: string) {
  return new URL(route.replace(/^\/+/, ""), `${validateComfyUIBaseURL(baseURL)}/`)
}

export async function assertComfyUIEndpointResolvesToLoopback(baseURL: string) {
  await assertSafeProviderURL(validateComfyUIBaseURL(baseURL))
}

export function isComfyUINetworkError(error: unknown) {
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) return true
  const message = error instanceof Error ? error.message : String(error)
  return /fetch|network|unable to connect|access the url|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|refused/i.test(message)
}

function comfyHeaders(userID: string | null, initial?: RequestInit["headers"]) {
  const headers = new Headers(initial)
  if (userID) headers.set("Comfy-User", userID)
  return headers
}

async function readBoundedText(response: Response, limit = RESPONSE_MAX_BYTES) {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limit) {
    throw new ApiError(502, "COMFYUI_RESPONSE_TOO_LARGE", "ComfyUI returned an unexpectedly large response.")
  }
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > limit) {
        await reader.cancel()
        throw new ApiError(502, "COMFYUI_RESPONSE_TOO_LARGE", "ComfyUI returned an unexpectedly large response.")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")
}

export async function fetchComfyUI(
  baseURL: string,
  route: string,
  userID: string | null,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
  await assertComfyUIEndpointResolvesToLoopback(baseURL)
  try {
    return await sameOriginFetch(urlForComfyUI(baseURL, route), {
      ...init,
      headers: comfyHeaders(userID, init.headers),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (isComfyUINetworkError(error)) {
      throw new ApiError(503, "COMFYUI_OFFLINE", "Local ComfyUI is unavailable.")
    }
    throw error
  }
}

export async function requestComfyUIJSON(
  baseURL: string,
  route: string,
  userID: string | null,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
  const response = await fetchComfyUI(baseURL, route, userID, init, timeoutMs)
  if (!response.ok) {
    throw new ApiError(
      response.status >= 400 && response.status < 500 ? 400 : 502,
      "COMFYUI_HTTP_ERROR",
      `ComfyUI returned HTTP ${response.status}.`,
      { status: response.status, route },
    )
  }
  const text = await readBoundedText(response)
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ApiError(502, "COMFYUI_RESPONSE_INVALID", "ComfyUI returned invalid JSON.")
  }
}

async function optionalComfyUIJSON(
  baseURL: string,
  route: string,
  userID: string | null,
  init: RequestInit = {},
) {
  const response = await fetchComfyUI(baseURL, route, userID, init)
  if (response.status === 404 || response.status === 405) return undefined
  if (!response.ok) {
    throw new ApiError(
      response.status >= 400 && response.status < 500 ? 400 : 502,
      "COMFYUI_HTTP_ERROR",
      `ComfyUI returned HTTP ${response.status}.`,
      { status: response.status, route },
    )
  }
  const text = await readBoundedText(response)
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ApiError(502, "COMFYUI_RESPONSE_INVALID", "ComfyUI returned invalid JSON.")
  }
}

function cacheKey(endpoint: string, userID: string | null) {
  return `${endpoint}\0${userID ?? ""}`
}

export function comfyUIConnectionID(endpoint: string, userID: string | null) {
  const normalizedEndpoint = validateComfyUIBaseURL(endpoint)
  const normalizedUserID = userID?.trim() || null
  return `comfy_${sha256(cacheKey(normalizedEndpoint, normalizedUserID)).slice(0, 32)}`
}

function requestedUserID(value: string | null | undefined, fallback: string | null) {
  return value === undefined ? fallback : value?.trim() || null
}

function cachePath(endpoint: string, userID: string | null) {
  const filename = `${sha256(cacheKey(endpoint, userID))}.json`
  return path.join(cacheRootOverride ?? path.join(Global.Path.data, "cinema", "comfyui-workflows"), filename)
}

async function writePublicCatalogCache(endpoint: string, userID: string | null, catalog: CinemaProviderWorkflowCatalog) {
  const destination = cachePath(endpoint, userID)
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify({
    schemaVersion: CACHE_SCHEMA_VERSION,
    catalog,
  } satisfies CachedCatalogFile), { encoding: "utf8", flag: "wx" })
  await rename(temporary, destination)
}

async function readPublicCatalogCache(endpoint: string, userID: string | null) {
  try {
    const parsed = JSON.parse(await readFile(cachePath(endpoint, userID), "utf8")) as CachedCatalogFile
    if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return undefined
    return CinemaProviderWorkflowCatalogSchema.parse(parsed.catalog)
  } catch {
    return undefined
  }
}

async function discoverUsers(baseURL: string): Promise<CinemaProviderWorkflowUser[]> {
  const value = await optionalComfyUIJSON(baseURL, "/users", null)
  if (!isRecord(value) || !isRecord(value.users)) {
    return [{ id: "default", name: "default" }]
  }
  const users = Object.entries(value.users).flatMap(([id, name]) => (
    stringValue(id) && stringValue(name) ? [{ id, name: String(name) }] : []
  ))
  return users.length > 0 ? users : [{ id: "default", name: "default" }]
}

function selectUser(users: CinemaProviderWorkflowUser[], requested: string | null) {
  if (users.length === 1) return users[0]!.id
  return requested && users.some((user) => user.id === requested) ? requested : null
}

function normalizeFileEntries(value: unknown) {
  if (!Array.isArray(value)) {
    throw new ApiError(502, "COMFYUI_WORKFLOW_LIST_INVALID", "ComfyUI returned an invalid workflow listing.")
  }
  return value.flatMap((item): FileEntry[] => {
    if (typeof item === "string") {
      const workflowPath = sanitizeWorkflowPath(item)
      return workflowPath.toLowerCase().endsWith(".json") ? [{ path: workflowPath, size: 0 }] : []
    }
    if (!isRecord(item) || !stringValue(item.path)) return []
    const workflowPath = sanitizeWorkflowPath(String(item.path))
    if (!workflowPath.toLowerCase().endsWith(".json")) return []
    return [{
      path: workflowPath,
      size: Math.max(0, integerValue(item.size) ?? 0),
      ...(finiteNumber(item.modified) !== undefined ? { modified: Number(item.modified) } : {}),
    }]
  }).sort((left, right) => left.path.localeCompare(right.path))
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index]!, index)
    }
  })
  await Promise.all(workers)
  return results
}

function normalizeLink(value: unknown, fallbackID: string): NormalizedLink | undefined {
  if (Array.isArray(value) && value.length >= 5) {
    const originSlot = integerValue(value[2])
    const targetSlot = integerValue(value[4])
    if (originSlot === undefined || targetSlot === undefined) return undefined
    return {
      id: String(value[0] ?? fallbackID),
      originID: String(value[1]),
      originSlot,
      targetID: String(value[3]),
      targetSlot,
      ...(typeof value[5] === "string" ? { type: value[5] } : {}),
    }
  }
  if (!isRecord(value)) return undefined
  const originID = value.origin_id ?? value.originId
  const targetID = value.target_id ?? value.targetId
  const originSlot = integerValue(value.origin_slot ?? value.originSlot)
  const targetSlot = integerValue(value.target_slot ?? value.targetSlot)
  if (originID === undefined || targetID === undefined || originSlot === undefined || targetSlot === undefined) {
    return undefined
  }
  return {
    id: String(value.id ?? fallbackID),
    originID: String(originID),
    originSlot,
    targetID: String(targetID),
    targetSlot,
    ...(typeof value.type === "string" ? { type: value.type } : {}),
  }
}

function normalizeNode(value: unknown): NormalizedNode | undefined {
  if (!isRecord(value) || value.id === undefined || !stringValue(value.type)) return undefined
  return {
    ...value,
    id: String(value.id),
    type: String(value.type),
    mode: integerValue(value.mode) ?? 0,
    inputs: Array.isArray(value.inputs) ? value.inputs.filter(isRecord).map((input) => ({ ...input })) : [],
    outputs: Array.isArray(value.outputs) ? value.outputs.filter(isRecord).map((output) => ({ ...output })) : [],
    ...(Array.isArray(value.widgets_values) || isRecord(value.widgets_values)
      ? { widgets_values: value.widgets_values as unknown[] | JsonRecord }
      : {}),
  }
}

function collectSubgraphDefinitions(value: unknown, result = new Map<string, JsonRecord>()) {
  if (!isRecord(value)) return result
  const subgraphs = isRecord(value.definitions) && Array.isArray(value.definitions.subgraphs)
    ? value.definitions.subgraphs
    : []
  for (const raw of subgraphs) {
    if (!isRecord(raw) || !stringValue(raw.id)) continue
    result.set(String(raw.id), raw)
    collectSubgraphDefinitions(raw, result)
  }
  return result
}

function inputNameAt(node: NormalizedNode, slot: number) {
  return stringValue(node.inputs[slot]?.name)
}

function addBindingCandidate(map: Map<string, Binding[]>, nodeID: string, inputName: string, binding: Binding) {
  const key = `${nodeID}\0${inputName}`
  const values = map.get(key) ?? []
  if (!values.some((value) => value.nodeID === binding.nodeID && value.inputName === binding.inputName)) {
    values.push(binding)
  }
  map.set(key, values)
}

function reconcileNodeInputLinks(nodes: NormalizedNode[], links: NormalizedLink[]) {
  const incomingBySlot = new Map<string, NormalizedLink>()
  for (const link of links) {
    const key = `${link.targetID}\0${link.targetSlot}`
    if (!incomingBySlot.has(key)) incomingBySlot.set(key, link)
  }
  for (const node of nodes) {
    for (const [slot, input] of node.inputs.entries()) {
      input.link = incomingBySlot.get(`${node.id}\0${slot}`)?.id ?? null
    }
  }
}

function expandSubgraphs(
  root: JsonRecord,
  originalNodes: NormalizedNode[],
  originalLinks: NormalizedLink[],
) {
  const definitions = collectSubgraphDefinitions(root)
  let nodes = [...originalNodes]
  let links = [...originalLinks]
  const externalBindings = new Map<string, Binding[]>()

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const subgraphNode = nodes.find((node) => definitions.has(node.type))
    if (!subgraphNode) break
    const definition = definitions.get(subgraphNode.type)!
    const internalNodes = (Array.isArray(definition.nodes) ? definition.nodes : [])
      .flatMap((value) => {
        const node = normalizeNode(value)
        return node ? [{ ...node, id: `${subgraphNode.id}:${node.id}` }] : []
      })
    const rawInternalLinks = Array.isArray(definition.links) ? definition.links : []
    const internalLinks = rawInternalLinks.flatMap((value, index) => {
      const link = normalizeLink(value, `internal-${index}`)
      return link ? [link] : []
    })
    const definitionInputs = Array.isArray(definition.inputs) ? definition.inputs.filter(isRecord) : []
    const definitionOutputs = Array.isArray(definition.outputs) ? definition.outputs.filter(isRecord) : []
    const inbound = links.filter((link) => link.targetID === subgraphNode.id)
    const outbound = links.filter((link) => link.originID === subgraphNode.id)
    const preserved = links.filter((link) => link.targetID !== subgraphNode.id && link.originID !== subgraphNode.id)
    const resolvedSubgraphInputs = new Map<string, Binding[]>()

    for (const [definitionSlot, definitionInput] of definitionInputs.entries()) {
      const name = stringValue(definitionInput.name)
      const outerSlot = name
        ? subgraphNode.inputs.findIndex((input) => stringValue(input.name) === name)
        : definitionSlot
      const source = inbound.find((link) => link.targetSlot === (outerSlot >= 0 ? outerSlot : definitionSlot))
      const rawLinkIDs = definitionInput.linkIds ?? definitionInput.link_ids
      const linkIDs = Array.isArray(rawLinkIDs)
        ? new Set(rawLinkIDs.map(String))
        : new Set<string>()
      const targets = internalLinks.filter((link) => link.originID === "-10" && linkIDs.has(link.id))
      for (const target of targets) {
        const targetID = `${subgraphNode.id}:${target.targetID}`
        const targetNode = internalNodes.find((node) => node.id === targetID)
        const targetName = targetNode ? inputNameAt(targetNode, target.targetSlot) : undefined
        if (name && targetName) {
          const binding = { nodeID: targetID, inputName: targetName }
          addBindingCandidate(externalBindings, subgraphNode.id, name, binding)
          resolvedSubgraphInputs.set(name, [...(resolvedSubgraphInputs.get(name) ?? []), binding])
        }
        if (source) {
          preserved.push({
            ...source,
            id: `sg-in:${subgraphNode.id}:${definitionSlot}:${target.id}`,
            targetID,
            targetSlot: target.targetSlot,
          })
        }
      }
    }
    for (const [key, candidates] of externalBindings) {
      const expandedCandidates = candidates.flatMap((candidate) => (
        candidate.nodeID === subgraphNode.id
          ? resolvedSubgraphInputs.get(candidate.inputName) ?? [candidate]
          : [candidate]
      ))
      externalBindings.set(
        key,
        expandedCandidates.filter((candidate, index, values) =>
          values.findIndex((value) =>
            value.nodeID === candidate.nodeID && value.inputName === candidate.inputName
          ) === index
        ),
      )
    }

    for (const [definitionSlot, definitionOutput] of definitionOutputs.entries()) {
      const name = stringValue(definitionOutput.name)
      const outerSlot = name
        ? subgraphNode.outputs.findIndex((output) => stringValue(output.name) === name)
        : definitionSlot
      const rawLinkIDs = definitionOutput.linkIds ?? definitionOutput.link_ids
      const linkIDs = Array.isArray(rawLinkIDs)
        ? new Set(rawLinkIDs.map(String))
        : new Set<string>()
      const sources = internalLinks.filter((link) => link.targetID === "-20" && linkIDs.has(link.id))
      const outerLinks = outbound.filter((link) => link.originSlot === (outerSlot >= 0 ? outerSlot : definitionSlot))
      for (const source of sources) {
        for (const outer of outerLinks) {
          preserved.push({
            ...outer,
            id: `sg-out:${subgraphNode.id}:${definitionSlot}:${source.id}:${outer.id}`,
            originID: `${subgraphNode.id}:${source.originID}`,
            originSlot: source.originSlot,
          })
        }
      }
    }

    for (const link of internalLinks) {
      if (link.originID === "-10" || link.targetID === "-20" || link.originID === "-20" || link.targetID === "-10") {
        continue
      }
      preserved.push({
        ...link,
        id: `sg:${subgraphNode.id}:${link.id}`,
        originID: `${subgraphNode.id}:${link.originID}`,
        targetID: `${subgraphNode.id}:${link.targetID}`,
      })
    }
    for (const node of internalNodes) {
      for (const [slot, nodeInput] of node.inputs.entries()) {
        const incoming = preserved.find((link) => link.targetID === node.id && link.targetSlot === slot)
        nodeInput.link = incoming?.id ?? null
      }
    }
    nodes = [...nodes.filter((node) => node.id !== subgraphNode.id), ...internalNodes]
    links = preserved
  }

  reconcileNodeInputLinks(nodes, links)
  return { nodes, links, externalBindings }
}

function objectInfoInputs(objectInfo: JsonRecord, nodeType: string) {
  const node = isRecord(objectInfo[nodeType]) ? objectInfo[nodeType] : undefined
  const input = node && isRecord(node.input) ? node.input : undefined
  const result: Array<{ name: string; spec: unknown; required: boolean }> = []
  for (const section of ["required", "optional"] as const) {
    const values = input && isRecord(input[section]) ? input[section] : undefined
    if (!values) continue
    for (const [name, spec] of Object.entries(values)) {
      result.push({ name, spec, required: section === "required" })
    }
  }
  return result
}

function inputSpecType(spec: unknown) {
  return Array.isArray(spec) ? spec[0] : undefined
}

function inputSpecOptions(spec: unknown) {
  return Array.isArray(spec) && isRecord(spec[1]) ? spec[1] : {}
}

function comboOptions(spec: unknown, selected?: unknown) {
  const type = inputSpecType(spec)
  if (Array.isArray(type)) return type.filter((value) => ["string", "number", "boolean"].includes(typeof value))
  const options = inputSpecOptions(spec)
  if (type === "COMBO" && Array.isArray(options.options)) {
    return options.options.flatMap((value) => {
      if (isRecord(value) && value.key !== undefined) return [value.key]
      return ["string", "number", "boolean"].includes(typeof value) ? [value] : []
    })
  }
  if (typeof type === "string" && type.startsWith("COMFY_") && type.includes("COMBO") && Array.isArray(options.options)) {
    return options.options.flatMap((value) => {
      if (isRecord(value) && value.key !== undefined) return [value.key]
      return ["string", "number", "boolean"].includes(typeof value) ? [value] : []
    })
  }
  return selected !== undefined && ["string", "number", "boolean"].includes(typeof selected) ? [selected] : []
}

function isWidgetSpec(spec: unknown) {
  const type = inputSpecType(spec)
  if (Array.isArray(type)) return true
  if (typeof type !== "string") return false
  return BASIC_WIDGET_TYPES.has(type)
    || (type.startsWith("COMFY_") && type.includes("COMBO"))
    || type.toUpperCase() !== type
}

function dynamicComboSubInputs(spec: unknown, selected: unknown) {
  const options = inputSpecOptions(spec)
  if (!Array.isArray(options.options)) return []
  const option = options.options.find((value) => isRecord(value) && value.key === selected)
  if (!isRecord(option) || !isRecord(option.inputs)) return []
  const result: Array<{ name: string; spec: unknown; required: boolean }> = []
  for (const section of ["required", "optional"] as const) {
    const inputs = isRecord(option.inputs[section]) ? option.inputs[section] : undefined
    if (inputs) {
      result.push(...Object.entries(inputs).map(([name, inputSpec]) => ({
        name,
        spec: inputSpec,
        required: section === "required",
      })))
    }
  }
  return result
}

function isDynamicComboSpec(spec: unknown) {
  const type = inputSpecType(spec)
  const options = inputSpecOptions(spec)
  return typeof type === "string"
    && type.toUpperCase().includes("COMBO")
    && Array.isArray(options.options)
    && options.options.some((option) => isRecord(option) && isRecord(option.inputs))
}

function dynamicComboDefaultInputs(
  name: string,
  spec: unknown,
  selected: unknown,
  prefix = name,
): JsonRecord {
  const result: JsonRecord = { [prefix]: selected }
  for (const input of dynamicComboSubInputs(spec, selected)) {
    const inputName = `${prefix}.${input.name}`
    if (isDynamicComboSpec(input.spec)) {
      Object.assign(
        result,
        dynamicComboDefaultInputs(input.name, input.spec, defaultValueForSpec(input.spec), inputName),
      )
      continue
    }
    const defaultValue = defaultValueForSpec(input.spec)
    if (defaultValue !== undefined) result[inputName] = defaultValue
  }
  return result
}

function consumeDynamicComboValues(
  name: string,
  spec: unknown,
  values: unknown[],
  startIndex: number,
  prefix = name,
): { values: Record<string, unknown>; nextIndex: number } {
  const rawValue = values[startIndex] ?? defaultValueForSpec(spec)
  let nextIndex = startIndex + (startIndex < values.length ? 1 : 0)
  const result: JsonRecord = { [prefix]: rawValue }
  for (const input of dynamicComboSubInputs(spec, rawValue)) {
    if (!isWidgetSpec(input.spec)) continue
    const inputName = `${prefix}.${input.name}`
    if (isDynamicComboSpec(input.spec)) {
      const consumed = consumeDynamicComboValues(input.name, input.spec, values, nextIndex, inputName)
      Object.assign(result, consumed.values)
      nextIndex = consumed.nextIndex
      continue
    }
    result[inputName] = values[nextIndex] ?? defaultValueForSpec(input.spec)
    nextIndex += nextIndex < values.length ? 1 : 0
    if (CONTROL_AFTER_GENERATE_VALUES.has(String(values[nextIndex] ?? ""))) nextIndex += 1
  }
  return { values: result, nextIndex }
}

function dynamicComboValuesFromRecord(
  name: string,
  spec: unknown,
  values: JsonRecord,
  prefix = name,
): JsonRecord {
  const selected = values[prefix] ?? values[name] ?? defaultValueForSpec(spec)
  const result: JsonRecord = { [prefix]: selected }
  for (const input of dynamicComboSubInputs(spec, selected)) {
    const key = `${prefix}.${input.name}`
    if (isDynamicComboSpec(input.spec)) {
      Object.assign(result, dynamicComboValuesFromRecord(input.name, input.spec, values, key))
      continue
    }
    const value = values[key] ?? values[input.name] ?? defaultValueForSpec(input.spec)
    if (value !== undefined) result[key] = value
  }
  return result
}

function widgetValuesForNode(node: NormalizedNode, objectInfo: JsonRecord) {
  if (isRecord(node.widgets_values)) {
    const values = Object.fromEntries(
      Object.entries(node.widgets_values).filter(([key]) => key !== "preview" && key !== "videopreview"),
    )
    const result: Record<string, unknown> = { ...values }
    for (const { name, spec } of objectInfoInputs(objectInfo, node.type)) {
      if (isDynamicComboSpec(spec)) {
        Object.assign(result, dynamicComboValuesFromRecord(name, spec, values))
      }
    }
    return result
  }
  const values = Array.isArray(node.widgets_values) ? node.widgets_values : []
  const result: Record<string, unknown> = {}
  let index = 0
  for (const { name, spec } of objectInfoInputs(objectInfo, node.type)) {
    if (!isWidgetSpec(spec) || index >= values.length) continue
    if (isDynamicComboSpec(spec)) {
      const consumed = consumeDynamicComboValues(name, spec, values, index)
      Object.assign(result, consumed.values)
      index = consumed.nextIndex
      continue
    }
    result[name] = values[index]
    index += 1
    if (CONTROL_AFTER_GENERATE_VALUES.has(String(values[index] ?? ""))) index += 1
  }
  return result
}

function defaultValueForSpec(spec: unknown) {
  const type = inputSpecType(spec)
  const options = inputSpecOptions(spec)
  if ("default" in options) return options.default
  if (Array.isArray(type) && type.length > 0) return type[0]
  const combo = comboOptions(spec)
  if (combo.length > 0) return combo[0]
  return undefined
}

export function convertComfyUIWorkflowBuiltin(workflow: JsonRecord, objectInfo: JsonRecord): BuiltinConversion {
  const rawNodes = Array.isArray(workflow.nodes) ? workflow.nodes : []
  const rawLinks = Array.isArray(workflow.links) ? workflow.links : []
  const normalizedNodes = rawNodes.flatMap((value) => {
    const node = normalizeNode(value)
    return node ? [node] : []
  })
  if (normalizedNodes.length === 0) {
    throw new ApiError(422, "COMFYUI_WORKFLOW_JSON_INVALID", "Workflow does not contain a supported node graph.")
  }
  const normalizedLinks = rawLinks.flatMap((value, index) => {
    const link = normalizeLink(value, `link-${index}`)
    return link ? [link] : []
  })
  const expanded = expandSubgraphs(workflow, normalizedNodes, normalizedLinks)
  const nodeByID = new Map(expanded.nodes.map((node) => [node.id, node]))
  const linkByID = new Map(expanded.links.map((link) => [link.id, link]))
  const primitiveValues = new Map<string, unknown>()
  const rerouteSources = new Map<string, [string, number]>()
  const setSources = new Map<string, [string, number]>()
  const getVariables = new Map<string, string>()
  const bypassed = new Set(expanded.nodes.filter((node) => node.mode === 4).map((node) => node.id))

  for (const node of expanded.nodes) {
    const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : []
    if (node.type === "PrimitiveNode" && widgets.length > 0) primitiveValues.set(node.id, widgets[0])
    if (node.type === "Reroute") {
      const linkID = node.inputs[0]?.link
      const link = linkID !== undefined && linkID !== null ? linkByID.get(String(linkID)) : undefined
      if (link) rerouteSources.set(node.id, [link.originID, link.originSlot])
    }
    if (node.type === "SetNode" && widgets.length > 0) {
      const linkID = node.inputs.find((input) => input.link !== undefined && input.link !== null)?.link
      const link = linkID !== undefined && linkID !== null ? linkByID.get(String(linkID)) : undefined
      if (link) setSources.set(String(widgets[0]), [link.originID, link.originSlot])
    }
    if (node.type === "GetNode" && widgets.length > 0) getVariables.set(node.id, String(widgets[0]))
  }

  const traceSource = (sourceID: string, sourceSlot: number, visited = new Set<string>()): [string, number] => {
    if (visited.has(sourceID)) return [sourceID, sourceSlot]
    visited.add(sourceID)
    const variable = getVariables.get(sourceID)
    if (variable && setSources.has(variable)) {
      const [nextID, nextSlot] = setSources.get(variable)!
      return traceSource(nextID, nextSlot, visited)
    }
    const reroute = rerouteSources.get(sourceID)
    if (reroute) return traceSource(reroute[0], reroute[1], visited)
    if (bypassed.has(sourceID)) {
      const node = nodeByID.get(sourceID)
      const outputType = stringValue(node?.outputs[sourceSlot]?.type)
      const linkedInput = node?.inputs.find((input) => {
        if (input.link === undefined || input.link === null) return false
        return !outputType || input.type === outputType
      }) ?? node?.inputs.find((input) => input.link !== undefined && input.link !== null)
      const link = linkedInput?.link !== undefined && linkedInput.link !== null
        ? linkByID.get(String(linkedInput.link))
        : undefined
      if (link) return traceSource(link.originID, link.originSlot, visited)
    }
    return [sourceID, sourceSlot]
  }

  const prompt: ComfyUIApiPrompt = {}
  const bindingCandidates = expanded.externalBindings
  const nodeTypes = new Set<string>()
  for (const node of expanded.nodes) {
    if (node.mode === 2 || node.mode === 4 || UI_ONLY_NODE_TYPES.has(node.type)) continue
    nodeTypes.add(node.type)
    const definitions = objectInfoInputs(objectInfo, node.type)
    const widgets = widgetValuesForNode(node, objectInfo)
    const apiInputs: Record<string, unknown> = {}
    const nodeInputByName = new Map(node.inputs.flatMap((input) => {
      const name = stringValue(input.name)
      return name ? [[name, input] as const] : []
    }))

    for (const definition of definitions) {
      const rawInput = nodeInputByName.get(definition.name)
      const linkID = rawInput?.link
      const link = linkID !== undefined && linkID !== null ? linkByID.get(String(linkID)) : undefined
      if (link) {
        const [sourceID, sourceSlot] = traceSource(link.originID, link.originSlot)
        if (primitiveValues.has(sourceID)) {
          apiInputs[definition.name] = primitiveValues.get(sourceID)
          addBindingCandidate(bindingCandidates, sourceID, "*", {
            nodeID: node.id,
            inputName: definition.name,
          })
        } else if (!bypassed.has(sourceID)) {
          apiInputs[definition.name] = [sourceID, sourceSlot]
        }
      } else if (definition.name in widgets) {
        apiInputs[definition.name] = widgets[definition.name]
      } else {
        const defaultValue = defaultValueForSpec(definition.spec)
        if (defaultValue !== undefined) apiInputs[definition.name] = defaultValue
      }
      if (definition.name in apiInputs && !Array.isArray(apiInputs[definition.name])) {
        addBindingCandidate(bindingCandidates, node.id, definition.name, {
          nodeID: node.id,
          inputName: definition.name,
        })
      }
    }

    for (const input of node.inputs) {
      const name = stringValue(input.name)
      if (!name || name in apiInputs) continue
      const linkID = input.link
      const link = linkID !== undefined && linkID !== null ? linkByID.get(String(linkID)) : undefined
      if (link) {
        const [sourceID, sourceSlot] = traceSource(link.originID, link.originSlot)
        if (primitiveValues.has(sourceID)) {
          apiInputs[name] = primitiveValues.get(sourceID)
          addBindingCandidate(bindingCandidates, sourceID, "*", { nodeID: node.id, inputName: name })
        }
        else if (!bypassed.has(sourceID)) apiInputs[name] = [sourceID, sourceSlot]
      } else if (name in widgets) {
        apiInputs[name] = widgets[name]
        addBindingCandidate(bindingCandidates, node.id, name, { nodeID: node.id, inputName: name })
      }
    }
    for (const [name, value] of Object.entries(widgets)) {
      if (
        name.includes(".")
        && !(name in apiInputs)
        && definitions.some((definition) =>
          isDynamicComboSpec(definition.spec) && name.startsWith(`${definition.name}.`)
        )
      ) {
        apiInputs[name] = value
        addBindingCandidate(bindingCandidates, node.id, name, {
          nodeID: node.id,
          inputName: name,
        })
      }
    }

    const title = stringValue(node.title)
      ?? (isRecord(node.properties) ? stringValue(node.properties["Node name for S&R"]) : undefined)
      ?? node.type
    prompt[node.id] = {
      class_type: node.type,
      inputs: apiInputs,
      _meta: { title },
    }
  }

  for (const node of Object.values(prompt)) {
    for (const [inputName, value] of Object.entries(node.inputs)) {
      if (
        Array.isArray(value)
        && value.length === 2
        && typeof value[0] === "string"
        && !(value[0] in prompt)
      ) {
        throw new ApiError(
          422,
          "COMFYUI_WORKFLOW_CONVERSION_FAILED",
          `Converted workflow contains an unresolved connection for '${node.class_type}.${inputName}'.`,
        )
      }
    }
  }
  return { prompt, bindingCandidates, nodeTypes }
}

function isApiPrompt(value: unknown): value is ComfyUIApiPrompt {
  if (!isRecord(value) || Object.keys(value).length === 0) return false
  return Object.values(value).every((node) => (
    isRecord(node)
    && stringValue(node.class_type)
    && isRecord(node.inputs)
  ))
}

function unwrapApiPrompt(value: unknown) {
  if (isApiPrompt(value)) return value
  if (isRecord(value) && isApiPrompt(value.prompt)) return value.prompt
  if (isRecord(value) && isApiPrompt(value.workflow)) return value.workflow
  return undefined
}

function parseWidgetReference(storedID: unknown, widgetName: string) {
  const raw = String(storedID)
  const segments = raw.split(":")
  if (segments.length === 3) {
    try {
      return {
        nodeID: decodeURIComponent(segments[1]!),
        inputName: decodeURIComponent(segments[2]!) || widgetName,
      }
    } catch {
      return { nodeID: segments[1]!, inputName: widgetName }
    }
  }
  return { nodeID: raw, inputName: widgetName }
}

function findPromptBindings(
  prompt: ComfyUIApiPrompt,
  candidates: Map<string, Binding[]>,
  storedID: unknown,
  widgetName: string,
) {
  const reference = parseWidgetReference(storedID, widgetName)
  const direct = [
    ...(candidates.get(`${reference.nodeID}\0${reference.inputName}`) ?? []),
    ...(reference.inputName === widgetName
      ? []
      : candidates.get(`${reference.nodeID}\0${widgetName}`) ?? []),
    ...(candidates.get(`${reference.nodeID}\0*`) ?? []),
  ].filter((binding, index, values) => (
    Boolean(prompt[binding.nodeID])
    && binding.inputName in prompt[binding.nodeID]!.inputs
    && values.findIndex((value) =>
      value.nodeID === binding.nodeID && value.inputName === binding.inputName
    ) === index
  ))
  if (direct?.length) return direct
  if (prompt[reference.nodeID]?.inputs && reference.inputName in prompt[reference.nodeID]!.inputs) {
    return [{ nodeID: reference.nodeID, inputName: reference.inputName }]
  }
  const suffixMatches = Object.entries(prompt).flatMap(([nodeID, node]) => (
    (nodeID.endsWith(`:${reference.nodeID}`) || nodeID === reference.nodeID)
    && (reference.inputName in node.inputs || widgetName in node.inputs)
      ? [{ nodeID, inputName: reference.inputName in node.inputs ? reference.inputName : widgetName }]
      : []
  ))
  if (suffixMatches.length === 1) return suffixMatches
  const nameMatches = Object.entries(prompt).flatMap(([nodeID, node]) => (
    widgetName in node.inputs ? [{ nodeID, inputName: widgetName }] : []
  ))
  return nameMatches.length === 1 ? nameMatches : []
}

function controlKeyFor(storedID: unknown, widgetName: string) {
  const reference = parseWidgetReference(storedID, widgetName)
  const readable = reference.inputName.trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "input"
  return `${readable}_${sha256(`${String(storedID)}\0${reference.inputName}`).slice(0, 10)}`
}

function nestedDynamicInputDefinitions(
  spec: unknown,
  promptInputs: Record<string, unknown>,
  prefix: string,
): Array<{ name: string; spec: unknown; required: boolean }> {
  const selected = promptInputs[prefix]
  return dynamicComboSubInputs(spec, selected).flatMap((input) => {
    const name = `${prefix}.${input.name}`
    const definition = { name, spec: input.spec, required: input.required }
    return isDynamicComboSpec(input.spec)
      ? [definition, ...nestedDynamicInputDefinitions(input.spec, promptInputs, name)]
      : [definition]
  })
}

function promptInputDefinitions(
  objectInfo: JsonRecord,
  node: ApiPromptNode,
) {
  const definitions = objectInfoInputs(objectInfo, node.class_type)
  return [
    ...definitions,
    ...definitions.flatMap((definition) =>
      isDynamicComboSpec(definition.spec)
        ? nestedDynamicInputDefinitions(definition.spec, node.inputs, definition.name)
        : []
    ),
  ]
}

function controlForBinding(
  key: string,
  label: string,
  binding: Binding,
  prompt: ComfyUIApiPrompt,
  objectInfo: JsonRecord,
  config: JsonRecord,
): GenerationControl | undefined {
  const node = prompt[binding.nodeID]
  if (!node) return undefined
  const definition = promptInputDefinitions(objectInfo, node)
    .find((input) => input.name === binding.inputName)
  if (!definition) return undefined
  const type = inputSpecType(definition.spec)
  const options = inputSpecOptions(definition.spec)
  const value = node.inputs[binding.inputName]
  const description = stringValue(config.description) ?? stringValue(options.tooltip)
  const base = {
    key,
    label,
    required: definition.required,
    ...(description ? { description } : {}),
  }

  if (type === "STRING") {
    const multiline = options.multiline === true || /prompt|text|caption|description/i.test(binding.inputName)
    return {
      ...base,
      type: /prompt/i.test(binding.inputName) ? "prompt" : "text",
      multiline,
      ...(finiteNumber(options.max_length) ? { maxLength: Number(options.max_length) } : {}),
      ...(typeof value === "string" ? { defaultValue: value } : {}),
    }
  }
  if (type === "INT" || type === "FLOAT") {
    return {
      ...base,
      type: "number",
      integer: type === "INT",
      ...(finiteNumber(options.min) !== undefined ? { min: Number(options.min) } : {}),
      ...(finiteNumber(options.max) !== undefined ? { max: Number(options.max) } : {}),
      ...(finiteNumber(options.step) !== undefined ? { step: Number(options.step) } : {}),
      ...(finiteNumber(value) !== undefined ? { defaultValue: Number(value) } : {}),
    }
  }
  if (type === "BOOLEAN") {
    return {
      ...base,
      type: "boolean",
      ...(typeof value === "boolean" ? { defaultValue: value } : {}),
    }
  }
  const normalizedType = typeof type === "string" ? type.toUpperCase() : ""
  const uploadKind = options.image_upload === true || options.upload === "image"
    ? "image" as const
    : options.video_upload === true || options.upload === "video"
      ? "video" as const
      : options.audio_upload === true || options.upload === "audio"
        ? "audio" as const
        : undefined
  const mediaKind = uploadKind
    ?? (normalizedType === "IMAGE"
      ? "image" as const
      : normalizedType === "VIDEO"
        ? "video" as const
        : normalizedType === "AUDIO"
          ? "audio" as const
          : undefined)
  if (mediaKind) {
    return {
      ...base,
      type: "media",
      mediaKind,
      multiple: options.multiple === true || options.multiselect === true,
      minCount: definition.required ? 1 : 0,
      maxCount: options.multiple === true || options.multiselect === true ? undefined : 1,
      supportedMimeTypes: mediaKind === "image"
        ? ["image/png", "image/jpeg", "image/webp"]
        : mediaKind === "video"
          ? ["video/mp4", "video/webm", "video/quicktime"]
          : ["audio/wav", "audio/mpeg", "audio/flac", "audio/ogg"],
      maxFileSizeMB: mediaKind === "image" ? 25 : 256,
      acceptsConnection: true,
    }
  }
  const selectable = comboOptions(definition.spec, value)
  if (selectable.length > 0) {
    return {
      ...base,
      type: "select",
      options: selectable,
      ...(value !== undefined ? { defaultValue: value } : {}),
    }
  }
  if (normalizedType === "JSON" || normalizedType === "DICT" || options.serializable === true) {
    return {
      ...base,
      type: "json",
      serializedObjectOnly: true,
      ...(isRecord(value) ? { defaultValue: value } : {}),
    }
  }
  return undefined
}

function bindingWithPromptTransform(
  binding: Binding,
  prompt: ComfyUIApiPrompt,
  objectInfo: JsonRecord,
): Binding {
  const node = prompt[binding.nodeID]
  if (!node) return binding
  const definition = promptInputDefinitions(objectInfo, node)
    .find((input) => input.name === binding.inputName)
  if (!definition || !isDynamicComboSpec(definition.spec)) return binding
  const currentSelected = node.inputs[binding.inputName]
  const dynamicComboTemplates = comboOptions(definition.spec, currentSelected).map((option) => ({
    option,
    promptInputs: option === currentSelected
      ? Object.fromEntries(Object.entries(node.inputs).filter(([name]) =>
        name === binding.inputName || name.startsWith(`${binding.inputName}.`)
      ))
      : dynamicComboDefaultInputs(binding.inputName, definition.spec, option),
  }))
  return { ...binding, dynamicComboTemplates }
}

function outputKindForNode(nodeID: string, prompt: ComfyUIApiPrompt, objectInfo: JsonRecord) {
  const node = prompt[nodeID]
  if (!node) return "unknown" as const
  const rawInfo = objectInfo[node.class_type]
  const info: JsonRecord = isRecord(rawInfo) ? rawInfo : {}
  const outputs = Array.isArray(info.output) ? info.output.map((value) => String(value).toUpperCase()) : []
  const haystack = `${node.class_type} ${outputs.join(" ")}`.toLowerCase()
  if (/(^|[^a-z])audio([^a-z]|$)/.test(haystack)) return "audio" as const
  if (/3d|mesh|glb|gltf/.test(haystack)) return "3d" as const
  if (/video|vhs_video|saveanimated|animated/.test(haystack)) return "video" as const
  if (/image|saveimage|previewimage/.test(haystack)) return "image" as const
  if (isRecord(info) && info.output_node === true) return "file" as const
  return "unknown" as const
}

function resolveOutputNodeIDs(rawOutputs: unknown[], prompt: ComfyUIApiPrompt) {
  return rawOutputs.flatMap((value) => {
    const direct = String(value)
    if (prompt[direct]) return [direct]
    const matches = Object.keys(prompt).filter((id) => id.endsWith(`:${direct}`))
    return matches.length === 1 ? matches : []
  })
}

function outputContract(
  rawOutputs: unknown[],
  prompt: ComfyUIApiPrompt,
  objectInfo: JsonRecord,
): { output?: CinemaProviderWorkflowOutput; issues: CinemaProviderWorkflowIssue[]; outputNodeIDs: string[] } {
  const outputNodeIDs = resolveOutputNodeIDs(rawOutputs, prompt)
  if (outputNodeIDs.length !== rawOutputs.length || outputNodeIDs.length === 0) {
    return {
      issues: [workflowIssue(
        "COMFYUI_APP_OUTPUT_INVALID",
        "APP mode contains an output that could not be mapped to the executable workflow.",
      )],
      outputNodeIDs,
    }
  }
  const groups = new Map<string, string[]>()
  for (const nodeID of outputNodeIDs) {
    const kind = outputKindForNode(nodeID, prompt, objectInfo)
    groups.set(kind, [...(groups.get(kind) ?? []), nodeID])
  }
  if (groups.size !== 1) {
    return {
      issues: [workflowIssue(
        "COMFYUI_OUTPUT_MIXED_UNSUPPORTED",
        "Mixed APP mode output types are not supported in this version.",
      )],
      outputNodeIDs,
    }
  }
  const [kind, nodeIDs] = [...groups.entries()][0]!
  if (kind !== "image" && kind !== "video") {
    return {
      issues: [workflowIssue(
        "COMFYUI_OUTPUT_TYPE_UNSUPPORTED",
        `APP mode output type '${kind}' is not supported yet.`,
      )],
      outputNodeIDs,
    }
  }
  return {
    output: { kind, nodeIDs } as CinemaProviderWorkflowOutput,
    issues: [],
    outputNodeIDs,
  }
}

function workflowFormat(workflow: JsonRecord) {
  const version = workflow.version
  if (version === 1 || version === "1" || version === "1.0") return "1.0" as const
  if (version === 0.4 || version === "0.4") return "0.4" as const
  return "unknown" as const
}

function relevantObjectInfo(prompt: ComfyUIApiPrompt, objectInfo: JsonRecord) {
  const types = [...new Set(Object.values(prompt).map((node) => node.class_type))].sort()
  return Object.fromEntries(types.map((type) => [type, objectInfo[type] ?? null]))
}

function validateComboValues(prompt: ComfyUIApiPrompt, objectInfo: JsonRecord) {
  const issues: CinemaProviderWorkflowIssue[] = []
  for (const [nodeID, node] of Object.entries(prompt)) {
    for (const definition of promptInputDefinitions(objectInfo, node)) {
      const options = comboOptions(definition.spec)
      const value = node.inputs[definition.name]
      if (
        options.length > 0
        && value !== undefined
        && !Array.isArray(value)
        && !options.some((option) => option === value)
      ) {
        issues.push(workflowIssue(
          "COMFYUI_COMBO_VALUE_UNAVAILABLE",
          `Saved value '${String(value)}' is no longer available for '${node.class_type}.${definition.name}'.`,
          { nodeID, dependency: String(value) },
        ))
      }
    }
  }
  return issues
}

function validateRequiredPromptInputs(prompt: ComfyUIApiPrompt, objectInfo: JsonRecord) {
  const issues: CinemaProviderWorkflowIssue[] = []
  for (const [nodeID, node] of Object.entries(prompt)) {
    for (const definition of objectInfoInputs(objectInfo, node.class_type)) {
      if (!definition.required || node.inputs[definition.name] !== undefined) continue
      if (Object.keys(node.inputs).some((name) => name.startsWith(`${definition.name}.`))) continue
      issues.push(workflowIssue(
        "COMFYUI_REQUIRED_INPUT_MISSING",
        `Required input '${definition.name}' is missing from '${node.class_type}'.`,
        {
          nodeID,
          nodeType: node.class_type,
          dependency: definition.name,
        },
      ))
    }
  }
  return issues
}

function modelFolderForInput(name: string) {
  const normalized = name.trim().toLowerCase()
  return MODEL_INPUT_FOLDERS[normalized]
    ?? Object.entries(MODEL_INPUT_FOLDERS).find(([key]) => normalized.includes(key))?.[1]
}

function declaredModels(workflow: JsonRecord) {
  if (!Array.isArray(workflow.models)) return []
  return workflow.models.flatMap((value) => {
    if (!isRecord(value)) return []
    const name = stringValue(value.name) ?? stringValue(value.filename)
    if (!name) return []
    const folder = stringValue(value.directory) ?? stringValue(value.folder)
    return [{ name, ...(folder ? { folder } : {}) }]
  })
}

async function readAvailableModels(
  baseURL: string,
  userID: string,
  folders: Set<string>,
  includeAllFolders = false,
) {
  const available = new Map<string, Set<string>>()
  const advertised = await optionalComfyUIJSON(baseURL, "/models", userID).catch(() => undefined)
  const advertisedFolders = new Set(
    Array.isArray(advertised) ? advertised.filter((value): value is string => typeof value === "string") : [],
  )
  const requested = includeAllFolders && advertisedFolders.size > 0
    ? [...advertisedFolders]
    : [...folders].filter((folder) => advertisedFolders.size === 0 || advertisedFolders.has(folder))
  if (requested.length === 0) return available
  const values = await mapLimit(requested, COMFYUI_WORKFLOW_LIMITS.readConcurrency, async (folder) => {
    const result = await optionalComfyUIJSON(baseURL, `/models/${encodeURIComponent(folder)}`, userID).catch(() => undefined)
    const list = Array.isArray(result)
      ? result
      : isRecord(result) && Array.isArray(result.models)
        ? result.models
        : []
    return [folder, new Set(list.flatMap((item) => {
      const name = typeof item === "string" ? item : isRecord(item) ? stringValue(item.name) : undefined
      return name ? [name.replace(/\\/g, "/")] : []
    }))] as const
  })
  for (const [folder, names] of values) available.set(folder, names)
  return available
}

function validateModelDependencies(
  workflow: JsonRecord,
  prompt: ComfyUIApiPrompt,
  objectInfo: JsonRecord,
  availableModels: Map<string, Set<string>>,
) {
  const dependencies: CinemaProviderWorkflowDependency[] = []
  const issues: CinemaProviderWorkflowIssue[] = []
  const seen = new Set<string>()
  const add = (name: string, folder: string | undefined, available: boolean, nodeID?: string) => {
    const key = `${folder ?? ""}\0${name}\0${nodeID ?? ""}`
    if (seen.has(key)) return
    seen.add(key)
    dependencies.push({ kind: "model", name, available, ...(folder ? { folder } : {}), ...(nodeID ? { nodeID } : {}) })
    if (!available) {
      issues.push(workflowIssue(
        "COMFYUI_MODEL_MISSING",
        `Model '${name}' is not available in ComfyUI.`,
        { dependency: name, ...(nodeID ? { nodeID } : {}) },
      ))
    }
  }

  for (const declared of declaredModels(workflow)) {
    const folders = declared.folder
      ? [availableModels.get(declared.folder)].filter((value): value is Set<string> => Boolean(value))
      : [...availableModels.values()]
    const available = folders.some((names) => (
      names.has(declared.name)
      || [...names].some((name) => path.basename(name) === path.basename(declared.name))
    ))
    add(declared.name, declared.folder, available)
  }

  for (const [nodeID, node] of Object.entries(prompt)) {
    for (const definition of objectInfoInputs(objectInfo, node.class_type)) {
      const value = node.inputs[definition.name]
      if (typeof value !== "string") continue
      const folder = modelFolderForInput(definition.name)
      const options = new Set(comboOptions(definition.spec).map(String))
      const type = inputSpecType(definition.spec)
      const isCombo = Array.isArray(type)
        || type === "COMBO"
        || (typeof type === "string" && type.startsWith("COMFY_") && type.includes("COMBO"))
      if (isCombo && options.size > 0 && !options.has(value)) {
        issues.push(workflowIssue(
          "COMFYUI_COMBO_VALUE_MISSING",
          `Saved combo value '${value}' is not available for '${definition.name}'.`,
          { nodeID },
        ))
      }
      if (!folder) continue
      const liveFolder = availableModels.get(folder)
      const available = options.has(value)
        || Boolean(liveFolder?.has(value))
        || Boolean(liveFolder && [...liveFolder].some((name) => path.basename(name) === path.basename(value)))
      add(value, folder, available, nodeID)
    }
  }
  return { dependencies, issues }
}

function nodeDependencies(prompt: ComfyUIApiPrompt, objectInfo: JsonRecord) {
  const dependencies: CinemaProviderWorkflowDependency[] = []
  const issues: CinemaProviderWorkflowIssue[] = []
  for (const [nodeID, node] of Object.entries(prompt)) {
    const available = isRecord(objectInfo[node.class_type])
    dependencies.push({ kind: "node", name: node.class_type, available, nodeID })
    if (!available) {
      issues.push(workflowIssue(
        "COMFYUI_NODE_MISSING",
        `Node type '${node.class_type}' is not installed in ComfyUI.`,
        { nodeID, nodeType: node.class_type, dependency: node.class_type },
      ))
    }
  }
  return { dependencies, issues }
}

function fileNameForWorkflow(filePath: string) {
  const name = path.posix.basename(filePath, path.posix.extname(filePath)).trim()
  return name || filePath
}

async function tryServerConversion(
  baseURL: string,
  userID: string,
  workflow: JsonRecord,
) {
  const value = await optionalComfyUIJSON(baseURL, "/workflow/convert", userID, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(workflow),
  })
  return value === undefined ? undefined : unwrapApiPrompt(value)
}

async function convertOneWorkflow(input: {
  baseURL: string
  userID: string
  file: FileEntry
  text: string
  objectInfo: JsonRecord
  availableModels: Map<string, Set<string>>
  serverConverter: { available: boolean | null }
  discoveredAt: string
}): Promise<InternalComfyUIWorkflow> {
  const workflowID = `wf_${sha256(`${input.baseURL}\0${input.userID}\0${input.file.path}`).slice(0, 32)}`
  const baseSource = {
    userID: input.userID,
    path: input.file.path,
    sizeBytes: Buffer.byteLength(input.text),
    ...(input.file.modified ? { modifiedAt: new Date(input.file.modified).toISOString() } : {}),
  }
  let workflow: JsonRecord
  try {
    const parsed = JSON.parse(input.text) as unknown
    if (!isRecord(parsed)) throw new Error("root is not an object")
    workflow = parsed
  } catch {
    const publicWorkflow: CinemaProviderWorkflow = {
      workflowID,
      revision: `sha256:${sha256(input.text)}`,
      name: fileNameForWorkflow(input.file.path),
      status: "disabled",
      issues: [workflowIssue("COMFYUI_WORKFLOW_JSON_INVALID", "Workflow file is not valid JSON.")],
      dependencies: [],
      source: {
        ...baseSource,
        workflowFormat: "unknown",
        converter: "builtin",
      },
      discoveredAt: input.discoveredAt,
    }
    return { publicWorkflow, uiWorkflow: {}, apiPrompt: {}, bindings: {}, outputNodeIDs: [] }
  }

  const linearData = isRecord(workflow.extra) && isRecord(workflow.extra.linearData)
    ? workflow.extra.linearData
    : undefined
  const rawInputs = linearData && Array.isArray(linearData.inputs) ? linearData.inputs : []
  const rawOutputs = linearData && Array.isArray(linearData.outputs) ? linearData.outputs : []
  const issues: CinemaProviderWorkflowIssue[] = []
  if (
    !linearData
    || !Array.isArray(linearData.inputs)
    || !Array.isArray(linearData.outputs)
    || rawOutputs.length === 0
  ) {
    issues.push(workflowIssue(
      "COMFYUI_APP_MODE_MISSING",
      "This workflow has no complete APP mode input/output contract.",
    ))
  }

  let builtin: BuiltinConversion
  try {
    builtin = convertComfyUIWorkflowBuiltin(workflow, input.objectInfo)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow conversion failed."
    const publicWorkflow: CinemaProviderWorkflow = {
      workflowID,
      revision: `sha256:${sha256(`${input.text}\0${COMFYUI_WORKFLOW_CONVERTER_VERSION}\0failed`)}`,
      name: stringValue(workflow.title) ?? fileNameForWorkflow(input.file.path),
      status: "disabled",
      issues: [...issues, workflowIssue("COMFYUI_WORKFLOW_CONVERSION_FAILED", message)],
      dependencies: [],
      source: {
        ...baseSource,
        workflowFormat: workflowFormat(workflow),
        converter: "builtin",
      },
      discoveredAt: input.discoveredAt,
    }
    return { publicWorkflow, uiWorkflow: workflow, apiPrompt: {}, bindings: {}, outputNodeIDs: [] }
  }

  let prompt = builtin.prompt
  let converter: "server" | "builtin" = "builtin"
  if (input.serverConverter.available !== false) {
    try {
      const converted = await tryServerConversion(input.baseURL, input.userID, workflow)
      if (converted) {
        const alignable = rawInputs.every((entry) => {
          if (!Array.isArray(entry) || entry.length < 2 || typeof entry[1] !== "string") return false
          return findPromptBindings(converted, builtin.bindingCandidates, entry[0], entry[1]).length > 0
        })
        if (alignable) {
          prompt = converted
          converter = "server"
          input.serverConverter.available = true
        } else {
          input.serverConverter.available = true
        }
      } else {
        input.serverConverter.available = false
      }
    } catch {
      input.serverConverter.available = false
    }
  }

  const bindings: Record<string, Binding[]> = {}
  const controls: GenerationControl[] = []
  for (const entry of rawInputs) {
    if (!Array.isArray(entry) || entry.length < 2 || typeof entry[1] !== "string") {
      issues.push(workflowIssue("COMFYUI_APP_INPUT_INVALID", "APP mode contains an invalid input binding."))
      continue
    }
    const [storedID, label, rawConfig] = entry
    const config = isRecord(rawConfig) ? rawConfig : {}
    const matches = findPromptBindings(prompt, builtin.bindingCandidates, storedID, label)
    if (matches.length === 0) {
      issues.push(workflowIssue(
        "COMFYUI_APP_INPUT_BINDING_UNRESOLVED",
        `APP mode input '${label}' could not be mapped to the executable workflow.`,
      ))
      continue
    }
    const key = controlKeyFor(storedID, label)
    if (bindings[key]) {
      issues.push(workflowIssue(
        "COMFYUI_APP_INPUT_KEY_DUPLICATE",
        `APP mode input '${label}' is selected more than once.`,
        { controlKey: key },
      ))
      continue
    }
    const matchedControls = matches.map((binding) =>
      controlForBinding(key, label, binding, prompt, input.objectInfo, config)
    )
    const control = matchedControls[0]
    if (
      !control
      || matchedControls.some((candidate) => !candidate || candidate.type !== control.type)
    ) {
      issues.push(workflowIssue(
        "COMFYUI_APP_WIDGET_UNSUPPORTED",
        `APP mode input '${label}' uses an unsupported widget or fans out to incompatible input types.`,
        { controlKey: key, nodeID: matches[0]!.nodeID },
      ))
      continue
    }
    controls.push(control)
    bindings[key] = matches.map((binding) =>
      bindingWithPromptTransform(binding, prompt, input.objectInfo)
    )
  }

  const dynamicRootBindings = Object.entries(bindings).flatMap(([controlKey, values]) =>
    values.flatMap((binding) =>
      binding.dynamicComboTemplates
        ? [{ controlKey, binding }]
        : []
    )
  )
  for (const control of controls) {
    const visibleWhen: Record<string, unknown> = { ...(control.visibleWhen ?? {}) }
    for (const binding of bindings[control.key] ?? []) {
      for (const root of dynamicRootBindings) {
        if (
          root.controlKey === control.key
          || root.binding.nodeID !== binding.nodeID
          || !binding.inputName.startsWith(`${root.binding.inputName}.`)
        ) {
          continue
        }
        const selected = prompt[root.binding.nodeID]?.inputs[root.binding.inputName]
        if (selected !== undefined) visibleWhen[root.controlKey] = selected
      }
    }
    if (Object.keys(visibleWhen).length > 0) control.visibleWhen = visibleWhen
  }

  const output = outputContract(rawOutputs, prompt, input.objectInfo)
  issues.push(...output.issues)
  const nodes = nodeDependencies(prompt, input.objectInfo)
  issues.push(...nodes.issues)
  const models = validateModelDependencies(workflow, prompt, input.objectInfo, input.availableModels)
  issues.push(...models.issues)
  issues.push(...validateRequiredPromptInputs(prompt, input.objectInfo))
  issues.push(...validateComboValues(prompt, input.objectInfo))
  const dependencies = [...nodes.dependencies, ...models.dependencies]
  const revisionPayload = {
    source: sha256(input.text),
    objectInfo: relevantObjectInfo(prompt, input.objectInfo),
    converterVersion: COMFYUI_WORKFLOW_CONVERTER_VERSION,
    converter,
    prompt,
    bindings,
  }
  const revision = `sha256:${sha256(stableStringify(revisionPayload))}`
  const target = {
    kind: "workflow" as const,
    workflowID,
    revision,
    connectionID: comfyUIConnectionID(input.baseURL, input.userID),
  }
  const supportedOutputKind: "image" | "video" | undefined =
    output.output?.kind === "image" || output.output?.kind === "video"
      ? output.output.kind
      : undefined
  const formSpec: GenerationFormSpec | undefined = supportedOutputKind && controls.length === rawInputs.length
    ? {
      providerID: COMFYUI_PROVIDER_ID,
      target,
      mode: supportedOutputKind === "image" ? "text-to-image" : "text-to-video",
      output: supportedOutputKind,
      controls,
    }
    : undefined
  const publicWorkflow: CinemaProviderWorkflow = {
    workflowID,
    revision,
    name: stringValue(workflow.title)
      ?? (isRecord(workflow.extra) ? stringValue(workflow.extra.title) : undefined)
      ?? fileNameForWorkflow(input.file.path),
    ...(isRecord(workflow.extra) && stringValue(workflow.extra.description)
      ? { description: String(workflow.extra.description) }
      : {}),
    status: issues.some((issue) => issue.severity === "error") || !formSpec ? "disabled" : "ready",
    issues,
    dependencies,
    ...(output.output ? { output: output.output } : {}),
    ...(formSpec ? { formSpec } : {}),
    source: {
      ...baseSource,
      workflowFormat: workflowFormat(workflow),
      converter,
    },
    discoveredAt: input.discoveredAt,
  }
  return {
    publicWorkflow,
    uiWorkflow: workflow,
    apiPrompt: prompt,
    bindings,
    outputNodeIDs: output.outputNodeIDs,
  }
}

function disabledLimitWorkflow(input: {
  endpoint: string
  userID: string
  file: FileEntry
  issue: CinemaProviderWorkflowIssue
  discoveredAt: string
}): InternalComfyUIWorkflow {
  const workflowID = `wf_${sha256(`${input.endpoint}\0${input.userID}\0${input.file.path}`).slice(0, 32)}`
  const publicWorkflow: CinemaProviderWorkflow = {
    workflowID,
    revision: `sha256:${sha256(`${input.file.path}\0${input.file.size}\0${input.file.modified ?? 0}\0${input.issue.code}`)}`,
    name: fileNameForWorkflow(input.file.path),
    status: "disabled",
    issues: [input.issue],
    dependencies: [],
    source: {
      userID: input.userID,
      path: input.file.path,
      sizeBytes: input.file.size,
      ...(input.file.modified ? { modifiedAt: new Date(input.file.modified).toISOString() } : {}),
      workflowFormat: "unknown",
      converter: "builtin",
    },
    discoveredAt: input.discoveredAt,
  }
  return { publicWorkflow, uiWorkflow: {}, apiPrompt: {}, bindings: {}, outputNodeIDs: [] }
}

async function refreshInternal(options: RefreshOptions): Promise<InternalCatalog> {
  const configured = await configuredComfyUIConnection()
  const endpoint = validateComfyUIBaseURL(options.baseURL ?? configured.baseURL)
  const selectedUserID = requestedUserID(options.userID, configured.userID)
  const discoveredAt = new Date().toISOString()
  await requestComfyUIJSON(endpoint, "/system_stats", null)
  const users = await discoverUsers(endpoint)
  const userID = selectUser(users, selectedUserID)
  if (!userID) {
    const catalog: CinemaProviderWorkflowCatalog = {
      providerID: COMFYUI_PROVIDER_ID,
      status: "ready",
      userID: null,
      users,
      workflows: [],
      issues: [workflowIssue(
        "COMFYUI_USER_SELECTION_REQUIRED",
        "Select a ComfyUI user before discovering workflows.",
      )],
      refreshedAt: discoveredAt,
      limits: COMFYUI_WORKFLOW_LIMITS,
    }
    return { publicCatalog: catalog, workflows: new Map(), endpoint, userID: null }
  }

  const [objectInfoValue, initialListingValue] = await Promise.all([
    requestComfyUIJSON(endpoint, "/object_info", userID),
    optionalComfyUIJSON(endpoint, "/userdata?dir=workflows&recurse=true&full_info=true", userID),
  ])
  if (!isRecord(objectInfoValue)) {
    throw new ApiError(502, "COMFYUI_OBJECT_INFO_INVALID", "ComfyUI returned invalid node definitions.")
  }
  let listingValue = initialListingValue
  if (listingValue === undefined) {
    const userDataProbe = await optionalComfyUIJSON(
      endpoint,
      "/userdata?dir=.&recurse=false&full_info=true",
      userID,
    )
    if (userDataProbe === undefined) {
      throw new ApiError(
        502,
        "COMFYUI_USERDATA_UNAVAILABLE",
        "ComfyUI does not expose the user-data workflow discovery endpoint.",
      )
    }
    normalizeFileEntries(userDataProbe)
    listingValue = []
  }
  const allFiles = normalizeFileEntries(listingValue)
  const files = allFiles.slice(0, COMFYUI_WORKFLOW_LIMITS.maxWorkflows)
  const catalogIssues: CinemaProviderWorkflowIssue[] = allFiles.length > COMFYUI_WORKFLOW_LIMITS.maxWorkflows
    ? [workflowIssue(
      "COMFYUI_WORKFLOW_COUNT_LIMIT",
      `ComfyUI has ${allFiles.length} saved workflows; only the first ${COMFYUI_WORKFLOW_LIMITS.maxWorkflows} were included.`,
    )]
    : []
  const limited: InternalComfyUIWorkflow[] = []
  const readable: FileEntry[] = []
  let totalBytes = 0
  for (const file of files) {
    if (file.size > COMFYUI_WORKFLOW_LIMITS.maxFileBytes) {
      limited.push(disabledLimitWorkflow({
        endpoint,
        userID,
        file,
        issue: workflowIssue(
          "COMFYUI_WORKFLOW_FILE_TOO_LARGE",
          "Workflow exceeds the 8 MiB per-file discovery limit.",
        ),
        discoveredAt,
      }))
      continue
    }
    if (totalBytes + file.size > COMFYUI_WORKFLOW_LIMITS.maxTotalBytes) {
      limited.push(disabledLimitWorkflow({
        endpoint,
        userID,
        file,
        issue: workflowIssue(
          "COMFYUI_WORKFLOW_TOTAL_SIZE_LIMIT",
          "Workflow was not scanned because the 64 MiB refresh limit was reached.",
        ),
        discoveredAt,
      }))
      continue
    }
    totalBytes += file.size
    readable.push(file)
  }

  type WorkflowReadResult =
    | { file: FileEntry; text: string }
    | { file: FileEntry; error: string }
    | { file: FileEntry; issue: CinemaProviderWorkflowIssue }
  let actualReadBytes = 0
  const readResults = await mapLimit<FileEntry, WorkflowReadResult>(
    readable,
    COMFYUI_WORKFLOW_LIMITS.readConcurrency,
    async (file) => {
      if (actualReadBytes >= COMFYUI_WORKFLOW_LIMITS.maxTotalBytes) {
        return {
          file,
          issue: workflowIssue(
            "COMFYUI_WORKFLOW_TOTAL_SIZE_LIMIT",
            "Workflow was not scanned because the 64 MiB refresh limit was reached.",
          ),
        }
      }
      try {
        const response = await fetchComfyUI(
          endpoint,
          `/userdata/${encodeUserDataFilePath(`workflows/${file.path}`)}`,
          userID,
        )
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const text = await readBoundedText(response, COMFYUI_WORKFLOW_LIMITS.maxFileBytes)
        const actualBytes = Buffer.byteLength(text)
        if (actualReadBytes + actualBytes > COMFYUI_WORKFLOW_LIMITS.maxTotalBytes) {
          return {
            file: { ...file, size: actualBytes },
            issue: workflowIssue(
              "COMFYUI_WORKFLOW_TOTAL_SIZE_LIMIT",
              "Workflow was not scanned because the 64 MiB refresh limit was reached.",
            ),
          }
        }
        actualReadBytes += actualBytes
        return { file: { ...file, size: Buffer.byteLength(text) }, text }
      } catch (error) {
        if (error instanceof ApiError && error.code === "COMFYUI_RESPONSE_TOO_LARGE") {
          return {
            file,
            issue: workflowIssue(
              "COMFYUI_WORKFLOW_FILE_TOO_LARGE",
              "Workflow exceeds the 8 MiB per-file discovery limit.",
            ),
          }
        }
        return {
          file,
          error: error instanceof Error ? error.message : "Workflow could not be read.",
        }
      }
    },
  )
  const texts: WorkflowReadResult[] = readResults

  const parsedForFolders = texts.flatMap((entry) => {
    if (!("text" in entry) || typeof entry.text !== "string") return []
    try {
      const parsed = JSON.parse(entry.text) as unknown
      return isRecord(parsed) ? [parsed] : []
    } catch {
      return []
    }
  })
  const modelFolders = new Set<string>()
  let hasFolderlessDeclaredModel = false
  for (const workflow of parsedForFolders) {
    for (const model of declaredModels(workflow)) {
      if (model.folder) modelFolders.add(model.folder)
      else hasFolderlessDeclaredModel = true
    }
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes.flatMap((value) => {
      const node = normalizeNode(value)
      return node ? [node] : []
    }) : []
    for (const node of nodes) {
      for (const definition of objectInfoInputs(objectInfoValue, node.type)) {
        const folder = modelFolderForInput(definition.name)
        if (folder) modelFolders.add(folder)
      }
    }
  }
  const availableModels = await readAvailableModels(
    endpoint,
    userID,
    modelFolders,
    hasFolderlessDeclaredModel,
  )
  const serverConverter = { available: null as boolean | null }
  const convertEntry = async (entry: (typeof texts)[number]) => {
    if ("issue" in entry) {
      return disabledLimitWorkflow({
        endpoint,
        userID,
        file: entry.file,
        issue: entry.issue,
        discoveredAt,
      })
    }
    if (!("text" in entry) || typeof entry.text !== "string") {
      return disabledLimitWorkflow({
        endpoint,
        userID,
        file: entry.file,
        issue: workflowIssue(
          "COMFYUI_WORKFLOW_READ_FAILED",
          `Workflow could not be read: ${"error" in entry ? entry.error : "unknown error"}`,
        ),
        discoveredAt,
      })
    }
    return await convertOneWorkflow({
      baseURL: endpoint,
      userID,
      file: entry.file,
      text: entry.text,
      objectInfo: objectInfoValue,
      availableModels,
      serverConverter,
      discoveredAt,
    })
  }
  // Let one valid workflow probe the optional converter before concurrent conversion.
  // A missing or invalid endpoint is therefore contacted only once per refresh.
  const probeIndex = texts.findIndex((entry) => "text" in entry && typeof entry.text === "string")
  const probeResult = probeIndex >= 0 ? await convertEntry(texts[probeIndex]!) : undefined
  const remainingEntries = texts.filter((_entry, index) => index !== probeIndex)
  const remainingConverted = await mapLimit(
    remainingEntries,
    COMFYUI_WORKFLOW_LIMITS.readConcurrency,
    convertEntry,
  )
  const converted = probeResult ? [probeResult, ...remainingConverted] : remainingConverted
  const internalWorkflows = [...converted, ...limited].sort((left, right) =>
    left.publicWorkflow.source.path.localeCompare(right.publicWorkflow.source.path)
  )
  const publicCatalog: CinemaProviderWorkflowCatalog = {
    providerID: COMFYUI_PROVIDER_ID,
    status: "ready",
    userID,
    users,
    workflows: internalWorkflows.map((workflow) => workflow.publicWorkflow),
    issues: catalogIssues,
    refreshedAt: discoveredAt,
    lastSuccessfulRefreshAt: discoveredAt,
    limits: COMFYUI_WORKFLOW_LIMITS,
  }
  const catalog = {
    publicCatalog,
    workflows: new Map(internalWorkflows.map((workflow) => [workflow.publicWorkflow.workflowID, workflow])),
    endpoint,
    userID,
  }
  await writePublicCatalogCache(endpoint, userID, publicCatalog).catch(() => undefined)
  if (!selectedUserID && userID === "default") {
    await writePublicCatalogCache(endpoint, null, publicCatalog).catch(() => undefined)
  }
  return catalog
}

async function staleCatalogForFailure(
  endpoint: string,
  userID: string | null,
  error: unknown,
): Promise<InternalCatalog> {
  const previous = catalogs.get(cacheKey(endpoint, userID))
  const cached = previous?.publicCatalog ?? await readPublicCatalogCache(endpoint, userID)
  const now = new Date().toISOString()
  const issue = workflowIssue(
    error instanceof ApiError ? error.code : "COMFYUI_WORKFLOW_REFRESH_FAILED",
    error instanceof Error ? error.message : "ComfyUI workflow refresh failed.",
  )
  const publicCatalog: CinemaProviderWorkflowCatalog = cached
    ? {
      ...cached,
      status: error instanceof ApiError && error.code === "COMFYUI_OFFLINE" ? "offline" : "stale",
      issues: [issue],
      refreshedAt: now,
    }
    : {
      providerID: COMFYUI_PROVIDER_ID,
      status: error instanceof ApiError && error.code === "COMFYUI_OFFLINE" ? "offline" : "stale",
      userID,
      users: userID ? [{ id: userID, name: userID }] : [],
      workflows: [],
      issues: [issue],
      refreshedAt: now,
      limits: COMFYUI_WORKFLOW_LIMITS,
    }
  return {
    publicCatalog,
    workflows: previous?.workflows ?? new Map(),
    endpoint,
    userID,
  }
}

export async function getComfyUIWorkflowCatalog(options: RefreshOptions = {}) {
  const configured = await configuredComfyUIConnection()
  const endpoint = validateComfyUIBaseURL(options.baseURL ?? configured.baseURL)
  const userID = requestedUserID(options.userID, configured.userID)
  const key = cacheKey(endpoint, userID)
  if (!options.force && catalogs.has(key)) return catalogs.get(key)!.publicCatalog
  if (!options.force && catalogPromises.has(key)) return (await catalogPromises.get(key)!).publicCatalog
  const promise = refreshInternal({ ...options, baseURL: endpoint, userID })
    .catch((error) => staleCatalogForFailure(endpoint, userID, error))
    .then((catalog) => {
      catalogs.set(key, catalog)
      catalogs.set(cacheKey(catalog.endpoint, catalog.userID), catalog)
      return catalog
    })
    .finally(() => catalogPromises.delete(key))
  catalogPromises.set(key, promise)
  return (await promise).publicCatalog
}

export async function refreshComfyUIWorkflowCatalog(options: RefreshOptions = {}) {
  return await getComfyUIWorkflowCatalog({ ...options, force: true })
}

export async function getInternalComfyUIWorkflow(
  workflowID: string,
  revision?: string,
  connectionID?: string,
) {
  const configured = await configuredComfyUIConnection()
  const key = cacheKey(configured.baseURL, configured.userID)
  let catalog = catalogs.get(key)
  if (!catalog && !connectionID) {
    catalog = [...catalogs.values()].find((candidate) => candidate.workflows.has(workflowID))
  }
  if (!catalog) {
    await getComfyUIWorkflowCatalog()
    catalog = catalogs.get(key)
  }
  if (!catalog) {
    throw new ApiError(404, "COMFYUI_WORKFLOW_NOT_FOUND", "The selected ComfyUI workflow was not found.")
  }
  if (connectionID) {
    const activeConnectionID = comfyUIConnectionID(catalog.endpoint, catalog.userID)
    const latest = await configuredComfyUIConnection()
    if (cacheKey(latest.baseURL, latest.userID) !== key || activeConnectionID !== connectionID) {
      throw new ApiError(
        409,
        "COMFYUI_CONNECTION_CHANGED",
        "The active ComfyUI connection changed; refresh workflows before submitting.",
        {
          requestedConnectionID: connectionID,
          activeConnectionID,
          activeBaseURL: latest.baseURL,
          activeUserID: latest.userID,
        },
      )
    }
  }
  if (catalog.publicCatalog.status !== "ready") {
    throw new ApiError(
      409,
      "COMFYUI_WORKFLOW_CATALOG_STALE",
      "The ComfyUI workflow catalog is stale; refresh it before submitting.",
    )
  }
  const workflow = catalog.workflows.get(workflowID)
  if (!workflow) {
    throw new ApiError(404, "COMFYUI_WORKFLOW_NOT_FOUND", "The selected ComfyUI workflow was not found.")
  }
  if (workflow.publicWorkflow.status !== "ready") {
    throw new ApiError(
      409,
      "COMFYUI_WORKFLOW_NOT_READY",
      workflow.publicWorkflow.issues[0]?.message ?? "The selected ComfyUI workflow is not runnable.",
      { issues: workflow.publicWorkflow.issues },
    )
  }
  if (revision && workflow.publicWorkflow.revision !== revision) {
    throw new ApiError(
      409,
      "COMFYUI_WORKFLOW_REVISION_CHANGED",
      "The ComfyUI workflow changed; refresh and review its inputs before submitting.",
      {
        workflowID,
        requestedRevision: revision,
        currentRevision: workflow.publicWorkflow.revision,
      },
    )
  }
  return {
    workflow,
    endpoint: catalog.endpoint,
    userID: catalog.userID,
  }
}

export function clearComfyUIWorkflowCatalogForTest() {
  catalogs.clear()
  catalogPromises.clear()
}

export function setComfyUIWorkflowCacheRootForTest(root: string | undefined) {
  const previous = cacheRootOverride
  cacheRootOverride = root
  return () => {
    cacheRootOverride = previous
  }
}

export function setConfiguredComfyUIConnectionForTest(
  connection: { baseURL: string; userID?: string | null } | undefined,
) {
  const previous = configuredConnectionOverride
  configuredConnectionOverride = connection
    ? {
      baseURL: validateComfyUIBaseURL(connection.baseURL),
      userID: connection.userID?.trim() || null,
    }
    : undefined
  return () => {
    configuredConnectionOverride = previous
  }
}
