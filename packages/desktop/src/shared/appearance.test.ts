import { describe, expect, it } from "vitest"
import {
  APPEARANCE_FONT_FAMILIES,
  APPEARANCE_TOKEN_GROUPS,
  APPEARANCE_TOKEN_NAMES,
  createDefaultAppearanceConfigDocument,
  normalizeAppearanceConfigDocument,
} from "./appearance"

describe("appearance font family", () => {
  it("normalizes font family preferences", () => {
    expect(APPEARANCE_FONT_FAMILIES).toEqual([
      "default",
      "system",
      "segoe",
      "microsoft-yahei",
      "pingfang",
    ])
    expect(createDefaultAppearanceConfigDocument().fontFamily).toBe("default")
    expect(normalizeAppearanceConfigDocument({ fontFamily: "microsoft-yahei" }).fontFamily).toBe(
      "microsoft-yahei",
    )
    expect(normalizeAppearanceConfigDocument({ fontFamily: "invalid-font" }).fontFamily).toBe("default")
  })
})

describe("appearance token catalog", () => {
  it("keeps token names in sync with token groups", () => {
    const groupedTokenNames = APPEARANCE_TOKEN_GROUPS.flatMap((group) =>
      group.rows.flatMap((row) => [row.lightToken, row.darkToken]),
    )

    expect(groupedTokenNames).toHaveLength(APPEARANCE_TOKEN_NAMES.length)
    expect(new Set(groupedTokenNames)).toEqual(new Set(APPEARANCE_TOKEN_NAMES))
  })

  it("registers and normalizes button semantic tokens", () => {
    const buttonGroup = APPEARANCE_TOKEN_GROUPS.find((group) => group.id === "component-buttons")

    expect(buttonGroup?.rows.map((row) => row.id)).toEqual([
      "semantic-button-primary-surface",
      "semantic-button-primary-surface-hover",
      "semantic-button-primary-border",
      "semantic-button-primary-border-hover",
      "semantic-button-primary-text",
      "semantic-button-primary-text-hover",
      "semantic-button-primary-disabled-surface",
      "semantic-button-primary-disabled-border",
      "semantic-button-primary-disabled-text",
      "semantic-button-secondary-surface",
      "semantic-button-secondary-surface-hover",
      "semantic-button-secondary-border",
      "semantic-button-secondary-border-hover",
      "semantic-button-secondary-text",
      "semantic-button-secondary-text-hover",
      "semantic-button-secondary-disabled-surface",
      "semantic-button-secondary-disabled-border",
      "semantic-button-secondary-disabled-text",
      "semantic-button-danger-surface",
      "semantic-button-danger-surface-hover",
      "semantic-button-danger-border",
      "semantic-button-danger-border-hover",
      "semantic-button-danger-text",
      "semantic-button-danger-text-hover",
      "semantic-button-danger-disabled-surface",
      "semantic-button-danger-disabled-border",
      "semantic-button-danger-disabled-text",
    ])

    const document = normalizeAppearanceConfigDocument({
      overrides: {
        "semantic-button-primary-surface": "#111111",
        "semantic-button-primary-surface-dark": "#123456",
        "semantic-button-secondary-text": "#abcdef",
        "semantic-button-danger-disabled-border-light": " #654321 ",
        "not-a-token": "#000000",
      },
      resolvedTokens: {
        "semantic-button-danger-text-hover-dark": " #222222 ",
      },
    })

    expect(document.overrides).toEqual({
      "semantic-button-primary-surface-light": "#111111",
      "semantic-button-primary-surface-dark": "#123456",
      "semantic-button-secondary-text-light": "#abcdef",
      "semantic-button-secondary-text-dark": "#abcdef",
      "semantic-button-danger-disabled-border-light": "#654321",
    })
    expect(document.resolvedTokens).toEqual({
      "semantic-button-danger-text-hover-dark": "#222222",
    })
  })
})

describe("appearance proposed plan card tokens", () => {
  it("registers the proposed plan card token group", () => {
    expect(APPEARANCE_TOKEN_GROUPS).toContainEqual({
      id: "component-proposed-plan-card",
      label: "Proposed Plan",
      description: "Dedicated semantic color for proposed plan cards.",
      rows: [
        {
          id: "semantic-proposed-plan-card-surface",
          label: "Card Surface",
          description: "Background fill for proposed plan cards shown in assistant responses.",
          lightToken: "semantic-proposed-plan-card-surface-light",
          darkToken: "semantic-proposed-plan-card-surface-dark",
        },
      ],
    })
  })

  it("normalizes proposed plan card overrides", () => {
    const document = normalizeAppearanceConfigDocument({
      overrides: {
        "semantic-proposed-plan-card-surface-light": " #123456 ",
        "semantic-proposed-plan-card-surface-dark": "#abcdef",
        "semantic-proposed-plan-card-surface": "#000000",
      },
      resolvedTokens: {
        "semantic-proposed-plan-card-surface-light": " #654321 ",
      },
    })

    expect(document.overrides).toEqual({
      "semantic-proposed-plan-card-surface-light": "#123456",
      "semantic-proposed-plan-card-surface-dark": "#abcdef",
    })
    expect(document.resolvedTokens).toEqual({
      "semantic-proposed-plan-card-surface-light": "#654321",
    })
  })
})

describe("appearance sidebar tree row tokens", () => {
  it("registers the sidebar tree row token group", () => {
    expect(APPEARANCE_TOKEN_GROUPS).toContainEqual({
      id: "component-sidebar-tree-rows",
      label: "Sidebar Tree Rows",
      description: "Dedicated row tokens for the left sidebar workspace and skills trees.",
      rows: [
        {
          id: "semantic-sidebar-tree-row-text",
          label: "Row Text",
          description: "Default text and icon color for sidebar tree rows.",
          lightToken: "semantic-sidebar-tree-row-text-light",
          darkToken: "semantic-sidebar-tree-row-text-dark",
        },
        {
          id: "semantic-sidebar-tree-row-text-hover",
          label: "Row Text Hover",
          description: "Hover and focus text color for sidebar tree rows.",
          lightToken: "semantic-sidebar-tree-row-text-hover-light",
          darkToken: "semantic-sidebar-tree-row-text-hover-dark",
        },
        {
          id: "semantic-sidebar-tree-row-text-active",
          label: "Row Text Active",
          description: "Selected-row text color for sidebar tree rows.",
          lightToken: "semantic-sidebar-tree-row-text-active-light",
          darkToken: "semantic-sidebar-tree-row-text-active-dark",
        },
        {
          id: "semantic-sidebar-tree-row-surface-hover",
          label: "Row Surface Hover",
          description: "Hover and focus background for sidebar tree rows.",
          lightToken: "semantic-sidebar-tree-row-surface-hover-light",
          darkToken: "semantic-sidebar-tree-row-surface-hover-dark",
        },
        {
          id: "semantic-sidebar-tree-row-surface-active",
          label: "Row Surface Active",
          description: "Selected-row background for sidebar tree rows.",
          lightToken: "semantic-sidebar-tree-row-surface-active-light",
          darkToken: "semantic-sidebar-tree-row-surface-active-dark",
        },
        {
          id: "semantic-sidebar-tree-row-leading-active",
          label: "Leading Icon Active",
          description: "Selected-row leading icon color for sidebar project rows.",
          lightToken: "semantic-sidebar-tree-row-leading-active-light",
          darkToken: "semantic-sidebar-tree-row-leading-active-dark",
        },
      ],
    })
  })

  it("normalizes sidebar tree row overrides", () => {
    const document = normalizeAppearanceConfigDocument({
      brandTheme: "terra",
      colorMode: "dark",
      updatedAt: 42,
      overrides: {
        "semantic-sidebar-tree-row-text-light": " #123456 ",
        "semantic-sidebar-tree-row-surface-active-dark": "#abcdef",
        "semantic-sidebar-tree-row-leading-active-light": "",
        "not-a-token": "#000000",
      },
      resolvedTokens: {
        "semantic-sidebar-tree-row-text-hover-dark": " #654321 ",
      },
    })

    expect(document.overrides).toEqual({
      "semantic-sidebar-tree-row-text-light": "#123456",
      "semantic-sidebar-tree-row-surface-active-dark": "#abcdef",
    })
    expect(document.resolvedTokens).toEqual({
      "semantic-sidebar-tree-row-text-hover-dark": "#654321",
    })
    expect(document.colorMode).toBe("dark")
    expect(document.updatedAt).toBe(42)
  })
})

describe("appearance thread view text tokens", () => {
  it("registers response and reasoning text tokens", () => {
    expect(APPEARANCE_TOKEN_GROUPS).toContainEqual({
      id: "component-thread-view",
      label: "Thread View",
      description: "Dedicated semantic text colors for assistant response and reasoning content.",
      rows: [
        {
          id: "semantic-thread-response-text",
          label: "Response Text",
          description: "Text color for assistant response content in the thread view.",
          lightToken: "semantic-thread-response-text-light",
          darkToken: "semantic-thread-response-text-dark",
        },
        {
          id: "semantic-thread-reasoning-text",
          label: "Reasoning Text",
          description: "Text color for assistant reasoning content in the thread view.",
          lightToken: "semantic-thread-reasoning-text-light",
          darkToken: "semantic-thread-reasoning-text-dark",
        },
      ],
    })
  })

  it("normalizes thread view text overrides", () => {
    const document = normalizeAppearanceConfigDocument({
      overrides: {
        "semantic-thread-response-text-light": " #123456 ",
        "semantic-thread-reasoning-text-dark": "#abcdef",
        "semantic-thread-response-text": "#000000",
      },
      resolvedTokens: {
        "semantic-thread-reasoning-text-light": " #654321 ",
      },
    })

    expect(document.overrides).toEqual({
      "semantic-thread-response-text-light": "#123456",
      "semantic-thread-response-text-dark": "#000000",
      "semantic-thread-reasoning-text-dark": "#abcdef",
    })
    expect(document.resolvedTokens).toEqual({
      "semantic-thread-reasoning-text-light": "#654321",
    })
  })
})

describe("appearance markdown tokens", () => {
  it("registers the markdown token group", () => {
    expect(APPEARANCE_TOKEN_GROUPS).toContainEqual({
      id: "component-markdown",
      label: "Markdown",
      description: "Dedicated semantic colors for rendered Markdown content.",
      rows: [
        {
          id: "semantic-markdown-text",
          label: "Text",
          description: "Default body text inside rendered Markdown.",
          lightToken: "semantic-markdown-text-light",
          darkToken: "semantic-markdown-text-dark",
        },
        {
          id: "semantic-markdown-muted-text",
          label: "Muted Text",
          description: "Supporting Markdown text such as quote and image fallback text.",
          lightToken: "semantic-markdown-muted-text-light",
          darkToken: "semantic-markdown-muted-text-dark",
        },
        {
          id: "semantic-markdown-strong-text",
          label: "Strong Text",
          description: "High-emphasis Markdown text and headings.",
          lightToken: "semantic-markdown-strong-text-light",
          darkToken: "semantic-markdown-strong-text-dark",
        },
        {
          id: "semantic-markdown-accent",
          label: "Accent",
          description: "Markdown heading rails, list markers, and lightweight emphasis.",
          lightToken: "semantic-markdown-accent-light",
          darkToken: "semantic-markdown-accent-dark",
        },
        {
          id: "semantic-markdown-border",
          label: "Border",
          description: "Default Markdown table, image, and divider border.",
          lightToken: "semantic-markdown-border-light",
          darkToken: "semantic-markdown-border-dark",
        },
        {
          id: "semantic-markdown-border-strong",
          label: "Border Strong",
          description: "Stronger Markdown borders for inline code and table headers.",
          lightToken: "semantic-markdown-border-strong-light",
          darkToken: "semantic-markdown-border-strong-dark",
        },
        {
          id: "semantic-markdown-quote-surface",
          label: "Quote Surface",
          description: "Background fill for Markdown blockquotes.",
          lightToken: "semantic-markdown-quote-surface-light",
          darkToken: "semantic-markdown-quote-surface-dark",
        },
        {
          id: "semantic-markdown-inline-code-surface",
          label: "Inline Code Surface",
          description: "Background fill for inline code tokens inside Markdown.",
          lightToken: "semantic-markdown-inline-code-surface-light",
          darkToken: "semantic-markdown-inline-code-surface-dark",
        },
        {
          id: "semantic-markdown-table-head-surface",
          label: "Table Header Surface",
          description: "Background fill for Markdown table headers.",
          lightToken: "semantic-markdown-table-head-surface-light",
          darkToken: "semantic-markdown-table-head-surface-dark",
        },
        {
          id: "semantic-markdown-table-row-alt-surface",
          label: "Table Row Alt Surface",
          description: "Alternating row background for Markdown tables.",
          lightToken: "semantic-markdown-table-row-alt-surface-light",
          darkToken: "semantic-markdown-table-row-alt-surface-dark",
        },
        {
          id: "semantic-markdown-code-surface",
          label: "Code Block Surface",
          description: "Background fill for fenced Markdown code blocks.",
          lightToken: "semantic-markdown-code-surface-light",
          darkToken: "semantic-markdown-code-surface-dark",
        },
        {
          id: "semantic-markdown-code-text",
          label: "Code Block Text",
          description: "Text color for fenced Markdown code blocks.",
          lightToken: "semantic-markdown-code-text-light",
          darkToken: "semantic-markdown-code-text-dark",
        },
        {
          id: "semantic-markdown-code-muted-text",
          label: "Code Block Muted Text",
          description: "Muted metadata text inside fenced Markdown code blocks.",
          lightToken: "semantic-markdown-code-muted-text-light",
          darkToken: "semantic-markdown-code-muted-text-dark",
        },
        {
          id: "semantic-markdown-code-border",
          label: "Code Block Border",
          description: "Border color for fenced Markdown code blocks.",
          lightToken: "semantic-markdown-code-border-light",
          darkToken: "semantic-markdown-code-border-dark",
        },
      ],
    })
  })

  it("normalizes markdown token overrides", () => {
    const document = normalizeAppearanceConfigDocument({
      overrides: {
        "semantic-markdown-inline-code-surface-light": " #123456 ",
        "semantic-markdown-code-surface-dark": "#abcdef",
        "semantic-markdown-code-text": "#000000",
      },
      resolvedTokens: {
        "semantic-markdown-table-head-surface-light": " #654321 ",
      },
    })

    expect(document.overrides).toEqual({
      "semantic-markdown-inline-code-surface-light": "#123456",
      "semantic-markdown-code-surface-dark": "#abcdef",
      "semantic-markdown-code-text-light": "#000000",
      "semantic-markdown-code-text-dark": "#000000",
    })
    expect(document.resolvedTokens).toEqual({
      "semantic-markdown-table-head-surface-light": "#654321",
    })
  })
})
