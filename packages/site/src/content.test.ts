import { describe, expect, it } from "vitest"
import { siteContent } from "./content"

describe("site content", () => {
  it("keeps Chinese and English page structures aligned", () => {
    expect(siteContent.zh.signals).toHaveLength(siteContent.en.signals.length)
    expect(siteContent.zh.overview.steps).toHaveLength(siteContent.en.overview.steps.length)
    expect(siteContent.zh.plugins.stages).toHaveLength(siteContent.en.plugins.stages.length)
    expect(siteContent.zh.plugins.examples).toHaveLength(siteContent.en.plugins.examples.length)
    expect(siteContent.zh.useCases.items).toHaveLength(siteContent.en.useCases.items.length)
    expect(siteContent.zh.safety.items).toHaveLength(siteContent.en.safety.items.length)
    expect(siteContent.zh.faq.items).toHaveLength(siteContent.en.faq.items.length)
  })

  it("provides meaningful hero and download copy in both languages", () => {
    for (const content of Object.values(siteContent)) {
      expect(content.hero.title.length).toBeGreaterThan(12)
      expect(content.hero.description.length).toBeGreaterThan(40)
      expect(content.finalCta.docsLabel).not.toBe("")
      expect(content.useCases.items.every((item) => item.imageSrc.startsWith("/"))).toBe(true)
    }
  })
})
