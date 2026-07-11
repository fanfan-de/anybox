import { describe, expect, it } from "vitest"
import {
  APP_LOCALES,
  createDefaultLocaleConfigDocument,
  normalizeAppLocale,
  normalizeLocaleConfigDocument,
} from "./locale"

describe("locale settings", () => {
  it("defaults to Chinese when no preference exists", () => {
    expect(createDefaultLocaleConfigDocument()).toEqual({
      version: 1,
      locale: "zh-CN",
      updatedAt: 0,
    })
  })

  it("normalizes supported and unsupported locale values", () => {
    for (const locale of APP_LOCALES) expect(normalizeAppLocale(locale)).toBe(locale)
    expect(normalizeAppLocale("ar-SA")).toBe("zh-CN")
  })

  it("normalizes persisted locale documents", () => {
    expect(normalizeLocaleConfigDocument({
      version: 1,
      locale: "en-US",
      updatedAt: 42,
    })).toEqual({
      version: 1,
      locale: "en-US",
      updatedAt: 42,
    })

    expect(normalizeLocaleConfigDocument({
      locale: "ar-SA",
      updatedAt: Number.NaN,
    })).toEqual({
      version: 1,
      locale: "zh-CN",
      updatedAt: 0,
    })
  })
})
