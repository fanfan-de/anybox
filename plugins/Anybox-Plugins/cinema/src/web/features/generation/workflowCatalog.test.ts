import { describe, expect, it } from "vitest"
import type {
  CinemaProviderWorkflowCatalog,
  CinemaVideoProvider,
  GenerationFormSpec,
} from "@anybox/cinema-plugin/contracts"

import {
  providersWithDiscoveredWorkflows,
  reconcileGenerationParameters,
} from "./workflowCatalog"
import { generationModeInputContractForCombination } from "./generationContract"

const formSpec: GenerationFormSpec = {
  providerID: "comfyui-local",
  target: { kind: "workflow", workflowID: "workflow-1", revision: "rev-1" },
  mode: "text-to-video",
  output: "video",
  controls: [
    { type: "prompt", key: "positive", label: "Prompt", required: true, multiline: true },
    { type: "select", key: "model", label: "Model", required: true, options: ["a.safetensors", "b.safetensors"], defaultValue: "a.safetensors" },
    { type: "number", key: "seed", label: "Seed", required: false, integer: true, min: 0, defaultValue: 1 },
    { type: "media", key: "start", label: "Start frame", required: false, mediaKind: "image", maxCount: 1 },
    { type: "media", key: "references", label: "References", required: false, mediaKind: "image", multiple: true, maxCount: 3 },
  ],
}

const provider: CinemaVideoProvider = {
  manifest: {
    id: "comfyui-local",
    name: "Local ComfyUI",
    regions: ["local"],
    requiresCredential: false,
    capabilities: { workflowDiscovery: true, appMode: true },
    models: [],
  },
  auth: {
    providerID: "comfyui-local",
    credentialProviderID: "comfyui-local",
    requiresCredential: false,
    connected: true,
    status: "connected",
  },
  runtime: {
    adapterAvailable: true,
    supportedModes: ["text-to-image", "text-to-video"],
  },
}

function catalog(status: CinemaProviderWorkflowCatalog["status"]): CinemaProviderWorkflowCatalog {
  return {
    providerID: "comfyui-local",
    status,
    userID: "default",
    users: [{ id: "default", name: "default" }],
    workflows: [{
      workflowID: "workflow-1",
      revision: "rev-1",
      name: "Animate",
      status: "ready",
      issues: [],
      dependencies: [],
      output: { kind: "video", nodeIDs: ["9"] },
      formSpec,
      source: {
        userID: "default",
        path: "workflows/animate.json",
        sizeBytes: 123,
        workflowFormat: "1.0",
        converter: "builtin",
      },
      discoveredAt: "2026-07-24T00:00:00.000Z",
    }],
    issues: [],
    refreshedAt: "2026-07-24T00:00:00.000Z",
    limits: {
      maxWorkflows: 500,
      maxFileBytes: 8 * 1024 * 1024,
      maxTotalBytes: 64 * 1024 * 1024,
      readConcurrency: 4,
    },
  }
}

describe("ComfyUI workflow catalog projection", () => {
  it("projects ready video workflows as runtime-only provider models", () => {
    const [result] = providersWithDiscoveredWorkflows([provider], [catalog("ready")])
    const model = result?.manifest.models[0]
    expect(model).toMatchObject({
      id: "workflow-1",
      family: "comfyui-workflow",
      modes: ["text-to-video"],
      formSpecs: [formSpec],
    })
    expect(model?.inputCombinations[0]?.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "prompt", apiField: "positive", modality: "text" }),
      expect.objectContaining({ role: "sourceImage", apiField: "start", modality: "image" }),
      expect.objectContaining({ role: "referenceImage", apiField: "references", modality: "image" }),
    ]))
    const contract = generationModeInputContractForCombination(
      model?.inputCombinations[0] ?? null,
      "text-to-video",
    )
    expect(contract.inputs.find((input) => input.parameterKey === "start")?.inputKey)
      .toBe("input:key-start:sourceImage")
    expect(contract.inputs.find((input) => input.parameterKey === "references")?.inputKey)
      .toBe("input:key-references:referenceImage")
  })

  it("does not expose stale catalogs as runnable models", () => {
    expect(providersWithDiscoveredWorkflows([provider], [catalog("stale")])[0]?.manifest.models).toEqual([])
  })

  it("keeps compatible stable-key values and resets changed controls", () => {
    expect(reconcileGenerationParameters({
      positive: "A fox",
      model: "removed.safetensors",
      seed: 2.5,
      removed: true,
    }, formSpec)).toEqual({
      positive: "A fox",
      model: "a.safetensors",
      seed: 1,
    })
  })
})
