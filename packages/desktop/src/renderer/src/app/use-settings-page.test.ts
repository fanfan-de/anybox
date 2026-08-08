import { describe, expect, it } from "vitest"
import { buildModelSelectionUpdatePayload, resolveBuiltinToolEnabled } from "./use-settings-page"
import type { BuiltinToolSummary, ProjectModelSelection } from "./types"

function createSelection(selection: Partial<ProjectModelSelection>): ProjectModelSelection {
  return {
    model: null,
    smallModel: null,
    reasoningEffort: null,
    imageModel: null,
    imageDefaultSize: null,
    imageDefaultCount: null,
    ...selection,
  }
}

describe("buildModelSelectionUpdatePayload", () => {
  it("only sends the primary model when unchanged secondary model selection is stale", () => {
    const savedSelection = createSelection({
      model: "anybox/deepseek-v4-pro",
      smallModel: "anybox/deepseek-v4-flash",
    })
    const nextSelection = createSelection({
      model: "openai/gpt-5.4",
      smallModel: "anybox/deepseek-v4-flash",
    })

    expect(buildModelSelectionUpdatePayload(savedSelection, nextSelection)).toEqual({
      model: "openai/gpt-5.4",
    })
  })

  it("sends null when the small model is explicitly cleared", () => {
    const savedSelection = createSelection({
      model: "openai/gpt-5.4",
      smallModel: "anybox/deepseek-v4-flash",
    })
    const nextSelection = createSelection({
      model: "openai/gpt-5.4",
      smallModel: null,
    })

    expect(buildModelSelectionUpdatePayload(savedSelection, nextSelection)).toEqual({
      small_model: null,
    })
  })
})

function createBuiltinTool(
  id: string,
  defaultEnabled: boolean,
  aliases: string[] = [],
): BuiltinToolSummary {
  return {
    id,
    title: id,
    description: `${id} description`,
    aliases,
    capabilities: {},
    moduleID: "runtime.test",
    defaultEnabled,
    enabled: defaultEnabled,
  }
}

describe("resolveBuiltinToolEnabled", () => {
  it("restores each tool's declared default when reset saves an empty selection", () => {
    const resetSelection = { tools: {} }

    expect(resolveBuiltinToolEnabled(createBuiltinTool("ipython", false), resetSelection)).toBe(false)
    expect(resolveBuiltinToolEnabled(createBuiltinTool("read_file", true), resetSelection)).toBe(true)
  })

  it("uses explicit false before explicit true, then falls back to defaultEnabled", () => {
    const tool = createBuiltinTool("ipython", false, ["python"])

    expect(resolveBuiltinToolEnabled(tool, { tools: { ipython: true } })).toBe(true)
    expect(resolveBuiltinToolEnabled(tool, { tools: { python: true } })).toBe(true)
    expect(resolveBuiltinToolEnabled(tool, { tools: { ipython: true, python: false } })).toBe(false)
    expect(resolveBuiltinToolEnabled(tool, { tools: {} })).toBe(false)
  })
})
