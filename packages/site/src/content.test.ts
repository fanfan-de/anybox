import { describe, expect, it } from "vitest"
import { siteContent } from "./content"

describe("site content", () => {
  it("keeps Chinese and English page structures aligned", () => {
    expect(siteContent.zh.signals).toHaveLength(siteContent.en.signals.length)
    expect(siteContent.zh.workflow.steps).toHaveLength(siteContent.en.workflow.steps.length)
    expect(siteContent.zh.capabilities.items).toHaveLength(siteContent.en.capabilities.items.length)
    expect(siteContent.zh.useCases.items).toHaveLength(siteContent.en.useCases.items.length)
  })

  it("provides meaningful hero and download copy in both languages", () => {
    for (const content of Object.values(siteContent)) {
      expect(content.hero.title.length).toBeGreaterThan(12)
      expect(content.hero.description.length).toBeGreaterThan(40)
      expect(content.finalCta.docsLabel).not.toBe("")
    }
  })
})
