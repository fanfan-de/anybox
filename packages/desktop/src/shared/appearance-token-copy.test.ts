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

  it.each([
    ["zh-TW", "開關"],
    ["ja-JP", "スイッチ"],
    ["ko-KR", "스위치"],
    ["pt-BR", "Interruptores"],
    ["es-419", "Interruptores"],
    ["de-DE", "Schalter"],
    ["fr-FR", "Interrupteurs"],
    ["id-ID", "Sakelar"],
    ["it-IT", "Interruttori"],
    ["pl-PL", "Przełączniki"],
    ["tr-TR", "Anahtarlar"],
    ["vi-VN", "Công tắc"],
  ] as const)("localizes the shared switch group for %s", (locale, expectedLabel) => {
    const switchGroup = APPEARANCE_TOKEN_GROUPS.find((candidate) => candidate.id === "component-switches")

    expect(switchGroup).toBeDefined()
    expect(getAppearanceTokenGroupCopy(locale, switchGroup!).label).toBe(expectedLabel)
    expect(getAppearanceTokenRowCopy(locale, switchGroup!.rows[0]).label).not.toBe(switchGroup!.rows[0].label)
  })

  it("keeps the source copy for English", () => {
    expect(getAppearanceTokenGroupCopy("en-US", group)).toEqual(group)
    expect(getAppearanceTokenRowCopy("en-US", row)).toEqual(row)
  })
})
