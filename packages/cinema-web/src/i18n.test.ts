import { describe, expect, it } from "vitest"
import { resolveLocale, translate } from "./i18n"

describe("cinema i18n", () => {
  it("maps Chinese system locales and falls back to English", () => {
    expect(resolveLocale("zh-Hans-CN")).toBe("zh-CN")
    expect(resolveLocale("en-GB")).toBe("en-US")
    expect(resolveLocale(undefined)).toBe("en-US")
  })

  it("interpolates translated parameters", () => {
    expect(translate("zh-CN", "text.referenceImages", { count: 3 })).toBe("参考图：3 张")
    expect(translate("en-US", "text.referenceImages", { count: 2 })).toBe("Reference images: 2")
  })
})
