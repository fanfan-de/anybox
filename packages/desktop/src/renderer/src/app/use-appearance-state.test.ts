import { appearanceTokenValueToCss } from "../../../shared/appearance-color"
import type { AppearanceTokenMap, AppearanceTokenValue } from "../../../shared/appearance"
import type { SemanticTokenAuthoringDraft } from "../../../shared/semantic-token-authoring"
import { applySemanticAuthoringDraftToOverrides } from "./use-appearance-state"

describe("appearance authoring runtime synchronization", () => {
  it("updates known active-theme mode tokens and excludes a newly generated token from saved overrides", () => {
    const draft: SemanticTokenAuthoringDraft = {
      version: 1,
      sourceThemeID: "built-in:classic",
      operations: [
        {
          kind: "theme-token-value-edit",
          runtimeToken: "semantic-plugin-market-tag-surface",
          mode: "light",
          action: "set",
          value: "#123456",
        },
        {
          kind: "token-creation",
          runtimeToken: "semantic-example-surface",
          groupID: "plugins",
          createGroup: false,
          layer: "component",
          label: "Example Surface",
          description: "Example surface color.",
          light: { value: "#abcdef" },
          dark: { value: "#112233" },
        },
      ],
    }

    const savedOverrides = applySemanticAuthoringDraftToOverrides({}, draft, false)
    expect(
      appearanceTokenValueToCss(savedOverrides["semantic-plugin-market-tag-surface-light"]!),
    ).toBe("#123456")
    expect(
      (savedOverrides as Record<string, unknown>)["semantic-example-surface-light"],
    ).toBeUndefined()

    const sourceThemeOverrides = applySemanticAuthoringDraftToOverrides(
      {} as AppearanceTokenMap,
      draft,
      true,
    )
    expect(appearanceTokenValueToCss(
      (sourceThemeOverrides as Record<string, AppearanceTokenValue>)["semantic-example-surface-light"],
    )).toBe("#abcdef")
  })
})
