import { describe, expect, it } from "vitest"
import {
  type CinemaCanvasDocument,
  CinemaAssetBaseNameSchema,
  CinemaAssetCatalogSchema,
  CinemaAssetFolderSchema,
  CinemaAssetFolderMutationResultSchema,
  CinemaAssetLibraryEntriesQuerySchema,
  CinemaAssetLibraryEntriesResultSchema,
  CinemaAssetLibraryStateSchema,
  CinemaAssetMigrationResultSchema,
  CinemaAssetMigrationStatusResultSchema,
  CinemaAssetRecordSchema,
  CinemaAssetRecordMutationResultSchema,
  CinemaAssetRefSchema,
  CinemaAssetScopeSchema,
  CinemaAssetUploadResultSchema,
  CinemaImageGenerationResultSchema,
  CinemaImageNodeAssetSchema,
  CinemaImageNodeDataSchema,
  CinemaImportedImageAssetResultSchema,
  CinemaImageModelsResultSchema,
  CinemaCommandSchema,
  CinemaProjectDirectoryListingSchema,
  CinemaCanvasDocumentSchema,
  CinemaTextGenerationResultSchema,
  CinemaTextModelsResultSchema,
  CinemaGenerationTaskSchema,
  CinemaNodeTypeSchema,
  CinemaVideoProviderSchema,
  CinemaVideoProviderManifestSchema,
  GenerationFormSpecSchema,
  CreateCinemaGenerationTaskBodySchema,
  CreateCinemaImageGenerationBodySchema,
  CreateCinemaImportedImageAssetBodySchema,
  CreateCinemaTextGenerationBodySchema,
  CreateCinemaAssetFolderBodySchema,
  MoveCinemaAssetEntriesBodySchema,
  PermanentlyDeleteCinemaAssetEntriesBodySchema,
  ReconcileCinemaAssetLibraryBodySchema,
  RestoreCinemaAssetEntriesBodySchema,
  StartCinemaAssetMigrationBodySchema,
  TrashCinemaAssetEntriesBodySchema,
  UpdateCinemaAssetBodySchema,
} from "./cinema"

describe("cinema schemas", () => {
  const projectAssetScope = {
    type: "project" as const,
    projectID: "project-1",
  }

  const rootAssetFolder = {
    id: "folder-root",
    parentID: null,
    name: "素材库",
    relativePath: "",
    depth: 0,
    system: true,
    status: "active" as const,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  }

  const inboxAssetFolder = {
    id: "folder-inbox",
    parentID: "folder-root",
    name: "收件箱",
    relativePath: "收件箱",
    depth: 1,
    system: true,
    status: "active" as const,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  }

  const imageAsset = {
    id: "asset-image-1",
    folderID: "folder-inbox",
    relativePath: "收件箱/reference.png",
    displayName: "reference.png",
    kind: "image" as const,
    source: "upload" as const,
    status: "ready" as const,
    mimeType: "image/png",
    sizeBytes: 128,
    checksum: "sha256:abc123",
    width: 1920,
    height: 1080,
    thumbnailPath: ".derived/asset-image-1/0/thumbnail.webp",
    contentRevision: 0,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  }

  it("defaults legacy canvas revisions while accepting explicit revisions", () => {
    const legacyTypedCanvas: CinemaCanvasDocument = {
      schemaVersion: 1,
      canvasType: "node-canvas",
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
      nodeTypes: [],
    }
    const legacyCanvas = CinemaCanvasDocumentSchema.parse(legacyTypedCanvas)

    expect(legacyCanvas.revision).toBe(0)
    expect(legacyCanvas.edges).toEqual([])
    expect(legacyCanvas.nodeTypes).toEqual([])

    const currentCanvas = CinemaCanvasDocumentSchema.parse({
      ...legacyCanvas,
      revision: 7,
    })
    expect(currentCanvas.revision).toBe(7)
    expect(() => CinemaCanvasDocumentSchema.parse({ ...legacyCanvas, revision: -1 })).toThrow()
  })

  it("parses project and personal asset references", () => {
    expect(CinemaAssetScopeSchema.parse(projectAssetScope)).toEqual(projectAssetScope)
    expect(CinemaAssetScopeSchema.parse({ type: "personal" })).toEqual({ type: "personal" })
    expect(() => CinemaAssetScopeSchema.parse({ type: "team", teamID: "team-1" })).toThrow()
    expect(() => CinemaAssetScopeSchema.parse({ type: "personal", projectID: "project-1" })).toThrow()

    const assetRef = CinemaAssetRefSchema.parse({
      scope: projectAssetScope,
      assetID: imageAsset.id,
      contentRevision: 0,
      snapshot: {
        kind: "image",
        displayName: imageAsset.displayName,
        mimeType: imageAsset.mimeType,
        width: imageAsset.width,
        height: imageAsset.height,
      },
    })

    expect(assetRef.snapshot.kind).toBe("image")
    expect(assetRef.scope).toEqual(projectAssetScope)
    expect(() => CinemaAssetRefSchema.parse({ ...assetRef, snapshot: { ...assetRef.snapshot, kind: "file" } })).toThrow()
  })

  it("parses asset folders, records, catalogs, list results, and state", () => {
    const folder = CinemaAssetFolderSchema.parse(inboxAssetFolder)
    const asset = CinemaAssetRecordSchema.parse(imageAsset)
    expect(folder.depth).toBe(1)
    expect(asset.kind).toBe("image")

    const catalog = CinemaAssetCatalogSchema.parse({
      schemaVersion: 1,
      scope: projectAssetScope,
      rootFolderID: rootAssetFolder.id,
      folders: [rootAssetFolder, inboxAssetFolder],
      assets: [imageAsset],
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    })
    expect(catalog.revision).toBe(0)
    expect(catalog.status).toBe("ready")
    expect(catalog.completedOperationIDs).toEqual([])
    expect(catalog.operations).toEqual({})

    const listing = CinemaAssetLibraryEntriesResultSchema.parse({
      scope: projectAssetScope,
      revision: 2,
      folder: inboxAssetFolder,
      breadcrumbs: [rootAssetFolder, inboxAssetFolder],
      entries: [
        { entryType: "folder", folder: { ...inboxAssetFolder, id: "folder-child", name: "角色", depth: 2 } },
        { entryType: "asset", asset: imageAsset },
      ],
    })
    expect(listing.query).toBe("")
    expect(listing.view).toBe("library")
    expect(listing.nextCursor).toBeNull()
    expect(listing.entries[1]?.entryType).toBe("asset")

    const trashQuery = CinemaAssetLibraryEntriesQuerySchema.parse({ view: "trash", limit: "25" })
    expect(trashQuery).toEqual({ view: "trash", limit: 25 })
    expect(() => CinemaAssetLibraryEntriesQuerySchema.parse({ view: "archive" })).toThrow()

    const trashListing = CinemaAssetLibraryEntriesResultSchema.parse({
      scope: projectAssetScope,
      revision: 3,
      view: "trash",
      folder: null,
      breadcrumbs: [],
      entries: [{
        entryType: "asset",
        asset: {
          ...imageAsset,
          status: "trashed",
          trash: {
            operationID: "trash-image",
            originalFolderID: inboxAssetFolder.id,
            originalRelativePath: imageAsset.relativePath,
            trashedRelativePath: `.trash/trash-image/${imageAsset.id}-frame.png`,
            trashedAt: "2026-07-10T00:01:00.000Z",
            previousStatus: "failed",
          },
        },
      }],
    })
    expect(trashListing.view).toBe("trash")
    expect(trashListing.entries[0]?.entryType === "asset" && trashListing.entries[0].asset.trash?.previousStatus)
      .toBe("failed")

    const state = CinemaAssetLibraryStateSchema.parse({
      scope: projectAssetScope,
      revision: 2,
      status: "ready",
      readOnly: false,
      rootFolderID: rootAssetFolder.id,
      defaultFolderIDs: {
        inbox: inboxAssetFolder.id,
      },
      limits: {},
      counts: {
        folders: 2,
        assets: 1,
        processing: 0,
        failed: 0,
        missing: 0,
        trashed: 0,
      },
      updatedAt: "2026-07-10T00:00:00.000Z",
    })
    expect(state.limits.maxFolderDepth).toBe(8)
    expect(state.limits.maxVideoBytes).toBe(2 * 1024 * 1024 * 1024)
  })

  it("rejects invalid asset names, unsafe paths, and folders beyond depth eight", () => {
    expect(() => CinemaAssetFolderSchema.parse({ ...inboxAssetFolder, name: "CON" })).toThrow()
    expect(() => CinemaAssetFolderSchema.parse({ ...inboxAssetFolder, name: "bad/name" })).toThrow()
    expect(() => CinemaAssetFolderSchema.parse({ ...inboxAssetFolder, name: "trailing. " })).toThrow()
    expect(CinemaAssetFolderSchema.parse({ ...inboxAssetFolder, name: "e\u0301" }).name).toBe("é")
    expect(CinemaAssetBaseNameSchema.parse("re\u0301fe\u0301rence")).toBe("référence")
    expect(() => CinemaAssetFolderSchema.parse({ ...inboxAssetFolder, depth: 9 })).toThrow()
    expect(() => CinemaAssetRecordSchema.parse({ ...imageAsset, relativePath: "../outside.png" })).toThrow()
    expect(() => CinemaAssetRecordSchema.parse({ ...imageAsset, relativePath: "C:/outside.png" })).toThrow()
  })

  it("parses asset mutation bodies and rejects empty or self-cyclic moves", () => {
    const createFolder = CreateCinemaAssetFolderBodySchema.parse({
      operationID: "operation-create-folder",
      baseRevision: 2,
      parentFolderID: rootAssetFolder.id,
      name: "角色",
    })
    expect(createFolder.name).toBe("角色")

    const move = MoveCinemaAssetEntriesBodySchema.parse({
      operationID: "operation-move",
      baseRevision: 2,
      entries: [{ entryType: "asset", assetID: imageAsset.id }],
      destinationFolderID: "folder-characters",
    })
    expect(move.entries).toHaveLength(1)

    expect(() => MoveCinemaAssetEntriesBodySchema.parse({
      operationID: "operation-empty-move",
      baseRevision: 2,
      entries: [],
      destinationFolderID: "folder-characters",
    })).toThrow()
    expect(() => MoveCinemaAssetEntriesBodySchema.parse({
      operationID: "operation-cycle",
      baseRevision: 2,
      entries: [{ entryType: "folder", folderID: "folder-characters" }],
      destinationFolderID: "folder-characters",
    })).toThrow()

    const target = [{ entryType: "asset" as const, assetID: imageAsset.id }]
    expect(TrashCinemaAssetEntriesBodySchema.parse({ operationID: "trash", baseRevision: 2, entries: target }).entries).toEqual(target)
    expect(RestoreCinemaAssetEntriesBodySchema.parse({ operationID: "restore", baseRevision: 3, entries: target }).entries).toEqual(target)
    expect(PermanentlyDeleteCinemaAssetEntriesBodySchema.parse({ operationID: "delete", baseRevision: 4, entries: target }).entries).toEqual(target)
    expect(PermanentlyDeleteCinemaAssetEntriesBodySchema.parse({ operationID: "clear", baseRevision: 4, all: true }).all).toBe(true)
    expect(() => PermanentlyDeleteCinemaAssetEntriesBodySchema.parse({ operationID: "empty-delete", baseRevision: 4 })).toThrow()
    expect(() => PermanentlyDeleteCinemaAssetEntriesBodySchema.parse({
      operationID: "ambiguous-delete",
      baseRevision: 4,
      all: true,
      entries: target,
    })).toThrow()
    expect(UpdateCinemaAssetBodySchema.parse({ operationID: "rename", baseRevision: 4, baseName: "renamed" }).baseName).toBe("renamed")
    expect(ReconcileCinemaAssetLibraryBodySchema.parse({ operationID: "reconcile", baseRevision: 4 }).full).toBe(true)

    const folderResult = CinemaAssetFolderMutationResultSchema.parse({
      scope: projectAssetScope,
      operationID: "operation-create-folder",
      revision: 3,
      folder: inboxAssetFolder,
    })
    expect(folderResult.affected).toEqual([])

    const assetResult = CinemaAssetRecordMutationResultSchema.parse({
      scope: projectAssetScope,
      operationID: "rename",
      revision: 5,
      asset: imageAsset,
    })
    expect(assetResult.asset.id).toBe(imageAsset.id)
  })

  it("parses upload and migration results", () => {
    const upload = CinemaAssetUploadResultSchema.parse({
      scope: projectAssetScope,
      operationID: "upload-1",
      revision: 3,
      items: [
        { fileName: imageAsset.displayName, success: true, asset: imageAsset },
        {
          fileName: "broken.mp4",
          success: false,
          error: { code: "invalid-media", message: "The media container is invalid." },
        },
      ],
    })
    expect(upload.items[0]?.success).toBe(true)
    expect(upload.items[1]?.success).toBe(false)

    const status = CinemaAssetMigrationStatusResultSchema.parse({
      projectID: "project-1",
      phase: "required",
      readOnly: true,
      candidateCount: 1,
      totalBytes: imageAsset.sizeBytes,
      unrecognizedCount: 0,
      candidates: [{
        id: "candidate-1",
        sourcePath: "assets/imported/reference.png",
        destinationFolderID: inboxAssetFolder.id,
        kind: "image",
        sizeBytes: imageAsset.sizeBytes,
      }],
    })
    expect(status.candidates[0]?.selected).toBe(true)

    const start = StartCinemaAssetMigrationBodySchema.parse({
      operationID: "migration-1",
      baseRevision: 0,
    })
    expect(start.candidateIDs).toEqual([])

    const result = CinemaAssetMigrationResultSchema.parse({
      projectID: "project-1",
      operationID: "migration-1",
      phase: "completed",
      revision: 1,
      migratedAssetIDs: [imageAsset.id],
    })
    expect(result.warnings).toEqual([])
  })

  it("requires idempotency and optimistic concurrency fields on every command", () => {
    const viewport = CinemaCommandSchema.parse({
      id: "command-viewport-1",
      type: "update-viewport",
      baseRevision: 4,
      viewport: { x: 10, y: 20, zoom: 1.25 },
    })
    expect(viewport.baseRevision).toBe(4)
    expect(() => CinemaCommandSchema.parse({
      id: "command-viewport-2",
      type: "update-viewport",
      viewport: { x: 0, y: 0, zoom: 1 },
    })).toThrow()
    expect(() => CinemaCommandSchema.parse({
      type: "update-viewport",
      baseRevision: 4,
      viewport: { x: 0, y: 0, zoom: 1 },
    })).toThrow()

    const command = CinemaCommandSchema.parse({
      id: "command-asset-1",
      type: "create-node-from-asset",
      baseRevision: 5,
      nodeID: "image-node-1",
      assetRef: {
        scope: projectAssetScope,
        assetID: imageAsset.id,
      },
      position: { x: 120, y: 240 },
    })

    expect(command.type).toBe("create-node-from-asset")
    if (command.type === "create-node-from-asset") {
      expect(command.assetRef.assetID).toBe(imageAsset.id)
      expect(command.baseRevision).toBe(5)
    }
    expect(() => CinemaCommandSchema.parse({
      id: "command-asset-2",
      type: "create-node-from-asset",
      nodeID: "image-node-2",
      assetRef: { scope: projectAssetScope, assetID: imageAsset.id },
      position: { x: 0, y: 0 },
    })).toThrow()

    const relink = CinemaCommandSchema.parse({
      id: "command-relink-1",
      type: "relink-node-asset",
      baseRevision: 6,
      nodeID: "image-node-1",
      assetRef: {
        scope: { type: "personal" },
        assetID: "personal-image-1",
      },
    })
    expect(relink.type).toBe("relink-node-asset")
    if (relink.type === "relink-node-asset") {
      expect(relink.baseRevision).toBe(6)
      expect(relink.assetRef.scope.type).toBe("personal")
    }
  })

  it("parses canonical image node data", () => {
    expect(CinemaNodeTypeSchema.options).toEqual(["text", "image", "video", "audio"])
    expect(CinemaNodeTypeSchema.parse("image")).toBe("image")
    expect(() => CinemaNodeTypeSchema.parse("local-image")).toThrow()

    const data = CinemaImageNodeDataSchema.parse({
      candidateAssets: [
        {
          id: "candidate-1",
          kind: "image",
          path: "generated/images/image-1/candidate-1.png",
          mimeType: "image/png",
          width: 1024,
          height: 1024,
        },
        {
          id: "candidate-2",
          kind: "image",
          path: "generated/images/image-1/candidate-2.png",
        },
      ],
      selectedCandidateAssetID: "candidate-1",
      sourceKind: "generation",
      prompt: "A quiet moonlit frame.",
      providerID: "mockimage",
      modelID: "mock-image",
      taskID: "task-1",
      status: "succeeded",
      progress: {
        phase: "succeeded",
        percent: 100,
      },
      parameters: {
        size: "1024x1024",
      },
      generatedAt: "2026-07-10T00:00:00.000Z",
      error: null,
      cropMetadata: {
        x: 0.1,
      },
    })

    expect(data.sourceKind).toBe("generation")
    expect(data.candidateAssets).toHaveLength(2)
    expect(data.cropMetadata).toEqual({ x: 0.1 })
    expect(CinemaImageNodeAssetSchema.parse(data.candidateAssets?.[0]).kind).toBe("image")
    expect(() => CinemaImageNodeAssetSchema.parse({ id: "video-1", kind: "video", path: "video.mp4" })).toThrow()
    expect(() => CinemaImageNodeDataSchema.parse({ sourceKind: "replace" })).toThrow()
  })

  it("parses provider manifests and generation tasks", () => {
    const manifest = CinemaVideoProviderManifestSchema.parse({
      id: "kling",
      name: "Kling AI",
      baseURL: "https://api.example.com",
      credentialProviderID: "cinema-kling",
      requiresCredential: true,
      connectionTest: {
        path: "/v1/models",
      },
      models: [
        {
          id: "kling-3.0-turbo",
          label: "Kling 3.0 Turbo",
          offeringID: "klingai-global/kling-3.0-turbo",
          providerModelID: "kling-3.0-turbo",
          modes: ["text-to-video", "text-to-video.multi-shot"],
          inputCombinations: [
            {
              mode: "text-to-video.multi-shot",
              label: "Text to video multi-shot",
              inputs: [
                {
                  role: "prompt",
                  modality: "text",
                  required: true,
                  minCount: 1,
                  maxCount: 1,
                  note: "Use Shot n fixed format.",
                },
              ],
              endpoint: {
                method: "POST",
                path: "/text-to-video/kling-3.0-turbo",
                taskQuery: {
                  method: "GET",
                  path: "/text-to-video/kling-3.0-turbo/tasks/{taskID}",
                },
              },
            },
          ],
        },
        {
          id: "kling-image-3.0",
          label: "Kling Image 3.0",
          offeringID: "klingai-global/kling-image-3.0",
          providerModelID: "kling-v3",
          taskQueryEndpoint: {
            method: "GET",
            path: "/v1/images/generations/{taskID}",
          },
          modalities: {
            input: ["text", "image"],
            output: ["image"],
          },
          modes: ["text-to-image", "image-to-image", "image-edit"],
          inputCombinations: [
            {
              mode: "image-to-image",
              label: "Image to image",
              requiredModalities: ["image"],
              optionalModalities: ["text"],
              inputs: [
                {
                  role: "image",
                  modality: "image",
                  required: true,
                  minCount: 1,
                  maxCount: 1,
                },
              ],
              endpoint: {
                method: "POST",
                path: "/v1/images/edits",
              },
            },
          ],
        },
      ],
    })

    expect(manifest.requiresCredential).toBe(true)
    expect(manifest.baseURL).toBe("https://api.example.com")
    expect(manifest.connectionTest).toMatchObject({
      method: "GET",
      path: "/v1/models",
      auth: "bearer",
      expectedStatus: [200],
      timeoutMs: 10000,
    })
    expect(manifest.models[0]?.durations).toEqual([])
    expect(manifest.models[0]?.offeringID).toBe("klingai-global/kling-3.0-turbo")
    expect(manifest.models[0]?.modes).toEqual(["text-to-video", "text-to-video.multi-shot"])
    expect(manifest.models[0]?.inputCombinations[0]?.mode).toBe("text-to-video.multi-shot")
    expect(manifest.models[0]?.inputCombinations[0]?.inputs[0]?.note).toBe("Use Shot n fixed format.")
    expect(manifest.models[0]?.inputCombinations[0]?.endpoint?.taskQuery).toEqual({
      method: "GET",
      path: "/text-to-video/kling-3.0-turbo/tasks/{taskID}",
    })
    expect(manifest.models[1]?.providerModelID).toBe("kling-v3")
    expect(manifest.models[1]?.taskQueryEndpoint).toEqual({
      method: "GET",
      path: "/v1/images/generations/{taskID}",
    })
    expect(manifest.models[1]?.modes).toEqual(["text-to-image", "image-to-image", "image-edit"])
    expect(manifest.models[1]?.inputCombinations[0]).toMatchObject({
      mode: "image-to-image",
      endpoint: {
        method: "POST",
        path: "/v1/images/edits",
      },
      inputs: [{ role: "image", modality: "image", required: true, minCount: 1, maxCount: 1 }],
    })

    const task = CinemaGenerationTaskSchema.parse({
      id: "task-1",
      projectID: "project-1",
      providerID: "kling",
      modelID: "kling-3.0-turbo",
      mode: "text-to-video",
      title: "Test",
      status: "running",
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
      taskNodeID: "video-node-1",
      input: {
        prompt: "A test prompt",
      },
    })

    expect(task.input.sourceNodeIDs).toEqual([])
    expect(task.outputAssets).toEqual([])
    expect(task.progress).toBeUndefined()

    const taskWithProgress = CinemaGenerationTaskSchema.parse({
      ...task,
      progress: {
        phase: "processing",
        message: "Provider is rendering.",
        updatedAt: "2026-07-04T00:01:00.000Z",
      },
    })
    expect(taskWithProgress.progress?.phase).toBe("processing")

    const completedTask = CinemaGenerationTaskSchema.parse({
      ...task,
      status: "succeeded",
      progress: {
        phase: "succeeded",
        percent: 100,
      },
    })
    expect(completedTask.progress?.percent).toBe(100)
  })

  it("parses provider runtime metadata", () => {
    const provider = CinemaVideoProviderSchema.parse({
      manifest: {
        id: "kling",
        name: "Kling AI",
        credentialProviderID: "cinema-kling",
        requiresCredential: true,
        models: [
          {
            id: "kling-3.0-turbo",
            label: "Kling 3.0 Turbo",
            modes: ["text-to-video"],
          },
        ],
      },
      auth: {
        providerID: "kling",
        credentialProviderID: "cinema-kling",
        requiresCredential: true,
        connected: true,
        status: "connected",
      },
      runtime: {
        baseURL: "https://api-singapore.klingai.com",
        configuredBaseURL: "https://kling-proxy.example.com",
        baseURLSource: "settings",
        adapterAvailable: true,
        adapterID: "kling",
      },
    })

    expect(provider.runtime?.baseURL).toBe("https://api-singapore.klingai.com")
    expect(provider.runtime?.configuredBaseURL).toBe("https://kling-proxy.example.com")
    expect(provider.runtime?.baseURLSource).toBe("settings")
    expect(provider.runtime?.adapterAvailable).toBe(true)
    expect(provider.runtime?.adapterID).toBe("kling")
  })

  it("parses provider task modes including catalog-defined combination modes", () => {
    const body = CreateCinemaGenerationTaskBodySchema.parse({
      providerID: "kling",
      modelID: "kling-3.0-turbo",
      mode: "text-to-video",
      taskNodeID: "video-node-1",
    })

    expect(body.taskNodeID).toBe("video-node-1")

    const customModeBody = CreateCinemaGenerationTaskBodySchema.parse({
      providerID: "kling",
      modelID: "kling-3.0-turbo",
      mode: "text-to-video.multi-shot",
      taskNodeID: "video-node-1",
    })

    expect(customModeBody.mode).toBe("text-to-video.multi-shot")

    const imageBody = CreateCinemaGenerationTaskBodySchema.parse({
      providerID: "kling",
      modelID: "kling-image-3.0",
      mode: "text-to-image",
      taskNodeID: "image-node-1",
    })

    expect(imageBody.mode).toBe("text-to-image")

    const referenceVideoBody = CreateCinemaGenerationTaskBodySchema.parse({
      providerID: "kling",
      modelID: "kling-3.0-turbo",
      mode: "reference-to-video",
      taskNodeID: "video-node-1",
      parameters: {
        inputSlots: [
          {
            slot: "referenceImage",
            nodeID: "image-1",
            edgeID: "edge-image-1-video-1",
            assetID: "reference-1",
            path: "assets/reference-1.png",
          },
        ],
        referenceImageAssetID: "reference-1",
        referenceImageAssetIDs: ["reference-1", "reference-2"],
        referenceImagePath: "assets/reference-1.png",
        referenceImagePaths: ["assets/reference-1.png", "assets/reference-2.png"],
      },
    })

    expect(referenceVideoBody.mode).toBe("reference-to-video")
    expect(referenceVideoBody.parameters.referenceImageAssetIDs).toEqual(["reference-1", "reference-2"])

    expect(() =>
      CreateCinemaGenerationTaskBodySchema.parse({
        providerID: "kling",
        modelID: "kling-3.0-turbo",
        mode: "text-to-video",
        taskNodeID: "",
      })
    ).toThrow()
  })

  it("parses generation form specs for Kling Omni image controls", () => {
    const spec = GenerationFormSpecSchema.parse({
      providerID: "klingai-cn",
      modelID: "klingai-cn/kling-image-3.0-omni",
      mode: "omni-image",
      output: "image",
      controls: [
        {
          type: "prompt",
          key: "prompt",
          label: "Prompt",
          required: true,
          maxLength: 2500,
        },
        {
          type: "image-list",
          key: "image_list",
          label: "Reference images",
          required: false,
          minCount: 0,
          maxCount: 10,
          supportedFormats: ["jpg", "jpeg", "png"],
          maxFileSizeMB: 10,
        },
        {
          type: "select",
          key: "resolution",
          label: "Resolution",
          required: false,
          options: ["1k", "2k", "4k"],
          labels: {
            "1k": "1K",
            "2k": "2K",
            "4k": "4K",
          },
          defaultValue: "1k",
        },
        {
          type: "select",
          key: "result_type",
          label: "Result type",
          required: false,
          options: ["single", "series"],
          defaultValue: "single",
        },
        {
          type: "number",
          key: "count",
          label: "Count",
          required: false,
          min: 1,
          max: 9,
          defaultValue: 1,
          visibleWhen: {
            result_type: "single",
          },
        },
        {
          type: "select",
          key: "series_amount",
          label: "Series amount",
          required: false,
          options: [2, 3, 4, 5, 6, 7, 8, 9, "auto"],
          defaultValue: 4,
          visibleWhen: {
            result_type: "series",
          },
        },
      ],
    })

    expect(spec.controls.find((control) => control.key === "image_list")).toMatchObject({
      type: "image-list",
      maxCount: 10,
    })
    expect(spec.controls.find((control) => control.key === "count")).toMatchObject({
      type: "number",
      max: 9,
      visibleWhen: {
        result_type: "single",
      },
    })
    expect(spec.controls.find((control) => control.key === "series_amount")).toMatchObject({
      type: "select",
      visibleWhen: {
        result_type: "series",
      },
    })
  })

  it("parses text model lists and text generation payloads", () => {
    const models = CinemaTextModelsResultSchema.parse({
      items: [
        {
          value: "openai/gpt-5.4",
          providerID: "openai",
          modelID: "gpt-5.4",
          label: "GPT-5.4",
          providerLabel: "OpenAI",
          available: true,
          supportsImageInput: true,
        },
      ],
      selection: {
        model: "openai/gpt-5.4",
      },
      effectiveModel: {
        value: "openai/gpt-5.4",
        providerID: "openai",
        modelID: "gpt-5.4",
        label: "GPT-5.4",
        providerLabel: "OpenAI",
        available: true,
        supportsImageInput: true,
      },
    })

    expect(models.items[0]?.value).toBe("openai/gpt-5.4")
    expect(models.items[0]?.supportsImageInput).toBe(true)

    const body = CreateCinemaTextGenerationBodySchema.parse({
      nodeID: "text-1",
      prompt: "Expand this beat.",
      model: "openai/gpt-5.4",
      sourceImageAssetID: "image-1",
      sourceImageAssetIDs: ["image-1", "image-2"],
      sourceImagePath: "generated/images/image-1.png",
      sourceImagePaths: ["generated/images/image-1.png", "generated/images/image-2.png"],
      writeMode: "append",
    })

    expect(body.writeMode).toBe("append")
    expect(body.sourceImagePath).toBe("generated/images/image-1.png")
    expect(body.sourceImagePaths).toEqual(["generated/images/image-1.png", "generated/images/image-2.png"])

    const result = CinemaTextGenerationResultSchema.parse({
      canvas: {
        schemaVersion: 1,
        canvasType: "node-canvas",
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
        nodeTypes: [],
      },
      nodeID: "text-1",
      text: "Original\n\nGenerated",
      generatedText: "Generated",
      model: "openai/gpt-5.4",
    })

    expect(result.generatedText).toBe("Generated")
  })

  it("rejects invalid text generation payloads", () => {
    expect(() =>
      CreateCinemaTextGenerationBodySchema.parse({
        nodeID: "text-1",
        prompt: "   ",
        writeMode: "append",
      })
    ).toThrow()

    expect(() =>
      CreateCinemaTextGenerationBodySchema.parse({
        nodeID: "text-1",
        prompt: "Generate",
        writeMode: "replace",
      })
    ).toThrow()
  })

  it("parses image model lists and image generation payloads", () => {
    const models = CinemaImageModelsResultSchema.parse({
      items: [
        {
          value: "klingai/kling-image-v3",
          providerID: "klingai",
          modelID: "kling-image-v3",
          label: "Kling Image 3.0",
          providerLabel: "KlingAI",
          available: true,
          supportsImageInput: true,
        },
      ],
      selection: {
        image_model: null,
      },
      effectiveModel: {
        value: "klingai/kling-image-v3",
        providerID: "klingai",
        modelID: "kling-image-v3",
        label: "Kling Image 3.0",
        providerLabel: "KlingAI",
        available: true,
        supportsImageInput: true,
      },
    })

    expect(models.effectiveModel?.value).toBe("klingai/kling-image-v3")
    expect(models.effectiveModel?.supportsImageInput).toBe(true)

    const body = CreateCinemaImageGenerationBodySchema.parse({
      nodeID: "image-1",
      prompt: "A neon storyboard frame.",
      userPrompt: "A neon storyboard frame.",
      model: "klingai/kling-image-v3",
      size: "1024x1024",
      count: 9,
      style: "cinematic",
      parameters: {
        resolution: "2k",
        aspect_ratio: "16:9",
        result_type: "single",
      },
      sourceNodeIDs: ["text-1", "image-ref-1"],
      sourceTextPrompts: ["Storyboard note."],
      sourceImageAssetID: "reference-1",
      sourceImageAssetIDs: ["reference-1", "reference-2"],
      sourceImagePath: "assets/reference-1.png",
      sourceImagePaths: ["assets/reference-1.png", "assets/reference-2.png"],
    })

    expect(body.count).toBe(9)
    expect(body.parameters.result_type).toBe("single")
    expect(body.sourceNodeIDs).toEqual(["text-1", "image-ref-1"])
    expect(body.sourceTextPrompts).toEqual(["Storyboard note."])
    expect(body.sourceImagePath).toBe("assets/reference-1.png")
    expect(body.sourceImagePaths).toEqual(["assets/reference-1.png", "assets/reference-2.png"])

    const result = CinemaImageGenerationResultSchema.parse({
      canvas: {
        schemaVersion: 1,
        canvasType: "node-canvas",
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
        nodeTypes: [],
      },
      nodeID: "image-1",
      model: "klingai/kling-image-v3",
      taskID: "task-image-1",
      status: "running",
      assets: [
        {
          id: "asset-1",
          kind: "image",
          path: "generated/images/image-1/2026-07-05-1.png",
          mimeType: "image/png",
          sizeBytes: 68,
          width: 1,
          height: 1,
        },
      ],
    })

    expect(result.assets[0]?.width).toBe(1)

    const importBody = CreateCinemaImportedImageAssetBodySchema.parse({
      fileName: "reference.png",
      mimeType: "image/png",
      dataBase64: "iVBORw0KGgo=",
    })
    expect(importBody.fileName).toBe("reference.png")

    const imported = CinemaImportedImageAssetResultSchema.parse({
      asset: {
        id: "import-1",
        kind: "image",
        path: "assets/imported/reference.png",
        mimeType: "image/png",
        sizeBytes: 8,
        width: 1,
        height: 1,
      },
    })
    expect(imported.asset.kind).toBe("image")
  })

  it("rejects invalid image generation payloads", () => {
    expect(() =>
      CreateCinemaImageGenerationBodySchema.parse({
        nodeID: "image-1",
        prompt: "   ",
      })
    ).toThrow()

    expect(() =>
      CreateCinemaImageGenerationBodySchema.parse({
        nodeID: "image-1",
        prompt: "Generate",
        size: "square",
      })
    ).toThrow()

    expect(() =>
      CreateCinemaImageGenerationBodySchema.parse({
        nodeID: "image-1",
        prompt: "Generate",
        count: 0,
      })
    ).toThrow()
  })

  it("parses project directory listings", () => {
    const listing = CinemaProjectDirectoryListingSchema.parse({
      projectID: "project-1",
      root: "/tmp/project",
      path: "generated/images",
      parentPath: "generated",
      entries: [
        {
          name: "shot-1.png",
          path: "generated/images/shot-1.png",
          kind: "file",
          sizeBytes: 128,
          modifiedAt: "2026-07-06T00:00:00.000Z",
          mimeType: "image/png",
          previewable: true,
        },
        {
          name: "refs",
          path: "generated/images/refs",
          kind: "directory",
        },
      ],
    })

    expect(listing.entries[0]?.previewable).toBe(true)
    expect(listing.entries[1]?.previewable).toBe(false)
  })
})
