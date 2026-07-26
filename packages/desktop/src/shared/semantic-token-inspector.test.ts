import {
  analyzeSemanticTokenStyles,
  type SemanticTokenInspectorDeclaration,
  type SemanticTokenInspectorStyleContext,
  type SemanticTokenInspectorStyleRule,
} from "./semantic-token-inspector"

function rule(
  selector: string,
  declarations: SemanticTokenInspectorDeclaration[],
  options: Partial<SemanticTokenInspectorStyleRule> = {},
): SemanticTokenInspectorStyleRule {
  return {
    selector,
    declarations,
    origin: "regular",
    sourceOrder: 1,
    specificity: [0, 1, 0],
    sourceURL: "settings.css",
    line: 10,
    column: 2,
    ...options,
  }
}

function context(
  declarations: SemanticTokenInspectorDeclaration[],
  options: Partial<SemanticTokenInspectorStyleContext> = {},
): SemanticTokenInspectorStyleContext {
  return {
    target: {
      tagName: "SPAN",
      classes: ["plugin-market-tag"],
      borderQuad: [0, 0, 100, 0, 100, 24, 0, 24],
    },
    computedStyle: {
      "background-color": "rgb(211, 121, 121)",
      color: "rgb(64, 64, 64)",
    },
    directRules: [rule(".plugin-market-tag", declarations)],
    inheritedRules: [],
    resolvedColorMode: "light",
    ...options,
  }
}

describe("semantic token inspector analysis", () => {
  it("resolves a registered runtime token through its active mode token", () => {
    const result = analyzeSemanticTokenStyles(context(
      [{ name: "background-color", value: "var(--semantic-plugin-market-tag-surface)" }],
      {
        inheritedRules: [[rule(":root", [
          {
            name: "--semantic-plugin-market-tag-surface",
            value: "var(--semantic-plugin-market-tag-surface-light)",
          },
          {
            name: "--semantic-plugin-market-tag-surface-light",
            value: "#f2d6d6",
          },
        ], { specificity: [0, 1, 0], sourceOrder: 0 })]],
      },
    ))

    const background = result.properties.find((property) => property.property === "background-color")
    expect(background).toMatchObject({
      diagnosis: "semantic-runtime",
      severity: "pass",
      confidence: "exact",
    })
    expect(background?.tokens.map((token) => token.name)).toEqual([
      "--semantic-plugin-market-tag-surface",
      "--semantic-plugin-market-tag-surface-light",
    ])
    expect(background?.tokens[0]).toMatchObject({
      groupLabel: "Plugin Marketplace",
      mode: undefined,
    })
    expect(background?.tokens[1]).toMatchObject({ mode: "light" })
  })

  it("marks a local alias that reaches a runtime token as indirectly compliant", () => {
    const result = analyzeSemanticTokenStyles(context([
      { name: "--tag-surface", value: "var(--semantic-plugin-market-tag-surface)" },
      { name: "background-color", value: "var(--tag-surface)" },
    ]))

    const background = result.properties.find((property) => property.property === "background-color")
    expect(background).toMatchObject({
      diagnosis: "semantic-runtime-indirect",
      severity: "pass",
    })
    expect(background?.tokens.map((token) => token.name)).toEqual([
      "--tag-surface",
      "--semantic-plugin-market-tag-surface",
      "--semantic-plugin-market-tag-surface-light",
    ])
  })

  it("rejects direct mode-token consumption", () => {
    const result = analyzeSemanticTokenStyles(context([
      { name: "background-color", value: "var(--semantic-plugin-market-tag-surface-light)" },
    ]))

    expect(result.properties.find((property) => property.property === "background-color")).toMatchObject({
      diagnosis: "mode-token",
      severity: "error",
    })
  })

  it("flags color-mix anywhere in the active token chain", () => {
    const result = analyzeSemanticTokenStyles(context([
      {
        name: "--tag-surface",
        value: "color-mix(in srgb, var(--brand-primary) 20%, var(--surface-panel) 80%)",
      },
      { name: "background-color", value: "var(--tag-surface)" },
    ]))

    expect(result.properties.find((property) => property.property === "background-color")).toMatchObject({
      diagnosis: "mixed-color",
      severity: "error",
    })
  })

  it("flags direct literals and hardcoded var fallbacks", () => {
    const literal = analyzeSemanticTokenStyles(context([
      { name: "background-color", value: "#d37979" },
    ]))
    expect(literal.properties.find((property) => property.property === "background-color")).toMatchObject({
      diagnosis: "hardcoded-color",
      severity: "error",
    })

    const fallback = analyzeSemanticTokenStyles(context([
      {
        name: "background-color",
        value: "var(--semantic-plugin-market-tag-surface, #d37979)",
      },
    ]))
    expect(fallback.properties.find((property) => property.property === "background-color")).toMatchObject({
      diagnosis: "hardcoded-color",
      severity: "error",
    })

    const aliasFallback = analyzeSemanticTokenStyles(context([
      { name: "--tag-surface", value: "var(--missing-tag-surface, #d37979)" },
      { name: "background-color", value: "var(--tag-surface)" },
    ]))
    expect(aliasFallback.properties.find((property) => property.property === "background-color")).toMatchObject({
      diagnosis: "hardcoded-color",
      severity: "error",
    })
  })

  it("follows only the active var fallback branch", () => {
    const primary = analyzeSemanticTokenStyles(context([
      {
        name: "background-color",
        value: "var(--semantic-plugin-market-tag-surface, var(--brand-primary))",
      },
    ]))
    const primaryTokens = primary.properties
      .find((property) => property.property === "background-color")
      ?.tokens.map((token) => token.name)
    expect(primaryTokens).toContain("--semantic-plugin-market-tag-surface")
    expect(primaryTokens).not.toContain("--brand-primary")

    const fallback = analyzeSemanticTokenStyles(context([
      {
        name: "background-color",
        value: "var(--missing-tag-surface, var(--semantic-plugin-market-tag-surface))",
      },
    ]))
    const fallbackProperty = fallback.properties.find((property) => property.property === "background-color")
    expect(fallbackProperty?.tokens.map((token) => token.name)).toEqual([
      "--missing-tag-surface",
      "--semantic-plugin-market-tag-surface",
      "--semantic-plugin-market-tag-surface-light",
    ])
    expect(fallbackProperty).toMatchObject({
      diagnosis: "semantic-runtime-indirect",
      severity: "pass",
    })
  })

  it("marks direct foundation tokens as warnings", () => {
    const result = analyzeSemanticTokenStyles(context([
      { name: "background-color", value: "var(--surface-panel)" },
    ]))

    expect(result.properties.find((property) => property.property === "background-color")).toMatchObject({
      diagnosis: "foundation-token",
      severity: "warning",
    })
  })

  it("does not guess when competing rules have no specificity data", () => {
    const result = analyzeSemanticTokenStyles(context([], {
      directRules: [
        rule(".first", [{ name: "background-color", value: "var(--semantic-plugin-market-tag-surface)" }], {
          sourceOrder: 1,
          specificity: undefined,
        }),
        rule(".second", [{ name: "background-color", value: "#d37979" }], {
          sourceOrder: 2,
          specificity: undefined,
        }),
      ],
    }))

    expect(result.properties.find((property) => property.property === "background-color")).toMatchObject({
      diagnosis: "ambiguous",
      severity: "unknown",
      confidence: "ambiguous",
    })
  })

  it("collapses four identical border color sources", () => {
    const result = analyzeSemanticTokenStyles(context([
      {
        name: "border-color",
        value: "var(--semantic-plugin-market-icon-border)",
        longhands: [
          { name: "border-top-color", value: "var(--semantic-plugin-market-icon-border)" },
          { name: "border-right-color", value: "var(--semantic-plugin-market-icon-border)" },
          { name: "border-bottom-color", value: "var(--semantic-plugin-market-icon-border)" },
          { name: "border-left-color", value: "var(--semantic-plugin-market-icon-border)" },
        ],
      },
    ], {
      computedStyle: {
        "background-color": "transparent",
        "border-top-color": "rgb(1, 2, 3)",
        "border-right-color": "rgb(1, 2, 3)",
        "border-bottom-color": "rgb(1, 2, 3)",
        "border-left-color": "rgb(1, 2, 3)",
        color: "rgb(64, 64, 64)",
      },
    }))

    expect(result.properties.filter((property) => property.property.includes("border"))).toHaveLength(1)
    expect(result.properties.some((property) => property.property === "border-color")).toBe(true)
  })

  it("collapses generated per-side border entries and falls back to a local rule insertion", () => {
    const result = analyzeSemanticTokenStyles(context([], {
      directRules: [
        rule(".plugin-market-tag", [
          { name: "border-top-color", value: "", editRef: "generated-top" },
          { name: "border-right-color", value: "", editRef: "generated-right" },
          { name: "border-bottom-color", value: "", editRef: "generated-bottom" },
          { name: "border-left-color", value: "", editRef: "generated-left" },
        ], {
          ruleRef: "local-rule",
        }),
      ],
      computedStyle: {
        "background-color": "transparent",
        color: "rgb(64, 64, 64)",
        "border-top-color": "rgb(1, 2, 3)",
        "border-right-color": "rgb(1, 2, 3)",
        "border-bottom-color": "rgb(1, 2, 3)",
        "border-left-color": "rgb(1, 2, 3)",
        "border-top-width": "1px",
        "border-right-width": "1px",
        "border-bottom-width": "1px",
        "border-left-width": "1px",
        "border-top-style": "solid",
        "border-right-style": "solid",
        "border-bottom-style": "solid",
        "border-left-style": "solid",
      },
    }))

    expect(result.channels.filter((channel) => channel.kind.startsWith("border"))).toHaveLength(1)
    expect(result.channels.find((channel) => channel.cssProperty === "border-color")).toMatchObject({
      authoredProperty: undefined,
      editRef: undefined,
      writable: true,
      insertionRules: [
        expect.objectContaining({
          ruleRef: "local-rule",
          recommended: true,
        }),
      ],
    })
  })

  it("detects custom-property cycles without recursing forever", () => {
    const result = analyzeSemanticTokenStyles(context([
      { name: "--cycle-a", value: "var(--cycle-b)" },
      { name: "--cycle-b", value: "var(--cycle-a)" },
      { name: "background-color", value: "var(--cycle-a)" },
    ]))

    const background = result.properties.find((property) => property.property === "background-color")
    expect(background?.tokens.some((token) => token.cycle)).toBe(true)
    expect(background).toMatchObject({ diagnosis: "local-token" })
  })

  it("links currentColor properties to the active color token", () => {
    const result = analyzeSemanticTokenStyles(context([
      { name: "color", value: "var(--semantic-plugin-market-tag-surface)" },
      { name: "fill", value: "currentColor" },
    ], {
      computedStyle: {
        "background-color": "transparent",
        color: "rgb(64, 64, 64)",
        fill: "rgb(64, 64, 64)",
      },
    }))

    expect(result.properties.find((property) => property.property === "fill")).toMatchObject({
      diagnosis: "semantic-runtime",
      severity: "pass",
      scope: "currentColor",
      summary: expect.stringContaining("currentColor"),
    })
    expect(result.channels.find((channel) => channel.cssProperty === "fill")).toMatchObject({
      label: "图标填充",
      followsChannelID: "color",
      scopeDescription: "跟随文字与前景颜色",
    })
  })

  it("keeps inactive border channels editable without implying that a border will appear", () => {
    const result = analyzeSemanticTokenStyles(context([
      {
        name: "border-color",
        value: "var(--semantic-plugin-market-icon-border)",
        editRef: "opaque-border-edit",
        longhands: [
          { name: "border-top-color", value: "var(--semantic-plugin-market-icon-border)" },
          { name: "border-right-color", value: "var(--semantic-plugin-market-icon-border)" },
          { name: "border-bottom-color", value: "var(--semantic-plugin-market-icon-border)" },
          { name: "border-left-color", value: "var(--semantic-plugin-market-icon-border)" },
        ],
      },
    ], {
      computedStyle: {
        "background-color": "transparent",
        color: "rgb(64, 64, 64)",
        "border-top-color": "rgb(1, 2, 3)",
        "border-right-color": "rgb(1, 2, 3)",
        "border-bottom-color": "rgb(1, 2, 3)",
        "border-left-color": "rgb(1, 2, 3)",
        "border-top-width": "0px",
        "border-right-width": "0px",
        "border-bottom-width": "0px",
        "border-left-width": "0px",
        "border-top-style": "none",
        "border-right-style": "none",
        "border-bottom-style": "none",
        "border-left-style": "none",
      },
    }))

    expect(result.channels.find((channel) => channel.cssProperty === "border-color")).toMatchObject({
      label: "边框",
      visibility: "inactive",
      writable: true,
      editRef: "opaque-border-edit",
      visibilityReason: expect.stringContaining("宽度为 0"),
    })
  })

  it("infers the actually matched state and makes complex shadows read-only", () => {
    const result = analyzeSemanticTokenStyles(context([], {
      directRules: [
        rule(".plugins-included-row.is-expanded", [
          {
            name: "box-shadow",
            value: "0 1px 2px #111111, 0 3px 8px #222222",
            editRef: "opaque-shadow-edit",
          },
        ], {
          ruleRef: "opaque-rule",
        }),
      ],
      computedStyle: {
        "background-color": "transparent",
        color: "rgb(64, 64, 64)",
        "box-shadow": "rgba(17, 17, 17, 1) 0px 1px 2px, rgba(34, 34, 34, 1) 0px 3px 8px",
      },
    }))

    expect(result.channels.find((channel) => channel.cssProperty === "box-shadow")).toMatchObject({
      state: "expanded",
      stateLabel: "Expanded",
      visibility: "visible",
      previewable: false,
      writable: false,
      readOnlyReason: expect.stringContaining("多重阴影"),
    })
  })

  it("returns every supported color channel and sorts visible channels before inactive ones", () => {
    const result = analyzeSemanticTokenStyles(context([]))
    expect(result.channels.map((channel) => channel.cssProperty)).toEqual(expect.arrayContaining([
      "background-color",
      "color",
      "border-color",
      "outline-color",
      "text-decoration-color",
      "fill",
      "stroke",
      "box-shadow",
      "text-shadow",
      "caret-color",
      "accent-color",
      "background-image",
    ]))
    const firstInactive = result.channels.findIndex((channel) => channel.visibility === "inactive")
    const lastVisible = result.channels.reduce(
      (lastIndex, channel, index) => channel.visibility === "visible" ? index : lastIndex,
      -1,
    )
    expect(firstInactive).toBeGreaterThan(lastVisible)
  })

  it("reports image elements as resources instead of inventing a color token", () => {
    const result = analyzeSemanticTokenStyles(context([], {
      target: {
        tagName: "IMG",
        classes: ["plugin-logo"],
        assetKind: "image",
      },
    }))

    expect(result.properties[0]).toMatchObject({
      property: "image-source",
      diagnosis: "image-resource",
      severity: "info",
    })
  })
})
