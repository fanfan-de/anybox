import { describe, expect, it } from "vitest"
import type { CinemaProviderInputCombination } from "@anybox/cinema-plugin/contracts"

import {
  generationControlDefaultParameters,
  generationModeInputContractForCombination,
} from "./generationContract"
import {
  buildGenerationTaskParameters,
  generationLegacyAssetsBySlot,
} from "./generationPayload"
import type { GenerationActiveInputAsset } from "./generationPayload"

const sharedParameters: CinemaProviderInputCombination["inputs"] = [
  {
    role: "prompt",
    modality: "text",
    required: true,
    minCount: 1,
    maxCount: 1,
  },
  {
    role: "aspect_ratio",
    modality: "parameter",
    required: true,
    minCount: 1,
    maxCount: 1,
    default: "16:9",
    options: ["16:9", "9:16", "1:1"],
  },
  {
    role: "duration",
    modality: "parameter",
    required: true,
    minCount: 1,
    maxCount: 1,
    default: 3,
    options: [3, 5],
  },
  {
    role: "resolution",
    modality: "parameter",
    required: true,
    minCount: 1,
    maxCount: 1,
    default: "480p",
    options: ["480p", "720p"],
  },
  {
    role: "negative_prompt",
    label: "Negative prompt",
    modality: "text",
    uiControl: "textarea",
    required: false,
    minCount: 0,
    maxCount: 1,
  },
  {
    role: "seed",
    label: "Seed",
    modality: "integer",
    uiControl: "number",
    required: false,
    minCount: 0,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  },
]

describe("Local ComfyUI generation contract", () => {
  it("maps T2V controls to the manifest-driven video form", () => {
    const combination: CinemaProviderInputCombination = {
      mode: "text-to-video",
      label: "Text to video",
      requiredModalities: [],
      optionalModalities: [],
      requirements: [],
      inputs: sharedParameters,
    }
    const contract = generationModeInputContractForCombination(combination, "text-to-video")

    expect(contract.inputs.find((input) => input.role === "prompt")).toMatchObject({
      slot: "textParameter",
      required: true,
      fulfillment: "user-text",
    })
    expect(contract.inputs.find((input) => input.role === "aspect_ratio")).toMatchObject({
      parameterControl: "aspectRatio",
      fulfillment: "visible-parameter",
    })
    expect(contract.inputs.find((input) => input.role === "duration")).toMatchObject({
      parameterControl: "duration",
    })
    expect(contract.inputs.find((input) => input.role === "resolution")).toMatchObject({
      parameterControl: "resolution",
    })
    expect(contract.parameterControls).toEqual([
      expect.objectContaining({ key: "negative_prompt", type: "prompt", required: false }),
      expect.objectContaining({ key: "seed", type: "number", min: 0, required: false }),
    ])
    expect(generationControlDefaultParameters(contract.parameterControls)).toEqual({})
    expect(contract.unsupportedRequiredInputs).toEqual([])
  })

  it("requires exactly one first-frame image and emits its project path", () => {
    const firstFrameInput: CinemaProviderInputCombination["inputs"][number] = {
      role: "first_frame_image",
      label: "First frame",
      modality: "image",
      required: true,
      minCount: 1,
      maxCount: 1,
      supportedFormats: ["image/png", "image/jpeg", "image/webp"],
      maxFileSizeMB: 25,
    }
    const combination: CinemaProviderInputCombination = {
      mode: "image-to-video",
      label: "Image to video",
      requiredModalities: [],
      optionalModalities: [],
      requirements: [],
      inputs: [firstFrameInput, ...sharedParameters],
    }
    const contract = generationModeInputContractForCombination(combination, "image-to-video")
    const firstFrame = contract.inputs.find((input) => input.role === "first_frame_image")

    expect(firstFrame).toMatchObject({
      slot: "startFrame",
      required: true,
      minCount: 1,
      maxCount: 1,
      fulfillment: "user-media",
    })
    if (firstFrame?.slot !== "startFrame") throw new Error("Expected a first-frame media input")

    const activeInputAssets: GenerationActiveInputAsset[] = [{
      input: {
        ...firstFrame,
        slot: "startFrame",
      },
      asset: {
        id: "frame-asset",
        path: "assets/frame.png",
        kind: "image",
        nodeID: "image-node-1",
        edgeID: "edge-image-video",
      },
    }]
    const parameters = buildGenerationTaskParameters({
      baseParameters: {},
      hiddenDefaultParameters: {},
      fixedParameters: {
        aspectRatio: "16:9",
        duration: 3,
        resolution: "480p",
      },
      sourceTextParameters: [],
      activeInputAssets,
      legacyAssetsBySlot: generationLegacyAssetsBySlot(activeInputAssets),
      includeSourceImageFields: false,
    })

    expect(parameters).toMatchObject({
      startFrameAssetID: "frame-asset",
      startFramePath: "assets/frame.png",
      aspectRatio: "16:9",
      duration: 3,
      resolution: "480p",
      inputSlots: [{
        role: "first_frame_image",
        slot: "startFrame",
        assetID: "frame-asset",
        path: "assets/frame.png",
      }],
    })
  })
})
