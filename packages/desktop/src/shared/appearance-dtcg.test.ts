import { describe, expect, it } from "vitest"
import { parseAppearanceColorLiteral } from "./appearance-color"
import {
  ANYBOX_APPEARANCE_DTCG_EXTENSION,
  AppearanceDtcgValidationError,
  createAppearanceDtcgDocument,
  parseAppearanceDtcgJson,
  readAppearanceDtcgPointer,
  serializeAppearanceThemeToDtcg,
} from "./appearance-dtcg"
import {
  BUILT_IN_APPEARANCE_THEME_PRESETS,
  type AppearanceTheme,
} from "./appearance-themes"

function literal(value: string) {
  const result = parseAppearanceColorLiteral(value)
  if (!result) throw new Error(`Invalid test color: ${value}`)
  return result
}

function createTheme(overrides: Partial<AppearanceTheme> = {}): AppearanceTheme {
  return {
    ...BUILT_IN_APPEARANCE_THEME_PRESETS[0],
    id: "user:dtcg-test",
    name: "DTCG Test",
    source: "imported",
    readonly: false,
    createdAt: 10,
    updatedAt: 20,
    overrides: {},
    foreignDtcg: {},
    ...overrides,
  }
}

describe("appearance DTCG interchange", () => {
  it("exports resolved standard colors while preserving editable overrides", () => {
    const theme = createTheme({
      overrides: {
        "surface-app-light": literal("#123456"),
        "text-primary-light": {
          type: "alias",
          token: "surface-app-light",
        },
      },
      foreignDtcg: {
        vendor: {
          $type: "color",
          swatch: {
            $value: literal("#abcdef").value,
          },
        },
      },
    })
    const document = createAppearanceDtcgDocument(theme)
    const extension = (
      document.$extensions as Record<string, unknown>
    )[ANYBOX_APPEARANCE_DTCG_EXTENSION] as Record<string, unknown>

    expect(document.$schema).toBe(
      "https://www.designtokens.org/schemas/2025.10/format.json",
    )
    expect(readAppearanceDtcgPointer(
      document,
      "#/anybox/text-primary-light/$value",
    )).toEqual(literal("#123456").value)
    expect(extension.overrides).toEqual(theme.overrides)
    expect(extension.derivations).toBeTruthy()

    const imported = parseAppearanceDtcgJson(
      serializeAppearanceThemeToDtcg(theme),
    )
    expect(imported.theme.overrides).toEqual(theme.overrides)
    expect(imported.theme.foreignDtcg).toHaveProperty("vendor.swatch")
    expect(imported.ignoredTokenCount).toBe(1)
  })

  it("imports generic DTCG literals and both alias syntaxes", () => {
    const document = {
      $type: "color",
      "surface-app-light": {
        $value: literal("#123456").value,
      },
      "surface-panel-light": {
        $value: "{surface-app-light}",
      },
      "surface-panel-muted-light": {
        $ref: "#/surface-app-light",
      },
      vendor: {
        $value: literal("#abcdef").value,
      },
    }

    const imported = parseAppearanceDtcgJson(JSON.stringify(document), {
      fallbackName: "Generic",
    })

    expect(imported.theme.name).toBe("Generic")
    expect(imported.theme.overrides).toMatchObject({
      "surface-app-light": literal("#123456"),
      "surface-panel-light": {
        type: "alias",
        token: "surface-app-light",
      },
      "surface-panel-muted-light": {
        type: "alias",
        token: "surface-app-light",
      },
    })
    expect(imported.importedTokenCount).toBe(3)
    expect(imported.ignoredTokenCount).toBe(1)
    expect(imported.theme.foreignDtcg).toHaveProperty("vendor")
  })

  it("blocks invalid color structures and alias cycles", () => {
    expect(() => parseAppearanceDtcgJson(JSON.stringify({
      "surface-app-light": {
        $type: "color",
        $value: {
          colorSpace: "srgb",
          components: [1],
        },
      },
    }))).toThrow(AppearanceDtcgValidationError)

    expect(() => parseAppearanceDtcgJson(JSON.stringify({
      $type: "color",
      "surface-app-light": {
        $value: "{surface-panel-light}",
      },
      "surface-panel-light": {
        $value: "{surface-app-light}",
      },
    }))).toThrow(/alias cycle/i)
  })

  it("blocks oversized files before parsing", () => {
    expect(() => parseAppearanceDtcgJson(`{"data":"${"x".repeat(1_000_000)}"}`))
      .toThrow(/character limit/i)
  })
})
