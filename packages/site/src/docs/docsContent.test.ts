import { describe, expect, it } from "vitest"
import {
  docsSectionsByLanguage,
  getDocsArticle,
  getDocsArticles,
} from "./docsContent"

describe("docs content", () => {
  it("keeps Chinese and English article routes aligned", () => {
    expect(getDocsArticles("zh").map((article) => article.slug)).toEqual(
      getDocsArticles("en").map((article) => article.slug),
    )
  })

  it("registers the tool system in the configuration section", () => {
    for (const language of ["zh", "en"] as const) {
      const toolsArticle = getDocsArticle("tools", language)
      const configureSection = docsSectionsByLanguage[language][1]

      expect(toolsArticle).toBeDefined()
      expect(configureSection.items).toContain(toolsArticle)
      expect(toolsArticle?.content).toContain("tool_search")
      expect(toolsArticle?.content).toContain("JavaScript Exec")
      expect(toolsArticle?.content).toContain("QuickJS")
      expect(toolsArticle?.content).toContain("tools.read_file")
    }
  })
})
