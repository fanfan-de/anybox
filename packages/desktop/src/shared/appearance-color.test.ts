import { describe, expect, it } from "vitest"
import {
  appearanceTokenValueToCss,
  evaluateAppearanceContrastWarnings,
  normalizeAppearanceTokenValue,
  parseAppearanceColorLiteral,
  resolveAppearanceTokenColors,
  resolveAppearanceTokenCssValues,
} from "./appearance-color"
import type { AppearanceTokenMap } from "./appearance"

function literal(value: string) {
  const result = parseAppearanceColorLiteral(value)
  if (!result) throw new Error(`Invalid test color: ${value}`)
  return result
}

describe("appearance color values", () => {
  it("normalizes legacy CSS colors into explicit DTCG literals", () => {
    expect(normalizeAppearanceTokenValue(" rgba(255, 0, 128, 0.5) ")).toEqual({
      type: "literal",
      value: {
        colorSpace: "srgb",
        components: [1, 0, 0.501961],
        alpha: 0.5,
        hex: "#ff0080",
      },
    })
    expect(appearanceTokenValueToCss(literal("#123456"))).toBe("#123456")
  })

  it("resolves public aliases without persisting a resolved-token cache", () => {
    const values = resolveAppearanceTokenCssValues({
      brandTheme: "terra",
      overrides: {
        "surface-app-light": literal("#123456"),
        "text-primary-light": {
          type: "alias",
          token: "surface-app-light",
        },
      },
    })

    expect(values["surface-app-light"]).toBe("#123456")
    expect(values["text-primary-light"]).toBe("#123456")
  })

  it("recomputes internal blends when a source token changes", () => {
    const overrides: AppearanceTokenMap = {
      "surface-panel-light": literal("#ff0000"),
      "surface-panel-muted-light": literal("#0000ff"),
    }
    const values = resolveAppearanceTokenCssValues({
      brandTheme: "terra",
      overrides,
    })

    expect(values["semantic-button-secondary-surface-hover-light"]).toBe("#b80047")

    const transparentBlend = resolveAppearanceTokenColors({
      brandTheme: "terra",
      overrides: {
        "surface-panel-muted-light": literal("#ff0000"),
      },
    })["semantic-icon-button-surface-hover-light"]
    expect(transparentBlend.components).toEqual([1, 0, 0])
    expect(transparentBlend.alpha).toBe(0.86)
  })

  it("rejects override alias cycles at resolution time", () => {
    expect(() => resolveAppearanceTokenColors({
      brandTheme: "terra",
      overrides: {
        "surface-app-light": {
          type: "alias",
          token: "surface-panel-light",
        },
        "surface-panel-light": {
          type: "alias",
          token: "surface-app-light",
        },
      },
    })).toThrow(/dependency cycle/i)
  })

  it("reports contrast contracts as non-blocking warnings", () => {
    const warnings = evaluateAppearanceContrastWarnings({
      brandTheme: "terra",
      overrides: {
        "text-primary-light": {
          type: "alias",
          token: "surface-app-light",
        },
      },
    })

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mode: "light",
        foregroundToken: "text-primary-light",
        backgroundToken: "surface-app-light",
      }),
    ]))
  })
})
