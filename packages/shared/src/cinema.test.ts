import { describe, expect, it } from "vitest"
import {
  CinemaGenerationTaskSchema,
  CinemaVideoProviderManifestSchema,
  CreateCinemaGenerationTaskBodySchema,
} from "./cinema"

describe("cinema schemas", () => {
  it("parses provider manifests and generation tasks", () => {
    const manifest = CinemaVideoProviderManifestSchema.parse({
      id: "mock",
      name: "Mock Video",
      models: [
        {
          id: "mock-video",
          label: "Mock Video",
          modes: ["text-to-video"],
        },
      ],
    })

    expect(manifest.requiresCredential).toBe(false)
    expect(manifest.models[0]?.durations).toEqual([])

    const task = CinemaGenerationTaskSchema.parse({
      id: "task-1",
      projectID: "project-1",
      providerID: "mock",
      modelID: "mock-video",
      mode: "text-to-video",
      title: "Test",
      status: "running",
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
      input: {
        prompt: "A test prompt",
      },
    })

    expect(task.input.sourceNodeIDs).toEqual([])
    expect(task.outputAssets).toEqual([])
  })

  it("rejects unsupported generation task modes", () => {
    expect(() =>
      CreateCinemaGenerationTaskBodySchema.parse({
        providerID: "mock",
        modelID: "mock-video",
        mode: "not-a-mode",
      })
    ).toThrow()
  })
})
