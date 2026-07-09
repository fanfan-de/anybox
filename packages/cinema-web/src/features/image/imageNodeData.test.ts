import { describe, expect, it } from "vitest"
import {
  canonicalizeCinemaImageNodeData,
  deriveCinemaImageNodeState,
  finalizeCinemaImageCandidate,
  parseCinemaImageAsset,
  readCinemaImageCandidateAssets,
  readCinemaImageFinalAsset,
  readCinemaImageSelectedCandidate,
} from "./imageNodeData"

const firstAsset = {
  id: "image-1",
  kind: "image" as const,
  path: "generated/image-1.png",
  mimeType: "image/png",
  sizeBytes: 128,
  width: 1024,
  height: 768,
  url: "https://example.com/image-1.png",
}

const secondAsset = {
  id: "image-2",
  kind: "image" as const,
  path: "generated/image-2.png",
  width: 768,
  height: 1024,
}

describe("parseCinemaImageAsset", () => {
  it("parses a complete image asset and drops unknown properties", () => {
    expect(parseCinemaImageAsset({ ...firstAsset, internal: true })).toEqual(firstAsset)
  })

  it("supports legacy assets without an id or kind", () => {
    expect(parseCinemaImageAsset({ path: "imports/photo.png" })).toEqual({
      id: "image-imports/photo.png",
      kind: "image",
      path: "imports/photo.png",
    })
  })

  it("rejects non-images and values without a usable path", () => {
    expect(parseCinemaImageAsset(null)).toBeNull()
    expect(parseCinemaImageAsset({ kind: "video", path: "video.mp4" })).toBeNull()
    expect(parseCinemaImageAsset({ kind: "image", path: "  " })).toBeNull()
  })

  it("omits invalid optional dimensions and sizes", () => {
    expect(parseCinemaImageAsset({
      id: "image-invalid-metadata",
      path: "image.png",
      sizeBytes: -1,
      width: 0,
      height: 10.5,
    })).toEqual({
      id: "image-invalid-metadata",
      kind: "image",
      path: "image.png",
    })
  })
})

describe("canonicalizeCinemaImageNodeData", () => {
  it("keeps a direct final asset, preserves unrelated data, and infers upload", () => {
    const canonical = canonicalizeCinemaImageNodeData({
      asset: firstAsset,
      sourceFileName: "photo.png",
      importedAt: "2026-07-10T01:00:00.000Z",
      customField: { keep: true },
    })

    expect(canonical).toMatchObject({
      asset: firstAsset,
      sourceKind: "upload",
      sourceFileName: "photo.png",
      customField: { keep: true },
    })
  })

  it("infers crop ahead of the direct-asset upload fallback", () => {
    expect(canonicalizeCinemaImageNodeData({
      asset: firstAsset,
      derivedOperation: "crop",
    }).sourceKind).toBe("crop")
  })

  it("infers generation for a direct asset with generation provenance", () => {
    expect(canonicalizeCinemaImageNodeData({
      asset: firstAsset,
      taskID: "task-1",
    }).sourceKind).toBe("generation")
  })

  it("preserves an explicit valid source kind", () => {
    expect(canonicalizeCinemaImageNodeData({
      asset: firstAsset,
      sourceKind: "crop",
    }).sourceKind).toBe("crop")
  })

  it("migrates the selected legacy result into the final asset", () => {
    const canonical = canonicalizeCinemaImageNodeData({
      resultAssets: [firstAsset, secondAsset],
      selectedAssetID: secondAsset.id,
      prompt: "A lighthouse",
    })

    expect(canonical.asset).toEqual(secondAsset)
    expect(canonical.sourceKind).toBe("generation")
    expect(canonical.prompt).toBe("A lighthouse")
    expect(canonical).not.toHaveProperty("resultAssets")
    expect(canonical).not.toHaveProperty("selectedAssetID")
  })

  it("uses the first valid legacy result when the selection is stale", () => {
    expect(canonicalizeCinemaImageNodeData({
      resultAssets: [{ kind: "video", path: "ignore.mp4" }, firstAsset, secondAsset],
      selectedAssetID: "missing",
    }).asset).toEqual(firstAsset)
  })

  it("does not let an invalid canonical asset hide a valid legacy result", () => {
    const canonical = canonicalizeCinemaImageNodeData({
      asset: {},
      resultAssets: [firstAsset, secondAsset],
      selectedAssetID: secondAsset.id,
    })

    expect(canonical.asset).toEqual(secondAsset)
    expect(canonical.sourceKind).toBe("generation")
  })

  it("preserves canonical candidates without promoting them to a final asset", () => {
    const canonical = canonicalizeCinemaImageNodeData({
      candidateAssets: [firstAsset, secondAsset],
      selectedCandidateAssetID: secondAsset.id,
      status: "succeeded",
    })

    expect(canonical.asset).toBeUndefined()
    expect(canonical.candidateAssets).toEqual([firstAsset, secondAsset])
    expect(canonical.selectedCandidateAssetID).toBe(secondAsset.id)
    expect(canonical.sourceKind).toBe("generation")
  })

  it("drops stale candidates when a final asset already exists", () => {
    const canonical = canonicalizeCinemaImageNodeData({
      asset: firstAsset,
      candidateAssets: [secondAsset],
      selectedCandidateAssetID: secondAsset.id,
      sourceKind: "upload",
    })

    expect(canonical.asset).toEqual(firstAsset)
    expect(canonical).not.toHaveProperty("candidateAssets")
    expect(canonical).not.toHaveProperty("selectedCandidateAssetID")
  })

  it("repairs a missing candidate selection and removes invalid legacy fields", () => {
    const canonical = canonicalizeCinemaImageNodeData({
      asset: { kind: "video", path: "wrong.mp4" },
      candidateAssets: [{ kind: "video", path: "wrong.mp4" }, firstAsset],
      selectedCandidateAssetID: "missing",
      resultAssets: "invalid",
      selectedAssetID: 123,
      sourceKind: "invalid",
    })

    expect(canonical.asset).toBeUndefined()
    expect(canonical.candidateAssets).toEqual([firstAsset])
    expect(canonical.selectedCandidateAssetID).toBe(firstAsset.id)
    expect(canonical.sourceKind).toBe("generation")
    expect(canonical).not.toHaveProperty("resultAssets")
    expect(canonical).not.toHaveProperty("selectedAssetID")
  })
})

describe("image asset readers", () => {
  it("reads direct and migrated legacy final assets", () => {
    expect(readCinemaImageFinalAsset({ asset: firstAsset })).toEqual(firstAsset)
    expect(readCinemaImageFinalAsset({
      resultAssets: [firstAsset, secondAsset],
      selectedAssetID: secondAsset.id,
    })).toEqual(secondAsset)
  })

  it.each(["upload", "generation", "crop"] as const)(
    "exposes only the final asset for %s provenance",
    (sourceKind) => {
      expect(readCinemaImageFinalAsset({
        asset: firstAsset,
        sourceKind,
      })).toEqual(firstAsset)
    },
  )

  it("never exposes an unconfirmed candidate as the final asset", () => {
    expect(readCinemaImageFinalAsset({
      candidateAssets: [firstAsset],
      selectedCandidateAssetID: firstAsset.id,
    })).toBeNull()
  })

  it("reads valid candidates and the selected candidate", () => {
    const rawData = {
      candidateAssets: [firstAsset, { kind: "audio", path: "skip.mp3" }, secondAsset],
      selectedCandidateAssetID: secondAsset.id,
    }
    expect(readCinemaImageCandidateAssets(rawData)).toEqual([firstAsset, secondAsset])
    expect(readCinemaImageSelectedCandidate(rawData)).toEqual(secondAsset)
  })

  it("falls back to the first candidate for a missing selection", () => {
    expect(readCinemaImageSelectedCandidate({
      candidateAssets: [firstAsset, secondAsset],
      selectedCandidateAssetID: "missing",
    })).toEqual(firstAsset)
  })
})

describe("deriveCinemaImageNodeState", () => {
  it("derives empty when the node has no usable content or active work", () => {
    expect(deriveCinemaImageNodeState({ status: "idle" })).toBe("empty")
    expect(deriveCinemaImageNodeState({ status: "failed", error: "No output" }, "failed")).toBe("empty")
  })

  it("derives generating from task, raw-data, and progress statuses", () => {
    expect(deriveCinemaImageNodeState({}, "queued")).toBe("generating")
    expect(deriveCinemaImageNodeState({ status: "running" })).toBe("generating")
    expect(deriveCinemaImageNodeState({ progress: { phase: "processing" } })).toBe("generating")
  })

  it("gives choosing precedence over active generation statuses", () => {
    expect(deriveCinemaImageNodeState({
      candidateAssets: [firstAsset],
      status: "running",
    }, "running")).toBe("choosing")
  })

  it("gives a final asset precedence over candidates and task statuses", () => {
    expect(deriveCinemaImageNodeState({
      asset: firstAsset,
      candidateAssets: [secondAsset],
      status: "running",
    }, "running")).toBe("ready")
  })

  it("treats a legacy generated result as ready", () => {
    expect(deriveCinemaImageNodeState({ resultAssets: [firstAsset] })).toBe("ready")
  })
})

describe("finalizeCinemaImageCandidate", () => {
  it("moves the selected candidate to asset and clears candidate state", () => {
    const rawData = {
      candidateAssets: [firstAsset, secondAsset],
      selectedCandidateAssetID: secondAsset.id,
      prompt: "A lighthouse",
    }
    const finalized = finalizeCinemaImageCandidate(rawData)

    expect(finalized).toMatchObject({
      asset: secondAsset,
      sourceKind: "generation",
      prompt: "A lighthouse",
    })
    expect(finalized).not.toHaveProperty("candidateAssets")
    expect(finalized).not.toHaveProperty("selectedCandidateAssetID")
    expect(rawData).toHaveProperty("candidateAssets")
  })

  it("can finalize an explicit candidate without first changing selection", () => {
    expect(finalizeCinemaImageCandidate({
      candidateAssets: [firstAsset, secondAsset],
      selectedCandidateAssetID: firstAsset.id,
    }, secondAsset.id).asset).toEqual(secondAsset)
  })

  it("does not finalize a stale explicit candidate id", () => {
    const finalized = finalizeCinemaImageCandidate({
      candidateAssets: [firstAsset, secondAsset],
      selectedCandidateAssetID: firstAsset.id,
    }, "missing")

    expect(finalized.asset).toBeUndefined()
    expect(finalized.candidateAssets).toEqual([firstAsset, secondAsset])
  })

  it("does not replace an already finalized asset", () => {
    const finalized = finalizeCinemaImageCandidate({
      asset: firstAsset,
      sourceKind: "upload",
      candidateAssets: [secondAsset],
      selectedCandidateAssetID: secondAsset.id,
    })

    expect(finalized.asset).toEqual(firstAsset)
    expect(finalized.sourceKind).toBe("upload")
  })
})
