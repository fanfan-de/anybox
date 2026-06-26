import { describe, expect, it } from "vitest"
import {
  APPEARANCE_FONT_FAMILIES,
  APPEARANCE_TOKEN_GROUPS,
  APPEARANCE_TOKEN_LAYERS,
  APPEARANCE_TOKEN_NAMES,
  DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE,
  DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG,
  createDefaultAppearanceConfigDocument,
  createDefaultAppearanceRuntimeState,
  normalizeAppearanceConfigDocument,
  normalizeAppearanceRuntimeState,
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

describe("appearance runtime state", () => {
  it("normalizes cross-window appearance runtime payloads", () => {
    const state = normalizeAppearanceRuntimeState({
      document: {
        brandTheme: "sage",
        colorMode: "dark",
        fontFamily: "microsoft-yahei",
        overrides: {
          "surface-app-light": " #123456 ",
          "surface-app-dark": "#000000",
        },
        resolvedTokens: {
          "surface-app-dark": " #654321 ",
        },
        updatedAt: 42,
      },
      codeThemePreference: "dracula",
      htmlBackgroundConfig: {
        blurPx: 99,
        dim: -1,
        enabled: true,
        html: "<div>background</div>",
        opacity: 2,
        paused: true,
        renderMode: "dynamic",
        surfaceOpacity: 0,
      },
    })

    expect(state.document).toMatchObject({
      brandTheme: "sage",
      colorMode: "dark",
      fontFamily: "microsoft-yahei",
      updatedAt: 42,
    })
    expect(state.document.overrides).toEqual({
      "surface-app-light": "#123456",
      "surface-app-dark": "#000000",
    })
    expect(state.document.resolvedTokens).toEqual({
      "surface-app-dark": "#654321",
    })
    expect(state.codeThemePreference).toBe("dracula")
    expect(state.htmlBackgroundConfig).toEqual({
      blurPx: 24,
      dim: 0,
      enabled: true,
      html: "<div>background</div>",
      opacity: 1,
      paused: true,
      renderMode: "dynamic",
      surfaceOpacity: 0.36,
    })
  })

  it("falls back for invalid cross-window appearance runtime payloads", () => {
    const fallback = createDefaultAppearanceRuntimeState(
      normalizeAppearanceConfigDocument({
        colorMode: "dark",
        overrides: {
          "surface-app-dark": "#101010",
        },
      }),
    )

    expect(normalizeAppearanceRuntimeState(null, fallback)).toBe(fallback)
    expect(normalizeAppearanceRuntimeState({ codeThemePreference: 1 })).toEqual({
      document: createDefaultAppearanceConfigDocument(),
      codeThemePreference: DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE,
      htmlBackgroundConfig: DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG,
    })
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

  it("assigns every token group to a controlled abstraction layer", () => {
    const layerSet = new Set(APPEARANCE_TOKEN_LAYERS)

    expect(APPEARANCE_TOKEN_GROUPS.every((group) => layerSet.has(group.layer))).toBe(true)
    expect(APPEARANCE_TOKEN_GROUPS.map((group) => group.layer)).toEqual(expect.arrayContaining([
      "foundation",
      "component",
      "product",
      "status",
      "global",
    ]))
  })

  it("registers composer icon button tokens in the composer group", () => {
    const composerGroup = APPEARANCE_TOKEN_GROUPS.find((group) => group.id === "component-composer")

    expect(composerGroup?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "semantic-composer-icon-button-surface",
        lightToken: "semantic-composer-icon-button-surface-light",
        darkToken: "semantic-composer-icon-button-surface-dark",
      }),
      expect.objectContaining({
        id: "semantic-composer-icon-button-surface-hover",
        lightToken: "semantic-composer-icon-button-surface-hover-light",
        darkToken: "semantic-composer-icon-button-surface-hover-dark",
      }),
      expect.objectContaining({
        id: "semantic-composer-icon-button-text",
        lightToken: "semantic-composer-icon-button-text-light",
        darkToken: "semantic-composer-icon-button-text-dark",
      }),
      expect.objectContaining({
        id: "semantic-composer-icon-button-text-hover",
        lightToken: "semantic-composer-icon-button-text-hover-light",
        darkToken: "semantic-composer-icon-button-text-hover-dark",
      }),
    ]))
    expect(composerGroup?.rows.map((row) => row.id)).not.toEqual(expect.arrayContaining([
      "semantic-composer-icon-button-surface-active",
      "semantic-composer-icon-button-disabled-surface",
      "semantic-composer-icon-button-border",
      "semantic-composer-icon-button-border-hover",
      "semantic-composer-icon-button-border-active",
      "semantic-composer-icon-button-disabled-border",
      "semantic-composer-icon-button-text-active",
      "semantic-composer-icon-button-disabled-text",
    ]))

    const document = normalizeAppearanceConfigDocument({
      overrides: {
        "semantic-composer-icon-button-text": "#111111",
        "semantic-composer-icon-button-surface-hover-dark": "#222222",
      },
    })

    expect(document.overrides).toMatchObject({
      "semantic-composer-icon-button-text-light": "#111111",
      "semantic-composer-icon-button-text-dark": "#111111",
      "semantic-composer-icon-button-surface-hover-dark": "#222222",
    })
  })

  it("registers a single shell chrome surface token and migrates old split tokens", () => {
    expect(APPEARANCE_TOKEN_GROUPS.find((group) => group.id === "component-shell-chrome")).toEqual({
      id: "component-shell-chrome",
      layer: "product",
      label: "Shell Chrome",
      description: "Dedicated semantic surfaces for shell-level navigation and menu bars.",
      rows: [
        {
          id: "semantic-shell-chrome-surface",
          label: "Surface",
          description: "Background fill for shell-level pane tabs and sidebar top menus.",
          lightToken: "semantic-shell-chrome-surface-light",
          darkToken: "semantic-shell-chrome-surface-dark",
        },
      ],
    })

    const document = normalizeAppearanceConfigDocument({
      overrides: {
        "semantic-pane-tab-bar-surface-light": " #111111 ",
        "semantic-left-sidebar-top-menu-surface-dark": "#222222",
        "semantic-right-sidebar-top-menu-surface": "#333333",
        "semantic-shell-chrome-surface-light": "#444444",
      },
    })

    expect(document.overrides).toEqual({
      "semantic-shell-chrome-surface-light": "#444444",
      "semantic-shell-chrome-surface-dark": "#222222",
    })
  })

  it("registers and normalizes the popup panel surface token", () => {
    expect(APPEARANCE_TOKEN_GROUPS.find((group) => group.id === "component-popup-panel")).toEqual({
      id: "component-popup-panel",
      layer: "product",
      label: "Popup Panel",
      description: "Dedicated semantic surface for panel-style popups, floating sheets, and modal panels.",
      rows: [
        {
          id: "semantic-popup-panel-surface",
          label: "Panel Surface",
          description: "Background fill for popup panels such as settings, floating sheets, and panel-style popovers.",
          lightToken: "semantic-popup-panel-surface-light",
          darkToken: "semantic-popup-panel-surface-dark",
        },
      ],
    })

    expect(APPEARANCE_TOKEN_GROUPS.find((group) => group.id === "component-settings-switches")).toEqual({
      id: "component-settings-switches",
      layer: "component",
      label: "Settings Switches",
      description: "Switch row, track, and thumb colors used by settings toggle controls.",
      rows: [
        {
          id: "semantic-settings-switch-row-surface-focus",
          label: "Switch Focus Row",
          description: "Row background used when a settings switch receives keyboard focus.",
          lightToken: "semantic-settings-switch-row-surface-focus-light",
          darkToken: "semantic-settings-switch-row-surface-focus-dark",
        },
        {
          id: "semantic-settings-switch-track-surface",
          label: "Switch Track",
          description: "Default track fill for settings switch controls.",
          lightToken: "semantic-settings-switch-track-surface-light",
          darkToken: "semantic-settings-switch-track-surface-dark",
        },
        {
          id: "semantic-settings-switch-track-border",
          label: "Switch Track Border",
          description: "Default track border for settings switch controls.",
          lightToken: "semantic-settings-switch-track-border-light",
          darkToken: "semantic-settings-switch-track-border-dark",
        },
        {
          id: "semantic-settings-switch-track-border-focus",
          label: "Switch Track Focus Border",
          description: "Track border used when a settings switch receives keyboard focus.",
          lightToken: "semantic-settings-switch-track-border-focus-light",
          darkToken: "semantic-settings-switch-track-border-focus-dark",
        },
        {
          id: "semantic-settings-switch-track-surface-active",
          label: "Switch Active Track",
          description: "Track fill for enabled settings switch controls.",
          lightToken: "semantic-settings-switch-track-surface-active-light",
          darkToken: "semantic-settings-switch-track-surface-active-dark",
        },
        {
          id: "semantic-settings-switch-track-border-active",
          label: "Switch Active Track Border",
          description: "Track border for enabled settings switch controls.",
          lightToken: "semantic-settings-switch-track-border-active-light",
          darkToken: "semantic-settings-switch-track-border-active-dark",
        },
        {
          id: "semantic-settings-switch-track-surface-disabled",
          label: "Switch Disabled Track",
          description: "Track fill for disabled settings switch controls.",
          lightToken: "semantic-settings-switch-track-surface-disabled-light",
          darkToken: "semantic-settings-switch-track-surface-disabled-dark",
        },
        {
          id: "semantic-settings-switch-track-border-disabled",
          label: "Switch Disabled Track Border",
          description: "Track border for disabled settings switch controls.",
          lightToken: "semantic-settings-switch-track-border-disabled-light",
          darkToken: "semantic-settings-switch-track-border-disabled-dark",
        },
        {
          id: "semantic-settings-switch-thumb-surface",
          label: "Switch Thumb",
          description: "Thumb fill for settings switch controls.",
          lightToken: "semantic-settings-switch-thumb-surface-light",
          darkToken: "semantic-settings-switch-thumb-surface-dark",
        },
        {
          id: "semantic-settings-switch-thumb-surface-disabled",
          label: "Switch Disabled Thumb",
          description: "Thumb fill for disabled settings switch controls.",
          lightToken: "semantic-settings-switch-thumb-surface-disabled-light",
          darkToken: "semantic-settings-switch-thumb-surface-disabled-dark",
        },
      ],
    })

    const document = normalizeAppearanceConfigDocument({
      overrides: {
        "semantic-popup-panel-surface-light": " #111111 ",
        "semantic-settings-page-surface-dark": "#222222",
        "semantic-settings-switch-track-surface": " #444444 ",
        "semantic-settings-switch-thumb-surface-disabled-dark": "#555555",
      },
      resolvedTokens: {
        "semantic-settings-page-surface-light": " #333333 ",
        "semantic-settings-switch-track-surface-light": " #666666 ",
      },
    })

    expect(document.overrides).toEqual({
      "semantic-popup-panel-surface-light": "#111111",
      "semantic-popup-panel-surface-dark": "#222222",
      "semantic-settings-switch-track-surface-light": "#444444",
      "semantic-settings-switch-track-surface-dark": "#444444",
      "semantic-settings-switch-thumb-surface-disabled-dark": "#555555",
    })
    expect(document.resolvedTokens).toEqual({
      "semantic-popup-panel-surface-light": "#333333",
      "semantic-settings-switch-track-surface-light": "#666666",
    })

    expect(normalizeAppearanceConfigDocument({
      overrides: {
        "semantic-settings-page-surface": "#777777",
      },
    }).overrides).toEqual({
      "semantic-popup-panel-surface-light": "#777777",
      "semantic-popup-panel-surface-dark": "#777777",
    })
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
      "semantic-icon-button-text",
      "semantic-icon-button-text-hover",
      "semantic-icon-button-text-active",
      "semantic-icon-button-surface-hover",
      "semantic-icon-button-surface-active",
    ])

    const document = normalizeAppearanceConfigDocument({
      overrides: {
        "semantic-button-primary-surface": "#111111",
        "semantic-button-primary-surface-dark": "#123456",
        "semantic-button-secondary-text": "#abcdef",
        "semantic-button-danger-disabled-border-light": " #654321 ",
        "semantic-icon-button-text": "#334455",
        "semantic-icon-button-surface-hover-dark": " #223344 ",
        "not-a-token": "#000000",
      },
      resolvedTokens: {
        "semantic-button-danger-text-hover-dark": " #222222 ",
        "semantic-icon-button-text-hover-light": " #445566 ",
      },
    })

    expect(document.overrides).toEqual({
      "semantic-button-primary-surface-light": "#111111",
      "semantic-button-primary-surface-dark": "#123456",
      "semantic-button-secondary-text-light": "#abcdef",
      "semantic-button-secondary-text-dark": "#abcdef",
      "semantic-button-danger-disabled-border-light": "#654321",
      "semantic-icon-button-text-light": "#334455",
      "semantic-icon-button-text-dark": "#334455",
      "semantic-icon-button-surface-hover-dark": "#223344",
    })
    expect(document.resolvedTokens).toEqual({
      "semantic-button-danger-text-hover-dark": "#222222",
      "semantic-icon-button-text-hover-light": "#445566",
    })
  })
})

describe("appearance segmented control tokens", () => {
  it("registers and normalizes segmented control semantic tokens", () => {
    expect(APPEARANCE_TOKEN_GROUPS).toContainEqual({
      id: "component-segmented-controls",
      layer: "component",
      label: "Segmented Controls",
      description: "Container and item state colors used by segmented controls and view switches.",
      rows: [
        {
          id: "semantic-segmented-control-surface",
          label: "Control Surface",
          description: "Outer container fill for compact segmented controls.",
          lightToken: "semantic-segmented-control-surface-light",
          darkToken: "semantic-segmented-control-surface-dark",
        },
        {
          id: "semantic-segmented-control-border",
          label: "Control Border",
          description: "Outer container border for compact segmented controls.",
          lightToken: "semantic-segmented-control-border-light",
          darkToken: "semantic-segmented-control-border-dark",
        },
        {
          id: "semantic-segmented-control-item-surface-hover",
          label: "Item Hover Surface",
          description: "Hover and focus fill for segmented control items.",
          lightToken: "semantic-segmented-control-item-surface-hover-light",
          darkToken: "semantic-segmented-control-item-surface-hover-dark",
        },
        {
          id: "semantic-segmented-control-item-surface-active",
          label: "Item Active Surface",
          description: "Selected-item fill for segmented controls.",
          lightToken: "semantic-segmented-control-item-surface-active-light",
          darkToken: "semantic-segmented-control-item-surface-active-dark",
        },
        {
          id: "semantic-segmented-control-item-text",
          label: "Item Text",
          description: "Default text and icon color for segmented control items.",
          lightToken: "semantic-segmented-control-item-text-light",
          darkToken: "semantic-segmented-control-item-text-dark",
        },
        {
          id: "semantic-segmented-control-item-text-hover",
          label: "Item Hover Text",
          description: "Hover and focus text color for segmented control items.",
          lightToken: "semantic-segmented-control-item-text-hover-light",
          darkToken: "semantic-segmented-control-item-text-hover-dark",
        },
        {
          id: "semantic-segmented-control-item-text-active",
          label: "Item Active Text",
          description: "Selected-item text and icon color for segmented controls.",
          lightToken: "semantic-segmented-control-item-text-active-light",
          darkToken: "semantic-segmented-control-item-text-active-dark",
        },
        {
          id: "semantic-segmented-control-item-meta-text",
          label: "Item Meta Text",
          description: "Muted supporting text inside segmented control items.",
          lightToken: "semantic-segmented-control-item-meta-text-light",
          darkToken: "semantic-segmented-control-item-meta-text-dark",
        },
        {
          id: "semantic-segmented-control-item-meta-text-active",
          label: "Item Active Meta Text",
          description: "Supporting text color inside selected segmented control items.",
          lightToken: "semantic-segmented-control-item-meta-text-active-light",
          darkToken: "semantic-segmented-control-item-meta-text-active-dark",
        },
        {
          id: "semantic-segmented-control-item-text-disabled",
          label: "Item Disabled Text",
          description: "Disabled text and icon color for segmented control items.",
          lightToken: "semantic-segmented-control-item-text-disabled-light",
          darkToken: "semantic-segmented-control-item-text-disabled-dark",
        },
      ],
    })

    const document = normalizeAppearanceConfigDocument({
      overrides: {
        "semantic-segmented-control-surface": " #111111 ",
        "semantic-segmented-control-item-text-active-dark": "#222222",
        "not-a-token": "#000000",
      },
      resolvedTokens: {
        "semantic-segmented-control-item-surface-hover-light": " #333333 ",
      },
    })

    expect(document.overrides).toEqual({
      "semantic-segmented-control-surface-light": "#111111",
      "semantic-segmented-control-surface-dark": "#111111",
      "semantic-segmented-control-item-text-active-dark": "#222222",
    })
    expect(document.resolvedTokens).toEqual({
      "semantic-segmented-control-item-surface-hover-light": "#333333",
    })
  })
})

describe("appearance proposed plan card tokens", () => {
  it("registers the proposed plan card token group", () => {
    expect(APPEARANCE_TOKEN_GROUPS).toContainEqual({
      id: "component-proposed-plan-card",
      layer: "product",
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
      layer: "product",
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

describe("appearance thread view tokens", () => {
  it("registers text, panel, and user-turn diff card tokens", () => {
    expect(APPEARANCE_TOKEN_GROUPS).toContainEqual({
      id: "component-thread-view",
      layer: "product",
      label: "Thread View",
      description: "Dedicated semantic colors for thread text, panel surfaces, and user-turn diff cards.",
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
        {
          id: "semantic-thread-divider",
          label: "Divider",
          description: "Divider line color for thread trace headers.",
          lightToken: "semantic-thread-divider-light",
          darkToken: "semantic-thread-divider-dark",
        },
        {
          id: "semantic-thread-panel-surface",
          label: "Thread Panel Surface",
          description: "Background fill for thread-owned panels such as side chats and default assistant cards.",
          lightToken: "semantic-thread-panel-surface-light",
          darkToken: "semantic-thread-panel-surface-dark",
        },
        {
          id: "semantic-thread-panel-surface-muted",
          label: "Thread Panel Muted",
          description: "Low-emphasis background fill for trace, metadata, and nested thread panels.",
          lightToken: "semantic-thread-panel-surface-muted-light",
          darkToken: "semantic-thread-panel-surface-muted-dark",
        },
        {
          id: "semantic-thread-panel-surface-hover",
          label: "Thread Panel Hover",
          description: "Hover and focus background fill for compact controls inside thread panels.",
          lightToken: "semantic-thread-panel-surface-hover-light",
          darkToken: "semantic-thread-panel-surface-hover-dark",
        },
        {
          id: "semantic-thread-user-turn-diff-card-surface",
          label: "Diff Card Surface",
          description: "Background fill for user-turn file change cards.",
          lightToken: "semantic-thread-user-turn-diff-card-surface-light",
          darkToken: "semantic-thread-user-turn-diff-card-surface-dark",
        },
        {
          id: "semantic-thread-user-turn-diff-card-border",
          label: "Diff Card Border",
          description: "Outer border for user-turn file change cards and previews.",
          lightToken: "semantic-thread-user-turn-diff-card-border-light",
          darkToken: "semantic-thread-user-turn-diff-card-border-dark",
        },
        {
          id: "semantic-thread-user-turn-diff-divider",
          label: "Diff Row Divider",
          description: "Divider color between user-turn file change rows.",
          lightToken: "semantic-thread-user-turn-diff-divider-light",
          darkToken: "semantic-thread-user-turn-diff-divider-dark",
        },
        {
          id: "semantic-thread-user-turn-diff-row-surface-hover",
          label: "Diff Row Hover",
          description: "Hover background for user-turn file change rows and summary controls.",
          lightToken: "semantic-thread-user-turn-diff-row-surface-hover-light",
          darkToken: "semantic-thread-user-turn-diff-row-surface-hover-dark",
        },
        {
          id: "semantic-thread-user-turn-diff-row-surface-focus",
          label: "Diff Row Focus",
          description: "Keyboard focus background for user-turn file change rows and summary controls.",
          lightToken: "semantic-thread-user-turn-diff-row-surface-focus-light",
          darkToken: "semantic-thread-user-turn-diff-row-surface-focus-dark",
        },
        {
          id: "semantic-thread-user-turn-diff-preview-surface",
          label: "Diff Preview Surface",
          description: "Background fill for embedded user-turn diff previews.",
          lightToken: "semantic-thread-user-turn-diff-preview-surface-light",
          darkToken: "semantic-thread-user-turn-diff-preview-surface-dark",
        },
      ],
    })
  })

  it("normalizes thread view overrides", () => {
    const document = normalizeAppearanceConfigDocument({
      overrides: {
        "semantic-thread-response-text-light": " #123456 ",
        "semantic-thread-reasoning-text-dark": "#abcdef",
        "semantic-thread-response-text": "#000000",
        "semantic-thread-divider": "#112233",
        "semantic-thread-panel-surface": "#223344",
        "semantic-thread-user-turn-diff-card-surface": "#fedcba",
      },
      resolvedTokens: {
        "semantic-thread-reasoning-text-light": " #654321 ",
        "semantic-thread-panel-surface-hover-dark": " #445566 ",
        "semantic-thread-user-turn-diff-row-surface-focus-dark": " #334455 ",
      },
    })

    expect(document.overrides).toEqual({
      "semantic-thread-response-text-light": "#123456",
      "semantic-thread-response-text-dark": "#000000",
      "semantic-thread-reasoning-text-dark": "#abcdef",
      "semantic-thread-divider-light": "#112233",
      "semantic-thread-divider-dark": "#112233",
      "semantic-thread-panel-surface-light": "#223344",
      "semantic-thread-panel-surface-dark": "#223344",
      "semantic-thread-user-turn-diff-card-surface-light": "#fedcba",
      "semantic-thread-user-turn-diff-card-surface-dark": "#fedcba",
    })
    expect(document.resolvedTokens).toEqual({
      "semantic-thread-reasoning-text-light": "#654321",
      "semantic-thread-panel-surface-hover-dark": "#445566",
      "semantic-thread-user-turn-diff-row-surface-focus-dark": "#334455",
    })
  })
})

describe("appearance markdown tokens", () => {
  it("registers the markdown token group", () => {
    expect(APPEARANCE_TOKEN_GROUPS).toContainEqual({
      id: "component-markdown",
      layer: "product",
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
          id: "semantic-markdown-selection-background",
          label: "Selection Background",
          description: "Selection highlight background inside rendered Markdown.",
          lightToken: "semantic-markdown-selection-background-light",
          darkToken: "semantic-markdown-selection-background-dark",
        },
        {
          id: "semantic-markdown-selection-text",
          label: "Selection Text",
          description: "Selection text color inside rendered Markdown.",
          lightToken: "semantic-markdown-selection-text-light",
          darkToken: "semantic-markdown-selection-text-dark",
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
