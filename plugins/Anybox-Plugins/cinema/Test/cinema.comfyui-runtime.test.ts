import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type {
  CinemaCanvasDocument,
  CinemaGenerationTask,
  GenerationControl,
} from "@anybox/cinema-plugin/contracts"
import {
  clearComfyUIProfileCacheForTest,
  ComfyUIProviderAdapter,
  testComfyUIConnection,
  validateComfyUIBaseURL,
} from "#cinema/comfyui-runtime.ts"
import {
  COMFYUI_WORKFLOW_LIMITS,
  convertComfyUIWorkflowBuiltin,
  getInternalComfyUIWorkflow,
  refreshComfyUIWorkflowCatalog,
  setConfiguredComfyUIConnectionForTest,
  setComfyUIWorkflowCacheRootForTest,
} from "#cinema/comfyui-workflows.ts"
import { ApiError } from "#server/error.ts"

const servers: Array<ReturnType<typeof Bun.serve>> = []
const roots: string[] = []
const restoreCacheRoots: Array<() => void> = []

afterEach(async () => {
  clearComfyUIProfileCacheForTest()
  while (servers.length > 0) servers.pop()?.stop(true)
  while (restoreCacheRoots.length > 0) restoreCacheRoots.pop()?.()
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) await rm(root, { recursive: true, force: true })
  }
})

async function temporaryRoot(prefix = "anybox-comfyui-") {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function startServer(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })
  servers.push(server)
  return server.url.toString().replace(/\/$/, "")
}

function userDataFilePath(url: URL) {
  const prefix = "/userdata/"
  if (!url.pathname.startsWith(prefix)) return null
  const encodedPath = url.pathname.slice(prefix.length)
  if (!encodedPath || encodedPath.includes("/")) return null
  try {
    return decodeURIComponent(encodedPath)
  } catch {
    return null
  }
}

function appWorkflow(prompt = "A lighthouse at dusk.", version: 0.4 | 1 = 0.4) {
  return {
    version,
    title: "Lighthouse",
    nodes: [
      {
        id: 1,
        type: "CheckpointLoaderSimple",
        mode: 0,
        inputs: [],
        outputs: [
          { name: "MODEL", type: "MODEL", links: [1] },
          { name: "CLIP", type: "CLIP", links: [2] },
          { name: "VAE", type: "VAE", links: [3] },
        ],
        widgets_values: ["model.safetensors"],
      },
      {
        id: 2,
        type: "CLIPTextEncode",
        mode: 0,
        inputs: [{ name: "clip", type: "CLIP", link: 2 }],
        outputs: [{ name: "CONDITIONING", type: "CONDITIONING", links: [4] }],
        widgets_values: [prompt],
      },
      {
        id: 3,
        type: "EmptyLatentImage",
        mode: 0,
        inputs: [],
        outputs: [{ name: "LATENT", type: "LATENT", links: [5] }],
        widgets_values: [512, 512, 1],
      },
      {
        id: 4,
        type: "KSampler",
        mode: 0,
        inputs: [
          { name: "model", type: "MODEL", link: 1 },
          { name: "positive", type: "CONDITIONING", link: 4 },
          { name: "latent_image", type: "LATENT", link: 5 },
        ],
        outputs: [{ name: "LATENT", type: "LATENT", links: [6] }],
        widgets_values: [7, "fixed", 20, 7.5, "euler", "normal", 1],
      },
      {
        id: 5,
        type: "VAEDecode",
        mode: 0,
        inputs: [
          { name: "samples", type: "LATENT", link: 6 },
          { name: "vae", type: "VAE", link: 3 },
        ],
        outputs: [{ name: "IMAGE", type: "IMAGE", links: [7] }],
      },
      {
        id: 6,
        type: "SaveImage",
        mode: 0,
        inputs: [{ name: "images", type: "IMAGE", link: 7 }],
        outputs: [],
        widgets_values: ["Anybox"],
      },
    ],
    links: [
      [1, 1, 0, 4, 0, "MODEL"],
      [2, 1, 1, 2, 0, "CLIP"],
      [3, 1, 2, 5, 1, "VAE"],
      [4, 2, 0, 4, 1, "CONDITIONING"],
      [5, 3, 0, 4, 2, "LATENT"],
      [6, 4, 0, 5, 0, "LATENT"],
      [7, 5, 0, 6, 0, "IMAGE"],
    ],
    extra: {
      linearData: {
        inputs: [
          ["graph:2:text", "Prompt", { height: 120 }],
          ["graph:4:seed", "Seed"],
          ["graph:1:ckpt_name", "Model"],
        ],
        outputs: [6],
      },
    },
  }
}

function objectInfo(modelNames = ["model.safetensors"]) {
  return {
    CheckpointLoaderSimple: {
      input: { required: { ckpt_name: [modelNames, {}] } },
      output: ["MODEL", "CLIP", "VAE"],
    },
    CLIPTextEncode: {
      input: {
        required: {
          text: ["STRING", { multiline: true, default: "" }],
          clip: ["CLIP", {}],
        },
      },
      output: ["CONDITIONING"],
    },
    EmptyLatentImage: {
      input: {
        required: {
          width: ["INT", { default: 512, min: 64, max: 4096, step: 8 }],
          height: ["INT", { default: 512, min: 64, max: 4096, step: 8 }],
          batch_size: ["INT", { default: 1, min: 1, max: 16 }],
        },
      },
      output: ["LATENT"],
    },
    KSampler: {
      input: {
        required: {
          model: ["MODEL", {}],
          positive: ["CONDITIONING", {}],
          latent_image: ["LATENT", {}],
          seed: ["INT", { default: 0, min: 0, max: 9_007_199_254_740_991, control_after_generate: true }],
          steps: ["INT", { default: 20, min: 1, max: 100 }],
          cfg: ["FLOAT", { default: 8, min: 0, max: 100, step: 0.1 }],
          sampler_name: [["euler", "dpmpp_2m"], {}],
          scheduler: [["normal", "karras"], {}],
          denoise: ["FLOAT", { default: 1, min: 0, max: 1, step: 0.01 }],
        },
      },
      output: ["LATENT"],
    },
    VAEDecode: {
      input: { required: { samples: ["LATENT", {}], vae: ["VAE", {}] } },
      output: ["IMAGE"],
    },
    SaveImage: {
      input: {
        required: {
          images: ["IMAGE", {}],
          filename_prefix: ["STRING", { default: "ComfyUI" }],
        },
      },
      output: [],
      output_node: true,
    },
  }
}

type MockState = {
  files: Record<string, unknown>
  users?: Record<string, string>
  models?: string[]
  objectInfo?: Record<string, unknown>
  convert?: "missing" | "invalid" | "success"
  promptCalls: number
  convertCalls: number
  promptBody?: Record<string, unknown>
  promptResponse?: Record<string, unknown>
  history?: Record<string, unknown>
  queueRunning?: unknown[]
  queuePending?: unknown[]
  queueDeletes?: string[]
  uploads?: Array<{ name: string; size: number }>
}

function comfyServer(state: MockState) {
  return startServer(async (request) => {
    const url = new URL(request.url)
    if (url.pathname === "/system_stats") return Response.json({ system: { comfyui_version: "0.4.0" } })
    if (url.pathname === "/users") {
      return state.users
        ? Response.json({ storage: "server", users: state.users })
        : Response.json({ storage: "server", migrated: true })
    }
    if (url.pathname === "/object_info") return Response.json(state.objectInfo ?? objectInfo(state.models))
    if (url.pathname === "/models") return Response.json(["checkpoints"])
    if (url.pathname === "/models/checkpoints") return Response.json(state.models ?? ["model.safetensors"])
    if (url.pathname === "/userdata") {
      return Response.json(Object.entries(state.files).map(([file, value]) => ({
        path: file,
        size: Buffer.byteLength(JSON.stringify(value)),
        modified: 1_750_000_000_000,
      })))
    }
    const requestedUserDataFile = userDataFilePath(url)
    if (requestedUserDataFile?.startsWith("workflows/")) {
      const name = requestedUserDataFile.slice("workflows/".length)
      const value = state.files[name]
      return value === undefined
        ? new Response("missing", { status: 404 })
        : Response.json(value)
    }
    if (url.pathname === "/workflow/convert") {
      state.convertCalls += 1
      if (state.convert === "missing" || !state.convert) return new Response("missing", { status: 404 })
      if (state.convert === "invalid") return Response.json({ invalid: true })
      const workflow = await request.json() as Record<string, unknown>
      return Response.json(convertComfyUIWorkflowBuiltin(workflow, state.objectInfo ?? objectInfo()).prompt)
    }
    if (url.pathname === "/history" || url.pathname.startsWith("/history/")) {
      return Response.json(state.history ?? {})
    }
    if (url.pathname === "/queue" && request.method === "GET") {
      return Response.json({
        queue_running: state.queueRunning ?? [],
        queue_pending: state.queuePending ?? [],
      })
    }
    if (url.pathname === "/queue" && request.method === "POST") {
      const body = await request.json() as { delete?: unknown[] }
      const deleted = (body.delete ?? []).filter((value): value is string => typeof value === "string")
      state.queueDeletes = [...(state.queueDeletes ?? []), ...deleted]
      state.queuePending = (state.queuePending ?? []).filter((entry) => (
        !Array.isArray(entry) || !deleted.includes(String(entry[1]))
      ))
      return Response.json({})
    }
    if (url.pathname === "/upload/image") {
      const form = await request.formData()
      const uploaded = form.get("image")
      if (!(uploaded instanceof File)) return new Response("missing upload", { status: 400 })
      state.uploads = [...(state.uploads ?? []), { name: uploaded.name, size: uploaded.size }]
      return Response.json({
        name: uploaded.name,
        subfolder: String(form.get("subfolder") ?? ""),
        type: "input",
      })
    }
    if (url.pathname === "/prompt") {
      state.promptCalls += 1
      state.promptBody = await request.json() as Record<string, unknown>
      return Response.json(state.promptResponse ?? {
        prompt_id: `server-prompt-${state.promptCalls}`,
        node_errors: {},
      })
    }
    if (url.pathname === "/view") {
      return new Response(Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]), { headers: { "content-type": "image/png" } })
    }
    return new Response("not found", { status: 404 })
  })
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function canvas(): CinemaCanvasDocument {
  return {
    schemaVersion: 1,
    revision: 0,
    canvasType: "node-canvas",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    nodeTypes: [],
  }
}

async function taskRoots() {
  const root = await temporaryRoot()
  const cinemaRoot = path.join(root, ".anybox", "cinema")
  await mkdir(cinemaRoot, { recursive: true })
  restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
  return { root, cinemaRoot }
}

function workflowTask(
  workflowID: string,
  revision: string,
  values: Record<string, unknown>,
): CinemaGenerationTask {
  return {
    id: "task-comfyui-1",
    projectID: "project-comfyui-1",
    providerID: "comfyui-local",
    target: { kind: "workflow", workflowID, revision },
    mode: "text-to-image",
    title: "Lighthouse",
    status: "queued",
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    taskNodeID: "image-node-1",
    input: {
      prompt: "",
      sourceNodeIDs: [],
      parameters: values,
    },
    outputAssets: [],
    error: null,
  }
}

function workflowDefaultValues(controls: GenerationControl[]) {
  return Object.fromEntries(controls.flatMap((control) => (
    "defaultValue" in control && control.defaultValue !== undefined
      ? [[control.key, control.defaultValue]]
      : []
  )))
}

describe("ComfyUI workflow discovery", () => {
  test("accepts HTTPS or explicit loopback HTTP endpoints", () => {
    expect(validateComfyUIBaseURL(undefined)).toBe("http://127.0.0.1:8188")
    expect(validateComfyUIBaseURL("http://localhost:8188/")).toBe("http://localhost:8188")
    expect(validateComfyUIBaseURL("http://[::1]:8188")).toBe("http://[::1]:8188")
    expect(validateComfyUIBaseURL("https://example.com")).toBe("https://example.com")
    for (const value of [
      "http://192.168.1.2:8188",
      "ftp://127.0.0.1:8188",
      "http://127.0.0.1:8188/api",
    ]) {
      expect(() => validateComfyUIBaseURL(value)).toThrow()
    }
  })

  test("rejects a workflow target after the active ComfyUI origin changes", async () => {
    const root = await temporaryRoot()
    restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
    const firstEndpoint = comfyServer({
      files: { "workflow.json": appWorkflow("First origin") },
      promptCalls: 0,
      convertCalls: 0,
    })
    const secondEndpoint = comfyServer({
      files: { "workflow.json": appWorkflow("Second origin") },
      promptCalls: 0,
      convertCalls: 0,
    })
    const firstCatalog = await refreshComfyUIWorkflowCatalog({ baseURL: firstEndpoint, userID: null })
    const secondCatalog = await refreshComfyUIWorkflowCatalog({ baseURL: secondEndpoint, userID: null })
    const firstWorkflow = firstCatalog.workflows[0]!
    const secondWorkflow = secondCatalog.workflows[0]!
    const firstTarget = firstWorkflow.formSpec!.target
    const secondTarget = secondWorkflow.formSpec!.target
    if (firstTarget.kind !== "workflow" || secondTarget.kind !== "workflow") throw new Error("Expected workflow targets")
    expect(typeof firstTarget.connectionID).toBe("string")
    expect(typeof secondTarget.connectionID).toBe("string")
    restoreCacheRoots.push(setConfiguredComfyUIConnectionForTest({ baseURL: secondEndpoint, userID: null }))

    await expect(getInternalComfyUIWorkflow(
      firstWorkflow.workflowID,
      firstWorkflow.revision,
      firstTarget.connectionID,
    )).rejects.toMatchObject({
      code: "COMFYUI_CONNECTION_CHANGED",
      status: 409,
    })
    const activeWorkflow = await getInternalComfyUIWorkflow(
      secondWorkflow.workflowID,
      secondWorkflow.revision,
      secondTarget.connectionID,
    )
    expect(activeWorkflow).toMatchObject({ endpoint: secondEndpoint, userID: "default" })
  })

  test("discovers nested APP workflows without creating prompts and keeps IDs stable across revisions", async () => {
    const root = await temporaryRoot()
    restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
    const state: MockState = {
      files: { "nested/lighthouse.json": appWorkflow() },
      promptCalls: 0,
      convertCalls: 0,
      convert: "missing",
    }
    const endpoint = comfyServer(state)
    const first = await refreshComfyUIWorkflowCatalog({ baseURL: endpoint })

    expect(first.status).toBe("ready")
    expect(first.userID).toBe("default")
    expect(first.workflows).toHaveLength(1)
    expect(first.workflows[0]?.status).toBe("ready")
    expect(first.workflows[0]?.source.path).toBe("nested/lighthouse.json")
    expect(first.workflows[0]?.formSpec?.controls.map((control) => control.label))
      .toEqual(["Prompt", "Seed", "Model"])
    expect(first.workflows[0]?.output).toEqual({ kind: "image", nodeIDs: ["6"] })
    expect(state.promptCalls).toBe(0)

    const originalID = first.workflows[0]!.workflowID
    const originalRevision = first.workflows[0]!.revision
    state.files["nested/lighthouse.json"] = appWorkflow("A red lighthouse.")
    const second = await refreshComfyUIWorkflowCatalog({ baseURL: endpoint })

    expect(second.workflows[0]?.workflowID).toBe(originalID)
    expect(second.workflows[0]?.revision).not.toBe(originalRevision)
    expect(state.promptCalls).toBe(0)
  })

  test("uses object_info widgetType for union-typed APP controls", async () => {
    const root = await temporaryRoot()
    restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
    const workflow = appWorkflow()
    workflow.nodes.push({
      id: 7,
      type: "UnionWidget",
      mode: 0,
      inputs: [],
      outputs: [],
      widgets_values: [25],
    })
    workflow.nodes.push({
      id: 8,
      type: "Painter",
      mode: 0,
      inputs: [],
      outputs: [],
      widgets_values: ["mask-data"],
    })
    workflow.extra.linearData.inputs.push(
      ["graph:7:frame_rate", "Frame rate"],
      ["graph:8:mask", "Mask"],
    )
    const state: MockState = {
      files: { "union-widget.json": workflow },
      objectInfo: {
        ...objectInfo(),
        UnionWidget: {
          input: {
            required: {
              frame_rate: ["FLOAT,INT", {
                widgetType: "FLOAT",
                default: 24,
                min: 1,
                max: 120,
                step: 1,
              }],
            },
          },
          output: [],
        },
        Painter: {
          input: {
            required: {
              mask: ["STRING", { widgetType: "PAINTER", default: "" }],
            },
          },
          output: [],
        },
      },
      promptCalls: 0,
      convertCalls: 0,
    }

    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: comfyServer(state) })

    expect(catalog.workflows[0]?.status).toBe("ready")
    expect(catalog.workflows[0]?.formSpec?.controls.find((control) => control.label === "Frame rate"))
      .toMatchObject({
        type: "number",
        integer: false,
        defaultValue: 25,
        min: 1,
        max: 120,
        step: 1,
      })
    expect(catalog.workflows[0]?.formSpec?.controls.find((control) => control.label === "Mask"))
      .toMatchObject({
        type: "text",
        multiline: false,
        defaultValue: "mask-data",
      })
  })

  test("keeps the last successful catalog but blocks submission after an offline refresh", async () => {
    const root = await temporaryRoot()
    const cinemaRoot = path.join(root, ".anybox", "cinema")
    await mkdir(cinemaRoot, { recursive: true })
    restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
    const state: MockState = {
      files: { "workflow.json": appWorkflow() },
      promptCalls: 0,
      convertCalls: 0,
    }
    const endpoint = comfyServer(state)
    const first = await refreshComfyUIWorkflowCatalog({ baseURL: endpoint })
    const workflow = first.workflows[0]!
    servers.at(-1)?.stop(true)

    const offline = await refreshComfyUIWorkflowCatalog({ baseURL: endpoint })
    expect(offline.status).toBe("offline")
    expect(offline.lastSuccessfulRefreshAt).toBe(first.lastSuccessfulRefreshAt)
    expect(offline.workflows).toEqual(first.workflows)
    await expect(ComfyUIProviderAdapter.prepareTask!({
      root,
      cinemaRoot,
      task: workflowTask(
        workflow.workflowID,
        workflow.revision,
        workflowDefaultValues(workflow.formSpec!.controls),
      ),
      canvas: canvas(),
    })).rejects.toMatchObject({
      code: "COMFYUI_WORKFLOW_CATALOG_STALE",
      status: 409,
    })
  })

  test("treats a missing workflows directory as an empty catalog when userdata is available", async () => {
    const root = await temporaryRoot()
    restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
    const endpoint = startServer((request) => {
      const url = new URL(request.url)
      if (url.pathname === "/system_stats") return Response.json({})
      if (url.pathname === "/users") return Response.json({ storage: "server" })
      if (url.pathname === "/object_info") return Response.json(objectInfo())
      if (url.pathname === "/userdata" && url.searchParams.get("dir") === ".") return Response.json([])
      if (url.pathname === "/userdata") return new Response("Directory not found", { status: 404 })
      return new Response("missing", { status: 404 })
    })

    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: endpoint })
    expect(catalog.status).toBe("ready")
    expect(catalog.userID).toBe("default")
    expect(catalog.workflows).toEqual([])
  })

  test("caps the public catalog at 500 workflows and reports the overflow", async () => {
    const root = await temporaryRoot()
    restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
    const files = Array.from({ length: COMFYUI_WORKFLOW_LIMITS.maxWorkflows + 2 }, (_, index) => ({
      path: `workflow-${String(index).padStart(3, "0")}.json`,
      size: COMFYUI_WORKFLOW_LIMITS.maxFileBytes + 1,
    }))
    const endpoint = startServer((request) => {
      const url = new URL(request.url)
      if (url.pathname === "/system_stats") return Response.json({})
      if (url.pathname === "/users") return Response.json({ storage: "server" })
      if (url.pathname === "/object_info") return Response.json(objectInfo())
      if (url.pathname === "/userdata") return Response.json(files)
      return new Response("missing", { status: 404 })
    })

    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: endpoint })
    expect(catalog.workflows).toHaveLength(COMFYUI_WORKFLOW_LIMITS.maxWorkflows)
    expect(catalog.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "COMFYUI_WORKFLOW_COUNT_LIMIT" }),
    ]))
  })

  test("requires an explicit user in multi-user mode and sends Comfy-User after selection", async () => {
    const root = await temporaryRoot()
    restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
    const seenUsers: Array<string | null> = []
    const state: MockState = {
      users: { alice: "Alice", bob: "Bob" },
      files: { "alice.json": appWorkflow() },
      promptCalls: 0,
      convertCalls: 0,
    }
    const endpoint = startServer(async (request) => {
      const url = new URL(request.url)
      if (url.pathname !== "/users" && url.pathname !== "/system_stats") {
        seenUsers.push(request.headers.get("Comfy-User"))
      }
      if (url.pathname === "/system_stats") return Response.json({})
      if (url.pathname === "/users") return Response.json({ storage: "server", users: state.users })
      if (url.pathname === "/object_info") return Response.json(objectInfo())
      if (url.pathname === "/models") return Response.json(["checkpoints"])
      if (url.pathname === "/models/checkpoints") return Response.json(["model.safetensors"])
      if (url.pathname === "/userdata") {
        return Response.json([{ path: "alice.json", size: JSON.stringify(appWorkflow()).length }])
      }
      if (userDataFilePath(url) === "workflows/alice.json") return Response.json(appWorkflow())
      return new Response("missing", { status: 404 })
    })

    const unselected = await refreshComfyUIWorkflowCatalog({ baseURL: endpoint })
    expect(unselected.userID).toBeNull()
    expect(unselected.issues[0]?.code).toBe("COMFYUI_USER_SELECTION_REQUIRED")

    const selected = await refreshComfyUIWorkflowCatalog({ baseURL: endpoint, userID: "alice" })
    expect(selected.userID).toBe("alice")
    expect(selected.workflows[0]?.status).toBe("ready")
    expect(seenUsers.every((value) => value === "alice")).toBe(true)
  })

  test("keeps bad and oversized files visible as disabled diagnostics", async () => {
    const root = await temporaryRoot()
    restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
    const endpoint = startServer(async (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/system_stats") return Response.json({})
      if (url.pathname === "/users") return Response.json({ storage: "server" })
      if (url.pathname === "/object_info") return Response.json(objectInfo())
      if (url.pathname === "/models") return Response.json([])
      if (url.pathname === "/userdata") {
        return Response.json([
          { path: "bad.json", size: 8 },
          { path: "huge.json", size: COMFYUI_WORKFLOW_LIMITS.maxFileBytes + 1 },
        ])
      }
      if (userDataFilePath(url) === "workflows/bad.json") {
        return new Response("{broken", { headers: { "content-type": "application/json" } })
      }
      return new Response("missing", { status: 404 })
    })

    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: endpoint })
    expect(catalog.workflows).toHaveLength(2)
    expect(catalog.workflows.find((workflow) => workflow.source.path === "bad.json")?.issues[0]?.code)
      .toBe("COMFYUI_WORKFLOW_JSON_INVALID")
    expect(catalog.workflows.find((workflow) => workflow.source.path === "huge.json")?.issues[0]?.code)
      .toBe("COMFYUI_WORKFLOW_FILE_TOO_LARGE")
  })

  test("marks missing models and non-APP workflows disabled", async () => {
    const root = await temporaryRoot()
    restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
    const withoutApp = appWorkflow()
    delete (withoutApp as { extra?: unknown }).extra
    const state: MockState = {
      files: {
        "missing-model.json": appWorkflow(),
        "no-app.json": withoutApp,
      },
      models: [],
      objectInfo: objectInfo([]),
      promptCalls: 0,
      convertCalls: 0,
    }
    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: comfyServer(state) })

    expect(catalog.workflows.find((workflow) => workflow.source.path === "missing-model.json")?.issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "COMFYUI_MODEL_MISSING" })]))
    expect(catalog.workflows.find((workflow) => workflow.source.path === "no-app.json")?.issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "COMFYUI_APP_MODE_MISSING" })]))
  })

  test("disables workflows whose converted prompt is missing a required input", async () => {
    const root = await temporaryRoot()
    restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
    const brokenWorkflow = appWorkflow()
    const saveNode = brokenWorkflow.nodes.find((node) => node.id === 6)!
    ;(saveNode.inputs[0] as { link: number | null }).link = null
    brokenWorkflow.links = brokenWorkflow.links.filter((link) => link[3] !== 6)
    const state: MockState = {
      files: { "missing-required-input.json": brokenWorkflow },
      promptCalls: 0,
      convertCalls: 0,
    }

    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: comfyServer(state) })
    const workflow = catalog.workflows[0]!

    expect(workflow.status).toBe("disabled")
    expect(workflow.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "COMFYUI_REQUIRED_INPUT_MISSING",
        nodeID: "6",
        nodeType: "SaveImage",
        dependency: "images",
      }),
    ]))
    expect(state.promptCalls).toBe(0)
  })

  test("accepts flattened dynamic inputs in place of their aggregate object_info entry", async () => {
    const root = await temporaryRoot()
    restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
    const dynamicWorkflow = appWorkflow()
    dynamicWorkflow.nodes.push(
      {
        id: 7,
        type: "ComfyMathExpression",
        mode: 0,
        inputs: [{ name: "values.a", type: "FLOAT", link: 8 }],
        outputs: [],
        widgets_values: [],
      },
      {
        id: 8,
        type: "PrimitiveNode",
        mode: 0,
        inputs: [],
        outputs: [{ name: "FLOAT", type: "FLOAT", links: [8] }],
        widgets_values: [2],
      },
    )
    dynamicWorkflow.links.push([8, 8, 0, 7, 0, "FLOAT"])
    const state: MockState = {
      files: { "flattened-dynamic-input.json": dynamicWorkflow },
      objectInfo: {
        ...objectInfo(),
        ComfyMathExpression: {
          input: {
            required: {
              values: ["COMFY_AUTOGROW_V3", {
                template: {
                  input: { required: { value: ["FLOAT", {}] } },
                  min: 1,
                },
              }],
            },
          },
          output: ["FLOAT"],
        },
      },
      promptCalls: 0,
      convertCalls: 0,
    }

    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: comfyServer(state) })

    expect(catalog.workflows[0]?.status).toBe("ready")
    expect(catalog.workflows[0]?.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "COMFYUI_REQUIRED_INPUT_MISSING", dependency: "values" }),
    ]))
  })

  test("accepts zero-input APP contracts, maps upload combos, and rejects removed combo values", async () => {
    const root = await temporaryRoot()
    restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
    const fixedWorkflow = appWorkflow()
    fixedWorkflow.extra.linearData.inputs = []

    const uploadWorkflow = appWorkflow()
    uploadWorkflow.nodes.push({
      id: 7,
      type: "LoadImage",
      mode: 0,
      inputs: [],
      outputs: [],
      widgets_values: ["saved.png"],
    })
    uploadWorkflow.extra.linearData.inputs.push(["graph:7:image", "Input image"])

    const removedComboWorkflow = appWorkflow()
    removedComboWorkflow.nodes.push({
      id: 7,
      type: "ChoiceSink",
      mode: 0,
      inputs: [],
      outputs: [],
      widgets_values: ["removed"],
    })

    const info = {
      ...objectInfo(),
      LoadImage: {
        input: {
          required: {
            image: [["saved.png"], { image_upload: true }],
          },
        },
        output: ["IMAGE"],
      },
      ChoiceSink: {
        input: {
          required: {
            choice: [["available"], {}],
          },
        },
        output: [],
      },
    }
    const state: MockState = {
      files: {
        "fixed.json": fixedWorkflow,
        "upload.json": uploadWorkflow,
        "removed-combo.json": removedComboWorkflow,
      },
      objectInfo: info,
      promptCalls: 0,
      convertCalls: 0,
    }
    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: comfyServer(state) })
    const fixed = catalog.workflows.find((workflow) => workflow.source.path === "fixed.json")!
    const upload = catalog.workflows.find((workflow) => workflow.source.path === "upload.json")!
    const removed = catalog.workflows.find((workflow) => workflow.source.path === "removed-combo.json")!

    expect(fixed.status).toBe("ready")
    expect(fixed.formSpec?.controls).toEqual([])
    expect(upload.status).toBe("ready")
    expect(upload.formSpec?.controls.find((control) => control.label === "Input image")).toMatchObject({
      type: "media",
      mediaKind: "image",
      required: true,
    })
    expect(removed.status).toBe("disabled")
    expect(removed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "COMFYUI_COMBO_VALUE_UNAVAILABLE" }),
    ]))
  })

  test("uses a valid server converter and falls back on an invalid response", async () => {
    for (const convert of ["success", "invalid"] as const) {
      const root = await temporaryRoot(`anybox-comfyui-${convert}-`)
      restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
      const state: MockState = {
        files: { "workflow.json": appWorkflow() },
        convert,
        promptCalls: 0,
        convertCalls: 0,
      }
      const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: comfyServer(state) })
      expect(catalog.workflows[0]?.status).toBe("ready")
      expect(catalog.workflows[0]?.source.converter).toBe(convert === "success" ? "server" : "builtin")
      clearComfyUIProfileCacheForTest()
    }
  })
})

describe("ComfyUI built-in conversion", () => {
  test("resolves Primitive, reroute, bypass, Get and Set routing", () => {
    const workflow = {
      version: 0.4,
      nodes: [
        {
          id: 1,
          type: "Source",
          mode: 0,
          inputs: [],
          outputs: [{ name: "MODEL", type: "MODEL", links: [1] }],
        },
        {
          id: 2,
          type: "Bypass",
          mode: 4,
          inputs: [{ name: "model", type: "MODEL", link: 1 }],
          outputs: [{ name: "MODEL", type: "MODEL", links: [2] }],
        },
        {
          id: 3,
          type: "PrimitiveNode",
          mode: 0,
          inputs: [],
          outputs: [{ name: "INT", type: "INT", links: [3] }],
          widgets_values: [42],
        },
        {
          id: 4,
          type: "Reroute",
          mode: 0,
          inputs: [{ name: "", type: "*", link: 3 }],
          outputs: [{ name: "", type: "*", links: [4] }],
        },
        {
          id: 5,
          type: "Target",
          mode: 0,
          inputs: [
            { name: "model", type: "MODEL", link: 2 },
            { name: "seed", type: "INT", link: 4 },
          ],
          outputs: [],
        },
      ],
      links: [
        [1, 1, 0, 2, 0, "MODEL"],
        [2, 2, 0, 5, 0, "MODEL"],
        [3, 3, 0, 4, 0, "INT"],
        [4, 4, 0, 5, 1, "INT"],
      ],
    }
    const info = {
      Source: { input: {}, output: ["MODEL"] },
      Bypass: { input: { required: { model: ["MODEL", {}] } }, output: ["MODEL"] },
      Target: {
        input: { required: { model: ["MODEL", {}], seed: ["INT", { default: 0 }] } },
        output: [],
        output_node: true,
      },
    }
    const converted = convertComfyUIWorkflowBuiltin(workflow, info).prompt
    expect(converted["5"]?.inputs.model).toEqual(["1", 0])
    expect(converted["5"]?.inputs.seed).toBe(42)
    expect(converted["2"]).toBeUndefined()
    expect(converted["3"]).toBeUndefined()
    expect(converted["4"]).toBeUndefined()
  })

  test("keeps widget values aligned for object_info union widget types", () => {
    const workflow = {
      version: 0.4,
      nodes: [
        {
          id: 1,
          type: "Source",
          mode: 0,
          inputs: [],
          outputs: [{ name: "FLOAT", type: "FLOAT", links: [1] }],
        },
        {
          id: 2,
          type: "LTXVEmptyLatentAudio",
          mode: 0,
          inputs: [
            { name: "frames_number", type: "INT", widget: { name: "frames_number" }, link: null },
            { name: "frame_rate", type: "INT", widget: { name: "frame_rate" }, link: 1 },
            { name: "batch_size", type: "INT", widget: { name: "batch_size" }, link: null },
          ],
          outputs: [],
          widgets_values: [97, 25, 1],
        },
      ],
      links: [[1, 1, 0, 2, 1, "FLOAT"]],
    }
    const info = {
      Source: { input: {}, output: ["FLOAT"] },
      LTXVEmptyLatentAudio: {
        input: {
          required: {
            batch_size: ["INT", { default: 1 }],
            frame_rate: ["FLOAT,INT", { default: 25, widgetType: "FLOAT" }],
            frames_number: ["INT", { default: 97 }],
          },
        },
        input_order: {
          required: ["frames_number", "frame_rate", "batch_size"],
        },
        output: ["LATENT"],
      },
    }

    expect(convertComfyUIWorkflowBuiltin(workflow, info).prompt["2"]?.inputs).toEqual({
      frames_number: 97,
      frame_rate: ["1", 0],
      batch_size: 1,
    })
  })

  test("does not consume widget values for socket-only union or forced inputs", () => {
    for (const inputSpec of [
      ["FLOAT,INT", {}],
      ["FLOAT", { widgetType: "FLOAT", forceInput: true }],
    ]) {
      const workflow = {
        version: 0.4,
        nodes: [
          {
            id: 1,
            type: "Source",
            mode: 0,
            inputs: [],
            outputs: [{ name: "FLOAT", type: "FLOAT", links: [1] }],
          },
          {
            id: 2,
            type: "Target",
            mode: 0,
            inputs: [
              { name: "value", type: "FLOAT", link: 1 },
              { name: "batch_size", type: "INT", widget: { name: "batch_size" }, link: null },
            ],
            outputs: [],
            widgets_values: [1],
          },
        ],
        links: [[1, 1, 0, 2, 0, "FLOAT"]],
      }
      const info = {
        Source: { input: {}, output: ["FLOAT"] },
        Target: {
          input: {
            required: {
              value: inputSpec,
              batch_size: ["INT", { default: 7 }],
            },
          },
          output: [],
        },
      }

      expect(convertComfyUIWorkflowBuiltin(workflow, info).prompt["2"]?.inputs).toEqual({
        value: ["1", 0],
        batch_size: 1,
      })
    }
  })

  test("serializes V3 DynamicCombo widgets into flattened API prompt inputs", () => {
    const workflow = {
      version: 1,
      nodes: [{
        id: 1,
        type: "DynamicSink",
        mode: 0,
        inputs: [],
        outputs: [],
        widgets_values: ["LowPoly", "quadrilateral", true],
      }],
      links: [],
    }
    const info = {
      DynamicSink: {
        input: {
          required: {
            generate_type: ["COMFY_DYNAMICCOMBO_V3", {
              options: [
                {
                  key: "Normal",
                  inputs: { optional: { pbr: ["BOOLEAN", { default: false }] } },
                },
                {
                  key: "LowPoly",
                  inputs: {
                    required: {
                      polygon_type: [["triangle", "quadrilateral"], {}],
                    },
                    optional: {
                      pbr: ["BOOLEAN", { default: false }],
                    },
                  },
                },
              ],
            }],
          },
        },
        output: [],
      },
    }

    expect(convertComfyUIWorkflowBuiltin(workflow, info).prompt["1"]?.inputs).toEqual({
      generate_type: "LowPoly",
      "generate_type.polygon_type": "quadrilateral",
      "generate_type.pbr": true,
    })
  })

  test("expands Workflow 1.0 subgraph nodes", () => {
    const subgraphID = "11111111-1111-1111-1111-111111111111"
    const workflow = {
      version: 1,
      nodes: [{
        id: 50,
        type: subgraphID,
        mode: 0,
        inputs: [],
        outputs: [],
      }],
      links: [],
      definitions: {
        subgraphs: [{
          id: subgraphID,
          nodes: [{
            id: 1,
            type: "EmptyLatentImage",
            mode: 0,
            inputs: [],
            outputs: [],
            widgets_values: [512, 512, 1],
          }],
          links: [],
          inputs: [],
          outputs: [],
        }],
      },
    }
    const converted = convertComfyUIWorkflowBuiltin(workflow, objectInfo()).prompt
    expect(converted["50:1"]).toMatchObject({
      class_type: "EmptyLatentImage",
      inputs: { width: 512, height: 512, batch_size: 1 },
    })
  })

  test("reconnects a subgraph output to an external node input", () => {
    const subgraphID = "11111111-1111-1111-1111-111111111111"
    const workflow = {
      version: 1,
      nodes: [
        {
          id: 50,
          type: subgraphID,
          mode: 0,
          inputs: [],
          outputs: [{ name: "VIDEO", type: "VIDEO", links: [10] }],
        },
        {
          id: 60,
          type: "SaveVideo",
          mode: 0,
          inputs: [{ name: "video", type: "VIDEO", link: 10 }],
          outputs: [],
          widgets_values: ["Anybox"],
        },
      ],
      links: [[10, 50, 0, 60, 0, "VIDEO"]],
      definitions: {
        subgraphs: [{
          id: subgraphID,
          nodes: [{
            id: 1,
            type: "VideoSource",
            mode: 0,
            inputs: [],
            outputs: [{ name: "VIDEO", type: "VIDEO", links: [20] }],
          }],
          links: [[20, 1, 0, -20, 0, "VIDEO"]],
          inputs: [],
          outputs: [{ name: "VIDEO", type: "VIDEO", linkIds: [20] }],
        }],
      },
    }
    const info = {
      VideoSource: {
        input: { required: {} },
        output: ["VIDEO"],
      },
      SaveVideo: {
        input: {
          required: {
            video: ["VIDEO", {}],
            filename_prefix: ["STRING", { default: "ComfyUI" }],
          },
        },
        output: [],
        output_node: true,
      },
    }

    const converted = convertComfyUIWorkflowBuiltin(workflow, info).prompt

    expect(converted["60"]?.inputs.video).toEqual(["50:1", 0])
    expect(workflow.nodes[1]!.inputs[0]!.link).toBe(10)
  })

  test("keeps APP input bindings stable through nested Workflow 1.0 subgraphs", () => {
    const outerID = "11111111-1111-1111-1111-111111111111"
    const innerID = "22222222-2222-2222-2222-222222222222"
    const workflow = {
      version: 1,
      nodes: [{
        id: 50,
        type: outerID,
        mode: 0,
        inputs: [{ name: "text", type: "STRING", link: null }],
        outputs: [],
      }],
      links: [],
      definitions: {
        subgraphs: [
          {
            id: outerID,
            nodes: [{
              id: 2,
              type: innerID,
              mode: 0,
              inputs: [{ name: "text", type: "STRING", link: 101 }],
              outputs: [],
            }],
            links: [[101, -10, 0, 2, 0, "STRING"]],
            inputs: [{ name: "text", linkIds: [101] }],
            outputs: [],
          },
          {
            id: innerID,
            nodes: [{
              id: 1,
              type: "CLIPTextEncode",
              mode: 0,
              inputs: [{ name: "text", type: "STRING", link: 201 }],
              outputs: [],
              widgets_values: ["nested default"],
            }],
            links: [[201, -10, 0, 1, 0, "STRING"]],
            inputs: [{ name: "text", linkIds: [201] }],
            outputs: [],
          },
        ],
      },
    }
    const converted = convertComfyUIWorkflowBuiltin(workflow, objectInfo())
    expect(converted.bindingCandidates.get("50\u0000text")).toEqual([{
      nodeID: "50:2:1",
      inputName: "text",
    }])
  })
})

describe("ComfyUI workflow execution", () => {
  test("applies one APP Primitive control to every executable consumer", async () => {
    const { root, cinemaRoot } = await taskRoots()
    const uiWorkflow = structuredClone(appWorkflow())
    const sampler = uiWorkflow.nodes.find((node) => node.id === 4)!
    sampler.inputs.push({ name: "seed", type: "INT", link: 8 })
    uiWorkflow.nodes.push(
      {
        id: 7,
        type: "PrimitiveNode",
        mode: 0,
        inputs: [],
        outputs: [{ name: "INT", type: "INT", links: [8, 9] }],
        widgets_values: [42],
      },
      {
        id: 8,
        type: "NumberSink",
        mode: 0,
        inputs: [{ name: "value", type: "INT", link: 9 }],
        outputs: [],
        widgets_values: [],
      },
    )
    uiWorkflow.links.push(
      [8, 7, 0, 4, 3, "INT"],
      [9, 7, 0, 8, 0, "INT"],
    )
    uiWorkflow.extra.linearData.inputs = [
      ...uiWorkflow.extra.linearData.inputs.filter((entry) => entry[1] !== "Seed"),
      ["graph:7:value", "Seed"],
    ]
    const info = {
      ...objectInfo(),
      NumberSink: {
        input: { required: { value: ["INT", { default: 0 }] } },
        output: [],
      },
    }
    const state: MockState = {
      files: { "primitive-fanout.json": uiWorkflow },
      objectInfo: info,
      promptCalls: 0,
      convertCalls: 0,
    }
    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: comfyServer(state) })
    const workflow = catalog.workflows[0]!
    expect(workflow.status).toBe("ready")
    const values = workflowDefaultValues(workflow.formSpec!.controls)
    const seedControl = workflow.formSpec!.controls.find((control) => control.label === "Seed")!
    values[seedControl.key] = 123
    const task = workflowTask(workflow.workflowID, workflow.revision, values)
    const prepared = await ComfyUIProviderAdapter.prepareTask!({
      root,
      cinemaRoot,
      task,
      canvas: canvas(),
    })
    await ComfyUIProviderAdapter.createTask({
      root,
      cinemaRoot,
      task: prepared,
      canvas: canvas(),
    })

    const prompt = state.promptBody?.prompt as Record<string, { inputs: Record<string, unknown> }>
    expect(prompt["4"]?.inputs.seed).toBe(123)
    expect(prompt["8"]?.inputs.value).toBe(123)
  })

  test("switches a selected DynamicCombo with the option-specific default inputs", async () => {
    const { root, cinemaRoot } = await taskRoots()
    const uiWorkflow = structuredClone(appWorkflow())
    ;(uiWorkflow.nodes as unknown as Array<Record<string, unknown>>).push({
      id: 7,
      type: "DynamicSink",
      mode: 0,
      inputs: [],
      outputs: [],
      widgets_values: ["LowPoly", "quadrilateral", true],
    })
    uiWorkflow.extra.linearData.inputs.push(
      ["graph:7:generate_type", "Generate type"],
      ["graph:7:generate_type.polygon_type", "Polygon type"],
    )
    const info = {
      ...objectInfo(),
      DynamicSink: {
        input: {
          required: {
            generate_type: ["COMFY_DYNAMICCOMBO_V3", {
              options: [
                {
                  key: "Normal",
                  inputs: { optional: { pbr: ["BOOLEAN", { default: false }] } },
                },
                {
                  key: "LowPoly",
                  inputs: {
                    required: {
                      polygon_type: [["triangle", "quadrilateral"], {}],
                    },
                    optional: {
                      pbr: ["BOOLEAN", { default: false }],
                    },
                  },
                },
              ],
            }],
          },
        },
        output: [],
      },
    }
    const state: MockState = {
      files: { "dynamic-combo.json": uiWorkflow },
      objectInfo: info,
      promptCalls: 0,
      convertCalls: 0,
    }
    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: comfyServer(state) })
    const workflow = catalog.workflows[0]!
    expect(workflow.status).toBe("ready")
    const values = workflowDefaultValues(workflow.formSpec!.controls)
    const dynamicControl = workflow.formSpec!.controls.find((control) => control.label === "Generate type")!
    expect(dynamicControl).toMatchObject({
      type: "select",
      options: ["Normal", "LowPoly"],
      defaultValue: "LowPoly",
    })
    const polygonControl = workflow.formSpec!.controls.find((control) => control.label === "Polygon type")!
    expect(polygonControl).toMatchObject({
      type: "select",
      options: ["triangle", "quadrilateral"],
      defaultValue: "quadrilateral",
      visibleWhen: {
        [dynamicControl.key]: "LowPoly",
      },
    })
    values[dynamicControl.key] = "Normal"
    const task = workflowTask(workflow.workflowID, workflow.revision, values)
    const prepared = await ComfyUIProviderAdapter.prepareTask!({
      root,
      cinemaRoot,
      task,
      canvas: canvas(),
    })
    await ComfyUIProviderAdapter.createTask({
      root,
      cinemaRoot,
      task: prepared,
      canvas: canvas(),
    })

    const prompt = state.promptBody?.prompt as Record<string, { inputs: Record<string, unknown> }>
    expect(prompt["7"]?.inputs).toEqual({
      generate_type: "Normal",
      "generate_type.pbr": false,
    })
  })

  test("validates project media, uploads it, and replaces only the exposed APP binding", async () => {
    const { root, cinemaRoot } = await taskRoots()
    const inputDirectory = path.join(root, "assets", "imported")
    await mkdir(inputDirectory, { recursive: true })
    const inputPath = path.join(inputDirectory, "frame.png")
    await writeFile(inputPath, Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]))

    const uiWorkflow = appWorkflow()
    uiWorkflow.nodes.push({
      id: 7,
      type: "LoadImage",
      mode: 0,
      inputs: [],
      outputs: [],
      widgets_values: ["saved.png"],
    })
    uiWorkflow.extra.linearData.inputs.push(["graph:7:image", "Input image"])
    const info = {
      ...objectInfo(),
      LoadImage: {
        input: {
          required: {
            image: [["saved.png"], { image_upload: true }],
          },
        },
        output: ["IMAGE"],
      },
    }
    const state: MockState = {
      files: { "media.json": uiWorkflow },
      objectInfo: info,
      promptCalls: 0,
      convertCalls: 0,
    }
    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: comfyServer(state) })
    const workflow = catalog.workflows[0]!
    const control = workflow.formSpec!.controls.find((candidate) => candidate.label === "Input image")!
    const values = workflowDefaultValues(workflow.formSpec!.controls)
    values[control.key] = { path: "assets/imported/frame.png" }
    const task = workflowTask(workflow.workflowID, workflow.revision, values)
    const prepared = await ComfyUIProviderAdapter.prepareTask!({
      root,
      cinemaRoot,
      task,
      canvas: canvas(),
    })
    await ComfyUIProviderAdapter.createTask({
      root,
      cinemaRoot,
      task: prepared,
      canvas: canvas(),
    })

    expect(state.uploads).toEqual([
      expect.objectContaining({ size: 16 }),
    ])
    const prompt = state.promptBody?.prompt as Record<string, { inputs: Record<string, unknown> }>
    expect(prompt["7"]?.inputs.image).toBe(state.uploads?.[0]?.name)
    expect(prompt["2"]?.inputs.text).toBe("A lighthouse at dusk.")
  })

  test("rejects stale revisions and non-APP control keys", async () => {
    const { root, cinemaRoot } = await taskRoots()
    const state: MockState = {
      files: { "workflow.json": appWorkflow() },
      promptCalls: 0,
      convertCalls: 0,
    }
    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: comfyServer(state) })
    const workflow = catalog.workflows[0]!
    const values = workflowDefaultValues(workflow.formSpec!.controls)

    await expect(ComfyUIProviderAdapter.prepareTask!({
      root,
      cinemaRoot,
      task: workflowTask(workflow.workflowID, "sha256:old", values),
      canvas: canvas(),
    })).rejects.toMatchObject({
      code: "COMFYUI_WORKFLOW_REVISION_CHANGED",
      status: 409,
    })

    await expect(ComfyUIProviderAdapter.prepareTask!({
      root,
      cinemaRoot,
      task: workflowTask(workflow.workflowID, workflow.revision, { ...values, hiddenNodeInput: true }),
      canvas: canvas(),
    })).rejects.toMatchObject({
      code: "COMFYUI_WORKFLOW_INPUT_NOT_EXPOSED",
    })
  })

  test("only applies the legacy prompt fallback when APP mode exposes one text control", async () => {
    const { root, cinemaRoot } = await taskRoots()
    const uiWorkflow = appWorkflow()
    uiWorkflow.extra.linearData.inputs.push(["graph:6:filename_prefix", "Prefix"])
    const state: MockState = {
      files: { "workflow.json": uiWorkflow },
      promptCalls: 0,
      convertCalls: 0,
    }
    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: comfyServer(state) })
    const workflow = catalog.workflows[0]!
    const textControls = workflow.formSpec!.controls.filter(
      (control) => control.type === "prompt" || control.type === "text",
    )
    expect(textControls).toHaveLength(2)
    const values = workflowDefaultValues(workflow.formSpec!.controls)
    for (const control of textControls) delete values[control.key]
    const task = workflowTask(workflow.workflowID, workflow.revision, values)
    task.input.prompt = "Legacy prompt must not be copied into both controls."

    await ComfyUIProviderAdapter.prepareTask!({
      root,
      cinemaRoot,
      task,
      canvas: canvas(),
    })

    const snapshot = JSON.parse(await readFile(
      path.join(cinemaRoot, "state", "comfyui-workflows", `${task.id}.json`),
      "utf8",
    )) as { values: Record<string, unknown> }
    expect(snapshot.values[textControls[0]!.key]).toBe("A lighthouse at dusk.")
    expect(snapshot.values[textControls[1]!.key]).toBe("Anybox")
    expect(Object.values(snapshot.values)).not.toContain(task.input.prompt)
  })

  test("preserves ComfyUI node validation details when submission is rejected", async () => {
    const { root, cinemaRoot } = await taskRoots()
    const state: MockState = {
      files: { "workflow.json": appWorkflow() },
      promptCalls: 0,
      convertCalls: 0,
      promptResponse: {
        node_errors: {
          "6": {
            class_type: "SaveImage",
            errors: [{
              message: "Required input is missing",
              details: "images",
              extra_info: { input_name: "images" },
            }],
          },
        },
      },
    }
    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: comfyServer(state) })
    const workflow = catalog.workflows[0]!
    const values = workflowDefaultValues(workflow.formSpec!.controls)
    const task = workflowTask(workflow.workflowID, workflow.revision, values)
    const prepared = await ComfyUIProviderAdapter.prepareTask!({
      root,
      cinemaRoot,
      task,
      canvas: canvas(),
    })

    const rejected = await ComfyUIProviderAdapter.createTask({
      root,
      cinemaRoot,
      task: prepared,
      canvas: canvas(),
    })

    expect(rejected).toMatchObject({
      status: "failed",
      errorCode: "COMFYUI_WORKFLOW_INCOMPATIBLE",
      error: expect.stringContaining("SaveImage 6.images: Required input is missing"),
    })
  })

  test("snapshots, submits, and downloads all selected image outputs", async () => {
    const { root, cinemaRoot } = await taskRoots()
    const state: MockState = {
      files: { "workflow.json": appWorkflow() },
      promptCalls: 0,
      convertCalls: 0,
    }
    const endpoint = comfyServer(state)
    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: endpoint })
    const workflow = catalog.workflows[0]!
    const values = workflowDefaultValues(workflow.formSpec!.controls)
    const task = workflowTask(workflow.workflowID, workflow.revision, values)
    const prepared = await ComfyUIProviderAdapter.prepareTask!({
      root,
      cinemaRoot,
      task,
      canvas: canvas(),
    })
    const created = await ComfyUIProviderAdapter.createTask({
      root,
      cinemaRoot,
      task: prepared,
      canvas: canvas(),
    })

    expect(created.status).toBe("queued")
    expect(state.promptCalls).toBe(1)
    expect(state.promptBody?.prompt_id).toBeUndefined()
    expect(created.providerTaskRef?.promptID).toBe("server-prompt-1")
    expect(state.promptBody?.extra_data).toMatchObject({
      extra_pnginfo: {
        workflow: expect.objectContaining({ title: "Lighthouse" }),
      },
      anybox: {
        workflowID: workflow.workflowID,
        revision: workflow.revision,
      },
    })
    const submittedPrompt = state.promptBody?.prompt as Record<string, { inputs: Record<string, unknown> }>
    const promptControl = workflow.formSpec!.controls.find((control) => control.label === "Prompt")!
    expect(submittedPrompt["2"]?.inputs.text).toBe(values[promptControl.key])

    const promptID = stringValue(created.providerTaskRef?.promptID)!
    state.history = {
      [promptID]: {
        status: { status_str: "success", messages: [] },
        outputs: {
          "6": {
            images: [
              { filename: "first.png", subfolder: "", type: "output" },
              { filename: "second.png", subfolder: "batch", type: "output" },
            ],
          },
        },
      },
    }
    const completed = await ComfyUIProviderAdapter.refreshTask({
      root,
      cinemaRoot,
      task: created,
      canvas: canvas(),
    })

    expect(completed.status).toBe("succeeded")
    expect(completed.outputAssets).toHaveLength(2)
    expect(completed.outputAssets.every((asset) => asset.kind === "image" && asset.mimeType === "image/png")).toBe(true)
    expect(await readFile(path.join(root, completed.outputAssets[0]!.path))).toHaveLength(16)

    const baseSnapshot = JSON.parse(await readFile(
      path.join(cinemaRoot, "state", "comfyui-workflows", `${task.id}.json`),
      "utf8",
    )) as Record<string, unknown>
    const submittedSnapshot = JSON.parse(await readFile(
      path.join(cinemaRoot, "state", "comfyui-workflows", `${task.id}.submitted.json`),
      "utf8",
    )) as Record<string, unknown>
    expect(baseSnapshot.digest).toBeString()
    expect(submittedSnapshot.digest).toBeString()
  })

  test("recovers a server-assigned prompt ID without submitting a duplicate and can cancel it", async () => {
    const { root, cinemaRoot } = await taskRoots()
    const state: MockState = {
      files: { "workflow.json": appWorkflow() },
      promptCalls: 0,
      convertCalls: 0,
    }
    const endpoint = comfyServer(state)
    const catalog = await refreshComfyUIWorkflowCatalog({ baseURL: endpoint })
    const workflow = catalog.workflows[0]!
    const task = workflowTask(
      workflow.workflowID,
      workflow.revision,
      workflowDefaultValues(workflow.formSpec!.controls),
    )
    const prepared = await ComfyUIProviderAdapter.prepareTask!({
      root,
      cinemaRoot,
      task,
      canvas: canvas(),
    })
    state.queuePending = [[
      1,
      "server-recovered-prompt",
      {},
      { anybox: { taskID: task.id } },
      [],
    ]]

    const recovered = await ComfyUIProviderAdapter.createTask({
      root,
      cinemaRoot,
      task: prepared,
      canvas: canvas(),
    })
    expect(recovered.providerTaskRef?.promptID).toBe("server-recovered-prompt")
    expect(state.promptCalls).toBe(0)

    const canceled = await ComfyUIProviderAdapter.cancelTask!({
      root,
      cinemaRoot,
      task: recovered,
      canvas: canvas(),
    })
    expect(canceled.status).toBe("canceled")
    expect(state.queueDeletes).toEqual(["server-recovered-prompt"])
  })

  test("marks a queued legacy built-in task deterministically removed", async () => {
    const { root, cinemaRoot } = await taskRoots()
    const legacy: CinemaGenerationTask = {
      ...workflowTask("unused", "unused", {}),
      target: { kind: "model", modelID: "ltx-2.3-22b-dev-fp8" },
    }
    const result = await ComfyUIProviderAdapter.refreshTask({
      root,
      cinemaRoot,
      task: legacy,
      canvas: canvas(),
    })
    expect(result.status).toBe("failed")
    expect(result.errorCode).toBe("COMFYUI_LEGACY_WORKFLOW_REMOVED")
  })

  test("connection test validates workflow discovery instead of a fixed model profile", async () => {
    const root = await temporaryRoot()
    restoreCacheRoots.push(setComfyUIWorkflowCacheRootForTest(path.join(root, "cache")))
    const state: MockState = {
      files: { "workflow.json": appWorkflow() },
      promptCalls: 0,
      convertCalls: 0,
    }
    const result = await testComfyUIConnection({ baseURL: comfyServer(state) })
    expect(result).toMatchObject({
      ok: true,
      status: "ready",
      userID: "default",
      workflows: 1,
      readyWorkflows: 1,
      connectionID: expect.stringMatching(/^comfy_[0-9a-f]{32}$/),
      diagnostics: {
        service: "reachable",
        workflowDiscovery: "ready",
        workflows: 1,
        readyWorkflows: 1,
      },
    })
    expect(state.promptCalls).toBe(0)
  })
})
