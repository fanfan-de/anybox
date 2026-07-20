import { describe, expect, test } from "bun:test"
import {
  BrowserLocatorPlanV3,
} from "@anybox/chrome-shared/browser-contract"
import {
  compileLocatorExpressionV3,
  compileLocatorPlanV3,
} from "../src/background/locator-compiler"

describe("Locator v3 compiler boundary", () => {
  test("compiles semantic and compositional plans only inside the extension", () => {
    const plan = BrowserLocatorPlanV3.parse({
      framePath: ["iframe[data-app='billing']"],
      expression: {
        kind: "filter",
        source: {
          kind: "and",
          left: {
            kind: "role",
            role: "button",
            name: { type: "string", value: "Pay now", exact: true },
          },
          right: {
            kind: "selector",
            value: "[data-state='ready']",
          },
        },
        hasNotText: {
          type: "regex",
          source: "disabled\\/soon",
          flags: "iu",
        },
        visible: true,
      },
    })

    const compiled = compileLocatorPlanV3(plan)
    expect(compiled.framePath).toEqual(["iframe[data-app='billing']"])
    expect(compiled.selector).toContain(
      'internal:role=button[name="Pay now"s]',
    )
    expect(compiled.selector).toContain("internal:and=")
    expect(compiled.selector).toContain(
      "internal:has-not-text=/disabled\\/soon/iu",
    )
    expect(compiled.selector).toEndWith("visible=true")
  })

  test("preserves explicit nth disambiguation, including last()", () => {
    expect(compileLocatorExpressionV3({
      kind: "nth",
      source: {
        kind: "text",
        matcher: { type: "string", value: "Result" },
      },
      index: -1,
    })).toBe('internal:text="Result"i >> nth=-1')
  })

  test("rejects public attempts to submit Playwright internal engines", () => {
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: [],
      expression: {
        kind: "selector",
        value: "internal:role=button",
      },
    }).success).toBe(false)
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: ["internal:control=enter-frame"],
      expression: {
        kind: "selector",
        value: "button",
      },
    }).success).toBe(false)
  })
})
