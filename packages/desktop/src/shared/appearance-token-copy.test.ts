import { describe, expect, it } from "vitest"
import { APPEARANCE_TOKEN_GROUPS } from "./appearance"
import { getAppearanceTokenGroupCopy, getAppearanceTokenRowCopy } from "./appearance-token-copy"

describe("appearance token localization", () => {
  const group = APPEARANCE_TOKEN_GROUPS[0]
  const row = group.rows[0]

  it.each([
    ["zh-TW", "基礎 / 表面"],
    ["ja-JP", "基盤 / サーフェス"],
    ["ko-KR", "기초 / 표면"],
    ["pt-BR", "Fundação / Superfícies"],
    ["es-419", "Base / Superficies"],
    ["de-DE", "Grundlagen / Oberflächen"],
    ["fr-FR", "Fondation / Surfaces"],
    ["id-ID", "Dasar / Permukaan"],
    ["it-IT", "Base / Superfici"],
    ["pl-PL", "Podstawa / Powierzchnie"],
    ["tr-TR", "Temel / Yüzeyler"],
    ["vi-VN", "Nền tảng / Bề mặt"],
  ] as const)("localizes appearance copy for %s", (locale, expectedLabel) => {
    expect(getAppearanceTokenGroupCopy(locale, group).label).toBe(expectedLabel)
    expect(getAppearanceTokenRowCopy(locale, row).label).not.toBe(row.label)
  })

  it("keeps the source copy for English", () => {
    expect(getAppearanceTokenGroupCopy("en-US", group)).toEqual(group)
    expect(getAppearanceTokenRowCopy("en-US", row)).toEqual(row)
  })
})
